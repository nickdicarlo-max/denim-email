import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/middleware/auth";
import { NextResponse } from "next/server";

/**
 * GET /api/schemas/:schemaId/status
 * Returns current scan job status + schema stats for polling.
 */
export const GET = withAuth(async ({ userId, request }) => {
  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const schemaId = segments[segments.length - 2]; // /api/schemas/:schemaId/status

  if (!schemaId) {
    return NextResponse.json(
      { error: "Schema ID is required", code: 400, type: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId },
    select: {
      userId: true,
      emailCount: true,
      caseCount: true,
      status: true,
    },
  });

  if (!schema) {
    return NextResponse.json(
      { error: "Schema not found", code: 404, type: "NOT_FOUND" },
      { status: 404 },
    );
  }

  if (schema.userId !== userId) {
    return NextResponse.json(
      { error: "Forbidden", code: 403, type: "FORBIDDEN" },
      { status: 403 },
    );
  }

  // Get the latest scan job
  const latestJob = await prisma.scanJob.findFirst({
    where: { schemaId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      phase: true,
      statusMessage: true,
      totalEmails: true,
      processedEmails: true,
      excludedEmails: true,
      failedEmails: true,
      casesCreated: true,
      casesMerged: true,
      clustersCreated: true,
      completedAt: true,
    },
  });

  // Count actual CaseAction rows for this schema
  const actionCount = await prisma.caseAction.count({
    where: { schemaId },
  });

  return NextResponse.json({
    schemaStatus: schema.status,
    emailCount: schema.emailCount,
    caseCount: schema.caseCount,
    actionCount,
    scanJob: latestJob,
  });
});
