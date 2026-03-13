import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client for auth flows and real-time subscriptions.
 * Uses anon key only. RLS enforces data access.
 * Uses @supabase/ssr for proper cookie-based session management.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }
  return createSupabaseBrowserClient(url, key);
}
