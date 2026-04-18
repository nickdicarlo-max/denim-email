"use client";

import type { createBrowserClient } from "@/lib/supabase/client";
import { GMAIL_SCOPES } from "./oauth-scopes";

// Re-export for existing client imports. Server code MUST import from
// `./oauth-scopes` directly — importing this file server-side wraps the
// constant into a Client Reference and breaks `String.prototype.includes`.
export { GMAIL_SCOPES };

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
