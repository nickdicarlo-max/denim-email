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

const SHORT_LIMIT = 6;

function withinThreshold(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const threshold =
    maxLen <= SHORT_LIMIT
      ? ONBOARDING_TUNABLES.stage2.levenshteinShortThreshold
      : ONBOARDING_TUNABLES.stage2.levenshteinLongThreshold;
  return distance(a.toLowerCase(), b.toLowerCase()) <= threshold;
}

export function dedupByLevenshtein(items: DedupInput[]): DedupOutput[] {
  const byKey = new Map<string, DedupInput[]>();
  for (const item of items) {
    const bucket = byKey.get(item.key) ?? [];
    bucket.push(item);
    byKey.set(item.key, bucket);
  }

  const out: DedupOutput[] = [];
  for (const [, bucket] of byKey) {
    type MergeRow = DedupOutput & { topFrequency: number };
    const merged: MergeRow[] = [];
    for (const item of bucket) {
      const existing = merged.find((m) =>
        withinThreshold(m.displayString, item.displayString),
      );
      if (existing) {
        existing.frequency += item.frequency;
        if (item.frequency > existing.topFrequency) {
          existing.displayString = item.displayString;
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
