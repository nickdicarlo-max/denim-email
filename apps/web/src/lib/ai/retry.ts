/**
 * Retry helper for AI API calls with exponential backoff.
 * Handles 429 (rate limit) responses by respecting retry-after headers.
 */
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

      const status = (error as { status?: number })?.status;
      const retryAfter = (error as { headers?: Record<string, string> })?.headers?.["retry-after"];

      const isRateLimit = status === 429;
      const delay = isRateLimit
        ? Number.parseInt(retryAfter || "5", 10) * 1000
        : baseDelayMs * 3 ** attempt;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}
