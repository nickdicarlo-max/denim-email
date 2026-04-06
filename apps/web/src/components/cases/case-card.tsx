"use client";

import Link from "next/link";
import { formatEventDate, formatRelativeTime } from "@/lib/utils/format-time";
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

const STATUS_STYLE: Record<string, { label: string; classes: string }> = {
  OPEN: { label: "Open", classes: "bg-accent-soft text-accent-text" },
  IN_PROGRESS: { label: "In Progress", classes: "bg-upcoming-soft text-upcoming-text" },
  RESOLVED: { label: "Resolved", classes: "bg-success-soft text-success-text" },
};

const URGENCY_BORDER: Record<string, string> = {
  IMMINENT: "border-l-imminent",
  THIS_WEEK: "border-l-accent",
  UPCOMING: "border-l-upcoming",
  NO_ACTION: "border-l-surface-highest",
  IRRELEVANT: "border-l-surface-highest",
};

function getEventDisplay(
  actions: CaseCardData["actions"],
): { title: string; date: Date; isPast: boolean } | null {
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

export function CaseCard({ caseData, schemaId }: { caseData: CaseCardData; schemaId: string }) {
  const badge = STATUS_STYLE[caseData.status] ?? STATUS_STYLE.OPEN;
  const isMuted = caseData.urgency === "NO_ACTION" || caseData.urgency === "IRRELEVANT";
  const borderColor = URGENCY_BORDER[caseData.urgency ?? "UPCOMING"] ?? "border-l-accent";
  const eventDisplay = getEventDisplay(caseData.actions);
  const isUnread = caseData.viewedAt === null;

  return (
    <Link href={`/dashboard/${schemaId}/cases/${caseData.id}`}>
      <div
        className={[
          "bg-white rounded-lg p-5 md:p-6 border-l-4 transition-all cursor-pointer",
          "hover:shadow-lg hover:scale-[1.005]",
          borderColor,
          isMuted ? "opacity-60" : "",
        ].join(" ")}
      >
        {/* Header: title + status badge */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {isUnread && <span className="mt-2 w-2 h-2 rounded-full bg-accent flex-shrink-0" />}
            <h3 className="text-md font-semibold text-primary line-clamp-2">
              {caseData.title || "Untitled Case"}
            </h3>
          </div>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-sm whitespace-nowrap ${badge.classes}`}
          >
            {badge.label}
          </span>
        </div>

        {/* Meta: sender + relative date */}
        <div className="flex items-center gap-2 text-sm text-secondary mb-2">
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

        {/* Summary preview */}
        {caseData.summary?.end && (
          <p className="text-sm text-secondary line-clamp-2 mb-3 leading-relaxed">
            {caseData.summary.end}
          </p>
        )}

        {/* Event display */}
        {eventDisplay && (
          <div
            className={[
              "flex items-center gap-2 text-xs font-medium rounded-sm px-3 py-2 mb-3",
              eventDisplay.isPast ? "text-muted bg-surface-mid" : "text-accent-text bg-accent-soft",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-[16px]">
              {eventDisplay.isPast ? "history" : "event"}
            </span>
            <span>
              {eventDisplay.isPast ? "Past" : "Next"}: {eventDisplay.title}
            </span>
            <span className="ml-auto whitespace-nowrap">{formatEventDate(eventDisplay.date)}</span>
          </div>
        )}

        {/* Pending actions */}
        {caseData.actions.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {caseData.actions.slice(0, 2).map((action) => (
              <div key={action.id} className="flex items-center gap-2 text-sm text-secondary">
                <span className="material-symbols-outlined text-[16px] text-muted">
                  {ACTION_ICONS[action.actionType] ?? "check_box_outline_blank"}
                </span>
                <span className="truncate">{action.title}</span>
                {action.dueDate && (
                  <span className="text-muted ml-auto whitespace-nowrap text-xs">
                    due {formatRelativeTime(new Date(action.dueDate))}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer: tags + email count */}
        <div className="flex items-center gap-2 pt-3">
          <div className="flex gap-1.5 flex-1 min-w-0 overflow-hidden">
            {caseData.displayTags.slice(0, 2).map((tag) => (
              <Tag key={tag} label={tag} size="sm" />
            ))}
          </div>
          <span className="text-xs text-muted whitespace-nowrap flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">mail</span>
            {caseData.emailCount}
          </span>
        </div>
      </div>
    </Link>
  );
}

const ACTION_ICONS: Record<string, string> = {
  TASK: "check_box_outline_blank",
  EVENT: "event",
  PAYMENT: "payments",
  DEADLINE: "schedule",
  RESPONSE: "reply",
};
