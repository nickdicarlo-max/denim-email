import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { assertResourceOwnership } from "@/lib/middleware/ownership";
import { extractSchemasSchemaId } from "@/lib/middleware/request-params";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/schemas/:schemaId
 * Returns schema details including entities for the review page.
 */
export const GET = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemasSchemaId(request);

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: {
        id: true,
        name: true,
        userId: true,
        entities: {
          select: {
            id: true,
            name: true,
            type: true,
            autoDetected: true,
            emailCount: true,
            aliases: true,
            isActive: true,
            confidence: true,
            likelyAliasOf: true,
            aliasConfidence: true,
            aliasReason: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    assertResourceOwnership(schema, userId, "Schema");

    return NextResponse.json({
      data: {
        id: schema.id,
        name: schema.name,
        entities: schema.entities,
      },
    });
  } catch (error) {
    return handleApiError(error, {
      service: "schemas",
      operation: "GET /api/schemas/[schemaId]",
      userId,
    });
  }
});

export const DELETE = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemasSchemaId(request);

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { userId: true },
    });

    assertResourceOwnership(schema, userId, "Schema");

    await prisma.caseSchema.delete({ where: { id: schemaId } });

    logger.info({
      service: "api",
      operation: "schema.delete",
      userId,
      schemaId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, {
      service: "schemas",
      operation: "DELETE /api/schemas/[schemaId]",
      userId,
    });
  }
});
