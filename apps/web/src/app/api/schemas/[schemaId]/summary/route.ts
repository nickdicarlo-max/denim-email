import { NotFoundError } from "@denim/types";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { extractSchemasSchemaId } from "@/lib/middleware/request-params";
import { prisma } from "@/lib/prisma";

export const GET = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemasSchemaId(request);

    const schema = await prisma.caseSchema.findFirst({
      where: { id: schemaId, userId },
      select: {
        id: true,
        name: true,
        domain: true,
        summaryLabels: true,
        entities: {
          where: { type: "PRIMARY", isActive: true },
          select: { id: true, name: true, emailCount: true },
          orderBy: { emailCount: "desc" },
        },
        qualitySnapshots: {
          orderBy: { date: "desc" },
          take: 1,
          select: { phase: true, accuracy: true },
        },
      },
    });

    if (!schema) throw new NotFoundError("Schema not found");

    // Count cases by status
    const statusCounts = await prisma.case.groupBy({
      by: ["status"],
      where: { schemaId },
      _count: { _all: true },
    });

    const counts: Record<string, number> = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    for (const row of statusCounts) {
      counts[row.status] = row._count._all;
    }

    const latestSnapshot = schema.qualitySnapshots[0];

    return NextResponse.json({
      data: {
        name: schema.name,
        domain: schema.domain,
        summaryLabels: schema.summaryLabels,
        entities: schema.entities,
        statusCounts: counts,
        qualityPhase: latestSnapshot?.phase ?? "CALIBRATING",
        accuracy: latestSnapshot?.accuracy ?? null,
      },
    });
  } catch (error) {
    return handleApiError(error, {
      service: "schemas",
      operation: "GET /api/schemas/[schemaId]/summary",
      userId,
    });
  }
});
