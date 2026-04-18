/**
 * POST /api/onboarding/:schemaId/domain-confirm — Issue #95 Stage 2 trigger.
 *
 * Wires the user's Stage 1 domain confirmations into Stage 2 entity
 * discovery. Mirrors the pattern established by POST /api/onboarding/start
 * and POST /api/onboarding/[schemaId] (#33, #67):
 *
 *   1. Validate body with Zod (handleApiError maps ZodError → 400).
 *   2. Ownership check via assertResourceOwnership (404/403 on mismatch).
 *   3. Single Prisma transaction:
 *        - CAS `updateMany` (gated on phase=AWAITING_DOMAIN_CONFIRMATION)
 *          via `writeStage2ConfirmedDomains`. count=0 means another request
 *          won the race OR the schema is in the wrong phase — return 409.
 *        - Insert OnboardingOutbox row (event: onboarding.entity-discovery.requested).
 *   4. Optimistic best-effort `inngest.send`; on success update the outbox
 *      row to EMITTED so the drain cron (1-min tick, `PENDING_EMIT` +
 *      nextAttemptAt ≤ now) does not re-emit the same event. If the send
 *      fails, the row stays PENDING_EMIT and the drain re-emits within
 *      ~1 minute.
 *
 * CAS transition ownership: AWAITING_DOMAIN_CONFIRMATION → DISCOVERING_ENTITIES.
 */
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { assertResourceOwnership } from "@/lib/middleware/ownership";
import { extractOnboardingSchemaId } from "@/lib/middleware/request-params";
import { prisma } from "@/lib/prisma";
import { writeStage2ConfirmedDomains } from "@/lib/services/interview";

const BodySchema = z.object({
  // DNS label charset + length; rejects spaces, @-prefixes, control chars.
  confirmedDomains: z
    .array(
      z
        .string()
        .min(1)
        .max(253)
        .regex(/^[a-z0-9.-]+$/i),
    )
    .min(1)
    .max(20),
});

export const POST = withAuth(async ({ userId, request }) => {
  let schemaId: string | undefined;
  try {
    schemaId = extractOnboardingSchemaId(request);
    const body = BodySchema.parse(await request.json());

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true, phase: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // Atomic CAS + outbox. If updateMany matches 0 rows (wrong phase or
    // concurrent click), short-circuit without writing the outbox row.
    const updatedCount = await prisma.$transaction(async (tx) => {
      const count = await writeStage2ConfirmedDomains(tx, schemaId!, body.confirmedDomains);
      if (count === 0) return 0;
      await tx.onboardingOutbox.create({
        data: {
          schemaId: schemaId!,
          userId,
          eventName: "onboarding.entity-discovery.requested",
          payload: { schemaId, userId } as Prisma.InputJsonValue,
        },
      });
      return count;
    });

    if (updatedCount === 0) {
      return NextResponse.json(
        { error: "Wrong phase or already confirmed", code: 409, type: "CONFLICT" },
        { status: 409 },
      );
    }

    logger.info({
      service: "onboarding",
      operation: "domain-confirm",
      userId,
      schemaId,
      confirmedDomainCount: body.confirmedDomains.length,
    });

    // Best-effort optimistic emit. On success, flip the outbox row to
    // EMITTED so the drain cron skips it. On failure, leave it PENDING_EMIT
    // and the cron picks it up within ~1 minute.
    void inngest
      .send({
        name: "onboarding.entity-discovery.requested",
        data: { schemaId, userId },
      })
      .then(() =>
        prisma.onboardingOutbox.update({
          where: {
            schemaId_eventName: {
              schemaId: schemaId!,
              eventName: "onboarding.entity-discovery.requested",
            },
          },
          data: {
            status: "EMITTED",
            emittedAt: new Date(),
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        }),
      )
      .catch((err: unknown) => {
        logger.warn({
          service: "onboarding",
          operation: "domain-confirm.optimisticEmitFailed",
          userId,
          schemaId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "domain-confirm",
      userId,
      schemaId,
    });
  }
});
