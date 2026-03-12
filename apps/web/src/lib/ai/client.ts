/**
 * Thin wrappers for Claude and Gemini API calls.
 * All AI calls go through these wrappers for retry, backoff, and cost logging.
 *
 * Phase 0: Placeholder structure. AI SDKs installed in Phase 1.
 */

import { logger } from "@/lib/logger";
import { ExternalAPIError } from "@denim/types";
import { callWithRetry } from "./retry";

export interface AICallOptions {
  model: string;
  system: string;
  user: string;
  schemaId?: string;
  userId?: string;
  operation: string;
}

export interface AICallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

async function callAI(
  provider: "claude" | "gemini",
  options: AICallOptions,
): Promise<AICallResult> {
  const start = Date.now();
  const { model, schemaId, userId, operation } = options;

  logger.info({
    service: "ai-client",
    operation: `${provider}.${operation}`,
    schemaId,
    userId,
    model,
  });

  try {
    const result = await callWithRetry(async (): Promise<Omit<AICallResult, "latencyMs">> => {
      // Phase 1: Replace with actual SDK calls
      throw new ExternalAPIError(
        `${provider} SDK not installed yet. Install in Phase 1.`,
        provider,
      );
    });

    const latencyMs = Date.now() - start;

    logger.info({
      service: "ai-client",
      operation: `${provider}.${operation}.complete`,
      schemaId,
      userId,
      model,
      durationMs: latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });

    return { ...result, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - start;
    logger.error({
      service: "ai-client",
      operation: `${provider}.${operation}.error`,
      schemaId,
      userId,
      model,
      durationMs: latencyMs,
      error,
    });
    throw error;
  }
}

/**
 * Call Claude API with retry and logging.
 * SDK will be installed in Phase 1.
 */
export async function callClaude(options: AICallOptions): Promise<AICallResult> {
  return callAI("claude", options);
}

/**
 * Call Gemini API with retry and logging.
 * SDK will be installed in Phase 1.
 */
export async function callGemini(options: AICallOptions): Promise<AICallResult> {
  return callAI("gemini", options);
}
