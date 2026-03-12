import { logger } from "@/lib/logger";
import { AppError } from "@denim/types";
import { NextResponse } from "next/server";

/**
 * Catches typed errors from services, returns sanitized JSON response.
 * Logs full details server-side via logger.
 */
export function handleApiError(
  error: unknown,
  context: { service: string; operation: string; schemaId?: string; userId?: string },
): NextResponse {
  if (error instanceof AppError) {
    logger.error({
      ...context,
      error,
    });

    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        type: error.type,
      },
      { status: error.code },
    );
  }

  // Unknown error -- log full details, return generic message
  logger.error({
    ...context,
    error,
  });

  return NextResponse.json(
    {
      error: "Internal server error",
      code: 500,
      type: "INTERNAL_ERROR",
    },
    { status: 500 },
  );
}
