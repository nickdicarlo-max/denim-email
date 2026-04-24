export interface GmailMessageMeta {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  senderEmail: string;
  senderDomain: string;
  senderDisplayName: string;
  recipients: string[];
  date: Date;
  snippet: string;
  isReply: boolean;
  labels: string[];
}

export interface GmailMessageFull extends GmailMessageMeta {
  body: string;
  attachmentIds: string[];
  attachmentCount: number;
}

/**
 * Inngest-replay-safe serialization of GmailMessageMeta. Sibling steps
 * that pass message lists to each other via Promise.all should return
 * this shape so the replay path (where Inngest re-hydrates step returns
 * from JSON) sees the same field types as the first-execution path.
 *
 * Convert with `serializeMessageForStep`. Date becomes an ISO string.
 * Do NOT add Date math on `m.date` against this shape — if you need
 * a Date, `new Date(m.date)` at the call site.
 */
export type SerializedGmailMessageMeta = Omit<GmailMessageMeta, "date"> & {
  date: string;
};

export function serializeMessageForStep(message: GmailMessageMeta): SerializedGmailMessageMeta {
  return { ...message, date: message.date.toISOString() };
}

export interface ScanDiscovery {
  domain: string;
  count: number;
  senders: string[];
  label: string;
}

/**
 * Structural interface for Stage 1 + Stage 2 discovery. Both the real
 * `GmailClient` and `FixtureGmailClient` satisfy this subset so eval harnesses
 * and offline validators can drive the real discovery code paths without
 * touching the Gmail API.
 *
 * Keep this intentionally narrow — add a method only when the discovery code
 * genuinely needs it. Broader responsibilities (full-body fetch, pacing,
 * attachments) stay on the concrete `GmailClient`.
 */
export interface GmailClientLike {
  listMessageIds(query: string, maxResults: number): Promise<string[]>;
  getMessageMetadata(
    messageId: string,
    headerNames?: string[],
  ): Promise<{
    id: string;
    payload: { headers: Array<{ name: string; value: string }> };
  }>;
}
