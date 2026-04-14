/**
 * Onboarding Inngest functions — split into two for the review-gate flow.
 *
 * Function A: runOnboarding (triggered by onboarding.session.started)
 *   Drives: PENDING → GENERATING_HYPOTHESIS → AWAITING_REVIEW
 *   Generates and validates the hypothesis, then stops at the review screen.
 *   The user sees Card 4 (review screen) and can confirm/adjust entities.
 *
 * Function B: runOnboardingPipeline (triggered by onboarding.review.confirmed)
 *   Drives: AWAITING_REVIEW → PROCESSING_SCAN → COMPLETED (or terminal states)
 *   Creates the ScanJob, emits scan.requested, waits for scan.completed,
 *   then advances to the terminal state.
 *
 * Phase transitions use advanceSchemaPhase for CAS-on-phase semantics: if
 * two concurrent invocations raced, only one would advance and the loser
 * would throw NonRetriableError. Idempotent re-runs (Inngest retry landing
 * on an already-advanced row) return "skipped" from the helper and we load
 * the persisted state to continue.
 *
 * This file does NOT call persistSchemaRelations — that is now called by
 * the POST /api/onboarding/:schemaId route (Task 4) when the user confirms.
 */
import type { HypothesisValidation, InterviewInput, SchemaHypothesis } from "@denim/types";
import type { Prisma } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { extractExpansionTargets } from "@/lib/services/expansion-targets";
import {
  generateHypothesis,
  resolveWhoEmails,
  validateHypothesis,
} from "@/lib/services/interview";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";

const SCAN_WAIT_TIMEOUT = "20m";

// ---------------------------------------------------------------------------
// Function A: runOnboarding
// Triggered by: onboarding.session.started
// Exits at: AWAITING_REVIEW (user sees the review screen)
// ---------------------------------------------------------------------------

