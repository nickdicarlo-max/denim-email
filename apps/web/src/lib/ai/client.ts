/**
 * Thin wrappers for Claude and Gemini API calls.
 * All AI calls go through these wrappers for retry, backoff, and cost logging.
 */

import { logger } from "@/lib/logger";
import Anthropic from "@anthropic-ai/sdk";
import { ExternalAPIError } from "@denim/types";
import { callWithRetry } from "./retry";

// Module-level singleton: reads ANTHROPIC_API_KEY from env automatically
const anthropic = new Anthropic();

export interface AICallOptions {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
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
      if (provider === "claude") {
        const response = await anthropic.messages.create({
          model: options.model,
          max_tokens: options.maxTokens ?? 4096,
          system: options.system,
          messages: [{ role: "user", content: options.user }],
        });

        const textBlock = response.content.find((block) => block.type === "text");
        const content = textBlock && "text" in textBlock ? textBlock.text : "";

        return {
          content,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        };
      }

      // Gemini: Phase 3
      throw new ExternalAPIError(
        "Gemini SDK not integrated yet. Planned for Phase 3.",
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
 */
export async function callClaude(options: AICallOptions): Promise<AICallResult> {
  return callAI("claude", options);
}

/**
 * Call Gemini API with retry and logging.
 * SDK will be integrated in Phase 3.
 */
export async function callGemini(options: AICallOptions): Promise<AICallResult> {
  return callAI("gemini", options);
}
