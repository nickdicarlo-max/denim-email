import { credentialFailure, ExternalAPIError, GmailCredentialError } from "@denim/types";
import { google } from "googleapis";
import { logger } from "@/lib/logger";
import type { GmailMessageFull, GmailMessageMeta, ScanDiscovery } from "./types";

const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "Date", "In-Reply-To"];
const BATCH_SIZE = 50;

/**
 * Read the HTTP status off a googleapis error. googleapis throws a shape
 * with either `code` (gaxios style) or `response.status` (axios style).
 */
function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { code?: unknown; response?: { status?: unknown } };
  if (typeof e.code === "number") return e.code;
  if (e.response && typeof e.response.status === "number") return e.response.status;
  return undefined;
}

/**
 * Convert a thrown Gmail API error into the right typed error for
 * downstream consumers. 401s become `GmailCredentialError` with
 * `reason: "revoked"` — Google told us the access token is dead, the
 * only remedy is to reconnect. Everything else stays as
 * `ExternalAPIError`.
 *
 * This is the sole classification point for Gmail API 401s post-#105.
 * Inngest catch blocks check `err instanceof GmailCredentialError` and
 * don't need to string-match error messages anymore.
 */
function wrapGmailApiError(error: unknown, operationLabel: string): Error {
  const status = httpStatusOf(error);
  const name = error instanceof Error ? error.name : "Error";

  if (status === 401) {
    return new GmailCredentialError(
      `Gmail API ${operationLabel} rejected: 401 (access token revoked or expired)`,
      credentialFailure("revoked"),
    );
  }

  return new ExternalAPIError(
    `Gmail ${operationLabel} failed: ${name}${status ? `:${status}` : ""}`,
    "gmail",
  );
}

interface ParsedAddress {
  email: string;
  displayName: string;
}

export class GmailClient {
  private gmail;

