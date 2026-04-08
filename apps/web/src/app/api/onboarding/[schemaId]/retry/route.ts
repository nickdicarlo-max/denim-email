/**
 * POST /api/onboarding/:schemaId/retry
 *
 * Resumes a FAILED onboarding run by reverting the schema back to the
 * phase it was in when the failure occurred, then re-emitting
 * `onboarding.session.started`. `runOnboarding`'s advanceSchemaPhase
 * CAS checks treat "already past" as a no-op skip, so any happy-path
 * steps the original run already completed are skipped on replay and
 * only the failed step (and anything after it) actually runs again.
 *
 * The previous failure phase is parsed out of `phaseError`, which
 * `markSchemaFailed` writes as "[PHASE] message". If parsing fails
 * we fall back to PENDING so the workflow restarts from scratch —
 * that path re-does work but keeps the retry unblockable.
 *
 * Rejects any phase other than FAILED with 409: we never replay a
 * live workflow, only a terminally-failed one.
 */
import type { SchemaPhase } from "@prisma/client";
import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";

function extractSchemaId(url: string): string | null {
  const m = url.match(/\/api\/onboarding\/([^/?]+)\/retry/);
  return m?.[1] ?? null;
}

/**
 * Resumable pre-scan phases. We never rewind past PROCESSING_SCAN because
 * the scan pipeline owns its own state machine and re-running those steps
 * would create a second ScanJob. For a PROCESSING_SCAN failure we reset
 * the schema to PROCESSING_SCAN itself, and runOnboarding's create-scan-job
 * CAS is skipped — the workflow re-enters the waitForEvent loop on the
 * existing scan.
 */
const RESUMABLE_PHASES = new Set<SchemaPhase>([
  "PENDING",
  "GENERATING_HYPOTHESIS",
  "FINALIZING_SCHEMA",
  "PROCESSING_SCAN",
]);

function parseFailurePhase(phaseError: string | null): SchemaPhase {
  if (!phaseError) return "PENDING";
  const m = phaseError.match(/^\[([A-Z_]+)\]/);
  const parsed = m?.[1] as SchemaPhase | undefined;
  if (parsed && RESUMABLE_PHASES.has(parsed)) return parsed;
  return "PENDING";
}

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemaId(request.url);
    if (!schemaId) {
      return NextResponse.json(
        { error: "schemaId required", code: 400, type: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: {
        id: true,
        userId: true,
        phase: true,
        phaseError: true,
      },
    });
    if (!schema) {
      return NextResponse.json(
        { error: "Not found", code: 404, type: "NOT_FOUND" },
        { status: 404 },
      );
    }
    if (schema.userId !== userId) {
      return NextResponse.json(
        { error: "Forbidden", code: 403, type: "FORBIDDEN" },
        { status: 403 },
      );
    }

    if (schema.phase !== "FAILED") {
      return NextResponse.json(
        {
          error: `Cannot retry from phase ${schema.phase ?? "null"} — retry requires phase=FAILED`,
          code: 409,
          type: "CONFLICT",
        },
        { status: 409 },
      );
    }

    // Resume from the phase that originally failed. advanceSchemaPhase
    // treats "already past the `from` state" as an idempotent skip, so
    // steps before the resume point are no-ops and only the failed step
    // (and anything after it) actually runs. The resolve-scan-job step
    // in runOnboarding already handles "skipped" by falling back to the
    // existing ScanJob lookup, so resuming from PROCESSING_SCAN doesn't
    // create a second scan.
    const resumeFrom = parseFailurePhase(schema.phaseError);

    await prisma.caseSchema.update({
      where: { id: schemaId },
      data: {
        phase: resumeFrom,
        phaseError: null,
        phaseErrorAt: null,
        phaseUpdatedAt: new Date(),
      },
    });

    await inngest.send({
      name: "onboarding.session.started",
      data: { schemaId, userId },
    });

    logger.info({
      service: "onboarding",
      operation: "retry",
      userId,
      schemaId,
      previousError: schema.phaseError ?? undefined,
      resumeFrom,
    });

    return NextResponse.json({
      data: { schemaId, status: "retrying", resumeFrom },
    });
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "retry",
      userId,
    });
  }
});
