/**
 * Standalone Gmail JSON parser — converts raw Gmail API message JSON
 * into GmailMessageFull objects. Handles both base64 strings (live API)
 * and byte arrays (exported fixtures).
 *
 * Logic mirrors GmailClient private methods (client.ts:279-400) but
 * is decoupled from OAuth and the googleapis SDK.
 */

import type { GmailMessageFull, GmailMessageMeta } from "./types";

// ── Public API ──────────────────────────────────────────────────────

/**
 * Parse a raw Gmail API JSON message into a GmailMessageFull.
 * Works with both live API responses and exported fixture files.
 */
export function parseGmailJson(raw: Record<string, unknown>): GmailMessageFull {
  const meta = parseMessageMeta(raw);
  const payload = (raw as any).payload;
  const body = extractBody(payload);
  const attachmentIds = extractAttachmentIds(payload);

  return {
    ...meta,
    body,
    attachmentIds,
    attachmentCount: attachmentIds.length,
  };
}

// ── Metadata parsing ────────────────────────────────────────────────

function parseMessageMeta(msg: any): GmailMessageMeta {
  const headers: Record<string, string> = {};
  for (const header of msg.payload?.headers ?? []) {
    headers[header.name] = header.value;
  }

  const from = headers.From ?? "";
  const parsed = parseEmailAddress(from);
  const domain = parsed.email.split("@")[1] ?? "";

  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    subject: headers.Subject ?? "",
    sender: from,
    senderEmail: parsed.email,
    senderDomain: domain,
    senderDisplayName: parsed.displayName,
    recipients: parseRecipients(headers.To, headers.Cc),
    date: new Date(headers.Date ?? msg.internalDate ?? 0),
    snippet: msg.snippet ?? "",
    isReply: Boolean(headers["In-Reply-To"]),
    labels: msg.labelIds ?? [],
  };
}

// ── Body extraction ─────────────────────────────────────────────────

/**
 * Decode body data that may be either a base64 string (live Gmail API)
 * or a byte array (exported fixture JSON).
 */
function decodeBodyData(data: string | number[]): string {
  if (Array.isArray(data)) {
    return Buffer.from(data).toString("utf-8");
  }
  return Buffer.from(data, "base64").toString("utf-8");
}

/**
 * Recursively extract body text from a MIME payload.
 * Prefers text/plain, falls back to text/html, then nested multipart.
 */
function extractBody(payload: any): string {
  if (!payload) return "";

  // Direct body on the payload
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBodyData(payload.body.data);
  }

  // Recurse into multipart
  if (payload.parts) {
    // First pass: look for text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBodyData(part.body.data);
      }
    }
    // Second pass: look for text/html
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBodyData(part.body.data);
      }
    }
    // Third pass: recurse into nested multipart
    for (const part of payload.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }

  // Fallback: if body data exists at the top level
  if (payload.body?.data) {
    return decodeBodyData(payload.body.data);
  }

  return "";
}

// ── Attachment extraction ───────────────────────────────────────────

function extractAttachmentIds(payload: any): string[] {
  const ids: string[] = [];
  if (!payload) return ids;

  if (payload.body?.attachmentId && payload.filename) {
    ids.push(payload.body.attachmentId);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      ids.push(...extractAttachmentIds(part));
    }
  }

  return ids;
}

// ── Header helpers ──────────────────────────────────────────────────

interface ParsedAddress {
  displayName: string;
  email: string;
}

/**
 * Parse "John Doe <john@example.com>" into { email, displayName }.
 * Handles plain "john@example.com" as well.
 */
function parseEmailAddress(raw: string): ParsedAddress {
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
function parseRecipients(to?: string, cc?: string): string[] {
  const emails: string[] = [];
  const raw = [to, cc].filter(Boolean).join(", ");
  if (!raw) return emails;

  const parts = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const part of parts) {
    const parsed = parseEmailAddress(part.trim());
    if (parsed.email) {
      emails.push(parsed.email);
    }
  }

  return emails;
}
