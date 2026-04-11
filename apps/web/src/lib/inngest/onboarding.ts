/**
 * runOnboarding — parent workflow for the onboarding session state machine.
 * Owns CaseSchema.phase and drives it through:
 *
 *   PENDING → GENERATING_HYPOTHESIS → FINALIZING_SCHEMA
 *           → PROCESSING_SCAN (waits for scan.completed)
 *           → AWAITING_REVIEW  (happy path)
 *           or NO_EMAILS_FOUND (empty scan)
 *           or FAILED          (any thrown error)
 *
 * The transitions use advanceSchemaPhase for CAS-on-phase semantics: if
 * two concurrent runOnboarding invocations raced, only one would advance
 * and the loser would throw NonRetriableError. Idempotent re-runs (Inngest
 * retry landing on an already-advanced row) return "skipped" from the
 * helper and we load the persisted state to continue.
 *
 * This function does NOT own ScanJob.phase — it creates the scan row,
 * emits scan.requested, and waits for scan.completed. runScan (Task 8)
 * owns the scan-phase transitions.
 */
import type { HypothesisValidation, InterviewInput, SchemaHypothesis } from "@denim/types";
import type { Prisma } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import {
  extractTrustedDomains,
  generateHypothesis,
  persistSchemaRelations,
  resolveWhoEmails,
  validateHypothesis,
} from "@/lib/services/interview";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";

/**
 * Maximum emails to pull per trusted-domain expansion query. Cap per domain
 * keeps the total validation cost bounded: N_domains * DOMAIN_EXPANSION_CAP
 * is the upper bound on extra emails the second validateHypothesis pass sees.
 */
const DOMAIN_EXPANSION_CAP = 50;

/**
 * Maximum number of trusted domains to expand. Protects against
 * pathological hypotheses that resolve to dozens of WHO email addresses
 * at distinct domains.
 */
const MAX_DOMAINS_TO_EXPAND = 5;

const SCAN_WAIT_TIMEOUT = "20m";

