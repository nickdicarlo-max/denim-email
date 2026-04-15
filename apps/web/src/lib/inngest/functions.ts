import { AuthError } from "@denim/types";
import { NonRetriableError } from "inngest";
import { matchesGmailAuthError } from "@/lib/gmail/auth-errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { applyCalibration, coarseCluster, splitCoarseClusters } from "@/lib/services/cluster";
import { processEmailBatch } from "@/lib/services/extraction";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { advanceScanPhase, markScanFailed } from "@/lib/services/onboarding-state";
import { computeScanMetrics, computeSchemaMetrics } from "@/lib/services/scan-metrics";
import { synthesizeCase } from "@/lib/services/synthesis";
import { inngest } from "./client";
import { cronDailyScans } from "./cron";
import { dailyStatusDecay } from "./daily-status-decay";
import { runOnboarding, runOnboardingPipeline } from "./onboarding";
import { drainOnboardingOutbox } from "./onboarding-outbox-drain";
import { runScan } from "./scan";

const BATCH_SIZE = 20;

/**
 * Shared onFailure handler for downstream scan-pipeline functions
 * (runCoarseClustering, runCaseSplitting, runSynthesis).
 *
 * When Inngest exhausts retries on one of these functions, we need to:
 *   1. Mark the ScanJob as FAILED with the phase where it died, so the
 *      polling response surfaces the error to the observer page.
 *   2. Emit scan.completed with reason="failed" so runOnboarding's
 *      waitForEvent unblocks immediately instead of hanging for the
 *      full 20-minute timeout.
 *
 * Without this, a crash during clustering or synthesis silently stalls
 * the pipeline: the ScanJob stays in EXTRACTING/CLUSTERING/SYNTHESIZING
 * forever, runOnboarding waits the full 20 minutes, and the user stares
 * at a spinner.
 *
 * Both writes happen inside step.run so Inngest makes them durable.
 */
type ScanPhaseAtFailure = "EXTRACTING" | "CLUSTERING" | "SYNTHESIZING";

/**
 * Minimal step shape we use inside handleDownstreamScanFailure. We only
 * call `step.run` with void-returning operations, so the return type of
 * step.run is intentionally `unknown` here — matches Inngest's runtime
 * `Jsonify<T>` serialization without forcing us to import Inngest types.
 */
type StepLike = {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
};

async function handleDownstreamScanFailure({
  step,
  schemaId,
  scanJobId,
  phase,
  error,
}: {
  step: StepLike;
  schemaId: string;
  scanJobId: string;
  phase: ScanPhaseAtFailure;
  error: { message?: string } | Error | unknown;
}): Promise<void> {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? error)
        : String(error);

  await step.run("mark-scan-failed-downstream", async () => {
    await markScanFailed(scanJobId, phase, error);
  });
  await step.run("emit-scan-failed-downstream", async () => {
    await inngest.send({
      name: "scan.completed",
      data: {
        schemaId,
        scanJobId,
        reason: "failed",
        errorMessage,
      },
    });
  });
  logger.error({
    service: "inngest",
    operation: "downstreamScanFailure",
    schemaId,
    scanJobId,
    phase,
    error: errorMessage,
  });
}

/**
 * Fan out extraction: split discovered email IDs into batches
 * and emit one event per batch.
 */
export const fanOutExtraction = inngest.createFunction(
  {
    id: "fan-out-extraction",
    triggers: [{ event: "scan.emails.discovered" }],
    concurrency: {
      limit: 1,
      key: "event.data.schemaId",
    },
  },
  async ({ event, step }) => {
    const { schemaId, userId, scanJobId, emailIds } = event.data;

    // runScan already advanced the scan phase from DISCOVERING → EXTRACTING
    // before emitting scan.emails.discovered. We just update the status
    // fields here — no CAS needed (and a CAS would race with runScan's).
    await step.run("update-extracting-status", async () => {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          status: "RUNNING",
          totalEmails: emailIds.length,
          startedAt: new Date(),
          statusMessage: `Extracting ${emailIds.length} emails...`,
        },
      });
    });

    // Split into batches and emit events
    await step.run("emit-batches", async () => {
      const batches: string[][] = [];
      for (let i = 0; i < emailIds.length; i += BATCH_SIZE) {
        batches.push(emailIds.slice(i, i + BATCH_SIZE));
      }

      const events = batches.map((batch, index) => ({
        name: "extraction.batch.process" as const,
        data: {
          schemaId,
          userId,
          scanJobId,
          emailIds: batch,
          batchIndex: index,
          totalBatches: batches.length,
        },
      }));

      await inngest.send(events);

      logger.info({
        service: "inngest",
        operation: "fanOutExtraction",
        schemaId,
        batchCount: batches.length,
        totalEmails: emailIds.length,
      });
    });
  },
);

