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
    tagMatchScore: number;
    subjectMatchScore: number;
    actorAffinityScore: number;
  };
}

function buildSystemPrompt(input: ClusteringIntelligenceInput): string {
  const groupLines = input.entityGroups.map((g, i) => {
    const whats = g.whats.map((w) => `"${w}"`).join(", ");
    const whos = g.whos.map((w) => `"${w}"`).join(", ");
    return `  Group ${i + 1}: ${[whats, whos].filter(Boolean).join(" + ")}`;
  });

  return `You are a clustering intelligence engine for a "${input.domain}" case management system.
You have a list of extracted emails that need to be organized into CASES (groups of related emails).

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

GRAVITY MODEL PARAMETERS (current values):
- mergeThreshold: ${input.currentConfig.mergeThreshold} (higher = harder to merge, lower = easier)
- tagMatchScore: ${input.currentConfig.tagMatchScore} (points for matching tags)
- subjectMatchScore: ${input.currentConfig.subjectMatchScore} (points for similar subjects)
- actorAffinityScore: ${input.currentConfig.actorAffinityScore} (points for same sender)

You can suggest overrides to these parameters based on the email patterns you see.

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
    "senderAffinityWeight": number | null,
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
