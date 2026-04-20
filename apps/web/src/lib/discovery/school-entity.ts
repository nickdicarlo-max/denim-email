/**
 * Stage 2 school_parent entity extraction (issue #95, spec Section 4; #102).
 *
 * Three independent patterns:
 *  - Pattern A (institutions): "St Agnes", "Saint Agnes", "St. Agnes",
 *    "Lanier Middle", "Vail Mountain School", "First Baptist Church",
 *    "Sidwell Friends School", "Lincoln Charter", etc.
 *  - Pattern B (activities/teams): "U11 Soccer", "Pia Ballet",
 *    "Cosmos Soccer", "Adams Lacrosse", "Varsity Cross Country",
 *    "FRC Robotics", "Westfield Debate".
 *  - Pattern C (#102, corpus mining): proper-noun n-grams that repeat
 *    across ≥ 3 subjects, filtered against an event-verb stopword set.
 *    Catches activity-platform notifications (TeamSnap, GameChanger,
 *    ClassDojo) where the team name repeats but matches neither A nor B.
 *
 * Pattern A has TWO sub-branches: a religious-prefix branch that matches
 * "St/Saint/Jewish + name" WITHOUT requiring an institution suffix (so
 * "St Agnes Auction" still surfaces St Agnes), and a general branch that
 * REQUIRES an institution suffix (School, Academy, Charter, ...) so
 * "First Baptist Church" works but random "First Baptist" in prose doesn't.
 *
 * When `options.pairedWhoAddresses` is supplied (from #117 Stage 1 pairing),
 * Pattern C runs once in full-view (all subjects) plus once per paired WHO
 * (subjects filtered to that WHO's senderEmail); narrow-view candidates get
 * tagged with `sourcedFromWho` + `relatedWhat` so downstream UI / clustering
 * can surface provenance. Unpaired schemas run full-view only.
 *
 * Cross-pattern dedup preference on key collision: A > B > C. Pattern A/B
 * are more precise when they fire; Pattern C owns a candidate only when
 * neither A nor B extracted the same normalized key.
 *
 * ReDoS safety: fixed-length literal alternations, no nested quantifiers,
 * 200-char subject cap.
 */

import { mineFrequentPhrases } from "@denim/engine";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { dedupByLevenshtein } from "./levenshtein-dedup";
import type { SubjectInput } from "./property-entity";

/**
 * #102: alias — `SubjectInput` now optionally carries `senderEmail` for
 * Pattern C narrow-view scoping. Kept as a separate name at the school-entity
 * public API boundary so call sites reading the Pattern C path are explicit.
 */
export type SubjectInputWithSender = SubjectInput;

const INSTITUTION_SUFFIX_ALT = [
  "Day School",
  "Country Day",
  "Friends School",
  "School",
  "Academy",
  "College",
  "Preschool",
  "Elementary",
  "Middle",
  "High",
  "Prep",
  "Montessori",
  "YMCA",
  "Church",
  "Temple",
  "Synagogue",
  "Charter",
  "Magnet",
  "International",
]
  .sort((a, b) => b.length - a.length)
  .join("|");

// Two alternatives joined with |:
//   1. (St\.?|Saint|Jewish)\s+<Name>       — no suffix required
//   2. <Name>(\s+<Name>)?\s+<Suffix>       — general institution
const INSTITUTION_RE = new RegExp(
  String.raw`\b(?:` +
    String.raw`(?:St\.?|Saint|Jewish)\s+[A-Z][a-z]+` +
    `|` +
    `[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?\\s+(?:${INSTITUTION_SUFFIX_ALT})` +
    String.raw`)\b`,
  "gi",
);

const ACTIVITY_ALT = [
  // Sports
  "Cross Country",
  "Cheerleading",
  "Volleyball",
  "Basketball",
  "Baseball",
  "Lacrosse",
  "Football",
  "Swimming",
  "Wrestling",
  "Fencing",
  "Rowing",
  "Soccer",
  "Hockey",
  "Tennis",
  "Track",
  "Rugby",
  "Cricket",
  "Swim",
  "Crew",
  "Golf",
  "XC",
  // Dance / performing arts
  "Hip Hop",
  "Contemporary",
  "Orchestra",
  "Gymnastics",
  "Theater",
  "Ballet",
  "Karate",
  "Cheer",
  "Dance",
  "Choir",
  "Band",
  "Drama",
  "Judo",
  "Step",
  "Jazz",
  "Tap",
  // Music
  "Acapella",
  "Singing",
  "Violin",
  "Guitar",
  "Piano",
  "Cello",
  // Academics
  "Science Bowl",
  "Quiz Bowl",
  "Model UN",
  "Robotics",
  "Math Team",
  "Scouts",
  "Debate",
  "Chess",
]
  .sort((a, b) => b.length - a.length)
  .join("|");

