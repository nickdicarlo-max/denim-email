/**
 * Content-hash disk cache for Claude + Gemini responses, used only during
 * eval runs against local fixture data. Never active in production — see
 * `AI_RESPONSE_CACHE` env gate in `interceptor.ts`.
 *
 * Cache layout:
 *   .eval-cache/ai/{provider}/{hash}.json
 *
 * Key is sha256 of a canonical JSON of the AICallOptions (minus identity
 * fields like schemaId that don't affect output). Any prompt text change,
 * model change, or operation change busts the cache automatically.
 *
 * Prompt non-determinism note: four prompt builders in `packages/ai`
 * inject today's date via `new Date().toISOString().slice(0,10)` when the
 * optional `today` param is omitted. Eval runs MUST pass a fixed `today`
 * (e.g. the eval's run-date) so the cached prompt stays stable across
 * calendar days. Otherwise cache hit rate drops to zero every midnight.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AICallOptions, AICallResult } from "./client";

export type AiProvider = "claude" | "gemini";

export interface CachedEntry {
  provider: AiProvider;
  model: string;
  operation: string;
  result: AICallResult;
  cachedAt: string;
}

/**
 * Canonicalize the options we hash so identity-only fields (schemaId,
 * userId) don't split otherwise-identical prompts into separate cache
 * entries. Only fields that actually affect the provider's output
 * contribute to the hash.
 */
function hashKey(provider: AiProvider, options: AICallOptions): string {
  const canonical = {
    provider,
    model: options.model,
    operation: options.operation,
    system: options.system,
    user: options.user,
    cacheableSystemPrompt: options.cacheableSystemPrompt ?? null,
    maxTokens: options.maxTokens ?? 4096,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

function cacheDir(provider: AiProvider, rootDir: string): string {
  return resolve(rootDir, "ai", provider);
}

function cachePath(provider: AiProvider, hash: string, rootDir: string): string {
  return resolve(cacheDir(provider, rootDir), `${hash}.json`);
}

export function readCache(
  provider: AiProvider,
  options: AICallOptions,
  rootDir: string,
): CachedEntry | null {
  const hash = hashKey(provider, options);
  const path = cachePath(provider, hash, rootDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as CachedEntry;
  } catch {
    return null;
  }
}

export function writeCache(
  provider: AiProvider,
  options: AICallOptions,
  result: AICallResult,
  rootDir: string,
): void {
  const hash = hashKey(provider, options);
  const dir = cacheDir(provider, rootDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const entry: CachedEntry = {
    provider,
    model: options.model,
    operation: options.operation,
    result,
    cachedAt: new Date().toISOString(),
  };
  writeFileSync(cachePath(provider, hash, rootDir), JSON.stringify(entry, null, 2));
}
