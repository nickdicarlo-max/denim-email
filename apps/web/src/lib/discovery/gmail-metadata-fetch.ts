/**
 * Stage 1 primitive: metadata-only batch fetch of Gmail `From` headers.
 *
 * Composes two GmailClient primitives — `listMessageIds` (single API call
 * returning IDs) and `getMessageMetadata` (one-header-set-per-message fetch) —
 * with configurable parallel batching and pacing.
 *
 * Unlike `GmailClient.searchEmails`, which warn-logs and swallows per-message
 * failures, this function **counts** per-message errors and surfaces the
 * first one (sanitized — no PII, no tokens) so the caller can decide whether
 * a Stage 1 pass is trustworthy. Applying the 2026-04-09 silent-error lesson.
 *
 * Pacing: after each batch EXCEPT the last, sleep `pacingMs`. Gmail throttles
 * aggressively on burst; this lets us stay under the per-user quota at the
 * Stage 1 target of 500 metadata fetches.
 */

import type { FromHeaderResult } from "@denim/engine";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import type { GmailClientLike } from "@/lib/gmail/types";
import { logger } from "@/lib/logger";

export type { FromHeaderResult };

/**
 * Extended row carrying headers beyond `From:`. Used by the Stage 1
 * compounding-signal scorer to detect List-Unsubscribe dominance (a
 * newsletter / bulk-mail veto signal per master plan §7 principle #4).
 * `fromHeader` matches `FromHeaderResult.fromHeader` for backward compat.
 */
export interface FromHeaderResultWithMeta extends FromHeaderResult {
  /** Raw `List-Unsubscribe` header value when requested; empty string when absent. */
  listUnsubscribe?: string;
}

export interface FetchFromHeadersResult {
  results: FromHeaderResult[];
  errorCount: number;
  firstError?: string;
  messagesRequested: number;
}

export interface FetchFromHeadersWithMetaResult {
  results: FromHeaderResultWithMeta[];
  errorCount: number;
  firstError?: string;
  messagesRequested: number;
}

/**
 * Sanitize an error into a short `<ErrorName>:<status>` token. Drops the
 * message body (may contain PII, query text, or — on some Gmail proxies —
 * echoed Authorization headers). Keeps only the JS error class name plus
 * any detected HTTP status code (4xx/5xx).
 */
function sanitizeError(err: unknown): string {
  const name = err instanceof Error ? err.name : "Error";
  const status = err instanceof Error ? (err.message.match(/\b[45]\d\d\b/)?.[0] ?? "") : "";
  return status ? `${name}:${status}` : name;
}

export async function fetchFromHeaders(
  client: GmailClientLike,
  query: string,
  limit: number = ONBOARDING_TUNABLES.stage1.maxMessages,
): Promise<FetchFromHeadersResult> {
  const ids = await client.listMessageIds(query, limit);

  if (ids.length === 0) {
    return { results: [], errorCount: 0, messagesRequested: 0 };
  }

  const batchSize = ONBOARDING_TUNABLES.stage1.fetchBatchSize;
  const pacingMs = ONBOARDING_TUNABLES.stage1.pacingMs;

  const results: FromHeaderResult[] = [];
  let errorCount = 0;
  let firstError: string | undefined;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (id): Promise<FromHeaderResult | null> => {
        try {
          const msg = await client.getMessageMetadata(id, ["From"]);
          const fromHeader =
            msg.payload.headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
          return { messageId: id, fromHeader };
        } catch (err) {
          errorCount++;
          if (!firstError) firstError = sanitizeError(err);
          return null;
        }
      }),
    );

    for (const entry of batchResults) {
      if (entry !== null) results.push(entry);
    }

    const isLastBatch = i + batchSize >= ids.length;
    if (!isLastBatch && pacingMs > 0) {
      await new Promise((r) => setTimeout(r, pacingMs));
    }
  }

  const messagesRequested = ids.length;

  if (errorCount > 0) {
    const errorRate = errorCount / messagesRequested;
    const level: "warn" | "error" = errorRate > 0.1 ? "error" : "warn";
    logger[level]({
      service: "gmail-metadata-fetch",
      operation: "fetchFromHeaders",
      errorCount,
      messagesRequested,
      errorRate,
      firstError,
    });
  }

  return {
    results,
    errorCount,
    firstError,
    messagesRequested,
  };
}

/**
 * Stage 1 variant that also captures `List-Unsubscribe` headers so the
 * scorer can apply the master-plan §4 compounding-signal veto on
 * newsletter-dominant domains. Same batching / pacing / sanitized-error
 * model as `fetchFromHeaders`; the only difference is the header set.
 */
export async function fetchFromHeadersWithUnsubscribe(
  client: GmailClientLike,
  query: string,
  limit: number = ONBOARDING_TUNABLES.stage1.maxMessages,
): Promise<FetchFromHeadersWithMetaResult> {
  const ids = await client.listMessageIds(query, limit);

  if (ids.length === 0) {
    return { results: [], errorCount: 0, messagesRequested: 0 };
  }

  const batchSize = ONBOARDING_TUNABLES.stage1.fetchBatchSize;
  const pacingMs = ONBOARDING_TUNABLES.stage1.pacingMs;

  const results: FromHeaderResultWithMeta[] = [];
  let errorCount = 0;
  let firstError: string | undefined;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (id): Promise<FromHeaderResultWithMeta | null> => {
        try {
          const msg = await client.getMessageMetadata(id, ["From", "List-Unsubscribe"]);
          const headers = msg.payload.headers;
          const fromHeader = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
          const listUnsubscribe =
            headers.find((h) => h.name.toLowerCase() === "list-unsubscribe")?.value ?? "";
          return { messageId: id, fromHeader, listUnsubscribe };
        } catch (err) {
          errorCount++;
          if (!firstError) firstError = sanitizeError(err);
          return null;
        }
      }),
    );

    for (const entry of batchResults) {
      if (entry !== null) results.push(entry);
    }

    const isLastBatch = i + batchSize >= ids.length;
    if (!isLastBatch && pacingMs > 0) {
      await new Promise((r) => setTimeout(r, pacingMs));
    }
  }

  const messagesRequested = ids.length;

  if (errorCount > 0) {
    const errorRate = errorCount / messagesRequested;
    const level: "warn" | "error" = errorRate > 0.1 ? "error" : "warn";
    logger[level]({
      service: "gmail-metadata-fetch",
      operation: "fetchFromHeadersWithUnsubscribe",
      errorCount,
      messagesRequested,
      errorRate,
      firstError,
    });
  }

  return {
    results,
    errorCount,
    firstError,
    messagesRequested,
  };
}
