/**
 * Shared Stage 2 fanout. Given a CaseSchema already in `DISCOVERING_ENTITIES`
 * with `stage2ConfirmedDomains` populated, run `discoverEntitiesForDomain`
 * in parallel for each confirmed domain and prepend user-seeded SECONDARY
 * contacts to the per-domain candidate list.
 *
 * This is the single source of truth for Stage 2 fanout:
 *   - Inngest's `runEntityDiscovery` wraps each per-domain call in a
 *     `step.run` for memoization; it delegates the actual work here.
 *   - The eval harness (`scripts/eval-onboarding.ts`) calls this directly
 *     so offline runs exercise the exact same seed-prepend + pairing
 *     behaviour as production.
 *
 * Pairing + seed rules preserved verbatim from the original Inngest
 * implementation (#102 + #112 + #117):
 *   - User-named WHOs whose query string is in `stage1ConfirmedUserContactQueries`
 *     AND whose resolved senderDomain is in the confirmed list are seeded
 *     onto that domain as `@sender@domain`-keyed SECONDARY candidates.
 *   - Paired WHATs (from `inputs.groups`) emit `pairedWhoAddresses` context
 *     into the Gemini prompt so subjects can be attributed back to the
 *     user's named WHO via `sourcedFromWho` / `relatedWhat`.
 */

import { extractCredentialFailure } from "@denim/types";
import type { DomainName } from "@/lib/config/domain-shapes";
import {
  type DiscoverEntitiesOutput,
  discoverEntitiesForDomain,
} from "@/lib/discovery/entity-discovery";
import {
  type DomainPairingContext,
  resolvePairingContext,
} from "@/lib/discovery/paired-who-resolver";
import type { GmailClientLike } from "@/lib/gmail/types";
import { logger } from "@/lib/logger";

export interface Stage2UserSeed {
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  meta: Record<string, unknown>;
}

export interface Stage2PerDomainResult {
  confirmedDomain: string;
  algorithm: string;
  subjectsScanned: number;
  candidates: unknown[];
  errorCount: number;
  failed: boolean;
  errorMessage?: string;
}

export interface Stage2SchemaSnapshot {
  id: string;
  userId: string;
  domain: string | null;
  stage2ConfirmedDomains: unknown;
  stage1UserContacts: unknown;
  stage1ConfirmedUserContactQueries: unknown;
  inputs: unknown;
}

export interface Stage2Context {
  schemaId: string;
  userId: string;
  schemaDomain: DomainName;
  confirmedDomains: string[];
  userSeedsByDomain: Map<string, Stage2UserSeed[]>;
  pairedWhoAddresses: Array<{ senderEmail: string; pairedWhat: string; pairedWho: string }>;
  /** 04-22 plan — per-domain Layer 1/2/3 context (senderEmails for public-
   *  provider scoping, pairedWhats for topic filter, unambiguousPairedWhat
   *  for short-circuit). Keyed by confirmed domain. */
  pairingByDomain: Map<string, DomainPairingContext>;
  /** All user-entered WHATs from `inputs.whats`. Threaded into the
   *  post-Gemini scorer so candidates matching user hints earn points. */
  userWhats: string[];
  /** All confirmed-WHO sender emails (across every domain). Threaded into
   *  the post-Gemini scorer so candidates representing confirmed senders
   *  earn the `confirmed_who_sender` signal. */
  confirmedWhoEmails: string[];
}

type ContactRow = {
  query: string;
  matchCount: number;
  senderEmail: string | null;
  senderDomain: string | null;
};

/**
 * Parse the Stage 1 results off a CaseSchema snapshot into the context
 * Stage 2 needs. Pure data transformation — no I/O.
 */
export function buildStage2Context(schema: Stage2SchemaSnapshot): Stage2Context {
  if (!schema.domain) {
    throw new Error(`Schema ${schema.id} missing domain`);
  }

  const confirmedDomains: string[] = (schema.stage2ConfirmedDomains as string[] | null) ?? [];
  if (confirmedDomains.length === 0) {
    throw new Error(`Schema ${schema.id} has no confirmed Stage-1 domains`);
  }

  const userContacts: ContactRow[] = (schema.stage1UserContacts as ContactRow[] | null) ?? [];
  const confirmedQueries = new Set(
    (schema.stage1ConfirmedUserContactQueries as string[] | null) ?? [],
  );

  // Per-domain seed map — user-named WHO contacts, already confirmed,
  // whose senderDomain is in the confirmed list.
  const userSeedsByDomain = new Map<string, Stage2UserSeed[]>();
  for (const c of userContacts) {
    if (!confirmedQueries.has(c.query)) continue;
    if (!c.senderEmail || !c.senderDomain) continue;
    if (!confirmedDomains.includes(c.senderDomain)) continue;
    const bucket = userSeedsByDomain.get(c.senderDomain) ?? [];
    bucket.push({
      key: `@${c.senderEmail.toLowerCase()}`,
      displayString: c.query,
      frequency: c.matchCount,
      autoFixed: false,
      meta: {
        source: "user_named",
        senderEmail: c.senderEmail,
        senderDomain: c.senderDomain,
        kind: "SECONDARY",
      },
    });
    userSeedsByDomain.set(c.senderDomain, bucket);
  }

  // Paired WHOs → senderEmail context for Gemini.
  const schemaInputs =
    (schema.inputs as {
      whats?: string[];
      groups?: Array<{ whats: string[]; whos: string[] }>;
    } | null) ?? null;
  const groups = schemaInputs?.groups ?? [];
  const pairedWhoAddresses: Array<{ senderEmail: string; pairedWhat: string; pairedWho: string }> =
    [];
  if (groups.length > 0) {
    const whoToEmail = new Map<string, string>();
    for (const c of userContacts) {
      if (!c.query || !c.senderEmail) continue;
      whoToEmail.set(c.query, c.senderEmail);
    }
    for (const g of groups) {
      for (const who of g.whos) {
        const email = whoToEmail.get(who);
        if (!email) continue;
        for (const what of g.whats) {
          pairedWhoAddresses.push({ senderEmail: email, pairedWhat: what, pairedWho: who });
        }
      }
    }
  }

  const pairingByDomain = resolvePairingContext({
    groups,
    userContacts,
    confirmedContactQueries: Array.from(confirmedQueries),
    confirmedDomains,
  });

  const userWhats: string[] = schemaInputs?.whats ?? [];
  // Confirmed-WHO sender emails = user-contacts whose query is confirmed
  // AND who have a resolved senderEmail. The scorer doesn't care which
  // domain they belong to, just whether the candidate is a known WHO.
  const confirmedWhoEmails: string[] = [];
  for (const c of userContacts) {
    if (!c.senderEmail) continue;
    if (!confirmedQueries.has(c.query)) continue;
    confirmedWhoEmails.push(c.senderEmail.toLowerCase());
  }

  return {
    schemaId: schema.id,
    userId: schema.userId,
    schemaDomain: schema.domain as DomainName,
    confirmedDomains,
    userSeedsByDomain,
    pairedWhoAddresses,
    pairingByDomain,
    userWhats,
    confirmedWhoEmails,
  };
}

