import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { storeGmailTokens } from "@/lib/services/gmail-tokens";
import { storeTokensSchema } from "@/lib/validation/auth";
import { ForbiddenError, ValidationError } from "@denim/types";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();
    const parsed = storeTokensSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const { providerToken, providerRefreshToken } = parsed.data;

    // Validate token ownership via Google tokeninfo
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(providerToken)}`,
    );

    if (!tokenInfoRes.ok) {
      throw new ForbiddenError("Invalid Google token");
    }

    const tokenInfo = await tokenInfoRes.json();

    // Verify scope includes gmail.readonly
    const scopes: string = tokenInfo.scope ?? "";
    if (!scopes.includes("gmail.readonly")) {
      throw new ForbiddenError("Gmail permissions missing, please reconnect.");
    }

    await storeGmailTokens(userId, tokenInfo.email ?? "", {
      access_token: providerToken,
      refresh_token: providerRefreshToken,
      expiry_date: Date.now() + (Number(tokenInfo.expires_in) || 3600) * 1000,
      scope: scopes,
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
