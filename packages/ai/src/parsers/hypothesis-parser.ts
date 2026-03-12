/**
 * Parser for AI-generated schema hypothesis responses.
 * Validates untrusted AI output against the SchemaHypothesis shape using Zod.
 * Pure function — no I/O, no side effects.
 */
import { z } from "zod";
import type { SchemaHypothesis } from "@denim/types";

const secondaryEntityTypeSchema = z.object({
  name: z.string(),
  description: z.string(),
  derivedFrom: z.enum(["sender", "extracted", "both"]),
  affinityScore: z.number(),
});

const entitySuggestionSchema = z.object({
  name: z.string(),
  type: z.enum(["PRIMARY", "SECONDARY"]),
  secondaryTypeName: z.string().nullable(),
  aliases: z.array(z.string()),
  confidence: z.number(),
  source: z.enum(["user_input", "email_scan", "ai_inferred"]),
});

const tagSuggestionSchema = z.object({
  name: z.string(),
  description: z.string(),
  expectedFrequency: z.enum(["high", "medium", "low"]),
  isActionable: z.boolean(),
});

const extractedFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["NUMBER", "STRING", "DATE", "BOOLEAN"]),
  description: z.string(),
  source: z.enum(["BODY", "ATTACHMENT", "ANY"]),
  format: z.string(),
  showOnCard: z.boolean(),
  aggregation: z.enum(["SUM", "LATEST", "MAX", "MIN", "COUNT", "FIRST"]),
});

const clusteringConfigSchema = z.object({
  mergeThreshold: z.number(),
  threadMatchScore: z.number(),
  tagMatchScore: z.number(),
  subjectMatchScore: z.number(),
  actorAffinityScore: z.number(),
  subjectAdditiveBonus: z.number(),
  timeDecayDays: z.object({
    fresh: z.number(),
    recent: z.number(),
    stale: z.number(),
  }),
  weakTagDiscount: z.number(),
  frequencyThreshold: z.number(),
  anchorTagLimit: z.number(),
  caseSizeThreshold: z.number(),
  caseSizeMaxBonus: z.number(),
  reminderCollapseEnabled: z.boolean(),
  reminderSubjectSimilarity: z.number(),
  reminderMaxAge: z.number(),
});

const discoveryQuerySchema = z.object({
  query: z.string(),
  label: z.string(),
  entityName: z.string().nullable(),
  source: z.enum(["entity_name", "domain_default", "email_scan"]),
});

const schemaHypothesisSchema = z.object({
  domain: z.string(),
  schemaName: z.string(),
  primaryEntity: z.object({
    name: z.string(),
    description: z.string(),
  }),
  secondaryEntityTypes: z.array(secondaryEntityTypeSchema),
  entities: z.array(entitySuggestionSchema).min(1, "At least 1 entity is required"),
  tags: z.array(tagSuggestionSchema).min(3, "At least 3 tags are required"),
  extractedFields: z.array(extractedFieldSchema),
  summaryLabels: z.object({
    beginning: z.string(),
    middle: z.string(),
    end: z.string(),
  }),
  clusteringConfig: clusteringConfigSchema,
  discoveryQueries: z.array(discoveryQuerySchema),
  exclusionPatterns: z.array(z.string()),
});

/**
 * Strips markdown code fences from a raw AI response string.
 */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

/**
 * Parses and validates an AI-generated hypothesis response.
 * Accepts a raw JSON string (optionally wrapped in markdown code fences).
 * Returns a validated SchemaHypothesis or throws a descriptive error.
 */
export function parseHypothesisResponse(raw: string): SchemaHypothesis {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse hypothesis response as JSON: ${cleaned.slice(0, 200)}...`,
    );
  }

  const result = schemaHypothesisSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid hypothesis response:\n${issues}`);
  }

  return result.data as SchemaHypothesis;
}
