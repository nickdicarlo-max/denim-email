/**
 * Parser for AI-generated clustering intelligence responses.
 * Validates untrusted AI output using Zod.
 * Pure function — no I/O, no side effects.
 */
import { z } from "zod";
import { stripCodeFences } from "./utils";

const clusterGroupSchema = z.object({
  caseTitle: z.string().min(1).max(100),
  emailIds: z.array(z.string()).min(1),
  reasoning: z.string(),
  isRecurring: z.boolean(),
  recurringPattern: z.enum(["daily", "weekly", "biweekly", "monthly"]).nullable(),
});

const configOverridesSchema = z.object({
  mergeThreshold: z.number().nullable(),
  subjectMatchScore: z.number().nullable(),
  actorAffinityScore: z.number().nullable(),
  timeDecayFreshDays: z.number().nullable(),
  reasoning: z.string(),
});

const clusteringIntelligenceSchema = z.object({
  groups: z.array(clusterGroupSchema),
  configOverrides: configOverridesSchema,
  excludeSuggestions: z.array(z.string()),
  excludeReasoning: z.string().nullable(),
});

export type ClusteringIntelligenceResult = z.infer<typeof clusteringIntelligenceSchema>;
export type ClusterGroup = z.infer<typeof clusterGroupSchema>;

/**
 * Parses and validates an AI-generated clustering intelligence response.
 */
export function parseClusteringIntelligenceResponse(raw: string): ClusteringIntelligenceResult {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse clustering intelligence response as JSON: ${cleaned.slice(0, 200)}...`,
    );
  }

  const result = clusteringIntelligenceSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid clustering intelligence response:\n${issues}`);
  }

  return result.data;
}
