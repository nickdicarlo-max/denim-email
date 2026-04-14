import { z } from "zod";
import { stripCodeFences } from "./utils";

const DiscoveredEntitySchema = z.object({
  name: z.string(),
  type: z.enum(["PRIMARY", "SECONDARY"]),
  secondaryTypeName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
  emailCount: z.number().int().nonnegative().default(0),
  emailIndices: z.array(z.number()).default([]),
  likelyAliasOf: z.string().nullable().default(null),
  aliasConfidence: z.number().nullable().default(null),
  aliasReason: z.string().nullable().default(null),
  relatedUserThing: z.string().nullable().default(null),
});

const SuggestedTagSchema = z.object({
  name: z.string(),
  description: z.string(),
  expectedFrequency: z.enum(["high", "medium", "low"]),
  isActionable: z.boolean(),
});

const ValidationResponseSchema = z.object({
  confirmedEntities: z.array(z.string()),
  discoveredEntities: z.array(DiscoveredEntitySchema),
  confirmedTags: z.array(z.string()),
  suggestedTags: z.array(SuggestedTagSchema),
  noisePatterns: z.array(z.string()),
  confidenceScore: z.number().min(0).max(1),
});

export function parseValidationResponse(raw: string): z.infer<typeof ValidationResponseSchema> {
  const cleaned = stripCodeFences(raw);
  const parsed = JSON.parse(cleaned);
  return ValidationResponseSchema.parse(parsed);
}
