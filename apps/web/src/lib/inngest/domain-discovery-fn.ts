/**
 * Stage 1 — Domain Discovery (issue #95).
 *
 * Consumes `onboarding.domain-discovery.requested`. Advances
 * PENDING → DISCOVERING_DOMAINS → AWAITING_DOMAIN_CONFIRMATION, writes
 * stage1 candidates via InterviewService (CaseSchema single-writer rule).
 *
 * Concurrency: per-schema limit 1 + global limit 20 to protect the project-wide
 * Gmail 10,000 req/100sec cap. Priority 120 (interactive — user watches spinner).
 */

import type { DomainName } from "@/lib/config/domain-shapes";
import { discoverDomains } from "@/lib/discovery/domain-discovery";
import { matchesGmailAuthError } from "@/lib/gmail/auth-errors";
import { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { writeStage1Result } from "@/lib/services/interview";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";

export const runDomainDiscovery = inngest.createFunction(
  {
    id: "run-domain-discovery",
    name: "Stage 1 — Domain Discovery",
    triggers: [{ event: "onboarding.domain-discovery.requested" }],
    retries: 2,
    priority: { run: "120" },
    concurrency: [{ key: "event.data.schemaId", limit: 1 }, { limit: 20 }],
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;

    try {
      // Load schema, validate, CAS-advance to DISCOVERING_DOMAINS, run the
      // full discovery inside the advance's work() callback so the phase
      // can't be observed half-advanced. Persist + advance to AWAITING
      // happens in a second step (keeps Inngest memoization boundaries
      // aligned with DB transaction boundaries).
      const result = await step.run("discover", async () => {
        const schema = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { id: true, userId: true, domain: true, inputs: true },
        });
        if (!schema.domain) {
          throw new Error(`Schema ${schemaId} missing domain`);
        }

        return advanceSchemaPhase({
          schemaId,
          from: "PENDING",
          to: "DISCOVERING_DOMAINS",
          work: async () => {
            const accessToken = await getValidGmailToken(userId);
            const gmail = new GmailClient(accessToken);
            const inputs = schema.inputs as { userEmail?: string } | null;
            const userDomain = (inputs?.userEmail ?? "").split("@")[1]?.toLowerCase() ?? "";
            return discoverDomains({
              gmailClient: gmail,
              domain: schema.domain as DomainName,
              userDomain,
            });
          },
        });
      });

      if (result === "skipped") {
        logger.info({
          service: "inngest",
          operation: "runDomainDiscovery.skipped",
          schemaId,
        });
        return { skipped: true };
      }

      await step.run("persist-and-advance", async () => {
        await writeStage1Result(schemaId, {
          candidates: result.candidates,
          queryUsed: result.queryUsed,
          messagesSeen: result.messagesSeen,
          errorCount: result.errorCount,
        });
        await advanceSchemaPhase({
          schemaId,
          from: "DISCOVERING_DOMAINS",
          to: "AWAITING_DOMAIN_CONFIRMATION",
          work: async () => undefined,
        });
      });

      logger.info({
        service: "inngest",
        operation: "runDomainDiscovery.complete",
        schemaId,
        candidateCount: result.candidates.length,
        messagesSeen: result.messagesSeen,
        errorCount: result.errorCount,
      });

      return {
        candidates: result.candidates.length,
        errorCount: result.errorCount,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const authFailed = matchesGmailAuthError(message);
      // Mark the schema FAILED with a prefix that disambiguates auth vs other
      // failures — the UI shows `phaseError`, so "GMAIL_AUTH:" lets us route
      // the user back to reconnect without parsing the tail.
      await step.run("mark-failed", async () => {
        await markSchemaFailed(
          schemaId,
          "DISCOVERING_DOMAINS",
          authFailed ? new Error(`GMAIL_AUTH: ${message}`) : err,
        );
      });
      throw err;
    }
  },
);
