/**
 * POST /api/auth/store-tokens — manual token-upload fallback.
 *
 * When the user has an access_token (e.g. from the Google OAuth Playground
 * during dev, or a future re-connect UX) but didn't come through the
 * Supabase OAuth callback, this route validates the token against Google's
 * `/oauth2/tokeninfo` endpoint and then persists via the shared
 * `storeCredentials` API.
 *
 * Converges onto the single credential-storage path (issue #105 step 5):
 * no more bespoke `storeGmailTokens` call. Scope validation lives inside
 * `storeCredentials`, which throws a typed `GmailCredentialError` mapped
 * by `handleApiError` to 401 if `gmail.readonly` is missing.
 */
import { ForbiddenError, ValidationError } from "@denim/types";
import { NextResponse } from "next/server";
import { GoogleTokenInfoResponseSchema, storeCredentials } from "@/lib/gmail/credentials";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { storeTokensSchema } from "@/lib/validation/auth";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();
    const parsedBody = storeTokensSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues[0]?.message ?? "Invalid input");
    }
    const { providerToken, providerRefreshToken } = parsedBody.data;

    // Validate token ownership + scope via Google's tokeninfo endpoint.
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(providerToken)}`,
    );
    if (!tokenInfoRes.ok) {
      throw new ForbiddenError("Invalid Google token");
    }

    // Zod-parse tokeninfo response at the trust boundary (issue #105 step 1
    // pattern). Any shape drift surfaces as ValidationError here, not as
    // an untyped runtime error inside storeCredentials.
    const parsedInfo = GoogleTokenInfoResponseSchema.safeParse(await tokenInfoRes.json());
    if (!parsedInfo.success) {
      throw new ValidationError(
        `Unexpected tokeninfo response shape: ${parsedInfo.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    const { scope, email, expires_in } = parsedInfo.data;

    await storeCredentials({
      userId,
      email: email ?? "",
      accessToken: providerToken,
      refreshToken: providerRefreshToken,
      expiresInSeconds: expires_in,
      grantedScopes: scope,
      verificationSource: "google_tokeninfo",
    });

    logger.info({
      service: "auth",
      operation: "storeTokens.fallback",
      userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, {
      service: "auth",
      operation: "storeTokens",
      userId,
    });
  }
});
