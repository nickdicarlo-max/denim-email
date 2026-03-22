import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@denim/types";
import { NextResponse } from "next/server";

export const GET = withAuth(async ({ userId, request }, { params }: { params: { schemaId: string } }) => {
	try {
		const schema = await prisma.caseSchema.findFirst({
			where: { id: params.schemaId, userId },
			select: { id: true },
		});
		if (!schema) throw new NotFoundError("Schema not found");

		const url = new URL(request.url);
		const limit = Math.min(Number(url.searchParams.get("limit") ?? "30"), 90);

		const snapshots = await prisma.qualitySnapshot.findMany({
			where: { schemaId: params.schemaId },
			orderBy: { date: "desc" },
			take: limit,
			select: {
				id: true,
				date: true,
				accuracy: true,
				totalSignals: true,
				thumbsUp: true,
				thumbsDown: true,
				emailMoves: true,
				emailExcludes: true,
				caseMerges: true,
				caseSplits: true,
				casesViewed: true,
				phase: true,
			},
		});

		return NextResponse.json({
			data: snapshots.map((s) => ({
				...s,
				date: s.date.toISOString(),
			})),
		});
	} catch (error) {
		return handleApiError(error, {
			service: "quality",
			operation: "GET /api/quality/[schemaId]/history",
			userId,
		});
	}
});
