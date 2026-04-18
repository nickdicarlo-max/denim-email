/**
 * GmailCredentials — public API of the bounded context.
 *
 * This module is the SOLE owner of the `user.googleTokens` column. Every
 * read and every write MUST go through these functions. Callers outside
 * `credentials/` are forbidden from importing `lib/gmail/tokens.ts`
 * (encryption primitives) or touching the `googleTokens` column directly.
 *
 * Public surface:
 *   - `getCredentialRecord(userId)`  -> typed `CredentialRecord` (never throws)
 *   - `getAccessToken(userId)`       -> `string` OR throws `GmailCredentialError`
 *   - `storeCredentials(input)`      -> persists with input validation
 *   - `invalidateCredentials(...)`   -> explicit disconnect path
 *
 * Error contract:
 *   - All typed failure paths throw `GmailCredentialError` carrying a
 *     `CredentialFailure` (reason + remedy). Never string-matched.
 *   - The middleware `handleApiError` maps `GmailCredentialError` -> 401
 *     with `{ type: "GMAIL_CREDENTIAL_ERROR", credentialFailure }` so UI
 *     branching is on a typed field, not error-message text.
 */
import { type CredentialRecord, credentialFailure, GmailCredentialError } from "@denim/types";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { readDevBypass } from "./dev-bypass";
import {
  encryptBlob,
  isTokenFresh,
  nullifyBlob,
  parseStoredBlob,
  readEncryptedBlob,
  refreshAndPersist,
  type StoredTokenBlob,
  upsertEncryptedBlob,
} from "./storage";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read-side — returns what's in the DB in typed form. Never throws.
 * Consumers: `/api/onboarding/start` pre-flight, UI remedy logic.
 */
export async function getCredentialRecord(userId: string): Promise<CredentialRecord> {
  const encrypted = await readEncryptedBlob(userId);
  if (!encrypted) return { type: "absent" };

  let blob: StoredTokenBlob;
  try {
    blob = parseStoredBlob(encrypted);
  } catch {
    // Malformed / undecryptable — treated as absent for the purposes of a
    // pre-flight check. Callers that want the remedy classification should
    // use `getAccessToken` which throws a typed `decrypt_failed`.
    return { type: "absent" };
  }

  return {
    type: "present",
    hasRefreshToken: blob.refresh_token.length > 0,
    grantedScopes: blob.scope.split(" ").filter((s) => s.length > 0),
    expiresAt: new Date(blob.expiry_date).toISOString(),
  };
}

/**
 * Read-side — returns a valid access token OR throws `GmailCredentialError`.
 * Handles refresh internally. Never exposes `canRefresh` / expiry details
 * to the caller — the contract is strictly "token or typed failure."
 */
export async function getAccessToken(userId: string): Promise<string> {
  const bypass = readDevBypass();
  if (bypass.bypass) return bypass.token ?? "";

  const encrypted = await readEncryptedBlob(userId);
  if (!encrypted) {
    throw new GmailCredentialError("Gmail not connected", credentialFailure("absent"));
  }

  // parseStoredBlob throws `decrypt_failed` on malformed / undecryptable.
  const blob = parseStoredBlob(encrypted);

  if (isTokenFresh(blob)) return blob.access_token;

  // Token is expired. refreshAndPersist throws `revoked` / `refresh_failed`
  // as appropriate, or returns a fresh access_token on success.
  return refreshAndPersist(userId, encrypted, blob);
}

// ---------------------------------------------------------------------------
// Write-side — inputs are Zod-validated at the trust boundary
// ---------------------------------------------------------------------------

/**
 * Shape required to persist new credentials. Zod-validated at function
 * entry — tonight's `tokens.scope.includes is not a function` TypeError
 * becomes a clean `ValidationError` here if any field is mistyped.
 *
 * `grantedScopes` is a ReadonlyArray of strings so the caller can pass
 * what Supabase gave them without worrying about string-vs-array coercion.
 */
export const StoreCredentialsInputSchema = z.object({
  userId: z.string().min(1),
  email: z.string(),
  accessToken: z.string().min(1),
  refreshToken: z.string().default(""),
  /** Seconds until the access token expires. Google default is 3600. */
  expiresInSeconds: z.number().positive().default(3600),
  /**
   * Either a single space-delimited scope string (Google convention) or
   * an array of scope strings. Stored as a single space-delimited string
   * inside the encrypted blob so downstream parsers are unambiguous.
   */
  grantedScopes: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  /**
   * Which boundary produced these credentials. Drives scope verification:
   *   - `supabase_exchange` trusts the scope field as-is (Supabase already
   *     validated the OAuth flow against the Google app config).
   *   - `google_tokeninfo` implies the caller has independently verified
   *     the scope via `https://oauth2.googleapis.com/tokeninfo`.
   */
  verificationSource: z.enum(["supabase_exchange", "google_tokeninfo"]),
});

export type StoreCredentialsInput = z.infer<typeof StoreCredentialsInputSchema>;

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export async function storeCredentials(input: StoreCredentialsInput): Promise<void> {
  // Zod-validate at the boundary. Throws ZodError (mapped to 400 by
  // handleApiError) on any shape mismatch.
  const parsed = StoreCredentialsInputSchema.parse(input);

  const scopeString =
    typeof parsed.grantedScopes === "string"
      ? parsed.grantedScopes
      : parsed.grantedScopes.join(" ");

  if (!scopeString.includes(REQUIRED_SCOPE)) {
    throw new GmailCredentialError(
      `Gmail credentials missing required scope ${REQUIRED_SCOPE}`,
      credentialFailure("scope_insufficient"),
    );
  }

  const blob: StoredTokenBlob = {
    access_token: parsed.accessToken,
    refresh_token: parsed.refreshToken,
    expiry_date: Date.now() + parsed.expiresInSeconds * 1000,
    scope: scopeString,
  };

  // Smoke-test: encrypting + re-parsing here means any encryption-path
  // regression is caught at write time, not on the next read.
  parseStoredBlob(encryptBlob(blob));

  await upsertEncryptedBlob(parsed.userId, parsed.email, blob);

  logger.info({
    service: "gmail-credentials",
    operation: "storeCredentials",
    userId: parsed.userId,
    hasRefreshToken: parsed.refreshToken.length > 0,
    verificationSource: parsed.verificationSource,
  });
}

export async function invalidateCredentials(
  userId: string,
  reason: "revoked" | "cleared",
): Promise<void> {
  await nullifyBlob(userId);
  logger.info({
    service: "gmail-credentials",
    operation: "invalidateCredentials",
    userId,
    reason,
  });
}
