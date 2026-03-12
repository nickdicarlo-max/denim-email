import { AuthError } from "@denim/types";
import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

interface AuthenticatedContext {
  userId: string;
  request: NextRequest;
}

type AuthenticatedHandler = (context: AuthenticatedContext) => Promise<NextResponse>;

/**
 * Auth middleware wrapper for API routes.
 * Extracts user from Supabase session, returns 401 if missing.
 * Supports BYPASS_AUTH=true for local testing without Supabase.
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    // Allow bypassing auth for local development/testing
    if (process.env.BYPASS_AUTH === "true") {
      return handler({
        userId: "dev-user-id",
        request,
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new AuthError("Supabase configuration missing");
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Not authenticated", code: 401, type: "AUTH_ERROR" },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json(
        { error: "Not authenticated", code: 401, type: "AUTH_ERROR" },
        { status: 401 },
      );
    }

    return handler({ userId: user.id, request });
  };
}
