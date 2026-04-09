import { AppError } from "@denim/types";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";

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

  // ZodError from `.parse()` in a route body — map to 400 with a readable
  // summary of the failing fields. Without this branch, any route that uses
  // `SomeSchema.parse(...)` instead of the `validateInput()` helper returns
  // 500 on invalid input, which is indistinguishable from a server crash
  // from the client's perspective.
  if (error instanceof ZodError) {
    const issues = error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    logger.warn({
      ...context,
      status: 400,
      validationIssues: issues,
    });
    return NextResponse.json(
      {
        error: `Validation failed: ${issues}`,
        code: 400,
        type: "VALIDATION_ERROR",
      },
      { status: 400 },
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
