"use client";

/**
 * Client-side Gmail OAuth entry point.
 *
 * Exports the browser function that kicks off Supabase's Google OAuth flow
 * with the Gmail scopes. Server modules MUST NOT import from this file —
 * Next.js App Router wraps "use client" exports into Client Reference
 * objects when consumed from a server context, which silently breaks any
 * downstream value operations (see the 2026-04-18 `tokens.scope.includes
 * is not a function` bug).
 *
 * Shared constants (like `GMAIL_SCOPES`) live in `../shared/scopes` — both
 * client and server may safely import from there.
 *
 * Boundary enforcement: `biome.json` has a `noRestrictedImports` rule that
 * fails CI if any file under `lib/gmail/credentials`, `lib/inngest`,
 * `app/api`, or server route handlers imports from `lib/gmail/client`.
 */
import type { createBrowserClient } from "@/lib/supabase/client";
import { GMAIL_SCOPES } from "../shared/scopes";

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
