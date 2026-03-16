import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, NotFoundError } from "@denim/types";
import { type NextRequest, NextResponse } from "next/server";

export const GET = withAuth(async ({ userId, request }) => {
	try {
		const id = extractCaseId(request);

		const caseRow = await prisma.case.findUnique({
			where: { id },
			include: {
				schema: {
					select: {
						userId: true,
						summaryLabels: true,
						extractedFields: {
							where: { showOnCard: true },
							orderBy: { sortOrder: "asc" },
							select: { name: true, type: true, format: true },
						},
					},
				},
				entity: { select: { name: true, type: true } },
				actions: {
					orderBy: [{ status: "asc" }, { dueDate: "asc" }],
				},
				caseEmails: {
					include: {
						email: {
							select: {
								id: true,
								schemaId: true,
								subject: true,
								sender: true,
								senderDisplayName: true,
								senderDomain: true,
								date: true,
								summary: true,
								tags: true,
								attachmentCount: true,
								clusteringConfidence: true,
								alternativeCaseId: true,
								isExcluded: true,
							},
						},
					},
					orderBy: { email: { date: "desc" } },
				},
			},
		});

		if (!caseRow) throw new NotFoundError("Case not found");
		if (caseRow.schema.userId !== userId) {
			throw new ForbiddenError("Access denied");
		}

		// Update viewedAt
		await prisma.case.update({
			where: { id },
			data: { viewedAt: new Date() },
		});

		const emails = caseRow.caseEmails.map((ce) => ({
			id: ce.email.id,
			schemaId: ce.email.schemaId,
			subject: ce.email.subject,
			sender: ce.email.sender,
			senderDisplayName: ce.email.senderDisplayName,
			senderDomain: ce.email.senderDomain,
			date: ce.email.date.toISOString(),
			summary: ce.email.summary,
			tags: ce.email.tags,
			attachmentCount: ce.email.attachmentCount,
			clusteringConfidence: ce.email.clusteringConfidence,
			alternativeCaseId: ce.email.alternativeCaseId,
			isExcluded: ce.email.isExcluded,
			assignedBy: ce.assignedBy,
			clusteringScore: ce.clusteringScore,
		}));

		const actions = caseRow.actions.map((a) => ({
			id: a.id,
			caseId: a.caseId,
			title: a.title,
			description: a.description,
			actionType: a.actionType,
			dueDate: a.dueDate?.toISOString() ?? null,
			eventStartTime: a.eventStartTime?.toISOString() ?? null,
			eventEndTime: a.eventEndTime?.toISOString() ?? null,
			eventLocation: a.eventLocation,
			status: a.status,
			reminderCount: a.reminderCount,
			confidence: a.confidence,
			amount: a.amount,
			currency: a.currency,
		}));

		return NextResponse.json({
			data: {
				case: {
					id: caseRow.id,
					schemaId: caseRow.schemaId,
					entityId: caseRow.entityId,
					entityName: caseRow.entity.name,
					title: caseRow.title,
					summary: caseRow.summary,
					primaryActor: caseRow.primaryActor,
					displayTags: caseRow.displayTags,
					anchorTags: caseRow.anchorTags,
					status: caseRow.status,
					aggregatedData: caseRow.aggregatedData,
					startDate: caseRow.startDate?.toISOString() ?? null,
					endDate: caseRow.endDate?.toISOString() ?? null,
					lastSenderName: caseRow.lastSenderName,
					lastSenderEntity: caseRow.lastSenderEntity,
					lastEmailDate: caseRow.lastEmailDate?.toISOString() ?? null,
					viewedAt: new Date().toISOString(),
					feedbackRating: caseRow.feedbackRating,
					emailCount: caseRow.caseEmails.length,
					actions,
				},
				emails,
				summaryLabels: caseRow.schema.summaryLabels,
				extractedFieldDefs: caseRow.schema.extractedFields,
			},
		});
	} catch (error) {
		return handleApiError(error, {
			service: "cases",
			operation: "GET /api/cases/[id]",
			userId,
		});
	}
});

function extractCaseId(request: NextRequest): string {
	const url = new URL(request.url);
	const segments = url.pathname.split("/");
	// /api/cases/[id] -> segments = ["", "api", "cases", "<id>"]
	return segments[segments.length - 1];
}