export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    triggers: [{ event: "onboarding.session.started" }],
    // DELETE /api/onboarding/:schemaId emits onboarding.session.cancelled;
    // Inngest cancels the in-flight run when data.schemaId matches.
    cancelOn: [{ event: "onboarding.session.cancelled", match: "data.schemaId" }],
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

      // ---- Step 1b: Pass 1 validation (broad random sample) -------------
      //
      // Pre-confirm validation. Reads a small random sample from the last
      // 8 weeks and asks Claude to identify confirmed entities, new
      // discoveries, and noise. Pass 2 (targeted domain expansion) is
      // deferred until after the user confirms — see
      // expand-confirmed-domains in runOnboardingPipeline.
      //
      // Runs OUTSIDE an advanceSchemaPhase CAS — stays within the
      // GENERATING_HYPOTHESIS phase for polling purposes. The phase advance
      // happens in the next step (advance-to-awaiting-review) after
      // validation has written its result back.
      await step.run("validate-hypothesis", async () => {
        const schema = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { hypothesis: true, validation: true, inputs: true },
        });

        // Idempotency guard: on Inngest retry, if validation already ran,
        // skip it rather than spending another Claude call.
        if (schema.validation) {
          logger.info({
            service: "runOnboarding",
            operation: "validate-hypothesis.skip",
            schemaId,
            reason: "already-validated",
          });
          return;
        }

        const hypothesis = schema.hypothesis as unknown as SchemaHypothesis | null;
        if (!hypothesis) {
          throw new NonRetriableError(
            `runOnboarding: CaseSchema ${schemaId} has no hypothesis after GENERATING_HYPOTHESIS`,
          );
        }

        const accessToken = await getValidGmailToken(userId);
        const gmail = new GmailClient(accessToken);
        const { messages } = await gmail.sampleScan(
          ONBOARDING_TUNABLES.pass1.sampleSize,
          ONBOARDING_TUNABLES.pass1.lookback,
        );

        // Enrich hypothesis WHO aliases with resolved sender email
        // addresses (mutates the hypothesis object in place). Pass 2
        // (post-confirm) reads these enriched aliases via
        // extractExpansionTargets.
        resolveWhoEmails(hypothesis, messages);

        const pass1Samples = messages.map((m) => ({
          subject: m.subject,
          senderDomain: m.senderDomain,
          senderName: m.senderDisplayName || m.senderEmail,
          snippet: m.snippet,
        }));

        // entityGroups come from the raw InterviewInput (user's original
        // topic groupings), not from the AI-generated hypothesis. Map to
        // the EntityGroupContext shape validateHypothesis expects.
        const inputs = schema.inputs as unknown as InterviewInput | null;
        const entityGroups = inputs?.groups?.map((g, idx) => ({
          index: idx,
          primaryNames: g.whats,
          secondaryNames: g.whos,
        }));

        // userThings = the user's raw WHATs (e.g., ["soccer","dance",...]).
        // We give these to Claude so it can fill relatedUserThing on each
        // discovered entity. Prefer the flat `whats` if present; fall back
        // to flattening the groups.
        const userThings = inputs?.whats ?? inputs?.groups?.flatMap((g) => g.whats) ?? [];

        const pass1 = await validateHypothesis(hypothesis, pass1Samples, {
          userId,
          entityGroups,
          userThings,
        });

        await prisma.caseSchema.update({
          where: { id: schemaId },
          data: {
            // Write back the (possibly mutated) hypothesis with enriched
            // WHO aliases so Pass 2 and persistSchemaRelations see the
            // resolved email addresses.
            hypothesis: hypothesis as unknown as Prisma.InputJsonValue,
            validation: pass1 as unknown as Prisma.InputJsonValue,
          },
        });

        logger.info({
          service: "runOnboarding",
          operation: "validate-hypothesis.complete",
          schemaId,
          sampleSize: ONBOARDING_TUNABLES.pass1.sampleSize,
          lookback: ONBOARDING_TUNABLES.pass1.lookback,
          discovered: pass1.discoveredEntities.length,
          confidenceScore: pass1.confidenceScore,
        });
      });

      // ---- Step 2: GENERATING_HYPOTHESIS → AWAITING_REVIEW ---------------
      //
      // Hypothesis generation and validation are done. Advance to
      // AWAITING_REVIEW so the UI shows Card 4 (the review screen).
      // persistSchemaRelations is NOT called here — the confirm route
      // (POST /api/onboarding/:schemaId) calls it after the user confirms.
      await step.run("advance-to-awaiting-review", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "GENERATING_HYPOTHESIS",
          to: "AWAITING_REVIEW",
          work: async () => {
            // No additional work needed: hypothesis and validation are already
            // written to the schema row. The CAS just flips the phase.
          },
        });
      });

      logger.info({
        service: "runOnboarding",
        operation: "runOnboarding.awaitingReview",
        schemaId,
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

// ---------------------------------------------------------------------------
// Function B: runOnboardingPipeline
// Triggered by: onboarding.review.confirmed (emitted by the confirm route)
// Drives: AWAITING_REVIEW → PROCESSING_SCAN → COMPLETED (or terminal state)
// ---------------------------------------------------------------------------

export const runOnboardingPipeline = inngest.createFunction(
  {
    id: "run-onboarding-pipeline",
    triggers: [{ event: "onboarding.review.confirmed" }],
    cancelOn: [{ event: "onboarding.session.cancelled", match: "data.schemaId" }],
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { key: "event.data.userId", limit: 3 },
    ],
    retries: 0,
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;

    try {
      // ---- Step 0: Pass 2 — targeted domain expansion ------------------
      //
      // The user has confirmed which entities they care about. Expand
      // Gmail coverage for those entities ONLY: for each confirmed
      // SECONDARY entity's alias addresses, emit an expansion target
      // (domain for corporate senders, full sender address for generic
      // providers like @gmail.com). Query Gmail for each target, run a
      // second validateHypothesis pass on those samples, and write any
      // newly discovered entities as Entity rows so the downstream scan
      // picks them up via normal entity reads.
      //
      // This step is best-effort: failure here should NOT block the
      // pipeline. If Gmail quota or an expansion call fails, log and
      // continue so the user still gets their scan.
      await step.run("expand-confirmed-domains", async () => {
        try {
          const schema = await prisma.caseSchema.findUniqueOrThrow({
            where: { id: schemaId },
            select: { hypothesis: true, inputs: true },
          });
          const hypothesis = schema.hypothesis as unknown as SchemaHypothesis | null;
          if (!hypothesis) {
            logger.warn({
              service: "runOnboardingPipeline",
              operation: "expand-confirmed-domains.skip",
              schemaId,
              reason: "no-hypothesis",
            });
            return;
          }

          // Only expand for entities the user kept (isActive=true). A
          // rejected entity means the user doesn't want its domain
          // crawled.
          const activeEntities = await prisma.entity.findMany({
            where: { schemaId, isActive: true, type: "SECONDARY" },
            select: { name: true, aliases: true },
          });
          if (activeEntities.length === 0) {
            logger.info({
              service: "runOnboardingPipeline",
              operation: "expand-confirmed-domains.skip",
              schemaId,
              reason: "no-active-secondary-entities",
            });
            return;
          }

          // Build a hypothesis-shaped view restricted to active SECONDARY
          // entities with their DB-resolved aliases. extractExpansionTargets
          // walks aliases, so this narrows the inputs correctly without
          // touching the helper.
          const narrowed: SchemaHypothesis = {
            ...hypothesis,
            entities: activeEntities.map((e) => ({
              name: e.name,
              type: "SECONDARY",
              secondaryTypeName: null,
              aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
              confidence: 1,
              source: "user_input",
            })),
          };

          const targets = extractExpansionTargets(narrowed).slice(
            0,
            ONBOARDING_TUNABLES.pass2.maxTargetsToExpand,
          );
          if (targets.length === 0) {
            logger.info({
              service: "runOnboardingPipeline",
              operation: "expand-confirmed-domains.skip",
              schemaId,
              reason: "no-targets",
            });
            return;
          }

          const accessToken = await getValidGmailToken(userId);
          const gmail = new GmailClient(accessToken);
          const inputs = schema.inputs as unknown as InterviewInput | null;
          const entityGroups = inputs?.groups?.map((g, idx) => ({
            index: idx,
            primaryNames: g.whats,
            secondaryNames: g.whos,
          }));
          const userThings = inputs?.whats ?? inputs?.groups?.flatMap((g) => g.whats) ?? [];

          // Accumulate discoveries across targets, deduped by entity name
          // against existing DB entities AND across targets in this pass.
          const existingNames = new Set(
            activeEntities.map((e) => e.name.toLowerCase()),
          );
          const allPrimaryNames = await prisma.entity.findMany({
            where: { schemaId, type: "PRIMARY" },
            select: { name: true },
          });
          for (const p of allPrimaryNames) existingNames.add(p.name.toLowerCase());

          const newDiscoveries: HypothesisValidation["discoveredEntities"] = [];

          for (const target of targets) {
            try {
              const query =
                `from:${target.value} newer_than:${ONBOARDING_TUNABLES.pass2.lookback}`;
              const targetMessages = await gmail.searchEmails(
                query,
                ONBOARDING_TUNABLES.pass2.emailsPerTarget,
              );
              if (targetMessages.length === 0) continue;

              const samples = targetMessages.map((m) => ({
                subject: m.subject,
                senderDomain: m.senderDomain,
                senderName: m.senderDisplayName || m.senderEmail,
                snippet: m.snippet,
              }));

              const pass2 = await validateHypothesis(narrowed, samples, {
                userId,
                entityGroups,
                userThings,
              });

              for (const discovered of pass2.discoveredEntities) {
                const key = discovered.name.toLowerCase();
                if (existingNames.has(key)) continue;
                if (newDiscoveries.some((e) => e.name.toLowerCase() === key)) continue;
                newDiscoveries.push(discovered);
                existingNames.add(key);
              }

              logger.info({
                service: "runOnboardingPipeline",
                operation: "expand-confirmed-domains.target",
                schemaId,
                targetType: target.type,
                targetValue: target.value,
                emailsFetched: targetMessages.length,
                newFromTarget: pass2.discoveredEntities.length,
              });
            } catch (err) {
              logger.warn({
                service: "runOnboardingPipeline",
                operation: "expand-confirmed-domains.target.failed",
                schemaId,
                targetType: target.type,
                targetValue: target.value,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (newDiscoveries.length === 0) {
            logger.info({
              service: "runOnboardingPipeline",
              operation: "expand-confirmed-domains.complete",
              schemaId,
              newDiscoveries: 0,
            });
            return;
          }

          // Persist new discoveries as Entity rows so the downstream scan
          // reads them when building discovery queries. These are written
          // as isActive=true with autoDetected=true — the user didn't
          // get to toggle them because they were discovered AFTER confirm.
          // If that turns out to surface too many off-topic entities, we
          // can gate on relatedUserThing !== null in a future pass.
          await prisma.$transaction(
            newDiscoveries.map((d) =>
              prisma.entity.upsert({
                where: {
                  schemaId_name_type: {
                    schemaId,
                    name: d.name,
                    type: d.type,
                  },
                },
                create: {
                  schemaId,
                  name: d.name,
                  type: d.type,
                  secondaryTypeName: d.secondaryTypeName,
                  aliases: [],
                  autoDetected: true,
                  confidence: d.confidence,
                  isActive: true,
                },
                // Idempotent retry: if this step runs again after a
                // previous transaction already wrote the row, do nothing.
                // The existing row is whatever the earlier run wrote.
                update: {},
              }),
            ),
          );

          logger.info({
            service: "runOnboardingPipeline",
            operation: "expand-confirmed-domains.complete",
            schemaId,
            targetCount: targets.length,
            newDiscoveries: newDiscoveries.length,
          });
        } catch (err) {
          // Outer catch: swallow so pipeline continues. Domain expansion
          // is best-effort; its value is more discoveries, not
          // correctness.
          logger.warn({
            service: "runOnboardingPipeline",
            operation: "expand-confirmed-domains.failed",
            schemaId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      // ---- Step 1: AWAITING_REVIEW → PROCESSING_SCAN --------------------
      //
      // Create the onboarding ScanJob row in the same CAS so the scan id
      // and the schema-phase advance commit atomically. Return the scan
      // id through the helper; on "skipped" (re-entry) look it up.
      const createdScanId = await step.run("create-scan-job", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "AWAITING_REVIEW",
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

      // ---- Step 2: resolve scan job id ----------------------------------
      //
      // On "skipped" re-entry (Inngest retry after create-scan-job already
      // advanced the phase), look up the most recent onboarding scan.
      const scanJobId: string = await step.run("resolve-scan-job", async () => {
        if (createdScanId !== "skipped") return createdScanId as string;
        const existing = await prisma.scanJob.findFirst({
          where: { schemaId, triggeredBy: "ONBOARDING" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (!existing) {
          throw new NonRetriableError(
            `runOnboardingPipeline: schema ${schemaId} is past AWAITING_REVIEW but has no onboarding ScanJob`,
          );
        }
        return existing.id;
      });

      // ---- Step 3: request scan -----------------------------------------
      await step.run("request-scan", async () => {
        await inngest.send({
          name: "scan.requested",
          data: { scanJobId, schemaId, userId },
        });
      });

      // ---- Step 4: wait for scan.completed ------------------------------
      //
      // Inngest waitForEvent returns null on timeout. The `match` clause
      // filters to the specific schemaId so a parallel scan for another
      // schema doesn't unblock this workflow. We match on schemaId (not
      // scanJobId) because the trigger event (onboarding.review.confirmed)
      // has schemaId but not scanJobId — matching on a field absent from
      // the trigger always fails (see docs/01_denim_lessons_learned.md).
      const completion = await step.waitForEvent("wait-for-scan", {
        event: "scan.completed",
        timeout: SCAN_WAIT_TIMEOUT,
        match: "data.schemaId",
      });

      if (!completion) {
        throw new NonRetriableError(
          `runOnboardingPipeline: scan ${scanJobId} did not complete within ${SCAN_WAIT_TIMEOUT}`,
        );
      }

      // ---- Step 5: advance to terminal state ----------------------------
      //
      // Three outcomes from the scan:
      //   - reason="failed"          → FAILED (scan died, surface the error)
      //   - reason="no-emails-found" → NO_EMAILS_FOUND (terminal, no content)
      //   - happy path               → COMPLETED with status ACTIVE
      const reason = completion.data.reason;
      // "failed" reason + errorMessage are set at runtime by handleDownstreamScanFailure
      // even though the typed union only declares "no-emails-found".
      const completionData = completion.data as typeof completion.data & {
        reason?: string;
        errorMessage?: string;
      };
      const errorMessage: string | undefined = completionData.errorMessage;

      if (completionData.reason === "failed") {
        const scanError = errorMessage ?? "Scan failed";
        throw new NonRetriableError(`runOnboardingPipeline: scan failed — ${scanError}`);
      }

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
          service: "runOnboardingPipeline",
          operation: "runOnboardingPipeline.noEmailsFound",
          schemaId,
          scanJobId,
        });
        return;
      }

      // Happy path: advance to COMPLETED and mark schema ACTIVE.
      await step.run("advance-to-completed", async () => {
        await advanceSchemaPhase({
          schemaId,
          from: "PROCESSING_SCAN",
          to: "COMPLETED",
          work: async () => {
            await prisma.caseSchema.update({
              where: { id: schemaId },
              data: { status: "ACTIVE" },
            });
          },
        });
      });

      logger.info({
        service: "runOnboardingPipeline",
        operation: "runOnboardingPipeline.completed",
        schemaId,
        scanJobId,
        synthesizedCount: completion.data.synthesizedCount ?? 0,
        failedCount: completion.data.failedCount ?? 0,
      });
    } catch (error) {
      if (error instanceof NonRetriableError) {
        const current = await prisma.caseSchema.findUnique({
          where: { id: schemaId },
          select: { phase: true },
        });
        await markSchemaFailed(schemaId, current?.phase ?? "AWAITING_REVIEW", error);
        throw error;
      }

      logger.error({
        service: "runOnboardingPipeline",
        operation: "runOnboardingPipeline.caught",
        schemaId,
        error: error instanceof Error ? error.message : String(error),
      });
      const current = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true },
      });
      await markSchemaFailed(schemaId, current?.phase ?? "AWAITING_REVIEW", error);
      throw error;
    }
  },
);
