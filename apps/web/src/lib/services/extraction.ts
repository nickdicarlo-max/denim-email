/**
 * ExtractionService — processes raw Gmail messages through Gemini Flash
 * to produce rich metadata records stored in the Email table.
 *
 * Write owner for: Email, EmailAttachment
 * Also increments: SchemaTag.emailCount, Entity.emailCount
 * (CaseSchema email/case counts are now compute-on-demand via scan-metrics.)
 */

import {
  buildBatchExtractionPrompt,
  buildExtractionPrompt,
  parseBatchExtraction,
  parseExtractionResponse,
} from "@denim/ai";
import { resolveEntity } from "@denim/engine";
import type { ExtractionInput, ExtractionResult, ExtractionSchemaContext } from "@denim/types";
import { callGemini } from "@/lib/ai/client";
import { logAICost } from "@/lib/ai/cost-tracker";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { GmailClient } from "@/lib/gmail/client";
import type { GmailMessageFull } from "@/lib/gmail/types";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { matchesExclusionRule } from "./exclusion";

const GEMINI_MODEL = "gemini-2.5-flash";

interface ExtractEmailOptions {
  schemaId: string;
  scanJobId?: string;
  userId?: string;
}

interface ExtractEmailResult {
  emailId: string;
  excluded: boolean;
}

interface ProcessBatchResult {
  processed: number;
  excluded: number;
  // `failed` is no longer a denormalized counter — derive it via
  // computeScanMetrics (which reads ScanFailure rows written per email
  // in the catch block of processEmailBatch below).
}

/**
 * Build ExtractionSchemaContext from a loaded schema with relations.
 */
