/**
 * Stage 2 post-Gemini candidate scorer (2026-04-23, Phase 2 Part C).
 *
 * Scores each entity candidate Gemini returned, applying master-plan §7
 * principles on top of Gemini's output:
 *   - +3 name token-matches a user hint (WHAT)
 *   - +2 came from a confirmed-WHO senderEmail
 *   - +1 appears in multiple subjects (frequency ≥ 2)
 *   - −∞ fails per-domain §5 alias-prohibition rules (spec-validators)
 *
 * Threshold defaults to `MIN_ENTITY_SCORE_THRESHOLD = 2` — a single
 * positive signal alone is insufficient, matching the Stage 1 scorer's
 * principle-#4 enforcement. User confirmation at the review screen can
 * override (the service layer handles that).
 *
 * Pure function. No I/O, no env, no AI.
 */

import {
  type SchemaDomainName,
  type SpecViolationCode,
  validateEntityAgainstSpec,
} from "./spec-validators";

export interface ScoringEntityCandidate {
  key: string;
  displayString: string;
  /** Gemini's approximate_count (subjects referring to this entity). */
  frequency: number;
  /** Optional meta carrying paired-WHO / kind / pattern info. */
  meta?: Record<string, unknown>;
}

export type EntitySignal =
  | "hint_token_match"
  | "confirmed_who_sender"
  | "multiple_subjects"
  | "spec_violation"
  | "short_circuit_primary"
  | "agency_domain_derive";

export interface ScoreEntityCandidatesInput {
  candidates: ReadonlyArray<ScoringEntityCandidate>;
  schemaDomain: SchemaDomainName;
  /** Names of user-entered WHATs for this schema — any non-zero token overlap
   *  between a candidate's name and one of these earns +3. */
  userWhats: ReadonlyArray<string>;
  /** Email addresses of confirmed WHOs — a candidate whose `key` or meta
   *  identifies one of these senders earns +2. */
  confirmedWhoEmails: ReadonlyArray<string>;
  /** Algorithm that produced the candidates. When `pair-short-circuit` or
   *  `agency-domain-derive` the candidate was emitted by a deterministic
   *  path and is always retained (score forced above threshold). */
  sourceAlgorithm?: string;
}

export interface ScoredEntityCandidate extends ScoringEntityCandidate {
  score: number;
  signals: EntitySignal[];
  specViolation?: SpecViolationCode;
}

export const MIN_ENTITY_SCORE_THRESHOLD = 2;

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2), // drop 1-char tokens (noise)
  );
}

function anyTokenOverlap(a: string, bs: ReadonlyArray<string>): boolean {
  const aSet = tokenSet(a);
  if (aSet.size === 0) return false;
  for (const b of bs) {
    const bSet = tokenSet(b);
    for (const t of bSet) {
      if (aSet.has(t)) return true;
    }
  }
  return false;
}

function extractSenderEmail(c: ScoringEntityCandidate): string | null {
  // Convention: SECONDARY candidates seeded from user contacts use key
  // `@sender@domain.com` (see stage2-fanout.ts:buildStage2Context).
  if (c.key.startsWith("@")) return c.key.slice(1).toLowerCase();
  // Some metadata paths carry senderEmail directly.
  const meta = c.meta ?? {};
  const m = meta.senderEmail;
  return typeof m === "string" ? m.toLowerCase() : null;
}

/**
 * Score every candidate. Returns the full array (no filtering) plus each
 * candidate's score, signals, and any spec violation. Callers filter by
 * `score >= MIN_ENTITY_SCORE_THRESHOLD` OR user confirmation per their
 * own policy.
 */
export function scoreEntityCandidates(input: ScoreEntityCandidatesInput): ScoredEntityCandidate[] {
  const whoEmailSet = new Set(input.confirmedWhoEmails.map((e) => e.toLowerCase()));
  const isDeterministicSource =
    input.sourceAlgorithm === "pair-short-circuit" ||
    input.sourceAlgorithm === "agency-domain-derive";

  return input.candidates.map((c) => {
    const signals: EntitySignal[] = [];
    let score = 0;

    // Deterministic sources (short-circuit, agency-domain-derive) bypass
    // scoring — they were emitted by a trusted path and represent the
    // user's typed PRIMARY. Mark with a single synthetic signal.
    if (isDeterministicSource) {
      signals.push(
        input.sourceAlgorithm === "pair-short-circuit"
          ? "short_circuit_primary"
          : "agency_domain_derive",
      );
      score = MIN_ENTITY_SCORE_THRESHOLD + 1;
    } else {
      if (anyTokenOverlap(c.displayString, input.userWhats)) {
        signals.push("hint_token_match");
        score += 3;
      }
      const senderEmail = extractSenderEmail(c);
      if (senderEmail && whoEmailSet.has(senderEmail)) {
        signals.push("confirmed_who_sender");
        score += 2;
      }
      if (c.frequency >= 2) {
        signals.push("multiple_subjects");
        score += 1;
      }
    }

    // Spec-§5 alias-prohibition gate applies to EVERY candidate — even
    // short-circuit / domain-derive candidates must pass (they won't in
    // practice because the user's typed label is always legit, but we
    // enforce defensively).
    const validation = validateEntityAgainstSpec({
      name: c.displayString,
      schemaDomain: input.schemaDomain,
    });
    if (!validation.valid) {
      signals.push("spec_violation");
      score = Number.NEGATIVE_INFINITY;
      return {
        ...c,
        score,
        signals,
        specViolation: validation.violationCode,
      };
    }

    return { ...c, score, signals };
  });
}
