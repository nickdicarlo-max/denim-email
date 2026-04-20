/**
 * Find-or-tell-them discovery for user-entered whats + whos (#112).
 *
 * Stage 1's keyword-domain pass (`discoverDomains`) surfaces high-volume
 * sender domains for ideation, but silently drops user-named entities that
 * don't organically crack the top-N. These two helpers guarantee that every
 * user-entered what/who either surfaces with an explicit hit on the review
 * screen or shows as "not found in the last 8 weeks" — no silent drops.
 *
 * Both run in parallel with `discoverDomains` from `runDomainDiscovery`, so
 * total Stage 1 wall time stays dominated by the slowest single Gmail
 * search. Each primitive is I/O-impure (wraps GmailClient) but stays free
 * of DB writes — persistence happens in the Inngest step via
 * `writeStage1Result`.
 */

import type { EntityGroupInput } from "@denim/types";
import type { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";
import { fetchFromHeaders, type FromHeaderResult } from "./gmail-metadata-fetch";
import { isPublicProvider } from "./public-providers";

/** Max Gmail matches fetched per user-named query. Small cap — we only need
 *  enough to pick a top sender + show a representative count. */
const MAX_PER_HINT = 50;

/** Lookback window for user-named search. Matches Nick's product contract:
 *  "find it or tell me we looked in the last 8 weeks and didn't find it." */
const USER_HINT_LOOKBACK_DAYS = 56;

export interface UserThingResult {
  /** The literal string the user typed, unchanged. */
  query: string;
  /** How many emails matched. 0 means the user-facing "no results" state. */
  matchCount: number;
  /** Most common sender domain among matches; `null` when no matches. */
  topDomain: string | null;
  /** Top sender display names (max 3) on matching emails, for context. */
  topSenders: ReadonlyArray<string>;
  /** Per-query Gmail error count (non-fatal). Same shape as `fetchFromHeaders`. */
  errorCount: number;
  /**
   * #117: name of the paired WHO whose `from:` result supplied `topDomain`
   * and `matchCount` for this entry. Absent when the WHAT was not paired or
   * fell through to the full-text search (e.g. every paired WHO had zero
   * matches).
   */
  sourcedFromWho?: string;
}

export interface UserContactResult {
  /** The literal name the user typed (e.g., "Farrukh Malik"). */
  query: string;
  /** How many emails matched the `from:"<name>"` search. */
  matchCount: number;
  /** The sender email address most frequently seen on matches; `null` when 0. */
  senderEmail: string | null;
  /** Domain derived from `senderEmail`; `null` when 0. */
  senderDomain: string | null;
  /** Per-query Gmail error count (non-fatal). */
  errorCount: number;
}

function parseFromHeader(from: string): { email: string; displayName: string } {
  const angle = from.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angle) {
    const rawName = angle[1].trim().replace(/^"|"$/g, "");
    return { email: angle[2].toLowerCase(), displayName: rawName };
  }
  return { email: from.trim().toLowerCase(), displayName: "" };
}

function extractDomain(email: string): string {
  const at = email.indexOf("@");
  return at < 0 ? "" : email.slice(at + 1).toLowerCase();
}

