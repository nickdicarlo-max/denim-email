/**
 * Parser for AI-generated case splitting responses.
 * Validates untrusted AI output using Zod.
 * Pure function — no I/O, no side effects.
 */
import type { CaseSplitResult } from "@denim/types";
import { z } from "zod";
import { stripCodeFences } from "./utils";

const caseSplitDefinitionSchema = z.object({
  caseTitle: z.string().min(1).max(100),
  discriminators: z.array(z.string()).min(1),
  emailIds: z.array(z.string()).min(1),
  reasoning: z.string(),
});

const caseSplitResultSchema = z.object({
  cases: z.array(caseSplitDefinitionSchema),
  catchAllEmailIds: z.array(z.string()),
  reasoning: z.string(),
});

export type { CaseSplitResult };

/**
 * Parses and validates an AI-generated case splitting response.
 */
export function parseCaseSplittingResponse(raw: string): CaseSplitResult {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse case splitting response as JSON: ${cleaned.slice(0, 200)}...`,
    );
  }

  const result = caseSplitResultSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid case splitting response:\n${issues}`);
  }

  return result.data;
}
