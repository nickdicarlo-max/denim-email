import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { storeGmailTokens } from "@/lib/services/gmail-tokens";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

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
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        logger.error({
          service: "auth",
          operation: "callback.exchangeCode",
          error: { name: error.name, message: error.message },
        });
        return redirect(`${origin}/?auth_error=true`);
      }

      // Attempt to store provider tokens in the database
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (session?.provider_token && user) {
          await storeGmailTokens(user.id, user.email ?? "", {
            access_token: session.provider_token,
            refresh_token: session.provider_refresh_token ?? "",
            expiry_date: Date.now() + 3600 * 1000,
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          });

          logger.info({
            service: "auth",
            operation: "callback.storeTokens",
            userId: user.id,
            hasRefreshToken: !!session.provider_refresh_token,
          });
        } else {
          logger.warn({
            service: "auth",
            operation: "callback.storeTokens.skipped",
            userId: user?.id,
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
      try {
        const {
          data: { user: authedUser },
        } = await supabase.auth.getUser();
        if (authedUser) {
          const schemaCount = await prisma.caseSchema.count({
            where: { userId: authedUser.id },
          });
          logger.info({
            service: "auth",
            operation: "callback.dynamicRoute",
            userId: authedUser.id,
            schemaCount,
            destination: schemaCount > 0 ? "/dashboard" : "/interview",
          });
          return redirect(
            `${origin}${schemaCount > 0 ? "/dashboard" : "/interview"}`,
          );
        }
      } catch (routeErr) {
        logger.warn({
          service: "auth",
          operation: "callback.dynamicRoute.failed",
          error: routeErr,
        });
      }

      return redirect(`${origin}/interview`);
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
