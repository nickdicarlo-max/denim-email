import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { storeGmailTokens } from "@/lib/services/gmail-tokens";

/**
 * Create a Supabase client that reads/writes cookies via the request/response objects.
 * This is the official Supabase SSR pattern for Route Handlers and is required
 * for PKCE code exchange (the code verifier cookie must be readable).
 */
function createCallbackSupabaseClient(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }

  // We'll set this once we know the redirect destination
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Update request cookies (so subsequent reads see the new values)
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // Update response cookies (so the browser gets the new values)
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  return {
    supabase,
    /** Build a redirect response that carries the auth cookies set during exchange. */
    redirect(url: string) {
      const redirectResponse = NextResponse.redirect(url);
      // Copy all cookies from the working response to the redirect
      for (const cookie of response.cookies.getAll()) {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      }
      return redirectResponse;
    },
  };
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const explicitNext = searchParams.get("next");

  if (code) {
    try {
      const { supabase, redirect } = createCallbackSupabaseClient(request);
      const { data: exchangeData, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        logger.error({
          service: "auth",
          operation: "callback.exchangeCode",
          error: { name: error.name, message: error.message },
        });
        return redirect(`${origin}/?auth_error=true`);
      }

      // Store provider tokens from the exchange response. provider_token
      // is only available in the exchangeCodeForSession result — a
      // subsequent getSession() does NOT include it (Supabase does not
      // persist provider tokens in session storage).
      try {
        const exchangeSession = exchangeData?.session;
        const exchangeUser = exchangeData?.user;

        if (exchangeSession?.provider_token && exchangeUser) {
          await storeGmailTokens(exchangeUser.id, exchangeUser.email ?? "", {
            access_token: exchangeSession.provider_token,
            refresh_token: exchangeSession.provider_refresh_token ?? "",
            expiry_date: Date.now() + 3600 * 1000,
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          });

          logger.info({
            service: "auth",
            operation: "callback.storeTokens",
            userId: exchangeUser.id,
            hasRefreshToken: !!exchangeSession.provider_refresh_token,
          });
        } else {
          logger.warn({
            service: "auth",
            operation: "callback.storeTokens.skipped",
            userId: exchangeUser?.id,
            reason: "missing_provider_token",
          });
        }
      } catch (tokenErr) {
        logger.warn({
          service: "auth",
          operation: "callback.storeTokens.failed",
          error: tokenErr,
        });
      }

      // If an explicit next param was provided (e.g., from interview Card 2), use it.
      if (explicitNext) {
        return redirect(`${origin}${explicitNext}`);
      }

      // Otherwise, dynamically route based on whether the user has existing schemas.
      // Use exchangeUser from the exchange response (already available above).
      try {
        if (exchangeData?.user) {
          const schemaCount = await prisma.caseSchema.count({
            where: { userId: exchangeData.user.id },
          });
          logger.info({
            service: "auth",
            operation: "callback.dynamicRoute",
            userId: exchangeData.user.id,
            schemaCount,
            destination: schemaCount > 0 ? "/feed" : "/onboarding/category",
          });
          return redirect(`${origin}${schemaCount > 0 ? "/feed" : "/onboarding/category"}`);
        }
      } catch (routeErr) {
        logger.warn({
          service: "auth",
          operation: "callback.dynamicRoute.failed",
          error: routeErr,
        });
      }

      return redirect(`${origin}/onboarding/category`);
    } catch (err) {
      logger.error({
        service: "auth",
        operation: "callback.unexpected",
        error: err,
      });
      return NextResponse.redirect(`${origin}/?auth_error=true`);
    }
  }

  // No code param at all
  return NextResponse.redirect(`${origin}/?auth_error=true`);
}
