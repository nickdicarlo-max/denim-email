import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { processEmailBatch } from "@/lib/services/extraction";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { inngest } from "./client";

const BATCH_SIZE = 20;

/**
 * Fan out extraction: split discovered email IDs into batches
 * and emit one event per batch.
 */
export const fanOutExtraction = inngest.createFunction(
  {
    id: "fan-out-extraction",
    concurrency: {
      limit: 1,
      key: "event.data.schemaId",
    },
  },
  { event: "scan.emails.discovered" },
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
 */
export const extractBatch = inngest.createFunction(
  {
    id: "extract-batch",
    concurrency: {
      limit: 3,
      key: "event.data.schemaId",
    },
    retries: 3,
  },
  { event: "extraction.batch.process" },
  async ({ event, step }) => {
    const { schemaId, userId, scanJobId, emailIds, batchIndex, totalBatches } =
      event.data;

    const result = await step.run("process-batch", async () => {
      // Load schema with all needed relations
      const schema = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        include: {
          tags: { where: { isActive: true }, select: { name: true, description: true, isActive: true } },
          entities: { where: { isActive: true }, select: { name: true, type: true, aliases: true, isActive: true } },
          extractedFields: { select: { name: true, type: true, description: true, source: true } },
          exclusionRules: { where: { isActive: true }, select: { ruleType: true, pattern: true, isActive: true } },
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
        })),
        extractedFields: schema.extractedFields.map((f) => ({
          name: f.name,
          type: f.type,
          description: f.description,
          source: f.source,
        })),
        exclusionPatterns: schema.exclusionRules.map((r) => r.pattern),
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
    concurrency: {
      limit: 1,
      key: "event.data.schemaId",
    },
  },
  { event: "extraction.batch.completed" },
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
        // All emails processed — finalize
        await prisma.scanJob.update({
          where: { id: scanJobId },
          data: {
            phase: "COMPLETED",
            status: scanJob.failedEmails > 0 ? "COMPLETED" : "COMPLETED",
            completedAt: new Date(),
            statusMessage: `Done: ${scanJob.processedEmails} extracted, ${scanJob.excludedEmails} excluded, ${scanJob.failedEmails} failed`,
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

export const functions = [fanOutExtraction, extractBatch, checkExtractionComplete];
