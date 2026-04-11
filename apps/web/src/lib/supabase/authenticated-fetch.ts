"use client";

import { createBrowserClient } from "./client";

/**
 * Fetch with automatic Supabase auth. Mirrors the native fetch signature
 * but injects the Authorization header from the current session.
 * Throws if the user is not authenticated.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const supabase = createBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }
  return fetch(input, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}
