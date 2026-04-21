/**
 * Onboarding session endpoints keyed on the CaseSchema id.
 *
 *   GET    /api/onboarding/:schemaId — polling. Merges CaseSchema.phase
 *          and the latest ONBOARDING ScanJob through
 *          `derivePollingResponse` so the client has one flat shape to
 *          render against.
 *
 *   POST   /api/onboarding/:schemaId — DEPRECATED after issue #95 Task 4.3.
 *          The single-screen review has been replaced by the Stage 1 +
 *          Stage 2 pair (`/domain-confirm`, `/entity-confirm`). This handler
 *          stays in place only to absorb stale retries from older clients —
 *          returns 200 "already-confirmed" when the schema has moved on,
 *          410 Gone otherwise.
 *
 *   DELETE /api/onboarding/:schemaId — cancellation. Emits
 *          `onboarding.session.cancelled` so `runOnboarding`'s `cancelOn`
 *          binding tears down any in-flight workflow, then marks the
 *          schema ARCHIVED so it falls out of active-schema lists.
 */

import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { assertResourceOwnership } from "@/lib/middleware/ownership";
import { extractOnboardingSchemaId } from "@/lib/middleware/request-params";
import { prisma } from "@/lib/prisma";
import { derivePollingResponse } from "@/lib/services/onboarding-polling";

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

// POST — DEPRECATED (#95 Task 4.3). The single-screen review flow is gone;
// confirmations now split across POST /domain-confirm (Stage 1) and POST
// /entity-confirm (Stage 2). This handler is retained so that in-flight
// retries from older clients (landing after the cutover) don't hard-fail.
//
// Behaviour:
//   - Schemas already past the old confirm point OR in the new fast-
//     discovery flow → 200 { status: "already-confirmed" } to preserve the
//     #33 idempotency contract.
//   - Old-flow phases still expecting the single-screen confirm → 410 Gone
//     pointing callers at /entity-confirm.
//   - withAuth + assertResourceOwnership preserved so cross-tenant writes
//     are still blocked on the way to the 410.
export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractOnboardingSchemaId(request);
    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true, phase: true, status: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // #130: schema was replaced by Back → edit restart. Caller has moved
    // to a new schemaId; tell them in a typed way so the UI can stop
    // submitting and navigate (differs from the #95-era 410 below in the
    // `type` field so clients can distinguish).
    if (schema.status === "ABANDONED") {
      logger.info({
        service: "onboarding",
        operation: "deprecated-confirm.abandoned",
        userId,
        schemaId,
      });
      return NextResponse.json(
        {
          error: "This schema was replaced by a fresh edit. Poll the new schemaId instead.",
          code: 410,
          type: "SCHEMA_ABANDONED",
        },
        { status: 410 },
      );
    }

    // New-flow phases OR downstream terminal states — stale client retry
    // lands here; treat as already-confirmed so the UI stops submitting.
    if (
      schema.phase === "AWAITING_DOMAIN_CONFIRMATION" ||
      schema.phase === "DISCOVERING_ENTITIES" ||
      schema.phase === "AWAITING_ENTITY_CONFIRMATION" ||
      schema.phase === "PROCESSING_SCAN" ||
      schema.phase === "COMPLETED" ||
      schema.phase === "NO_EMAILS_FOUND"
    ) {
      logger.info({
        service: "onboarding",
        operation: "deprecated-confirm.idempotent",
        userId,
        schemaId,
        phase: schema.phase,
      });
      return NextResponse.json({ data: { schemaId, status: "already-confirmed" } });
    }

    // Remaining phases — the caller is trying to drive the old flow that no
    // longer exists. 410 Gone is the honest answer; point them at the new
    // route.
    return NextResponse.json(
      {
        error:
          "This endpoint was removed by issue #95. Use /api/onboarding/:schemaId/entity-confirm.",
        code: 410,
        type: "GONE",
      },
      { status: 410 },
    );
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "deprecated-confirm",
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

    // Idempotent: if the schema is already archived or abandoned, don't
    // re-emit the cancellation event. #130: ABANDONED rows are already
    // out of active lists; treating them as already-cancelled is the
    // right contract for a DELETE.
    if (schema.status === "ARCHIVED" || schema.status === "ABANDONED") {
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
