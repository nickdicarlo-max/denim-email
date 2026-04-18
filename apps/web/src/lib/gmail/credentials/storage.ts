/**
 * Internal storage layer for the credentials module.
 *
 * Owns:
 *   - The encrypted blob schema (what lives in `user.googleTokens`)
 *   - Encrypt / decrypt via the existing AES-GCM primitives in `lib/gmail/tokens.ts`
 *   - Optimistic-lock refresh against Google's /token endpoint
 *
 * Public API is via `service.ts` — nothing outside `credentials/` should import
 * from this file. All write paths convert raw primitives to typed failures
 * before propagating.
 */
import { credentialFailure, GmailCredentialError } from "@denim/types";
import { z } from "zod";
import { decryptTokens, encryptTokens } from "@/lib/gmail/tokens";
import { prisma } from "@/lib/prisma";
import { GoogleTokenErrorResponseSchema, GoogleTokenRefreshResponseSchema } from "./parsers";

/**
 * Shape of the JSON blob stored (AES-GCM encrypted) in `user.googleTokens`.
 * Kept in lock-step with the pre-refactor `StoredTokensSchema` in the
 * legacy `lib/services/gmail-tokens.ts` so both modules can read the same
 * on-disk rows during the migration window.
 */
export const StoredTokenBlobSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().default(""),
  expiry_date: z.number().positive(),
  scope: z.string().min(1),
});

export type StoredTokenBlob = z.infer<typeof StoredTokenBlobSchema>;

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_MAX_RETRIES = 3;
const REFRESH_BASE_DELAY_MS = 1000;

/**
 * Decrypt an on-disk blob and Zod-validate its shape. Any malformed or
 * undecryptable blob becomes a `decrypt_failed` credential failure — the
 * only remedy is re-auth.
 */
export function parseStoredBlob(encrypted: string): StoredTokenBlob {
  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptTokens(encrypted);
  } catch {
    throw new GmailCredentialError(
      "Stored Gmail credentials could not be decrypted",
      credentialFailure("decrypt_failed"),
    );
  }

  const parsed = StoredTokenBlobSchema.safeParse(decrypted);
  if (!parsed.success) {
    throw new GmailCredentialError(
      "Stored Gmail credentials are malformed",
      credentialFailure("decrypt_failed"),
    );
  }
  return parsed.data;
}

export function encryptBlob(blob: StoredTokenBlob): string {
  return encryptTokens(blob);
}

export function isTokenFresh(blob: StoredTokenBlob, now = Date.now()): boolean {
  return blob.expiry_date > now + EXPIRY_BUFFER_MS;
}

/**
 * Fetch with exponential backoff. Non-2xx responses are returned to the
 * caller; only network/connection errors trigger retry.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = REFRESH_MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt === maxRetries) {
        throw new GmailCredentialError(
          `Google /token endpoint unreachable after ${maxRetries + 1} attempts: ${
            err instanceof Error ? err.message : String(err)
          }`,
          credentialFailure("refresh_failed"),
        );
      }
      const delay = REFRESH_BASE_DELAY_MS * 3 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Unreachable given the throw above, but satisfies TS.
  throw new GmailCredentialError(
    "Unreachable: fetchWithRetry exit",
    credentialFailure("refresh_failed"),
  );
}

/**
 * Refresh the access token via Google's /token endpoint and persist with
 * optimistic locking. On `invalid_grant` we NULL the row (tombstone) and
 * throw `revoked`. On other error responses we throw `refresh_failed`.
 *
 * Optimistic lock: the UPDATE only commits if the on-disk blob still
 * matches the one we read (AES-GCM IVs are random, so we compare against
 * the original ciphertext, not a re-encrypt).
 */
export async function refreshAndPersist(
  userId: string,
  originalEncrypted: string,
  blob: StoredTokenBlob,
): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GmailCredentialError(
      "Google OAuth credentials not configured",
      credentialFailure("refresh_failed"),
    );
  }
  if (!blob.refresh_token) {
    // A blob without a refresh_token cannot self-heal — user must re-auth.
    throw new GmailCredentialError(
      "Stored Gmail credentials have no refresh token",
      credentialFailure("refresh_failed"),
    );
  }

  const response = await fetchWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: blob.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const parsedError = GoogleTokenErrorResponseSchema.safeParse(safeJsonParse(bodyText));
    const errCode = parsedError.success ? parsedError.data.error : "";

    // `invalid_grant` means the refresh token is permanently dead — tombstone.
    if (response.status === 400 && errCode === "invalid_grant") {
      await prisma.user.update({
        where: { id: userId },
        data: { googleTokens: null },
      });
      throw new GmailCredentialError(
        "Gmail access revoked or refresh token expired",
        credentialFailure("revoked"),
      );
    }

    throw new GmailCredentialError(
      `Google /token endpoint returned ${response.status}: ${errCode || bodyText.slice(0, 200)}`,
      credentialFailure("refresh_failed"),
    );
  }

  const parsedBody = GoogleTokenRefreshResponseSchema.safeParse(
    safeJsonParse(await response.text()),
  );
  if (!parsedBody.success) {
    throw new GmailCredentialError(
      "Google /token endpoint returned an unexpected shape",
      credentialFailure("refresh_failed"),
    );
  }

  const data = parsedBody.data;
  const next: StoredTokenBlob = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? blob.refresh_token,
    expiry_date: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
  const nextEncrypted = encryptBlob(next);

  const updated = await prisma.$executeRaw`
    UPDATE users SET "googleTokens" = ${nextEncrypted}, "updatedAt" = NOW()
    WHERE id = ${userId} AND "googleTokens" = ${originalEncrypted}
  `;

  if (updated === 0) {
    // Another request refreshed concurrently. Re-read and return whatever
    // won the race. If the row is now absent, the race lost to a revoke.
    const fresh = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleTokens: true },
    });
    if (!fresh?.googleTokens) {
      throw new GmailCredentialError(
        "Gmail credentials were cleared during refresh",
        credentialFailure("absent"),
      );
    }
    return parseStoredBlob(fresh.googleTokens).access_token;
  }

  return next.access_token;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Upsert the user row with an encrypted blob. Used only by the
 * `storeCredentials` public API. Keeps the raw Prisma call isolated so
 * the service module stays focused on validation + typed-error surfacing.
 */
export async function upsertEncryptedBlob(
  userId: string,
  email: string,
  blob: StoredTokenBlob,
): Promise<void> {
  const encrypted = encryptBlob(blob);
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, email, googleTokens: encrypted },
    update: { googleTokens: encrypted },
  });
}

export async function readEncryptedBlob(userId: string): Promise<string | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleTokens: true },
  });
  return row?.googleTokens ?? null;
}

export async function nullifyBlob(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { googleTokens: null },
  });
}
