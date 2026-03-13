import { logger } from "@/lib/logger";
import { ExternalAPIError } from "@denim/types";
import { google } from "googleapis";
import type { GmailMessageFull, GmailMessageMeta, ScanDiscovery } from "./types";

const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "Date", "In-Reply-To"];
const BATCH_SIZE = 50;

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
      const listResponse = await this.gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults,
      });

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
            this.gmail.users.messages.get({
              userId: "me",
              id,
              format: "metadata",
              metadataHeaders: METADATA_HEADERS,
            }),
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
      logger.error({ service: "gmail", operation, error });
      throw new ExternalAPIError(
        `Gmail search failed: ${error instanceof Error ? error.message : String(error)}`,
        "gmail",
      );
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
      const response = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

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
      logger.error({ service: "gmail", operation, messageId, error });
      throw new ExternalAPIError(
        `Gmail getEmail failed: ${error instanceof Error ? error.message : String(error)}`,
        "gmail",
      );
    }
  }

  /**
   * Fetch recent emails and group by sender domain.
   * Returns messages and discovery summary sorted by count descending.
   */
  async sampleScan(
    maxResults = 200,
  ): Promise<{ messages: GmailMessageMeta[]; discoveries: ScanDiscovery[] }> {
    const start = Date.now();
    const operation = "sampleScan";

    logger.info({ service: "gmail", operation, maxResults });

    const messages = await this.searchEmails("", maxResults);

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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
