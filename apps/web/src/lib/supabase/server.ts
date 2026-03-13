import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client with service role key.
 * Use for admin operations (token storage, user management).
 * NEVER expose to client code.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase service role configuration");
  }
  return createClient(url, key);
}

/**
 * Server-side Supabase client authenticated as a specific user.
 * Pass the user's JWT from the Authorization header.
 */
export function createAuthenticatedClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
