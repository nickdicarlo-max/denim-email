import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/interview/review-finalize
 * Called from the onboarding review page to rename the topic and toggle entities.
 */
export const POST = withAuth(async ({ userId, request }) => {
  const body = await request.json();
  const { schemaId, topicName, entityToggles } = body as {
    schemaId: string;
    topicName?: string;
    entityToggles?: Array<{ id: string; isActive: boolean }>;
  };

  if (!schemaId) {
    return NextResponse.json(
      { error: "schemaId is required", code: 400, type: "VALIDATION_ERROR" },
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

  // Update topic name if provided
  if (topicName?.trim()) {
    await prisma.caseSchema.update({
      where: { id: schemaId },
      data: { name: topicName.trim() },
    });
  }

  // Toggle entity isActive flags
  if (entityToggles && entityToggles.length > 0) {
    await prisma.$transaction(
      entityToggles.map((toggle) =>
        prisma.entity.update({
          where: { id: toggle.id },
          data: { isActive: toggle.isActive },
        }),
      ),
    );
  }

  // Mark schema as active
  await prisma.caseSchema.update({
    where: { id: schemaId },
    data: { status: "ACTIVE" },
  });

  logger.info({
    service: "interview",
    operation: "review-finalize",
    userId,
    schemaId,
    topicName,
    entityToggleCount: entityToggles?.length ?? 0,
  });

  return NextResponse.json({ data: { success: true } });
});
