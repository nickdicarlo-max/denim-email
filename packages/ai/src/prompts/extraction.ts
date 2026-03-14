/**
 * Extraction prompt builder for email data extraction.
 * Pure function — no I/O, no side effects.
 */
import type { ExtractionInput, ExtractionSchemaContext } from "@denim/types";

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
        `  - "${e.name}" (${e.type})${e.aliases.length > 0 ? ` — aliases: ${e.aliases.join(", ")}` : ""}`,
    )
    .join("\n");
}

function buildFieldDefinitions(schema: ExtractionSchemaContext): string {
  if (schema.extractedFields.length === 0) {
    return "No extracted fields defined.";
  }
  return schema.extractedFields
    .map((f) => `  - "${f.name}" (${f.type}): ${f.description} [source: ${f.source}]`)
    .join("\n");
}

function buildSystemPrompt(schema: ExtractionSchemaContext): string {
  return `You are an email data extraction engine for a "${schema.domain}" case management system. Your job is to analyze a single email and extract structured data from it.

For each email you must:
1. Generate a concise 1-2 sentence summary capturing the key information and intent of the email.
2. Assign tags ONLY from the provided taxonomy below. Do not invent new tags. Assign an empty array if no tags apply.
3. Detect entities from the provided entity list. Match by name or aliases. Include a confidence score (0-1) for each match.
4. Extract fields matching the field definitions below. Only include fields where a value is clearly present in the email.
5. Detect the language of the email body (ISO 639-1 code, e.g., "en", "es", "fr"). Set to null if uncertain.
6. Determine if the email is internal/noise. Set isInternal to true if the sender domain matches any exclusion pattern or the email appears to be an automated/system message.

TAG TAXONOMY (only assign tags from this list):
${buildTagTaxonomy(schema)}

KNOWN ENTITIES (detect references to these):
${buildEntityList(schema)}

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

Required JSON shape:
{
  "summary": string,
  "tags": string[],
  "extractedData": { [fieldName: string]: value },
  "detectedEntities": [{ "name": string, "type": "PRIMARY" | "SECONDARY", "confidence": number }],
  "isInternal": boolean,
  "language": string | null
}`;
}

function buildUserPrompt(email: ExtractionInput): string {
  return `Extract structured data from this email:

Subject: ${email.subject}
From: ${email.senderDisplayName} <${email.senderEmail}> (domain: ${email.senderDomain})
Date: ${email.date}
Is Reply: ${email.isReply}

--- EMAIL BODY ---
${email.body}
--- END EMAIL BODY ---

Return ONLY the JSON object. No other text.`;
}

/**
 * Builds a prompt pair for AI to extract structured data from an email.
 * Pure function, no I/O.
 */
export function buildExtractionPrompt(
  email: ExtractionInput,
  schema: ExtractionSchemaContext,
): ExtractionPromptResult {
  return {
    system: buildSystemPrompt(schema),
    user: buildUserPrompt(email),
  };
}
