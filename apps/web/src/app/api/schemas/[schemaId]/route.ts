import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/schemas/:schemaId
 * Returns schema details including entities for the review page.
 */
export const GET = withAuth(async ({ userId, request }) => {
  const url = new URL(request.url);
  const schemaId = url.pathname.split("/").pop();

  if (!schemaId) {
    return NextResponse.json(
      { error: "Schema ID is required", code: 400, type: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

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

  if (!schema) {
    return NextResponse.json(
      { error: "Schema not found", code: 404, type: "NOT_FOUND" },
      { status: 404 },
    );
  }

  if (schema.userId !== userId) {
    return NextResponse.json({ error: "Forbidden", code: 403, type: "FORBIDDEN" }, { status: 403 });
  }

  return NextResponse.json({
    data: {
      id: schema.id,
      name: schema.name,
      entities: schema.entities,
    },
  });
});

export const DELETE = withAuth(async ({ userId, request }) => {
  const url = new URL(request.url);
  const schemaId = url.pathname.split("/").pop();

  if (!schemaId) {
    return NextResponse.json(
      { error: "Schema ID is required", code: 400, type: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId },
    select: { userId: true },
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

  await prisma.caseSchema.delete({ where: { id: schemaId } });

  logger.info({
    service: "api",
    operation: "schema.delete",
    userId,
    schemaId,
  });

  return NextResponse.json({ success: true });
});
