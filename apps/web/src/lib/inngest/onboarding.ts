/**
 * Onboarding Inngest functions — fast-discovery flow (issue #95).
 *
 * Function A: runOnboarding (triggered by onboarding.session.started)
 *   Thin Stage-1 trigger. Verifies the schema row exists and has a domain
 *   set by createSchemaStub, then emits `onboarding.domain-discovery.requested`
 *   via step.sendEvent for replay-safe dispatch. `runDomainDiscovery`
 *   (domain-discovery-fn.ts) owns the PENDING → DISCOVERING_DOMAINS →
 *   AWAITING_DOMAIN_CONFIRMATION transitions from there.
 *
 * Function B: runOnboardingPipeline (triggered by onboarding.review.confirmed)
 *   Drives: AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN → COMPLETED
 *   (or terminal states). Creates the ScanJob, emits scan.requested, waits
 *   for scan.completed, then advances to the terminal state. POST
 *   /entity-confirm (Task 3.2) owns the AWAITING_ENTITY_CONFIRMATION →
 *   PROCESSING_SCAN CAS; Function B observes schemas already in
 *   PROCESSING_SCAN when it picks up the event.
 *
 * Phase transitions use advanceSchemaPhase for CAS-on-phase semantics: if
 * two concurrent invocations raced, only one would advance and the loser
 * would throw NonRetriableError. Idempotent re-runs (Inngest retry landing
 * on an already-advanced row) return "skipped" from the helper and we load
 * the persisted state to continue.
 */
import { NonRetriableError } from "inngest";
import { Prisma } from "@prisma/client";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";

const SCAN_WAIT_TIMEOUT = ONBOARDING_TUNABLES.pipeline.scanWaitTimeout;

// ---------------------------------------------------------------------------
// Function A: runOnboarding — Stage 1 Trigger (issue #95)
// Triggered by: onboarding.session.started
// Exits at:     onboarding.domain-discovery.requested (fire-and-forget)
//
// The old hypothesis-first flow is gone. `runDomainDiscovery` now drives
// PENDING → DISCOVERING_DOMAINS → AWAITING_DOMAIN_CONFIRMATION; this
// function is a thin dispatcher that fails fast if the stub is malformed.
// ---------------------------------------------------------------------------

export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    name: "Onboarding — Stage 1 Trigger",
    triggers: [{ event: "onboarding.session.started" }],
    // Preserve cancel semantics from the old function — DELETE
    // /api/onboarding/:schemaId emits onboarding.session.cancelled; Inngest
    // cancels the in-flight run when data.schemaId matches.
    cancelOn: [{ event: "onboarding.session.cancelled", match: "data.schemaId" }],
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { key: "event.data.userId", limit: 3 },
    ],
    // retries bumped 0 → 2 after step-level idempotency audit 2026-04-14 (#69).
    retries: 2,
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;
    const functionStart = Date.now();

    try {
      // Load the stub + validate the domain column is populated. Task 4.4
      // writes `domain` onto the stub via createSchemaStub from
      // InterviewInput.domain. A schema without a domain cannot drive
      // Stage 1 (per-domain query + regex config both live under a domain
      // key), so fail fast instead of silently running an empty discovery.
      const schema = await step.run("load-schema", async () =>
        prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { id: true, phase: true, domain: true },
        }),
      );

      if (!schema.domain) {
        throw new NonRetriableError(
          `runOnboarding: CaseSchema ${schemaId} has no domain — stub was created without InterviewInput.domain (see Task 4.4)`,
        );
      }

      // step.sendEvent memoizes the dispatch across Inngest replays so a
      // retry after the event was accepted doesn't double-fire. Using
      // inngest.send (non-step) here would lose that guarantee.
      await step.sendEvent("emit-domain-discovery", {
        name: "onboarding.domain-discovery.requested",
        data: { schemaId, userId },
      });

      logger.info({
        service: "runOnboarding",
        operation: "runOnboarding.stage1Emitted",
        schemaId,
        domain: schema.domain,
        totalDurationMs: Date.now() - functionStart,
      });

      return { emitted: true };
    } catch (error) {
      if (error instanceof NonRetriableError) {
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
      throw error;
    }
  },
);

