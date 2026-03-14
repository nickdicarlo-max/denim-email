/**
 * Discovery — runs schema discovery queries against Gmail with safety limits.
 *
 * Two hard limits enforced:
 * 1. Time window: only emails from the last 8 weeks (newer_than:8w)
 * 2. Total cap: never more than MAX_DISCOVERY_EMAILS total (default 200)
 *
 * Queries are run in order; once the cap is hit, remaining queries are skipped.
 */

import { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";

const MAX_DISCOVERY_EMAILS = 200;
const DISCOVERY_LOOKBACK = "56d";

interface DiscoveryQuery {
  query: string;
  label: string;
}

interface DiscoveryResult {
  emailIds: string[];
  queriesRun: number;
  queriesSkipped: number;
  cappedAt: number;
}

/**
 * Run discovery queries against Gmail and return deduplicated message IDs.
 * Appends `newer_than:8w` to every query and stops once 200 total IDs are collected.
 */
export async function runDiscoveryQueries(
  gmailClient: GmailClient,
  queries: DiscoveryQuery[],
  options?: { maxEmails?: number; lookback?: string },
): Promise<DiscoveryResult> {
  const maxEmails = options?.maxEmails ?? MAX_DISCOVERY_EMAILS;
  const lookback = options?.lookback ?? DISCOVERY_LOOKBACK;
  const allMessageIds = new Set<string>();
  let queriesRun = 0;
  let queriesSkipped = 0;

  for (const { query } of queries) {
    if (allMessageIds.size >= maxEmails) {
      queriesSkipped++;
      continue;
    }

    // Remaining capacity for this query
    const remaining = maxEmails - allMessageIds.size;

    // Append time window to every query
    const scopedQuery = `${query} newer_than:${lookback}`;

    const messages = await gmailClient.searchEmails(scopedQuery, remaining);
    for (const msg of messages) {
      allMessageIds.add(msg.id);
      if (allMessageIds.size >= maxEmails) break;
    }
    queriesRun++;
  }

  const emailIds = Array.from(allMessageIds);

  logger.info({
    service: "discovery",
    operation: "runDiscoveryQueries",
    totalQueries: queries.length,
    queriesRun,
    queriesSkipped,
    emailCount: emailIds.length,
    maxEmails,
    lookback,
  });

  return { emailIds, queriesRun, queriesSkipped, cappedAt: maxEmails };
}
