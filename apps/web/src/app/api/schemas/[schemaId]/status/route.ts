import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { computeScanMetrics, computeSchemaMetrics } from "@/lib/services/scan-metrics";

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
    return NextResponse.json({ error: "Forbidden", code: 403, type: "FORBIDDEN" }, { status: 403 });
  }

  // Schema-level counters are computed on demand from Email / Case / CaseAction rows.
  const schemaMetrics = await computeSchemaMetrics(schemaId);

  // Get the latest scan job (durable fields only — counters come from computeScanMetrics)
  const latestJob = await prisma.scanJob.findFirst({
    where: { schemaId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      phase: true,
      statusMessage: true,
      totalEmails: true,
      completedAt: true,
      startedAt: true,
      createdAt: true,
    },
  });

  // Derive the scan-level counters the status panel used to read off the row.
  const scanMetrics = latestJob ? await computeScanMetrics(latestJob.id) : null;

  // Fetch recently discovered entities during the current scan
  const recentDiscoveries = latestJob
    ? {
        entities: await prisma.entity.findMany({
          where: {
            schemaId,
            autoDetected: true,
            createdAt: { gte: latestJob.startedAt ?? latestJob.createdAt },
          },
          select: { name: true, emailCount: true },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        subjectPatterns: [],
      }
    : undefined;

  return NextResponse.json({
    schemaStatus: schema.status,
    emailCount: schemaMetrics.emailCount,
    caseCount: schemaMetrics.caseCount,
    actionCount: schemaMetrics.actionCount,
    scanJob:
      latestJob && scanMetrics
        ? {
            ...latestJob,
            processedEmails: scanMetrics.processedEmails,
            excludedEmails: scanMetrics.excludedEmails,
            failedEmails: scanMetrics.failedEmails,
            casesCreated: scanMetrics.casesCreated,
            // casesMerged / clustersCreated are no longer tracked — the merge
            // and cluster-count numbers are only log-line statusMessages now.
            casesMerged: 0,
            clustersCreated: 0,
          }
        : latestJob,
    recentDiscoveries,
  });
});
