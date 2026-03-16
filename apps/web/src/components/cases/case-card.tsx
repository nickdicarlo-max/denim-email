"use client";

import { formatRelativeTime } from "@/lib/utils/format-time";
import Link from "next/link";
import { CardShell } from "../ui/card-shell";
import { Tag } from "../ui/tag";

export interface CaseCardData {
	id: string;
	schemaId: string;
	entityId: string;
	title: string;
	summary: { beginning: string; middle: string; end: string };
	primaryActor: { name: string; entityType: string } | null;
	displayTags: string[];
	anchorTags: string[];
	status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
	aggregatedData: Record<string, unknown>;
	startDate: string | null;
	endDate: string | null;
	lastSenderName: string | null;
	lastSenderEntity: string | null;
	lastEmailDate: string | null;
	viewedAt: string | null;
	feedbackRating: "up" | "down" | null;
	emailCount: number;
	entityName: string;
	actions: {
		id: string;
		title: string;
		actionType: string;
		dueDate: string | null;
		status: string;
	}[];
}

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
	OPEN: { label: "Open", bg: "bg-blue-100", text: "text-blue-700" },
	IN_PROGRESS: { label: "In Progress", bg: "bg-amber-100", text: "text-amber-700" },
	RESOLVED: { label: "Resolved", bg: "bg-green-100", text: "text-green-700" },
};

export function CaseCard({
	caseData,
	schemaId,
}: {
	caseData: CaseCardData;
	schemaId: string;
}) {
	const badge = STATUS_BADGE[caseData.status] ?? STATUS_BADGE.OPEN;
	const isUnread = caseData.viewedAt === null;

	return (
		<Link href={`/dashboard/${schemaId}/cases/${caseData.id}`}>
			<CardShell className="flex flex-col gap-2 hover:shadow-md hover:border-accent/30 border border-transparent transition-all cursor-pointer">
				{/* Line 1: Title + unread dot */}
				<div className="flex items-start gap-2">
					{isUnread && (
						<span className="mt-1.5 w-2 h-2 rounded-full bg-accent flex-shrink-0" />
					)}
					<h3 className="text-base font-bold text-primary line-clamp-2 flex-1">
						{caseData.title || "Untitled Case"}
					</h3>
				</div>

				{/* Line 2: Last sender + relative date */}
				<div className="flex items-center gap-2 text-xs text-secondary">
					{caseData.lastSenderEntity ? (
						<span className="truncate">{caseData.lastSenderEntity}</span>
					) : caseData.lastSenderName ? (
						<span className="truncate">{caseData.lastSenderName}</span>
					) : null}
					{caseData.lastEmailDate && (
						<span className="text-muted ml-auto whitespace-nowrap">
							{formatRelativeTime(new Date(caseData.lastEmailDate))}
						</span>
					)}
				</div>

				{/* Line 3: Status badge + summary.end preview */}
				<div className="flex items-start gap-2">
					<span
						className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${badge.bg} ${badge.text}`}
					>
						{badge.label}
					</span>
					{caseData.summary?.end && (
						<p className="text-xs text-secondary line-clamp-2 flex-1">
							{caseData.summary.end}
						</p>
					)}
				</div>

				{/* Line 4: Pending actions preview */}
				{caseData.actions.length > 0 && (
					<div className="space-y-1">
						{caseData.actions.map((action) => (
							<div
								key={action.id}
								className="flex items-center gap-1.5 text-xs text-secondary"
							>
								<ActionTypeIcon type={action.actionType} />
								<span className="truncate">{action.title}</span>
								{action.dueDate && (
									<span className="text-muted ml-auto whitespace-nowrap">
										due {formatRelativeTime(new Date(action.dueDate))}
									</span>
								)}
							</div>
						))}
					</div>
				)}

				{/* Footer: Tags + email count */}
				<div className="flex items-center gap-2 pt-1 border-t border-border">
					<div className="flex gap-1 flex-1 min-w-0 overflow-hidden">
						{caseData.displayTags.slice(0, 2).map((tag) => (
							<Tag key={tag} label={tag} size="sm" />
						))}
					</div>
					<span className="text-xs text-muted whitespace-nowrap">
						{caseData.emailCount} {caseData.emailCount === 1 ? "email" : "emails"}
					</span>
				</div>
			</CardShell>
		</Link>
	);
}

function ActionTypeIcon({ type }: { type: string }) {
	const icons: Record<string, string> = {
		TASK: "\u2610",
		EVENT: "\uD83D\uDCC5",
		PAYMENT: "\uD83D\uDCB0",
		DEADLINE: "\u23F0",
		RESPONSE: "\u2709\uFE0F",
	};
	return <span className="flex-shrink-0">{icons[type] ?? "\u2610"}</span>;
}
