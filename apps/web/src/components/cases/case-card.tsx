"use client";

import Link from "next/link";
import { formatShortDate } from "@/lib/utils/format-time";
import { DomainContextLine } from "./domain-context-line";

export interface CaseCardData {
  id: string;
  schemaId: string;
  entityId: string;
  title: string;
  emoji?: string | null;
  mood?: string | null;
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
  entityName?: string;
  actions: {
    id: string;
    title: string;
    actionType: string;
    dueDate: string | null;
    eventStartTime?: string | null;
    eventEndTime?: string | null;
    eventLocation?: string | null;
    amount?: number | null;
    currency?: string | null;
    status: string;
    reminderCount?: number;
  }[];
}

const MOOD_ICONS: Record<string, string> = {
  celebratory: "\u2728",
  urgent: "\u26A0\uFE0F",
  positive: "\uD83D\uDE0A",
  neutral: "",
  negative: "\uD83D\uDE1F",
};

const URGENCY_BORDER: Record<string, string> = {
  IMMINENT: "border-l-imminent",
  THIS_WEEK: "border-l-accent",
  UPCOMING: "border-l-upcoming",
  NO_ACTION: "border-l-surface-highest",
  IRRELEVANT: "border-l-surface-highest",
};

function getMoodBorderOverride(mood: string | null | undefined): string | null {
  if (mood === "celebratory") return "border-l-[#D4A373]";
  return null;
}

function formatDateRange(startDate: string | null, lastEmailDate: string | null): string {
  const parts: string[] = [];
  if (lastEmailDate) {
    parts.push(formatShortDate(new Date(lastEmailDate)));
  }
  if (startDate && lastEmailDate) {
    const start = new Date(startDate);
    const end = new Date(lastEmailDate);
    const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (days > 0) parts.push(`${days}d active`);
  }
  return parts.join(" \u2013 ");
}

interface CaseCardProps {
  caseData: CaseCardData;
  schemaId: string;
  schemaDomain?: string;
}

export function CaseCard({ caseData, schemaDomain }: CaseCardProps) {
  const isMuted = caseData.urgency === "NO_ACTION" || caseData.urgency === "IRRELEVANT";
  const moodBorder = getMoodBorderOverride(caseData.mood);
  const borderColor =
    moodBorder ?? URGENCY_BORDER[caseData.urgency ?? "UPCOMING"] ?? "border-l-accent";
  const isUnread = caseData.viewedAt === null;
  const moodIcon = caseData.mood ? (MOOD_ICONS[caseData.mood] ?? "") : "";
  const pendingActions = caseData.actions.filter((a) => a.status === "PENDING");
  const topAction = pendingActions[0];
  const moreCount = pendingActions.length - 1;

  return (
    <Link href={`/feed/${caseData.id}`}>
      <div
        className={[
          "bg-white rounded-lg px-5 py-4 border-l-4 transition-all cursor-pointer",
          "hover:shadow-lg hover:scale-[1.005]",
          borderColor,
          isMuted ? "opacity-60" : "",
        ].join(" ")}
      >
        {/* Line 1: emoji + entity name + mood + unread dot */}
        <div className="flex items-center gap-2 mb-1">
          {caseData.emoji && <span className="text-base">{caseData.emoji}</span>}
          <span className="text-sm font-semibold text-primary truncate">
            {caseData.entityName || "Unknown"}
          </span>
          {moodIcon && <span className="text-sm">{moodIcon}</span>}
          {isUnread && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 ml-auto" />}
        </div>

        {/* Line 2: case title */}
        <h3 className="text-md font-semibold text-primary truncate mb-1">
          {caseData.title || "Untitled Case"}
        </h3>

        {/* Line 3: domain context */}
        {schemaDomain && (
          <DomainContextLine
            domain={schemaDomain}
            actions={caseData.actions}
            lastSenderName={caseData.lastSenderName}
          />
        )}

        {/* Line 4: top action + more count */}
        {topAction && (
          <div className="flex items-center gap-2 text-sm text-secondary mt-1">
            <span className="material-symbols-outlined text-[16px] text-muted">
              check_box_outline_blank
            </span>
            <span className="truncate flex-1">{topAction.title}</span>
            {moreCount > 0 && (
              <span className="text-xs text-muted whitespace-nowrap">+{moreCount} more</span>
            )}
          </div>
        )}

        {/* Line 5: date range */}
        {(caseData.startDate || caseData.lastEmailDate) && (
          <p className="text-xs text-muted text-right mt-1.5">
            {formatDateRange(caseData.startDate, caseData.lastEmailDate)}
          </p>
        )}
      </div>
    </Link>
  );
}
