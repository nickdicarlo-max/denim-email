/**
 * Retry helper for AI API calls with exponential backoff.
 * Handles 429 (rate limit) responses from both Anthropic and Google AI SDK.
 */

/**
 * Detect rate limit errors from Anthropic (status 429) and Gemini (RESOURCE_EXHAUSTED).
 */
function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 429) return true;
  const message = (error as { message?: string })?.message ?? "";
  return message.includes("429") || message.includes("RESOURCE_EXHAUSTED");
}

/**
 * Extract retry delay from error metadata.
 * Checks retry-after header (Anthropic), Gemini error messages, then falls back
 * to exponential backoff.
 */
function extractRetryDelay(error: unknown, baseDelayMs: number, attempt: number): number {
  // Try standard retry-after header (Anthropic)
  const retryAfter = (error as { headers?: Record<string, string> })?.headers?.[
    "retry-after"
  ];
  if (retryAfter) {
    return Number.parseInt(retryAfter, 10) * 1000;
  }
  // Try Gemini error details
  const message = (error as { message?: string })?.message ?? "";
  const retryMatch = message.match(/retry after (\d+)/i);
  if (retryMatch) {
    return Number.parseInt(retryMatch[1], 10) * 1000;
  }
  // Default exponential backoff
  return baseDelayMs * 3 ** attempt;
}

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (attempt === maxRetries) throw error;

      const delay = isRateLimitError(error)
        ? extractRetryDelay(error, baseDelayMs, attempt)
        : baseDelayMs * 3 ** attempt;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}
