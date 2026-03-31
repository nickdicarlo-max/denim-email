/**
 * Extraction prompt builder for email data extraction.
 * Pure function — no I/O, no side effects.
 */
import type { EntityGroupInput, ExtractionInput, ExtractionSchemaContext } from "@denim/types";

export interface ExtractionPromptResult {
  system: string;
  user: string;
}

function buildTagTaxonomy(schema: ExtractionSchemaContext): string {
  if (schema.tags.length === 0) {
    return "No tags defined.";
  }
  return schema.tags
    .map((t) => `  - "${t.name}": ${t.description}`)
    .join("\n");
}

function buildEntityList(schema: ExtractionSchemaContext): string {
  if (schema.entities.length === 0) {
    return "No entities defined.";
  }
  return schema.entities
    .map(
      (e) =>
        `  - "${e.name}" (${e.type}) [${e.isUserInput ? "USER-INPUT" : "DISCOVERED"}]${e.aliases.length > 0 ? ` — aliases: ${e.aliases.join(", ")}` : ""}`,
    )
    .join("\n");
}

function buildEntityGroups(groups: EntityGroupInput[] | undefined, domain: string): string {
  if (!groups || groups.length === 0) {
    return "";
  }
  const lines = groups.map((g, i) => {
    const whats = g.whats.map((w) => `"${w}" (PRIMARY)`).join(", ");
    const whos = g.whos.map((w) => `"${w}" (SECONDARY)`).join(", ");
    const parts = [whats, whos].filter(Boolean).join(" + ");
    return `  Group ${i + 1}: ${parts}`;
  });
  return `
ENTITY GROUPS (these are the user's topics — entities that belong together):
${lines.join("\n")}

RELEVANCE ASSESSMENT:
Consider the FULL CONTEXT of this schema: domain "${domain}", with these entity groups.
Ask: "Would a ${domain} user who set up tracking for these entities want to see this email?"

Score holistically — consider sender, subject, body content, and relationship to the user's entities:
- 1.0 = Email is directly about one of these entities. From/to a known person, about a tracked activity.
- 0.7 = Email is clearly related — involves the same organization, team, school, or activity.
- 0.4 = Email has a real but indirect connection (e.g., a league-wide announcement that includes the tracked team).
- 0.1 = Entity name appears incidentally in an unrelated email (newsletter digest, AI summary mentioning sports, promotional content).
- 0.0 = No connection.

CRITICAL: A passing mention of an entity name in an otherwise unrelated email scores 0.1 at most.
The email must be ABOUT the entity's activities or people to score above 0.4.
Newsletters, digests, promotional emails, and AI-generated summaries that happen to mention
an entity name are NOT relevant to that entity.

- Set relevanceEntity to the PRIMARY entity from the best-matching group.
- Partial name matches are NOT matches. "Ziad Jones" is NOT "Ziad Allan". Match the full name or known aliases only.`;
}

function buildFieldDefinitions(schema: ExtractionSchemaContext): string {
  if (schema.extractedFields.length === 0) {
    return "No extracted fields defined.";
  }
  return schema.extractedFields
    .map((f) => `  - "${f.name}" (${f.type}): ${f.description} [source: ${f.source}]`)
    .join("\n");
}

