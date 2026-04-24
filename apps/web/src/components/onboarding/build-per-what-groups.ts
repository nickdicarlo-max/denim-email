/**
 * Build per-WHAT sections for the Stage 2 confirm screen (Phase 5 Part D).
 *
 * Pure helper — zero React, zero DB, zero AI. Given the polling response's
 * `inputs`, `stage1UserThings`, `stage1UserContacts`,
 * `stage1ConfirmedUserContactQueries`, and `stage2Candidates`, returns
 * `{ whatSections, fallbackDomainGroups? }` for the UI to render. Every
 * WHAT section carries a `provenance` flag — "user_input" (user typed it
 * on Q3) or "discovered" (Denim surfaced it as an adjacent PRIMARY). Both
 * render with the same visual weight; the badge in the section header
 * tells the user which is which.
 *
 * Layout target (per plan Part D):
 *
 *   ▾ Soccer                              [from your input]
 *       ✓ Ziad Allan                      · 13 emails · email.teamsnap.com
 *       ✓ Soccer                          · 13 emails · short-circuit (paired)
 *         Aliases found: ZSA U11/12 Girls, Rise ECNL, Houston Select
 *
 *   ▾ Lanier                              [from your input]
 *       ✓ Amy DiCarlo                     · 1 email · amy@gmail.com
 *       ⓘ Found 1 email via Amy, no domain anchor yet.
 *
 *   ▾ Guitar                              [from your input]
 *       ⚠ Not found in the last 8 weeks.
 *
 *   ▾ Also noticed                        [Denim found these]
 *       ☐ 205 Freedom Trail               · 7 emails · judgefite.com
 *       ☐ 3305 Cardinal                   · 2 emails · judgefite.com
 *
 * Section states per WHAT (look up the WHAT in `stage1UserThings` + find
 * matching Stage 2 candidates via `meta.relatedWhat`):
 *   - found-and-anchored   → user's WHAT has matches AND at least one
 *                            Stage 2 candidate carries `meta.relatedWhat`
 *                            equal (case-insensitive) to the WHAT. Render
 *                            paired-WHO rows + the anchoring PRIMARY
 *                            candidate + any short-circuit aliases.
 *   - found-but-unanchored → user's WHAT has matches but topDomain is
 *                            vetoed (public provider / denylist) so no
 *                            Stage 2 candidate exists. User can still
 *                            confirm (sender-fallback clustering).
 *   - not-found            → user's WHAT has zero matches. Informational.
 *
 * Fallback: if `inputs.groups` is empty (older schemas in-flight), return
 * `fallbackDomainGroups` derived from `stage2Candidates` per the pre-Phase-5
 * layout. The caller renders the old by-domain component in that case.
 */

import type { InterviewInput } from "@denim/types";
import type {
  Stage1UserContactDTO,
  Stage1UserThingDTO,
  Stage2DomainCandidateDTO,
  Stage2PerDomainDTO,
} from "@/lib/services/onboarding-polling";

export type PerWhatState = "found_anchored" | "found_unanchored" | "not_found";

/** A paired WHO at a confirmed domain, with attribution fields the UI renders. */
export interface PairedWhoRow {
  identityKey: string;
  displayLabel: string;
  matchCount: number;
  senderEmail: string | null;
  senderDomain: string | null;
  /** Whether the Stage 1 review already confirmed this WHO. Pre-tick. */
  preTicked: boolean;
}

/** The PRIMARY anchoring row rendered under a WHAT — either a Stage 2
 *  short-circuit / agency-derive / Gemini candidate OR, in the
 *  unanchored case, a synthetic placeholder the user can still confirm. */
export interface AnchorPrimary {
  identityKey: string;
  displayLabel: string;
  frequency: number;
  origin:
    | "short_circuit"
    | "agency_domain_derive"
    | "gemini"
    | "unanchored_hint"
    | "found_unanchored";
  senderAttribution?: string;
  /** Short-circuit / Gemini may include `aliases` + co-extracted variants
   *  that should render as a muted "Aliases found:" line under this PRIMARY
   *  rather than as peer checkboxes (school_parent.md §8). */
  aliases: string[];
  /** Whether this row is pre-ticked in the UI. Short-circuit + agency
   *  derive are pre-ticked; unanchored hints are un-ticked. */
  preTicked: boolean;
}

