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
import { callClaude } from "@/lib/ai/client";
import { clusterEmails, computeAnchorTags } from "@denim/engine";
import {
  buildClusteringIntelligencePrompt,
  parseClusteringIntelligenceResponse,
} from "@denim/ai";
import type { ClusteringIntelligenceResult } from "@denim/ai";
import type {
  ClusterCaseInput,
  ClusterEmailInput,
  ClusteringConfig,
  TagFrequencyMap,
  EntityGroupInput,
} from "@denim/types";

// Claude Sonnet pricing (per 1M tokens): $3 input, $15 output
const CLAUDE_INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const CLAUDE_OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;

interface ClusterResult {
  clusterIds: string[];
  casesCreated: number;
  casesMerged: number;
  clustersCreated: number;
}

/**
 * Call Claude for clustering intelligence: AI-suggested email groupings
 * and gravity model parameter overrides. Falls back to null on failure.
 */
export async function getClusteringIntelligence(
  schemaId: string,
  scanJobId: string | undefined,
  emails: Array<{
    id: string;
    subject: string;
    senderDisplayName: string;
    senderDomain: string;
    date: Date;
    summary: string;
    tags: unknown;
    entityName: string | null;
  }>,
  entityGroups: EntityGroupInput[],
  domain: string,
  config: ClusteringConfig,
): Promise<ClusteringIntelligenceResult | null> {
  if (emails.length === 0) return null;

  try {
    const input = {
      domain,
      entityGroups,
      emails: emails.map((e) => ({
        id: e.id,
        subject: e.subject,
        senderDisplayName: e.senderDisplayName,
        senderDomain: e.senderDomain,
        date: e.date.toISOString(),
        summary: e.summary,
        tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
        entityName: e.entityName,
      })),
      currentConfig: {
        mergeThreshold: config.mergeThreshold,
        tagMatchScore: config.tagMatchScore,
        subjectMatchScore: config.subjectMatchScore,
        actorAffinityScore: config.actorAffinityScore,
      },
    };

    const prompt = buildClusteringIntelligencePrompt(input);

    const aiResult = await callClaude({
      model: "claude-sonnet-4-6",
      system: prompt.system,
      user: prompt.user,
      maxTokens: 4096,
      schemaId,
      operation: "clustering-intelligence",
    });

    const parsed = parseClusteringIntelligenceResponse(aiResult.content);

    // Store in PipelineIntelligence
    await prisma.pipelineIntelligence.create({
      data: {
        schemaId,
        scanJobId,
        stage: "clustering",
        input: { emailCount: emails.length, entityGroups, domain } as any,
        output: parsed as any,
        model: "claude-sonnet-4-6",
        tokenCount: aiResult.inputTokens + aiResult.outputTokens,
      },
    });

    // Log cost
    const estimatedCost =
      aiResult.inputTokens * CLAUDE_INPUT_COST_PER_TOKEN +
      aiResult.outputTokens * CLAUDE_OUTPUT_COST_PER_TOKEN;
    await prisma.extractionCost.create({
      data: {
        emailId: emails[0].id,
        scanJobId,
        model: "claude-sonnet-4-6",
        operation: "clustering-intelligence",
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        estimatedCostUsd: estimatedCost,
        latencyMs: aiResult.latencyMs,
      },
    });

    logger.info({
      service: "cluster",
      operation: "clusteringIntelligence",
      schemaId,
      groupCount: parsed.groups.length,
      excludeCount: parsed.excludeSuggestions.length,
      hasConfigOverrides: parsed.configOverrides.mergeThreshold !== null,
    });

    return parsed;
  } catch (error) {
    logger.error({
      service: "cluster",
      operation: "clusteringIntelligence.error",
      schemaId,
      error,
    });
    return null; // Fallback to pure gravity model
  }
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

  // 1. Load schema with clusteringConfig, entities, entity groups, and domain
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: schemaId },
    select: {
      id: true,
      domain: true,
      clusteringConfig: true,
      entities: {
        where: { isActive: true },
        select: { id: true, name: true, type: true, associatedPrimaryIds: true },
      },
      entityGroups: {
        orderBy: { index: "asc" },
        include: {
          entities: {
            where: { isActive: true },
            select: { name: true, type: true },
          },
        },
      },
    },
  });

  // Build entity lookup for last-resort entity resolution in clustering
  const primaryEntities = schema.entities.filter((e) => e.type === "PRIMARY");
  const entityByName = new Map(schema.entities.map((e) => [e.name.toLowerCase(), e]));

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
      detectedEntities: true,
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

  // 4. Transform Prisma rows → ClusterEmailInput[], filtering out emails with no entity
  const allEmailInputs: ClusterEmailInput[] = unclusteredEmails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    subject: e.subject,
    tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
    date: e.date,
    senderEntityId: e.senderEntityId,
    entityId: e.entityId,
  }));

  // Pre-filter: only cluster emails that have a resolved entity
  const emailInputs = allEmailInputs.filter((e) => e.entityId !== null);
  if (emailInputs.length < allEmailInputs.length) {
    logger.info({
      service: "cluster",
      operation: "clusterNewEmails.entityFilter",
      schemaId,
      total: allEmailInputs.length,
      withEntity: emailInputs.length,
      skipped: allEmailInputs.length - emailInputs.length,
    });
  }

  // Build a lookup for email display names (for lastSenderName)
  const emailLookup = new Map(
    unclusteredEmails.map((e) => [e.id, e]),
  );

  // Result accumulators (shared between AI groups + gravity model)
  const clusterIds: string[] = [];
  let casesCreated = 0;
  let casesMerged = 0;

  /**
   * Last-resort entity resolution: scan the email's detectedEntities JSON
   * to find a PRIMARY entity match when extraction didn't set entityId.
   */
  function resolveEntityFromDetected(
    emailIds: string[],
  ): string | null {
    for (const eid of emailIds) {
      const email = emailLookup.get(eid);
      if (!email) continue;
      const detected = email.detectedEntities;
      if (!Array.isArray(detected)) continue;
      for (const d of detected as Array<{ name: string; type: string }>) {
        const match = entityByName.get(d.name.toLowerCase());
        if (!match) continue;
        if (match.type === "PRIMARY") return match.id;
        // Secondary — resolve through associatedPrimaryIds
        const primaryIds = Array.isArray(match.associatedPrimaryIds)
          ? (match.associatedPrimaryIds as string[])
          : [];
        if (primaryIds[0]) return primaryIds[0];
      }
    }
    return null;
  }

  // 5a. Call clustering intelligence (AI pre-pass)
  const entityGroups: EntityGroupInput[] = schema.entityGroups.map((g) => ({
    whats: g.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name),
    whos: g.entities.filter((e) => e.type === "SECONDARY").map((e) => e.name),
  }));

  // Build entity name lookup for AI prompt
  const entityNameById = new Map(schema.entities.map((e) => [e.id, e.name]));

  const aiEmails = unclusteredEmails.map((e) => ({
    id: e.id,
    subject: e.subject,
    senderDisplayName: e.senderDisplayName,
    senderDomain: e.senderEmail.split("@")[1] ?? "",
    date: e.date,
    summary: "", // We don't have summary in this select - use subject as proxy
    tags: e.tags,
    entityName: e.entityId ? entityNameById.get(e.entityId) ?? null : null,
  }));

  // Load summaries for AI (separate query to keep main select lean)
  const emailSummaries = await prisma.email.findMany({
    where: { id: { in: unclusteredEmails.map((e) => e.id) } },
    select: { id: true, summary: true },
  });
  const summaryById = new Map(emailSummaries.map((e) => [e.id, e.summary]));
  for (const ae of aiEmails) {
    ae.summary = summaryById.get(ae.id) ?? ae.subject;
  }

  const intelligence = await getClusteringIntelligence(
    schemaId,
    scanJobId,
    aiEmails,
    entityGroups,
    schema.domain ?? "general",
    config,
  );

  // 5b. Process AI groups: create cases directly from AI suggestions
  const aiGroupedEmailIds = new Set<string>();

  if (intelligence) {
    // Apply config overrides from AI
    if (intelligence.configOverrides.mergeThreshold !== null) {
      config.mergeThreshold = intelligence.configOverrides.mergeThreshold;
    }
    if (intelligence.configOverrides.senderAffinityWeight !== null) {
      config.actorAffinityScore = intelligence.configOverrides.senderAffinityWeight;
    }

    // Mark AI-suggested excludes
    for (const excludeId of intelligence.excludeSuggestions) {
      await prisma.email.updateMany({
        where: { id: excludeId, schemaId },
        data: { isExcluded: true, excludeReason: "ai:clustering_intelligence" },
      });
      aiGroupedEmailIds.add(excludeId);
    }

    // Create cases from AI groups
    await prisma.$transaction(async (tx) => {
      for (const group of intelligence.groups) {
        // Find valid email IDs that exist in our unclustered set
        const validEmailIds = group.emailIds.filter(
          (id) => emailLookup.has(id) && !aiGroupedEmailIds.has(id),
        );
        if (validEmailIds.length === 0) continue;

        // Resolve entity from the first email with an entity
        let entityId: string | null = null;
        for (const eid of validEmailIds) {
          const email = emailLookup.get(eid);
          if (email?.entityId) {
            entityId = email.entityId;
            break;
          }
        }
        if (!entityId) {
          entityId = resolveEntityFromDetected(validEmailIds);
        }
        if (!entityId) continue;

        const firstEmail = emailLookup.get(validEmailIds[0]);
        const lastEmail = emailLookup.get(validEmailIds[validEmailIds.length - 1]);

        const allTags = [
          ...new Set(
            validEmailIds.flatMap((id) => {
              const e = emailLookup.get(id);
              return e ? (Array.isArray(e.tags) ? (e.tags as string[]) : []) : [];
            }),
          ),
        ];

        const anchorTags = computeAnchorTags(
          validEmailIds.flatMap((id) => {
            const e = emailLookup.get(id);
            return e ? (Array.isArray(e.tags) ? (e.tags as string[]) : []) : [];
          }),
          config.anchorTagLimit,
        );

        const newCase = await tx.case.create({
          data: {
            schemaId,
            entityId,
            title: group.caseTitle,
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

        for (const emailId of validEmailIds) {
          await tx.caseEmail.upsert({
            where: { emailId },
            create: {
              caseId: newCase.id,
              emailId,
              assignedBy: "CLUSTERING",
              clusteringScore: null,
            },
            update: {
              caseId: newCase.id,
              assignedBy: "CLUSTERING",
            },
          });
          aiGroupedEmailIds.add(emailId);
        }

        // Audit record
        const cluster = await tx.cluster.create({
          data: {
            schemaId,
            action: "CREATE",
            targetCaseId: null,
            emailIds: validEmailIds,
            threadIds: [...new Set(validEmailIds.map((id) => emailLookup.get(id)?.threadId).filter(Boolean))] as string[],
            score: null,
            primaryTag: anchorTags[0] ?? null,
            scoreBreakdown: { aiGrouped: true, reasoning: group.reasoning } as any,
            status: "COMPLETED",
            resultCaseId: newCase.id,
            scanJobId,
          },
        });

        clusterIds.push(cluster.id);
        casesCreated++;
      }
    }, { timeout: 120000 });

    logger.info({
      service: "cluster",
      operation: "clusterNewEmails.aiGroups",
      schemaId,
      aiCasesCreated: casesCreated,
      aiExcluded: intelligence.excludeSuggestions.length,
      remainingForGravity: emailInputs.filter((e) => !aiGroupedEmailIds.has(e.id)).length,
    });
  }

  // Filter out AI-grouped emails from gravity model input
  const remainingEmailInputs = emailInputs.filter((e) => !aiGroupedEmailIds.has(e.id));

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

  // 6. Run gravity model on remaining (non-AI-grouped) emails
  const now = new Date();
  const decisions = clusterEmails(remainingEmailInputs, caseInputs, tagFrequencies, config, now);

  // 7. Write gravity model results in a transaction

  await prisma.$transaction(async (tx) => {
    for (const decision of decisions) {
      if (decision.action === "CREATE") {
        // Resolve entity: from decision, then detectedEntities — no fallback
        const entityId =
          decision.entityId ??
          resolveEntityFromDetected(decision.emailIds);
        if (!entityId) {
          logger.warn({
            service: "cluster",
            operation: "clusterNewEmails.noEntity",
            schemaId,
            emailIds: decision.emailIds,
            message: "Skipping case creation — no entity available",
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
  }, { timeout: 120000 });

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
