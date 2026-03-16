import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { CaseListQuerySchema } from "@/lib/validation/cases";
import { NotFoundError, ValidationError } from "@denim/types";
import { NextResponse } from "next/server";

export const GET = withAuth(async ({ userId, request }) => {
	try {
		const url = new URL(request.url);
		const raw = Object.fromEntries(url.searchParams.entries());

		const parsed = CaseListQuerySchema.safeParse(raw);
		if (!parsed.success) {
			const messages = parsed.error.issues
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join("; ");
			throw new ValidationError(messages);
		}

		const { schemaId, status, entityId, cursor, limit } = parsed.data;

		// Verify schema belongs to user
		const schema = await prisma.caseSchema.findFirst({
			where: { id: schemaId, userId },
			select: { id: true },
		});
		if (!schema) throw new NotFoundError("Schema not found");

		// Build where clause
		const where: Record<string, unknown> = { schemaId };
		if (status) where.status = status;
		if (entityId) where.entityId = entityId;

		const cases = await prisma.case.findMany({
			where,
			orderBy: { lastEmailDate: "desc" },
			take: limit + 1,
			...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
			select: {
				id: true,
				schemaId: true,
				entityId: true,
				title: true,
				summary: true,
				primaryActor: true,
				displayTags: true,
				anchorTags: true,
				status: true,
				aggregatedData: true,
				startDate: true,
				endDate: true,
				lastSenderName: true,
				lastSenderEntity: true,
				lastEmailDate: true,
				viewedAt: true,
				feedbackRating: true,
				entity: { select: { name: true } },
				_count: { select: { caseEmails: true } },
				actions: {
					where: { status: "PENDING" },
					take: 2,
					orderBy: { dueDate: "asc" },
					select: {
						id: true,
						title: true,
						actionType: true,
						dueDate: true,
						status: true,
					},
				},
			},
		});

		const hasMore = cases.length > limit;
		const items = hasMore ? cases.slice(0, limit) : cases;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		const formatted = items.map((c) => ({
			id: c.id,
			schemaId: c.schemaId,
			entityId: c.entityId,
			title: c.title,
			summary: c.summary,
			primaryActor: c.primaryActor,
			displayTags: c.displayTags,
			anchorTags: c.anchorTags,
			status: c.status,
			aggregatedData: c.aggregatedData,
			startDate: c.startDate?.toISOString() ?? null,
			endDate: c.endDate?.toISOString() ?? null,
			lastSenderName: c.lastSenderName,
			lastSenderEntity: c.lastSenderEntity,
			lastEmailDate: c.lastEmailDate?.toISOString() ?? null,
			viewedAt: c.viewedAt?.toISOString() ?? null,
			feedbackRating: c.feedbackRating,
			emailCount: c._count.caseEmails,
			entityName: c.entity.name,
			actions: c.actions.map((a) => ({
				id: a.id,
				title: a.title,
				actionType: a.actionType,
				dueDate: a.dueDate?.toISOString() ?? null,
				status: a.status,
			})),
		}));

		return NextResponse.json({ data: { cases: formatted, nextCursor } });
	} catch (error) {
		return handleApiError(error, {
			service: "cases",
			operation: "GET /api/cases",
			userId,
		});
	}
});
