import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { getCurrentAccuracy } from "@/lib/services/quality";
import { NotFoundError } from "@denim/types";
import { NextResponse } from "next/server";

export const GET = withAuth(async ({ userId }, { params }: { params: { schemaId: string } }) => {
	try {
		const schema = await prisma.caseSchema.findFirst({
			where: { id: params.schemaId, userId },
			select: { id: true },
		});
		if (!schema) throw new NotFoundError("Schema not found");

		const result = await getCurrentAccuracy(params.schemaId);
		return NextResponse.json({ data: result });
	} catch (error) {
		return handleApiError(error, {
			service: "quality",
			operation: "GET /api/quality/[schemaId]",
			userId,
		});
	}
});
