/**
 * Typed request-param helpers.
 *
 * Extracts dynamic path segments from a `NextRequest` for App Router routes.
 * Centralized here so routes don't each reinvent URL parsing (regex, split().pop(),
 * offset indexing, etc.).
 *
 * All helpers throw `ValidationError` when the expected segment is missing, which
 * `handleApiError` translates to a 400 response.
 */
import { ValidationError } from "@denim/types";
import type { NextRequest } from "next/server";

/**
 * Extract a segment at a given index from the request pathname.
 * Throws ValidationError if the segment is missing or empty.
 *
 * Positive indices count from the start (0 = first segment after leading /).
 * Negative indices count from the end (-1 = last segment).
 *
 * Internal helper — prefer the typed convenience wrappers below.
 */
function extractPathSegment(request: NextRequest, index: number, paramName: string): string {
  const url = new URL(request.url);
  // Trim leading / trailing slashes, split, then pick by index
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const segment = index >= 0 ? segments[index] : segments[segments.length + index];
  if (!segment) {
    throw new ValidationError(`${paramName} required`);
  }
  return segment;
}

/**
 * Extract the schemaId from routes under /api/onboarding/:schemaId[/...].
 * Index 2: ["api", "onboarding", ":schemaId", ...].
 */
export function extractOnboardingSchemaId(request: NextRequest): string {
  return extractPathSegment(request, 2, "schemaId");
}

/**
 * Extract the schemaId from routes under /api/schemas/:schemaId[/...].
 * Index 2: ["api", "schemas", ":schemaId", ...].
 */
export function extractSchemasSchemaId(request: NextRequest): string {
  return extractPathSegment(request, 2, "schemaId");
}

/**
 * Extract the schemaId from /api/quality/:schemaId[/...].
 */
export function extractQualitySchemaId(request: NextRequest): string {
  return extractPathSegment(request, 2, "schemaId");
}

/**
 * Extract the action id from /api/actions/:id.
 */
export function extractActionId(request: NextRequest): string {
  return extractPathSegment(request, 2, "actionId");
}

/**
 * Extract the case id from /api/cases/:id.
 */
export function extractCaseId(request: NextRequest): string {
  return extractPathSegment(request, 2, "caseId");
}
