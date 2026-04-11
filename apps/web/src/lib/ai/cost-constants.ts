/**
 * Model pricing (USD per token). Single source of truth.
 *
 * When updating these values, verify against the current provider pricing pages:
 * - Claude: https://www.anthropic.com/pricing
 * - Gemini: https://ai.google.dev/pricing
 */
export const MODEL_PRICING = {
  "gemini-2.5-flash": {
    inputCostPerToken: 0.00000015,
    outputCostPerToken: 0.0000006,
  },
  "claude-sonnet-4-6": {
    inputCostPerToken: 3 / 1_000_000,
    outputCostPerToken: 15 / 1_000_000,
  },
} as const;

export type ModelId = keyof typeof MODEL_PRICING;
