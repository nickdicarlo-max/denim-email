/**
 * Structured JSON logger.
 * Every log includes: timestamp, level, service, schemaId, userId, operation, durationMs.
 * NEVER logs: OAuth tokens, email body content, PII beyond userId.
 *
 * For MVP: wraps console with structured JSON. Replace with pino later.
 */

type LogLevel = "info" | "warn" | "error";

interface LogContext {
  service: string;
  operation: string;
  schemaId?: string;
  userId?: string;
  durationMs?: number;
  error?: unknown;
  [key: string]: unknown;
}

function formatError(error: unknown): Record<string, unknown> | undefined {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    };
  }
  return { message: String(error) };
}

function log(level: LogLevel, context: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: context.service,
    operation: context.operation,
    schemaId: context.schemaId,
    userId: context.userId,
    durationMs: context.durationMs,
    error: formatError(context.error),
    ...Object.fromEntries(
      Object.entries(context).filter(
        ([key]) =>
          !["service", "operation", "schemaId", "userId", "durationMs", "error"].includes(key),
      ),
    ),
  };

  // Remove undefined values for cleaner output
  const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));

  switch (level) {
    case "error":
      console.error(JSON.stringify(clean));
      break;
    case "warn":
      console.warn(JSON.stringify(clean));
      break;
    default:
      console.log(JSON.stringify(clean));
  }
}

export const logger = {
  info: (context: LogContext) => log("info", context),
  warn: (context: LogContext) => log("warn", context),
  error: (context: LogContext) => log("error", context),
};
