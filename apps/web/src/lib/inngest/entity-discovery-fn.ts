/**
 * Stage 2 — Entity Discovery (issue #95).
 *
 * Consumes `onboarding.entity-discovery.requested`, which the
 * /domain-confirm route emits after the user picks Stage-1 domains.
 * Fans out one per-domain `step.run` per confirmed domain; per-domain
 * failures are isolated (Gmail auth errors rethrow to fail the whole
 * schema). On success, persists stage2Candidates via InterviewService
 * and advances DISCOVERING_ENTITIES → AWAITING_ENTITY_CONFIRMATION.
 *
 * Concurrency: per-schema limit 1 + global limit 20 to protect the
 * project-wide Gmail 10k/100sec cap. Priority 120 (interactive — user
 * is watching the spinner).
 */

import { extractCredentialFailure } from "@denim/types";
import type { DomainName } from "@/lib/config/domain-shapes";
import { discoverEntitiesForDomain } from "@/lib/discovery/entity-discovery";
import { GmailClient } from "@/lib/gmail/client";
import { getAccessToken } from "@/lib/gmail/credentials";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { writeStage2Result } from "@/lib/services/interview";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";

export const runEntityDiscovery = inngest.createFunction(
  {
    id: "run-entity-discovery",
    name: "Stage 2 — Entity Discovery",
    triggers: [{ event: "onboarding.entity-discovery.requested" }],
    retries: 2,
    priority: { run: "120" },
    concurrency: [{ key: "event.data.schemaId", limit: 1 }, { limit: 20 }],
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;

    try {
      const schema = await step.run("load-schema", async () =>
        prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: {
            id: true,
            userId: true,
            domain: true,
            phase: true,
            stage2ConfirmedDomains: true,
            stage1UserContacts: true,
            stage1ConfirmedUserContactQueries: true,
            inputs: true,
          },
        }),
      );

      if (schema.phase !== "DISCOVERING_ENTITIES") {
        throw new Error(`Schema ${schemaId} not in DISCOVERING_ENTITIES (got ${schema.phase})`);
      }

      const confirmed: string[] = (schema.stage2ConfirmedDomains as string[] | null) ?? [];
      if (confirmed.length === 0) {
        throw new Error(`Schema ${schemaId} has no confirmed Stage-1 domains`);
      }

      // #112 Tier 2: user-named contact seeds. Build a per-domain map of
      // pre-confirmed SECONDARY candidates from the user's Stage 1
      // "Your contacts" selections. Cross-reference the confirmed-query
      // list against the Stage 1 discovery payload so we get the full
      // senderEmail / senderDomain context back.
      const userContacts =
        (schema.stage1UserContacts as Array<{
          query: string;
          matchCount: number;
          senderEmail: string | null;
          senderDomain: string | null;
        }> | null) ?? [];
      const confirmedQueries = new Set(
        (schema.stage1ConfirmedUserContactQueries as string[] | null) ?? [],
      );
      const userSeedsByDomain = new Map<
        string,
        Array<{
          key: string;
          displayString: string;
          frequency: number;
          autoFixed: boolean;
          meta: Record<string, unknown>;
        }>
      >();
      for (const c of userContacts) {
        if (!confirmedQueries.has(c.query)) continue;
        if (!c.senderEmail || !c.senderDomain) continue;
        if (!confirmed.includes(c.senderDomain)) continue;
        const bucket = userSeedsByDomain.get(c.senderDomain) ?? [];
        bucket.push({
          // `@`-prefixed identityKey matches the reserved SECONDARY
          // convention enforced by the entity-confirm Zod refine.
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

      // #102: resolve Stage 1 per-topic pairings into senderEmail targets
      // for Pattern C narrow-view mining. Reads `inputs.groups` (populated
      // by #117 onboarding) and cross-references against `stage1UserContacts`
      // to pull the senderEmail Stage 1 discovered for each paired WHO.
      // When `groups` is empty (property / unpaired schemas), this list is
      // empty and Pattern C runs full-view only — zero behavior change.
      const schemaInputs =
        (schema.inputs as { groups?: Array<{ whats: string[]; whos: string[] }> } | null) ?? null;
      const groups = schemaInputs?.groups ?? [];
      const pairedWhoAddresses: Array<{
        senderEmail: string;
        pairedWhat: string;
        pairedWho: string;
      }> = [];
      if (groups.length > 0) {
        // Build contact-name → senderEmail lookup from Stage 1 results.
        // Match is name-equality on the `query` field; WHOs the user typed
        // must match the query string stored on `stage1UserContacts`.
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
              pairedWhoAddresses.push({
                senderEmail: email,
                pairedWhat: what,
                pairedWho: who,
              });
            }
          }
        }
      }

      // Parallel fan-out, one step.run per domain. Inngest memoizes each
      // step, so a retry only re-runs the failed one. Per-domain errors
      // are caught inside the step so one domain's Gmail hiccup can't
      // kill the rest (Gmail-auth errors rethrow — that's a schema-wide
      // failure). Step ids are slugified so domains with dots
      // ("email.teamsnap.com") render cleanly in the Inngest dashboard.
      const slug = (d: string) => d.replace(/[^a-z0-9]/gi, "-");
      const perDomain = await Promise.all(
        confirmed.map((confirmedDomain) =>
          step.run(`discover-${slug(confirmedDomain)}`, async () => {
            try {
              const accessToken = await getAccessToken(userId);
              const gmail = new GmailClient(accessToken);
              const r = await discoverEntitiesForDomain({
                gmailClient: gmail,
                schemaDomain: schema.domain as DomainName,
                confirmedDomain,
                pairedWhoAddresses: pairedWhoAddresses.length > 0 ? pairedWhoAddresses : undefined,
              });
              // Prepend user-named seeds so they appear first in the
              // review UI. Dedup by key to avoid a derived candidate
              // with the same identity key re-appearing below its seed.
              const seeds = userSeedsByDomain.get(confirmedDomain) ?? [];
              const seedKeys = new Set(seeds.map((s) => s.key));
              const derived = (r.candidates as Array<{ key: string }>).filter(
                (c) => !seedKeys.has(c.key),
              );
              return {
                confirmedDomain,
                algorithm: r.algorithm,
                subjectsScanned: r.subjectsScanned,
                candidates: [...seeds, ...derived] as unknown[],
                errorCount: r.errorCount ?? 0,
                failed: false,
              };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              // Gmail-auth failures are schema-wide, not per-domain — rethrow.
              // All auth errors now funnel through GmailCredentialError
              // (getAccessToken + client.ts wrapGmailApiError). Duck-typed
              // check, not `instanceof`, per #107 (Turbopack module duplication).
              if (extractCredentialFailure(err) !== undefined) {
                throw err;
              }
              logger.warn({
                service: "inngest",
                operation: "runEntityDiscovery.perDomainFailure",
                schemaId,
                confirmedDomain,
                error: message,
              });
              return {
                confirmedDomain,
                algorithm: "unknown",
                subjectsScanned: 0,
                candidates: [] as unknown[],
                errorCount: 0,
                failed: true,
                errorMessage: message,
              };
            }
          }),
        ),
      );

      const allFailed = perDomain.every((d) => d.failed);
      if (allFailed) throw new Error("All per-domain Stage 2 runs failed");

      await step.run("persist-and-advance", async () => {
        await writeStage2Result(schemaId, { perDomain });
        await advanceSchemaPhase({
          schemaId,
          from: "DISCOVERING_ENTITIES",
          to: "AWAITING_ENTITY_CONFIRMATION",
          work: async () => undefined,
        });
      });

      logger.info({
        service: "inngest",
        operation: "runEntityDiscovery.complete",
        schemaId,
        domainsProcessed: confirmed.length,
        domainsFailed: perDomain.filter((d) => d.failed).length,
      });

      return {
        domainsProcessed: confirmed.length,
        domainsFailed: perDomain.filter((d) => d.failed).length,
      };
    } catch (err) {
      // Duck-typed extraction, not `instanceof`, per #107 -- Turbopack
      // workspace-package class duplication in dev mode breaks identity.
      const typedFailure = extractCredentialFailure(err);

      await step.run("mark-failed", async () => {
        await markSchemaFailed(schemaId, "DISCOVERING_ENTITIES", err, typedFailure);
      });
      throw err;
    }
  },
);
