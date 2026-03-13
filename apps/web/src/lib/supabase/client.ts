import { createClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client for auth flows and real-time subscriptions.
 * Uses anon key only. RLS enforces data access.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }
  return createClient(url, key);
}
