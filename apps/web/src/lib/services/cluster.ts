/**
 * ClusterService — Two-pass clustering: coarse entity clustering + AI case splitting.
 *
 * Pass 1 (coarseCluster): Simplified gravity model groups emails by entity.
 *   Formula: (thread + subject + actor) * timeDecay >= mergeThreshold
 *
 * Pass 2 (splitCoarseClusters): Word frequency analysis + AI (or deterministic) case splitting.
 *   CALIBRATING/TRACKING: Claude splits using frequency tables + learned vocabulary
 *   STABLE: Deterministic word matching using discriminatorVocabulary
 *
 * Write owner for: Cluster, CaseEmail
 * Also creates: Case shells (title from first subject, status OPEN)
 * Also updates: Case denormalized fields, CaseSchema.caseCount
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { callClaude } from "@/lib/ai/client";
import { clusterEmails } from "@denim/engine";
import { analyzeWordFrequencies } from "@denim/engine";
import {
  buildCaseSplittingPrompt,
  parseCaseSplittingResponse,
  buildClusteringCalibrationPrompt,
  parseClusteringCalibrationResponse,
} from "@denim/ai";
import type {
  ClusterCaseInput,
  ClusterEmailInput,
  ClusteringConfig,
  EntityGroupInput,
  QualityPhaseType,
  FrequencyTable,
} from "@denim/types";
import type { CoarseClusterInput } from "@denim/engine";

// Claude Sonnet pricing (per 1M tokens): $3 input, $15 output
const CLAUDE_INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const CLAUDE_OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;

interface ClusterResult {
  clusterIds: string[];
  casesCreated: number;
  casesMerged: number;
  clustersCreated: number;
}

// ---------------------------------------------------------------------------
// Pass 1: Coarse Clustering
// ---------------------------------------------------------------------------

/**
 * Run simplified gravity model to create coarse entity-level clusters.
 * No AI calls — pure computation + DB reads/writes.
 */