/**
 * Process a single batch of emails through the extraction pipeline.
 *
 * If all retries are exhausted, the `onFailure` handler runs to record the
 * batch as failed (incrementing `failedEmails` by the batch size) and emit
 * the `extraction.batch.completed` event so downstream stages still advance.
 * Without this handler, a single bad batch silently dropped 20 emails from
 * the accounting and the pipeline could stall waiting for completion (#16).
 */
export const extractBatch = inngest.createFunction(
  {
    id: "extract-batch",
    triggers: [{ event: "extraction.batch.process" }],
    concurrency: {
      limit: 3,
      key: "event.data.schemaId",
    },
    retries: 3,
    onFailure: async ({ event, error, step }) => {
      // FailureEventPayload wraps the original event under data.event.
      const original = event.data.event.data as {
        schemaId: string;
        scanJobId: string;
        emailIds: string[];
        batchIndex: number;
        totalBatches: number;
      };
      const { schemaId, scanJobId, emailIds, batchIndex, totalBatches } = original;

      const errorMessage = error?.message ?? String(error);
      const authFailure =
        error instanceof AuthError ||
        matchesGmailAuthError(error instanceof Error ? error.message : String(error));

      await step.run("record-batch-failure", async () => {
        // Whole-batch failure: processEmailBatch threw before any individual
        // email could be caught (Gmail token expired, schema load failed, etc).
        // Write a ScanFailure row for every email in the batch so
        // computeScanMetrics.failedEmails stays accurate and the pipeline
        // can't silently drop emails (#16).
        const errorStack = error?.stack ?? null;
        await prisma.scanFailure.createMany({
          data: emailIds.map((gmailMessageId) => ({
            scanJobId,
            schemaId,
            gmailMessageId,
            phase: "EXTRACTING" as const,
            errorMessage,
            errorStack,
          })),
          skipDuplicates: true, // idempotent on retry (unique index)
        });
        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: {
            statusMessage: authFailure
              ? "Google connection lost — please reconnect"
              : `Batch ${batchIndex + 1}/${totalBatches} failed after retries`,
          },
        });
        logger.error({
          service: "inngest",
          operation: authFailure ? "extractBatch.authFailure" : "extractBatch.exhaustedRetries",
          schemaId,
          scanJobId,
          batchIndex,
          batchSize: emailIds.length,
          error: errorMessage,
        });
      });

      // Auth errors are fatal to the entire scan — every subsequent batch
      // will fail identically. Mark the scan as failed so the polling
      // response surfaces the error immediately, rather than waiting for
      // all batches to exhaust retries.
      if (authFailure) {
        await step.run("mark-scan-failed-auth", async () => {
          await markScanFailed(scanJobId, "EXTRACTING", error);
          // Emit scan.completed with reason="failed" so runOnboarding
          // unblocks immediately instead of waiting for the 20-min timeout.
          await inngest.send({
            name: "scan.completed",
            data: {
              schemaId,
              scanJobId,
              reason: "failed",
              errorMessage,
            },
          });
        });
        return;
      }

      // Non-auth failure: still emit batch.completed so
      // checkExtractionComplete can advance; without this the pipeline
      // hangs waiting for a batch that never finishes.
      await step.run("emit-completed-after-failure", async () => {
        await inngest.send({
          name: "extraction.batch.completed",
          data: {
            schemaId,
            scanJobId,
            batchIndex,
            totalBatches,
            processedCount: 0,
            excludedCount: 0,
            failedCount: emailIds.length,
          },
        });
      });
    },
  },
  async ({ event, step }) => {
    const { schemaId, userId, scanJobId, emailIds, batchIndex, totalBatches } = event.data;

    const result = await step.run("process-batch", async () => {
      // Wrap the entire batch in an auth-error check. If the Gmail token
      // is dead, convert to NonRetriableError so Inngest skips the 3
      // retries and jumps straight to onFailure (which marks the scan
      // as FAILED). Without this, auth errors burn through all retries
      // and every concurrent batch does the same — wasting minutes.
      try {
        return await processBatchInner();
      } catch (err) {
        if (
          err instanceof AuthError ||
          matchesGmailAuthError(err instanceof Error ? err.message : String(err))
        ) {
          throw new NonRetriableError(
            `Gmail auth failed: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }
        throw err;
      }

      async function processBatchInner() {
        // Load schema with all needed relations
        const schema = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          include: {
            tags: {
              where: { isActive: true },
              select: { name: true, description: true, isActive: true },
            },
            entities: {
              where: { isActive: true },
              select: { name: true, type: true, aliases: true, isActive: true, autoDetected: true },
            },
            extractedFields: {
              select: { name: true, type: true, description: true, source: true },
            },
            exclusionRules: {
              where: { isActive: true },
              select: { ruleType: true, pattern: true, isActive: true },
            },
            entityGroups: {
              orderBy: { index: "asc" },
              include: {
                entities: {
                  where: { isActive: true },
                  select: { name: true, type: true, isActive: true },
                },
              },
            },
          },
        });

        // Get valid Gmail token
        const accessToken = await getValidGmailToken(userId);

        // Build contexts
        const schemaContext = {
          domain: schema.domain ?? "general",
          tags: schema.tags.map((t) => ({ name: t.name, description: t.description ?? "" })),
          entities: schema.entities.map((e) => ({
            name: e.name,
            type: e.type as "PRIMARY" | "SECONDARY",
            aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
            isUserInput: !e.autoDetected,
          })),
          extractedFields: schema.extractedFields.map((f) => ({
            name: f.name,
            type: f.type,
            description: f.description,
            source: f.source,
          })),
          exclusionPatterns: schema.exclusionRules.map((r) => r.pattern),
          entityGroups: schema.entityGroups.map((g) => ({
            whats: g.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name),
            whos: g.entities.filter((e) => e.type === "SECONDARY").map((e) => e.name),
          })),
        };

        const entities = schema.entities.map((e) => ({
          name: e.name,
          type: e.type as "PRIMARY" | "SECONDARY",
          aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
        }));

        const exclusionRules = schema.exclusionRules.map((r) => ({
          ruleType: r.ruleType,
          pattern: r.pattern,
          isActive: r.isActive,
        }));

        // Process the batch
        const batchResult = await processEmailBatch(
          emailIds,
          accessToken,
          schemaContext,
          entities,
          exclusionRules,
          { schemaId, scanJobId, userId },
        );

        // processedEmails / excludedEmails / failedEmails are computed on
        // demand by computeScanMetrics from Email rows + ScanFailure rows.
        // Only the status message is updated here.
        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: {
            statusMessage: `Batch ${batchIndex + 1}/${totalBatches} complete`,
          },
        });

        return batchResult;
      } // end processBatchInner
    });

    // Emit batch completed event. failedCount is derived (batch size minus
    // the two tallied buckets) since processEmailBatch no longer returns
    // a `failed` field — per-email failures are ScanFailure rows.
    await step.run("emit-completed", async () => {
      const failedCount = emailIds.length - result.processed - result.excluded;
      await inngest.send({
        name: "extraction.batch.completed",
        data: {
          schemaId,
          scanJobId,
          batchIndex,
          totalBatches,
          processedCount: result.processed,
          excludedCount: result.excluded,
          failedCount,
        },
      });
    });
  },
);

/**
 * Check if all batches are complete. If so, finalize the scan job
 * and emit extraction.all.completed.
 */
export const checkExtractionComplete = inngest.createFunction(
  {
    id: "check-extraction-complete",
    triggers: [{ event: "extraction.batch.completed" }],
    concurrency: {
      limit: 1,
      key: "event.data.schemaId",
    },
  },
  async ({ event, step }) => {
    const { schemaId, scanJobId, totalBatches } = event.data;

    await step.run("check-completion", async () => {
      // Counters are now computed on demand from Email + ScanFailure +
      // ExtractionCost rows via computeScanMetrics.
      const metrics = await computeScanMetrics(scanJobId);

      const totalProcessed =
        metrics.processedEmails + metrics.excludedEmails + metrics.failedEmails;

      if (totalProcessed >= metrics.totalEmails) {
        // Accounting invariant: every discovered email must be accounted for
        // as processed, excluded, or failed (#16). A mismatch here means a
        // pipeline stage silently dropped emails — log loudly so the next
        // eval surfaces it.
        //
        // NOTE: until Phase 5 adds ScanFailure writes, failedEmails will
        // read 0 and this invariant may report gaps during Phase 1.
        if (totalProcessed !== metrics.totalEmails) {
          logger.error({
            service: "inngest",
            operation: "checkExtractionComplete.accountingMismatch",
            schemaId,
            scanJobId,
            totalEmails: metrics.totalEmails,
            processed: metrics.processedEmails,
            excluded: metrics.excludedEmails,
            failed: metrics.failedEmails,
            sum: totalProcessed,
            gap: totalProcessed - metrics.totalEmails,
          });
        }

        // All emails processed — keep EXTRACTING phase, clustering will advance it
        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: {
            statusMessage: `Extraction done: ${metrics.processedEmails} extracted, ${metrics.excludedEmails} excluded, ${metrics.failedEmails} failed. Starting clustering...`,
          },
        });

        // Update tag frequencies — schema email count is now computed on demand.
        const schemaMetrics = await computeSchemaMetrics(schemaId);

        if (schemaMetrics.emailCount > 0) {
          const tags = await prisma.schemaTag.findMany({
            where: { schemaId, isActive: true },
            select: { id: true, emailCount: true },
          });

          for (const tag of tags) {
            const frequency = tag.emailCount / schemaMetrics.emailCount;
            await prisma.schemaTag.update({
              where: { id: tag.id },
              data: {
                frequency,
                isWeak: frequency > 0.3, // frequencyThreshold default
              },
            });
          }
        }

        // CAS guard: only emit extraction.all.completed once, even if
        // multiple checkExtractionComplete invocations race. Per lessons
        // learned (Bug 3): each transition must have exactly one owner.
        const marked = await prisma.scanJob.updateMany({
          where: { id: scanJobId, extractionCompleteEmitted: false },
          data: { extractionCompleteEmitted: true },
        });

        if (marked.count === 1) {
          await inngest.send({
            name: "extraction.all.completed",
            data: { schemaId, scanJobId },
          });

          logger.info({
            service: "inngest",
            operation: "extractionComplete",
            schemaId,
            totalEmails: metrics.totalEmails,
            processed: metrics.processedEmails,
            excluded: metrics.excludedEmails,
            failed: metrics.failedEmails,
          });
        } else {
          logger.info({
            service: "inngest",
            operation: "extractionComplete.alreadyEmitted",
            schemaId,
            scanJobId,
          });
        }
      }
    });
  },
);

/**
 * Pass 1: Run coarse clustering after all extraction is complete.
 * Simplified gravity model — deterministic, no AI calls.
 */
export const runCoarseClustering = inngest.createFunction(
  {
    id: "run-coarse-clustering",
    triggers: [{ event: "extraction.all.completed" }],
    concurrency: {
      limit: 1,
      key: "event.data.schemaId",
    },
    retries: 2,
    onFailure: async ({ event, error, step }) => {
      const original = event.data.event.data as { schemaId: string; scanJobId: string };
      await handleDownstreamScanFailure({
        step,
        schemaId: original.schemaId,
        scanJobId: original.scanJobId,
        phase: "EXTRACTING",
        error,
      });
    },
  },
  async ({ event, step }) => {
    const { schemaId, scanJobId } = event.data;

    // 1. CAS-advance EXTRACTING → CLUSTERING and run the clustering pass
    //    inside the work callback so the phase can't be observed half-advanced.
    const result = await step.run("advance-and-coarse-cluster", async () => {
      const res = await advanceScanPhase({
        scanJobId,
        from: "EXTRACTING",
        to: "CLUSTERING",
        work: async () => {
          await prisma.scanJob.update({
            where: { id: scanJobId },
            data: { statusMessage: "Pass 1: Coarse clustering by entity..." },
          });
          return await coarseCluster(schemaId, scanJobId);
        },
      });
      if (res === "skipped") {
        // Non-Inngest re-entry on an already-advanced scan. We have no
        // fresh result to propagate, so fail loudly rather than hang.
        throw new Error(
          `runCoarseClustering: scan ${scanJobId} was already past EXTRACTING — unexpected re-entry`,
        );
      }
      return res;
    });

    // 3. Update scan job status message only — clustersCreated / casesCreated
    //    / casesMerged counters are now computed on demand from Case rows.
    await step.run("update-counts", async () => {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          statusMessage: `Coarse clustering done: ${result.casesCreated} clusters created, ${result.casesMerged} merged. Starting case splitting...`,
        },
      });
    });

    // 4. Emit coarse.clustering.completed → triggers case splitting
    await step.run("emit-completed", async () => {
      await inngest.send({
        name: "coarse.clustering.completed",
        data: {
          schemaId,
          scanJobId,
          coarseClusterIds: result.clusterIds,
        },
      });

      logger.info({
        service: "inngest",
        operation: "coarseClusteringComplete",
        schemaId,
        casesCreated: result.casesCreated,
        casesMerged: result.casesMerged,
      });
    });
  },
);

/**
 * Pass 2: Split coarse clusters into specific cases using frequency analysis + AI.
 * In STABLE phase, uses deterministic word matching (no AI calls).
 */
export const runCaseSplitting = inngest.createFunction(
  {
    id: "run-case-splitting",
    triggers: [{ event: "coarse.clustering.completed" }],
    concurrency: {
      limit: 1,
      key: "event.data.schemaId",
    },
    retries: 2,
    onFailure: async ({ event, error, step }) => {
      const original = event.data.event.data as { schemaId: string; scanJobId: string };
      await handleDownstreamScanFailure({
        step,
        schemaId: original.schemaId,
        scanJobId: original.scanJobId,
        phase: "CLUSTERING",
        error,
      });
    },
  },
  async ({ event, step }) => {
    const { schemaId, scanJobId, coarseClusterIds } = event.data;

    // 1. Update status
    await step.run("update-phase", async () => {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          statusMessage: "Pass 2: Splitting cases by topic...",
        },
      });
    });

    // 2. Run case splitting
    const splitResult = await step.run("split-clusters", async () => {
      return await splitCoarseClusters(schemaId, scanJobId);
    });

    // 3. Combine cluster IDs from both passes
    const allClusterIds = [...coarseClusterIds, ...splitResult.clusterIds];

    // 4. Update status message only — casesCreated is computed on demand.
    await step.run("update-counts", async () => {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          statusMessage: `Case splitting done: ${splitResult.casesCreated} cases split`,
        },
      });
    });

    // 5. Emit clustering.completed → triggers synthesis (unchanged event)
    await step.run("emit-completed", async () => {
      await inngest.send({
        name: "clustering.completed",
        data: {
          schemaId,
          clusterIds: allClusterIds,
        },
      });

      logger.info({
        service: "inngest",
        operation: "caseSplittingComplete",
        schemaId,
        splitCasesCreated: splitResult.casesCreated,
        totalClusterIds: allClusterIds.length,
      });
    });
  },
);

/**
 * Run calibration after synthesis completes.
 * Reads user corrections, calls Claude to adjust params + vocabulary.
 * Only runs in CALIBRATING or TRACKING phases.
 */
export const runClusteringCalibration = inngest.createFunction(
  {
    id: "run-clustering-calibration",
    triggers: [{ event: "synthesis.case.completed" }],
    concurrency: {
      limit: 1,
      key: "event.data.schemaId",
    },
    retries: 1,
  },
  async ({ event, step }) => {
    const { schemaId } = event.data;

    // Only calibrate once per pipeline run (debounce by checking if we already calibrated recently)
    const shouldCalibrate = await step.run("check-should-calibrate", async () => {
      const schema = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { qualityPhase: true },
      });

      // Skip if STABLE
      if (schema.qualityPhase === "STABLE") return false;

      // Check if we already calibrated in the last 5 minutes (debounce)
      const recentCalibration = await prisma.pipelineIntelligence.findFirst({
        where: {
          schemaId,
          stage: "clustering-calibration",
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        select: { id: true },
      });

      return recentCalibration === null;
    });

    if (!shouldCalibrate) return;

    await step.run("calibrate", async () => {
      await applyCalibration(schemaId);
    });
  },
);

/**
 * Re-synthesize a case after user feedback (email move, merge, etc.).
 * Triggered by feedback.case.modified events from FeedbackService.
 */
export const resynthesizeOnFeedback = inngest.createFunction(
  {
    id: "resynthesize-on-feedback",
    triggers: [{ event: "feedback.case.modified" }],
    concurrency: {
      limit: 2,
      key: "event.data.schemaId",
    },
    retries: 2,
  },
  async ({ event, step }) => {
    const { schemaId, caseId } = event.data;

    // Verify the case still exists and has emails
    const caseExists = await step.run("verify-case", async () => {
      const c = await prisma.case.findFirst({
        where: { id: caseId, schemaId },
        select: { id: true, _count: { select: { caseEmails: true } } },
      });
      return c && c._count.caseEmails > 0;
    });

    if (!caseExists) return;

    await step.run("resynthesize", async () => {
      await synthesizeCase(caseId, schemaId);
    });
  },
);

/**
 * Daily quality snapshot computation for all ACTIVE schemas.
 * Computes accuracy, detects regressions, updates phase transitions.
 */
export const dailyQualitySnapshot = inngest.createFunction(
  {
    id: "daily-quality-snapshot",
    triggers: [{ cron: "0 0 * * *" }], // midnight daily
    retries: 1,
  },
  async ({ step }) => {
    const schemas = await step.run("load-schemas", async () => {
      return prisma.caseSchema.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      });
    });

    for (const schema of schemas) {
      await step.run(`snapshot-${schema.id}`, async () => {
        const { computeSnapshot } = await import("@/lib/services/quality");
        await computeSnapshot(schema.id, new Date());
      });
    }
  },
);

/**
 * Fan-out synthesis: for each OPEN unsynthesized case, emit one
 * synthesis.case.requested event. The synthesizeCaseWorker picks them
 * up with concurrency=4 per schema. Scan-level completion (phase advance
 * + scan.completed emit + lastScannedAt stamp) is owned by
 * checkSynthesisComplete, which fires on every per-case completion and
 * only acts once the pending count hits zero.
 *
 * #78: replaces the previous serial in-function loop. Same responsibilities
 * for CAS-advancing CLUSTERING → SYNTHESIZING and the empty-cases short-
 * circuit remain here so the pipeline still terminates cleanly when
 * clustering produced zero cases.
 */
export const runSynthesis = inngest.createFunction(
  {
    id: "run-synthesis",
    triggers: [{ event: "clustering.completed" }],
    concurrency: {
      limit: 2,
      key: "event.data.schemaId",
    },
    retries: 2,
    onFailure: async ({ event, error, step }) => {
      const original = event.data.event.data as { schemaId: string };
      // Unlike clustering events, clustering.completed doesn't carry scanJobId
      // directly -- runSynthesis looks it up via findFirst. Resolve it the
      // same way here so the failure signal references the right scan job.
      const scanJobId = await step.run("resolve-scan-job-on-failure", async () => {
        const scanJob = await prisma.scanJob.findFirst({
          where: { schemaId: original.schemaId, status: "RUNNING" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        return scanJob?.id ?? null;
      });
      if (!scanJobId) return;
      await handleDownstreamScanFailure({
        step,
        schemaId: original.schemaId,
        scanJobId,
        phase: "SYNTHESIZING",
        error,
      });
    },
  },
  async ({ event, step }) => {
    const { schemaId, clusterIds } = event.data;

    // 1. Find the active scan job for this schema to update phase
    const scanJobId = await step.run("find-scan-job", async () => {
      const scanJob = await prisma.scanJob.findFirst({
        where: { schemaId, status: "RUNNING" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      return scanJob?.id ?? null;
    });

    // 2. CAS-advance CLUSTERING → SYNTHESIZING.
    if (scanJobId) {
      await step.run("advance-to-synthesizing", async () => {
        await advanceScanPhase({
          scanJobId,
          from: "CLUSTERING",
          to: "SYNTHESIZING",
          work: async () => {
            await prisma.scanJob.update({
              where: { id: scanJobId },
              data: { statusMessage: "Generating case summaries and actions..." },
            });
          },
        });
      });
    }

    // 3. Load OPEN unsynthesized case IDs for this schema. The `synthesizedAt`
    //    guard makes this safe on Inngest replay — a worker that already
    //    finished won't be re-enqueued.
    const caseIds = await step.run("load-cases", async () => {
      const cases = await prisma.case.findMany({
        where: { schemaId, status: "OPEN", synthesizedAt: null },
        select: { id: true },
      });

      const ids = cases.map((c) => c.id);

      // Set synthesis denominator for observer "N of M" live counter (#82).
      // runSynthesis is the sole writer of totalCasesToSynthesize; synthesizedCases
      // is owned by synthesizeCaseWorker (single-writer per column).
      if (scanJobId) {
        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: { totalCasesToSynthesize: ids.length },
        });
      }

      logger.info({
        service: "inngest",
        operation: "runSynthesis.loadCases",
        schemaId,
        clusterCount: clusterIds.length,
        caseCount: ids.length,
      });

      return ids;
    });

    // 4a. Empty-cases short-circuit: clustering produced nothing to synthesize.
    //     Skip fan-out and finalize the scan here so the pipeline doesn't
    //     hang waiting for a completion-check that will never fire.
    if (caseIds.length === 0) {
      if (!scanJobId) return;

      await step.run("advance-to-completed-empty", async () => {
        await advanceScanPhase({
          scanJobId,
          from: "SYNTHESIZING",
          to: "COMPLETED",
          work: async () => {
            await prisma.scanJob.update({
              where: { id: scanJobId },
              data: {
                status: "COMPLETED",
                completedAt: new Date(),
                statusMessage: "Pipeline complete: 0 cases synthesized",
              },
            });
          },
        });
      });

      await step.run("stamp-last-scanned-at-empty", async () => {
        await prisma.caseSchema.update({
          where: { id: schemaId },
          data: { lastScannedAt: new Date() },
        });
      });

      await step.run("emit-scan-completed-empty", async () => {
        await inngest.send({
          name: "scan.completed",
          data: { schemaId, scanJobId, synthesizedCount: 0, failedCount: 0 },
        });
      });

      return;
    }

    // 4b. Fan out one synthesis.case.requested per case. synthesizeCaseWorker
    //     picks these up with concurrency=4/schemaId. scanJobId is non-null
    //     here because the empty-cases branch above already returned.
    await step.run("fan-out-synthesis", async () => {
      const resolvedScanJobId = scanJobId as string;
      const events = caseIds.map((caseId) => ({
        name: "synthesis.case.requested" as const,
        data: { schemaId, caseId, scanJobId: resolvedScanJobId },
      }));
      await inngest.send(events);

      logger.info({
        service: "inngest",
        operation: "runSynthesis.fanOut",
        schemaId,
        scanJobId,
        caseCount: caseIds.length,
      });
    });
  },
);

/**
 * Per-case synthesis worker (#78). Consumes synthesis.case.requested
 * events fanned out by runSynthesis. Concurrency capped at 4 per schema
 * to respect Claude rate limits while still parallelizing within a scan.
 *
 * Failure contract: synthesizeCase already persists failure markers
 * internally (see #65). We emit synthesis.case.completed with status
 * "failed" and DO NOT rethrow — rethrowing would make Inngest retry the
 * whole event (3×), wasting tokens on a case that already recorded its
 * failure. The completion-check still advances the pipeline.
 */
export const synthesizeCaseWorker = inngest.createFunction(
  {
    id: "synthesize-case-worker",
    triggers: [{ event: "synthesis.case.requested" }],
    concurrency: {
      limit: 4,
      key: "event.data.schemaId",
    },
    retries: 2,
  },
  async ({ event, step }) => {
    const { schemaId, caseId, scanJobId } = event.data;

    const result = await step.run("synthesize", async () => {
      try {
        await synthesizeCase(caseId, schemaId, scanJobId);
        // Increment synthesized-case counter for observer "N of M" (#82).
        // Only on success — UI shows completed cases, not attempted. This
        // worker is the sole writer of synthesizedCases (single-writer).
        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: { synthesizedCases: { increment: 1 } },
        });
        return { status: "ok" as const };
      } catch (error) {
        logger.error({
          service: "inngest",
          operation: "synthesizeCaseWorker.caseFailed",
          schemaId,
          scanJobId,
          caseId,
          error,
        });
        return {
          status: "failed" as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    await step.sendEvent("emit-completed", {
      name: "synthesis.case.completed",
      data:
        result.status === "ok"
          ? { schemaId, caseId, scanJobId, status: "ok" }
          : { schemaId, caseId, scanJobId, status: "failed", error: result.error },
    });
  },
);

/**
 * Completion-check for synthesis fan-out (#78). Fires on every
 * synthesis.case.completed event — counts pending OPEN cases without a
 * synthesizedAt stamp. Only the last in-flight case finds pending=0 and
 * performs scan-level finalization (CAS-advance SYNTHESIZING → COMPLETED,
 * stamp CaseSchema.lastScannedAt, emit scan.completed).
 *
 * Idempotency: advanceScanPhase returns "skipped" on CAS loss, so
 * concurrent completion events race safely. scan.completed is idempotent
 * on the consumer side (runOnboarding / scan observer) so double-emits
 * from a race on pending=0 are harmless.
 *
 * Legacy emitters of synthesis.case.completed (scanJobId omitted) are
 * ignored — without a scanJobId we can't finalize the scan, and those
 * code paths (none currently, but defensively) don't need to.
 */
export const checkSynthesisComplete = inngest.createFunction(
  {
    id: "check-synthesis-complete",
    triggers: [{ event: "synthesis.case.completed" }],
    concurrency: {
      limit: 1,
      key: "event.data.schemaId",
    },
    retries: 2,
  },
  async ({ event, step }) => {
    const { schemaId, scanJobId } = event.data;
    if (!scanJobId) return;

    const pending = await step.run("count-pending", async () => {
      return prisma.case.count({
        where: { schemaId, status: "OPEN", synthesizedAt: null },
      });
    });

    if (pending > 0) {
      return { pending };
    }

    // All cases done. Finalize the scan (accounting check, phase advance,
    // lastScannedAt watermark, scan.completed emit). All steps are
    // idempotent so concurrent "I'm last" races don't double-finalize.
    const finalized = await step.run("advance-to-completed", async () => {
      const finalMetrics = await computeScanMetrics(scanJobId);
      const accounted =
        finalMetrics.processedEmails + finalMetrics.excludedEmails + finalMetrics.failedEmails;
      if (accounted !== finalMetrics.totalEmails) {
        // Accounting invariant (#16).
        logger.error({
          service: "inngest",
          operation: "checkSynthesisComplete.accountingMismatch",
          schemaId,
          scanJobId,
          totalEmails: finalMetrics.totalEmails,
          processed: finalMetrics.processedEmails,
          excluded: finalMetrics.excludedEmails,
          failed: finalMetrics.failedEmails,
          accounted,
          gap: finalMetrics.totalEmails - accounted,
        });
      }

      // Counters for the terminal status message. Derived from Case rows
      // rather than the old in-function accumulator.
      const totalCases = await prisma.case.count({
        where: { schemaId, status: "OPEN" },
      });
      const synthesizedCount = await prisma.case.count({
        where: { schemaId, status: "OPEN", synthesizedAt: { not: null } },
      });
      const failedCount = totalCases - synthesizedCount;

      const res = await advanceScanPhase({
        scanJobId,
        from: "SYNTHESIZING",
        to: "COMPLETED",
        work: async () => {
          await prisma.scanJob.update({
            where: { id: scanJobId },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
              statusMessage: `Pipeline complete: ${synthesizedCount} cases synthesized${failedCount > 0 ? `, ${failedCount} failed` : ""}`,
            },
          });
        },
      });

      return {
        advanced: res !== "skipped",
        synthesizedCount,
        failedCount,
      };
    });

    // "skipped" means another completion-check invocation already
    // finalized this scan — we're a late-arriving duplicate. Stop here
    // so we don't re-emit scan.completed or re-stamp lastScannedAt.
    if (!finalized.advanced) {
      return { alreadyFinalized: true };
    }

    await step.run("stamp-last-scanned-at", async () => {
      await prisma.caseSchema.update({
        where: { id: schemaId },
        data: { lastScannedAt: new Date() },
      });
    });

    await step.run("emit-scan-completed", async () => {
      await inngest.send({
        name: "scan.completed",
        data: {
          schemaId,
          scanJobId,
          synthesizedCount: finalized.synthesizedCount,
          failedCount: finalized.failedCount,
        },
      });

      logger.info({
        service: "inngest",
        operation: "synthesisComplete",
        schemaId,
        scanJobId,
        synthesizedCount: finalized.synthesizedCount,
        failedCount: finalized.failedCount,
      });
    });
  },
);

export const functions = [
  runOnboarding, // Function A — consumes onboarding.session.started, advances to AWAITING_REVIEW
  runOnboardingPipeline, // Function B — consumes onboarding.review.confirmed, drives pipeline to COMPLETED
  runScan, // Parent workflow — consumes scan.requested, emits scan.emails.discovered
  fanOutExtraction,
  extractBatch,
  checkExtractionComplete,
  runCoarseClustering,
  runCaseSplitting,
  runSynthesis,
  synthesizeCaseWorker, // #78 — per-case synthesis worker (fan-out)
  checkSynthesisComplete, // #78 — scan-level finalizer after all cases synthesized
  runClusteringCalibration,
  resynthesizeOnFeedback,
  dailyQualitySnapshot,
  dailyStatusDecay,
  cronDailyScans, // Task 17 — periodic re-scan emitter (event-triggered for v1)
  drainOnboardingOutbox, // #33 — transactional outbox drain for POST /api/onboarding/start
];