// ---------------------------------------------------------------------------
// Function B: runOnboardingPipeline (issue #95 Task 4.2)
// Triggered by: onboarding.review.confirmed (emitted by /entity-confirm)
// Drives:       PROCESSING_SCAN → COMPLETED (or terminal state)
//
// The `/entity-confirm` route (Task 3.2) CAS-advances AWAITING_ENTITY_CONFIRMATION
// → PROCESSING_SCAN before emitting the event, so this function observes
// schemas already in PROCESSING_SCAN. Function B's own `create-scan-job`
// step's advanceSchemaPhase call therefore guards from="AWAITING_ENTITY_CONFIRMATION"
// to respect the Bug 3 rule (one CAS owner per transition) — which is the
// phase the schema sits in when the route started its transaction.
//
// The old `expand-confirmed-domains` step (Pass 2 targeted domain expansion)
// has been removed — Stage 2 now produces confirmed entities in one shot.
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
    // retries bumped 0 → 2 after step-level idempotency audit 2026-04-14 (#69).
    retries: 2,
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;

    try {
      // ---- Step 0: Verify confirmed entities exist ----------------------
      //
      // Stage 2 + /entity-confirm already persisted the user's confirmed
      // entities via persistConfirmedEntities. This step is a thin
      // pre-scan sanity check — if no confirmed entities exist on the
      // schema, the scan has nothing to do and we fail loudly rather than
      // running an empty pipeline.
      await step.run("verify-confirmed-entities", async () => {
        const count = await prisma.entity.count({
          where: { schemaId, isActive: true, autoDetected: false },
        });
        if (count === 0) {
          throw new NonRetriableError(
            `runOnboardingPipeline: schema ${schemaId} has no confirmed entities (autoDetected=false, isActive=true)`,
          );
        }
      });

      // ---- Step 1: AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN --------
      //
      // /entity-confirm already flipped the phase. advanceSchemaPhase's
      // CAS gate will return "skipped" on its first real invocation (phase
      // is already PROCESSING_SCAN). We still enter the step to commit the
      // ScanJob row idempotently — the phase transition ownership remains
      // the route's, but scan-row creation lives here so Function B stays
      // self-sufficient for retry.
      const createdScanId = await step.run("create-scan-job", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "AWAITING_ENTITY_CONFIRMATION",
          to: "PROCESSING_SCAN",
          work: async () => {
            // Idempotency guard (#69): advanceSchemaPhase runs work() before
            // the CAS commit. If scanJob.create succeeded but the subsequent
            // CAS updateMany failed, an Inngest retry would re-enter this
            // step and create a second ONBOARDING scan. Check for an
            // existing onboarding scan first and reuse it.
            const existing = await prisma.scanJob.findFirst({
              where: { schemaId, triggeredBy: "ONBOARDING" },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            if (existing) return existing.id;
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
      // On "skipped" (Inngest retry OR the route already flipped the phase
      // before this function fired), look up the most recent onboarding scan.
      const scanJobId: string = await step.run("resolve-scan-job", async () => {
        if (createdScanId !== "skipped") return createdScanId as string;
        const existing = await prisma.scanJob.findFirst({
          where: { schemaId, triggeredBy: "ONBOARDING" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (!existing) {
          throw new NonRetriableError(
            `runOnboardingPipeline: schema ${schemaId} is past AWAITING_ENTITY_CONFIRMATION but has no onboarding ScanJob`,
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
      const reason = completion.data.reason;
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

      // Happy path: advance to COMPLETED and mark schema ACTIVE. Null out
      // the Stage 1/Stage 2 candidate JSON — these columns contained sender
      // domains + subject strings (PII) that were only needed to drive the
      // review screens. Keep `stage2ConfirmedDomains` as debugging history;
      // drop the bulky candidate payloads. Data-lifecycle obligation, not
      // optimization.
      await step.run("advance-to-completed", async () => {
        await advanceSchemaPhase({
          schemaId,
          from: "PROCESSING_SCAN",
          to: "COMPLETED",
          work: async () => {
            await prisma.caseSchema.update({
              where: { id: schemaId },
              data: {
                status: "ACTIVE",
                stage1Candidates: Prisma.DbNull,
                stage2Candidates: Prisma.DbNull,
              },
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
        await markSchemaFailed(
          schemaId,
          current?.phase ?? "AWAITING_ENTITY_CONFIRMATION",
          error,
        );
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
      await markSchemaFailed(
        schemaId,
        current?.phase ?? "AWAITING_ENTITY_CONFIRMATION",
        error,
      );
      throw error;
    }
  },
);
