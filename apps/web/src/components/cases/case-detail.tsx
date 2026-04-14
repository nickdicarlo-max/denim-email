"use client";

import { Tag } from "../ui/tag";
import { ActionList } from "./action-list";
import { CaseSummary } from "./case-summary";

import { EmailList, type EmailWithAssignment } from "./email-list";
import { ThumbsFeedback } from "./thumbs-feedback";

interface CaseDetailProps {
  caseData: {
    id: string;
    schemaId: string;
    entityId: string;
    entityName: string;
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
    actions: {
      id: string;
      caseId: string;
      title: string;
      description: string | null;
      actionType: "TASK" | "EVENT" | "PAYMENT" | "DEADLINE" | "RESPONSE";
      dueDate: string | null;
      eventStartTime: string | null;
      eventEndTime: string | null;
      eventLocation: string | null;
      status: "PENDING" | "DONE" | "EXPIRED" | "SUPERSEDED" | "DISMISSED";
      reminderCount: number;
      confidence: number;
      amount: number | null;
      currency: string | null;
    }[];
  };
  emails: EmailWithAssignment[];
  summaryLabels: { beginning: string; middle: string; end: string };
  extractedFieldDefs: { name: string; type: string; format: string | null }[];
  schemaId: string;
  clusterRecords?: {
    action: string;
    emailIds: string[];
    score: number | null;
    primaryTag: string | null;
    scoreBreakdown: Record<string, number> | null;
  }[];
}

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  OPEN: { label: "Open", bg: "bg-blue-100", text: "text-blue-700" },
  IN_PROGRESS: { label: "In Progress", bg: "bg-amber-100", text: "text-amber-700" },
  RESOLVED: { label: "Resolved", bg: "bg-green-100", text: "text-green-700" },
};

export function CaseDetail({
  caseData,
  emails,
  summaryLabels,
  extractedFieldDefs,
  schemaId,
  clusterRecords,
}: CaseDetailProps) {
  const badge = STATUS_BADGE[caseData.status] ?? STATUS_BADGE.OPEN;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-primary">{caseData.title || "Untitled Case"}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}
              >
                {badge.label}
              </span>
              <span className="text-sm text-secondary">{caseData.entityName}</span>
              {caseData.primaryActor && (
                <span className="text-sm text-muted">{caseData.primaryActor.name}</span>
              )}
            </div>
          </div>
          <ThumbsFeedback
            schemaId={schemaId}
            caseId={caseData.id}
            initialRating={caseData.feedbackRating}
          />
        </div>

        {/* Tags */}
        {caseData.displayTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {caseData.displayTags.map((tag) => (
              <Tag key={tag} label={tag} size="sm" />
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      <CaseSummary
        summary={caseData.summary}
        summaryLabels={summaryLabels}
        aggregatedData={caseData.aggregatedData}
        extractedFieldDefs={extractedFieldDefs}
      />

      {/* Actions */}
      {caseData.actions.length > 0 && <ActionList actions={caseData.actions} schemaId={schemaId} />}

      {/* Emails */}
      <EmailList emails={emails} schemaId={schemaId} />
    </div>
  );
}
