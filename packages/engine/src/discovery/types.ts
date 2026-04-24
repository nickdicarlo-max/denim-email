/**
 * Pure input shape for discovery-layer aggregation. A row pairs a Gmail
 * message ID with its raw `From:` header value. The I/O that produces
 * these rows lives in apps/web (`lib/discovery/gmail-metadata-fetch.ts`);
 * the engine just consumes them.
 */
export interface FromHeaderResult {
  messageId: string;
  fromHeader: string;
}
