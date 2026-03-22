import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { FeedbackInput } from "@/lib/validation/feedback";
import { NotFoundError } from "@denim/types";

interface FeedbackResult {
  eventId: string;
}

/**
 * Record a feedback event. Write owner for FeedbackEvent table.
 * Also handles side effects for specific event types.
 */
export async function recordFeedback(
  input: FeedbackInput,
  userId: string,
): Promise<FeedbackResult> {
  const start = Date.now();

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
  }

  if ((input.type === "THUMBS_UP" || input.type === "THUMBS_DOWN") && input.caseId) {
    await prisma.case.update({
      where: { id: input.caseId },
      data: { feedbackRating: input.type === "THUMBS_UP" ? "up" : "down" },
    });
  }

  const durationMs = Date.now() - start;
  logger.info({
    service: "feedback",
    operation: "recordFeedback",
    userId,
    schemaId: input.schemaId,
    type: input.type,
    eventId: event.id,
    durationMs,
  });

  return { eventId: event.id };
}
