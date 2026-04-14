/**
 * Per-scan detail endpoint.
 *
 *   GET /api/schemas/:schemaId/scans/:scanJobId — full ScanJob row
 *       including the most recent 50 ScanFailure rows and the
 *       compute-on-demand metrics. Used by the admin/debug view to
 *       see exactly what a given scan did.
 *
 * The schemaId segment is validated against the scan's own `schemaId`
 * column so a scan id can't be used to probe across schemas — even
 * though ownership is ultimately checked against the parent CaseSchema.
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { computeScanMetrics } from "@/lib/services/scan-metrics";

function extractIds(url: string): { schemaId: string; scanJobId: string } | null {
  const m = url.match(/\/api\/schemas\/([^/?]+)\/scans\/([^/?]+)/);
  if (!m || !m[1] || !m[2]) return null;
  return { schemaId: m[1], scanJobId: m[2] };
}

export const GET = withAuth(async ({ userId, request }) => {
  try {
    const ids = extractIds(request.url);
    if (!ids) {
      return NextResponse.json(
        { error: "schemaId and scanJobId required", code: 400, type: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }

    const scan = await prisma.scanJob.findUnique({
      where: { id: ids.scanJobId },
      include: {
        schema: { select: { userId: true } },
        failures: {
          take: 50,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!scan || scan.schemaId !== ids.schemaId) {
      return NextResponse.json(
        { error: "Not found", code: 404, type: "NOT_FOUND" },
        { status: 404 },
      );
    }

    if (scan.schema.userId !== userId) {
      return NextResponse.json(
        { error: "Forbidden", code: 403, type: "FORBIDDEN" },
        { status: 403 },
      );
    }

    const metrics = await computeScanMetrics(scan.id);

    // Strip the schema-relation helper before returning — the caller only
    // needs it for the ownership check above.
    const { schema: _schema, ...scanRow } = scan;
    return NextResponse.json({
      data: { ...scanRow, metrics },
    });
  } catch (error) {
    return handleApiError(error, {
      service: "scans",
      operation: "detail",
      userId,
    });
  }
});
