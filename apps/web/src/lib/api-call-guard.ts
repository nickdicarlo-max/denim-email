const PREFIX = "denim_api_calls_";
const MAX_CALLS = 20;

/**
 * Per-session API call counter. Returns false if the endpoint
 * has been called MAX_CALLS+ times this session (safety valve).
 */
export function checkAndIncrementCallCount(endpoint: string): boolean {
  try {
    const key = `${PREFIX}${endpoint}`;
    const count = Number(sessionStorage.getItem(key) ?? "0");
    if (count >= MAX_CALLS) return false;
    sessionStorage.setItem(key, String(count + 1));
    return true;
  } catch {
    return true;
  }
}
