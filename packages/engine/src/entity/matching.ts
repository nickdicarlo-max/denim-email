/**
 * Jaro-Winkler entity matching functions.
 * Pure functions — zero I/O, no Date.now(), no console.log.
 */

/**
 * Compute Jaro similarity between two strings.
 * Case-insensitive. Standard algorithm.
 */
export function jaro(s1: string, s2: string): number {
  const a = s1.toLowerCase();
  const b = s2.toLowerCase();

  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);

  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;

  // Find matching characters within the match window
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);

    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  return (
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3
  );
}

/**
 * Compute Jaro-Winkler similarity between two strings.
 * Adds prefix bonus (p=0.1, max 4 prefix chars) on top of Jaro.
 * Returns 0-1 similarity score. Case-insensitive.
 */
export function jaroWinkler(s1: string, s2: string): number {
  const jaroScore = jaro(s1, s2);

  const a = s1.toLowerCase();
  const b = s2.toLowerCase();

  // Count common prefix up to 4 characters
  const maxPrefix = Math.min(a.length, b.length, 4);
  let prefixLength = 0;
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) {
      prefixLength++;
    } else {
      break;
    }
  }

  const p = 0.1;
  return jaroScore + prefixLength * p * (1 - jaroScore);
}

// Generic words that inflate JW scores when they appear in both candidate
// and target (e.g., "Claude Team" vs "dance team" → 0.87 from "team" alone).
const GENERIC_TOKENS = new Set([
  "team", "class", "school", "club", "group", "org", "inc", "llc",
  "academy", "studio", "center", "lesson", "practice", "program",
  "mr", "mrs", "ms", "dr", "the", "a", "an", "of", "for",
]);

/**
 * Check that a JW match has real word overlap, not just generic suffix similarity.
 * At least one significant token from the candidate must fuzzy-match (JW ≥ 0.85)
 * a significant token in the target. Skips the check for single-word comparisons
 * or when one side has no significant tokens (e.g., pure name like "Ziad").
 */
function hasSignificantTokenOverlap(candidate: string, target: string): boolean {
  const candTokens = candidate.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const targetTokens = target.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

  // Single-word on both sides — JW score alone is sufficient
  if (candTokens.length <= 1 && targetTokens.length <= 1) return true;

  const sigCand = candTokens.filter((t) => !GENERIC_TOKENS.has(t));
  const sigTarget = targetTokens.filter((t) => !GENERIC_TOKENS.has(t));

  // If either side has no significant tokens, let JW decide
  if (sigCand.length === 0 || sigTarget.length === 0) return true;

  // At least one significant candidate token must match a significant target token
  for (const ct of sigCand) {
    for (const tt of sigTarget) {
      if (jaroWinkler(ct, tt) >= 0.85) return true;
    }
  }
  return false;
}

/**
 * Find the best fuzzy match for a candidate string against a list of targets.
 * Each target has a name and aliases. The candidate is compared against
 * the name AND all aliases, returning the best match above threshold.
 * Includes a token overlap guard to prevent matches driven by generic words
 * like "team", "class", "school" (e.g., "Claude Team" ≠ "dance team").
 */
export function fuzzyMatch(
  candidate: string,
  targets: Array<{ name: string; aliases: string[] }>,
  threshold: number = 0.85,
): { name: string; score: number } | null {
  let bestMatch: { name: string; score: number } | null = null;

  for (const target of targets) {
    // Compare against the target name
    const nameScore = jaroWinkler(candidate, target.name);
    if (
      nameScore >= threshold &&
      hasSignificantTokenOverlap(candidate, target.name) &&
      (bestMatch === null || nameScore > bestMatch.score)
    ) {
      bestMatch = { name: target.name, score: nameScore };
    }

    // Compare against each alias
    for (const alias of target.aliases) {
      const aliasScore = jaroWinkler(candidate, alias);
      if (
        aliasScore >= threshold &&
        hasSignificantTokenOverlap(candidate, alias) &&
        (bestMatch === null || aliasScore > bestMatch.score)
      ) {
        bestMatch = { name: target.name, score: aliasScore };
      }
    }
  }

  return bestMatch;
}

/**
 * Resolve a sender to a known entity using fuzzy matching.
 * Tries display name first, then email local part, against entity names + aliases.
 * Returns the best matching entity above threshold, or null.
 */
export function resolveEntity(
  senderName: string,
  senderEmail: string,
  entities: Array<{ name: string; type: "PRIMARY" | "SECONDARY"; aliases: string[] }>,
  threshold: number = 0.85,
): { entityName: string; entityType: "PRIMARY" | "SECONDARY"; confidence: number } | null {
  const targets = entities.map((e) => ({ name: e.name, aliases: e.aliases }));

  // First try fuzzy match on display name
  if (senderName.length > 0) {
    const nameMatch = fuzzyMatch(senderName, targets, threshold);
    if (nameMatch !== null) {
      const entity = entities.find((e) => e.name === nameMatch.name)!;
      return {
        entityName: entity.name,
        entityType: entity.type,
        confidence: nameMatch.score,
      };
    }
  }

  // Fall back to email local part (before @)
  if (senderEmail.length > 0) {
    const atIndex = senderEmail.indexOf("@");
    const localPart = atIndex >= 0 ? senderEmail.substring(0, atIndex) : senderEmail;

    if (localPart.length > 0) {
      const emailMatch = fuzzyMatch(localPart, targets, threshold);
      if (emailMatch !== null) {
        const entity = entities.find((e) => e.name === emailMatch.name)!;
        return {
          entityName: entity.name,
          entityType: entity.type,
          confidence: emailMatch.score,
        };
      }
    }
  }

  return null;
}
