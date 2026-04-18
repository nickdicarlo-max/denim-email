/**
 * Zod parsers at the external trust boundary.
 *
 * All external responses that feed the credential store MUST pass through
 * these parsers before any business logic touches them. Catches shape drift
 * (tonight's bug) as a clean ValidationError at the boundary instead of a
 * runtime TypeError five levels deep.
 *
 * Two shapes currently:
 *   - Supabase exchange response (`supabase.auth.exchangeCodeForSession`)
 *   - Google OAuth /token response (refresh flow)
 *
 * Both schemas validate only the subset of fields we actually consume.
 * Extra fields pass through — we don't care if Supabase adds new session
 * metadata — but required fields missing or mistyped throw loudly.
 */
import { z } from "zod";

/**
 * Supabase's `exchangeCodeForSession(code)` returns `{ data, error }`.
 * This schema models the success-path `data` subset we depend on.
 *
 * Note: `provider_token` is only present in the initial exchange, not on
 * `getSession()` reads. If it's missing we cannot store Gmail credentials
 * — that's a terminal failure, not a skip.
 */
export const SupabaseExchangeDataSchema = z.object({
  session: z.object({
    provider_token: z.string().min(1, "provider_token is missing from Supabase exchange"),
    provider_refresh_token: z.string().nullable().optional(),
  }),
  user: z.object({
    id: z.string().min(1),
    email: z.string().email().nullable().optional(),
  }),
});

export type SupabaseExchangeData = z.infer<typeof SupabaseExchangeDataSchema>;

/**
 * Google OAuth `/token` endpoint response on a successful refresh.
 * Google may omit `refresh_token` (it's reused from the original grant),
 * may rotate it (new value returned), or may return it unchanged. We
 * preserve whichever Google gives us; callers fall back to the prior
 * refresh_token if omitted.
 */
export const GoogleTokenRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().default(3600),
  scope: z.string().min(1),
  token_type: z.string().optional(),
});

export type GoogleTokenRefreshResponse = z.infer<typeof GoogleTokenRefreshResponseSchema>;

/**
 * Google OAuth `/token` endpoint error response (e.g. `invalid_grant` on
 * a revoked refresh token). Only the `error` field is load-bearing — the
 * full body is still inspected as a string elsewhere for logging.
 */
export const GoogleTokenErrorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

export type GoogleTokenErrorResponse = z.infer<typeof GoogleTokenErrorResponseSchema>;

/**
 * Google `/oauth2/tokeninfo?access_token=...` endpoint response.
 * Used by the manual fallback route at `/api/auth/store-tokens` to
 * validate an externally-supplied access token before persisting.
 *
 * `expires_in` comes back as a stringified integer from Google despite
 * being a numeric field — schema coerces to number.
 */
export const GoogleTokenInfoResponseSchema = z.object({
  scope: z.string().min(1),
  email: z.string().email().optional(),
  expires_in: z.coerce.number().positive().default(3600),
  audience: z.string().optional(),
  user_id: z.string().optional(),
});

export type GoogleTokenInfoResponse = z.infer<typeof GoogleTokenInfoResponseSchema>;
