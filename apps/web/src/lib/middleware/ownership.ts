import { ForbiddenError, NotFoundError } from "@denim/types";

/**
 * Assert that a resource exists and is owned by the given user.
 *
 * Throws NotFoundError if `resource` is null (handled as 404 by error-handler).
 * Throws ForbiddenError if `resource.userId` does not match (handled as 403).
 *
 * The `asserts` return type narrows `resource` to non-null after the call,
 * so callers can use it without further null checks.
 *
 * Usage:
 *   const schema = await prisma.caseSchema.findUnique({
 *     where: { id: schemaId },
 *     select: { id: true, userId: true, phase: true },
 *   });
 *   assertResourceOwnership(schema, userId, "Schema");
 *   // schema is now non-null and owned by userId
 */
export function assertResourceOwnership<T extends { userId: string }>(
  resource: T | null,
  userId: string,
  resourceName: string,
): asserts resource is T {
  if (!resource) {
    throw new NotFoundError(`${resourceName} not found`);
  }
  if (resource.userId !== userId) {
    throw new ForbiddenError("Access denied");
  }
}
