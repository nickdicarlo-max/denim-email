import { callClaude } from "@/lib/ai/client";
import { logger } from "@/lib/logger";
import { InterviewInputSchema, validateInput } from "@/lib/validation/interview";
import { buildHypothesisPrompt, parseHypothesisResponse } from "@denim/ai";
import type { InterviewInput, SchemaHypothesis } from "@denim/types";
import { ExternalAPIError } from "@denim/types";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";

/**
 * Generate a schema hypothesis from interview input.
 * Validates input, builds prompt via @denim/ai, calls Claude, and parses the response.
 *
 * validateHypothesis and finalizeSchema are Phase 2.
 */
export async function generateHypothesis(
  input: InterviewInput,
  options?: { userId?: string },
): Promise<SchemaHypothesis> {
  const start = Date.now();
  const operation = "generateHypothesis";

  logger.info({ service: "interview", operation, userId: options?.userId });

  // Validate input
  const validated = validateInput(InterviewInputSchema, input);

  // Build prompt (pure function from @denim/ai)
  const prompt = buildHypothesisPrompt(validated);

  // Call Claude via AI client wrapper
  const result = await callClaude({
    model: DEFAULT_MODEL,
    system: prompt.system,
    user: prompt.user,
    userId: options?.userId,
    operation,
  });

  // Parse response (pure function from @denim/ai)
  let hypothesis: SchemaHypothesis;
  try {
    hypothesis = parseHypothesisResponse(result.content);
  } catch (error) {
    throw new ExternalAPIError(
      `Failed to parse hypothesis response: ${error instanceof Error ? error.message : String(error)}`,
      "claude",
      result.content,
    );
  }

  const durationMs = Date.now() - start;
  logger.info({
    service: "interview",
    operation: `${operation}.complete`,
    userId: options?.userId,
    durationMs,
    domain: hypothesis.domain,
    entityCount: hypothesis.entities.length,
    tagCount: hypothesis.tags.length,
  });

  return hypothesis;
}
