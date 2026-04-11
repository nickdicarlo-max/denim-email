import { NotFoundError, ValidationError } from "@denim/types";
import type { Prisma } from "@prisma/client";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withLogging } from "@/lib/logger-helpers";
import { prisma } from "@/lib/prisma";
import type { FeedbackInput } from "@/lib/validation/feedback";

interface FeedbackResult {
  eventId: string;
}

/**
 * Record a feedback event. Write owner for FeedbackEvent and ExclusionRule tables.
 * Also handles side effects for specific event types:
 * - EMAIL_EXCLUDE: marks email excluded, auto-creates domain ExclusionRule after 3+ excludes
 * - THUMBS_UP/DOWN: updates Case.feedbackRating
 * - EMAIL_MOVE: reassigns email to target case, emits re-synthesis events
 */
export async function recordFeedback(
  input: FeedbackInput,
  userId: string,
): Promise<FeedbackResult> {
  return withLogging<FeedbackResult>(
    {
      service: "feedback",
      operation: "recordFeedback",
      context: { userId, schemaId: input.schemaId, type: input.type },
    },
    async () => {
      // Verify the schema belongs to this user
      const schema = await prisma.caseSchema.findFirst({
        where: { id: input.schemaId, userId },
        select: { id: true },
      });

      if (!schema) {
        throw new NotFoundError("Schema not found");
      }

      // Create the FeedbackEvent (append-only)
      const event = await prisma.feedbackEvent.create({
        data: {
          schemaId: input.schemaId,
          eventType: input.type,
          caseId: input.caseId ?? null,
          emailId: input.emailId ?? null,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        },
      });

      // Side effects by event type
      if (input.type === "EMAIL_EXCLUDE" && input.emailId) {
        await prisma.email.update({
          where: { id: input.emailId },
          data: {
            isExcluded: true,
            excludeReason: "user:manual",
          },
        });

        // Auto-create domain ExclusionRule after 3+ excludes from same domain
        const senderDomain = (input.payload as Record<string, unknown>)?.senderDomain as
          | string
          | undefined;
        if (senderDomain) {
          await maybeCreateDomainExclusionRule(input.schemaId, senderDomain);
        }
      }

      if ((input.type === "THUMBS_UP" || input.type === "THUMBS_DOWN") && input.caseId) {
        await prisma.case.update({
          where: { id: input.caseId },
          data: { feedbackRating: input.type === "THUMBS_UP" ? "up" : "down" },
        });
      }

      if (input.type === "EMAIL_MOVE" && input.emailId && input.caseId) {
        const targetCaseId = (input.payload as Record<string, unknown>)?.targetCaseId as
          | string
          | undefined;
        if (!targetCaseId) {
          throw new ValidationError("EMAIL_MOVE requires payload.targetCaseId");
        }
        await processEmailMove(input.schemaId, input.emailId, input.caseId, targetCaseId);
      }

      return { eventId: event.id };
    },
    (result) => ({ eventId: result.eventId }),
  );
}

/**
 * Move an email from one case to another. Updates CaseEmail, denormalized counts,
 * and emits re-synthesis events for both cases.
 */
async function processEmailMove(
  schemaId: string,
  emailId: string,
  sourceCaseId: string,
  targetCaseId: string,
): Promise<void> {
  // Verify target case exists and belongs to same schema
  const targetCase = await prisma.case.findFirst({
    where: { id: targetCaseId, schemaId },
    select: { id: true },
  });
  if (!targetCase) {
    throw new NotFoundError("Target case not found");
  }

  await prisma.$transaction(async (tx) => {
    // Update CaseEmail to point to target case
    await tx.caseEmail.update({
      where: { emailId },
      data: {
        caseId: targetCaseId,
        wasReassigned: true,
        reassignedAt: new Date(),
        assignedBy: "USER_MOVE",
      },
    });

    // Get email date for denormalized field updates
    const email = await tx.email.findUnique({
      where: { id: emailId },
      select: { date: true, senderDisplayName: true },
    });

    // Update source case: recalculate email count and last email date
    const sourceEmailCount = await tx.caseEmail.count({ where: { caseId: sourceCaseId } });
    const sourceLatest = await tx.caseEmail.findFirst({
      where: { caseId: sourceCaseId },
      include: { email: { select: { date: true } } },
      orderBy: { email: { date: "desc" } },
    });
    await tx.case.update({
      where: { id: sourceCaseId },
      data: {
        lastEmailDate: sourceLatest?.email.date ?? null,
      },
    });

    // Update target case: recalculate last email date
    const targetLatest = await tx.caseEmail.findFirst({
      where: { caseId: targetCaseId },
      include: { email: { select: { date: true, senderDisplayName: true } } },
      orderBy: { email: { date: "desc" } },
    });
    await tx.case.update({
      where: { id: targetCaseId },
      data: {
        lastEmailDate: targetLatest?.email.date ?? null,
        lastSenderName: targetLatest?.email.senderDisplayName ?? null,
      },
    });
  });

  // Emit re-synthesis events for both affected cases (outside transaction)
  await inngest.send([
    {
      name: "feedback.case.modified" as const,
      data: { schemaId, caseId: sourceCaseId, eventType: "EMAIL_MOVE" },
    },
    {
      name: "feedback.case.modified" as const,
      data: { schemaId, caseId: targetCaseId, eventType: "EMAIL_MOVE" },
    },
  ]);
}

/**
 * After 3+ EMAIL_EXCLUDE events from the same sender domain,
 * auto-create a DOMAIN ExclusionRule.
 */
async function maybeCreateDomainExclusionRule(
  schemaId: string,
  senderDomain: string,
): Promise<void> {
  // Count excludes from this domain (use raw query on JSON payload)
  const excludeCount = await prisma.feedbackEvent.count({
    where: {
      schemaId,
      eventType: "EMAIL_EXCLUDE",
      payload: {
        path: ["senderDomain"],
        equals: senderDomain,
      },
    },
  });

  if (excludeCount < 3) return;

  // Check if rule already exists
  const existingRule = await prisma.exclusionRule.findFirst({
    where: {
      schemaId,
      ruleType: "DOMAIN",
      pattern: senderDomain,
    },
  });

  if (existingRule) return;

  await prisma.exclusionRule.create({
    data: {
      schemaId,
      ruleType: "DOMAIN",
      pattern: senderDomain,
      source: "system_suggested",
      isActive: true,
    },
  });

  logger.info({
    service: "feedback",
    operation: "autoCreateExclusionRule",
    schemaId,
    ruleType: "DOMAIN",
    pattern: senderDomain,
    excludeCount,
  });
}
