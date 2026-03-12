/**
 * UI-facing model types matching Prisma shapes.
 * Used by API responses and React components.
 */

export interface CaseForUI {
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
  actions: CaseActionForUI[];
}

export interface CaseActionForUI {
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
}

export interface EmailForUI {
  id: string;
  schemaId: string;
  subject: string;
  sender: string;
  senderDisplayName: string;
  senderDomain: string;
  date: string;
  summary: string;
  tags: string[];
  attachmentCount: number;
  clusteringConfidence: number | null;
  alternativeCaseId: string | null;
  isExcluded: boolean;
}

export interface EntityForUI {
  id: string;
  schemaId: string;
  name: string;
  type: "PRIMARY" | "SECONDARY";
  secondaryTypeName: string | null;
  aliases: string[];
  autoDetected: boolean;
  isActive: boolean;
  emailCount: number;
}
