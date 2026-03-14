/**
 * Exclusion rule matching for the extraction pipeline.
 * Checks emails against schema-level exclusion rules before processing.
 */

interface EmailForExclusion {
  senderEmail: string;
  senderDomain: string;
  subject: string;
  threadId: string;
}

interface ExclusionRule {
  ruleType: string;
  pattern: string;
  isActive: boolean;
}

interface ExclusionMatch {
  matched: boolean;
  rule?: { ruleType: string; pattern: string };
}

/**
 * Check if an email matches any active exclusion rule.
 * Rule types: DOMAIN, SENDER, KEYWORD, THREAD.
 */
export function matchesExclusionRule(
  email: EmailForExclusion,
  rules: ExclusionRule[],
): ExclusionMatch {
  for (const rule of rules) {
    if (!rule.isActive) continue;

    switch (rule.ruleType) {
      case "DOMAIN":
        if (email.senderDomain.toLowerCase() === rule.pattern.toLowerCase()) {
          return { matched: true, rule: { ruleType: rule.ruleType, pattern: rule.pattern } };
        }
        break;
      case "SENDER":
        if (email.senderEmail.toLowerCase() === rule.pattern.toLowerCase()) {
          return { matched: true, rule: { ruleType: rule.ruleType, pattern: rule.pattern } };
        }
        break;
      case "KEYWORD":
        if (email.subject.toLowerCase().includes(rule.pattern.toLowerCase())) {
          return { matched: true, rule: { ruleType: rule.ruleType, pattern: rule.pattern } };
        }
        break;
      case "THREAD":
        if (email.threadId === rule.pattern) {
          return { matched: true, rule: { ruleType: rule.ruleType, pattern: rule.pattern } };
        }
        break;
    }
  }

  return { matched: false };
}
