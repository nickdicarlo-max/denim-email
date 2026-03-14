/**
 * Action dedup: fingerprinting and matching for CaseAction deduplication.
 * Pure functions — zero I/O, no Date.now(), no console.log.
 */
import { jaroWinkler } from "../entity/matching";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "this", "that", "be", "are",
  "was", "were", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "must",
  "shall", "can", "need", "about", "up", "out", "if", "not", "no",
  "so", "than", "too", "very", "just", "also", "into", "over", "after",
  "before", "between", "under", "again", "then", "once", "here", "there",
  "when", "where", "why", "how", "all", "each", "every", "both", "few",
  "more", "most", "other", "some", "such", "only", "own", "same",
]);

/**
 * Generate a dedup fingerprint from an action title.
 * Lowercases, strips stop words, sorts remaining tokens alphabetically.
 * Returns a canonical string for comparison.
 */
export function generateFingerprint(title: string): string {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));

  tokens.sort();
  return tokens.join(" ");
}

/**
 * Find the best matching fingerprint from a list of existing fingerprints.
 * Uses Jaro-Winkler similarity. Returns the matching fingerprint if above
 * threshold, or null if no match.
 */
export function matchAction(
  fingerprint: string,
  existingFingerprints: string[],
  threshold: number = 0.85,
): string | null {
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const existing of existingFingerprints) {
    const score = jaroWinkler(fingerprint, existing);
    if (score >= threshold && score > bestScore) {
      bestMatch = existing;
      bestScore = score;
    }
  }

  return bestMatch;
}
