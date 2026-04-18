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

import { credentialFailure, GmailCredentialError } from "@denim/types";
import type { DomainName } from "@/lib/config/domain-shapes";
import { discoverEntitiesForDomain } from "@/lib/discovery/entity-discovery";
import { matchesGmailAuthError } from "@/lib/gmail/auth-errors";
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
              });
              return {
                confirmedDomain,
                algorithm: r.algorithm,
                subjectsScanned: r.subjectsScanned,
                candidates: r.candidates as unknown[],
                errorCount: r.errorCount ?? 0,
                failed: false,
              };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              // Gmail-auth failures are schema-wide, not per-domain — rethrow.
              if (err instanceof GmailCredentialError || matchesGmailAuthError(message)) {
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
      const message = err instanceof Error ? err.message : String(err);
      const typedFailure =
        err instanceof GmailCredentialError
          ? err.credentialFailure
          : matchesGmailAuthError(message)
            ? credentialFailure("refresh_failed")
            : null;

      await step.run("mark-failed", async () => {
        await markSchemaFailed(
          schemaId,
          "DISCOVERING_ENTITIES",
          typedFailure ? new Error(`GMAIL_AUTH: ${message}`) : err,
          typedFailure ?? undefined,
        );
      });
      throw err;
    }
  },
);
