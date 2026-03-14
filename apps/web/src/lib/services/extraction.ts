/**
 * ExtractionService — processes raw Gmail messages through Gemini Flash
 * to produce rich metadata records stored in the Email table.
 *
 * Write owner for: Email, EmailAttachment
 * Also increments: SchemaTag.emailCount, CaseSchema.emailCount, Entity.emailCount
 */

import { callGemini } from "@/lib/ai/client";
import { GmailClient } from "@/lib/gmail/client";
import type { GmailMessageFull } from "@/lib/gmail/types";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type {
  ExtractionInput,
  ExtractionResult,
  ExtractionSchemaContext,
} from "@denim/types";
import { buildExtractionPrompt, parseExtractionResponse } from "@denim/ai";
import { resolveEntity } from "@denim/engine";
import { matchesExclusionRule } from "./exclusion";

const GEMINI_MODEL = "gemini-2.5-flash";

// Gemini Flash 2.5 pricing (per token)
const GEMINI_INPUT_COST = 0.00000015;
const GEMINI_OUTPUT_COST = 0.0000006;

interface ExtractEmailOptions {
  schemaId: string;
  scanJobId?: string;
  userId?: string;
}

interface ExtractEmailResult {
  emailId: string;
  excluded: boolean;
  failed: boolean;
}

interface ProcessBatchResult {
  processed: number;
  excluded: number;
  failed: number;
}

/**
 * Build ExtractionSchemaContext from a loaded schema with relations.
 */
function buildSchemaContext(schema: {
  domain: string | null;
  tags: { name: string; description: string | null; isActive: boolean }[];
  entities: { name: string; type: string; aliases: unknown; isActive: boolean }[];
  extractedFields: { name: string; type: string; description: string; source: string }[];
  exclusionRules: { ruleType: string; pattern: string; isActive: boolean }[];
}): ExtractionSchemaContext {
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
      })),
    extractedFields: schema.extractedFields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description,
      source: f.source,
    })),
    exclusionPatterns: schema.exclusionRules
      .filter((r) => r.isActive)
      .map((r) => r.pattern),
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
      },
      update: {
        isExcluded: true,
        excludeReason: `rule:${exclusionCheck.rule!.ruleType.toLowerCase()}`,
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

    return { emailId: email.id, excluded: true, failed: false };
  }

  // 2. Build prompt and call Gemini
  const extractionInput = toExtractionInput(gmailMessage);
  const prompt = buildExtractionPrompt(extractionInput, schemaContext);

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

  // 4. Resolve sender to entity
  const entityMatch = resolveEntity(
    gmailMessage.senderDisplayName,
    gmailMessage.senderEmail,
    entities,
  );

  // Find entity IDs if matched
  let senderEntityId: string | null = null;
  if (entityMatch) {
    const entity = await prisma.entity.findFirst({
      where: {
        schemaId,
        name: entityMatch.entityName,
        type: entityMatch.entityType,
        isActive: true,
      },
      select: { id: true },
    });
    senderEntityId = entity?.id ?? null;
  }

  // 5. Upsert Email row in a transaction
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
      },
      update: {
        summary: parsed.summary,
        tags: parsed.tags,
        extractedData: parsed.extractedData as any,
        detectedEntities: parsed.detectedEntities as any,
        isInternal: parsed.isInternal,
        language: parsed.language,
        bodyLength: gmailMessage.body.length,
        attachmentCount: gmailMessage.attachmentCount,
        senderEntityId,
        reprocessedAt: new Date(),
      },
    });

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

    // Increment CaseSchema.emailCount
    await tx.caseSchema.update({
      where: { id: schemaId },
      data: { emailCount: { increment: 1 } },
    });

    // Increment Entity.emailCount if entity resolved
    if (senderEntityId) {
      await tx.entity.update({
        where: { id: senderEntityId },
        data: { emailCount: { increment: 1 } },
      });
    }

    return emailRow;
  });

  // 7. Write ExtractionCost row (outside transaction — non-critical)
  const estimatedCost =
    aiResult.inputTokens * GEMINI_INPUT_COST +
    aiResult.outputTokens * GEMINI_OUTPUT_COST;

  await prisma.extractionCost.create({
    data: {
      emailId: email.id,
      scanJobId,
      model: GEMINI_MODEL,
      operation: "extraction",
      inputTokens: aiResult.inputTokens,
      outputTokens: aiResult.outputTokens,
      estimatedCostUsd: estimatedCost,
      latencyMs: aiResult.latencyMs,
    },
  });

  return { emailId: email.id, excluded: false, failed: false };
}

/**
 * Process a batch of emails: fetch full content from Gmail, extract via Gemini.
 * On individual failure: log and continue. Returns aggregate counts.
 */
export async function processEmailBatch(
  gmailMessageIds: string[],
  accessToken: string,
  schemaContext: ExtractionSchemaContext,
  entities: { name: string; type: "PRIMARY" | "SECONDARY"; aliases: string[] }[],
  exclusionRules: { ruleType: string; pattern: string; isActive: boolean }[],
  options: ExtractEmailOptions,
): Promise<ProcessBatchResult> {
  const gmailClient = new GmailClient(accessToken);
  let processed = 0;
  let excluded = 0;
  let failed = 0;

  for (const messageId of gmailMessageIds) {
    try {
      // Fetch full email with pacing (100ms delay between calls)
      const fullMessage = await gmailClient.getEmailFullWithPacing(messageId, 100);

      const result = await extractEmail(
        fullMessage,
        schemaContext,
        entities,
        exclusionRules,
        options,
      );

      if (result.excluded) {
        excluded++;
      } else {
        processed++;
      }
    } catch (error) {
      failed++;
      logger.error({
        service: "extraction",
        operation: "extractEmail.error",
        schemaId: options.schemaId,
        error,
        messageId,
      });
    }
  }

  return { processed, excluded, failed };
}
