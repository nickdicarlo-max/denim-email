import { prisma } from "@/lib/prisma";
import { MODEL_PRICING, type ModelId } from "./cost-constants";

export interface AICallCostResult {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
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
  const estimatedCost =
    result.inputTokens * pricing.inputCostPerToken +
    result.outputTokens * pricing.outputCostPerToken;

  await prisma.extractionCost.create({
    data: {
      emailId: options.emailId,
      scanJobId: options.scanJobId ?? null,
      model: options.model,
      operation: options.operation,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCostUsd: estimatedCost,
      latencyMs: result.latencyMs,
    },
  });
}
