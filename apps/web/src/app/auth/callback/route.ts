/**
 * OAuth callback -- decomposed, fail-closed.
 *
 * Handles the redirect from Supabase's Google OAuth flow. Four explicit
 * steps, each with one responsibility and one failure mode:
 *
 *   1. Exchange auth code for a Supabase session.
 *   2. Zod-parse the exchange response at the trust boundary
 *      (SupabaseExchangeDataSchema). If provider_token is missing, the
 *      user's Gmail access CANNOT be stored -- we redirect to an error
 *      page, NOT to the happy path.
 *   3. Persist credentials via `storeCredentials`. Any throw (Zod
 *      validation, scope check, encryption failure) redirects to the
 *      error page with the typed reason in the query string.
 *   4. Route decision (explicit `next`, or dynamic based on existing
 *      schemas).
 *
 * What changed vs. the pre-refactor callback:
 * - No more `try/catch` + `warn` + happy-path-redirect. Every failure
 *   path is user-visible. The 2026-04-18 reconnect loop (Bug 2 class)
 *   is impossible to hit under this structure.
 * - Trust-boundary validation. If Supabase returns an unexpected shape
 *   (e.g. Client Reference wrap, API change, scope denied), we see it
 *   here as a ZodError, not a TypeError five frames deep inside
 *   storage logic.
 * - Typed credential errors. `GmailCredentialError.credentialFailure`
 *   is logged + surfaced in the redirect so downstream UI can render
 *   remedy text instead of string-matching an error message.
 *
 * See issue #105 for the full refactor plan.
 */
import { GmailCredentialError } from "@denim/types";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { SupabaseExchangeDataSchema, storeCredentials } from "@/lib/gmail/credentials";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Supabase SSR client that reads/writes cookies via the request/response
 * objects. Required for PKCE code exchange -- the code_verifier cookie
 * lives here and must be readable by `exchangeCodeForSession`.
 */
function createCallbackSupabaseClient(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  return {
    supabase,
    /** Redirect that carries the auth cookies set during exchange. */
    redirect(url: string) {
      const redirectResponse = NextResponse.redirect(url);
      for (const cookie of response.cookies.getAll()) {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      }
      return redirectResponse;
    },
  };
}

/**
 * Typed error-page redirect. Adds `auth_error=true` and a `reason` code
 * the UI can branch on without string-matching. Optional `detail` carries
 * the `CredentialFailure.reason` when the error came from the credentials
 * module, so a future UI refactor (step 4) can show "Reconnect" vs
 * "Retry" remedy text.
 */
function errorRedirect(origin: string, reason: string, detail?: string): NextResponse {
  const params = new URLSearchParams({ auth_error: "true", reason });
  if (detail) params.set("detail", detail);
  return NextResponse.redirect(`${origin}/?${params.toString()}`);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const explicitNext = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/?auth_error=true&reason=NO_CODE`);
  }

  try {
    const { supabase, redirect } = createCallbackSupabaseClient(request);

    // Step 1 -- exchange code for session.
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logger.error({
        service: "auth",
        operation: "callback.exchangeCode.failed",
        error: { name: error.name, message: error.message },
      });
      return errorRedirect(origin, "EXCHANGE_FAILED");
    }

    // Step 2 -- Zod-validate the exchange response subset we consume.
    // Missing provider_token here = tonight's bug surface. Fail closed.
    const parsed = SupabaseExchangeDataSchema.safeParse(data);
    if (!parsed.success) {
      logger.error({
        service: "auth",
        operation: "callback.exchangeCode.shapeInvalid",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return errorRedirect(origin, "TOKEN_SHAPE_INVALID");
    }

    const { session, user } = parsed.data;

    // Step 3 -- persist credentials. Fail closed on any error.
    try {
      await storeCredentials({
        userId: user.id,
        email: user.email ?? "",
        accessToken: session.provider_token,
        refreshToken: session.provider_refresh_token ?? "",
        expiresInSeconds: 3600,
        grantedScopes: "https://www.googleapis.com/auth/gmail.readonly",
        verificationSource: "supabase_exchange",
      });
      logger.info({
        service: "auth",
        operation: "callback.storeCredentials",
        userId: user.id,
        hasRefreshToken: !!session.provider_refresh_token,
      });
    } catch (err) {
      if (err instanceof GmailCredentialError) {
        logger.error({
          service: "auth",
          operation: "callback.storeCredentials.failed",
          userId: user.id,
          reason: err.credentialFailure.reason,
          message: err.message,
        });
        return errorRedirect(origin, "CREDENTIAL_STORE_FAILED", err.credentialFailure.reason);
      }
      logger.error({
        service: "auth",
        operation: "callback.storeCredentials.unexpected",
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return errorRedirect(origin, "CREDENTIAL_STORE_FAILED");
    }

    // Step 4 -- route decision.
    if (explicitNext) {
      return redirect(`${origin}${explicitNext}`);
    }

    try {
      const schemaCount = await prisma.caseSchema.count({
        where: { userId: user.id, status: { not: "ABANDONED" } },
      });
      const dest = schemaCount > 0 ? "/feed" : "/onboarding/category";
      logger.info({
        service: "auth",
        operation: "callback.dynamicRoute",
        userId: user.id,
        schemaCount,
        destination: dest,
      });
      return redirect(`${origin}${dest}`);
    } catch (routeErr) {
      // Route-lookup failure is non-fatal -- credentials are already stored.
      // Fall back to the onboarding entry page.
      logger.warn({
        service: "auth",
        operation: "callback.dynamicRoute.failed",
        userId: user.id,
        error: routeErr instanceof Error ? routeErr.message : String(routeErr),
      });
      return redirect(`${origin}/onboarding/category`);
    }
  } catch (err) {
    logger.error({
      service: "auth",
      operation: "callback.unexpected",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(`${origin}/?auth_error=true&reason=UNEXPECTED`);
  }
}