/**
 * Merge a per-domain `discoverEntitiesForDomain` result with the
 * user-seeded contacts for that domain. Seeds come first; derived
 * candidates that collide with a seed on identity key are dropped.
 */
export function mergePerDomainResult(
  confirmedDomain: string,
  discoveryResult: DiscoverEntitiesOutput,
  seeds: Stage2UserSeed[],
): Stage2PerDomainResult {
  const seedKeys = new Set(seeds.map((s) => s.key));
  const derived = (discoveryResult.candidates as Array<{ key: string }>).filter(
    (c) => !seedKeys.has(c.key),
  );
  return {
    confirmedDomain,
    algorithm: discoveryResult.algorithm,
    subjectsScanned: discoveryResult.subjectsScanned,
    candidates: [...seeds, ...derived] as unknown[],
    errorCount: discoveryResult.errorCount ?? 0,
    failed: false,
  };
}

/**
 * Run `discoverEntitiesForDomain` for one confirmed domain and merge
 * the result with the user-seeded contacts. Catches per-domain errors
 * (returning a `failed: true` row) EXCEPT Gmail credential failures,
 * which rethrow so the whole Stage 2 run can mark the schema FAILED.
 */
export async function runStage2ForDomain(
  ctx: Stage2Context,
  confirmedDomain: string,
  gmailClient: GmailClientLike,
): Promise<Stage2PerDomainResult> {
  try {
    const pairing = ctx.pairingByDomain.get(confirmedDomain);
    const r = await discoverEntitiesForDomain({
      gmailClient,
      schemaDomain: ctx.schemaDomain,
      confirmedDomain,
      pairedWhoAddresses: ctx.pairedWhoAddresses.length > 0 ? ctx.pairedWhoAddresses : undefined,
      confirmedSenderEmails: pairing?.senderEmails,
      topicKeywords: pairing?.pairedWhats,
      unambiguousPairedWhat: pairing?.unambiguousPairedWhat,
      pairedWho: pairing?.pairedWho,
      // Phase 5 — paired-WHO matchCount for the short-circuit synthetic,
      // total matchCount across all confirmed WHOs for agency-derive.
      pairedWhoMatchCount: pairing?.pairedWhoMatchCount,
      confirmedSenderTotalMatches: pairing?.confirmedSenderTotalMatches,
      userWhats: ctx.userWhats,
      confirmedWhoEmails: ctx.confirmedWhoEmails,
      schemaId: ctx.schemaId,
      userId: ctx.userId,
    });
    const seeds = ctx.userSeedsByDomain.get(confirmedDomain) ?? [];
    return mergePerDomainResult(confirmedDomain, r, seeds);
  } catch (err) {
    if (extractCredentialFailure(err) !== undefined) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({
      service: "stage2-fanout",
      operation: "runStage2ForDomain.perDomainFailure",
      schemaId: ctx.schemaId,
      confirmedDomain,
      error: message,
    });
    return {
      confirmedDomain,
      algorithm: "unknown",
      subjectsScanned: 0,
      candidates: [],
      errorCount: 0,
      failed: true,
      errorMessage: message,
    };
  }
}

/**
 * Full Stage 2 fanout — iterates confirmedDomains in parallel and returns
 * the merged per-domain results. Eval harness calls this directly.
 * Inngest's runEntityDiscovery wraps each call to `runStage2ForDomain`
 * in `step.run` for memoization and does its own `Promise.all`.
 */
export async function runStage2Fanout(
  ctx: Stage2Context,
  gmailClient: GmailClientLike,
): Promise<Stage2PerDomainResult[]> {
  return Promise.all(ctx.confirmedDomains.map((d) => runStage2ForDomain(ctx, d, gmailClient)));
}