export interface WhatSection {
  what: string;
  state: PerWhatState;
  pairedWhos: PairedWhoRow[];
  anchor: AnchorPrimary | null;
  /** When state === "not_found", a copy hint for the UI. */
  notFoundNote?: string;
  /** When state === "found_unanchored", a ⓘ note describing what we saw. */
  unanchoredNote?: string;
  /**
   * Phase 6 Round 1 step 5 — provenance of this section's WHAT.
   *   - "user_input":  user typed it on Q3 (existing behavior).
   *   - "discovered":  Denim surfaced it via Stage 2 as an adjacent PRIMARY
   *                    the user didn't type. Rendered as a first-class
   *                    section (same visual weight as user-typed WHATs),
   *                    distinguished only by the provenance badge in the
   *                    header. Replaces the separate `alsoNoticed` list.
   */
  provenance: "user_input" | "discovered";
  /**
   * For `provenance === "discovered"` sections — the sender domain the
   * discovery came from. Rendered as attribution in the section header.
   */
  discoveredOnDomain?: string;
  /** Stage-2 compounding-signal score; used by the caller to render a small
   *  trust indicator on discovered sections and to pre-tick the anchor
   *  when score ≥ 1 (matches eval gate-sim policy). */
  discoveryScore?: number;
}

export interface PerWhatBuild {
  whatSections: WhatSection[];
  /** Set when `inputs.groups` is empty — the caller should render the
   *  pre-Phase-5 domain-grouped layout from this structure. */
  fallbackDomainGroups?: Stage2PerDomainDTO[];
}

export interface BuildPerWhatInput {
  inputs: InterviewInput | undefined;
  stage1UserThings: ReadonlyArray<Stage1UserThingDTO>;
  stage1UserContacts: ReadonlyArray<Stage1UserContactDTO>;
  stage1ConfirmedUserContactQueries: ReadonlyArray<string>;
  stage2Candidates: ReadonlyArray<Stage2PerDomainDTO>;
}

