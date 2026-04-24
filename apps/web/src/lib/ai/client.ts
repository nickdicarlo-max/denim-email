/**
 * Thin wrappers for Claude and Gemini API calls.
 * All AI calls go through these wrappers for retry, backoff, and cost logging.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ExternalAPIError } from "@denim/types";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { isCacheActive, maybeServeFromCache, maybeStoreInCache } from "./interceptor";
import { callWithRetry } from "./retry";

// Module-level singleton: reads ANTHROPIC_API_KEY from env automatically
const anthropic = new Anthropic();

// Module-level singleton: reads GOOGLE_AI_API_KEY from env
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

export interface AICallOptions {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  schemaId?: string;
  userId?: string;
  operation: string;
  /**
   * Claude-only. When set, emits the system prompt as a two-part array so
   * the static prefix can be cached via Anthropic prompt caching (#79).
   * Ignored by Gemini. If set, `system` is ignored in favor of these two.
   */
  cacheableSystemPrompt?: { static: string; dynamic: string };
}

export interface AICallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Tokens served from Anthropic prompt cache. Zero for Gemini or cache misses. */
  cacheReadInputTokens: number;
  /** Tokens written to Anthropic prompt cache. Zero for Gemini or when no breakpoint set. */
  cacheCreationInputTokens: number;
  /**
   * True when this result was served from the eval response cache
   * (`AI_RESPONSE_CACHE=fixture`) rather than a fresh provider call.
   * Downstream cost-tracking uses this to tag ExtractionCost rows
   * so first-run vs cached-run diffs are obvious.
   */
  fromCache?: boolean;
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

  // Eval-only cache short-circuit. `maybeServeFromCache` returns null
  // unless AI_RESPONSE_CACHE=fixture is set, so production code paths
  // never observe a cached response.
  if (isCacheActive()) {
    const cached = maybeServeFromCache(provider, options);
    if (cached) {
      logger.info({
        service: "ai-client",
        operation: `${provider}.${operation}.cacheHit`,
        schemaId,
        userId,
        model,
      });
      return { ...cached, fromCache: true, latencyMs: Date.now() - start };
    }
  }

  try {
    const result = await callWithRetry(async (): Promise<Omit<AICallResult, "latencyMs">> => {
      if (provider === "claude") {
        const system = options.cacheableSystemPrompt
          ? [
              {
                type: "text" as const,
                text: options.cacheableSystemPrompt.static,
                cache_control: { type: "ephemeral" as const },
              },
              {
                type: "text" as const,
                text: options.cacheableSystemPrompt.dynamic,
              },
            ]
          : options.system;

        const response = await anthropic.messages.create({
          model: options.model,
          max_tokens: options.maxTokens ?? 4096,
          system,
          messages: [{ role: "user", content: options.user }],
        });

        const textBlock = response.content.find((block) => block.type === "text");
        const content = textBlock && "text" in textBlock ? textBlock.text : "";

        // cache_*_input_tokens are optional in the SDK types; default to 0.
        const usage = response.usage as typeof response.usage & {
          cache_read_input_tokens?: number | null;
          cache_creation_input_tokens?: number | null;
        };

        return {
          content,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        };
      }

      // Gemini
      const geminiModel = genAI.getGenerativeModel({
        model: options.model,
        generationConfig: {
          // @ts-expect-error thinkingConfig not in SDK types yet, but API accepts it
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const response = await geminiModel.generateContent({
        systemInstruction: options.system,
        contents: [{ role: "user", parts: [{ text: options.user }] }],
      });

      const content = response.response.text();
      const usage = response.response.usageMetadata;

      return {
        content,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };
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
      cacheReadInputTokens: result.cacheReadInputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
    });

    const final = { ...result, latencyMs };

    // Persist to eval cache when active. No-op in production (mode=off).
    if (isCacheActive()) {
      maybeStoreInCache(provider, options, final);
    }

    return final;
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
 */
export async function callGemini(options: AICallOptions): Promise<AICallResult> {
  return callAI("gemini", options);
}
