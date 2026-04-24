/**
 * Stage 1 compounding-signal scorer.
 *
 * Replaces the single-signal inclusion of the old shape-keyword OR-search
 * aggregation with a multi-signal model grounded in master-plan §7
 * principles #4 (compounding-context inclusion), #5 (validation feedback
 * loop), and #7 (grouping & compound signals).
 *
 * A domain becomes a candidate only when multiple signals align. Positive
 * signals come from user-entered hints (WHATs), user-entered contacts
 * (WHOs), and paired-WHO → WHAT triangulation (#117). Negative signals —
 * public providers, platform denylist, the user's own domain, dominant
 * List-Unsubscribe — force a candidate to score −∞ regardless of how many
 * positive signals it collected.
 *
 * This is a pure function. No Gmail, no DB, no AI, no `Date.now()`, no
 * env. Inputs are structured; outputs are deterministic.
 */

import { isPlatformDomain } from "./platform-denylist";
import { isPublicProvider } from "./public-providers";

/** Shape of a user-entered WHO's search result. Mirrors `UserContactResult`
 *  in `apps/web/src/lib/discovery/user-hints-discovery.ts` — kept separate
 *  here because `@denim/engine` may not depend on the web app. */
export interface ScoringWhoResult {
  /** The literal name the user typed (e.g., "Ziad Allan"). */
  query: string;
  /** Most-frequent sender email for matches; null when no matches. */
  senderEmail: string | null;
  /** Domain derived from `senderEmail`; null when no matches. */
  senderDomain: string | null;
  /** Number of messages that matched `from:"<name>"`. */
  matchCount: number;
}

/** Shape of a user-entered WHAT's search result. Mirrors `UserThingResult`. */
export interface ScoringWhatResult {
  /** The literal string the user typed (e.g., "soccer"). */
  query: string;
  /** Most-frequent sender domain on matching emails; null when no matches. */
  topDomain: string | null;
  /** Message count. */
  matchCount: number;
  /** #117 paired-WHO attribution — the WHO whose `from:` result supplied
   *  this `topDomain`. Unset for unpaired WHATs or when no paired WHO had
   *  matches. */
  sourcedFromWho?: string;
}

export interface ScoringEntityGroup {
  whats: string[];
  whos: string[];
}

export interface ScoreDomainCandidatesInput {
  whoResults: ReadonlyArray<ScoringWhoResult>;
  whatResults: ReadonlyArray<ScoringWhatResult>;
  groups: ReadonlyArray<ScoringEntityGroup>;
  /** The user's own email domain — never a candidate. */
  userDomain: string;
  /** Platform denylist. Defaults to PLATFORM_DENYLIST constant. */
  platformDenylist?: ReadonlySet<string>;
  /**
   * Optional per-domain List-Unsubscribe dominance ratio (0..1). A ratio
   * above `UNSUBSCRIBE_VETO_THRESHOLD` vetoes the domain. Supplied by the
   * service layer when `List-Unsubscribe` headers were collected during
   * hint search; omitted otherwise.
   */
  unsubscribeRatios?: ReadonlyMap<string, number>;
}

export type CandidateSignal =
  | "paired_who"
  | "solo_who"
  | "what_top_domain"
  | "extra_hint_hit"
  | "public_provider"
  | "platform_denylist"
  | "unsubscribe_dominant"
  | "user_domain";

export interface ScoredDomainCandidate {
  domain: string;
  score: number;
  signals: CandidateSignal[];
  /** Present when a paired-WHO search sourced this candidate. */
  pairedWho?: string;
  /** User hints (WHAT queries + paired WHATs) that converged on this domain. */
  hintsMatched: string[];
}

/** A domain must have at least this score to surface as a Stage 1 candidate.
 *  Principle #4: no single signal is sufficient. Threshold=3 enforces that:
 *    - `paired_who` (+3) passes on its own — but it ALREADY encodes two user
 *      choices (typing the WHO AND grouping it with a WHAT).
 *    - A lone `what_top_domain` (+2) does NOT pass — a single WHAT hit
 *      against a broad marketing domain (e.g. "dance" → shopping.samsung.com
 *      scoring 13 promotional subjects) would otherwise sneak through.
 *    - A lone `solo_who` (+1) does NOT pass.
 *    - WHAT + paired-WHO convergence (+3), WHAT + WHAT convergence (+3),
 *      WHAT + solo-WHO (+3) all pass. */
