import { NotFoundError, ValidationError } from "@denim/types";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { extractActionId } from "@/lib/middleware/request-params";
import { prisma } from "@/lib/prisma";

const UpdateActionSchema = z.object({
  status: z.enum(["PENDING", "DONE"]),
});

export const PATCH = withAuth(async ({ userId, request }) => {
  try {
    const actionId = extractActionId(request);
    const body = await request.json();
    const parsed = UpdateActionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    }

    // Load action and verify ownership via case → schema → user chain
    const action = await prisma.caseAction.findUnique({
      where: { id: actionId },
      select: {
        id: true,
        status: true,
        caseId: true,
        case: {
          select: {
            schemaId: true,
            schema: { select: { userId: true } },
          },
        },
      },
    });

    if (!action || action.case.schema.userId !== userId) {
      throw new NotFoundError("Action not found");
    }

    // Only allow toggling PENDING ↔ DONE
    if (action.status !== "PENDING" && action.status !== "DONE") {
      throw new ValidationError(`Cannot change status of ${action.status} action`);
    }

    await prisma.caseAction.update({
      where: { id: actionId },
      data: { status: parsed.data.status },
    });

    return NextResponse.json({ data: { id: actionId, status: parsed.data.status } });
  } catch (error) {
    return handleApiError(error, {
      service: "actions",
      operation: "PATCH /api/actions/[id]",
      userId,
    });
  }
});
