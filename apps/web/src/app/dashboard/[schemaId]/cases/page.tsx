import { CaseFeed } from "@/components/cases/case-feed";
import { prisma } from "@/lib/prisma";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function CaseFeedPage({
	params,
}: {
	params: { schemaId: string };
}) {
	const supabase = createServerSupabaseClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) {
		redirect("/");
	}

	const schema = await prisma.caseSchema.findUnique({
		where: { id: params.schemaId },
		select: {
			id: true,
			name: true,
			domain: true,
			userId: true,
			summaryLabels: true,
			entities: {
				where: { type: "PRIMARY", isActive: true },
				select: { id: true, name: true, emailCount: true },
				orderBy: { emailCount: "desc" },
			},
		},
	});

	if (!schema || schema.userId !== user.id) {
		redirect("/dashboard");
	}

	// Load initial cases
	const cases = await prisma.case.findMany({
		where: { schemaId: params.schemaId },
		orderBy: { lastEmailDate: "desc" },
		take: 21,
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

	// Count by status
	const statusCounts = await prisma.case.groupBy({
		by: ["status"],
		where: { schemaId: params.schemaId },
		_count: { _all: true },
	});

	const counts: Record<string, number> = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0 };
	for (const row of statusCounts) {
		counts[row.status] = row._count._all;
	}

	const hasMore = cases.length > 20;
	const items = hasMore ? cases.slice(0, 20) : cases;
	const nextCursor = hasMore ? items[items.length - 1].id : null;

	const serializedCases = items.map((c) => ({
		id: c.id,
		schemaId: c.schemaId,
		entityId: c.entityId,
		title: c.title,
		summary: c.summary as { beginning: string; middle: string; end: string },
		primaryActor: c.primaryActor as { name: string; entityType: string } | null,
		displayTags: c.displayTags as string[],
		anchorTags: c.anchorTags as string[],
		status: c.status as "OPEN" | "IN_PROGRESS" | "RESOLVED",
		aggregatedData: c.aggregatedData as Record<string, unknown>,
		startDate: c.startDate?.toISOString() ?? null,
		endDate: c.endDate?.toISOString() ?? null,
		lastSenderName: c.lastSenderName,
		lastSenderEntity: c.lastSenderEntity,
		lastEmailDate: c.lastEmailDate?.toISOString() ?? null,
		viewedAt: c.viewedAt?.toISOString() ?? null,
		feedbackRating: c.feedbackRating as "up" | "down" | null,
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

	const totalCases = Object.values(counts).reduce((a, b) => a + b, 0);

	return (
		<main className="min-h-screen bg-surface">
			<header className="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto">
				<span className="text-xl font-bold text-primary tracking-tight">denim</span>
				<Link
					href={`/dashboard/${params.schemaId}`}
					className="text-sm font-medium text-accent-text hover:underline"
				>
					&larr; Back to {schema.name}
				</Link>
			</header>

			<div className="px-6 py-4 max-w-4xl mx-auto">
				<div className="mb-6">
					<h1 className="text-2xl font-bold text-primary">{schema.name} Cases</h1>
					<p className="text-sm text-muted mt-1">
						{totalCases} {totalCases === 1 ? "case" : "cases"}
					</p>
				</div>

				<CaseFeed
					schemaId={schema.id}
					initialCases={serializedCases}
					initialNextCursor={nextCursor}
					entities={schema.entities}
					statusCounts={counts}
				/>
			</div>
		</main>
	);
}
