/**
 * POST /api/onboarding/start
 *
 * Claims an onboarding session. The client generates a stable id (e.g. a
 * ULID) and sends it as `schemaId`. If a row with that id already exists
 * for this user, the request is idempotent — we return the existing id
 * without side effects, which lets the client retry safely.
 *
 * Otherwise we create a CaseSchema stub via `createSchemaStub` (phase=PENDING,
 * status=DRAFT, placeholder JSON configs, raw InterviewInput stashed in
 * `inputs`) and fire `onboarding.session.started` to kick off the
 * `runOnboarding` workflow. The polling endpoint takes over from there.
 *
 * ## Idempotency under concurrent POSTs
 *
 * Two layers of idempotency protect against duplicate schema creation:
 *
 * 1. **Fast path** — the initial `findUnique` catches sequential retries
 *    that arrive after an earlier POST has committed. This is the common
 *    case (client retries, observer page double-fires, etc.).
 *
 * 2. **Slow path** — when N concurrent requests arrive with the same
 *    schemaId *before any of them commits*, they all miss the fast-path
 *    check, race into `createSchemaStub`, and exactly one wins the
 *    Postgres unique-constraint on `CaseSchema.id`. The losers catch the
 *    `P2002` error, re-resolve the winner, apply the ownership check,
 *    and return the idempotent 202 response. This path was previously
 *    broken — losers returned 500, which
 *    `onboarding-concurrent-start.test.ts` now pins as a regression.
 *
 * ## Inngest-outage concern (known limitation, deferred)
 *
 * If `createSchemaStub` commits but `inngest.send` throws (e.g. Inngest
 * dev server unreachable, transient cloud outage), the stub row is
 * stranded in `phase=PENDING` with no workflow ever running. The next
 * retry of the same schemaId hits the fast-path idempotency branch and
 * returns 202 without re-emitting the event, so the client sees success
 * but the workflow is dead. A proper fix needs the idempotent path to
 * detect "PENDING with no ScanJob" and re-emit, or an outbox-pattern
 * write. Not in scope for Task 16 — tracked in the memory progress doc.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { createSchemaStub } from "@/lib/services/interview";
import { InterviewInputSchema } from "@/lib/validation/interview";

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

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = StartBodySchema.parse(await request.json());

    // -----------------------------------------------------------------
    // Fast path: sequential-retry idempotency check.
    // -----------------------------------------------------------------
    const existing = await prisma.caseSchema.findUnique({
      where: { id: body.schemaId },
      select: { id: true, userId: true, phase: true, status: true },
    });

    if (existing) {
      if (existing.userId !== userId) {
        return NextResponse.json(
          { error: "Forbidden", code: 403, type: "FORBIDDEN" },
          { status: 403 },
        );
      }
      logger.info({
        service: "onboarding",
        operation: "start.idempotent",
        userId,
        schemaId: body.schemaId,
        phase: existing.phase,
        status: existing.status,
      });
      return NextResponse.json(
        { data: { schemaId: existing.id, idempotent: true } },
        { status: 202 },
      );
    }

    // -----------------------------------------------------------------
    // Slow path: race into the INSERT. The Postgres unique constraint
    // picks a single winner; concurrent losers fall into the P2002
    // branch below.
    // -----------------------------------------------------------------
    try {
      await createSchemaStub({
        schemaId: body.schemaId,
        userId,
        inputs: body.inputs,
      });

      await inngest.send({
        name: "onboarding.session.started",
        data: { schemaId: body.schemaId, userId },
      });

      logger.info({
        service: "onboarding",
        operation: "start.created",
        userId,
        schemaId: body.schemaId,
      });

      return NextResponse.json(
        { data: { schemaId: body.schemaId, idempotent: false } },
        { status: 202 },
      );
    } catch (createError) {
      if (!isUniqueConstraintViolation(createError)) {
        throw createError;
      }

      // A concurrent request inserted the row between our fast-path
      // findUnique and our createSchemaStub. Re-resolve the winner and
      // treat this as an idempotent retry. We still do the ownership
      // check: the winner might belong to a different user if the
      // client-supplied ULIDs collide (extremely unlikely but not
      // impossible).
      const winner = await prisma.caseSchema.findUnique({
        where: { id: body.schemaId },
        select: { id: true, userId: true, phase: true, status: true },
      });

      if (!winner) {
        // Race-within-a-race: the winner committed and was rolled back
        // (or deleted) before we could resolve them. Rethrow the
        // original P2002 — the caller should retry, and the next attempt
        // will succeed cleanly.
        throw createError;
      }

      if (winner.userId !== userId) {
        logger.warn({
          service: "onboarding",
          operation: "start.idempotent.crossUser",
          userId,
          schemaId: body.schemaId,
          winnerUserId: winner.userId,
        });
        return NextResponse.json(
          { error: "Forbidden", code: 403, type: "FORBIDDEN" },
          { status: 403 },
        );
      }

      logger.info({
        service: "onboarding",
        operation: "start.idempotent.raceLost",
        userId,
        schemaId: body.schemaId,
        phase: winner.phase,
        status: winner.status,
      });
      return NextResponse.json(
        { data: { schemaId: winner.id, idempotent: true } },
        { status: 202 },
      );
    }
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "start",
      userId,
    });
  }
});