// <team/prefix> <activity>.  Prefix is either a U-number (U11, U12) or a
// word of 3+ characters starting with a capital. 3-char minimum keeps out
// "St" / "Dr" noise but still admits "Pia", "FRC", etc.
const ACTIVITY_RE = new RegExp(
  String.raw`\b(?:U\d{1,2}|[A-Z][A-Za-z]{2,})\s+(?:${ACTIVITY_ALT})\b`,
  "g",
);

const MAX_SUBJECT_LEN = 200;

export interface SchoolCandidate {
  /** Normalized key — collapses casing, punctuation, Saint→St. */
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  pattern: "A" | "B" | "C";
  /** #102: paired-WHO attribution when Pattern C came from narrow-view. */
  sourcedFromWho?: string;
  /** #102: paired WHAT (topic) this candidate was sourced under. */
  relatedWhat?: string;
}

export interface PairedWhoAddress {
  senderEmail: string;
  pairedWhat: string;
  pairedWho: string;
}

export interface ExtractSchoolOptions {
  /** #102 + #117: list of paired-WHO senderEmail ↔ topic mappings. When
   *  non-empty, Pattern C runs once full-view and once per paired WHO. */
  pairedWhoAddresses?: PairedWhoAddress[];
}

function normalizeKey(display: string): string {
  return display
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pattern C: mine repeating proper-noun n-grams over a subject subset. */
function minePatternC(
  subjectsSlice: ReadonlyArray<{ subject: string; frequency: number }>,
  tags: { sourcedFromWho?: string; relatedWhat?: string } = {},
): SchoolCandidate[] {
  if (subjectsSlice.length === 0) return [];
  const mined = mineFrequentPhrases(subjectsSlice);
  return mined.map((m) => ({
    key: normalizeKey(m.phrase),
    displayString: m.phrase,
    frequency: m.frequency,
    autoFixed: false,
    pattern: "C" as const,
    ...(tags.sourcedFromWho ? { sourcedFromWho: tags.sourcedFromWho } : {}),
    ...(tags.relatedWhat ? { relatedWhat: tags.relatedWhat } : {}),
  }));
}

/** Dedup Pattern C output internally. When the same normalized key appears
 *  under both a narrow-view (tagged) and full-view (untagged) entry, prefer
 *  the tagged one so paired-WHO attribution survives. Otherwise keep the
 *  higher-frequency entry. */
function dedupPatternC(candidates: SchoolCandidate[]): SchoolCandidate[] {
  const byKey = new Map<string, SchoolCandidate>();
  for (const c of candidates) {
    const existing = byKey.get(c.key);
    if (!existing) {
      byKey.set(c.key, c);
      continue;
    }
    // Prefer the tagged (narrow-view) entry when both exist.
    const existingTagged = Boolean(existing.sourcedFromWho);
    const candidateTagged = Boolean(c.sourcedFromWho);
    if (candidateTagged && !existingTagged) {
      byKey.set(c.key, c);
    } else if (!candidateTagged && existingTagged) {
      // keep existing
    } else {
      // Both tagged or both untagged — keep higher frequency.
      if (c.frequency > existing.frequency) byKey.set(c.key, c);
    }
  }
  return [...byKey.values()];
}

export function extractSchoolCandidates(
  subjects: SubjectInputWithSender[],
  options?: ExtractSchoolOptions,
): SchoolCandidate[] {
  type Raw = {
    input: { key: string; displayString: string; frequency: number };
    pattern: "A" | "B";
  };
  const rawByPattern: Raw[] = [];

  for (const { subject, frequency } of subjects) {
    const capped = subject.length > MAX_SUBJECT_LEN ? subject.slice(0, MAX_SUBJECT_LEN) : subject;

    for (const m of capped.matchAll(INSTITUTION_RE)) {
      const display = m[0].trim();
      rawByPattern.push({
        input: { key: normalizeKey(display), displayString: display, frequency },
        pattern: "A",
      });
    }
    for (const m of capped.matchAll(ACTIVITY_RE)) {
      const display = m[0].trim();
      rawByPattern.push({
        input: { key: normalizeKey(display), displayString: display, frequency },
        pattern: "B",
      });
    }
  }

  // Dedup per pattern so an institution and a same-named activity don't collapse.
  const output: SchoolCandidate[] = [];
  for (const pattern of ["A", "B"] as const) {
    const forPattern = rawByPattern.filter((r) => r.pattern === pattern).map((r) => r.input);
    const deduped = dedupByLevenshtein(forPattern);
    for (const d of deduped) output.push({ ...d, pattern });
  }

  // Pattern C — corpus frequency mining (#102).
  const patternCRaw: SchoolCandidate[] = [];

  // Full-view pass: always runs.
  const fullSubjects = subjects.map((s) => ({ subject: s.subject, frequency: s.frequency }));
  patternCRaw.push(...minePatternC(fullSubjects));

  // Narrow-view passes: one per paired WHO when pairings exist.
  const pairings = options?.pairedWhoAddresses ?? [];
  if (pairings.length > 0) {
    for (const p of pairings) {
      const needle = p.senderEmail.toLowerCase();
      const slice = subjects
        .filter((s) => (s.senderEmail ?? "").toLowerCase() === needle)
        .map((s) => ({ subject: s.subject, frequency: s.frequency }));
      if (slice.length === 0) continue;
      patternCRaw.push(
        ...minePatternC(slice, {
          sourcedFromWho: p.pairedWho,
          relatedWhat: p.pairedWhat,
        }),
      );
    }
  }

  // Dedup Pattern C output internally, then Levenshtein-dedup on display.
  const patternCDeduped = dedupPatternC(patternCRaw);
  // Levenshtein pass operates on bare shape; we re-attach pattern C tags
  // from the closest-matching entry post-dedup.
  const lvInput = patternCDeduped.map((c) => ({
    key: c.key,
    displayString: c.displayString,
    frequency: c.frequency,
  }));
  const lvOut = dedupByLevenshtein(lvInput);
  const tagByKey = new Map(patternCDeduped.map((c) => [c.key, c] as const));
  const patternC: SchoolCandidate[] = lvOut.map((d) => {
    const src = tagByKey.get(d.key);
    return {
      ...d,
      pattern: "C" as const,
      ...(src?.sourcedFromWho ? { sourcedFromWho: src.sourcedFromWho } : {}),
      ...(src?.relatedWhat ? { relatedWhat: src.relatedWhat } : {}),
    };
  });
  output.push(...patternC);

  // Cross-pattern dedup: A > B > C on normalized-key collisions. Preserves
  // the deterministic-signal entry when multiple patterns hit the same key.
  const crossDeduped = new Map<string, SchoolCandidate>();
  const rank = (p: "A" | "B" | "C") => (p === "A" ? 0 : p === "B" ? 1 : 2);
  for (const c of output) {
    const existing = crossDeduped.get(c.key);
    if (!existing) {
      crossDeduped.set(c.key, c);
      continue;
    }
    if (rank(c.pattern) < rank(existing.pattern)) {
      // Incoming is more-preferred pattern — keep it but carry over the
      // higher frequency (Pattern C on a dominant entity can legitimately
      // count more distinct subjects than the A/B regex match did).
      crossDeduped.set(c.key, {
        ...c,
        frequency: Math.max(c.frequency, existing.frequency),
      });
    } else if (rank(c.pattern) === rank(existing.pattern)) {
      // Same pattern — keep higher frequency.
      if (c.frequency > existing.frequency) crossDeduped.set(c.key, c);
    } else {
      // Existing is more-preferred; just bump its frequency upward.
      crossDeduped.set(c.key, {
        ...existing,
        frequency: Math.max(c.frequency, existing.frequency),
      });
    }
  }

  return [...crossDeduped.values()]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, ONBOARDING_TUNABLES.stage2.topNEntities);
}
