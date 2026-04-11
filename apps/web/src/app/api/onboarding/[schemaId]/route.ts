/**
 * Onboarding session endpoints keyed on the CaseSchema id.
 *
 *   GET    /api/onboarding/:schemaId — polling. Merges CaseSchema.phase
 *          and the latest ONBOARDING ScanJob through
 *          `derivePollingResponse` so the client has one flat shape to
 *          render against.
 *
 *   POST   /api/onboarding/:schemaId — review confirmation. Flips
 *          phase=AWAITING_REVIEW → COMPLETED and status=DRAFT → ACTIVE
 *          in a single CAS `updateMany`. Resolves the "no automatic
 *          status=ACTIVE" deferred debt from Task 9.
 *
 *   DELETE /api/onboarding/:schemaId — cancellation. Emits
 *          `onboarding.session.cancelled` so `runOnboarding`'s `cancelOn`
 *          binding tears down any in-flight workflow, then marks the
 *          schema ARCHIVED so it falls out of active-schema lists.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
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

// POST — confirm review and complete onboarding ------------------------------
const ConfirmSchema = z.object({
  topicName: z.string().min(1).max(100),
  entityToggles: z.array(z.object({ id: z.string(), isActive: z.boolean() })).default([]),
});

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractOnboardingSchemaId(request);
    const body = ConfirmSchema.parse(await request.json());

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true, phase: true, status: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // CAS: only advance from AWAITING_REVIEW. Concurrent confirms from two
    // tabs will see updated.count === 0 on the loser and fall through to
    // the "already completed" branch.
    const updated = await prisma.caseSchema.updateMany({
      where: { id: schemaId, phase: "AWAITING_REVIEW" },
      data: {
        phase: "COMPLETED",
        status: "ACTIVE",
        name: body.topicName.trim(),
        phaseUpdatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true, status: true },
      });
      if (current?.status === "ACTIVE") {
        return NextResponse.json({
          data: { schemaId, status: "already-completed" },
        });
      }
      return NextResponse.json(
        {
          error: `Cannot confirm from phase ${current?.phase ?? "unknown"}`,
          code: 409,
          type: "CONFLICT",
        },
        { status: 409 },
      );
    }

    // Apply user-toggled entity activations in a single transaction so
    // partial failures don't leave the UI out of sync with the DB.
    if (body.entityToggles.length > 0) {
      await prisma.$transaction(
        body.entityToggles.map((t) =>
          prisma.entity.update({
            where: { id: t.id },
            data: { isActive: t.isActive },
          }),
        ),
      );
    }

    logger.info({
      service: "onboarding",
      operation: "confirm",
      userId,
      schemaId,
      entityToggleCount: body.entityToggles.length,
    });

    return NextResponse.json({
      data: { schemaId, status: "completed" },
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
