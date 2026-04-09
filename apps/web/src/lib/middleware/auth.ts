import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
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
    const startMs = Date.now();
    const operation = `${request.method} ${new URL(request.url).pathname}`;

    logger.info({ service: "api", operation });

    // Allow bypassing auth for local development/testing
    if (process.env.BYPASS_AUTH === "true") {
      const response = await handler({
        userId: "dev-user-id",
        request,
      });
      logger.info({
        service: "api",
        operation: `${operation}.complete`,
        userId: "dev-user-id",
        status: response.status,
        durationMs: Date.now() - startMs,
      });
      return response;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new AuthError("Supabase configuration missing");
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      logger.warn({ service: "api", operation, status: 401 });
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
      logger.warn({ service: "api", operation, status: 401 });
      return NextResponse.json(
        { error: "Not authenticated", code: 401, type: "AUTH_ERROR" },
        { status: 401 },
      );
    }

    // Ensure the user row exists in public.users (Supabase auth.users
    // is created by OAuth, but the app-level row must also exist for FK
    // constraints on CaseSchema, etc.).
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email ?? "",
        displayName: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
        avatarUrl: user.user_metadata?.avatar_url ?? null,
      },
      update: {},
    });

    const response = await handler({ userId: user.id, request });
    logger.info({
      service: "api",
      operation: `${operation}.complete`,
      userId: user.id,
      status: response.status,
      durationMs: Date.now() - startMs,
    });
    return response;
  };
}
