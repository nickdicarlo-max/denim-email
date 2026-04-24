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
import { GmailClient } from "@/lib/gmail/client";
import { getAccessToken } from "@/lib/gmail/credentials";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { writeStage2Result } from "@/lib/services/interview";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { buildStage2Context, runStage2ForDomain } from "@/lib/services/stage2-fanout";
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

      const ctx = buildStage2Context(schema);

      // Parallel fan-out, one step.run per domain. Inngest memoizes each
      // step, so a retry only re-runs the failed one. Shared logic
      // (seed-prepend, paired-WHO context, error handling) lives in
      // `services/stage2-fanout.ts` so the eval harness drives the exact
      // same production code path.
      const slug = (d: string) => d.replace(/[^a-z0-9]/gi, "-");
      const perDomain = await Promise.all(
        ctx.confirmedDomains.map((confirmedDomain) =>
          step.run(`discover-${slug(confirmedDomain)}`, async () => {
            const accessToken = await getAccessToken(userId);
            const gmail = new GmailClient(accessToken);
            return runStage2ForDomain(ctx, confirmedDomain, gmail);
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
        domainsProcessed: ctx.confirmedDomains.length,
        domainsFailed: perDomain.filter((d) => d.failed).length,
      });

      return {
        domainsProcessed: ctx.confirmedDomains.length,
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
