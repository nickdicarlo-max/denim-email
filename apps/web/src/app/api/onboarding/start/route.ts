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

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = StartBodySchema.parse(await request.json());

    // Idempotency: look up by id first. Retries from the same client with
    // the same ULID should be no-ops, not double-starts.
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

    // Fresh start: create stub row + fire the workflow event.
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
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "start",
      userId,
    });
  }
});
