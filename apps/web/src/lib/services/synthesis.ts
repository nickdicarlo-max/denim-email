/**
 * SynthesisService — enriches Case shells with AI-generated content.
 *
 * Write owner for: Case (updates title/summary/displayTags/primaryActor/status),
 *                  CaseAction (creates/updates)
 *
 * Takes case shells from clustering (which have subject-based titles) and calls
 * Claude to generate rich titles, summaries, display tags, primary actors, and
 * action items. Also aggregates extracted field data per ExtractedFieldDef.
 */

import { Prisma } from "@prisma/client";
import { callClaude } from "@/lib/ai/client";
import { MODEL_PRICING } from "@/lib/ai/cost-constants";
import { logAICost } from "@/lib/ai/cost-tracker";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { logger } from "@/lib/logger";
import { withLogging } from "@/lib/logger-helpers";
import { prisma } from "@/lib/prisma";

/** Safely parse a date string, returning null if invalid. */
function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

import { buildSynthesisPrompt, parseSynthesisResponse } from "@denim/ai";
import {
  computeCaseDecay,
  computeNextActionDate,
  generateFingerprint,
  matchAction,
} from "@denim/engine";
import type { SynthesisEmailInput, SynthesisResult, SynthesisSchemaContext } from "@denim/types";

interface AggregationFieldDef {
  name: string;
  type: string;
  aggregation: string;
}

/**
 * Aggregate extracted field data from emails per field definition.
 */
function aggregateFieldData(
  emails: Array<{ extractedData: Record<string, unknown>; date: Date }>,
  fieldDefs: AggregationFieldDef[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fieldDefs) {
    const values = emails
      .map((e) => ({ value: e.extractedData[field.name], date: e.date }))
      .filter((v) => v.value != null);

    if (values.length === 0) continue;

    switch (field.aggregation) {
      case "SUM": {
        const sum = values.reduce((acc, v) => acc + (Number(v.value) || 0), 0);
        result[field.name] = sum;
        break;
      }
      case "LATEST": {
        const sorted = [...values].sort((a, b) => b.date.getTime() - a.date.getTime());
        result[field.name] = sorted[0].value;
        break;
      }
      case "MAX": {
        const max = Math.max(...values.map((v) => Number(v.value) || 0));
        result[field.name] = max;
        break;
      }
      case "MIN": {
        const min = Math.min(...values.map((v) => Number(v.value) || 0));
        result[field.name] = min;
        break;
      }
      case "COUNT": {
        result[field.name] = values.length;
        break;
      }
      case "FIRST": {
        const sortedAsc = [...values].sort((a, b) => a.date.getTime() - b.date.getTime());
        result[field.name] = sortedAsc[0].value;
        break;
      }
    }
  }

  return result;
}

