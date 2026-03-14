import { decryptTokens, encryptTokens } from "@/lib/gmail/tokens";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { AuthError, ExternalAPIError } from "@denim/types";
import { z } from "zod";

const StoredTokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().default(""),
  expiry_date: z.number(),
  scope: z.string(),
});

type StoredTokens = z.infer<typeof StoredTokensSchema>;

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_MAX_RETRIES = 3;
const REFRESH_BASE_DELAY_MS = 1000;

/**
 * Store encrypted Gmail OAuth tokens for a user.
 * Upserts the User row (creates if first OAuth, updates if re-auth).
 * Validates scope includes gmail.readonly before storing.
 */
export async function storeGmailTokens(
  userId: string,
  email: string,
  tokens: StoredTokens,
): Promise<void> {
  if (!tokens.scope.includes("gmail.readonly")) {
    throw new AuthError("Gmail permissions missing, please reconnect.");
  }

  const encrypted = encryptTokens(tokens);

  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email,
      googleTokens: encrypted,
    },
    update: {
      googleTokens: encrypted,
    },
  });

  logger.info({
    service: "gmail-tokens",
    operation: "storeGmailTokens",
    userId,
  });
}

/**
 * Parse and validate decrypted token blob.
 * Throws AuthError if the blob is malformed.
 */
function parseTokens(raw: string): StoredTokens {
  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptTokens(raw);
  } catch {
    throw new AuthError("Gmail access invalid, please reconnect.");
  }

  const parsed = StoredTokensSchema.safeParse(decrypted);
  if (!parsed.success) {
    throw new AuthError("Gmail access invalid, please reconnect.");
  }
  return parsed.data;
}

/**
 * Get a valid Gmail access token for a user.
 * Decrypts stored tokens, refreshes if expired, returns access_token.
 */
export async function getValidGmailToken(userId: string): Promise<string> {
  // Dev bypass
  if (process.env.BYPASS_AUTH === "true") {
    const devToken = process.env.DEV_GMAIL_TOKEN;
    if (devToken) return devToken;
    throw new AuthError("BYPASS_AUTH is true but DEV_GMAIL_TOKEN is not set");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleTokens: true },
  });

  if (!user?.googleTokens) {
    throw new AuthError("Gmail not connected. Please connect Gmail first.");
  }

  const storedEncrypted = user.googleTokens;
  const tokens = parseTokens(storedEncrypted);

  // Token still valid (with 5-minute buffer)
  if (tokens.expiry_date > Date.now() + EXPIRY_BUFFER_MS) {
    return tokens.access_token;
  }

  // Token expired — refresh if we have a refresh token
  if (!tokens.refresh_token) {
    throw new AuthError("Gmail session expired, please reconnect.");
  }
  return refreshAndStore(userId, storedEncrypted, tokens);
}

/**
 * Fetch with retry and exponential backoff.
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
        throw new ExternalAPIError("Google API unavailable during token refresh", "google", err);
      }
      const delay = REFRESH_BASE_DELAY_MS * 3 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new ExternalAPIError("Unreachable", "google");
}

/**
 * Refresh the Google access token using the refresh token.
 * Uses optimistic locking: only writes if the stored blob hasn't changed.
 */
async function refreshAndStore(
  userId: string,
  originalEncrypted: string,
  tokens: StoredTokens,
): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new ExternalAPIError("Google OAuth credentials not configured", "google");
  }

  const startMs = Date.now();
  logger.info({
    service: "gmail-tokens",
    operation: "refreshToken",
    userId,
  });

  const response = await fetchWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // 400 with "invalid_grant" means refresh token was revoked
    if (response.status === 400 && body.includes("invalid_grant")) {
      // Clear the invalid tokens
      await prisma.user.update({
        where: { id: userId },
        data: { googleTokens: null },
      });
      throw new AuthError("Gmail access revoked, please reconnect.");
    }
    throw new ExternalAPIError(`Token refresh failed (${response.status})`, "google", body);
  }

  const data = await response.json();
  const newTokens: StoredTokens = {
    access_token: data.access_token,
    // Google may rotate the refresh token
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? tokens.scope,
  };

  const newEncrypted = encryptTokens(newTokens);

  // Optimistic lock: only update if the stored blob hasn't changed since we read it.
  // Compare against the original encrypted string we read from DB (not re-encrypted,
  // since AES-GCM uses random IVs so re-encrypting the same data gives different output).
  const updated = await prisma.$executeRaw`
    UPDATE users SET "googleTokens" = ${newEncrypted}, "updatedAt" = NOW()
    WHERE id = ${userId} AND "googleTokens" = ${originalEncrypted}
  `;

  if (updated === 0) {
    // Another request already refreshed — re-read the fresh token
    const freshUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleTokens: true },
    });
    if (!freshUser?.googleTokens) {
      throw new AuthError("Gmail not connected. Please connect Gmail first.");
    }
    return parseTokens(freshUser.googleTokens).access_token;
  }

  logger.info({
    service: "gmail-tokens",
    operation: "refreshToken.complete",
    userId,
    durationMs: Date.now() - startMs,
  });

  return newTokens.access_token;
}

/**
 * Clear stored Gmail tokens (disconnect / account deletion).
 */
export async function clearGmailTokens(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { googleTokens: null },
  });

  logger.info({
    service: "gmail-tokens",
    operation: "clearGmailTokens",
    userId,
  });
}
