import { logger } from "./logger";

export interface WithLoggingOptions {
  service: string;
  operation: string;
  context?: Record<string, unknown>;
}

/**
 * Wrap an async operation with structured start/complete/error logging.
 *
 * Logs:
 *   - `{ service, operation, ...context }` at start
 *   - `{ service, operation: ${operation}.complete, ...context, ...resultFields, durationMs }` on success
 *   - `{ service, operation: ${operation}.error, ...context, error, durationMs }` on throw
 *
 * The `resultFields` callback extracts metric fields from the return value
 * for inclusion in the .complete log.
 */
export async function withLogging<T>(
  options: WithLoggingOptions,
  fn: () => Promise<T>,
  resultFields?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const start = Date.now();
  logger.info({
    service: options.service,
    operation: options.operation,
    ...options.context,
  });
  try {
    const result = await fn();
    logger.info({
      service: options.service,
      operation: `${options.operation}.complete`,
      ...options.context,
      ...(resultFields ? resultFields(result) : {}),
      durationMs: Date.now() - start,
    });
    return result;
  } catch (error) {
    logger.error({
      service: options.service,
      operation: `${options.operation}.error`,
      ...options.context,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    });
    throw error;
  }
}
