/**
 * Discovery Intelligence prompt builder.
 * Analyzes sender patterns, social graph, and body samples to generate
 * targeted Gmail search queries for finding all relevant emails.
 * Pure function — no I/O, no side effects.
 */

import type { EntityGroupInput } from "@denim/types";

export interface DiscoveryIntelligencePromptResult {
  system: string;
  user: string;
}

export interface SenderPattern {
  senderEmail: string;
  senderDisplayName: string;
  domain: string;
  count: number;
}

export interface SocialCluster {
  primarySender: string;
  entityName: string | null;
  coRecipients: string[];
  recipientDomains: string[];
}

export interface BodySample {
  domain: string;
  senderDisplayName: string;
  subject: string;
  summary: string;
}

export interface DiscoveryIntelligenceInput {
  domain: string;
  entityGroups: EntityGroupInput[];
  senderPatterns: SenderPattern[];
  socialClusters: SocialCluster[];
  bodySamples: BodySample[];
  existingQueries: { query: string; label: string }[];
}

function buildSystemPrompt(input: DiscoveryIntelligenceInput): string {
  const groupLines = input.entityGroups.map((g, i) => {
    const whats = g.whats.map((w: string) => `"${w}"`).join(", ");
    const whos = g.whos.map((w: string) => `"${w}"`).join(", ");
    return `  Group ${i + 1}: ${[whats, whos].filter(Boolean).join(" + ")}`;
  });

  return `You are a discovery intelligence engine for a "${input.domain}" case management system.
You're helping find ALL emails relevant to a user's tracked topics in their Gmail inbox.

The user tracks these entity groups:
${groupLines.join("\n")}

You have:
1. SENDER PATTERNS: Who sends the most emails and from which domains
2. SOCIAL GRAPH: Who appears on emails together (To/CC recipients)
3. BODY SAMPLES: Content summaries from unclassified high-frequency domains

Your job: Generate targeted Gmail search queries that will find all relevant emails,
including ones that the basic entity name searches would miss.

QUERY GENERATION PRINCIPLES:
- Platform domains (e.g., teamsnap.com, parentmail.com) may send relevant notifications
  that don't mention entity names in the sender — body samples help identify these
- Co-recipients of known important senders may also send relevant emails independently
- Exclude common platform domains that send email like (google.com, github.com, linkedin.com, etc.)
- Each query should have a clear reason linking it to an entity group
- Generate at most 10 queries to avoi overwhelming rate limits

CRITICAL RULES:
1. Return ONLY valid JSON matching the required schema exactly.
2. Queries must be valid Gmail search syntax.
3. Provide reasoning for each query.
4. Do not duplicate queries already in existingQueries.

Required JSON shape:
{
  "relevantQueries": [
    {
      "query": string,
      "reason": string,
      "entityName": string | null
    }
  ],
  "excludeDomains": string[],
  "reasoning": string
}`;
}

function buildUserPrompt(input: DiscoveryIntelligenceInput): string {
  const senderLines = input.senderPatterns
    .slice(0, 30)
    .map((s) => `  ${s.senderDisplayName} <${s.senderEmail}> (${s.domain}) — ${s.count} emails`)
    .join("\n");

  const clusterLines = input.socialClusters
    .map(
      (c) =>
        `  ${c.primarySender} (entity: ${c.entityName ?? "unknown"}):\n    Co-recipients: ${c.coRecipients.slice(0, 10).join(", ")}\n    Recipient domains: ${c.recipientDomains.join(", ")}`,
    )
    .join("\n");

  const sampleLines = input.bodySamples
    .map(
      (s) =>
        `  ${s.domain} | From: ${s.senderDisplayName} | Subject: ${s.subject}\n    Summary: ${s.summary}`,
    )
    .join("\n");

  const existingLines = input.existingQueries.map((q) => `  "${q.query}" (${q.label})`).join("\n");

  return `Analyze these email patterns and generate discovery queries:

SENDER FREQUENCY (top senders):
${senderLines || "  None"}

SOCIAL GRAPH (who communicates together):
${clusterLines || "  None"}

BODY SAMPLES (content from unclassified domains):
${sampleLines || "  None"}

EXISTING QUERIES (don't duplicate):
${existingLines || "  None"}

Return ONLY the JSON object. No other text.`;
}

/**
 * Builds a prompt pair for Claude to generate intelligent discovery queries.
 * Pure function, no I/O.
 */
export function buildDiscoveryIntelligencePrompt(
  input: DiscoveryIntelligenceInput,
): DiscoveryIntelligencePromptResult {
  return {
    system: buildSystemPrompt(input),
    user: buildUserPrompt(input),
  };
}
