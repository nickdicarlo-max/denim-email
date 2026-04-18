/**
 * Parser for AI-generated case synthesis responses.
 * Validates untrusted AI output against the SynthesisResult shape using Zod.
 * Pure function — no I/O, no side effects.
 */
import type { SynthesisResult } from "@denim/types";
import { z } from "zod";
import { stripCodeFences } from "./utils";

const synthesisActionSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  actionType: z.enum(["TASK", "EVENT", "PAYMENT", "DEADLINE", "RESPONSE"]),
  dueDate: z.string().nullable(),
  eventStartTime: z.string().nullable(),
  eventEndTime: z.string().nullable(),
  eventLocation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  sourceEmailId: z.string().nullable(),
});

const synthesisResultSchema = z.object({
  title: z.string().min(1).max(60),
  emoji: z.string().max(4).optional().default("📋"),
  mood: z.enum(["CELEBRATORY", "POSITIVE", "NEUTRAL", "URGENT", "NEGATIVE"]).default("NEUTRAL"),
  summary: z.object({
    beginning: z.string(),
    middle: z.string(),
    end: z.string(),
  }),
  displayTags: z.array(z.string()).min(0).max(5),
  primaryActor: z
    .object({
      name: z.string(),
      entityType: z.string(),
    })
    .nullable(),
  actions: z.array(synthesisActionSchema),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]),
  urgency: z
    .enum(["IMMINENT", "THIS_WEEK", "UPCOMING", "NO_ACTION", "IRRELEVANT"])
    .default("UPCOMING"),
});

/**
 * Parses and validates an AI-generated synthesis response.
 * Accepts a raw JSON string (optionally wrapped in markdown code fences).
 * Returns a validated SynthesisResult or throws a descriptive error.
 */
export function parseSynthesisResponse(raw: string): SynthesisResult {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse synthesis response as JSON: ${cleaned.slice(0, 200)}...`);
  }

  const result = synthesisResultSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid synthesis response:\n${issues}`);
  }

  return result.data as SynthesisResult;
}
