import { prisma } from "@/lib/prisma";
import { MODEL_PRICING, type ModelId } from "./cost-constants";

export interface AICallCostResult {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /**
   * When true, the AICallResult was served from the eval response cache.
   * The row is still written for accounting visibility, but with a
   * `.cached` operation suffix and $0 cost so first-run vs cached-run
   * diffs are trivial.
   */
  fromCache?: boolean;
}

export interface LogAICostOptions {
  emailId: string;
  scanJobId?: string | null;
  model: ModelId;
  operation: string;
}

/**
 * Compute cost from token counts and persist an ExtractionCost row.
 * Single write point for all AI call cost tracking.
 */
export async function logAICost(
  result: AICallCostResult,
  options: LogAICostOptions,
): Promise<void> {
  const pricing = MODEL_PRICING[options.model];
  const estimatedCost = result.fromCache
    ? 0
    : result.inputTokens * pricing.inputCostPerToken +
      result.outputTokens * pricing.outputCostPerToken;
  const operation = result.fromCache ? `${options.operation}.cached` : options.operation;

  await prisma.extractionCost.create({
    data: {
      emailId: options.emailId,
      scanJobId: options.scanJobId ?? null,
      model: options.model,
      operation,
      inputTokens: result.fromCache ? 0 : result.inputTokens,
      outputTokens: result.fromCache ? 0 : result.outputTokens,
      estimatedCostUsd: estimatedCost,
      latencyMs: result.latencyMs,
    },
  });
}
