/**
 * Per-domain dedup for Stage 2 entity candidates (issue #95).
 *
 * Groups by `key` first (e.g., house-number, acronym stem), then merges entries
 * within a key bucket whose display strings are near-identical under a
 * Levenshtein threshold. Short strings use `stage2.levenshteinShortThreshold`
 * (default 1 edit); longer strings use `stage2.levenshteinLongThreshold`
 * (default 2), preventing false merges of short acronyms that happen to sit
 * one edit apart (e.g., "PPA" vs "PPZ").
 *
 * Merged entries keep the display form with the highest observed frequency
 * (ties fall to the entry seen first). `autoFixed: true` lets the review UI
 * flag "we merged 'St Agnes' + 'St. Agnes' + 'Saint Agnes' for you."
 *
 * #119: optional `stripTrailingSuffixes` option makes the grouping key AND
 * the Levenshtein comparison suffix-invariant. Used by the property-address
 * extractor so "851 Peavy" (no suffix) and "851 Peavy Road" (long suffix)
 * collapse into one candidate. When the merge happens, the **longest**
 * original `displayString` wins — verbose form reads better in the UI. When
 * the option is unset (default), behavior is identical to the legacy path so
 * school / agency / Pattern C callers are untouched.
 */
import { distance } from "fastest-levenshtein";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";

export interface DedupInput {
  /** Grouping key — typically house number, acronym stem, etc. */
  key: string;
  /** Display label shown to the user. */
  displayString: string;
  /** Observed frequency across Stage 2 subjects. */
  frequency: number;
}

export interface DedupOutput extends DedupInput {
  /** True if this entry was merged from two or more variants. */
  autoFixed: boolean;
}

export interface DedupOptions {
  /**
   * Case-insensitive tokens to strip from the END of both the grouping key
   * and the Levenshtein comparison string. Optional trailing period is
   * tolerated. Intended for property street-suffix canonicalization
   * (`Drive|Dr|Road|Rd|...`). When undefined / empty, no stripping runs.
   *
   * Only the **trailing** suffix is stripped (anchored to end-of-string) —
   * "Drive Through Dr" strips the final "Dr" but leaves the middle token.
   */
  stripTrailingSuffixes?: ReadonlyArray<string>;
}

const SHORT_LIMIT = 6;

function withinThreshold(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const threshold =
    maxLen <= SHORT_LIMIT
      ? ONBOARDING_TUNABLES.stage2.levenshteinShortThreshold
      : ONBOARDING_TUNABLES.stage2.levenshteinLongThreshold;
  return distance(a.toLowerCase(), b.toLowerCase()) <= threshold;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build an anchored, case-insensitive regex that matches any of the given
 *  tokens + optional trailing period at end-of-string. Tokens are sorted
 *  longest-first so "Drive" beats "Dr" when both would otherwise match. */
function buildSuffixStripper(tokens: ReadonlyArray<string>): RegExp | null {
  if (tokens.length === 0) return null;
  const sorted = [...tokens].sort((a, b) => b.length - a.length).map(escapeRegex);
  return new RegExp(`\\s+(?:${sorted.join("|")})\\.?\\s*$`, "i");
}

export function dedupByLevenshtein(items: DedupInput[], options?: DedupOptions): DedupOutput[] {
  const stripper = buildSuffixStripper(options?.stripTrailingSuffixes ?? []);
  const stripSuffix = (s: string): string => (stripper ? s.replace(stripper, "").trim() : s);

  // Group by suffix-stripped key so "851 peavy" and "851 peavy rd" share a
  // bucket when a suffix list is supplied. Without a suffix list the
  // stripper is a no-op and grouping is identical to the legacy path.
  const byKey = new Map<string, DedupInput[]>();
  for (const item of items) {
    const bucketKey = stripSuffix(item.key);
    const bucket = byKey.get(bucketKey) ?? [];
    bucket.push(item);
    byKey.set(bucketKey, bucket);
  }

  const out: DedupOutput[] = [];
  for (const [, bucket] of byKey) {
    type MergeRow = DedupOutput & { topFrequency: number };
    const merged: MergeRow[] = [];
    for (const item of bucket) {
      // Suffix-stripped comparison: lets "851 Peavy" vs "851 Peavy Road"
      // measure as distance 0 instead of 5.
      const itemCompare = stripSuffix(item.displayString);
      const existing = merged.find((m) =>
        withinThreshold(stripSuffix(m.displayString), itemCompare),
      );
      if (existing) {
        existing.frequency += item.frequency;
        // #119: when a suffix list is in effect, prefer the LONGEST original
        // displayString as canonical ("851 Peavy Road" beats "851 Peavy").
        // Otherwise keep the highest-frequency form (legacy behavior).
        const shouldReplace = stripper
          ? item.displayString.length > existing.displayString.length
          : item.frequency > existing.topFrequency;
        if (shouldReplace) {
          existing.displayString = item.displayString;
          existing.topFrequency = item.frequency;
          existing.key = item.key;
        } else if (item.frequency > existing.topFrequency) {
          // Track the running top frequency even when we keep the longer
          // display form, so downstream sorting sees the merged total.
          existing.topFrequency = item.frequency;
        }
        existing.autoFixed = true;
      } else {
        merged.push({
          ...item,
          autoFixed: false,
          topFrequency: item.frequency,
        });
      }
    }
    for (const m of merged) {
      const { topFrequency: _tf, ...rest } = m;
      out.push(rest);
    }
  }
  return out;
}
