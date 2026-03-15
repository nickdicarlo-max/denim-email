/**
 * ClusterService — runs the gravity model on unclustered emails
 * and creates/merges Case records.
 *
 * Write owner for: Cluster, CaseEmail
 * Also creates: Case shells (title from first subject, status OPEN)
 * Also updates: Case denormalized fields (lastEmailDate, lastSenderName), CaseSchema.caseCount
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { clusterEmails, computeAnchorTags } from "@denim/engine";
import type {
  ClusterCaseInput,
  ClusterEmailInput,
  ClusteringConfig,
  TagFrequencyMap,
} from "@denim/types";

interface ClusterResult {
  clusterIds: string[];
  casesCreated: number;
  casesMerged: number;
  clustersCreated: number;
}

/**
 * Cluster unclustered emails for a schema.
 * Loads schema config, unclustered emails, existing cases, runs gravity model,
 * writes results atomically.
 */
export async function clusterNewEmails(
  schemaId: string,
  scanJobId?: string,
): Promise<ClusterResult> {
  const startTime = Date.now();

  // 0. Clean up orphaned cases from failed prior clustering attempts.
  // Supabase pgbouncer can partially commit transactions that Prisma times out,
  // leaving Case rows with no CaseEmail children.
  const orphanedCases = await prisma.case.findMany({
    where: {
      schemaId,
      caseEmails: { none: {} },
    },
    select: { id: true },
  });

  if (orphanedCases.length > 0) {
    await prisma.case.deleteMany({
      where: { id: { in: orphanedCases.map((c) => c.id) } },
    });
    // Also clean up any cluster records pointing to deleted cases
    await prisma.cluster.deleteMany({
      where: {
        schemaId,
        resultCaseId: { in: orphanedCases.map((c) => c.id) },
      },
    });
    logger.info({
      service: "cluster",
      operation: "clusterNewEmails.cleanup",
      schemaId,
      orphanedCasesDeleted: orphanedCases.length,
    });
  }

  // 1. Load schema with clusteringConfig
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: schemaId },
    select: {
      id: true,
      clusteringConfig: true,
      entities: {
        where: { type: "PRIMARY", isActive: true },
        select: { id: true },
      },
    },
  });

  const config = schema.clusteringConfig as unknown as ClusteringConfig;

  // 2. Load tag frequencies → TagFrequencyMap
  const schemaTags = await prisma.schemaTag.findMany({
    where: { schemaId, isActive: true },
    select: { name: true, frequency: true, isWeak: true },
  });

  const tagFrequencies: TagFrequencyMap = {};
  for (const tag of schemaTags) {
    tagFrequencies[tag.name] = { frequency: tag.frequency, isWeak: tag.isWeak };
  }

  // 3. Load unclustered emails (not excluded, no CaseEmail record)
  const unclusteredEmails = await prisma.email.findMany({
    where: {
      schemaId,
      isExcluded: false,
      caseEmails: { none: {} },
    },
    select: {
      id: true,
      threadId: true,
      subject: true,
      tags: true,
      date: true,
      senderEntityId: true,
      entityId: true,
      senderDisplayName: true,
      senderEmail: true,
    },
    orderBy: { date: "asc" },
  });

  if (unclusteredEmails.length === 0) {
    logger.info({
      service: "cluster",
      operation: "clusterNewEmails",
      schemaId,
      message: "No unclustered emails found",
    });
    return { clusterIds: [], casesCreated: 0, casesMerged: 0, clustersCreated: 0 };
  }

  // 4. Transform Prisma rows → ClusterEmailInput[]
  const emailInputs: ClusterEmailInput[] = unclusteredEmails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    subject: e.subject,
    tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
    date: e.date,
    senderEntityId: e.senderEntityId,
    entityId: e.entityId,
  }));

  // 5. Load existing Cases with their emails → ClusterCaseInput[]
  const existingCases = await prisma.case.findMany({
    where: { schemaId, status: "OPEN" },
    select: {
      id: true,
      entityId: true,
      anchorTags: true,
      allTags: true,
      title: true,
      lastEmailDate: true,
      caseEmails: {
        select: {
          email: {
            select: {
              threadId: true,
              senderEntityId: true,
            },
          },
        },
      },
    },
  });

  const caseInputs: ClusterCaseInput[] = existingCases.map((c) => ({
    id: c.id,
    entityId: c.entityId,
    threadIds: [...new Set(c.caseEmails.map((ce) => ce.email.threadId))],
    anchorTags: Array.isArray(c.anchorTags) ? (c.anchorTags as string[]) : [],
    senderEntityIds: [
      ...new Set(
        c.caseEmails
          .map((ce) => ce.email.senderEntityId)
          .filter((id): id is string => id !== null),
      ),
    ],
    // Case.title is set from the first email's subject — use it for subject scoring
    subject: c.title,
    emailCount: c.caseEmails.length,
    lastEmailDate: c.lastEmailDate ?? new Date(0),
  }));

  // 6. Run gravity model
  const now = new Date();
  const decisions = clusterEmails(emailInputs, caseInputs, tagFrequencies, config, now);

  // 7. Write results in a transaction
  const clusterIds: string[] = [];
  let casesCreated = 0;
  let casesMerged = 0;

  // Build a lookup for email display names (for lastSenderName)
  const emailLookup = new Map(
    unclusteredEmails.map((e) => [e.id, e]),
  );

  // Resolve the default entity for cases that need one
  const defaultEntityId = schema.entities[0]?.id ?? null;

  await prisma.$transaction(async (tx) => {
    for (const decision of decisions) {
      if (decision.action === "CREATE") {
        // Resolve entity: from decision, or fallback to default
        const entityId = decision.entityId ?? defaultEntityId;
        if (!entityId) {
          logger.warn({
            service: "cluster",
            operation: "clusterNewEmails.noEntity",
            schemaId,
            emailIds: decision.emailIds,
          });
          continue;
        }

        // Get the first email for title/subject
        const firstEmail = emailLookup.get(decision.emailIds[0]);
        const lastEmail = decision.emailIds.length > 1
          ? emailLookup.get(decision.emailIds[decision.emailIds.length - 1])
          : firstEmail;

        const allTags = [
          ...new Set(
            decision.emailIds.flatMap((id) => {
              const e = emailLookup.get(id);
              return e ? (Array.isArray(e.tags) ? (e.tags as string[]) : []) : [];
            }),
          ),
        ];

        const anchorTags = computeAnchorTags(
          decision.emailIds.flatMap((id) => {
            const e = emailLookup.get(id);
            return e ? (Array.isArray(e.tags) ? (e.tags as string[]) : []) : [];
          }),
          config.anchorTagLimit,
        );

        // Create Case shell
        const newCase = await tx.case.create({
          data: {
            schemaId,
            entityId,
            title: firstEmail?.subject ?? "Untitled Case",
            summary: { beginning: "", middle: "", end: "" },
            status: "OPEN",
            anchorTags,
            allTags,
            displayTags: [],
            startDate: firstEmail?.date,
            lastEmailDate: lastEmail?.date,
            lastSenderName: lastEmail?.senderDisplayName,
          },
        });

        // Create CaseEmail junction records
        for (const emailId of decision.emailIds) {
          await tx.caseEmail.upsert({
            where: { emailId },
            create: {
              caseId: newCase.id,
              emailId,
              assignedBy: "CLUSTERING",
              clusteringScore: decision.score > 0 ? decision.score : null,
            },
            update: {
              caseId: newCase.id,
              assignedBy: "CLUSTERING",
              clusteringScore: decision.score > 0 ? decision.score : null,
            },
          });
        }

        // Create Cluster audit record
        const cluster = await tx.cluster.create({
          data: {
            schemaId,
            action: "CREATE",
            targetCaseId: null,
            emailIds: decision.emailIds,
            threadIds: decision.threadIds,
            score: decision.score > 0 ? decision.score : null,
            primaryTag: decision.primaryTag,
            scoreBreakdown: decision.breakdown as any,
            status: "COMPLETED",
            resultCaseId: newCase.id,
            scanJobId,
          },
        });

        clusterIds.push(cluster.id);
        casesCreated++;
      } else {
        // MERGE into existing case
        const targetCaseId = decision.targetCaseId!;

        // Verify target case still exists (may have been lost in a failed prior transaction)
        const targetExists = await tx.case.findUnique({
          where: { id: targetCaseId },
          select: { id: true },
        });
        if (!targetExists) {
          logger.warn({
            service: "cluster",
            operation: "clusterNewEmails.mergeSkipped",
            schemaId,
            targetCaseId,
            reason: "Target case not found, skipping merge",
          });
          continue;
        }

        // Create CaseEmail junction records
        for (const emailId of decision.emailIds) {
          await tx.caseEmail.upsert({
            where: { emailId },
            create: {
              caseId: targetCaseId,
              emailId,
              assignedBy: "CLUSTERING",
              clusteringScore: decision.score,
            },
            update: {
              caseId: targetCaseId,
              assignedBy: "CLUSTERING",
              clusteringScore: decision.score,
            },
          });
        }

        // Update Case denormalized fields
        const lastEmailId = decision.emailIds[decision.emailIds.length - 1];
        const lastEmail = emailLookup.get(lastEmailId);

        const newAllTags = [
          ...new Set(
            decision.emailIds.flatMap((id) => {
              const e = emailLookup.get(id);
              return e ? (Array.isArray(e.tags) ? (e.tags as string[]) : []) : [];
            }),
          ),
        ];

        // Get current case for merging tags
        const currentCase = await tx.case.findUnique({
          where: { id: targetCaseId },
          select: { allTags: true, anchorTags: true },
        });

        const mergedAllTags = [
          ...new Set([
            ...(Array.isArray(currentCase?.allTags)
              ? (currentCase.allTags as string[])
              : []),
            ...newAllTags,
          ]),
        ];

        const mergedAnchorTagSource = [
          ...(Array.isArray(currentCase?.anchorTags)
            ? (currentCase.anchorTags as string[])
            : []),
          ...decision.emailIds.flatMap((id) => {
            const e = emailLookup.get(id);
            return e ? (Array.isArray(e.tags) ? (e.tags as string[]) : []) : [];
          }),
        ];

        await tx.case.update({
          where: { id: targetCaseId },
          data: {
            lastEmailDate: lastEmail?.date,
            lastSenderName: lastEmail?.senderDisplayName,
            allTags: mergedAllTags,
            anchorTags: computeAnchorTags(mergedAnchorTagSource, config.anchorTagLimit),
          },
        });

        // Create Cluster audit record
        const cluster = await tx.cluster.create({
          data: {
            schemaId,
            action: "MERGE",
            targetCaseId,
            emailIds: decision.emailIds,
            threadIds: decision.threadIds,
            score: decision.score,
            primaryTag: decision.primaryTag,
            scoreBreakdown: decision.breakdown as any,
            status: "COMPLETED",
            resultCaseId: targetCaseId,
            scanJobId,
          },
        });

        clusterIds.push(cluster.id);
        casesMerged++;
      }
    }

    // Update CaseSchema.caseCount
    const totalCases = await tx.case.count({ where: { schemaId } });
    await tx.caseSchema.update({
      where: { id: schemaId },
      data: { caseCount: totalCases },
    });
  }, { timeout: 30000 });

  const durationMs = Date.now() - startTime;
  logger.info({
    service: "cluster",
    operation: "clusterNewEmails",
    schemaId,
    durationMs,
    emailCount: unclusteredEmails.length,
    casesCreated,
    casesMerged,
    clustersCreated: clusterIds.length,
  });

  return {
    clusterIds,
    casesCreated,
    casesMerged,
    clustersCreated: clusterIds.length,
  };
}
