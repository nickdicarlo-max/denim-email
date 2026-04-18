/**
 * Onboarding session endpoints keyed on the CaseSchema id.
 *
 *   GET    /api/onboarding/:schemaId — polling. Merges CaseSchema.phase
 *          and the latest ONBOARDING ScanJob through
 *          `derivePollingResponse` so the client has one flat shape to
 *          render against.
 *
 *   POST   /api/onboarding/:schemaId — review confirmation. Persists
 *          Entity / SchemaTag / ExclusionRule rows and writes an
 *          OnboardingOutbox row for "onboarding.review.confirmed" in a
 *          single Prisma transaction (#67). A best-effort optimistic
 *          inngest.send fires after the commit; on failure, the drain
 *          cron picks the row up within ~1 minute. Function B
 *          (`runOnboardingPipeline`) owns the AWAITING_REVIEW →
 *          PROCESSING_SCAN phase transition + ScanJob creation when it
 *          picks up the event — same pattern as POST /start + Function A.
 *
 *   DELETE /api/onboarding/:schemaId — cancellation. Emits
 *          `onboarding.session.cancelled` so `runOnboarding`'s `cancelOn`
 *          binding tears down any in-flight workflow, then marks the
 *          schema ARCHIVED so it falls out of active-schema lists.
 */

import type { HypothesisValidation, InterviewInput, SchemaHypothesis } from "@denim/types";
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
import { persistSchemaRelations } from "@/lib/services/interview";
import { derivePollingResponse } from "@/lib/services/onboarding-polling";

/**
 * Duck-typed check for Prisma's P2002 unique-constraint violation. Matches
 * the pattern used in POST /api/onboarding/start — the `code` string is
 * part of Prisma's public error contract and stable across versions.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

/**
 * True only if the P2002 violation is specifically on the outbox's
 * composite PK (schemaId, eventName) — i.e., a genuine concurrent-confirm
 * race where another request already committed the outbox row.
 *
 * Prisma's P2002 exposes `meta.target` listing the conflicting columns.
 * Narrowing prevents the "race lost" label from masking completely
 * unrelated unique violations inside persistSchemaRelations (entity
 * duplicates, tag duplicates, etc), which would silently skip writing
 * the outbox row and leave Function B unfired.
 */
function isOutboxRaceViolation(err: unknown): boolean {
  if (!isUniqueConstraintViolation(err)) return false;
  const meta = (err as { meta?: { target?: unknown } }).meta;
  const target = meta?.target;
  if (!Array.isArray(target)) return false;
  const cols = target.map((t) => String(t));
  return cols.includes("schemaId") && cols.includes("eventName");
}

// GET — polling endpoint -----------------------------------------------------
export const GET = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractOnboardingSchemaId(request);

    const schema = await prisma.caseSchema.findUnique({ where: { id: schemaId } });
    assertResourceOwnership(schema, userId, "Schema");

    // Grab the latest onboarding scan. runOnboarding creates exactly one,
    // but a retry (Task 12) or failure-recovery could create more, so
    // order by createdAt desc to always pick the current one.
    const onboardingScan = await prisma.scanJob.findFirst({
      where: { schemaId, triggeredBy: "ONBOARDING" },
      orderBy: { createdAt: "desc" },
    });

    const response = await derivePollingResponse(schema, onboardingScan);
    return NextResponse.json({ data: response });
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "poll",
      userId,
    });
  }
});

