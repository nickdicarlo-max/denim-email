import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { processEmailBatch } from "@/lib/services/extraction";
import { coarseCluster, splitCoarseClusters, applyCalibration } from "@/lib/services/cluster";
import { synthesizeCase } from "@/lib/services/synthesis";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { inngest } from "./client";
import { dailyStatusDecay } from "./daily-status-decay";

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

    // Update ScanJob to RUNNING / EXTRACTING
    await step.run("update-scan-job", async () => {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          status: "RUNNING",
          phase: "EXTRACTING",
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

      await step.run("record-batch-failure", async () => {
        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: {
            failedEmails: { increment: emailIds.length },
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
          error: error?.message ?? String(error),
        });
      });

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
    const { schemaId, userId, scanJobId, emailIds, batchIndex, totalBatches } =
      event.data;

    const result = await step.run("process-batch", async () => {
      // Load schema with all needed relations
      const schema = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        include: {
          tags: { where: { isActive: true }, select: { name: true, description: true, isActive: true } },
          entities: { where: { isActive: true }, select: { name: true, type: true, aliases: true, isActive: true, autoDetected: true } },
          extractedFields: { select: { name: true, type: true, description: true, source: true } },
          exclusionRules: { where: { isActive: true }, select: { ruleType: true, pattern: true, isActive: true } },
          entityGroups: { orderBy: { index: "asc" }, include: { entities: { where: { isActive: true }, select: { name: true, type: true, isActive: true } } } },
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

      // Update ScanJob progress
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          processedEmails: { increment: batchResult.processed },
          excludedEmails: { increment: batchResult.excluded },
          failedEmails: { increment: batchResult.failed },
          statusMessage: `Batch ${batchIndex + 1}/${totalBatches} complete`,
        },
      });

      return batchResult;
    });

    // Emit batch completed event
    await step.run("emit-completed", async () => {
      await inngest.send({
        name: "extraction.batch.completed",
        data: {
          schemaId,
          scanJobId,
          batchIndex,
          totalBatches,
          processedCount: result.processed,
          excludedCount: result.excluded,
          failedCount: result.failed,
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
      // Read current scan job state
      const scanJob = await prisma.scanJob.findUniqueOrThrow({
        where: { id: scanJobId },
      });

      const totalProcessed =
        scanJob.processedEmails + scanJob.excludedEmails + scanJob.failedEmails;

      if (totalProcessed >= scanJob.totalEmails) {
        // Accounting invariant: every discovered email must be accounted for
        // as processed, excluded, or failed (#16). A mismatch here means a
        // pipeline stage silently dropped emails — log loudly so the next
        // eval surfaces it.
        if (totalProcessed !== scanJob.totalEmails) {
          logger.error({
            service: "inngest",
            operation: "checkExtractionComplete.accountingMismatch",
            schemaId,
            scanJobId,
            totalEmails: scanJob.totalEmails,
            processed: scanJob.processedEmails,
            excluded: scanJob.excludedEmails,
            failed: scanJob.failedEmails,
            sum: totalProcessed,
            gap: totalProcessed - scanJob.totalEmails,
          });
        }

        // All emails processed — keep EXTRACTING phase, clustering will advance it
        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: {
            statusMessage: `Extraction done: ${scanJob.processedEmails} extracted, ${scanJob.excludedEmails} excluded, ${scanJob.failedEmails} failed. Starting clustering...`,
          },
        });

        // Update tag frequencies
        const schema = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { emailCount: true },
        });

        if (schema.emailCount > 0) {
          const tags = await prisma.schemaTag.findMany({
            where: { schemaId, isActive: true },
            select: { id: true, emailCount: true },
          });

          for (const tag of tags) {
            const frequency = tag.emailCount / schema.emailCount;
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
          totalEmails: scanJob.totalEmails,
          processed: scanJob.processedEmails,
          excluded: scanJob.excludedEmails,
          failed: scanJob.failedEmails,
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

    // 1. Update phase to CLUSTERING
    await step.run("update-phase", async () => {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          phase: "CLUSTERING",
          statusMessage: "Pass 1: Coarse clustering by entity...",
        },
      });
    });

    // 2. Run coarse clustering
    const result = await step.run("coarse-cluster", async () => {
      return await coarseCluster(schemaId, scanJobId);
    });

    // 3. Update scan job counts
    await step.run("update-counts", async () => {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          clustersCreated: result.clustersCreated,
          casesCreated: result.casesCreated,
          casesMerged: result.casesMerged,
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

    // 4. Update counts
    await step.run("update-counts", async () => {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          casesCreated: { increment: splitResult.casesCreated },
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

    // 2. Update phase to SYNTHESIZING
    if (scanJobId) {
      await step.run("update-phase", async () => {
        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: {
            phase: "SYNTHESIZING",
            statusMessage: "Generating case summaries and actions...",
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

    // 5. Update scan job to COMPLETED
    if (scanJobId) {
      await step.run("complete-job", async () => {
        // Final accounting invariant (#16). At pipeline completion, every
        // discovered email should be in exactly one bucket: processed,
        // excluded, or failed. If the sum doesn't match `totalEmails`, a
        // pipeline stage silently dropped emails — log it so the next eval
        // can pinpoint the dropoff stage.
        const finalJob = await prisma.scanJob.findUniqueOrThrow({
          where: { id: scanJobId },
          select: {
            totalEmails: true,
            processedEmails: true,
            excludedEmails: true,
            failedEmails: true,
          },
        });
        const accounted =
          finalJob.processedEmails + finalJob.excludedEmails + finalJob.failedEmails;
        if (accounted !== finalJob.totalEmails) {
          logger.error({
            service: "inngest",
            operation: "runSynthesis.accountingMismatch",
            schemaId,
            scanJobId,
            totalEmails: finalJob.totalEmails,
            processed: finalJob.processedEmails,
            excluded: finalJob.excludedEmails,
            failed: finalJob.failedEmails,
            accounted,
            gap: finalJob.totalEmails - accounted,
          });
        }

        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: {
            phase: "COMPLETED",
            status: "COMPLETED",
            completedAt: new Date(),
            statusMessage: `Pipeline complete: ${synthesizedCount} cases synthesized${failedCount > 0 ? `, ${failedCount} failed` : ""}`,
          },
        });
      });
    }

    // 6. Transition schema from ONBOARDING to ACTIVE
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

export const functions = [fanOutExtraction, extractBatch, checkExtractionComplete, runCoarseClustering, runCaseSplitting, runSynthesis, runClusteringCalibration, resynthesizeOnFeedback, dailyQualitySnapshot, dailyStatusDecay];
