/**
 * Parser for AI-generated discovery intelligence responses.
 * Validates untrusted AI output against the expected shape using Zod.
 * Pure function — no I/O, no side effects.
 */
import { z } from "zod";
import { stripCodeFences } from "./utils";

const relevantQuerySchema = z.object({
  query: z.string().min(1),
  reason: z.string(),
  entityName: z.string().nullable(),
});

const discoveryIntelligenceResultSchema = z.object({
  relevantQueries: z.array(relevantQuerySchema),
  excludeDomains: z.array(z.string()),
  reasoning: z.string(),
});

export type DiscoveryIntelligenceResult = z.infer<typeof discoveryIntelligenceResultSchema>;

/**
 * Parses and validates an AI-generated discovery intelligence response.
 * Accepts a raw JSON string (optionally wrapped in markdown code fences).
 * Returns a validated result or throws a descriptive error.
 */
export function parseDiscoveryIntelligenceResponse(raw: string): DiscoveryIntelligenceResult {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse discovery intelligence response as JSON: ${cleaned.slice(0, 200)}...`,
    );
  }

  const result = discoveryIntelligenceResultSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid discovery intelligence response:\n${issues}`);
  }

  return result.data;
}
