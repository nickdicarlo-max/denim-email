/**
 * Clustering Intelligence prompt builder.
 * Pre-cluster AI pass: Claude reviews all extracted emails and suggests
 * intelligent groupings + gravity model parameter overrides.
 * Pure function — no I/O, no side effects.
 */

import type { EntityGroupInput } from "@denim/types";

export interface ClusteringIntelligencePromptResult {
  system: string;
  user: string;
}

export interface ClusteringIntelligenceInput {
  domain: string;
  today: string;
  entityGroups: EntityGroupInput[];
  emails: {
    id: string;
    subject: string;
    senderDisplayName: string;
    senderDomain: string;
    date: string;
    summary: string;
    tags: string[];
    entityName: string | null;
  }[];
  currentConfig: {
    mergeThreshold: number;
    threadMatchScore: number;
    subjectMatchScore: number;
    actorAffinityScore: number;
    timeDecayFreshDays: number;
  };
}

function buildSystemPrompt(input: ClusteringIntelligenceInput): string {
  const groupLines = input.entityGroups.map((g, i) => {
    const whats = g.whats.map((w: string) => `"${w}"`).join(", ");
    const whos = g.whos.map((w: string) => `"${w}"`).join(", ");
    return `  Group ${i + 1}: ${[whats, whos].filter(Boolean).join(" + ")}`;
  });

  return `You are a clustering intelligence engine for a "${input.domain}" case management system.
You have a list of extracted emails that need to be organized into CASES (groups of related emails).

TODAY'S DATE: ${input.today}
Use this to assess temporal patterns — are emails recurring weekly, seasonal, or one-time?

A CASE represents a coherent topic where "what's next?" has one clear answer.

USER'S ENTITY GROUPS:
${groupLines.join("\n")}

KEY PRINCIPLES:
1. RECURRING EVENTS: Weekly practice emails from the same coach → ONE case ("Soccer Practices"), not 15 separate cases.
   Same activity repeating = one case. Games at different venues = one case ("Soccer Games").
2. MULTIPLE CASES PER ENTITY: One entity CAN have multiple cases if matters are different:
   - Soccer: practices → one case, games → separate case, admin/membership → separate case
   - School: parent-teacher conference → one, fundraiser → separate, weekly newsletter → separate
3. NEXT ACTION: Each case should represent a topic where "next action" makes sense:
   - "Soccer Practices" → next practice date
   - "Soccer Games" → next game + opponent + location
4. EXCLUDE NOISE: Newsletters, promotional emails, AI summaries that mention entity names
   but aren't actually about those entities should be suggested for exclusion.

GRAVITY MODEL SCORING FORMULA:
The deterministic clustering model scores each email against each existing case:
  threadScore  = shares Gmail threadId with case? → ${input.currentConfig.threadMatchScore} points, else 0
  subjectScore = Jaro-Winkler similarity of normalized subjects × ${input.currentConfig.subjectMatchScore}
                 (0 if similarity < 0.7)
  actorScore   = same sender entity as case? → ${input.currentConfig.actorAffinityScore} points, else 0
  timeDecay    = 1.0 if email is within ${input.currentConfig.timeDecayFreshDays} days, then linear decay to 0.2 at 365 days

  finalScore = (threadScore + subjectScore + actorScore) × timeDecay

  if finalScore >= ${input.currentConfig.mergeThreshold} → MERGE into existing case
  else → CREATE new case

CURRENT PARAMETER VALUES:
  mergeThreshold:     ${input.currentConfig.mergeThreshold} (the gate — higher = more cases, lower = more merging)
  threadMatchScore:   ${input.currentConfig.threadMatchScore} (threaded emails auto-merge since this exceeds the threshold)
  subjectMatchScore:  ${input.currentConfig.subjectMatchScore} (max points for subject similarity — main signal for non-threaded emails)
  actorAffinityScore: ${input.currentConfig.actorAffinityScore} (bonus for same sender — usually not enough alone to trigger a merge)
  timeDecayFreshDays: ${input.currentConfig.timeDecayFreshDays} (emails within this window score at full strength)

KEY INSIGHT: threadMatchScore (${input.currentConfig.threadMatchScore}) already exceeds mergeThreshold (${input.currentConfig.mergeThreshold}),
so any emails sharing a Gmail thread will auto-merge. Your config tuning mainly affects NON-THREADED emails
where subjectMatchScore + actorAffinityScore determine the merge decision.

You can suggest overrides to mergeThreshold, subjectMatchScore, actorAffinityScore, and timeDecayFreshDays
based on the email patterns you see. Explain your reasoning.

CRITICAL RULES:
1. Return ONLY valid JSON matching the required schema exactly.
2. Every email ID must appear in exactly one group OR in excludeSuggestions, never both.
3. Group titles should be user-friendly, under 50 characters.
4. Provide reasoning for each group and for config overrides.

Required JSON shape:
{
  "groups": [
    {
      "caseTitle": string,
      "emailIds": string[],
      "reasoning": string,
      "isRecurring": boolean,
      "recurringPattern": "daily" | "weekly" | "biweekly" | "monthly" | null
    }
  ],
  "configOverrides": {
    "mergeThreshold": number | null,
    "subjectMatchScore": number | null,
    "actorAffinityScore": number | null,
    "timeDecayFreshDays": number | null,
    "reasoning": string
  },
  "excludeSuggestions": string[],
  "excludeReasoning": string | null
}`;
}

function buildUserPrompt(input: ClusteringIntelligenceInput): string {
  const emailLines = input.emails.map(
    (e) =>
      `[${e.id}] ${e.date} | From: ${e.senderDisplayName} (${e.senderDomain}) | Entity: ${e.entityName ?? "none"} | Tags: ${e.tags.join(", ") || "none"}\n  Subject: ${e.subject}\n  Summary: ${e.summary}`,
  );

  return `Group these ${input.emails.length} emails into cases:

${emailLines.join("\n\n")}

Return ONLY the JSON object. No other text.`;
}

/**
 * Builds a prompt pair for Claude to suggest intelligent email groupings.
 * Pure function, no I/O.
 */
export function buildClusteringIntelligencePrompt(
  input: ClusteringIntelligenceInput,
): ClusteringIntelligencePromptResult {
  return {
    system: buildSystemPrompt(input),
    user: buildUserPrompt(input),
  };
}
