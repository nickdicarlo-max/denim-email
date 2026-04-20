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

import { type EntityGroupInput, extractCredentialFailure } from "@denim/types";
import type { DomainName } from "@/lib/config/domain-shapes";
import { discoverDomains } from "@/lib/discovery/domain-discovery";
import {
  discoverUserNamedContacts,
  discoverUserNamedThings,
} from "@/lib/discovery/user-hints-discovery";
import { GmailClient } from "@/lib/gmail/client";
import { getAccessToken } from "@/lib/gmail/credentials";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
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
            const accessToken = await getAccessToken(userId);
            const gmail = new GmailClient(accessToken);
            const inputs = schema.inputs as {
              userEmail?: string;
              whats?: string[];
              whos?: string[];
              groups?: EntityGroupInput[];
            } | null;
            const userDomain = (inputs?.userEmail ?? "").split("@")[1]?.toLowerCase() ?? "";
            const whats = inputs?.whats ?? [];
            const whos = inputs?.whos ?? [];
            const groups = inputs?.groups ?? [];

            // #112/#117: keyword-domain pass + per-who pass run in parallel.
            // Per-what pass waits for the per-who results so paired WHATs can
            // attribute their topDomain from the corresponding WHO's result
            // (#117). Small wall-clock cost only when the user has WHOs — if
            // `whos` is empty, `userContacts` resolves to `[]` immediately
            // and the pairing path is a no-op.
            const [domains, userContacts] = await Promise.all([
              discoverDomains({
                gmailClient: gmail,
                domain: schema.domain as DomainName,
                userDomain,
              }),
              discoverUserNamedContacts(gmail, whos),
            ]);
            const userThings = await discoverUserNamedThings(gmail, whats, userDomain, {
              whoResults: userContacts,
              groups,
            });
            return { ...domains, userThings, userContacts };
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
          userThings: result.userThings,
          userContacts: result.userContacts,
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
        userThingsFound: result.userThings.filter((t) => t.matchCount > 0).length,
        userThingsMissing: result.userThings.filter((t) => t.matchCount === 0).length,
        userContactsFound: result.userContacts.filter((c) => c.matchCount > 0).length,
        userContactsMissing: result.userContacts.filter((c) => c.matchCount === 0).length,
      });

      return {
        candidates: result.candidates.length,
        errorCount: result.errorCount,
        userThings: result.userThings.length,
        userContacts: result.userContacts.length,
      };
    } catch (err) {
      // Every auth failure path now throws GmailCredentialError -- either
      // from getAccessToken (credentials module) or from wrapGmailApiError
      // in lib/gmail/client.ts (wraps 401s from the Gmail API). Duck-typed
      // extraction instead of `instanceof` because Turbopack can load
      // `@denim/types` as two distinct module instances in dev mode,
      // making class-identity checks unreliable (#107). UI reads the typed
      // credentialFailure column off the schema.
      const typedFailure = extractCredentialFailure(err);

      await step.run("mark-failed", async () => {
        await markSchemaFailed(schemaId, "DISCOVERING_DOMAINS", err, typedFailure);
      });
      throw err;
    }
  },
);
