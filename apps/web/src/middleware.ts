import { type NextRequest, NextResponse } from "next/server";

/**
 * Next.js middleware for CORS configuration.
 * Development: allows localhost origins.
 * Production: restricts to Chrome extension origin only.
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

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigins = getAllowedOrigins();

  const isAllowed =
    process.env.NODE_ENV === "development" ||
    allowedOrigins.some((allowed) =>
      allowed.includes("*") ? origin.startsWith(allowed.replace("*", "")) : origin === allowed,
    );

  // Handle preflight
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

  const response = NextResponse.next();

  if (isAllowed && origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With",
    );
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
