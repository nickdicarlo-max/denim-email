"use client";

import type { createBrowserClient } from "@/lib/supabase/client";

export const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

export function signInWithGmail(
  supabase: ReturnType<typeof createBrowserClient>,
  redirectTo: string,
) {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: GMAIL_SCOPES,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });
}
