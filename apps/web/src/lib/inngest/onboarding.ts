/**
 * runOnboarding — parent workflow for the onboarding session state machine.
 * Owns CaseSchema.phase and drives it through:
 *
 *   PENDING → GENERATING_HYPOTHESIS → FINALIZING_SCHEMA
 *           → PROCESSING_SCAN (waits for scan.completed)
 *           → AWAITING_REVIEW  (happy path)
 *           or NO_EMAILS_FOUND (empty scan)
 *           or FAILED          (any thrown error)
 *
 * The transitions use advanceSchemaPhase for CAS-on-phase semantics: if
 * two concurrent runOnboarding invocations raced, only one would advance
 * and the loser would throw NonRetriableError. Idempotent re-runs (Inngest
 * retry landing on an already-advanced row) return "skipped" from the
 * helper and we load the persisted state to continue.
 *
 * This function does NOT own ScanJob.phase — it creates the scan row,
 * emits scan.requested, and waits for scan.completed. runScan (Task 8)
 * owns the scan-phase transitions.
 */
import type { InterviewInput, SchemaHypothesis } from "@denim/types";
import { NonRetriableError } from "inngest";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { generateHypothesis, persistSchemaRelations } from "@/lib/services/interview";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";

const SCAN_WAIT_TIMEOUT = "20m";