export async function coarseCluster(
  schemaId: string,
  scanJobId?: string,
): Promise<ClusterResult> {
  const startTime = Date.now();

  // 0. Clean up orphaned cases from failed prior clustering attempts
  const orphanedCases = await prisma.case.findMany({
    where: { schemaId, caseEmails: { none: {} } },
    select: { id: true },
  });

  if (orphanedCases.length > 0) {
    await prisma.case.deleteMany({
      where: { id: { in: orphanedCases.map((c) => c.id) } },
    });
    await prisma.cluster.deleteMany({
      where: { schemaId, resultCaseId: { in: orphanedCases.map((c) => c.id) } },
    });
    logger.info({
      service: "cluster",
      operation: "coarseCluster.cleanup",
      schemaId,
      orphanedCasesDeleted: orphanedCases.length,
    });
  }

  // 1. Load schema with config
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: schemaId },
    select: {
      id: true,
      domain: true,
      clusteringConfig: true,
      tunedClusteringConfig: true,
      qualityPhase: true,
      entities: {
        where: { isActive: true },
        select: { id: true, name: true, type: true, associatedPrimaryIds: true },
      },
    },
  });

  // Use tuned config if available (TRACKING/STABLE phases), otherwise interview config
  // Existing schemas may not have tagMatchScore in stored JSON — default to 15
  const raw = (schema.tunedClusteringConfig ?? schema.clusteringConfig) as Record<string, unknown>;
  const config: ClusteringConfig = {
    ...(raw as unknown as ClusteringConfig),
    tagMatchScore: (raw.tagMatchScore as number) ?? 15,
  };

  const entityByName = new Map(schema.entities.map((e) => [e.name.toLowerCase(), e]));

  // 2. Load unclustered emails (not excluded, no CaseEmail record)
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
      summary: true,
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
      operation: "coarseCluster",
      schemaId,
      message: "No unclustered emails found",
    });
    return { clusterIds: [], casesCreated: 0, casesMerged: 0, clustersCreated: 0 };
  }

  // 3. Transform to ClusterEmailInput[], filter emails without entity
  const allEmailInputs: ClusterEmailInput[] = unclusteredEmails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    subject: e.subject,
    summary: e.summary,
    tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
    date: e.date,
    senderEntityId: e.senderEntityId,
    entityId: e.entityId,
  }));

  const emailInputs = allEmailInputs.filter((e) => e.entityId !== null);
  if (emailInputs.length < allEmailInputs.length) {
    logger.info({
      service: "cluster",
      operation: "coarseCluster.entityFilter",
      schemaId,
      total: allEmailInputs.length,
      withEntity: emailInputs.length,
      skipped: allEmailInputs.length - emailInputs.length,
    });
  }

  // Email lookup for display names and entity resolution
  const emailLookup = new Map(unclusteredEmails.map((e) => [e.id, e]));

  /** Last-resort entity resolution from detectedEntities JSON. */
  function resolveEntityFromDetected(emailIds: string[]): string | null {
    for (const eid of emailIds) {
      const email = emailLookup.get(eid);
      if (!email) continue;
      const detected = email.detectedEntities;
      if (!Array.isArray(detected)) continue;
      for (const d of detected as Array<{ name: string; type: string }>) {
        const match = entityByName.get(d.name.toLowerCase());
        if (!match) continue;
        if (match.type === "PRIMARY") return match.id;
        const primaryIds = Array.isArray(match.associatedPrimaryIds)
          ? (match.associatedPrimaryIds as string[])
          : [];
        if (primaryIds[0]) return primaryIds[0];
      }
    }
    return null;
  }

  // 4. Load existing cases
  const existingCases = await prisma.case.findMany({
    where: { schemaId, status: "OPEN" },
    select: {
      id: true,
      entityId: true,
      title: true,
      lastEmailDate: true,
      caseEmails: {
        select: {
          email: {
            select: { threadId: true, senderEntityId: true, tags: true },
          },
        },
      },
    },
  });

  const caseInputs: ClusterCaseInput[] = existingCases.map((c) => ({
    id: c.id,
    entityId: c.entityId,
    threadIds: [...new Set(c.caseEmails.map((ce) => ce.email.threadId))],
    senderEntityIds: [
      ...new Set(
        c.caseEmails
          .map((ce) => ce.email.senderEntityId)
          .filter((id): id is string => id !== null),
      ),
    ],
    tags: [
      ...new Set(
        c.caseEmails.flatMap((ce) =>
          Array.isArray(ce.email.tags) ? (ce.email.tags as string[]) : [],
        ),
      ),
    ],
    subject: c.title,
    emailCount: c.caseEmails.length,
    lastEmailDate: c.lastEmailDate ?? new Date(0),
  }));

  // 5. Run gravity model
  const now = new Date();
  const decisions = clusterEmails(emailInputs, caseInputs, config, now);

  // 6. Write results
  const clusterIds: string[] = [];
  let casesCreated = 0;
  let casesMerged = 0;

  await prisma.$transaction(async (tx) => {
    for (const decision of decisions) {
      if (decision.action === "CREATE") {
        const entityId =
          decision.entityId ?? resolveEntityFromDetected(decision.emailIds);
        if (!entityId) {
          logger.warn({
            service: "cluster",
            operation: "coarseCluster.noEntity",
            schemaId,
            emailIds: decision.emailIds,
          });
          continue;
        }

        const firstEmail = emailLookup.get(decision.emailIds[0]);
        const lastEmail = decision.emailIds.length > 1
          ? emailLookup.get(decision.emailIds[decision.emailIds.length - 1])
          : firstEmail;

        const newCase = await tx.case.create({
          data: {
            schemaId,
            entityId,
            title: firstEmail?.subject ?? "Untitled Case",
            summary: { beginning: "", middle: "", end: "" },
            status: "OPEN",
            anchorTags: [],
            allTags: [],
            displayTags: [],
            startDate: firstEmail?.date,
            lastEmailDate: lastEmail?.date,
            lastSenderName: lastEmail?.senderDisplayName,
          },
        });

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

        const cluster = await tx.cluster.create({
          data: {
            schemaId,
            action: "CREATE",
            targetCaseId: null,
            clusterPass: "COARSE",
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
        // MERGE
        const targetCaseId = decision.targetCaseId!;

        const targetExists = await tx.case.findUnique({
          where: { id: targetCaseId },
          select: { id: true },
        });
        if (!targetExists) continue;

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

        // Update denormalized fields
        const lastEmailId = decision.emailIds[decision.emailIds.length - 1];
        const lastEmail = emailLookup.get(lastEmailId);

        await tx.case.update({
          where: { id: targetCaseId },
          data: {
            lastEmailDate: lastEmail?.date,
            lastSenderName: lastEmail?.senderDisplayName,
          },
        });

        const cluster = await tx.cluster.create({
          data: {
            schemaId,
            action: "MERGE",
            targetCaseId,
            clusterPass: "COARSE",
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

    // Write alternativeCaseId for emails with second-best matches
    for (const decision of decisions) {
      if (decision.alternativeCaseId && decision.emailIds.length > 0) {
        await tx.email.updateMany({
          where: { id: { in: decision.emailIds } },
          data: { alternativeCaseId: decision.alternativeCaseId },
        });
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
    operation: "coarseCluster",
    schemaId,
    durationMs,
    emailCount: emailInputs.length,
    casesCreated,
    casesMerged,
    clustersCreated: clusterIds.length,
  });

  return { clusterIds, casesCreated, casesMerged, clustersCreated: clusterIds.length };
}

// ---------------------------------------------------------------------------
// Pass 2: Case Splitting
// ---------------------------------------------------------------------------

/**
 * Split coarse clusters into specific cases using frequency analysis + AI.
 * In STABLE phase, uses deterministic word matching instead of Claude.
 */
export async function splitCoarseClusters(
  schemaId: string,
  scanJobId?: string,
): Promise<ClusterResult> {
  const startTime = Date.now();

  // 1. Load schema with phase and vocabulary
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: schemaId },
    select: {
      id: true,
      domain: true,
      qualityPhase: true,
      discriminatorVocabulary: true,
      entities: {
        where: { isActive: true, type: "PRIMARY" },
        select: { id: true, name: true },
      },
    },
  });

  const qualityPhase = schema.qualityPhase as QualityPhaseType;
  const entityNameById = new Map(schema.entities.map((e) => [e.id, e.name]));

  // 2. Load all cases (from coarse clustering) with their emails
  const cases = await prisma.case.findMany({
    where: { schemaId, status: "OPEN" },
    select: {
      id: true,
      entityId: true,
      caseEmails: {
        select: {
          email: {
            select: {
              id: true,
              subject: true,
              summary: true,
              tags: true,
            },
          },
        },
      },
    },
  });

  // 3. Build coarse clusters grouped by entity for frequency analysis
  // Group cases by entityId to form coarse clusters
  const entityClusters = new Map<string, {
    entityId: string;
    entityName: string;
    emails: Array<{ id: string; subject: string; summary: string; tags: string[] }>;
    caseIds: string[];
  }>();

  for (const c of cases) {
    const entityName = entityNameById.get(c.entityId) ?? c.entityId;
    const existing = entityClusters.get(c.entityId);
    const emails = c.caseEmails.map((ce) => ({
      id: ce.email.id,
      subject: ce.email.subject,
      summary: ce.email.summary,
      tags: Array.isArray(ce.email.tags) ? (ce.email.tags as string[]) : [],
    }));

    if (existing) {
      existing.emails.push(...emails);
      existing.caseIds.push(c.id);
    } else {
      entityClusters.set(c.entityId, {
        entityId: c.entityId,
        entityName,
        emails,
        caseIds: [c.id],
      });
    }
  }

  // 4. Run word frequency analysis (pure computation)
  const clusterInputs: CoarseClusterInput[] = Array.from(entityClusters.values()).map(
    (cluster) => ({
      clusterId: cluster.entityId,
      entityName: cluster.entityName,
      emails: cluster.emails.map((e) => ({
        id: e.id,
        subject: e.subject,
        summary: e.summary,
      })),
    }),
  );

  const frequencyTables = analyzeWordFrequencies(clusterInputs);

  // Skip splitting for clusters with too few emails (< 3)
  const splittableTables = frequencyTables.filter((t) => t.emailCount >= 3);
  if (splittableTables.length === 0) {
    logger.info({
      service: "cluster",
      operation: "splitCoarseClusters.skip",
      schemaId,
      reason: "No clusters with enough emails to split",
    });
    return { clusterIds: [], casesCreated: 0, casesMerged: 0, clustersCreated: 0 };
  }

  // 5. Decide: AI or deterministic splitting
  if (qualityPhase === "STABLE") {
    return await deterministicSplit(schemaId, scanJobId, entityClusters, frequencyTables, schema.discriminatorVocabulary);
  }

  // CALIBRATING or TRACKING: use Claude
  return await aiCaseSplit(schemaId, scanJobId, entityClusters, frequencyTables, qualityPhase, schema.discriminatorVocabulary, schema.domain);
}

/**
 * Assign all emails not referenced in Claude's split result to cases using
 * discriminator word matching. Claude only sees a sample of emails; this
 * ensures every email in the cluster gets assigned to a case.
 */
function assignRemainingEmails(
  splitResult: {
    cases: Array<{ caseTitle: string; discriminators: string[]; emailIds: string[]; reasoning: string }>;
    catchAllEmailIds: string[];
    reasoning: string;
  },
  entityClusters: Map<string, {
    entityId: string;
    entityName: string;
    emails: Array<{ id: string; subject: string; summary: string; tags: string[] }>;
    caseIds: string[];
  }>,
): typeof splitResult {
  // Collect all email IDs Claude already assigned
  const assignedIds = new Set<string>();
  for (const c of splitResult.cases) {
    for (const id of c.emailIds) assignedIds.add(id);
  }
  for (const id of splitResult.catchAllEmailIds) assignedIds.add(id);

  // Collect all emails from all clusters
  const allEmails: Array<{ id: string; subject: string; summary: string }> = [];
  for (const cluster of entityClusters.values()) {
    for (const email of cluster.emails) {
      if (!assignedIds.has(email.id)) {
        allEmails.push(email);
      }
    }
  }

  if (allEmails.length === 0) return splitResult;

  // For each unassigned email, find the best-matching case by discriminator words
  const updatedCases = splitResult.cases.map((c) => ({
    ...c,
    emailIds: [...c.emailIds],
  }));
  const updatedCatchAll = [...splitResult.catchAllEmailIds];

  for (const email of allEmails) {
    const text = `${email.subject} ${email.summary}`.toLowerCase();
    let bestCaseIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < updatedCases.length; i++) {
      const caseDef = updatedCases[i];
      let matchCount = 0;
      for (const word of caseDef.discriminators) {
        if (text.includes(word.toLowerCase())) matchCount++;
      }
      if (matchCount > bestScore) {
        bestScore = matchCount;
        bestCaseIdx = i;
      }
    }

    if (bestCaseIdx >= 0) {
      updatedCases[bestCaseIdx].emailIds.push(email.id);
    } else {
      updatedCatchAll.push(email.id);
    }
  }

  return {
    cases: updatedCases,
    catchAllEmailIds: updatedCatchAll,
    reasoning: splitResult.reasoning,
  };
}

/**
 * AI-powered case splitting using Claude.
 */
async function aiCaseSplit(
  schemaId: string,
  scanJobId: string | undefined,
  entityClusters: Map<string, {
    entityId: string;
    entityName: string;
    emails: Array<{ id: string; subject: string; summary: string; tags: string[] }>;
    caseIds: string[];
  }>,
  frequencyTables: FrequencyTable[],
  qualityPhase: QualityPhaseType,
  learnedVocabulary: unknown,
  domain: string | null,
): Promise<ClusterResult> {
  // Load correction history for context
  const corrections = await prisma.feedbackEvent.findMany({
    where: {
      schemaId,
      eventType: { in: ["EMAIL_MOVE", "CASE_MERGE", "THUMBS_UP", "THUMBS_DOWN"] },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { eventType: true, payload: true },
  });

  const correctionHistory = corrections.map((c) => ({
    type: c.eventType,
    details: JSON.stringify(c.payload),
  }));

  // Build prompt input
  const clusters = frequencyTables.map((ft) => {
    const cluster = entityClusters.get(ft.clusterId);
    return {
      clusterId: ft.clusterId,
      entityName: ft.entityName,
      emailCount: ft.emailCount,
      frequencyWords: ft.words.slice(0, 20).map((w) => ({
        word: w.word,
        frequency: w.frequency,
        weightedScore: w.weightedScore,
      })),
      emailSamples: (cluster?.emails ?? []).slice(0, 30).map((e) => ({
        id: e.id,
        subject: e.subject,
        summary: e.summary,
      })),
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const prompt = buildCaseSplittingPrompt({
    domain: domain ?? "general",
    today,
    clusters,
    correctionHistory: correctionHistory.length > 0 ? correctionHistory : undefined,
    learnedVocabulary: learnedVocabulary as Record<string, { words: Record<string, number>; mergedAway: string[] }> | undefined,
  });

  try {
    const aiResult = await callClaude({
      model: "claude-sonnet-4-6",
      system: prompt.system,
      user: prompt.user,
      maxTokens: 4096,
      schemaId,
      operation: "case-splitting",
    });

    const parsed = parseCaseSplittingResponse(aiResult.content);

    // Store in PipelineIntelligence
    await prisma.pipelineIntelligence.create({
      data: {
        schemaId,
        scanJobId,
        stage: "case-splitting",
        input: { clusterCount: clusters.length, phase: qualityPhase } as any,
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
        emailId: clusters[0]?.emailSamples[0]?.id ?? "unknown",
        scanJobId,
        model: "claude-sonnet-4-6",
        operation: "case-splitting",
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        estimatedCostUsd: estimatedCost,
        latencyMs: aiResult.latencyMs,
      },
    });

    // Assign ALL remaining emails to cases using discriminator word matching.
    // Claude only saw a sample — the rest must be deterministically assigned.
    const enriched = assignRemainingEmails(parsed, entityClusters);

    // Apply the AI's case definitions (now covering all emails)
    return await applyCaseSplitResult(schemaId, scanJobId, entityClusters, enriched);
  } catch (error) {
    logger.error({
      service: "cluster",
      operation: "aiCaseSplit.error",
      schemaId,
      error,
    });
    // Fallback: no splitting, keep coarse clusters as-is
    return { clusterIds: [], casesCreated: 0, casesMerged: 0, clustersCreated: 0 };
  }
}

/**
 * Deterministic case splitting using learned discriminator vocabulary.
 * Used in STABLE phase — no AI calls.
 */
async function deterministicSplit(
  schemaId: string,
  scanJobId: string | undefined,
  entityClusters: Map<string, {
    entityId: string;
    entityName: string;
    emails: Array<{ id: string; subject: string; summary: string; tags: string[] }>;
    caseIds: string[];
  }>,
  frequencyTables: FrequencyTable[],
  vocabulary: unknown,
): Promise<ClusterResult> {
  const vocab = vocabulary as Record<string, {
    words: Record<string, number>;
    mergedAway: string[];
  }> | null;

  if (!vocab) {
    // No vocabulary learned yet, skip splitting
    return { clusterIds: [], casesCreated: 0, casesMerged: 0, clustersCreated: 0 };
  }

  // For each entity cluster, match emails to discriminator words
  const splitResult = {
    cases: [] as Array<{
      caseTitle: string;
      discriminators: string[];
      emailIds: string[];
      reasoning: string;
    }>,
    catchAllEmailIds: [] as string[],
    reasoning: "Deterministic split using learned vocabulary",
  };

  for (const [entityId, cluster] of entityClusters) {
    const entityVocab = vocab[cluster.entityName];
    if (!entityVocab || Object.keys(entityVocab.words).length === 0) {
      // No discriminators for this entity, all emails stay in catch-all
      splitResult.catchAllEmailIds.push(...cluster.emails.map((e) => e.id));
      continue;
    }

    // Group emails by their strongest discriminator word
    const wordGroups = new Map<string, string[]>();

    for (const email of cluster.emails) {
      const text = `${email.subject} ${email.summary}`.toLowerCase();
      let bestWord: string | null = null;
      let bestScore = 0;

      for (const [word, confidence] of Object.entries(entityVocab.words)) {
        if (entityVocab.mergedAway.includes(word)) continue;
        if (text.includes(word) && confidence > bestScore) {
          bestWord = word;
          bestScore = confidence;
        }
      }

      if (bestWord) {
        const group = wordGroups.get(bestWord) ?? [];
        group.push(email.id);
        wordGroups.set(bestWord, group);
      } else {
        splitResult.catchAllEmailIds.push(email.id);
      }
    }

    // Convert word groups to case definitions
    for (const [word, emailIds] of wordGroups) {
      if (emailIds.length < 2) {
        // Too few emails for a distinct case, merge into catch-all
        splitResult.catchAllEmailIds.push(...emailIds);
        continue;
      }

      splitResult.cases.push({
        caseTitle: `${cluster.entityName} — ${word.charAt(0).toUpperCase() + word.slice(1)}`,
        discriminators: [word],
        emailIds,
        reasoning: `Deterministic match on learned discriminator "${word}"`,
      });
    }
  }

  return await applyCaseSplitResult(schemaId, scanJobId, entityClusters, splitResult);
}

/**
 * Apply case split results: delete old coarse cases, create new split cases.
 */
async function applyCaseSplitResult(
  schemaId: string,
  scanJobId: string | undefined,
  entityClusters: Map<string, {
    entityId: string;
    entityName: string;
    emails: Array<{ id: string; subject: string; summary: string; tags: string[] }>;
    caseIds: string[];
  }>,
  splitResult: {
    cases: Array<{ caseTitle: string; discriminators: string[]; emailIds: string[]; reasoning: string }>;
    catchAllEmailIds: string[];
    reasoning: string;
  },
): Promise<ClusterResult> {
  const startTime = Date.now();
  // Build email → entity mapping
  const emailEntityMap = new Map<string, string>();
  for (const [entityId, cluster] of entityClusters) {
    for (const email of cluster.emails) {
      emailEntityMap.set(email.id, entityId);
    }
  }

  // Get email details for denormalized fields
  const allEmailIds = [
    ...splitResult.cases.flatMap((c) => c.emailIds),
    ...splitResult.catchAllEmailIds,
  ];

  if (allEmailIds.length === 0) {
    return { clusterIds: [], casesCreated: 0, casesMerged: 0, clustersCreated: 0 };
  }

  const emailDetails = await prisma.email.findMany({
    where: { id: { in: allEmailIds } },
    select: {
      id: true,
      subject: true,
      date: true,
      senderDisplayName: true,
      entityId: true,
    },
  });
  const emailDetailMap = new Map(emailDetails.map((e) => [e.id, e]));

  const clusterIds: string[] = [];
  let casesCreated = 0;

  // Delete old coarse-pass CaseEmail assignments for emails being re-assigned
  // Then create new cases from split definitions
  await prisma.$transaction(async (tx) => {
    // Remove existing case assignments for emails that will be re-split
    if (allEmailIds.length > 0) {
      await tx.caseEmail.deleteMany({
        where: { emailId: { in: allEmailIds } },
      });
    }

    // Delete empty coarse cases (they'll be replaced by split cases)
    const allCoarseCaseIds = Array.from(entityClusters.values()).flatMap((c) => c.caseIds);
    if (allCoarseCaseIds.length > 0) {
      // Only delete cases that have no remaining emails (after CaseEmail deletion)
      const emptyCases = await tx.case.findMany({
        where: {
          id: { in: allCoarseCaseIds },
          caseEmails: { none: {} },
        },
        select: { id: true },
      });
      if (emptyCases.length > 0) {
        await tx.case.deleteMany({
          where: { id: { in: emptyCases.map((c) => c.id) } },
        });
      }
    }

    // Create new cases from AI/deterministic split definitions
    for (const caseDef of splitResult.cases) {
      if (caseDef.emailIds.length === 0) continue;

      // Resolve entity from first email
      const entityId = emailEntityMap.get(caseDef.emailIds[0]);
      if (!entityId) continue;

      const firstEmail = emailDetailMap.get(caseDef.emailIds[0]);
      const lastEmail = emailDetailMap.get(caseDef.emailIds[caseDef.emailIds.length - 1]);

      const newCase = await tx.case.create({
        data: {
          schemaId,
          entityId,
          title: caseDef.caseTitle,
          summary: { beginning: "", middle: "", end: "" },
          status: "OPEN",
          anchorTags: [],
          allTags: [],
          displayTags: [],
          startDate: firstEmail?.date,
          lastEmailDate: lastEmail?.date,
          lastSenderName: lastEmail?.senderDisplayName,
        },
      });

      for (const emailId of caseDef.emailIds) {
        await tx.caseEmail.upsert({
          where: { emailId },
          create: {
            caseId: newCase.id,
            emailId,
            assignedBy: "CLUSTERING",
          },
          update: {
            caseId: newCase.id,
            assignedBy: "CLUSTERING",
          },
        });
      }

      // Update discriminators on emails
      if (caseDef.discriminators.length > 0) {
        await tx.email.updateMany({
          where: { id: { in: caseDef.emailIds } },
          data: { discriminators: caseDef.discriminators },
        });
      }

      // Audit record
      const cluster = await tx.cluster.create({
        data: {
          schemaId,
          action: "CREATE",
          targetCaseId: null,
          clusterPass: "SPLIT",
          emailIds: caseDef.emailIds,
          threadIds: [],
          primaryTag: caseDef.discriminators[0] ?? null,
          scoreBreakdown: { discriminators: caseDef.discriminators, reasoning: caseDef.reasoning } as any,
          status: "COMPLETED",
          resultCaseId: newCase.id,
          scanJobId,
        },
      });

      clusterIds.push(cluster.id);
      casesCreated++;
    }

    // Handle catch-all emails — create a catch-all case per entity
    if (splitResult.catchAllEmailIds.length > 0) {
      // Group catch-all emails by entity
      const catchAllByEntity = new Map<string, string[]>();
      for (const emailId of splitResult.catchAllEmailIds) {
        const entityId = emailEntityMap.get(emailId);
        if (!entityId) continue;
        const list = catchAllByEntity.get(entityId) ?? [];
        list.push(emailId);
        catchAllByEntity.set(entityId, list);
      }

      for (const [entityId, emailIds] of catchAllByEntity) {
        const cluster = entityClusters.get(entityId);
        const entityName = cluster?.entityName ?? "Other";

        const firstEmail = emailDetailMap.get(emailIds[0]);
        const lastEmail = emailDetailMap.get(emailIds[emailIds.length - 1]);

        const catchAllCase = await tx.case.create({
          data: {
            schemaId,
            entityId,
            title: `${entityName} — General`,
            summary: { beginning: "", middle: "", end: "" },
            status: "OPEN",
            anchorTags: [],
            allTags: [],
            displayTags: [],
            startDate: firstEmail?.date,
            lastEmailDate: lastEmail?.date,
            lastSenderName: lastEmail?.senderDisplayName,
          },
        });

        for (const emailId of emailIds) {
          await tx.caseEmail.upsert({
            where: { emailId },
            create: {
              caseId: catchAllCase.id,
              emailId,
              assignedBy: "CLUSTERING",
            },
            update: {
              caseId: catchAllCase.id,
              assignedBy: "CLUSTERING",
            },
          });
        }

        const auditCluster = await tx.cluster.create({
          data: {
            schemaId,
            action: "CREATE",
            clusterPass: "SPLIT",
            emailIds,
            threadIds: [],
            primaryTag: null,
            scoreBreakdown: { catchAll: true } as any,
            status: "COMPLETED",
            resultCaseId: catchAllCase.id,
            scanJobId,
          },
        });

        clusterIds.push(auditCluster.id);
        casesCreated++;
      }
    }

    // Update case count
    const totalCases = await tx.case.count({ where: { schemaId } });
    await tx.caseSchema.update({
      where: { id: schemaId },
      data: { caseCount: totalCases },
    });
  }, { timeout: 120000 });

  const durationMs = Date.now() - startTime;
  logger.info({
    service: "cluster",
    operation: "splitCoarseClusters",
    schemaId,
    durationMs,
    casesCreated,
    clustersCreated: clusterIds.length,
  });

  return { clusterIds, casesCreated, casesMerged: 0, clustersCreated: clusterIds.length };
}

// ---------------------------------------------------------------------------
// Calibration: Learning from corrections
// ---------------------------------------------------------------------------

/**
 * Run calibration after user corrections. Reads feedback events,
 * calls Claude to adjust params + vocabulary, persists results.
 * Called by Inngest after synthesis when phase is CALIBRATING or TRACKING.
 */
export async function applyCalibration(
  schemaId: string,
  scanJobId?: string,
): Promise<void> {
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: schemaId },
    select: {
      qualityPhase: true,
      calibrationRunCount: true,
      clusteringConfig: true,
      tunedClusteringConfig: true,
      discriminatorVocabulary: true,
      entities: {
        where: { isActive: true, type: "PRIMARY" },
        select: { id: true, name: true },
      },
    },
  });

  const phase = schema.qualityPhase as QualityPhaseType;
  if (phase === "STABLE") return; // No calibration in STABLE phase

  const rawCfg = (schema.tunedClusteringConfig ?? schema.clusteringConfig) as Record<string, unknown>;
  const config: ClusteringConfig = {
    ...(rawCfg as unknown as ClusteringConfig),
    tagMatchScore: (rawCfg.tagMatchScore as number) ?? 15,
  };

  // Load recent corrections
  const corrections = await prisma.feedbackEvent.findMany({
    where: {
      schemaId,
      eventType: { in: ["EMAIL_MOVE", "CASE_MERGE", "THUMBS_UP", "THUMBS_DOWN"] },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { eventType: true, payload: true },
  });

  // Load current cases with email data for cluster summary + frequency analysis
  const cases = await prisma.case.findMany({
    where: { schemaId, status: "OPEN" },
    select: {
      id: true,
      title: true,
      entityId: true,
      _count: { select: { caseEmails: true } },
      caseEmails: {
        take: 50,
        select: {
          email: { select: { subject: true, summary: true } },
        },
      },
    },
  });

  const entityNameById = new Map(schema.entities.map((e) => [e.id, e.name]));

  // Build coarse cluster summary
  const entityCaseCounts = new Map<string, { emailCount: number; casesSplit: number }>();
  for (const c of cases) {
    const entityName = entityNameById.get(c.entityId) ?? c.entityId;
    const existing = entityCaseCounts.get(entityName) ?? { emailCount: 0, casesSplit: 0 };
    existing.emailCount += c._count.caseEmails;
    existing.casesSplit += 1;
    entityCaseCounts.set(entityName, existing);
  }

  const coarseClusters = Array.from(entityCaseCounts.entries()).map(([name, data]) => ({
    entityName: name,
    emailCount: data.emailCount,
    casesSplit: data.casesSplit,
  }));

  // Build real frequency tables from case emails (previously hardcoded as {})
  const frequencyTables: Record<string, { word: string; pct: number; caseAssignment: string }[]> = {};
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "to", "of", "in", "for", "on", "at", "by", "with", "from", "and", "but", "or", "if", "this", "that", "it", "not", "no", "re", "fw", "fwd", "am", "pm", "i", "me", "my", "you", "your", "we", "our", "they", "he", "she", "her", "his", "its", "so", "as", "up"]);

  // Group cases by entity
  const casesByEntity = new Map<string, typeof cases>();
  for (const c of cases) {
    const entityName = entityNameById.get(c.entityId) ?? c.entityId;
    const list = casesByEntity.get(entityName) ?? [];
    list.push(c);
    casesByEntity.set(entityName, list);
  }

  for (const [entityName, entityCases] of casesByEntity) {
    if (entityCases.length < 2) continue; // Need at least 2 cases to have meaningful frequency data

    // Count word occurrences per case
    const wordCaseCounts = new Map<string, Map<string, number>>(); // word → { caseTitle → count }
    let totalEmails = 0;
    const wordEmailCounts = new Map<string, number>(); // word → total emails containing it

    for (const c of entityCases) {
      for (const ce of c.caseEmails) {
        totalEmails++;
        const text = `${ce.email.subject ?? ""} ${typeof ce.email.summary === "string" ? ce.email.summary : ""}`.toLowerCase();
        const words = text.match(/[a-z]{3,}/g) ?? [];
        const uniqueWords = new Set(words.filter((w) => !stopWords.has(w)));

        for (const word of uniqueWords) {
          wordEmailCounts.set(word, (wordEmailCounts.get(word) ?? 0) + 1);

          if (!wordCaseCounts.has(word)) wordCaseCounts.set(word, new Map());
          const caseCounts = wordCaseCounts.get(word)!;
          const caseTitle = c.title ?? c.id;
          caseCounts.set(caseTitle, (caseCounts.get(caseTitle) ?? 0) + 1);
        }
      }
    }

    if (totalEmails === 0) continue;

    // Build frequency entries: top 20 words that appear in a subset (not all) of cases
    const entries: { word: string; pct: number; caseAssignment: string }[] = [];
    for (const [word, emailCount] of wordEmailCounts) {
      const pct = emailCount / totalEmails;
      if (pct > 0.9) continue; // Skip words in nearly all emails (entity-level, not discriminators)
      if (pct < 0.05) continue; // Skip very rare words

      const caseCounts = wordCaseCounts.get(word)!;
      // Find the case with the most occurrences of this word
      let bestCase = "";
      let bestCount = 0;
      for (const [caseTitle, count] of caseCounts) {
        if (count > bestCount) {
          bestCase = caseTitle;
          bestCount = count;
        }
      }
      entries.push({ word, pct, caseAssignment: bestCase });
    }

    entries.sort((a, b) => b.pct - a.pct);
    frequencyTables[entityName] = entries.slice(0, 20);
  }

  const prompt = buildClusteringCalibrationPrompt({
    currentConfig: {
      mergeThreshold: config.mergeThreshold,
      subjectMatchScore: config.subjectMatchScore,
      actorAffinityScore: config.actorAffinityScore,
      tagMatchScore: config.tagMatchScore ?? 15,
      timeDecayFreshDays: config.timeDecayDays.fresh,
    },
    coarseClusters,
    frequencyTables,
    corrections: corrections.map((c) => {
      const payload = c.payload as Record<string, unknown>;
      const caseTitleById = new Map(cases.map((cs) => [cs.id, cs.title]));
      const resolveCase = (id: unknown): string => {
        if (typeof id !== "string") return String(id);
        const title = caseTitleById.get(id);
        return title ? `${title} (${id})` : id;
      };
      return {
        type: c.eventType as string,
        ...(typeof payload.fromCaseId === "string" ? { from: resolveCase(payload.fromCaseId) } : {}),
        ...(typeof payload.toCaseId === "string" ? { to: resolveCase(payload.toCaseId) } : {}),
        ...(typeof payload.caseId === "string" ? { caseId: resolveCase(payload.caseId) } : {}),
        ...(Array.isArray(payload.cases) ? { cases: payload.cases.map(resolveCase) } : {}),
      };
    }),
  });

  try {
    const aiResult = await callClaude({
      model: "claude-sonnet-4-6",
      system: prompt.system,
      user: prompt.user,
      maxTokens: 2048,
      schemaId,
      operation: "clustering-calibration",
    });

    const parsed = parseClusteringCalibrationResponse(aiResult.content);

    // Defense in depth: clamp tuned parameters to safe bounds
    const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));
    parsed.tunedConfig.mergeThreshold = clamp(parsed.tunedConfig.mergeThreshold, 20, 80);
    parsed.tunedConfig.subjectMatchScore = clamp(parsed.tunedConfig.subjectMatchScore, 10, 60);
    parsed.tunedConfig.actorAffinityScore = clamp(parsed.tunedConfig.actorAffinityScore, 0, 40);
    parsed.tunedConfig.tagMatchScore = clamp(parsed.tunedConfig.tagMatchScore ?? 15, 0, 50);
    parsed.tunedConfig.timeDecayFreshDays = clamp(parsed.tunedConfig.timeDecayFreshDays, 14, 120);

    // Persist learned config + vocabulary
    const newRunCount = schema.calibrationRunCount + 1;
    const totalFeedbackSignals = corrections.length;

    // Phase transition logic
    let newPhase = phase;
    if (phase === "CALIBRATING" && newRunCount >= 3 && totalFeedbackSignals >= 5) {
      newPhase = "TRACKING";
    }

    await prisma.caseSchema.update({
      where: { id: schemaId },
      data: {
        tunedClusteringConfig: {
          ...config,
          mergeThreshold: parsed.tunedConfig.mergeThreshold,
          subjectMatchScore: parsed.tunedConfig.subjectMatchScore,
          actorAffinityScore: parsed.tunedConfig.actorAffinityScore,
          tagMatchScore: parsed.tunedConfig.tagMatchScore,
          timeDecayDays: { fresh: parsed.tunedConfig.timeDecayFreshDays },
        } as any,
        discriminatorVocabulary: parsed.discriminatorVocabulary as any,
        calibrationRunCount: newRunCount,
        qualityPhase: newPhase,
      },
    });

    // Store in PipelineIntelligence
    await prisma.pipelineIntelligence.create({
      data: {
        schemaId,
        scanJobId,
        stage: "clustering-calibration",
        input: { corrections: corrections.length, phase } as any,
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
        emailId: "calibration",
        scanJobId,
        model: "claude-sonnet-4-6",
        operation: "clustering-calibration",
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        estimatedCostUsd: estimatedCost,
        latencyMs: aiResult.latencyMs,
      },
    });

    logger.info({
      service: "cluster",
      operation: "applyCalibration",
      schemaId,
      phase,
      newPhase,
      runCount: newRunCount,
      reasoning: parsed.reasoning.slice(0, 200),
    });
  } catch (error) {
    logger.error({
      service: "cluster",
      operation: "applyCalibration.error",
      schemaId,
      error,
    });
    // Non-fatal: calibration failure doesn't block the pipeline
  }
}

// ---------------------------------------------------------------------------
// Backward compat: keep clusterNewEmails as an alias during transition
// ---------------------------------------------------------------------------
export async function clusterNewEmails(
  schemaId: string,
  scanJobId?: string,
): Promise<ClusterResult> {
  return coarseCluster(schemaId, scanJobId);
}
