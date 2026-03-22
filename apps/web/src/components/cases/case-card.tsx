"use client";

import { formatRelativeTime, formatEventDate } from "@/lib/utils/format-time";
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
	urgency?: string | null;
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
		eventStartTime?: string | null;
		status: string;
	}[];
}

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
	OPEN: { label: "Open", bg: "bg-blue-100", text: "text-blue-700" },
	IN_PROGRESS: { label: "In Progress", bg: "bg-amber-100", text: "text-amber-700" },
	RESOLVED: { label: "Resolved", bg: "bg-green-100", text: "text-green-700" },
};

const URGENCY_BADGE: Record<string, { label: string; bg: string; text: string } | undefined> = {
	IMMINENT: { label: "Imminent", bg: "bg-red-100", text: "text-red-700" },
	THIS_WEEK: { label: "This Week", bg: "bg-amber-100", text: "text-amber-700" },
	UPCOMING: undefined, // no extra badge for default
	NO_ACTION: { label: "No Action", bg: "bg-gray-100", text: "text-gray-500" },
	IRRELEVANT: { label: "Hidden", bg: "bg-gray-100", text: "text-gray-400" },
};

/**
 * Find the most relevant EVENT action to display on the card.
 * Prefers next future event; falls back to most recent past event.
 */
function getEventDisplay(actions: CaseCardData["actions"]): { title: string; date: Date; isPast: boolean } | null {
	const now = new Date();
	let closestFuture: { title: string; date: Date } | null = null;
	let closestPast: { title: string; date: Date } | null = null;

	for (const action of actions) {
		if (action.actionType !== "EVENT") continue;
		const dateStr = action.eventStartTime ?? action.dueDate;
		if (!dateStr) continue;
		const date = new Date(dateStr);
		if (date > now) {
			if (!closestFuture || date < closestFuture.date) {
				closestFuture = { title: action.title, date };
			}
		} else {
			if (!closestPast || date > closestPast.date) {
				closestPast = { title: action.title, date };
			}
		}
	}

	if (closestFuture) return { ...closestFuture, isPast: false };
	if (closestPast) return { ...closestPast, isPast: true };
	return null;
}

export function CaseCard({
	caseData,
	schemaId,
}: {
	caseData: CaseCardData;
	schemaId: string;
}) {
	const badge = STATUS_BADGE[caseData.status] ?? STATUS_BADGE.OPEN;
	const urgencyBadge = caseData.urgency ? URGENCY_BADGE[caseData.urgency] : undefined;
	const isUnread = caseData.viewedAt === null;
	const isMuted = caseData.urgency === "NO_ACTION" || caseData.urgency === "IRRELEVANT";
	const eventDisplay = getEventDisplay(caseData.actions);

	return (
		<Link href={`/dashboard/${schemaId}/cases/${caseData.id}`}>
			<CardShell className={`flex flex-col gap-2 hover:shadow-md hover:border-accent/30 border border-transparent transition-all cursor-pointer ${isMuted ? "opacity-60" : ""}`}>
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

				{/* Event date (prominent for upcoming, dimmed for past) */}
				{eventDisplay && (
					<div className={`flex items-center gap-1.5 text-xs font-medium rounded px-2 py-1 ${
						eventDisplay.isPast
							? "text-muted bg-gray-100"
							: "text-accent-text bg-accent/10"
					}`}>
						<span>{eventDisplay.isPast ? "Past" : "Next"}: {eventDisplay.title}</span>
						<span className="ml-auto whitespace-nowrap">{formatEventDate(eventDisplay.date)}</span>
					</div>
				)}

				{/* Line 3: Status badge + urgency badge + summary.end preview */}
				<div className="flex items-start gap-2">
					<span
						className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${badge.bg} ${badge.text}`}
					>
						{badge.label}
					</span>
					{urgencyBadge && (
						<span
							className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${urgencyBadge.bg} ${urgencyBadge.text}`}
						>
							{urgencyBadge.label}
						</span>
					)}
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