export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    triggers: [{ event: "onboarding.session.started" }],
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { key: "event.data.userId", limit: 3 },
    ],
    // Failures are explicit via markSchemaFailed in the catch block.
    retries: 0,
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;

    try {
      // ---- Step 1: PENDING → GENERATING_HYPOTHESIS ---------------------
      //
      // Load the raw InterviewInput the caller persisted on the stub,
      // ask Claude for a hypothesis, and write it back to the row.
      await step.run("generate-hypothesis", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "PENDING",
          to: "GENERATING_HYPOTHESIS",
          work: async () => {
            const schema = await prisma.caseSchema.findUniqueOrThrow({
              where: { id: schemaId },
              select: { inputs: true },
            });
            const inputs = schema.inputs as unknown as InterviewInput | null;
            if (!inputs) {
              throw new NonRetriableError(
                `runOnboarding: CaseSchema ${schemaId} has no inputs column — stub was created without an InterviewInput`,
              );
            }
            const hypothesis = await generateHypothesis(inputs, { userId });
            await prisma.caseSchema.update({
              where: { id: schemaId },
              data: { hypothesis: hypothesis as unknown as object },
            });
          },
        });
      });

      // ---- Step 2: GENERATING_HYPOTHESIS → FINALIZING_SCHEMA -----------
      //
      // Read the stored hypothesis back and hand it to persistSchemaRelations.
      // The auto-onboarding path has no human-in-the-loop validation step,
      // so validation + confirmations are omitted (defaults apply).
      await step.run("finalize-schema", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "GENERATING_HYPOTHESIS",
          to: "FINALIZING_SCHEMA",
          work: async () => {
            const schema = await prisma.caseSchema.findUniqueOrThrow({
              where: { id: schemaId },
              select: { hypothesis: true },
            });
            const hypothesis = schema.hypothesis as unknown as SchemaHypothesis | null;
            if (!hypothesis) {
              throw new NonRetriableError(
                `runOnboarding: CaseSchema ${schemaId} has no hypothesis column after GENERATING_HYPOTHESIS`,
              );
            }
            await persistSchemaRelations(schemaId, hypothesis);
          },
        });
      });

      // ---- Step 3: FINALIZING_SCHEMA → PROCESSING_SCAN ------------------
      //
      // Create the onboarding ScanJob row in the same CAS so the scan id
      // and the schema-phase advance commit atomically. Return the scan
      // id through the helper; on "skipped" (re-entry) look it up.
      const createdScanId = await step.run("create-scan-job", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "FINALIZING_SCHEMA",
          to: "PROCESSING_SCAN",
          work: async () => {
            const scan = await prisma.scanJob.create({
              data: {
                schemaId,
                userId,
                status: "PENDING",
                phase: "PENDING",
                triggeredBy: "ONBOARDING",
                totalEmails: 0, // overwritten by runScan discovery step
              },
              select: { id: true },
            });
            return scan.id;
          },
        });
      });

      const scanJobId: string = await step.run("resolve-scan-job", async () => {
        if (createdScanId !== "skipped") return createdScanId;
        // Re-entry: find the most recent onboarding scan for this schema.
        const existing = await prisma.scanJob.findFirst({
          where: { schemaId, triggeredBy: "ONBOARDING" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (!existing) {
          throw new NonRetriableError(
            `runOnboarding: schema ${schemaId} is past FINALIZING_SCHEMA but has no onboarding ScanJob`,
          );
        }
        return existing.id;
      });

      // ---- Step 4: request scan -----------------------------------------
      await step.run("request-scan", async () => {
        await inngest.send({
          name: "scan.requested",
          data: { scanJobId, schemaId, userId },
        });
      });

      // ---- Step 5: wait for scan.completed ------------------------------
      //
      // Inngest waitForEvent returns null on timeout. The `match` clause
      // filters to the specific scanJobId so a parallel scan for another
      // schema doesn't unblock this workflow.
      const completion = await step.waitForEvent("wait-for-scan", {
        event: "scan.completed",
        timeout: SCAN_WAIT_TIMEOUT,
        match: "data.scanJobId",
      });

      if (!completion) {
        throw new NonRetriableError(
          `runOnboarding: scan ${scanJobId} did not complete within ${SCAN_WAIT_TIMEOUT}`,
        );
      }

      // ---- Step 6: advance to terminal state ----------------------------
      //
      // Two outcomes from the scan:
      //   - reason="no-emails-found" → NO_EMAILS_FOUND (terminal, no review)
      //   - happy path → quality gate then AWAITING_REVIEW
      const reason = completion.data.reason;

      if (reason === "no-emails-found") {
        await step.run("advance-to-no-emails-found", async () => {
          await advanceSchemaPhase({
            schemaId,
            from: "PROCESSING_SCAN",
            to: "NO_EMAILS_FOUND",
            work: async () => {
              // Terminal phase — nothing else to write.
            },
          });
        });
        logger.info({
          service: "runOnboarding",
          operation: "runOnboarding.noEmailsFound",
          schemaId,
          scanJobId,
        });
        return;
      }

      await step.run("advance-to-awaiting-review", async () => {
        await advanceSchemaPhase({
          schemaId,
          from: "PROCESSING_SCAN",
          to: "AWAITING_REVIEW",
          work: async () => {
            // Quality gate: make sure every OPEN case has been synthesized.
            // runSynthesis marks cases with a timestamp as it processes them;
            // any nulls here mean the pipeline silently dropped a case and
            // the user shouldn't see AWAITING_REVIEW until the gap is
            // surfaced (we throw, markSchemaFailed runs in the catch).
            const unsynthesized = await prisma.case.count({
              where: { schemaId, status: "OPEN", synthesizedAt: null },
            });
            if (unsynthesized > 0) {
              throw new Error(
                `runOnboarding: ${unsynthesized} OPEN case(s) still unsynthesized — refusing to advance to AWAITING_REVIEW`,
              );
            }
          },
        });
      });

      logger.info({
        service: "runOnboarding",
        operation: "runOnboarding.awaitingReview",
        schemaId,
        scanJobId,
        synthesizedCount: completion.data.synthesizedCount ?? 0,
        failedCount: completion.data.failedCount ?? 0,
      });
    } catch (error) {
      if (error instanceof NonRetriableError) {
        // Re-read the current phase so markSchemaFailed records exactly
        // where we died (the catch block can't assume anything).
        const current = await prisma.caseSchema.findUnique({
          where: { id: schemaId },
          select: { phase: true },
        });
        await markSchemaFailed(schemaId, current?.phase ?? "PENDING", error);
        throw error;
      }

      logger.error({
        service: "runOnboarding",
        operation: "runOnboarding.caught",
        schemaId,
        error: error instanceof Error ? error.message : String(error),
      });
      const current = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true },
      });
      await markSchemaFailed(schemaId, current?.phase ?? "PENDING", error);
      throw error;
    }
  },
);
