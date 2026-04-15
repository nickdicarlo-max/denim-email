/**
 * Parser for AI-generated email extraction responses.
 * Validates untrusted AI output against the ExtractionResult shape using Zod.
 * Pure function — no I/O, no side effects.
 */
import type { ExtractionResult } from "@denim/types";
import { z } from "zod";
import { stripCodeFences } from "./utils";

const detectedEntitySchema = z.object({
  name: z.string(),
  type: z.enum(["PRIMARY", "SECONDARY"]),
  confidence: z.number().min(0).max(1),
});

const extractionResultSchema = z.object({
  summary: z.string().min(10).max(500),
  tags: z.array(z.string()),
  extractedData: z.record(z.string(), z.unknown()),
  detectedEntities: z.array(detectedEntitySchema),
  isInternal: z.boolean(),
  language: z.string().nullable(),
  relevanceScore: z.number().min(0).max(1).default(1.0),
  relevanceEntity: z.string().nullable().default(null),
});

/**
 * Batch extraction schema: an array of per-email results, each tagged with
 * its input index so ordering can be recovered even if the model reorders.
 */
export const BatchExtractionSchema = z.array(
  extractionResultSchema.extend({ index: z.number().int().nonnegative() }),
);

/**
 * Parses and validates an AI-generated extraction response.
 * Accepts a raw JSON string (optionally wrapped in markdown code fences).
 * Returns a validated ExtractionResult or throws a descriptive error.
 */
export function parseExtractionResponse(raw: string): ExtractionResult {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse extraction response as JSON: ${cleaned.slice(0, 200)}...`,
    );
  }

  const result = extractionResultSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid extraction response:\n${issues}`);
  }

  return result.data as ExtractionResult;
}

/**
 * Parses and validates an AI-generated *batch* extraction response.
 *
 * Expects a JSON array of extraction results, each carrying an `index`
 * field identifying its input position. Results are sorted by `index` and
 * the `index` is stripped from the returned objects, yielding a plain
 * array of `ExtractionResult` in the original input order.
 *
 * Throws if:
 *   - JSON parsing fails
 *   - any element fails validation
 *   - the array length does not match `expectedCount`
 */
export function parseBatchExtraction(
  raw: string,
  expectedCount: number,
): ExtractionResult[] {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse batch extraction response as JSON: ${cleaned.slice(0, 200)}...`,
    );
  }

  const result = BatchExtractionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid batch extraction response:\n${issues}`);
  }

  if (result.data.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} extraction results, got ${result.data.length}`,
    );
  }

  return result.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(({ index: _index, ...rest }) => rest as ExtractionResult);
}
