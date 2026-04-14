/**
 * Races a promise against a timer. On timeout, throws a descriptive error
 * that names the operation and duration so test output is never ambiguous.
 *
 * Usage:
 *   await withTimeout(api.post("/api/onboarding/start", input), 15_000, "POST /api/onboarding/start")
 *
 * On timeout:
 *   Error: TIMEOUT: POST /api/onboarding/start did not respond within 15s
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`TIMEOUT: ${label} did not respond within ${ms / 1000}s`)),
      ms,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timerId!);
  }
}
