/**
 * Onboarding session endpoints keyed on the CaseSchema id.
 *
 *   GET    /api/onboarding/:schemaId — polling. Merges CaseSchema.phase
 *          and the latest ONBOARDING ScanJob through
 *          `derivePollingResponse` so the client has one flat shape to
 *          render against.
 *
 *   POST   /api/onboarding/:schemaId — review confirmation. Flips
 *          phase=AWAITING_REVIEW → PROCESSING_SCAN, persists Entity rows
 *          via `persistSchemaRelations`, and emits
 *          `onboarding.review.confirmed` to kick off the pipeline.
 *
 *   DELETE /api/onboarding/:schemaId — cancellation. Emits
 *          `onboarding.session.cancelled` so `runOnboarding`'s `cancelOn`
 *          binding tears down any in-flight workflow, then marks the
 *          schema ARCHIVED so it falls out of active-schema lists.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import type { SchemaHypothesis, HypothesisValidation, InterviewInput } from "@denim/types";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { assertResourceOwnership } from "@/lib/middleware/ownership";
import { extractOnboardingSchemaId } from "@/lib/middleware/request-params";
import { prisma } from "@/lib/prisma";
import { persistSchemaRelations } from "@/lib/services/interview";
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

    // CAS: only advance from AWAITING_REVIEW → PROCESSING_SCAN.
    // Concurrent confirms from two tabs will see updated.count === 0 on
    // the loser and fall through to the idempotent "already-confirmed" branch.
    const updated = await prisma.caseSchema.updateMany({
      where: { id: schemaId, phase: "AWAITING_REVIEW" },
      data: {
        phase: "PROCESSING_SCAN",
        name: body.topicName.trim(),
        phaseUpdatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true, status: true },
      });
      if (current?.status === "ACTIVE" || current?.phase === "PROCESSING_SCAN") {
        return NextResponse.json({
          data: { schemaId, status: "already-confirmed" },
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

    // Build confirmations from entity toggles (names, not DB IDs — Entity
    // rows don't exist yet at review time; persistSchemaRelations creates them).
    const hypothesis = schema.hypothesis as unknown as SchemaHypothesis | null;
    const validation = schema.validation as unknown as HypothesisValidation | null;

    if (!hypothesis) {
      return NextResponse.json(
        { error: "Schema has no hypothesis — cannot finalize", code: 500, type: "SERVER_ERROR" },
        { status: 500 },
      );
    }

    const acceptedNames = new Set(
      body.entityToggles.filter((t) => t.isActive).map((t) => t.name),
    );
    const rejectedNames = new Set(
      body.entityToggles.filter((t) => !t.isActive).map((t) => t.name),
    );

    const confirmedEntities = validation?.discoveredEntities
      .filter((e) => acceptedNames.has(e.name))
      .map((e) => e.name) ?? [];

    const removedEntities = [
      ...hypothesis.entities.filter((e) => rejectedNames.has(e.name)).map((e) => e.name),
      ...(validation?.discoveredEntities.filter((e) => rejectedNames.has(e.name)).map((e) => e.name) ?? []),
    ];

    const confirmedTags = validation?.suggestedTags.map((t) => t.name) ?? [];

    const inputs = schema.inputs as unknown as InterviewInput | null;

    await persistSchemaRelations(schemaId, hypothesis, validation ?? undefined, {
      confirmedEntities,
      removedEntities,
      confirmedTags,
      removedTags: [],
      schemaName: body.topicName.trim(),
      groups: inputs?.groups,
      sharedWhos: inputs?.sharedWhos,
    });

    // Emit event to trigger the pipeline (Function B: scan → extract → cluster → synthesize).
    await inngest.send({
      name: "onboarding.review.confirmed",
      data: { schemaId, userId },
    });

    logger.info({
      service: "onboarding",
      operation: "confirm",
      userId,
      schemaId,
      acceptedCount: acceptedNames.size,
      rejectedCount: rejectedNames.size,
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
