/**
 * Parser for AI-generated clustering calibration responses.
 * Validates untrusted AI output using Zod.
 * Pure function — no I/O, no side effects.
 */
import type { CalibrationResult } from "@denim/types";
import { z } from "zod";
import { stripCodeFences } from "./utils";

const tunedConfigSchema = z.object({
  mergeThreshold: z.number().positive(),
  subjectMatchScore: z.number().positive(),
  actorAffinityScore: z.number().positive(),
  timeDecayFreshDays: z.number().positive(),
});

const discriminatorEntrySchema = z.object({
  words: z.record(z.string(), z.number().min(0).max(1)),
  mergedAway: z.array(z.string()),
});

const calibrationResultSchema = z.object({
  tunedConfig: tunedConfigSchema,
  discriminatorVocabulary: z.record(z.string(), discriminatorEntrySchema),
  reasoning: z.string(),
});

export type { CalibrationResult };

/**
 * Parses and validates an AI-generated clustering calibration response.
 */
export function parseClusteringCalibrationResponse(raw: string): CalibrationResult {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse clustering calibration response as JSON: ${cleaned.slice(0, 200)}...`,
    );
  }

  const result = calibrationResultSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid clustering calibration response:\n${issues}`);
  }

  return result.data;
}
