/**
 * POST /api/onboarding/start
 *
 * Claims an onboarding session. The client generates a stable id (e.g. a
 * ULID) and sends it as `schemaId`. If a row with that id already exists
 * for this user, the request is idempotent — we return the existing id
 * without side effects, which lets the client retry safely.
 *
 * ## Transactional outbox pattern (#33)
 *
 * The route writes the `CaseSchema` stub AND an `OnboardingOutbox` row
 * inside a **single Prisma transaction**, then fires a best-effort
 * `inngest.send` after the transaction commits for happy-path latency.
 * The `drainOnboardingOutbox` cron function (see
 * `lib/inngest/onboarding-outbox-drain.ts`) is the guaranteed recovery
 * path for the case where the optimistic emit fails.
 *
 * This replaces an earlier two-path fast/slow structure that used an
 * exception-control `P2002` catch scattered across both `CaseSchema.id`
 * and a later re-resolve step. That structure papered over a TOCTOU race
 * but left an Inngest-outage stranding mode unfixed — if the stub
 * committed and the `inngest.send` then threw, the stub was stranded in
 * `phase=PENDING` with no workflow ever running, and the next retry with
 * the same schemaId hit the idempotency branch and returned 202 without
 * re-emitting. See issue #33 for the full analysis.
 *
 * Under the new structure:
 *
 *   - **TOCTOU race** — the `onboarding_outbox.schemaId` primary key is
 *     the sole idempotency guard. Concurrent POSTs with the same ULID
 *     either commit the tx (winner) or abort on the unique constraint
 *     (losers), and the loser branch re-resolves the winner from the
 *     outbox table. One catch site, one constraint.
 *
 *   - **Inngest-outage stranding** — `inngest.send` is fire-and-forget
 *     after the commit. If it fails, the drain cron picks the row up
 *     within ~1 minute, re-emits, and advances the schema. The client
 *     sees the same 202 either way.
 *
 * ## Duplicate emission safety
 *
 * Both the optimistic route-side send and the drain can emit the same
 * event. `runOnboarding` uses `advanceSchemaPhase` CAS guards and
 * no-ops when the schema has already moved past PENDING, so double
 * emission is safe.
 */
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { createSchemaStub } from "@/lib/services/interview";
import { InterviewInputSchema } from "@/lib/validation/interview";

function gmailNotConnected(): NextResponse {
  return NextResponse.json(
    {
      error: "Gmail not connected. Please connect Gmail first.",
      code: 422,
      type: "GMAIL_NOT_CONNECTED",
    },
    { status: 422 },
  );
}

const StartBodySchema = z.object({
  // Minimum-length safety net for client-supplied ids. Real clients send a
  // ULID (26 chars) or cuid (25 chars). Anything shorter is almost certainly
  // a bug, not a well-formed id.
  schemaId: z.string().min(10),
  inputs: InterviewInputSchema,
});

/**
 * Duck-typed check for Prisma's `P2002 Unique constraint failed`. We don't
 * import the runtime `PrismaClientKnownRequestError` class because it
 * lives in the generated client path (`@prisma/client/runtime`) which is
 * aliased in the vitest config — relying on `instanceof` across the
 * aliased + non-aliased builds is brittle. The `code` string is part of
 * Prisma's public error contract and is stable across versions.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden", code: 403, type: "FORBIDDEN" }, { status: 403 });
}

function accepted(schemaId: string, idempotent: boolean): NextResponse {
  return NextResponse.json({ data: { schemaId, idempotent } }, { status: 202 });
}

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = StartBodySchema.parse(await request.json());
    const { schemaId, inputs } = body;

    // -----------------------------------------------------------------
    // Pre-flight: verify Gmail tokens exist before creating a schema
    // stub that will immediately fail. A single DB read — no refresh
    // attempt, no Gmail API call. Returns 422 so the connect page can
    // show the "Connect Gmail" button instead of a cryptic pipeline error.
    // -----------------------------------------------------------------
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleTokens: true },
    });
    if (!user?.googleTokens) {
      return gmailNotConnected();
    }

    // -----------------------------------------------------------------
    // Fast path: sequential-retry idempotency check. Reads the outbox
    // (not case_schemas) because the outbox is the source of truth for
    // "this onboarding session has already been claimed".
    //
    // Key is composite (schemaId, eventName) after #67 — here we always
    // look up the `onboarding.session.started` row for this schema.
    // -----------------------------------------------------------------
    const existing = await prisma.onboardingOutbox.findUnique({
      where: {
        schemaId_eventName: {
          schemaId,
          eventName: "onboarding.session.started",
        },
      },
      select: { userId: true, status: true },
    });

    if (existing) {
      if (existing.userId !== userId) {
        return forbidden();
      }
      logger.info({
        service: "onboarding",
        operation: "start.idempotent",
        userId,
        schemaId,
        outboxStatus: existing.status,
      });
      return accepted(schemaId, true);
    }

    // -----------------------------------------------------------------
    // Slow path: atomic stub + outbox write inside a single transaction.
    // Concurrent POSTs with the same schemaId race into the tx; exactly
    // one commits and the losers hit P2002 on the outbox primary key.
    // -----------------------------------------------------------------
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await createSchemaStub({ tx, schemaId, userId, inputs });
        await tx.onboardingOutbox.create({
          data: {
            schemaId,
            userId,
            eventName: "onboarding.session.started",
            payload: { schemaId, userId } as Prisma.InputJsonValue,
          },
        });
      });
    } catch (createError) {
      if (!isUniqueConstraintViolation(createError)) {
        throw createError;
      }

      // Concurrent request committed between our fast-path check and our
      // transaction. Re-resolve the winner from the outbox and treat this
      // as an idempotent retry. Apply the ownership check in case of a
      // cross-user ULID collision (extremely unlikely but not impossible).
      const winner = await prisma.onboardingOutbox.findUnique({
        where: {
          schemaId_eventName: {
            schemaId,
            eventName: "onboarding.session.started",
          },
        },
        select: { userId: true, status: true },
      });

      if (!winner) {
        // Race-within-a-race: the winning row was rolled back or deleted
        // before we could resolve it. Rethrow so the caller retries.
        throw createError;
      }

      if (winner.userId !== userId) {
        logger.warn({
          service: "onboarding",
          operation: "start.idempotent.crossUser",
          userId,
          schemaId,
          winnerUserId: winner.userId,
        });
        return forbidden();
      }

      logger.info({
        service: "onboarding",
        operation: "start.idempotent.raceLost",
        userId,
        schemaId,
        outboxStatus: winner.status,
      });
      return accepted(schemaId, true);
    }

    logger.info({
      service: "onboarding",
      operation: "start.created",
      userId,
      schemaId,
    });

    // -----------------------------------------------------------------
    // Best-effort optimistic emit. Preserves sub-second happy-path
    // latency when Inngest is healthy. If it fails, the drain cron
    // (runs every minute) retries automatically. We do NOT await this
    // promise — the client has already been told the session is claimed.
    // -----------------------------------------------------------------
    void inngest
      .send({
        name: "onboarding.session.started",
        data: { schemaId, userId },
      })
      .then(() =>
        prisma.onboardingOutbox.update({
          where: {
            schemaId_eventName: {
              schemaId,
              eventName: "onboarding.session.started",
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
          operation: "start.optimisticEmitFailed",
          userId,
          schemaId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return accepted(schemaId, false);
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "start",
      userId,
    });
  }
});
