/**
 * Stage 2 agency entity derivation (issue #95, spec Section 4).
 *
 * Unlike property/school entities which scan subjects, agency entities come
 * from the authoritative sender domain itself — with an 80%+ display-name
 * convergence check as validation.
 *
 * Algorithm:
 *   1. If ≥80% of sender display names share a common multi-char token (e.g.,
 *      4 of 5 "From" lines mention "Anthropic"), use that token as the label
 *      and mark `derivedVia: "display-name"`.
 *   2. Otherwise, strip the TLD, split on `- _ .`, capitalize each segment
 *      ("portfolio-pro-advisors.com" → "Portfolio Pro Advisors"), and mark
 *      `derivedVia: "domain"`.
 *   3. If the domain base contains a digit (or produces no segments), flag
 *      `needsUserEdit: true` so the review UI prompts for cleanup.
 */

export interface DeriveAgencyInput {
  authoritativeDomain: string;
  /** Sender display names from From headers (e.g., "Sarah Chen | Anthropic"). */
  senderDisplayNames: string[];
}

export interface AgencyEntity {
  displayLabel: string;
  authoritativeDomain: string;
  derivedVia: "display-name" | "domain";
  needsUserEdit: boolean;
}

const CONVERGENCE_THRESHOLD = 0.8;
const SUFFIX_STRIP_RE = /\.(com|org|net|co|io|ai|us|uk|biz)$/i;

function capFirst(seg: string): string {
  if (!seg) return seg;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

function deriveFromDomain(domain: string): {
  label: string;
  needsUserEdit: boolean;
} {
  const base = domain.replace(SUFFIX_STRIP_RE, "");
  const hasDigit = /\d/.test(base);
  const segments = base.split(/[-._]/).filter(Boolean);
  const label = segments.map(capFirst).join(" ");
  return { label, needsUserEdit: hasDigit || segments.length === 0 };
}

/**
 * Tokenize a display name into multi-char word candidates. Splits on
 * whitespace and common separator punctuation. A single display name
 * rarely contributes more than 4-5 tokens, so the O(name×tokens) count
 * stays well inside the Stage 2 per-domain budget.
 */
function tokenize(name: string): string[] {
  return name.split(/[\s|,@.\-]+/).filter((t) => t.length >= 2);
}

/**
 * Find the token that appears (case-insensitively) in ≥80% of display
 * names, counting at most once per name. Requires at least 2 names to
 * converge on the same token — a single display name trivially has 100%
 * "convergence" on every one of its own tokens, which would pick the
 * first word (typically a first name) instead of the company name.
 * Returns the original-cased form of the token as seen in the data.
 */
function findConvergentToken(names: string[]): string | null {
  if (names.length === 0) return null;
  const tokenCounts = new Map<string, { count: number; original: string }>();
  for (const name of names) {
    const seen = new Set<string>();
    for (const t of tokenize(name)) {
      const lower = t.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      const row = tokenCounts.get(lower);
      if (row) {
        row.count += 1;
      } else {
        tokenCounts.set(lower, { count: 1, original: t });
      }
    }
  }
  let best: { count: number; original: string } | null = null;
  for (const row of tokenCounts.values()) {
    if (!best || row.count > best.count) best = row;
  }
  if (!best) return null;
  if (best.count < 2) return null;
  return best.count / names.length >= CONVERGENCE_THRESHOLD ? best.original : null;
}

export function deriveAgencyEntity(input: DeriveAgencyInput): AgencyEntity {
  const { authoritativeDomain, senderDisplayNames } = input;

  const convergent = findConvergentToken(senderDisplayNames);
  if (convergent) {
    return {
      displayLabel: convergent,
      authoritativeDomain,
      derivedVia: "display-name",
      needsUserEdit: false,
    };
  }

  const domainDerived = deriveFromDomain(authoritativeDomain);
  return {
    displayLabel: domainDerived.label,
    authoritativeDomain,
    derivedVia: "domain",
    needsUserEdit: domainDerived.needsUserEdit,
  };
}
