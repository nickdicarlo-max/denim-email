import type { SchemaHypothesis } from "@denim/types";

export interface ValidationPromptResult {
  system: string;
  user: string;
}

interface EmailSample {
  subject: string;
  senderDomain: string;
  senderName: string;
  snippet: string;
}

export function buildValidationPrompt(
  hypothesis: SchemaHypothesis,
  emailSamples: EmailSample[],
): ValidationPromptResult {
  const system = `You are an email analysis assistant. You are given a schema hypothesis (an AI-generated plan for organizing a user's email) and a sample of their actual recent emails. Your job is to validate the hypothesis against the real email data.

Analyze the email samples and return a JSON object with these fields:
- confirmedEntities: string[] — entity names from the hypothesis that appear in the email samples
- discoveredEntities: array of { name, type ("PRIMARY" or "SECONDARY"), secondaryTypeName (string or null), confidence (0-1), source: "email_scan" } — new entities discovered in the email that weren't in the hypothesis
- confirmedTags: string[] — tag names from the hypothesis that match content in the email samples
- suggestedTags: array of { name, description, expectedFrequency ("high"|"medium"|"low"), isActionable: boolean } — new tags suggested by patterns in the email
- noisePatterns: string[] — sender domains that appear to be automated/marketing noise (e.g. noreply@, newsletter@)
- confidenceScore: number 0-1 — how well the hypothesis matches the actual email data

Return ONLY valid JSON, no markdown fences, no explanation.`;

  const entityList = hypothesis.entities.map((e) => `- ${e.name} (${e.type})`).join("\n");
  const tagList = hypothesis.tags.map((t) => `- ${t.name}: ${t.description}`).join("\n");

  const sampleList = emailSamples
    .slice(0, 100)
    .map(
      (e, i) =>
        `${i + 1}. From: ${e.senderName} (${e.senderDomain}) | Subject: ${e.subject} | Preview: ${e.snippet.slice(0, 120)}`,
    )
    .join("\n");

  const user = `## Schema Hypothesis

**Domain:** ${hypothesis.domain}
**Schema Name:** ${hypothesis.schemaName}
**Primary Entity Type:** ${hypothesis.primaryEntity.name} — ${hypothesis.primaryEntity.description}

### Known Entities
${entityList}

### Expected Tags
${tagList}

## Email Samples (${emailSamples.length} emails)
${sampleList}

Analyze these emails against the hypothesis. Which entities and tags are confirmed? What new patterns do you see? What sender domains are noise?`;

  return { system, user };
}
