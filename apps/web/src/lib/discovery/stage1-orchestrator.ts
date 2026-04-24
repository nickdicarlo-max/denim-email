/**
 * Stage 1 — hint-anchored compounding-signal discovery.
 *
 * Replaces the pre-2026-04-23 `discoverDomains` shape-keyword OR-search,
 * which surfaced candidates on a single signal (one subject-keyword hit
 * was sufficient) and repeatedly violated master plan §7 principle #4.
 *
 * The new flow runs WHO-seeded + WHAT-seeded Gmail searches (hint-specific,
 * scoped to the user's typed input) and produces a compounding-signal-scored
 * list of candidate domains. A domain is only a candidate when multiple
 * signals align — paired-WHO → senderDomain (+3), WHAT topDomain (+2),
 * additional hint convergence (+1) — and is vetoed by public-provider,
 * platform denylist, or the user's own domain.
 *
 * Principle #5 (validation feedback loop) is realised by the scorer: the
 * user's typed WHOs validate which PRIMARY domains matter; the user's typed
 * WHATs validate which domain content those WHOs send is about. Principle #6
 * (no AI in the hot path) is preserved — the scorer is pure string-math in
 * `@denim/engine`.
 *
 * Zero-match contract (#112 "find it or tell me") preserved: a hint that
 * returns zero emails still surfaces on the review screen as
 * `matchCount: 0`. The scorer just doesn't credit it.
 */

import {
  type ScoredDomainCandidate,
  type ScoringWhatResult,
  type ScoringWhoResult,
  scoreDomainCandidates,
} from "@denim/engine";
import type { EntityGroupInput } from "@denim/types";
import type { GmailClientLike } from "@/lib/gmail/types";
import {
  discoverUserNamedContacts,
  discoverUserNamedThings,
  type UserContactResult,
  type UserThingResult,
} from "./user-hints-discovery";

export interface DiscoverStage1CandidatesInput {
  gmailClient: GmailClientLike;
  userDomain: string;
  whats: ReadonlyArray<string>;
  whos: ReadonlyArray<string>;
  groups: ReadonlyArray<EntityGroupInput>;
}

export interface DiscoverStage1CandidatesOutput {
  candidates: ScoredDomainCandidate[];
  userThings: UserThingResult[];
  userContacts: UserContactResult[];
  /** Total Gmail messages inspected across all hint queries. */
  messagesSeen: number;
  /** Total per-message fetch errors across all hint queries. */
  errorCount: number;
}

/**
 * Run the WHO + WHAT hint queries in parallel (pairing-aware so paired WHATs
 * attribute their topDomain from their paired WHO's `from:` result per #117),
 * then score domain candidates with compounding signals.
 */
export async function discoverStage1Candidates(
  input: DiscoverStage1CandidatesInput,
): Promise<DiscoverStage1CandidatesOutput> {
  const { gmailClient, userDomain, whats, whos, groups } = input;

  // Run WHO pass first so paired WHATs can attribute topDomain from the
  // corresponding WHO's senderDomain (#117). If `whos` is empty, this
  // resolves to `[]` immediately.
  const userContacts = await discoverUserNamedContacts(gmailClient, whos);
  const userThings = await discoverUserNamedThings(gmailClient, whats, userDomain, {
    whoResults: userContacts,
    groups: [...groups],
  });

  const scoringWhos: ScoringWhoResult[] = userContacts.map((c) => ({
    query: c.query,
    senderEmail: c.senderEmail,
    senderDomain: c.senderDomain,
    matchCount: c.matchCount,
  }));

  const scoringWhats: ScoringWhatResult[] = userThings.map((t) => ({
    query: t.query,
    topDomain: t.topDomain,
    matchCount: t.matchCount,
    ...(t.sourcedFromWho ? { sourcedFromWho: t.sourcedFromWho } : {}),
  }));

  const candidates = scoreDomainCandidates({
    whoResults: scoringWhos,
    whatResults: scoringWhats,
    groups: groups.map((g) => ({ whats: [...g.whats], whos: [...g.whos] })),
    userDomain,
  });

  const messagesSeen =
    userThings.reduce((s, t) => s + t.matchCount, 0) +
    userContacts.reduce((s, c) => s + c.matchCount, 0);
  const errorCount =
    userThings.reduce((s, t) => s + t.errorCount, 0) +
    userContacts.reduce((s, c) => s + c.errorCount, 0);

  return { candidates, userThings, userContacts, messagesSeen, errorCount };
}
