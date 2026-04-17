/**
 * Stage 2 school_parent entity extraction (issue #95, spec Section 4).
 *
 * Two independent patterns:
 *  - Pattern A (institutions): "St Agnes", "Saint Agnes", "St. Agnes",
 *    "Lanier Middle", "Vail Mountain School", "First Baptist Church",
 *    "Sidwell Friends School", "Lincoln Charter", etc.
 *  - Pattern B (activities/teams): "U11 Soccer", "Pia Ballet",
 *    "Cosmos Soccer", "Adams Lacrosse", "Varsity Cross Country",
 *    "FRC Robotics", "Westfield Debate".
 *
 * Pattern A has TWO sub-branches: a religious-prefix branch that matches
 * "St/Saint/Jewish + name" WITHOUT requiring an institution suffix (so
 * "St Agnes Auction" still surfaces St Agnes), and a general branch that
 * REQUIRES an institution suffix (School, Academy, Charter, ...) so
 * "First Baptist Church" works but random "First Baptist" in prose doesn't.
 *
 * ReDoS safety: fixed-length literal alternations, no nested quantifiers,
 * 200-char subject cap.
 */
import { dedupByLevenshtein } from "./levenshtein-dedup";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import type { SubjectInput } from "./property-entity";

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
  pattern: "A" | "B";
}

function normalizeKey(display: string): string {
  return display
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSchoolCandidates(
  subjects: SubjectInput[],
): SchoolCandidate[] {
  type Raw = { input: { key: string; displayString: string; frequency: number }; pattern: "A" | "B" };
  const rawByPattern: Raw[] = [];

  for (const { subject, frequency } of subjects) {
    const capped =
      subject.length > MAX_SUBJECT_LEN ? subject.slice(0, MAX_SUBJECT_LEN) : subject;

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
    const forPattern = rawByPattern
      .filter((r) => r.pattern === pattern)
      .map((r) => r.input);
    const deduped = dedupByLevenshtein(forPattern);
    for (const d of deduped) output.push({ ...d, pattern });
  }

  return output
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, ONBOARDING_TUNABLES.stage2.topNEntities);
}
