import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { CaseListQuerySchema } from "@/lib/validation/cases";
import { NotFoundError, ValidationError } from "@denim/types";
import { NextResponse } from "next/server";

/** Urgency tier sort order: lower = higher priority */
const URGENCY_ORDER: Record<string, number> = {
	IMMINENT: 0,
	THIS_WEEK: 1,
	UPCOMING: 2,
	NO_ACTION: 3,
	IRRELEVANT: 4,
};

/** Status sort order: active first, resolved last */
const STATUS_ORDER: Record<string, number> = {
	OPEN: 0,
	IN_PROGRESS: 0,
	RESOLVED: 1,
};

/** Find the earliest future event date from a case's actions */
function getNextEventTime(actions?: { eventStartTime?: string | null; dueDate?: string | null; actionType?: string }[]): number | null {
	if (!actions) return null;
	const now = Date.now();
	let earliest: number | null = null;
	for (const a of actions) {
		if (a.actionType !== "EVENT") continue;
		const dateStr = a.eventStartTime ?? a.dueDate;
		if (!dateStr) continue;
		const t = new Date(dateStr).getTime();
		if (t > now && (earliest === null || t < earliest)) earliest = t;
	}
	return earliest;
}

function sortCases<T extends { status: string; urgency?: string | null; lastEmailDate?: string | null; actions?: { eventStartTime?: string | null; dueDate?: string | null; actionType?: string }[] }>(
	cases: T[],
): T[] {
	return [...cases].sort((a, b) => {
		// Primary: active cases first, resolved last
		const aStatus = STATUS_ORDER[a.status] ?? 0;
		const bStatus = STATUS_ORDER[b.status] ?? 0;
		if (aStatus !== bStatus) return aStatus - bStatus;

		// Secondary: urgency tier
		const aUrg = URGENCY_ORDER[a.urgency ?? "UPCOMING"] ?? 2;
		const bUrg = URGENCY_ORDER[b.urgency ?? "UPCOMING"] ?? 2;
		if (aUrg !== bUrg) return aUrg - bUrg;

		// Tertiary: nearest upcoming event first (for cases with events)
		const aEvent = getNextEventTime(a.actions);
		const bEvent = getNextEventTime(b.actions);
		if (aEvent !== null && bEvent !== null) return aEvent - bEvent;
		if (aEvent !== null) return -1; // cases with events before those without
		if (bEvent !== null) return 1;

		// Quaternary: most recent email first (fallback)
		const aDate = a.lastEmailDate ? new Date(a.lastEmailDate).getTime() : 0;
		const bDate = b.lastEmailDate ? new Date(b.lastEmailDate).getTime() : 0;
		return bDate - aDate;
	});
}

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
					take: 2,
					orderBy: { dueDate: "asc" },
					select: {
						id: true,
						title: true,
						actionType: true,
						dueDate: true,
						eventStartTime: true,
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
				status: a.status,
			})),
		}));

		// Sort: active first, then by urgency tier, then by date
		const sorted = sortCases(formatted);

		return NextResponse.json({ data: { cases: sorted, nextCursor } });
	} catch (error) {
		return handleApiError(error, {
			service: "cases",
			operation: "GET /api/cases",
			userId,
		});
	}
});
