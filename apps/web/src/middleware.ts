import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Next.js middleware:
 * 1. Refreshes Supabase auth session (required for SSR cookie-based auth)
 * 2. Sets CORS headers for API routes
 */

function getAllowedOrigins(): string[] {
  if (process.env.NODE_ENV === "development") {
    return ["http://localhost:3000", "http://localhost:3001", "chrome-extension://*"];
  }

  const extensionId = process.env.CHROME_EXTENSION_ID;
  if (extensionId) {
    return [`chrome-extension://${extensionId}`];
  }

  return [];
}

export async function middleware(request: NextRequest) {
  // --- Supabase session refresh ---
  // This ensures auth cookies stay fresh on every request.
  // Without this, Server Components can't read expired sessions.
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    });

    // Calling getUser() triggers session refresh if the JWT is expired.
    // IMPORTANT: Do NOT use getSession() here — it doesn't validate the JWT.
    await supabase.auth.getUser();
  }

  // --- CORS for API routes ---
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  if (isApiRoute) {
    const origin = request.headers.get("origin") ?? "";
    const allowedOrigins = getAllowedOrigins();
    const isAllowed =
      process.env.NODE_ENV === "development" ||
      allowedOrigins.some((allowed) =>
        allowed.includes("*") ? origin.startsWith(allowed.replace("*", "")) : origin === allowed,
      );

    if (request.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": isAllowed ? origin : "",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (isAllowed && origin) {
      supabaseResponse.headers.set("Access-Control-Allow-Origin", origin);
      supabaseResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      supabaseResponse.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With",
      );
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all routes except static files and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