function buildThingQuery(what: string): string {
  // Full-text Gmail search. Quote the user's phrase so multi-word things
  // (e.g. "Portfolio Pro Advisors") match as a unit. Exclude promotions
  // to keep newsletters out of the match count.
  const quoted = what.replace(/"/g, '\\"');
  return `"${quoted}" -category:promotions newer_than:${USER_HINT_LOOKBACK_DAYS}d`;
}

function buildContactQuery(who: string): string {
  // Gmail's `from:` operator accepts quoted display names. This matches
  // emails whose From header's display name contains the typed name,
  // case-insensitive. More precise than full-text which would hit mentions.
  const quoted = who.replace(/"/g, '\\"');
  return `from:"${quoted}" newer_than:${USER_HINT_LOOKBACK_DAYS}d`;
}

/**
 * #117 safety filter — drop obvious marketing/newsletter subdomains and
 * cross-domain `.edu` noise from the full-text path. Paired WHATs no
 * longer depend on this path (their topDomain comes from the WHO's
 * `from:` result), so this is residual hygiene for unpaired WHATs.
 *
 * Keeps `email.*` / `mail.*` intact — activity platforms like TeamSnap
 * use them (`email.teamsnap.com`).
 */
function isNoiseDomain(domain: string, userDomain: string): boolean {
  if (domain.startsWith("news.")) return true;
  if (domain.startsWith("alerts.")) return true;
  if (domain.startsWith("t.")) return true;
  // Cross-domain .edu filter — skip unless the user is themselves on .edu.
  if (domain.endsWith(".edu") && !userDomain.endsWith(".edu")) return true;
  return false;
}

function aggregateThingResult(
  query: string,
  rows: ReadonlyArray<FromHeaderResult>,
  errorCount: number,
  userDomain: string,
): UserThingResult {
  const domainCounts = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    const { email, displayName } = parseFromHeader(row.fromHeader);
    const domain = extractDomain(email);
    if (!domain) continue;
    if (isPublicProvider(domain)) continue;
    if (domain === userDomain) continue;
    if (isNoiseDomain(domain, userDomain)) continue;
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    if (displayName) {
      nameCounts.set(displayName, (nameCounts.get(displayName) ?? 0) + 1);
    }
  }
  const topDomain =
    [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topSenders = [...nameCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  return {
    query,
    matchCount: rows.length,
    topDomain,
    topSenders,
    errorCount,
  };
}

function aggregateContactResult(
  query: string,
  rows: ReadonlyArray<FromHeaderResult>,
  errorCount: number,
): UserContactResult {
  const emailCounts = new Map<string, number>();
  for (const row of rows) {
    const { email } = parseFromHeader(row.fromHeader);
    if (!email || !email.includes("@")) continue;
    emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }
  const top = [...emailCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    query,
    matchCount: rows.length,
    senderEmail: top,
    senderDomain: top ? extractDomain(top) : null,
    errorCount,
  };
}

/**
 * #117: pick the paired WHO (if any) whose `from:` result should drive this
 * WHAT's topDomain. Returns `null` when the WHAT is unpaired OR every paired
 * WHO returned zero matches (caller falls back to the full-text aggregate).
 */
function chooseSourcedWho(
  what: string,
  groups: ReadonlyArray<EntityGroupInput>,
  whoResults: ReadonlyArray<UserContactResult>,
): UserContactResult | null {
  // Collect every paired WHO across all groups that contain this WHAT.
  const pairedWhoNames = new Set<string>();
  for (const group of groups) {
    if (group.whats.includes(what)) {
      for (const who of group.whos) pairedWhoNames.add(who);
    }
  }
  if (pairedWhoNames.size === 0) return null;

  const candidates = whoResults.filter((w) => pairedWhoNames.has(w.query));
  if (candidates.length === 0) return null;

  // Highest matchCount wins; ties break by first-seen (Array.reduce).
  const best = candidates.reduce(
    (acc, cur) => (cur.matchCount > acc.matchCount ? cur : acc),
    candidates[0],
  );
  return best.matchCount > 0 ? best : null;
}

export async function discoverUserNamedThings(
  client: GmailClient,
  whats: ReadonlyArray<string>,
  userDomain: string,
  options?: {
    /** Paired WHO results from `discoverUserNamedContacts`. Used to attribute
     *  `topDomain`/`matchCount` for WHATs that appear in `groups`. */
    whoResults: ReadonlyArray<UserContactResult>;
    /** Paired groups from the interview input. Empty = today's behavior. */
    groups: ReadonlyArray<EntityGroupInput>;
  },
): Promise<UserThingResult[]> {
  if (whats.length === 0) return [];
  const groups = options?.groups ?? [];
  const whoResults = options?.whoResults ?? [];
  const results = await Promise.all(
    whats.map(async (what) => {
      const query = buildThingQuery(what);
      let fullTextResult: UserThingResult;
      try {
        const fetched = await fetchFromHeaders(client, query, MAX_PER_HINT);
        fullTextResult = aggregateThingResult(
          what,
          fetched.results,
          fetched.errorCount,
          userDomain,
        );
      } catch (err) {
        // One failed hint should not kill the entire Stage 1 pass. Log + mark
        // as 0-match so the UI surfaces "no results" rather than omitting.
        logger.warn({
          service: "discovery",
          operation: "discoverUserNamedThings.failed",
          query: what,
          error: err instanceof Error ? err.message : String(err),
        });
        fullTextResult = {
          query: what,
          matchCount: 0,
          topDomain: null,
          topSenders: [],
          errorCount: 1,
        };
      }

      // #117: if this WHAT is paired and the paired WHO has real matches,
      // override topDomain/matchCount from the WHO's result. Fall back to
      // the full-text aggregate (safety-filtered) when no paired WHO has
      // matches — keeps today's "find it or tell me" contract intact.
      const sourced = chooseSourcedWho(what, groups, whoResults);
      if (sourced && sourced.senderDomain) {
        return {
          query: what,
          matchCount: sourced.matchCount,
          topDomain: sourced.senderDomain,
          topSenders: fullTextResult.topSenders,
          errorCount: fullTextResult.errorCount,
          sourcedFromWho: sourced.query,
        };
      }
      return fullTextResult;
    }),
  );
  return results;
}

export async function discoverUserNamedContacts(
  client: GmailClient,
  whos: ReadonlyArray<string>,
): Promise<UserContactResult[]> {
  if (whos.length === 0) return [];
  const results = await Promise.all(
    whos.map(async (who) => {
      const query = buildContactQuery(who);
      try {
        const fetched = await fetchFromHeaders(client, query, MAX_PER_HINT);
        return aggregateContactResult(who, fetched.results, fetched.errorCount);
      } catch (err) {
        logger.warn({
          service: "discovery",
          operation: "discoverUserNamedContacts.failed",
          query: who,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          query: who,
          matchCount: 0,
          senderEmail: null,
          senderDomain: null,
          errorCount: 1,
        };
      }
    }),
  );
  return results;
}

export { USER_HINT_LOOKBACK_DAYS, MAX_PER_HINT };
