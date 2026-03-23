/**
 * API client helper for integration tests that need to hit HTTP routes.
 * Attaches Bearer token and provides convenience methods.
 */

// Default to port 3000 (Next.js default). Set TEST_BASE_URL in .env.local
// if your dev server runs on a different port (e.g., 3001 when Inngest takes 3000).
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

export function createApiClient(accessToken: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = res.headers.get("content-type")?.includes("application/json")
      ? await res.json()
      : await res.text();

    return { status: res.status, data };
  }

  return {
    get: (path: string) => request("GET", path),
    post: (path: string, body?: unknown) => request("POST", path, body),
    put: (path: string, body?: unknown) => request("PUT", path, body),
    delete: (path: string) => request("DELETE", path),
  };
}
