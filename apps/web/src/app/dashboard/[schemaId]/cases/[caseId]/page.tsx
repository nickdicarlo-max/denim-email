import { CaseDetail } from "@/components/cases/case-detail";
import { prisma } from "@/lib/prisma";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function CaseDetailPage({
	params,
}: {
	params: { schemaId: string; caseId: string };
}) {
	const supabase = createServerSupabaseClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) {
		redirect("/");
	}

	const caseRow = await prisma.case.findUnique({
		where: { id: params.caseId },
		include: {
			schema: {
				select: {
					userId: true,
					name: true,
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
				take: 25,
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
							isExcluded: true,
						},
					},
				},
				orderBy: { email: { date: "desc" } },
			},
		},
	});

	if (!caseRow || caseRow.schema.userId !== user.id) {
		redirect(`/dashboard/${params.schemaId}/cases`);
	}

	// Update viewedAt
	await prisma.case.update({
		where: { id: params.caseId },
		data: { viewedAt: new Date() },
	});

	// Load cluster records for this case (debug info)
	const clusterRecords = await prisma.cluster.findMany({
		where: { schemaId: params.schemaId, resultCaseId: params.caseId },
		select: {
			action: true,
			emailIds: true,
			score: true,
			primaryTag: true,
			scoreBreakdown: true,
		},
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
		tags: ce.email.tags as string[],
		attachmentCount: ce.email.attachmentCount,
		isExcluded: ce.email.isExcluded,
		assignedBy: ce.assignedBy,
		clusteringScore: ce.clusteringScore,
	}));

	const actions = caseRow.actions.map((a) => ({
		id: a.id,
		caseId: a.caseId,
		title: a.title,
		description: a.description,
		actionType: a.actionType as "TASK" | "EVENT" | "PAYMENT" | "DEADLINE" | "RESPONSE",
		dueDate: a.dueDate?.toISOString() ?? null,
		eventStartTime: a.eventStartTime?.toISOString() ?? null,
		eventEndTime: a.eventEndTime?.toISOString() ?? null,
		eventLocation: a.eventLocation,
		status: a.status as "PENDING" | "DONE" | "EXPIRED" | "SUPERSEDED" | "DISMISSED",
		reminderCount: a.reminderCount,
		confidence: a.confidence,
		amount: a.amount,
		currency: a.currency,
	}));

	const caseData = {
		id: caseRow.id,
		schemaId: caseRow.schemaId,
		entityId: caseRow.entityId,
		entityName: caseRow.entity.name,
		title: caseRow.title,
		summary: caseRow.summary as { beginning: string; middle: string; end: string },
		primaryActor: caseRow.primaryActor as { name: string; entityType: string } | null,
		displayTags: caseRow.displayTags as string[],
		anchorTags: caseRow.anchorTags as string[],
		status: caseRow.status as "OPEN" | "IN_PROGRESS" | "RESOLVED",
		aggregatedData: caseRow.aggregatedData as Record<string, unknown>,
		startDate: caseRow.startDate?.toISOString() ?? null,
		endDate: caseRow.endDate?.toISOString() ?? null,
		lastSenderName: caseRow.lastSenderName,
		lastSenderEntity: caseRow.lastSenderEntity,
		lastEmailDate: caseRow.lastEmailDate?.toISOString() ?? null,
		viewedAt: new Date().toISOString(),
		feedbackRating: caseRow.feedbackRating as "up" | "down" | null,
		emailCount: caseRow.caseEmails.length,
		actions,
	};

	return (
		<main className="min-h-screen bg-surface">
			<header className="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto">
				<span className="text-xl font-bold text-primary tracking-tight">denim</span>
				<Link
					href={`/dashboard/${params.schemaId}/cases`}
					className="text-sm font-medium text-accent-text hover:underline"
				>
					&larr; Back to Cases
				</Link>
			</header>

			<div className="px-6 py-4 max-w-4xl mx-auto">
				<CaseDetail
					caseData={caseData}
					emails={emails}
					summaryLabels={
						caseRow.schema.summaryLabels as {
							beginning: string;
							middle: string;
							end: string;
						}
					}
					extractedFieldDefs={caseRow.schema.extractedFields}
					schemaId={params.schemaId}
					clusterRecords={clusterRecords.map((c) => ({
						action: c.action,
						emailIds: c.emailIds as string[],
						score: c.score,
						primaryTag: c.primaryTag,
						scoreBreakdown: c.scoreBreakdown as Record<string, number> | null,
					}))}
				/>
			</div>
		</main>
	);
}