interface SynthesizeCaseMetrics {
  skipped?: boolean;
  emailCount?: number;
  actionCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

/**
 * Synthesize a single case: call Claude, parse response, write results.
 */
export async function synthesizeCase(
  caseId: string,
  schemaId: string,
  scanJobId?: string,
): Promise<void> {
  await withLogging<SynthesizeCaseMetrics>(
    {
      service: "synthesis",
      operation: "synthesizeCase",
      context: { caseId, schemaId },
    },
    () => synthesizeCaseImpl(caseId, schemaId, scanJobId),
    (metrics) => ({ ...metrics }),
  );
}

async function synthesizeCaseImpl(
  caseId: string,
  schemaId: string,
  scanJobId?: string,
): Promise<SynthesizeCaseMetrics> {
  // 0. Skip guard: don't re-synthesize cases with no new emails
  const caseCheck = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    select: { synthesizedAt: true },
  });

  if (caseCheck.synthesizedAt) {
    const newEmailCount = await prisma.caseEmail.count({
      where: {
        caseId,
        assignedAt: { gt: caseCheck.synthesizedAt },
      },
    });

    if (newEmailCount === 0) {
      logger.info({
        service: "synthesis",
        operation: "synthesizeCase.skipped",
        caseId,
        schemaId,
        reason: "already_synthesized_no_new_emails",
        synthesizedAt: caseCheck.synthesizedAt.toISOString(),
      });
      return { skipped: true };
    }
  }

  // 1. Load case with emails
  const caseRecord = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    select: {
      id: true,
      entityId: true,
      caseEmails: {
        select: {
          email: {
            select: {
              id: true,
              subject: true,
              senderDisplayName: true,
              senderEmail: true,
              date: true,
              summary: true,
              tags: true,
              isReply: true,
              extractedData: true,
              senderEntityId: true,
            },
          },
        },
        orderBy: { email: { date: "asc" } },
      },
    },
  });

  const emails = caseRecord.caseEmails.map((ce) => ce.email);

  if (emails.length === 0) {
    logger.warn({
      service: "synthesis",
      operation: "synthesizeCase.noEmails",
      caseId,
      schemaId,
    });
    return { emailCount: 0 };
  }

  // 2. Load schema context
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: schemaId },
    select: {
      domain: true,
      summaryLabels: true,
      tags: {
        where: { isActive: true },
        select: { name: true, description: true },
      },
      entities: {
        where: { isActive: true },
        select: { name: true, type: true },
      },
      extractedFields: {
        select: { name: true, type: true, description: true, aggregation: true },
      },
    },
  });

  const summaryLabels = schema.summaryLabels as {
    beginning: string;
    middle: string;
    end: string;
  };

  const schemaContext: SynthesisSchemaContext = {
    domain: schema.domain ?? "general",
    summaryLabels,
    tags: schema.tags.map((t) => ({
      name: t.name,
      description: t.description ?? "",
    })),
    entities: schema.entities.map((e) => ({
      name: e.name,
      type: e.type,
    })),
    extractedFields: schema.extractedFields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description,
    })),
  };

  // 3. Build email inputs for prompt
  const emailInputs: SynthesisEmailInput[] = emails.map((e) => ({
    id: e.id,
    subject: e.subject,
    senderDisplayName: e.senderDisplayName,
    senderEmail: e.senderEmail,
    date: e.date.toISOString(),
    summary: e.summary,
    tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
    isReply: e.isReply,
  }));

  // 4. Build prompt and call Claude
  const today = new Date().toISOString().slice(0, 10);
  const prompt = buildSynthesisPrompt(emailInputs, schemaContext, today);

  const aiResult = await callClaude({
    model: "claude-sonnet-4-6",
    system: prompt.system,
    user: prompt.user,
    maxTokens: ONBOARDING_TUNABLES.synthesis.maxTokens,
    schemaId,
    operation: "synthesis",
  });

  // 5. Parse response
  let synthesisResult: SynthesisResult;
  try {
    synthesisResult = parseSynthesisResponse(aiResult.content);
  } catch (parseError) {
    logger.error({
      service: "synthesis",
      operation: "synthesizeCase.parseError",
      caseId,
      schemaId,
      error: parseError,
      rawContent: aiResult.content.slice(0, 500),
    });
    throw parseError;
  }

  // 6. Load existing actions for dedup
  const existingActions = await prisma.caseAction.findMany({
    where: { caseId },
    select: { id: true, fingerprint: true, sourceEmailIds: true },
  });

  const existingFingerprints = existingActions
    .map((a) => a.fingerprint)
    .filter((fp): fp is string => fp !== null);

  // 7. Aggregate extracted field data
  const emailsWithData = emails.map((e) => ({
    extractedData: (e.extractedData ?? {}) as Record<string, unknown>,
    date: e.date,
  }));

  const aggregatedData = aggregateFieldData(
    emailsWithData,
    schema.extractedFields.map((f) => ({
      name: f.name,
      type: f.type,
      aggregation: f.aggregation,
    })),
  );

  // 8. Determine last sender info for denormalized fields
  const lastEmail = emails[emails.length - 1];
  const lastSenderName = lastEmail.senderDisplayName;

  // Try to resolve sender entity name for lastSenderEntity
  let lastSenderEntity: string | null = null;
  if (lastEmail.senderEntityId) {
    const senderEntity = await prisma.entity.findUnique({
      where: { id: lastEmail.senderEntityId },
      select: { name: true, secondaryTypeName: true },
    });
    if (senderEntity) {
      lastSenderEntity = senderEntity.secondaryTypeName
        ? `${lastSenderName}, ${senderEntity.secondaryTypeName}`
        : lastSenderName;
    }
  }

  // 9. Write everything in a transaction
  await prisma.$transaction(async (tx) => {
    // Update Case with synthesis results
    // If urgency is IRRELEVANT, auto-resolve the case
    const effectiveStatus =
      synthesisResult.urgency === "IRRELEVANT" ? ("RESOLVED" as const) : synthesisResult.status;

    await tx.case.update({
      where: { id: caseId },
      data: {
        title: synthesisResult.title,
        emoji: synthesisResult.emoji ?? null,
        mood: synthesisResult.mood ?? "NEUTRAL",
        summary: synthesisResult.summary,
        displayTags: synthesisResult.displayTags,
        primaryActor: synthesisResult.primaryActor ?? Prisma.JsonNull,
        status: effectiveStatus,
        urgency: synthesisResult.urgency,
        aggregatedData: aggregatedData as Prisma.InputJsonValue,
        lastSenderName,
        lastSenderEntity,
        synthesizedAt: new Date(),
      },
    });

    // Create/update CaseAction rows
    for (const action of synthesisResult.actions) {
      const fingerprint = generateFingerprint(action.title);
      const match = matchAction(fingerprint, existingFingerprints);

      if (match) {
        // Update existing action
        const existingAction = existingActions.find((a) => a.fingerprint === match);
        if (existingAction) {
          const currentSourceIds = Array.isArray(existingAction.sourceEmailIds)
            ? (existingAction.sourceEmailIds as string[])
            : [];
          const newSourceIds = action.sourceEmailId
            ? [...new Set([...currentSourceIds, action.sourceEmailId])]
            : currentSourceIds;

          await tx.caseAction.update({
            where: { id: existingAction.id },
            data: {
              title: action.title,
              description: action.description,
              dueDate: safeDate(action.dueDate) ?? undefined,
              eventStartTime: safeDate(action.eventStartTime) ?? undefined,
              eventEndTime: safeDate(action.eventEndTime) ?? undefined,
              eventLocation: action.eventLocation,
              confidence: action.confidence,
              amount: action.amount,
              currency: action.currency,
              sourceEmailIds: newSourceIds,
              lastUpdatedByEmailId: action.sourceEmailId,
              reminderCount: { increment: 1 },
            },
          });
        }
      } else {
        // Create new action
        const sourceEmailIds = action.sourceEmailId ? [action.sourceEmailId] : [];

        await tx.caseAction.create({
          data: {
            caseId,
            schemaId,
            title: action.title,
            description: action.description,
            actionType: action.actionType,
            dueDate: safeDate(action.dueDate),
            eventStartTime: safeDate(action.eventStartTime),
            eventEndTime: safeDate(action.eventEndTime),
            eventLocation: action.eventLocation,
            confidence: action.confidence,
            amount: action.amount,
            currency: action.currency,
            fingerprint,
            sourceEmailIds,
            createdByEmailId: action.sourceEmailId,
            status: "PENDING",
          },
        });
      }
    }

    // Compute nextActionDate from all PENDING actions for this case
    const allPendingActions = await tx.caseAction.findMany({
      where: { caseId, status: "PENDING" },
      select: { dueDate: true, eventStartTime: true, status: true },
    });
    const nextActionDate = computeNextActionDate(
      allPendingActions.map((a) => ({
        status: a.status as "PENDING",
        dueDate: a.dueDate,
        eventStartTime: a.eventStartTime,
      })),
    );
    await tx.case.update({
      where: { id: caseId },
      data: { nextActionDate },
    });
  });

  // 10. Deterministic urgency + decay via computeCaseDecay
  const nowForDecay = new Date();
  const currentCase = await prisma.case.findUnique({
    where: { id: caseId },
    select: { status: true, urgency: true, lastEmailDate: true },
  });
  if (currentCase) {
    const freshActions = await prisma.caseAction.findMany({
      where: { caseId },
      select: { id: true, status: true, dueDate: true, eventStartTime: true, eventEndTime: true },
    });
    const decay = computeCaseDecay(
      {
        caseStatus: currentCase.status,
        caseUrgency: currentCase.urgency ?? "UPCOMING",
        actions: freshActions.map((a) => ({
          id: a.id,
          status: a.status as "PENDING" | "DONE" | "EXPIRED" | "SUPERSEDED" | "DISMISSED",
          dueDate: a.dueDate,
          eventStartTime: a.eventStartTime,
          eventEndTime: a.eventEndTime,
        })),
        lastEmailDate: currentCase.lastEmailDate ?? nowForDecay,
      },
      nowForDecay,
    );
    if (decay.changed) {
      if (decay.expiredActionIds.length > 0) {
        await prisma.caseAction.updateMany({
          where: { id: { in: decay.expiredActionIds } },
          data: { status: "EXPIRED" },
        });
      }
      await prisma.case.update({
        where: { id: caseId },
        data: {
          urgency: decay.updatedUrgency,
          status: decay.updatedStatus,
          nextActionDate: decay.nextActionDate,
        },
      });
    }
  }

  // 11. Log extraction cost
  const claudePricing = MODEL_PRICING["claude-sonnet-4-6"];
  const estimatedCost =
    aiResult.inputTokens * claudePricing.inputCostPerToken +
    aiResult.outputTokens * claudePricing.outputCostPerToken;

  await logAICost(
    {
      inputTokens: aiResult.inputTokens,
      outputTokens: aiResult.outputTokens,
      latencyMs: aiResult.latencyMs,
      fromCache: aiResult.fromCache,
    },
    {
      emailId: emails[0].id,
      scanJobId: scanJobId ?? null,
      model: "claude-sonnet-4-6",
      operation: "synthesis",
    },
  );

  return {
    emailCount: emails.length,
    actionCount: synthesisResult.actions.length,
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    estimatedCostUsd: estimatedCost,
  };
}
