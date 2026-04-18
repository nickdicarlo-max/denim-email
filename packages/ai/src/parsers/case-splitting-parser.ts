/**
 * Parser for AI-generated case splitting responses.
 * Validates untrusted AI output using Zod.
 * Pure function — no I/O, no side effects.
 *
 * Resilience contract: a single malformed sub-case must not nuke the whole
 * stage. Valid cases are kept; invalid cases have their emailIds rerouted to
 * catchAllEmailIds so downstream discriminator matching can reassign them.
 * Only a structurally broken outer response (non-object, missing `cases`
 * array, unparseable JSON) throws.
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

const caseSplitEnvelopeSchema = z.object({
  cases: z.array(z.unknown()),
  catchAllEmailIds: z.array(z.string()).default([]),
  reasoning: z.string().default(""),
});

export type { CaseSplitResult };

/**
 * Parses and validates an AI-generated case splitting response.
 *
 * Resilient parsing: individual cases that fail validation are dropped and
 * their email IDs are pushed into catchAllEmailIds. Throws only when the
 * response isn't valid JSON or lacks the outer envelope shape.
 */
export function parseCaseSplittingResponse(raw: string): CaseSplitResult {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse case splitting response as JSON: ${cleaned.slice(0, 200)}...`);
  }

  const envelope = caseSplitEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    const issues = envelope.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid case splitting response:\n${issues}`);
  }

  const validCases: CaseSplitResult["cases"] = [];
  const salvagedEmailIds: string[] = [];

  for (const rawCase of envelope.data.cases) {
    const result = caseSplitDefinitionSchema.safeParse(rawCase);
    if (result.success) {
      validCases.push(result.data);
      continue;
    }
    // Salvage any string email IDs from the rejected case so they can be
    // reassigned downstream via discriminator matching.
    const maybe = rawCase as { emailIds?: unknown };
    if (Array.isArray(maybe?.emailIds)) {
      for (const id of maybe.emailIds) {
        if (typeof id === "string") salvagedEmailIds.push(id);
      }
    }
  }

  return {
    cases: validCases,
    catchAllEmailIds: [...envelope.data.catchAllEmailIds, ...salvagedEmailIds],
    reasoning: envelope.data.reasoning,
  };
}
