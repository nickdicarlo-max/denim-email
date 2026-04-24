/**
 * AI response-cache interceptor for eval runs.
 *
 * Gated by `AI_RESPONSE_CACHE` env var:
 *   - unset / "off": interceptor is never consulted. Production default.
 *   - "fixture":     consult cache before provider call; persist misses.
 *   - "record":      never consult (always call provider); persist result.
 *
 * Only callers that set the env explicitly see cached behavior. Default
 * is off — a prod bug that omits the gate check cannot silently serve
 * cached responses to real users.
 */

import { resolve } from "node:path";
import type { AICallOptions, AICallResult } from "./client";
import { type AiProvider, readCache, writeCache } from "./response-cache";

export type CacheMode = "off" | "fixture" | "record";

function getMode(): CacheMode {
  const raw = (process.env.AI_RESPONSE_CACHE ?? "").toLowerCase();
  if (raw === "fixture" || raw === "record") return raw;
  return "off";
}

function getCacheRoot(): string {
  // Relative to apps/web cwd when run via pnpm/tsx; relative to CWD when run
  // from repo root. Resolve once against the process cwd.
  const envDir = process.env.AI_RESPONSE_CACHE_DIR;
  return resolve(envDir ?? ".eval-cache");
}

/**
 * Consult the cache before calling the provider. Returns the cached result
 * on hit, or null when no cache exists (or cache is disabled).
 */
export function maybeServeFromCache(
  provider: AiProvider,
  options: AICallOptions,
): AICallResult | null {
  const mode = getMode();
  if (mode !== "fixture") return null;
  const entry = readCache(provider, options, getCacheRoot());
  return entry?.result ?? null;
}

/**
 * Persist a result after a provider call. No-op when cache is off.
 */
export function maybeStoreInCache(
  provider: AiProvider,
  options: AICallOptions,
  result: AICallResult,
): void {
  const mode = getMode();
  if (mode === "off") return;
  writeCache(provider, options, result, getCacheRoot());
}

export function isCacheActive(): boolean {
  return getMode() !== "off";
}

export function getCacheMode(): CacheMode {
  return getMode();
}