function lower(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function tokensOf(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

/** True when `candidate.meta.relatedWhat` (case-insensitive) OR the
 *  candidate's display-label tokens cover every token in `what`. */
function candidateMatchesWhat(candidate: Stage2DomainCandidateDTO, what: string): boolean {
  const meta = candidate.meta ?? {};
  const related = typeof meta.relatedWhat === "string" ? meta.relatedWhat : null;
  if (related && lower(related) === lower(what)) return true;
  // Fallback: token-subset match. "3910 Bucknell" → "3910 Bucknell Drive" still
  // groups under the user's typed WHAT via token overlap.
  const whatTokens = tokensOf(what);
  if (whatTokens.size === 0) return false;
  const labelTokens = tokensOf(candidate.displayString);
  for (const t of whatTokens) if (!labelTokens.has(t)) return false;
  return true;
}

function hasRelatedWhat(candidate: Stage2DomainCandidateDTO): boolean {
  const m = candidate.meta ?? {};
  return typeof m.relatedWhat === "string" && m.relatedWhat.length > 0;
}

function isSecondary(candidate: Stage2DomainCandidateDTO): boolean {
  const m = candidate.meta ?? {};
  const kind = typeof m.kind === "string" ? m.kind.toLowerCase() : "";
  if (kind === "secondary") return true;
  // User-named contacts use `@sender@domain` key convention.
  if (candidate.key.startsWith("@")) return true;
  return false;
}

function originFromMeta(candidate: Stage2DomainCandidateDTO): AnchorPrimary["origin"] {
  const m = candidate.meta ?? {};
  const p = typeof m.pattern === "string" ? m.pattern : "";
  if (p === "short-circuit") return "short_circuit";
  if (p === "agency-domain-derive") return "agency_domain_derive";
  return "gemini";
}

function pairedWhosForWhat(
  what: string,
  input: BuildPerWhatInput,
  inputGroups: ReadonlyArray<{ whats: string[]; whos: string[] }>,
): PairedWhoRow[] {
  const whatL = lower(what);
  const whoNames = new Set<string>();
  for (const g of inputGroups) {
    if (g.whats.some((w) => lower(w) === whatL)) {
      for (const name of g.whos) whoNames.add(name);
    }
  }
  if (whoNames.size === 0) return [];
  const confirmed = new Set(input.stage1ConfirmedUserContactQueries);
  const byQuery = new Map<string, Stage1UserContactDTO>();
  for (const c of input.stage1UserContacts) byQuery.set(c.query, c);

  const rows: PairedWhoRow[] = [];
  for (const name of whoNames) {
    const contact = byQuery.get(name);
    if (!contact) continue; // WHO in groups but never surfaced by Stage 1
    rows.push({
      identityKey: contact.senderEmail ? `@${contact.senderEmail.toLowerCase()}` : name,
      displayLabel: name,
      matchCount: contact.matchCount,
      senderEmail: contact.senderEmail,
      senderDomain: contact.senderDomain,
      preTicked: confirmed.has(name),
    });
  }
  return rows;
}

function buildAnchorFromCandidate(
  candidate: Stage2DomainCandidateDTO,
  aliasCandidates: Stage2DomainCandidateDTO[],
): AnchorPrimary {
  const origin = originFromMeta(candidate);
  const m = candidate.meta ?? {};
  const senderAttribution =
    typeof m.authoritativeDomain === "string"
      ? (m.authoritativeDomain as string)
      : typeof m.senderEmail === "string"
        ? (m.senderEmail as string)
        : undefined;
  const baseAliases: string[] =
    Array.isArray(m.aliases) && (m.aliases as unknown[]).every((a) => typeof a === "string")
      ? (m.aliases as string[])
      : [];
  // Fold in sibling Gemini candidates on the same confirmed domain that
  // carry the same relatedWhat — per school_parent.md §8 "team-specific
  // content is case-splitting discriminators, not separate SECONDARIES."
  const folded = aliasCandidates.filter((c) => c.key !== candidate.key).map((c) => c.displayString);
  return {
    identityKey: candidate.key,
    displayLabel: candidate.displayString,
    frequency: candidate.frequency,
    origin,
    senderAttribution,
    aliases: Array.from(new Set([...baseAliases, ...folded])),
    preTicked: origin === "short_circuit" || origin === "agency_domain_derive",
  };
}

export function buildPerWhatGroups(input: BuildPerWhatInput): PerWhatBuild {
  const inputs = input.inputs;
  const allCandidates = input.stage2Candidates.flatMap((block) =>
    block.candidates.map((c) => ({ ...c, confirmedDomain: block.confirmedDomain })),
  );

  // Fallback when we have no user-typed WHATs or groups — the by-WHAT
  // layout can't meaningfully render, so hand back the by-domain data.
  const hasWhats = (inputs?.whats?.length ?? 0) > 0;
  const hasGroups = (inputs?.groups?.length ?? 0) > 0;
  if (!hasWhats && !hasGroups) {
    return {
      whatSections: [],
      fallbackDomainGroups: [...input.stage2Candidates],
    };
  }

  const whats: string[] = inputs?.whats ?? [];
  const groups = inputs?.groups ?? [];
  const userThingsByQuery = new Map<string, Stage1UserThingDTO>();
  for (const t of input.stage1UserThings) userThingsByQuery.set(lower(t.query), t);

  const consumedKeys = new Set<string>();
  const whatSections: WhatSection[] = [];

  for (const what of whats) {
    const thing = userThingsByQuery.get(lower(what));
    const pairedWhos = pairedWhosForWhat(what, input, groups);
    const matchingPrimaries = allCandidates.filter(
      (c) =>
        !isSecondary(c) &&
        (candidateMatchesWhat(c, what) ||
          // `agency-domain-derive` + `short-circuit` set meta.relatedWhat
          // to the WHAT; Gemini may too. Prefer explicit match before
          // falling through to token overlap.
          (hasRelatedWhat(c) &&
            lower((c.meta as Record<string, unknown>).relatedWhat as string) === lower(what))),
    );
    // Prefer deterministic origins (short-circuit / agency-domain-derive)
    // as the anchor; Gemini candidates without relatedWhat fall into
    // alsoNoticed. Any remaining hint-matched Gemini candidates fold in
    // as aliases under the primary.
    const deterministic = matchingPrimaries.filter((c) => {
      const p = (c.meta as Record<string, unknown> | undefined)?.pattern;
      return p === "short-circuit" || p === "agency-domain-derive";
    });
    const geminiMatches = matchingPrimaries.filter((c) => {
      const p = (c.meta as Record<string, unknown> | undefined)?.pattern;
      return p !== "short-circuit" && p !== "agency-domain-derive";
    });

    let anchor: AnchorPrimary | null = null;
    let state: PerWhatState;

    if (deterministic.length > 0) {
      const primary = deterministic[0];
      // Aliases fold everything except the primary itself — deterministic
      // siblings (rare) plus any hint-matched Gemini candidates.
      const aliasPool = [...deterministic.slice(1), ...geminiMatches];
      anchor = buildAnchorFromCandidate(primary, aliasPool);
      for (const c of deterministic) consumedKeys.add(c.key);
      for (const c of geminiMatches) consumedKeys.add(c.key);
      state = "found_anchored";
    } else if (geminiMatches.length > 0) {
      // No deterministic path — Gemini found hint-matching candidates.
      // Pick the highest-score (or first if no scores) as the anchor.
      const sorted = [...geminiMatches].sort((a, b) => {
        const sa = Number((a.meta as Record<string, unknown> | undefined)?.discoveryScore ?? 0);
        const sb = Number((b.meta as Record<string, unknown> | undefined)?.discoveryScore ?? 0);
        return sb - sa;
      });
      anchor = buildAnchorFromCandidate(sorted[0], sorted.slice(1));
      // Phase 6 Round 1 step 3 — Gemini candidates that anchor a user-typed
      // WHAT (reached this branch via `candidateMatchesWhat` on the user's
      // `what`) represent the user's typed topic with a Gemini-polished
      // display label (e.g. user typed "3910 Bucknell", Gemini returned
      // "3910 Bucknell Drive"). Pre-tick them the same way we pre-tick
      // short-circuit / agency-derive synthetics — they're effectively the
      // user's input, not unpaired discoveries.
      anchor.preTicked = true;
      for (const c of geminiMatches) consumedKeys.add(c.key);
      state = "found_anchored";
    } else if (thing && thing.matchCount > 0) {
      // Found but unanchored — hint has matches via Stage 1 full-text
      // search, but topDomain was vetoed so no Stage 2 candidate exists.
      const sourcedVia = thing.sourcedFromWho ?? thing.topSenders[0] ?? null;
      anchor = {
        identityKey: `user-hint:${lower(what)}`,
        displayLabel: what,
        frequency: thing.matchCount,
        origin: "found_unanchored",
        senderAttribution: sourcedVia ?? undefined,
        aliases: [],
        preTicked: false,
      };
      state = "found_unanchored";
    } else {
      state = "not_found";
    }

    whatSections.push({
      what,
      state,
      pairedWhos,
      anchor,
      provenance: "user_input",
      notFoundNote:
        state === "not_found" ? "Not found in the last 8 weeks. We'll keep watching." : undefined,
      unanchoredNote:
        state === "found_unanchored" && thing
          ? `Found ${thing.matchCount} email${thing.matchCount === 1 ? "" : "s"} mentioning "${what}"${
              thing.sourcedFromWho ? ` via ${thing.sourcedFromWho}` : ""
            }, no domain anchor yet. You can still confirm — Denim will cluster by sender.`
          : undefined,
    });
  }

  // Phase 6 Round 1 step 5 — discovered PRIMARIES as first-class sections.
  // Every Stage 2 PRIMARY candidate not consumed by a user-typed WHAT
  // section above becomes its own top-level section with `provenance:
  // "discovered"`. These are principle #5 adjacent discoveries (property:
  // 205 Freedom Trail, 3305 Cardinal — user didn't type them but they
  // live on a confirmed anchor domain). Rendered with the same visual
  // weight as user-typed sections, distinguished only by the provenance
  // badge + pre-tick policy (score ≥ 1 → pre-ticked, matches eval gate-sim).
  for (const c of allCandidates) {
    if (consumedKeys.has(c.key)) continue;
    if (isSecondary(c)) continue;
    const m = c.meta ?? {};
    const score = typeof m.discoveryScore === "number" ? m.discoveryScore : undefined;
    const origin = originFromMeta(c);
    const aliases: string[] =
      Array.isArray(m.aliases) && (m.aliases as unknown[]).every((a) => typeof a === "string")
        ? (m.aliases as string[])
        : [];
    const anchor: AnchorPrimary = {
      identityKey: c.key,
      displayLabel: c.displayString,
      frequency: c.frequency,
      origin,
      senderAttribution: c.confirmedDomain,
      aliases,
      preTicked: (score ?? 0) >= 1,
    };
    whatSections.push({
      what: c.displayString,
      state: "found_anchored",
      pairedWhos: [],
      anchor,
      provenance: "discovered",
      discoveredOnDomain: c.confirmedDomain,
      discoveryScore: score,
    });
  }

  return { whatSections };
}
