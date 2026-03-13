import { z } from "zod";

const DiscoveredEntitySchema = z.object({
  name: z.string(),
  type: z.enum(["PRIMARY", "SECONDARY"]),
  secondaryTypeName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
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
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);
  return ValidationResponseSchema.parse(parsed);
}