export function buildSchemaContext(schema: {
  domain: string | null;
  tags: { name: string; description: string | null; isActive: boolean }[];
  entities: {
    name: string;
    type: string;
    aliases: unknown;
    isActive: boolean;
    autoDetected: boolean;
  }[];
  extractedFields: { name: string; type: string; description: string; source: string }[];
  exclusionRules: { ruleType: string; pattern: string; isActive: boolean }[];
  entityGroups?: { index: number; entities: { name: string; type: string; isActive: boolean }[] }[];
}): ExtractionSchemaContext {
  // Build entity groups for the prompt
  const entityGroups = schema.entityGroups
    ?.sort((a, b) => a.index - b.index)
    .map((g) => ({
      whats: g.entities.filter((e) => e.type === "PRIMARY" && e.isActive).map((e) => e.name),
      whos: g.entities.filter((e) => e.type === "SECONDARY" && e.isActive).map((e) => e.name),
    }));

  return {
    domain: schema.domain ?? "general",
    tags: schema.tags
      .filter((t) => t.isActive)
      .map((t) => ({ name: t.name, description: t.description ?? "" })),
    entities: schema.entities
      .filter((e) => e.isActive)
      .map((e) => ({
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
    exclusionPatterns: schema.exclusionRules.filter((r) => r.isActive).map((r) => r.pattern),
    entityGroups,
  };
}

/**
 * Convert a GmailMessageFull to ExtractionInput for the prompt builder.
 */
function toExtractionInput(msg: GmailMessageFull): ExtractionInput {
  return {
    subject: msg.subject,
    sender: msg.sender,
    senderEmail: msg.senderEmail,
    senderDomain: msg.senderDomain,
    senderDisplayName: msg.senderDisplayName,
    date: msg.date.toISOString(),
    body: msg.body,
    isReply: msg.isReply,
  };
}

/**
 * Extract structured data from a single email via Gemini.
 * Idempotent: upserts on [schemaId, gmailMessageId].
 */
export async function extractEmail(
  gmailMessage: GmailMessageFull,
  schemaContext: ExtractionSchemaContext,
  entities: { name: string; type: "PRIMARY" | "SECONDARY"; aliases: string[] }[],
  exclusionRules: { ruleType: string; pattern: string; isActive: boolean }[],
  options: ExtractEmailOptions,
): Promise<ExtractEmailResult> {
  const { schemaId, scanJobId, userId } = options;

  // 1. Check exclusion rules
  const exclusionCheck = matchesExclusionRule(
    {
      senderEmail: gmailMessage.senderEmail,
      senderDomain: gmailMessage.senderDomain,
      subject: gmailMessage.subject,
      threadId: gmailMessage.threadId,
    },
    exclusionRules,
  );

  if (exclusionCheck.matched) {
    // Upsert minimal Email row as excluded
    const email = await prisma.email.upsert({
      where: {
        schemaId_gmailMessageId: { schemaId, gmailMessageId: gmailMessage.id },
      },
      create: {
        schemaId,
        gmailMessageId: gmailMessage.id,
        threadId: gmailMessage.threadId,
        subject: gmailMessage.subject,
        sender: gmailMessage.sender,
        senderEmail: gmailMessage.senderEmail,
        senderDomain: gmailMessage.senderDomain,
        senderDisplayName: gmailMessage.senderDisplayName,
        recipients: gmailMessage.recipients,
        date: gmailMessage.date,
        isReply: gmailMessage.isReply,
        summary: "",
        isExcluded: true,
        excludeReason: `rule:${exclusionCheck.rule!.ruleType.toLowerCase()}`,
        bodyLength: gmailMessage.body.length,
        firstScanJobId: scanJobId ?? null,
        lastScanJobId: scanJobId ?? null,
      },
      update: {
        isExcluded: true,
        excludeReason: `rule:${exclusionCheck.rule!.ruleType.toLowerCase()}`,
        lastScanJobId: scanJobId ?? undefined,
      },
    });

    // Increment exclusion rule match count
    await prisma.exclusionRule.updateMany({
      where: {
        schemaId,
        ruleType: exclusionCheck.rule!.ruleType as any,
        pattern: exclusionCheck.rule!.pattern,
      },
      data: { matchCount: { increment: 1 } },
    });

    return { emailId: email.id, excluded: true };
  }

  // 2. Build prompt and call Gemini
  const extractionInput = toExtractionInput(gmailMessage);
  const today = new Date().toISOString().slice(0, 10);
  const prompt = buildExtractionPrompt(extractionInput, schemaContext, today);

  const aiResult = await callGemini({
    model: GEMINI_MODEL,
    system: prompt.system,
    user: prompt.user,
    schemaId,
    userId,
    operation: "extraction",
  });

  // 3. Parse AI response
  const parsed: ExtractionResult = parseExtractionResponse(aiResult.content);

  return persistExtractedEmail(gmailMessage, parsed, entities, options, {
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    latencyMs: aiResult.latencyMs,
  });
}

/**
 * Persist a parsed Gemini extraction for a single email. Shared between the
 * single-email (`extractEmail`) path and the batch path (`processEmailBatch`
 * chunked Gemini call). Handles:
 *   - relevance gate
 *   - content-first entity routing
 *   - Email upsert + entity/tag count increments
 *   - ExtractionCost logging
 *
 * Assumes the caller has already cleared the exclusion-rule short-circuit.
 */
async function persistExtractedEmail(
  gmailMessage: GmailMessageFull,
  parsed: ExtractionResult,
  entities: { name: string; type: "PRIMARY" | "SECONDARY"; aliases: string[] }[],
  options: ExtractEmailOptions,
  aiCost: { inputTokens: number; outputTokens: number; latencyMs: number },
): Promise<ExtractEmailResult> {
  const { schemaId, scanJobId } = options;

  // 3a. Check if sender is a known entity (deterministic inclusion bypass)
  const senderEntityMatch = resolveEntity(
    gmailMessage.senderDisplayName,
    gmailMessage.senderEmail,
    entities,
  );
  const senderIsKnownEntity = senderEntityMatch !== null;

  // 3b. Log when a known-entity email bypasses the relevance gate
  if (senderIsKnownEntity && parsed.relevanceScore < ONBOARDING_TUNABLES.extraction.relevanceThreshold) {
    logger.info({
      service: "extraction",
      operation: "relevanceGateBypass",
      schemaId,
      senderName: senderEntityMatch?.entityName,
      relevanceScore: parsed.relevanceScore,
      subject: gmailMessage.subject.slice(0, 60),
    });
  }

  // 3c. Relevance gate: reject emails that don't connect to user-input entities
  // Known entities bypass — their emails are always relevant by definition.
  if (!senderIsKnownEntity && parsed.relevanceScore < ONBOARDING_TUNABLES.extraction.relevanceThreshold) {
    const email = await prisma.email.upsert({
      where: {
        schemaId_gmailMessageId: { schemaId, gmailMessageId: gmailMessage.id },
      },
      create: {
        schemaId,
        gmailMessageId: gmailMessage.id,
        threadId: gmailMessage.threadId,
        subject: gmailMessage.subject,
        sender: gmailMessage.sender,
        senderEmail: gmailMessage.senderEmail,
        senderDomain: gmailMessage.senderDomain,
        senderDisplayName: gmailMessage.senderDisplayName,
        recipients: gmailMessage.recipients,
        date: gmailMessage.date,
        isReply: gmailMessage.isReply,
        summary: parsed.summary,
        isExcluded: true,
        excludeReason: `relevance:low`,
        bodyLength: gmailMessage.body.length,
        routingDecision: {
          relevanceScore: parsed.relevanceScore,
          relevanceEntity: parsed.relevanceEntity,
          senderMatch: null,
          bypassReason: null,
        } as any,
        firstScanJobId: scanJobId ?? null,
        lastScanJobId: scanJobId ?? null,
      },
      update: {
        isExcluded: true,
        excludeReason: `relevance:low`,
        summary: parsed.summary,
        routingDecision: {
          relevanceScore: parsed.relevanceScore,
          relevanceEntity: parsed.relevanceEntity,
          senderMatch: null,
          bypassReason: null,
        } as any,
        lastScanJobId: scanJobId ?? undefined,
      },
    });

    // Still log the extraction cost
    await logAICost(
      {
        inputTokens: aiCost.inputTokens,
        outputTokens: aiCost.outputTokens,
        latencyMs: aiCost.latencyMs,
      },
      {
        emailId: email.id,
        scanJobId,
        model: GEMINI_MODEL,
        operation: "extraction",
      },
    );

    return { emailId: email.id, excluded: true };
  }

  // 4. Content-first entity routing
  // Order: relevanceEntity → content match → detectedEntities → sender (last resort)
  // WHOs are discovery channels, not routing destinations. The WHAT in the email
  // content determines routing. Sender-based routing is only used when no WHAT is
  // found in content, and only when the sender has exactly 1 associated primary.

  let senderEntityId: string | null = null;
  let senderEntityType: "PRIMARY" | "SECONDARY" | null = null;
  let senderPrimaryIds: string[] = [];
  let entityId: string | null = null;
  let routeMethod: string | null = null;
  let routeDetail: string | null = null;

  // Resolve sender entity up-front. Used by Stage 4 (sender-based routing)
  // and by Stage 3b (mid-scan PRIMARY creation trust gate, #76) to decide
  // whether an ambiguous-sender email with a new primary in content should
  // spawn the new entity.
  if (senderEntityMatch) {
    const senderEntity = await prisma.entity.findFirst({
      where: {
        schemaId,
        name: senderEntityMatch.entityName,
        type: senderEntityMatch.entityType,
        isActive: true,
      },
      select: { id: true, type: true, associatedPrimaryIds: true },
    });
    if (senderEntity) {
      senderEntityId = senderEntity.id;
      senderEntityType = senderEntity.type as "PRIMARY" | "SECONDARY";
      senderPrimaryIds = Array.isArray(senderEntity.associatedPrimaryIds)
        ? (senderEntity.associatedPrimaryIds as string[])
        : [];
    }
  }

  // Stage 1: Gemini's relevanceEntity — AI reads the email and names the WHAT
  if (parsed.relevanceEntity) {
    const relevanceMatch = resolveEntity(parsed.relevanceEntity, "", entities, 0.8);
    if (relevanceMatch) {
      const matchedEntity = await prisma.entity.findFirst({
        where: { schemaId, name: relevanceMatch.entityName, isActive: true },
        select: { id: true, type: true, associatedPrimaryIds: true },
      });
      if (matchedEntity?.type === "PRIMARY") {
        entityId = matchedEntity.id;
        routeMethod = "relevance";
        routeDetail = `Gemini relevanceEntity "${parsed.relevanceEntity}" matched PRIMARY "${relevanceMatch.entityName}"`;
      } else if (matchedEntity) {
        const primaryIds = Array.isArray(matchedEntity.associatedPrimaryIds)
          ? (matchedEntity.associatedPrimaryIds as string[])
          : [];
        if (primaryIds.length === 1) {
          entityId = primaryIds[0];
          routeMethod = "relevance";
          routeDetail = `Gemini relevanceEntity "${parsed.relevanceEntity}" matched SECONDARY "${relevanceMatch.entityName}" → single primary`;
        }
        // If multiple associated primaries, don't pick one — fall through to content match
      }
    }
  }

  // Stage 2: Content-based primary match — scan subject + summary for known PRIMARY names
  if (!entityId) {
    const contentText = `${gmailMessage.subject} ${parsed.summary}`.toLowerCase();
    const primaryEntities = entities.filter((e) => e.type === "PRIMARY");
    for (const primary of primaryEntities) {
      const nameLC = primary.name.toLowerCase();
      if (contentText.includes(nameLC)) {
        const matchedEntity = await prisma.entity.findFirst({
          where: { schemaId, name: primary.name, type: "PRIMARY", isActive: true },
          select: { id: true },
        });
        if (matchedEntity) {
          entityId = matchedEntity.id;
          routeMethod = "content";
          routeDetail = `subject/summary contains PRIMARY name "${primary.name}"`;
          break;
        }
      }
      // Also check aliases
      for (const alias of primary.aliases) {
        if (contentText.includes(alias.toLowerCase())) {
          const matchedEntity = await prisma.entity.findFirst({
            where: { schemaId, name: primary.name, type: "PRIMARY", isActive: true },
            select: { id: true },
          });
          if (matchedEntity) {
            entityId = matchedEntity.id;
            routeMethod = "content";
            routeDetail = `subject/summary contains alias "${alias}" of PRIMARY "${primary.name}"`;
            break;
          }
        }
      }
      if (entityId) break;
    }
  }

  // Stage 3: Gemini's detectedEntities — fallback to detected entity list
  if (!entityId && parsed.detectedEntities.length > 0) {
    for (const detected of parsed.detectedEntities) {
      const detectedMatch = resolveEntity(detected.name, "", entities, 0.8);
      if (!detectedMatch) continue;

      const matchedEntity = await prisma.entity.findFirst({
        where: {
          schemaId,
          name: detectedMatch.entityName,
          type: detectedMatch.entityType,
          isActive: true,
        },
        select: { id: true, type: true, associatedPrimaryIds: true },
      });
      if (!matchedEntity) continue;

      if (matchedEntity.type === "PRIMARY") {
        entityId = matchedEntity.id;
        routeMethod = "detected";
        routeDetail = `detectedEntity "${detected.name}" matched PRIMARY "${detectedMatch.entityName}"`;
        break;
      }
      // Secondary detected — only resolve if exactly 1 associated primary
      const primaryIds = Array.isArray(matchedEntity.associatedPrimaryIds)
        ? (matchedEntity.associatedPrimaryIds as string[])
        : [];
      if (primaryIds.length === 1) {
        entityId = primaryIds[0];
        routeMethod = "detected";
        routeDetail = `detectedEntity "${detected.name}" matched SECONDARY "${detectedMatch.entityName}" → single primary`;
        break;
      }
    }
  }

  // Stage 3b: Mid-scan PRIMARY creation (#76). When Gemini detects a
  // PRIMARY-type entity that doesn't match any existing row, upsert it as
  // a new Entity so the email routes into a real case instead of falling
  // to NO_ENTITY. Guarded by a trust gate to avoid entity explosion on
  // noisy content.
  //
  // Trust gate (need at least ONE signal to create):
  //   - sender is a confirmed SECONDARY with >= 2 associated primaries —
  //     those are exactly the emails that would otherwise drop with
  //     "sender ambiguous, skipping" in Stage 4
  //   - subject literally contains the detected entity name — very high
  //     precision (e.g. "1906 Crockett Street-Tiles")
  //   - Gemini confidence >= 0.7 — lower precision but still useful
  if (!entityId && parsed.detectedEntities.length > 0) {
    const senderAmbiguous = senderEntityType === "SECONDARY" && senderPrimaryIds.length >= 2;
    const subjectLC = gmailMessage.subject.toLowerCase();

    for (const detected of parsed.detectedEntities) {
      if (detected.type !== "PRIMARY") continue;

      // Dedup: if resolveEntity finds a close match at the stricter 0.85
      // threshold, treat it as existing (Stage 3 above already tried 0.8).
      const nearMatch = resolveEntity(detected.name, "", entities, 0.85);
      if (nearMatch) continue;

      // Exact-name and alias guard — resolveEntity uses Jaro-Winkler which
      // can miss obvious duplicates with whitespace or case differences.
      const nameLC = detected.name.toLowerCase().trim();
      if (!nameLC) continue;
      const alreadyKnown = entities.some(
        (e) =>
          e.name.toLowerCase() === nameLC ||
          e.aliases.some((a) => a.toLowerCase() === nameLC),
      );
      if (alreadyKnown) continue;

      const subjectContainsName = subjectLC.includes(nameLC);
      const confidenceHigh = detected.confidence >= 0.7;
      if (!senderAmbiguous && !subjectContainsName && !confidenceHigh) continue;

      const trustSignal = subjectContainsName
        ? "subject-contains-name"
        : confidenceHigh
          ? "confidence>=0.7"
          : "sender-ambiguous";

      // Upsert is idempotent under @@unique([schemaId, name, type]) so
      // extraction retries and parallel batches don't create duplicates.
      const newEntity = await prisma.entity.upsert({
        where: {
          schemaId_name_type: { schemaId, name: detected.name, type: "PRIMARY" },
        },
        create: {
          schemaId,
          name: detected.name,
          type: "PRIMARY",
          secondaryTypeName: null,
          aliases: [],
          autoDetected: true,
          confidence: detected.confidence,
          isActive: true,
        },
        update: {},
        select: { id: true },
      });

      entityId = newEntity.id;
      routeMethod = "detected-created";
      routeDetail = `detectedEntity "${detected.name}" (PRIMARY) auto-created (trust: ${trustSignal}, confidence=${detected.confidence})`;

      logger.info({
        service: "extraction",
        operation: "stage3b.primaryCreated",
        schemaId,
        gmailMessageId: gmailMessage.id,
        entityName: detected.name,
        confidence: detected.confidence,
        trustSignal,
      });
      break;
    }
  }

  // Stage 4: Sender match (last resort) — only when no WHAT found in content
  if (!entityId && senderEntityMatch && senderEntityId) {
    if (senderEntityType === "PRIMARY") {
      entityId = senderEntityId;
      routeMethod = "sender";
      routeDetail = `sender "${gmailMessage.senderDisplayName}" matched PRIMARY "${senderEntityMatch.entityName}"`;
    } else {
      if (senderPrimaryIds.length === 1) {
        entityId = senderPrimaryIds[0];
        routeMethod = "sender";
        routeDetail = `sender "${gmailMessage.senderDisplayName}" matched SECONDARY "${senderEntityMatch.entityName}" → single primary`;
      } else if (senderPrimaryIds.length > 1) {
        // Multiple associated primaries — ambiguous, leave null.
        // Stage 3b above has already run and either spawned a new PRIMARY
        // or confirmed no trust signal; this is the terminal sender path.
        routeMethod = null;
        routeDetail = `sender "${gmailMessage.senderDisplayName}" matched SECONDARY "${senderEntityMatch.entityName}" but has ${senderPrimaryIds.length} associated primaries — ambiguous, skipping`;
      }
      // senderPrimaryIds.length === 0 → shared WHO, leave entityId null
    }
  }

  // Build routing decision audit trail
  const routingDecision = {
    method: routeMethod,
    detail: routeDetail,
    relevanceScore: parsed.relevanceScore,
    relevanceEntity: parsed.relevanceEntity,
    detectedEntities: parsed.detectedEntities.map((d) => d.name),
    senderMatch: senderEntityMatch ? senderEntityMatch.entityName : null,
  };

  // 5. Check if email already exists (to decide whether to increment counts)
  const existingEmail = await prisma.email.findUnique({
    where: {
      schemaId_gmailMessageId: { schemaId, gmailMessageId: gmailMessage.id },
    },
    select: { id: true },
  });
  const isNewEmail = !existingEmail;

  // 6. Upsert Email row in a transaction
  const email = await prisma.$transaction(async (tx) => {
    const emailRow = await tx.email.upsert({
      where: {
        schemaId_gmailMessageId: { schemaId, gmailMessageId: gmailMessage.id },
      },
      create: {
        schemaId,
        gmailMessageId: gmailMessage.id,
        threadId: gmailMessage.threadId,
        subject: gmailMessage.subject,
        sender: gmailMessage.sender,
        senderEmail: gmailMessage.senderEmail,
        senderDomain: gmailMessage.senderDomain,
        senderDisplayName: gmailMessage.senderDisplayName,
        recipients: gmailMessage.recipients,
        date: gmailMessage.date,
        isReply: gmailMessage.isReply,
        summary: parsed.summary,
        tags: parsed.tags,
        extractedData: parsed.extractedData as any,
        detectedEntities: parsed.detectedEntities as any,
        isInternal: parsed.isInternal,
        language: parsed.language,
        bodyLength: gmailMessage.body.length,
        attachmentCount: gmailMessage.attachmentCount,
        senderEntityId,
        entityId,
        routingDecision: routingDecision as any,
        firstScanJobId: scanJobId ?? null,
        lastScanJobId: scanJobId ?? null,
      },
      update: {
        summary: parsed.summary,
        tags: parsed.tags,
        extractedData: parsed.extractedData as any,
        detectedEntities: parsed.detectedEntities as any,
        isInternal: parsed.isInternal,
        language: parsed.language,
        isExcluded: false,
        excludeReason: null,
        bodyLength: gmailMessage.body.length,
        attachmentCount: gmailMessage.attachmentCount,
        senderEntityId,
        entityId,
        routingDecision: routingDecision as any,
        reprocessedAt: new Date(),
        // Advance lastScanJobId to the current scan; firstScanJobId stays as-is
        // so scan-metrics can attribute emails to the scan that first ingested them.
        lastScanJobId: scanJobId ?? undefined,
      },
    });

    // Only increment counts for genuinely new emails, not re-processed ones
    if (isNewEmail) {
      // Increment SchemaTag.emailCount for matched tags
      if (parsed.tags.length > 0) {
        await tx.schemaTag.updateMany({
          where: {
            schemaId,
            name: { in: parsed.tags },
            isActive: true,
          },
          data: { emailCount: { increment: 1 } },
        });
      }

      // CaseSchema.emailCount is computed on demand by computeSchemaMetrics
      // (no denormalized counter to increment).

      // Increment Entity.emailCount for sender entity
      if (senderEntityId) {
        await tx.entity.update({
          where: { id: senderEntityId },
          data: { emailCount: { increment: 1 } },
        });
      }

      // Increment Entity.emailCount for primary entity (if different from sender)
      if (entityId && entityId !== senderEntityId) {
        await tx.entity.update({
          where: { id: entityId },
          data: { emailCount: { increment: 1 } },
        });
      }
    }

    return emailRow;
  });

  // 7. Write ExtractionCost row (outside transaction — non-critical)
  await logAICost(
    {
      inputTokens: aiCost.inputTokens,
      outputTokens: aiCost.outputTokens,
      latencyMs: aiCost.latencyMs,
    },
    {
      emailId: email.id,
      scanJobId,
      model: GEMINI_MODEL,
      operation: "extraction",
    },
  );

  return { emailId: email.id, excluded: false };
}

/**
 * Gemini batch extraction chunk size. Packs N emails per Gemini call.
 * Source of truth lives in `onboarding-tunables.ts` so all pipeline
 * fan-out knobs are co-located (#77 follow-up, 2026-04-15).
 */
const CHUNK_SIZE = ONBOARDING_TUNABLES.extraction.chunkSize;

function chunksOf<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error(`chunksOf size must be > 0, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Record a per-email ScanFailure row and log the error. Shared by the
 * single-email and batch paths in `processEmailBatch`.
 */
async function recordExtractionFailure(
  messageId: string,
  error: unknown,
  options: ExtractEmailOptions,
): Promise<void> {
  if (options.scanJobId) {
    await prisma.scanFailure.upsert({
      where: {
        scanJobId_gmailMessageId: {
          scanJobId: options.scanJobId,
          gmailMessageId: messageId,
        },
      },
      create: {
        scanJobId: options.scanJobId,
        schemaId: options.schemaId,
        gmailMessageId: messageId,
        phase: "EXTRACTING",
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? (error.stack ?? null) : null,
      },
      update: {
        attemptCount: { increment: 1 },
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? (error.stack ?? null) : null,
      },
    });
  }

  logger.error({
    service: "extraction",
    operation: "extractEmail.error",
    schemaId: options.schemaId,
    scanJobId: options.scanJobId,
    error,
    messageId,
  });
}

/**
 * Process a batch of emails: fetch full content from Gmail, extract via Gemini.
 *
 * Uses batched Gemini calls (CHUNK_SIZE emails per call) to amortize per-request
 * latency. If a chunk-level call fails (Gemini error, malformed output, length
 * mismatch), falls back to the per-email path (`extractEmail`) for that chunk
 * so a single bad apple can't kill the batch.
 *
 * Exclusion-rule matches short-circuit before Gemini and are handled via the
 * per-email `extractEmail` path (cheap DB-only upsert, no AI cost).
 *
 * On individual failure: log + ScanFailure row and continue. Returns aggregate counts.
 */
export async function processEmailBatch(
  gmailMessageIds: string[],
  accessToken: string,
  schemaContext: ExtractionSchemaContext,
  entities: { name: string; type: "PRIMARY" | "SECONDARY"; aliases: string[] }[],
  exclusionRules: { ruleType: string; pattern: string; isActive: boolean }[],
  options: ExtractEmailOptions,
  /** Optional pre-built client (e.g., FixtureGmailClient for eval). */
  injectedClient?: {
    getEmailFullWithPacing(id: string, delayMs?: number): Promise<GmailMessageFull>;
  },
): Promise<ProcessBatchResult> {
  const gmailClient = injectedClient ?? new GmailClient(accessToken);
  const { schemaId, userId } = options;
  let processed = 0;
  let excluded = 0;

  // Pre-check which emails already exist to skip re-extraction
  const existingEmails = await prisma.email.findMany({
    where: {
      schemaId: options.schemaId,
      gmailMessageId: { in: gmailMessageIds },
    },
    select: { gmailMessageId: true },
  });
  const existingIds = new Set(existingEmails.map((e) => e.gmailMessageId));

  // Phase 1: Gmail fetch + exclusion-rule partitioning.
  // Anything that hits an exclusion rule (or already exists, or fails to
  // fetch) is handled individually and does NOT enter the batch Gemini call.
  const batchCandidates: GmailMessageFull[] = [];

  for (const messageId of gmailMessageIds) {
    if (existingIds.has(messageId)) {
      processed++;
      continue;
    }

    let fullMessage: GmailMessageFull;
    try {
      fullMessage = await gmailClient.getEmailFullWithPacing(
        messageId,
        ONBOARDING_TUNABLES.extraction.gmailPacingMs,
      );
    } catch (error) {
      await recordExtractionFailure(messageId, error, options);
      continue;
    }

    // Check exclusion rule cheaply — if matched, use the per-email path
    // (it does a DB-only upsert without calling Gemini).
    const exclusionCheck = matchesExclusionRule(
      {
        senderEmail: fullMessage.senderEmail,
        senderDomain: fullMessage.senderDomain,
        subject: fullMessage.subject,
        threadId: fullMessage.threadId,
      },
      exclusionRules,
    );

    if (exclusionCheck.matched) {
      try {
        const result = await extractEmail(
          fullMessage,
          schemaContext,
          entities,
          exclusionRules,
          options,
        );
        if (result.excluded) excluded++;
        else processed++;
      } catch (error) {
        await recordExtractionFailure(messageId, error, options);
      }
      continue;
    }

    batchCandidates.push(fullMessage);
  }

  if (batchCandidates.length === 0) {
    return { processed, excluded };
  }

  // Phase 2: Chunked batch Gemini calls with per-email fallback quarantine.
  const today = new Date().toISOString().slice(0, 10);

  for (const chunk of chunksOf(batchCandidates, CHUNK_SIZE)) {
    const extractionInputs = chunk.map(toExtractionInput);
    const prompt = buildBatchExtractionPrompt(extractionInputs, schemaContext, today);

    let parsedResults: ExtractionResult[] | null = null;
    let aiResult: Awaited<ReturnType<typeof callGemini>> | null = null;

    try {
      aiResult = await callGemini({
        model: GEMINI_MODEL,
        system: prompt.system,
        user: prompt.user,
        schemaId,
        userId,
        operation: "extraction",
      });
      parsedResults = parseBatchExtraction(aiResult.content, chunk.length);
    } catch (err) {
      logger.warn({
        service: "extraction",
        operation: "extraction.batch.fallback",
        schemaId,
        chunkSize: chunk.length,
        error: err instanceof Error ? err.message : String(err),
      });
      parsedResults = null;
    }

    if (parsedResults && aiResult) {
      // Amortize AI cost per email in the chunk so cost logs stay per-email.
      const perEmailCost = {
        inputTokens: Math.round(aiResult.inputTokens / chunk.length),
        outputTokens: Math.round(aiResult.outputTokens / chunk.length),
        latencyMs: Math.round(aiResult.latencyMs / chunk.length),
      };

      for (let i = 0; i < chunk.length; i++) {
        const msg = chunk[i];
        const parsed = parsedResults[i];
        try {
          const result = await persistExtractedEmail(
            msg,
            parsed,
            entities,
            options,
            perEmailCost,
          );
          if (result.excluded) excluded++;
          else processed++;
        } catch (error) {
          await recordExtractionFailure(msg.id, error, options);
        }
      }
      continue;
    }

    // Quarantine fallback: run each email through the single-email
    // `extractEmail` path so one bad apple doesn't poison the whole chunk.
    for (const msg of chunk) {
      try {
        const result = await extractEmail(
          msg,
          schemaContext,
          entities,
          exclusionRules,
          options,
        );
        if (result.excluded) excluded++;
        else processed++;
      } catch (error) {
        await recordExtractionFailure(msg.id, error, options);
      }
    }
  }

  return { processed, excluded };
}
