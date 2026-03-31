import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { CaseListQuerySchema } from "@/lib/validation/cases";
import { NotFoundError, ValidationError } from "@denim/types";
import { NextResponse } from "next/server";
import { computeCaseDecay } from "@denim/engine";

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
		const where: Record<string, unknown> = {
			schemaId,
			urgency: { not: "IRRELEVANT" },
		};
		if (status) {
			where.status = status.length === 1 ? status[0] : { in: status };
		}
		if (entityId) where.entityId = entityId;

		// Fetch more than needed to allow application-level sorting with cursor pagination
		const cases = await prisma.case.findMany({
			where,
			orderBy: [
				{ nextActionDate: { sort: "asc", nulls: "last" } },
				{ lastEmailDate: "desc" },
			],
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
				urgency: true,
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
					take: 3,
					orderBy: { dueDate: "asc" },
					select: {
						id: true,
						title: true,
						actionType: true,
						dueDate: true,
						eventStartTime: true,
						eventEndTime: true,
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
			urgency: c.urgency,
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
				eventStartTime: a.eventStartTime?.toISOString() ?? null,
				eventEndTime: a.eventEndTime?.toISOString() ?? null,
				status: a.status,
			})),
		}));

		// Apply read-time freshness -- recalculate urgency without persisting
		const now = new Date();
		const fresh = formatted.map((c) => {
			const decay = computeCaseDecay(
				{
					caseStatus: c.status as "OPEN" | "IN_PROGRESS" | "RESOLVED",
					caseUrgency: c.urgency ?? "UPCOMING",
					actions: c.actions.map((a) => ({
						id: a.id,
						status: a.status as "PENDING" | "DONE" | "EXPIRED" | "SUPERSEDED" | "DISMISSED",
						dueDate: a.dueDate ? new Date(a.dueDate) : null,
						eventStartTime: a.eventStartTime ? new Date(a.eventStartTime) : null,
						eventEndTime: a.eventEndTime ? new Date(a.eventEndTime) : null,
					})),
					lastEmailDate: c.lastEmailDate ? new Date(c.lastEmailDate) : now,
				},
				now,
			);
			return {
				...c,
				urgency: decay.updatedUrgency,
				status: decay.updatedStatus,
			};
		});

		return NextResponse.json({ data: { cases: fresh, nextCursor } });
	} catch (error) {
		return handleApiError(error, {
			service: "cases",
			operation: "GET /api/cases",
			userId,
		});
	}
});