export const MIN_SCORE_THRESHOLD = 3;

/** List-Unsubscribe ratio above this value vetoes the domain. Tuned so that
 *  a domain where the majority of hint-matched messages carry an unsubscribe
 *  header is treated as a newsletter source even when it also happens to
 *  host human correspondence. */
export const UNSUBSCRIBE_VETO_THRESHOLD = 0.5;

export function scoreDomainCandidates(input: ScoreDomainCandidatesInput): ScoredDomainCandidate[] {
  const userDomainLower = input.userDomain.toLowerCase();
  const denylist = input.platformDenylist;
  const ratios = input.unsubscribeRatios ?? new Map<string, number>();

  // who-name → set of paired WHATs
  const whoPairings = new Map<string, Set<string>>();
  for (const g of input.groups) {
    for (const who of g.whos) {
      const set = whoPairings.get(who) ?? new Set<string>();
      for (const what of g.whats) set.add(what);
      whoPairings.set(who, set);
    }
  }

  type Accum = {
    domain: string;
    score: number;
    signals: CandidateSignal[];
    pairedWho?: string;
    hintsMatched: Set<string>;
    vetoed: boolean;
  };
  const byDomain = new Map<string, Accum>();

  const ensure = (domain: string): Accum => {
    const key = domain.toLowerCase();
    let acc = byDomain.get(key);
    if (!acc) {
      acc = {
        domain: key,
        score: 0,
        signals: [],
        hintsMatched: new Set<string>(),
        vetoed: false,
      };
      byDomain.set(key, acc);
    }
    return acc;
  };

  // WHO contributions: paired WHO +3, solo (unpaired but user-typed) WHO +1.
  for (const who of input.whoResults) {
    if (!who.senderDomain || who.matchCount <= 0) continue;
    const acc = ensure(who.senderDomain);
    const pairedWhats = whoPairings.get(who.query);
    if (pairedWhats && pairedWhats.size > 0) {
      acc.score += 3;
      acc.signals.push("paired_who");
      acc.pairedWho = who.query;
      for (const w of pairedWhats) acc.hintsMatched.add(w);
    } else {
      acc.score += 1;
      acc.signals.push("solo_who");
    }
  }

  // WHAT contributions: topDomain +2 (first hit) or +1 (additional).
  for (const what of input.whatResults) {
    if (!what.topDomain || what.matchCount <= 0) continue;
    const acc = ensure(what.topDomain);
    // If this WHAT is already credited via paired-WHO path, the +3 already
    // covered it — skip re-crediting.
    if (acc.hintsMatched.has(what.query)) continue;
    acc.hintsMatched.add(what.query);
    if (acc.signals.some((s) => s === "paired_who" || s === "what_top_domain")) {
      acc.score += 1;
      acc.signals.push("extra_hint_hit");
    } else {
      acc.score += 2;
      acc.signals.push("what_top_domain");
    }
  }

  // Apply vetoes.
  for (const acc of byDomain.values()) {
    if (acc.domain === userDomainLower) {
      acc.vetoed = true;
      acc.signals.push("user_domain");
    }
    if (isPublicProvider(acc.domain)) {
      acc.vetoed = true;
      acc.signals.push("public_provider");
    }
    if (denylist ? denylist.has(acc.domain) : isPlatformDomain(acc.domain)) {
      acc.vetoed = true;
      acc.signals.push("platform_denylist");
    }
    const ratio = ratios.get(acc.domain) ?? 0;
    if (ratio > UNSUBSCRIBE_VETO_THRESHOLD) {
      acc.vetoed = true;
      acc.signals.push("unsubscribe_dominant");
    }
  }

  const result: ScoredDomainCandidate[] = [];
  for (const acc of byDomain.values()) {
    if (acc.vetoed) continue;
    if (acc.score < MIN_SCORE_THRESHOLD) continue;
    const candidate: ScoredDomainCandidate = {
      domain: acc.domain,
      score: acc.score,
      signals: acc.signals,
      hintsMatched: Array.from(acc.hintsMatched),
    };
    if (acc.pairedWho) candidate.pairedWho = acc.pairedWho;
    result.push(candidate);
  }

  result.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
  return result;
}