// POST — confirm review, persist entities, and trigger pipeline -------------
const ConfirmSchema = z.object({
  topicName: z.string().min(1).max(100),
  entityToggles: z.array(z.object({ name: z.string(), isActive: z.boolean() })).default([]),
});

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractOnboardingSchemaId(request);
    const body = ConfirmSchema.parse(await request.json());

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: {
        id: true,
        userId: true,
        phase: true,
        status: true,
        hypothesis: true,
        validation: true,
        inputs: true,
      },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // Idempotency: if a confirm outbox row already exists for this
    // schema, the user already confirmed. Return success regardless of
    // pipeline progress (phase could be PROCESSING_SCAN, COMPLETED, etc).
    const existingConfirm = await prisma.onboardingOutbox.findUnique({
      where: {
        schemaId_eventName: {
          schemaId,
          eventName: "onboarding.review.confirmed",
        },
      },
      select: { status: true },
    });
    if (existingConfirm) {
      logger.info({
        service: "onboarding",
        operation: "confirm.idempotent",
        userId,
        schemaId,
        outboxStatus: existingConfirm.status,
      });
      return NextResponse.json({
        data: { schemaId, status: "already-confirmed" },
      });
    }

    // Phase gate: only AWAITING_REVIEW can be confirmed. No state change
    // here — Function B (runOnboardingPipeline) owns the phase advance
    // after it receives the event.
    if (schema?.phase !== "AWAITING_REVIEW") {
      return NextResponse.json(
        {
          error: `Cannot confirm from phase ${schema?.phase ?? "unknown"}`,
          code: 409,
          type: "CONFLICT",
        },
        { status: 409 },
      );
    }

    const hypothesis = schema.hypothesis as unknown as SchemaHypothesis | null;
    const validation = schema.validation as unknown as HypothesisValidation | null;

    if (!hypothesis) {
      return NextResponse.json(
        { error: "Schema has no hypothesis — cannot finalize", code: 500, type: "SERVER_ERROR" },
        { status: 500 },
      );
    }

    // Names, not DB ids — Entity rows don't exist yet at review time.
    const acceptedNames = new Set(body.entityToggles.filter((t) => t.isActive).map((t) => t.name));
    const rejectedNames = new Set(body.entityToggles.filter((t) => !t.isActive).map((t) => t.name));

    const confirmedEntities =
      validation?.discoveredEntities.filter((e) => acceptedNames.has(e.name)).map((e) => e.name) ??
      [];

    const removedEntities = [
      ...hypothesis.entities.filter((e) => rejectedNames.has(e.name)).map((e) => e.name),
      ...(validation?.discoveredEntities
        .filter((e) => rejectedNames.has(e.name))
        .map((e) => e.name) ?? []),
    ];

    const confirmedTags = validation?.suggestedTags.map((t) => t.name) ?? [];

    const inputs = schema.inputs as unknown as InterviewInput | null;

    // Atomic write: entity persistence + outbox row commit together.
    // If either throws, nothing is written and the client can retry.
    // The outbox composite PK (schemaId, "onboarding.review.confirmed")
    // is the idempotency guard against concurrent confirms from two tabs.
    try {
      await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // Set the user-chosen topic name here — no separate CAS update
          // is needed because persistSchemaRelations opens with a
          // caseSchema.update that overwrites placeholder fields.
          await persistSchemaRelations(
            schemaId,
            hypothesis,
            validation ?? undefined,
            {
              confirmedEntities,
              removedEntities,
              confirmedTags,
              removedTags: [],
              schemaName: body.topicName.trim(),
              groups: inputs?.groups,
              sharedWhos: inputs?.sharedWhos,
            },
            { tx },
          );
          await tx.onboardingOutbox.create({
            data: {
              schemaId,
              userId,
              eventName: "onboarding.review.confirmed",
              payload: { schemaId, userId } as Prisma.InputJsonValue,
            },
          });
        },
        { timeout: 20000 },
      );
    } catch (writeError) {
      if (isOutboxRaceViolation(writeError)) {
        // Concurrent confirm committed the outbox row between our
        // idempotency check and this transaction. Treat as success —
        // the other request's outbox row will emit the event.
        logger.info({
          service: "onboarding",
          operation: "confirm.idempotent.raceLost",
          userId,
          schemaId,
        });
        return NextResponse.json({
          data: { schemaId, status: "already-confirmed" },
        });
      }
      // Any other P2002 (e.g., duplicate Entity in persistSchemaRelations)
      // is a real write failure — propagate so the client can retry once
      // the underlying data is fixed.
      throw writeError;
    }

    logger.info({
      service: "onboarding",
      operation: "confirm",
      userId,
      schemaId,
      acceptedCount: acceptedNames.size,
      rejectedCount: rejectedNames.size,
    });

    // Best-effort optimistic emit. Preserves sub-second happy-path
    // latency when Inngest is healthy. If it fails, the drain cron
    // (1-minute tick) retries automatically. We do NOT await this
    // promise — the client has already been told confirmation succeeded.
    void inngest
      .send({
        name: "onboarding.review.confirmed",
        data: { schemaId, userId },
      })
      .then(() =>
        prisma.onboardingOutbox.update({
          where: {
            schemaId_eventName: {
              schemaId,
              eventName: "onboarding.review.confirmed",
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
          operation: "confirm.optimisticEmitFailed",
          userId,
          schemaId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return NextResponse.json({
      data: { schemaId, status: "confirmed" },
    });
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "confirm",
      userId,
    });
  }
});

// DELETE — cancel an in-flight onboarding ------------------------------------
export const DELETE = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractOnboardingSchemaId(request);

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true, status: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // Idempotent: if the schema is already archived, don't re-emit the
    // cancellation event.
    if (schema.status === "ARCHIVED") {
      return NextResponse.json({
        data: { schemaId, status: "already-cancelled" },
      });
    }

    // runOnboarding's cancelOn binding matches on data.schemaId and tears
    // down any waiting step (e.g. the 20m waitForEvent for scan.completed).
    await inngest.send({
      name: "onboarding.session.cancelled",
      data: { schemaId, userId },
    });

    // Mark archived + clear the phase so derivePollingResponse no longer
    // treats it as an active workflow.
    await prisma.caseSchema.update({
      where: { id: schemaId },
      data: {
        status: "ARCHIVED",
        phase: null,
        phaseUpdatedAt: new Date(),
      },
    });

    logger.info({
      service: "onboarding",
      operation: "cancel",
      userId,
      schemaId,
    });

    return NextResponse.json({
      data: { schemaId, status: "cancelled" },
    });
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "cancel",
      userId,
    });
  }
});