export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    triggers: [{ event: "onboarding.session.started" }],
    // DELETE /api/onboarding/:schemaId emits onboarding.session.cancelled;
    // Inngest cancels the in-flight run when data.schemaId matches.
    cancelOn: [{ event: "onboarding.session.cancelled", match: "data.schemaId" }],
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { key: "event.data.userId", limit: 3 },
    ],
    // Failures are explicit via markSchemaFailed in the catch block.
    retries: 0,
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;

    try {
      // ---- Step 1: PENDING → GENERATING_HYPOTHESIS ---------------------
      //
      // Load the raw InterviewInput the caller persisted on the stub,
      // ask Claude for a hypothesis, and write it back to the row.
      await step.run("generate-hypothesis", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "PENDING",
          to: "GENERATING_HYPOTHESIS",
          work: async () => {
            const schema = await prisma.caseSchema.findUniqueOrThrow({
              where: { id: schemaId },
              select: { inputs: true },
            });
            const inputs = schema.inputs as unknown as InterviewInput | null;
            if (!inputs) {
              throw new NonRetriableError(
                `runOnboarding: CaseSchema ${schemaId} has no inputs column — stub was created without an InterviewInput`,
              );
            }
            const hypothesis = await generateHypothesis(inputs, { userId });
            await prisma.caseSchema.update({
              where: { id: schemaId },
              data: { hypothesis: hypothesis as unknown as object },
            });
          },
        });
      });

      // ---- Step 1b: validate hypothesis against real email samples -------
      //
      // Runs two validation passes against Gmail so discovered entities
      // from the user's inbox can be surfaced on the review screen. This
      // restores the behavior of the pre-refactor /api/interview/validate
      // route (deleted in b5b42a9 -- see GitHub #56).
      //
      // Pass 1 (broad): sampleScan(200) -> resolveWhoEmails (enrich WHO
      //   aliases with real email addresses) -> validateHypothesis. Captures
      //   discovered entities in whatever topics Claude finds across a
      //   random sample of 200 messages.
      //
      // Pass 2 (domain expansion): for each trusted (non-generic) domain
      //   that Pass 1 resolved for a WHO entity, query Gmail for ALL emails
      //   from that domain (capped at DOMAIN_EXPANSION_CAP per domain) and
      //   run validateHypothesis again on those. Catches entities that
      //   didn't happen to make the initial random sample -- critical for
      //   org-based discovery (e.g., "Timothy Bishop" -> judgefite.com ->
      //   every other @judgefite.com sender).
      //
      // The merged validation result is stored on the schema row, read by
      // the next step (finalize-schema) which auto-confirms all discovered
      // entities into Entity rows with autoDetected=true. Users can then
      // deselect on the review screen.
      //
      // Runs OUTSIDE an advanceSchemaPhase CAS -- stays within the
      // GENERATING_HYPOTHESIS phase for polling purposes. The phase advance
      // happens in the next step (finalize-schema) after validation has
      // written its result back.
      await step.run("validate-hypothesis", async () => {
        const schema = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { hypothesis: true, validation: true, inputs: true },
        });

        // Idempotency guard: on Inngest retry, if validation already ran,
        // skip it rather than spending two more Claude calls.
        if (schema.validation) {
          logger.info({
            service: "runOnboarding",
            operation: "validate-hypothesis.skip",
            schemaId,
            reason: "already-validated",
          });
          return;
        }

        const hypothesis = schema.hypothesis as unknown as SchemaHypothesis | null;
        if (!hypothesis) {
          throw new NonRetriableError(
            `runOnboarding: CaseSchema ${schemaId} has no hypothesis after GENERATING_HYPOTHESIS`,
          );
        }

        // --- Pass 1: broad 200-email sample ----------------------------
        const accessToken = await getValidGmailToken(userId);
        const gmail = new GmailClient(accessToken);
        const { messages } = await gmail.sampleScan(200);

        // Enrich hypothesis WHO aliases with resolved sender email
        // addresses (mutates the hypothesis object in place).
        resolveWhoEmails(hypothesis, messages);

        const pass1Samples = messages.map((m) => ({
          subject: m.subject,
          senderDomain: m.senderDomain,
          senderName: m.senderDisplayName || m.senderEmail,
          snippet: m.snippet,
        }));

        // entityGroups come from the raw InterviewInput (user's original
        // topic groupings), not from the AI-generated hypothesis. Map to
        // the EntityGroupContext shape validateHypothesis expects.
        const inputs = schema.inputs as unknown as InterviewInput | null;
        const entityGroups = inputs?.groups?.map((g, idx) => ({
          index: idx,
          primaryNames: g.whats,
          secondaryNames: g.whos,
        }));

        const pass1 = await validateHypothesis(hypothesis, pass1Samples, {
          userId,
          entityGroups,
        });

        // --- Pass 2: domain expansion ----------------------------------
        // After resolveWhoEmails, hypothesis.entities contains WHO entries
        // with real email addresses in their aliases. Extract the specific
        // org domains (skipping gmail.com, outlook.com, etc.) and query
        // Gmail for all senders at each domain. Run validateHypothesis
        // again on those expanded samples.
        const trustedDomains = extractTrustedDomains(hypothesis).slice(0, MAX_DOMAINS_TO_EXPAND);

        const domainDiscoveries: HypothesisValidation["discoveredEntities"] = [];

        for (const domain of trustedDomains) {
          try {
            const domainMessages = await gmail.searchEmails(
              `from:${domain} newer_than:56d`,
              DOMAIN_EXPANSION_CAP,
            );
            if (domainMessages.length === 0) continue;

            const domainSamples = domainMessages.map((m) => ({
              subject: m.subject,
              senderDomain: m.senderDomain,
              senderName: m.senderDisplayName || m.senderEmail,
              snippet: m.snippet,
            }));

            const pass2 = await validateHypothesis(hypothesis, domainSamples, {
              userId,
              entityGroups,
            });

            // Merge discoveries from this domain into the running set.
            // validateHypothesis may return already-confirmed entities too;
            // we only accumulate new discoveries here.
            for (const discovered of pass2.discoveredEntities) {
              if (
                !pass1.discoveredEntities.some((e) => e.name === discovered.name) &&
                !domainDiscoveries.some((e) => e.name === discovered.name)
              ) {
                domainDiscoveries.push(discovered);
              }
            }

            logger.info({
              service: "runOnboarding",
              operation: "domain-expansion",
              schemaId,
              domain,
              emailsQueried: domainMessages.length,
              newDiscoveriesFromDomain: pass2.discoveredEntities.length,
            });
          } catch (err) {
            // Non-fatal: if one domain expansion fails (e.g., Gmail
            // quota), log it and continue with the others.
            logger.warn({
              service: "runOnboarding",
              operation: "domain-expansion.failed",
              schemaId,
              domain,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // --- Merge passes into single validation result ----------------
        const mergedValidation: HypothesisValidation = {
          ...pass1,
          discoveredEntities: [...pass1.discoveredEntities, ...domainDiscoveries],
        };

        await prisma.caseSchema.update({
          where: { id: schemaId },
          data: {
            // Write back the (possibly mutated) hypothesis with enriched
            // WHO aliases so finalize-schema sees the resolved email
            // addresses.
            hypothesis: hypothesis as unknown as Prisma.InputJsonValue,
            validation: mergedValidation as unknown as Prisma.InputJsonValue,
          },
        });

        logger.info({
          service: "runOnboarding",
          operation: "validate-hypothesis.complete",
          schemaId,
          pass1Discovered: pass1.discoveredEntities.length,
          pass2DomainsExpanded: trustedDomains.length,
          pass2AdditionalDiscovered: domainDiscoveries.length,
          totalDiscovered: mergedValidation.discoveredEntities.length,
        });
      });

      // ---- Step 2: GENERATING_HYPOTHESIS → FINALIZING_SCHEMA -----------
      //
      // Read the stored hypothesis + validation back and hand them to
      // persistSchemaRelations. Auto-confirms all discovered entities
      // (the review screen is now the user's deselection UI, not the
      // old card-based confirmation step).
      await step.run("finalize-schema", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "GENERATING_HYPOTHESIS",
          to: "FINALIZING_SCHEMA",
          work: async () => {
            const schema = await prisma.caseSchema.findUniqueOrThrow({
              where: { id: schemaId },
              select: { hypothesis: true, validation: true },
            });
            const hypothesis = schema.hypothesis as unknown as SchemaHypothesis | null;
            if (!hypothesis) {
              throw new NonRetriableError(
                `runOnboarding: CaseSchema ${schemaId} has no hypothesis column after GENERATING_HYPOTHESIS`,
              );
            }
            const validation = schema.validation as unknown as HypothesisValidation | null;

            // When validation exists (normal path post-Task-18), auto-confirm
            // all discovered entities and suggested tags -- the review screen
            // lets the user deselect any they don't want. When validation is
            // absent (e.g., the validate-hypothesis step was skipped on an
            // already-partial run), persistSchemaRelations uses its own
            // defaults.
            const confirmations = validation
              ? {
                  confirmedEntities: validation.discoveredEntities.map((e) => e.name),
                  confirmedTags: validation.suggestedTags.map((t) => t.name),
                  removedEntities: [],
                  removedTags: [],
                }
              : undefined;

            await persistSchemaRelations(
              schemaId,
              hypothesis,
              validation ?? undefined,
              confirmations,
            );
          },
        });
      });

      // ---- Step 3: FINALIZING_SCHEMA → PROCESSING_SCAN ------------------
      //
      // Create the onboarding ScanJob row in the same CAS so the scan id
      // and the schema-phase advance commit atomically. Return the scan
      // id through the helper; on "skipped" (re-entry) look it up.
      const createdScanId = await step.run("create-scan-job", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "FINALIZING_SCHEMA",
          to: "PROCESSING_SCAN",
          work: async () => {
            const scan = await prisma.scanJob.create({
              data: {
                schemaId,
                userId,
                status: "PENDING",
                phase: "PENDING",
                triggeredBy: "ONBOARDING",
                totalEmails: 0, // overwritten by runScan discovery step
              },
              select: { id: true },
            });
            return scan.id;
          },
        });
      });

      const scanJobId: string = await step.run("resolve-scan-job", async () => {
        if (createdScanId !== "skipped") return createdScanId;
        // Re-entry: find the most recent onboarding scan for this schema.
        const existing = await prisma.scanJob.findFirst({
          where: { schemaId, triggeredBy: "ONBOARDING" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (!existing) {
          throw new NonRetriableError(
            `runOnboarding: schema ${schemaId} is past FINALIZING_SCHEMA but has no onboarding ScanJob`,
          );
        }
        return existing.id;
      });

      // ---- Step 4: request scan -----------------------------------------
      await step.run("request-scan", async () => {
        await inngest.send({
          name: "scan.requested",
          data: { scanJobId, schemaId, userId },
        });
      });

      // ---- Step 5: wait for scan.completed ------------------------------
      //
      // Inngest waitForEvent returns null on timeout. The `match` clause
      // filters to the specific schemaId so a parallel scan for another
      // schema doesn't unblock this workflow. We match on schemaId (not
      // scanJobId) because the trigger event (onboarding.session.started)
      // has schemaId but not scanJobId — matching on a field absent from
      // the trigger always fails (see docs/01_denim_lessons_learned.md).
      const completion = await step.waitForEvent("wait-for-scan", {
        event: "scan.completed",
        timeout: SCAN_WAIT_TIMEOUT,
        match: "data.schemaId",
      });

      if (!completion) {
        throw new NonRetriableError(
          `runOnboarding: scan ${scanJobId} did not complete within ${SCAN_WAIT_TIMEOUT}`,
        );
      }

      // ---- Step 6: advance to terminal state ----------------------------
      //
      // Three outcomes from the scan:
      //   - reason="failed"          → FAILED (scan died, surface the error)
      //   - reason="no-emails-found" → NO_EMAILS_FOUND (terminal, no review)
      //   - happy path               → quality gate then AWAITING_REVIEW
      const reason = completion.data.reason;

      if (reason === "failed") {
        const scanError = completion.data.errorMessage ?? "Scan failed";
        throw new NonRetriableError(`runOnboarding: scan failed — ${scanError}`);
      }

      if (reason === "no-emails-found") {
        await step.run("advance-to-no-emails-found", async () => {
          await advanceSchemaPhase({
            schemaId,
            from: "PROCESSING_SCAN",
            to: "NO_EMAILS_FOUND",
            work: async () => {
              // Terminal phase — nothing else to write.
            },
          });
        });
        logger.info({
          service: "runOnboarding",
          operation: "runOnboarding.noEmailsFound",
          schemaId,
          scanJobId,
        });
        return;
      }

      await step.run("advance-to-awaiting-review", async () => {
        await advanceSchemaPhase({
          schemaId,
          from: "PROCESSING_SCAN",
          to: "AWAITING_REVIEW",
          work: async () => {
            // Quality gate: make sure every OPEN case has been synthesized.
            // runSynthesis marks cases with a timestamp as it processes them;
            // any nulls here mean the pipeline silently dropped a case and
            // the user shouldn't see AWAITING_REVIEW until the gap is
            // surfaced (we throw, markSchemaFailed runs in the catch).
            const unsynthesized = await prisma.case.count({
              where: { schemaId, status: "OPEN", synthesizedAt: null },
            });
            if (unsynthesized > 0) {
              throw new Error(
                `runOnboarding: ${unsynthesized} OPEN case(s) still unsynthesized — refusing to advance to AWAITING_REVIEW`,
              );
            }
          },
        });
      });

      logger.info({
        service: "runOnboarding",
        operation: "runOnboarding.awaitingReview",
        schemaId,
        scanJobId,
        synthesizedCount: completion.data.synthesizedCount ?? 0,
        failedCount: completion.data.failedCount ?? 0,
      });
    } catch (error) {
      if (error instanceof NonRetriableError) {
        // Re-read the current phase so markSchemaFailed records exactly
        // where we died (the catch block can't assume anything).
        const current = await prisma.caseSchema.findUnique({
          where: { id: schemaId },
          select: { phase: true },
        });
        await markSchemaFailed(schemaId, current?.phase ?? "PENDING", error);
        throw error;
      }

      logger.error({
        service: "runOnboarding",
        operation: "runOnboarding.caught",
        schemaId,
        error: error instanceof Error ? error.message : String(error),
      });
      const current = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true },
      });
      await markSchemaFailed(schemaId, current?.phase ?? "PENDING", error);
      throw error;
    }
  },
);
