/**
 * Stage 2 property-entity extraction (issue #95, spec Section 3).
 *
 * Given Gmail subjects from a Stage-1-confirmed property-management domain,
 * surface candidate property PRIMARIES that look like "<house#> <street name>
 * [<street type>]" — e.g., "1906 Crockett", "2310 Healey Dr", "851 Peavy".
 * Year-like numbers (2000–2030) are dropped so "Lease expires 2026" doesn't
 * pose as an address.
 *
 * Dedup keys are normalized via STREET_TYPE_NORMALIZE so "2310 Healey Dr"
 * and "2310 Healey Drive" land in the same bucket and merge.
 *
 * ReDoS safety: no nested quantifiers, fixed-length literal alternations,
 * and a 200-char cap on input subjects (see MAX_SUBJECT_LEN below).
 */

import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { dedupByLevenshtein } from "./levenshtein-dedup";

export const STREET_TYPE_NORMALIZE: Record<string, string> = {
  street: "St",
  st: "St",
  avenue: "Ave",
  ave: "Ave",
  drive: "Dr",
  dr: "Dr",
  road: "Rd",
  rd: "Rd",
  boulevard: "Blvd",
  blvd: "Blvd",
  lane: "Ln",
  ln: "Ln",
  court: "Ct",
  ct: "Ct",
  way: "Way",
  place: "Pl",
  pl: "Pl",
  terrace: "Ter",
  ter: "Ter",
  trail: "Trl",
  trl: "Trl",
  highway: "Hwy",
  hwy: "Hwy",
};

const STREET_TYPE_ALT = Object.keys(STREET_TYPE_NORMALIZE)
  .sort((a, b) => b.length - a.length)
  .join("|");
const COMPASS_ALT = "N|S|E|W|NE|NW|SE|SW";

// <house#> [compass] <1-2 word street name> [street-type]
//
// Name quantifier is `{0,1}?` (non-greedy) so "851 Peavy balance" resolves to
// "851 Peavy" rather than "851 Peavy balance" — the engine tries 0 additional
// words first, then backtracks to 1 only if needed (e.g., "100 Stone Creek"
// with no street-type suffix). Fixed-length alternations only; no nested
// quantifiers.
const ADDRESS_REGEX = new RegExp(
  String.raw`\b(\d{2,5})\s+` +
    `(?:(?:${COMPASS_ALT})\\s+)?` +
    String.raw`([A-Za-z]+(?:\s+[A-Za-z]+){0,1}?)` +
    `(?:\\s+(${STREET_TYPE_ALT}))?\\b`,
  "gi",
);

/**
 * Canonical dedup key. Lowercases + collapses street-type abbreviations so
 * "2310 Healey Dr" and "2310 Healey Drive" share a bucket.
 */
export function normalizeAddressKey(display: string): string {
  const parts = display.trim().toLowerCase().split(/\s+/);
  return parts.map((p) => (STREET_TYPE_NORMALIZE[p] ?? p).toLowerCase()).join(" ");
}

const MAX_SUBJECT_LEN = 200;

export interface SubjectInput {
  subject: string;
  frequency: number;
}

export interface PropertyCandidate {
  /** Normalized address key (shared by "Dr" / "Drive" variants). */
  key: string;
  /** Display label, e.g., "1906 Crockett" or "2310 Healey Dr". */
  displayString: string;
  frequency: number;
  autoFixed: boolean;
}

function isYearLike(n: number): boolean {
  return n >= 2000 && n <= 2030;
}

export function extractPropertyCandidates(subjects: SubjectInput[]): PropertyCandidate[] {
  const raw: { key: string; displayString: string; frequency: number }[] = [];
  for (const { subject, frequency } of subjects) {
    const capped = subject.length > MAX_SUBJECT_LEN ? subject.slice(0, MAX_SUBJECT_LEN) : subject;
    for (const m of capped.matchAll(ADDRESS_REGEX)) {
      const num = parseInt(m[1], 10);
      if (isYearLike(num)) continue;
      // Preserve the original display form (including the user's chosen street
      // type spelling — "Drive" vs "Dr", "Trail" vs "Trl"). Only the dedup key
      // is normalized, so variants of the same address still share a bucket.
      const suffix = m[3] ? ` ${m[3]}` : "";
      const display = `${m[1]} ${m[2]}${suffix}`.trim();
      raw.push({
        key: normalizeAddressKey(display),
        displayString: display,
        frequency,
      });
    }
  }
  const deduped = dedupByLevenshtein(raw);
  return deduped
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, ONBOARDING_TUNABLES.stage2.topNEntities);
}
