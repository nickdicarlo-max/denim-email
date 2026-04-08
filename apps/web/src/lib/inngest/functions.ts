import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { applyCalibration, coarseCluster, splitCoarseClusters } from "@/lib/services/cluster";
import { processEmailBatch } from "@/lib/services/extraction";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { advanceScanPhase, markScanFailed } from "@/lib/services/onboarding-state";
import { computeScanMetrics, computeSchemaMetrics } from "@/lib/services/scan-metrics";
import { synthesizeCase } from "@/lib/services/synthesis";
import { inngest } from "./client";
import { dailyStatusDecay } from "./daily-status-decay";
import { runScan } from "./scan";

const BATCH_SIZE = 20;

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

    // CAS-advance ScanJob DISCOVERING → EXTRACTING. The work callback
    // updates status / startedAt / totalEmails / statusMessage in one write
    // before the helper atomically bumps the phase.
    await step.run("advance-to-extracting", async () => {
      await advanceScanPhase({
        scanJobId,
        from: "DISCOVERING",
        to: "EXTRACTING",
        work: async () => {
          await prisma.scanJob.update({
            where: { id: scanJobId },
            data: {
              status: "RUNNING",
              totalEmails: emailIds.length,
              startedAt: new Date(),
              statusMessage: `Extracting ${emailIds.length} emails...`,
            },
          });
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

      await step.run("record-batch-failure", async () => {
        // Whole-batch failure: processEmailBatch threw before any individual
        // email could be caught (Gmail token expired, schema load failed, etc).
        // Write a ScanFailure row for every email in the batch so
        // computeScanMetrics.failedEmails stays accurate and the pipeline
        // can't silently drop emails (#16).
        const errorMessage = error?.message ?? String(error);
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
            statusMessage: `Batch ${batchIndex + 1}/${totalBatches} failed after retries`,
          },
        });
        logger.error({
          service: "inngest",
          operation: "extractBatch.exhaustedRetries",
          schemaId,
          scanJobId,
          batchIndex,
          batchSize: emailIds.length,
          error: errorMessage,
        });
      });

      // Still emit batch.completed so checkExtractionComplete can advance;
      // without this the pipeline hangs waiting for a batch that never finishes.
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
          extractedFields: { select: { name: true, type: true, description: true, source: true } },
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

        // Emit completion event for clustering stage
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
 * Run synthesis after clustering is complete.
 * Calls Claude for each case to generate titles, summaries, tags, and actions.
 * Sequential per case to respect API rate limits.
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

    // 3. Load case IDs — query all OPEN unsynthesized cases for this schema.
    // Two-pass clustering may delete coarse cases and create split replacements,
    // so cluster.resultCaseId from pass 1 can point to deleted cases.
    const caseIds = await step.run("load-cases", async () => {
      const cases = await prisma.case.findMany({
        where: { schemaId, status: "OPEN" },
        select: { id: true },
      });

      const ids = cases.map((c) => c.id);

      logger.info({
        service: "inngest",
        operation: "runSynthesis.loadCases",
        schemaId,
        clusterCount: clusterIds.length,
        caseCount: ids.length,
      });

      return ids;
    });

    // 4. Synthesize each case sequentially
    // NOTE: counters must be derived from step.run return values, not outer variables.
    // Inngest re-initializes function scope between steps, so outer `let` variables reset to 0.
    const results: Array<{ caseId: string; status: "ok" | "failed" }> = [];

    for (const caseId of caseIds) {
      const result = await step.run(`synthesize-${caseId}`, async () => {
        try {
          await synthesizeCase(caseId, schemaId, scanJobId ?? undefined);
          return { caseId, status: "ok" as const };
        } catch (error) {
          logger.error({
            service: "inngest",
            operation: "runSynthesis.caseFailed",
            schemaId,
            caseId,
            error,
          });
          // Continue with other cases — don't let one failure stop the pipeline
          return { caseId, status: "failed" as const };
        }
      });
      results.push(result);
    }

    const synthesizedCount = results.filter((r) => r.status === "ok").length;
    const failedCount = results.filter((r) => r.status === "failed").length;

    // 5. CAS-advance SYNTHESIZING → COMPLETED with the accounting invariant
    //    check. Now that ScanFailure writes are wired up (this task, Phase 5),
    //    the accounting log should show gap=0 in the happy path.
    if (scanJobId) {
      await step.run("advance-to-completed", async () => {
        const finalMetrics = await computeScanMetrics(scanJobId);
        const accounted =
          finalMetrics.processedEmails + finalMetrics.excludedEmails + finalMetrics.failedEmails;
        if (accounted !== finalMetrics.totalEmails) {
          // Accounting invariant (#16): every discovered email must be
          // accounted for. A gap here means a pipeline stage silently
          // dropped emails — log loudly so the next eval surfaces it.
          logger.error({
            service: "inngest",
            operation: "runSynthesis.accountingMismatch",
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
                statusMessage: `Pipeline complete: ${synthesizedCount} cases synthesized${failedCount > 0 ? `, ${failedCount} failed` : ""}`,
              },
            });
          },
        });
      });
    }

    // 6. Emit scan.completed so the runOnboarding orchestrator (Task 9)
    //    can flip CaseSchema.phase to AWAITING_REVIEW / COMPLETED. Until
    //    that orchestrator lands, we ALSO keep the direct status→ACTIVE
    //    update as a dual-write so existing polling clients still work.
    if (scanJobId) {
      await step.run("emit-scan-completed", async () => {
        await inngest.send({
          name: "scan.completed",
          data: { schemaId, scanJobId, synthesizedCount, failedCount },
        });
      });
    }

    // 6b. TRANSITIONAL: flip schema from ONBOARDING to ACTIVE. This is the
    //     old pre-state-machine contract. Task 9 (runOnboarding orchestrator)
    //     will own this transition via the scan.completed event above and
    //     this block should be removed at that time.
    await step.run("activate-schema", async () => {
      await prisma.caseSchema.updateMany({
        where: { id: schemaId, status: "ONBOARDING" },
        data: { status: "ACTIVE" },
      });
    });

    // 7. Emit synthesis.case.completed events
    await step.run("emit-events", async () => {
      const events = caseIds.map((caseId) => ({
        name: "synthesis.case.completed" as const,
        data: { schemaId, caseId },
      }));

      if (events.length > 0) {
        await inngest.send(events);
      }

      logger.info({
        service: "inngest",
        operation: "synthesisComplete",
        schemaId,
        synthesizedCount,
        failedCount,
      });
    });
  },
);

export const functions = [
  runScan, // Parent workflow — consumes scan.requested, emits scan.emails.discovered
  fanOutExtraction,
  extractBatch,
  checkExtractionComplete,
  runCoarseClustering,
  runCaseSplitting,
  runSynthesis,
  runClusteringCalibration,
  resynthesizeOnFeedback,
  dailyQualitySnapshot,
  dailyStatusDecay,
];