function buildSystemPrompt(schema: ExtractionSchemaContext, today: string): string {
  return `You are an email data extraction engine for a "${schema.domain}" case management system. Your job is to analyze a single email and extract structured data from it.

TODAY'S DATE: ${today}
Use this to assess temporal relevance. An email about an event 3 months ago is less relevant than one about next week.

For each email you must:
1. Generate a concise 1-2 sentence summary capturing the key information and intent of the email.
   IMPORTANT: Write summaries using absolute dates, not relative time references. These summaries are stored permanently and read days or weeks later.
   WRONG: "Practice moved to next Tuesday", "Meeting scheduled for this Friday", "Payment due in 3 days"
   RIGHT: "Practice moved to Tue Apr 1", "Meeting scheduled for Fri Apr 4", "Payment due by Thu Apr 3"
   Use TODAY'S DATE above to convert any relative references found in the email body into absolute dates.
2. Assign tags ONLY from the provided taxonomy below. Do not invent new tags. Assign an empty array if no tags apply.
3. Detect entities from the provided entity list. Match by name or aliases. Include a confidence score (0-1) for each match.
4. Extract fields matching the field definitions below. Only include fields where a value is clearly present in the email.
5. Detect the language of the email body (ISO 639-1 code, e.g., "en", "es", "fr"). Set to null if uncertain.
6. Determine if the email is internal/noise. Set isInternal to true if the sender domain matches any exclusion pattern or the email appears to be an automated/system message.
7. RELEVANCE ASSESSMENT: Does this email substantively relate to at least one [USER-INPUT] entity? Score using the entity group guide below if available, otherwise:
   1.0 = directly about a user-input entity (from/to a known person, about a tracked activity)
   0.7 = clearly related (same organization, team, school, or activity)
   0.4 = real but indirect connection (league-wide announcement mentioning tracked team)
   0.1 = entity name appears incidentally in unrelated content (newsletter, digest, promotional)
   0.0 = no connection to any user-input entity
   CRITICAL: Tags alone do NOT make an email relevant. A newsletter mentioning "soccer" is NOT relevant to the user's soccer entity. The email must be ABOUT the entity's activities or people, not just mention keywords in passing.
   Set relevanceEntity to the PRIMARY entity from the best-matching group, or null if none.

TAG TAXONOMY (only assign tags from this list):
${buildTagTaxonomy(schema)}

KNOWN ENTITIES (detect references to these):
${buildEntityList(schema)}
${buildEntityGroups(schema.entityGroups, schema.domain)}

EXTRACTED FIELDS (extract values for these if present):
${buildFieldDefinitions(schema)}

EXCLUSION PATTERNS (sender domains/addresses considered internal/noise):
${schema.exclusionPatterns.length > 0 ? schema.exclusionPatterns.map((p) => `  - ${p}`).join("\n") : "  None defined."}

CRITICAL RULES:
1. Return ONLY valid JSON matching the required schema exactly. No explanations, no markdown, no extra text.
2. The summary must be 10-500 characters, capturing the email's key point.
3. Tags array must only contain tag names from the taxonomy above. Empty array is valid.
4. DetectedEntities must reference entities from the known entities list. Do not invent entities.
5. ExtractedData keys must match field names from the field definitions. Only include fields with clear values.
6. Confidence scores for entities should reflect how clearly the entity is referenced (1.0 = explicit mention, 0.5 = implied).
7. Ignore email signatures, footers, and boilerplate when detecting entities and assessing relevance. Signature blocks typically appear after "-- ", "Sent from", or contain phone numbers, addresses, and job titles. An organization name in a signature does NOT count as the email being "about" that organization. Only detect entities from the subject line and main body content.

Required JSON shape:
{
  "summary": string,
  "tags": string[],
  "extractedData": { [fieldName: string]: value },
  "detectedEntities": [{ "name": string, "type": "PRIMARY" | "SECONDARY", "confidence": number }],
  "isInternal": boolean,
  "language": string | null,
  "relevanceScore": number,
  "relevanceEntity": string | null
}`;
}

function buildUserPrompt(email: ExtractionInput): string {
  const attachmentSection = email.attachments && email.attachments.length > 0
    ? `\n--- ATTACHMENTS ---\n${email.attachments.map((a, i) => `${i + 1}. ${a.filename} (${a.mimeType}, ${Math.round(a.sizeBytes / 1024)}KB)${a.extractionSummary ? ": " + a.extractionSummary : ""}`).join("\n")}\n--- END ATTACHMENTS ---`
    : "";

  return `Extract structured data from this email:

Subject: ${email.subject}
From: ${email.senderDisplayName} <${email.senderEmail}> (domain: ${email.senderDomain})
Date: ${email.date}
Is Reply: ${email.isReply}

--- EMAIL BODY ---
${email.body.slice(0, 8000)}${email.body.length > 8000 ? "\n[...truncated, " + email.body.length + " chars total]" : ""}
--- END EMAIL BODY ---
${attachmentSection}
Return ONLY the JSON object. No other text.`;
}

/**
 * Builds a prompt pair for AI to extract structured data from an email.
 * Pure function, no I/O.
 */
export function buildExtractionPrompt(
  email: ExtractionInput,
  schema: ExtractionSchemaContext,
  today?: string,
): ExtractionPromptResult {
  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  return {
    system: buildSystemPrompt(schema, todayStr),
    user: buildUserPrompt(email),
  };
}