  constructor(accessToken: string) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: "v1", auth: oauth2Client });
  }

  /**
   * Search emails by query and return metadata for each message.
   * Uses Promise.allSettled for resilience -- partial failures are logged, not thrown.
   */
  async searchEmails(query: string, maxResults = 50): Promise<GmailMessageMeta[]> {
    const start = Date.now();
    const operation = "searchEmails";

    logger.info({ service: "gmail", operation, query, maxResults });

    try {
      const listResponse = await this.callGmailWithRetry(() =>
        this.gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults,
        }),
      );

      const messageIds = listResponse.data.messages?.map((m: any) => m.id) ?? [];
      if (messageIds.length === 0) {
        logger.info({
          service: "gmail",
          operation,
          durationMs: Date.now() - start,
          messageCount: 0,
        });
        return [];
      }

      // Fetch metadata in batches
      const messages: GmailMessageMeta[] = [];

      for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
        const batch = messageIds.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((id: string) =>
            this.callGmailWithRetry(() =>
              this.gmail.users.messages.get({
                userId: "me",
                id,
                format: "metadata",
                metadataHeaders: METADATA_HEADERS,
              }),
            ),
          ),
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            messages.push(this.parseMessageMeta(result.value.data));
          } else {
            logger.warn({
              service: "gmail",
              operation,
              error: result.reason,
            });
          }
        }
      }

      logger.info({
        service: "gmail",
        operation,
        durationMs: Date.now() - start,
        messageCount: messages.length,
      });

      return messages;
    } catch (error) {
      // Sanitize: Gmail error bodies can echo the Authorization Bearer
      // token on some proxies. Don't log `error.message` raw — name +
      // status only. wrapGmailApiError converts 401s to the typed
      // GmailCredentialError so Inngest catches don't need string match.
      const name = error instanceof Error ? error.name : "Error";
      const status = httpStatusOf(error);
      logger.error({ service: "gmail", operation, errorName: name, errorStatus: status });
      throw wrapGmailApiError(error, "search");
    }
  }

  /**
   * Get full message content including body and attachment IDs.
   */
  async getEmailFull(messageId: string): Promise<GmailMessageFull> {
    const start = Date.now();
    const operation = "getEmailFull";

    logger.info({ service: "gmail", operation, messageId });

    try {
      const response = await this.callGmailWithRetry(() =>
        this.gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        }),
      );

      const meta = this.parseMessageMeta(response.data);
      const body = this.extractBody(response.data.payload);
      const attachmentIds = this.extractAttachmentIds(response.data.payload);

      logger.info({
        service: "gmail",
        operation,
        messageId,
        durationMs: Date.now() - start,
      });

      return {
        ...meta,
        body,
        attachmentIds,
        attachmentCount: attachmentIds.length,
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const status = httpStatusOf(error);
      logger.error({
        service: "gmail",
        operation,
        messageId,
        errorName: name,
        errorStatus: status,
      });
      throw wrapGmailApiError(error, "getEmail");
    }
  }

  /**
   * List Gmail message IDs matching a query, without fetching per-message metadata.
   *
   * Thin wrapper around `users.messages.list` — one API call, returns only the
   * ID strings. Pair with `getMessageMetadata` when you want From/Subject/etc
   * headers but need to count per-message errors yourself.
   */
  async listMessageIds(query: string, maxResults: number): Promise<string[]> {
    const start = Date.now();
    const operation = "listMessageIds";

    logger.info({ service: "gmail", operation, query, maxResults });

    try {
      const response = await this.callGmailWithRetry(() =>
        this.gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults,
        }),
      );

      const ids = response.data.messages?.map((m: { id?: string | null }) => m.id ?? "") ?? [];
      const filtered = ids.filter((id: string) => id.length > 0);

      logger.info({
        service: "gmail",
        operation,
        durationMs: Date.now() - start,
        messageCount: filtered.length,
      });

      return filtered;
    } catch (error) {
      // Sanitize: Gmail 401/403 response bodies can echo the Authorization
      // Bearer token on some proxies. Log only error name + HTTP status,
      // never the raw error.message.
      const name = error instanceof Error ? error.name : "Error";
      const status = httpStatusOf(error);
      logger.error({ service: "gmail", operation, errorName: name, errorStatus: status });
      throw wrapGmailApiError(error, "list");
    }
  }

  /**
   * Fetch metadata (selected headers only) for a single Gmail message.
   *
   * Returns the raw response payload shape `{ id, payload: { headers } }` so
   * callers can decide which headers to read. Per Gmail API semantics, the
   * response includes ONLY the headers named in `headerNames`.
   *
   * Errors are thrown as-is (not wrapped in ExternalAPIError) so the caller
   * can count per-message failures. Transient errors are already retried by
   * `callGmailWithRetry`.
   */
  async getMessageMetadata(
    messageId: string,
    headerNames: string[] = ["From", "Subject"],
  ): Promise<{ id: string; payload: { headers: Array<{ name: string; value: string }> } }> {
    const response = await this.callGmailWithRetry(() =>
      this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: headerNames,
      }),
    );

    const data = response.data as {
      id?: string | null;
      payload?: { headers?: Array<{ name?: string | null; value?: string | null }> };
    };

    const headers = (data.payload?.headers ?? [])
      .filter((h) => typeof h.name === "string" && typeof h.value === "string")
      .map((h) => ({ name: h.name as string, value: h.value as string }));

    return {
      id: data.id ?? messageId,
      payload: { headers },
    };
  }

  /**
   * Fetch recent emails and group by sender domain.
   * Returns messages and discovery summary sorted by count descending.
   *
   * @param maxResults - Max emails to fetch (default 200).
   * @param newerThan - Optional Gmail `newer_than:` constraint, e.g. "56d".
   *   When provided, restricts the random sample to recent emails.
   */
  async sampleScan(
    maxResults = 200,
    newerThan?: string,
  ): Promise<{ messages: GmailMessageMeta[]; discoveries: ScanDiscovery[] }> {
    const start = Date.now();
    const operation = "sampleScan";

    logger.info({ service: "gmail", operation, maxResults, newerThan });

    const query = newerThan ? `newer_than:${newerThan}` : "";
    const messages = await this.searchEmails(query, maxResults);

    // Group by sender domain
    const domainMap = new Map<
      string,
      { count: number; senders: Set<string>; labels: Set<string> }
    >();

    for (const msg of messages) {
      const existing = domainMap.get(msg.senderDomain);
      if (existing) {
        existing.count++;
        existing.senders.add(msg.senderEmail);
        for (const label of msg.labels) {
          existing.labels.add(label);
        }
      } else {
        domainMap.set(msg.senderDomain, {
          count: 1,
          senders: new Set([msg.senderEmail]),
          labels: new Set(msg.labels),
        });
      }
    }

    const discoveries: ScanDiscovery[] = Array.from(domainMap.entries())
      .map(([domain, data]) => ({
        domain,
        count: data.count,
        senders: Array.from(data.senders),
        label: Array.from(data.labels)[0] ?? "",
      }))
      .sort((a, b) => b.count - a.count);

    logger.info({
      service: "gmail",
      operation,
      durationMs: Date.now() - start,
      messageCount: messages.length,
      domainCount: discoveries.length,
    });

    return { messages, discoveries };
  }

  /**
   * Get full message content with a configurable delay after the call.
   * Useful for batch extraction to pace Gmail API usage.
   */
  async getEmailFullWithPacing(messageId: string, delayMs = 100): Promise<GmailMessageFull> {
    const result = await this.getEmailFull(messageId);
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return result;
  }

  /**
   * Extract attachment metadata from a MIME payload without downloading content.
   * Recursively walks the MIME tree to collect filename, mimeType, and size.
   */
  extractAttachmentMetadata(payload: any): Array<{
    gmailAttachmentId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    const attachments: Array<{
      gmailAttachmentId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }> = [];
    if (!payload) return attachments;

    if (payload.body?.attachmentId && payload.filename) {
      attachments.push({
        gmailAttachmentId: payload.body.attachmentId,
        filename: payload.filename,
        mimeType: payload.mimeType ?? "application/octet-stream",
        sizeBytes: payload.body.size ?? 0,
      });
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        attachments.push(...this.extractAttachmentMetadata(part));
      }
    }

    return attachments;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Retry wrapper for Gmail API calls.
   * Retries on rate limit (429) and quota exceeded (403) errors with exponential backoff.
   * Non-rate-limit errors are thrown immediately.
   */
  private async callGmailWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        if (attempt === maxRetries) throw error;
        const code =
          (error as { code?: number })?.code ??
          (error as { response?: { status?: number } })?.response?.status;
        const isRateLimit = code === 429 || code === 403;
        if (!isRateLimit) throw error;
        const delay = 1000 * 3 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error("Unreachable");
  }

  private parseMessageMeta(msg: any): GmailMessageMeta {
    const headers: Record<string, string> = {};
    for (const header of msg.payload?.headers ?? []) {
      headers[header.name] = header.value;
    }

    const from = headers.From ?? "";
    const parsed = this.parseEmailAddress(from);
    const domain = parsed.email.split("@")[1] ?? "";

    return {
      id: msg.id ?? "",
      threadId: msg.threadId ?? "",
      subject: headers.Subject ?? "",
      sender: from,
      senderEmail: parsed.email,
      senderDomain: domain,
      senderDisplayName: parsed.displayName,
      recipients: this.parseRecipients(headers.To, headers.Cc),
      date: new Date(headers.Date ?? msg.internalDate ?? 0),
      snippet: msg.snippet ?? "",
      isReply: Boolean(headers["In-Reply-To"]),
      labels: msg.labelIds ?? [],
    };
  }

  /**
   * Parse "John Doe <john@example.com>" into { email, displayName }.
   * Handles plain "john@example.com" as well.
   */
  private parseEmailAddress(raw: string): ParsedAddress {
    const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
    if (match) {
      return {
        displayName: match[1].replace(/^["']|["']$/g, "").trim(),
        email: match[2].toLowerCase(),
      };
    }
    const email = raw.trim().toLowerCase();
    return { displayName: "", email };
  }

  /**
   * Split To + Cc header values into an array of email addresses.
   */
  private parseRecipients(to?: string, cc?: string): string[] {
    const emails: string[] = [];
    const raw = [to, cc].filter(Boolean).join(", ");

    if (!raw) return emails;

    // Split on commas, but respect quoted strings and angle brackets
    const parts = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    for (const part of parts) {
      const parsed = this.parseEmailAddress(part.trim());
      if (parsed.email) {
        emails.push(parsed.email);
      }
    }

    return emails;
  }

  /**
   * Recursively extract body text from a MIME payload.
   * Prefers text/plain, falls back to text/html.
   */
  private extractBody(payload: any): string {
    if (!payload) return "";

    // Direct body on the payload
    if (payload.mimeType === "text/plain" && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64").toString("utf-8");
    }

    // Recurse into multipart
    if (payload.parts) {
      // First pass: look for text/plain
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64").toString("utf-8");
        }
      }
      // Second pass: look for text/html
      for (const part of payload.parts) {
        if (part.mimeType === "text/html" && part.body?.data) {
          return Buffer.from(part.body.data, "base64").toString("utf-8");
        }
      }
      // Third pass: recurse into nested multipart
      for (const part of payload.parts) {
        const body = this.extractBody(part);
        if (body) return body;
      }
    }

    // Fallback: if body data exists at the top level
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, "base64").toString("utf-8");
    }

    return "";
  }

  /**
   * Recursively extract attachment IDs from a MIME payload.
   */
  private extractAttachmentIds(payload: any): string[] {
    const ids: string[] = [];
    if (!payload) return ids;

    if (payload.body?.attachmentId && payload.filename) {
      ids.push(payload.body.attachmentId);
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        ids.push(...this.extractAttachmentIds(part));
      }
    }

    return ids;
  }
}
