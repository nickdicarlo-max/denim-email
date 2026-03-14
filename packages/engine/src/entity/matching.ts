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

/**
 * Find the best fuzzy match for a candidate string against a list of targets.
 * Each target has a name and aliases. The candidate is compared against
 * the name AND all aliases, returning the best match above threshold.
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
    if (nameScore >= threshold && (bestMatch === null || nameScore > bestMatch.score)) {
      bestMatch = { name: target.name, score: nameScore };
    }

    // Compare against each alias
    for (const alias of target.aliases) {
      const aliasScore = jaroWinkler(candidate, alias);
      if (aliasScore >= threshold && (bestMatch === null || aliasScore > bestMatch.score)) {
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
