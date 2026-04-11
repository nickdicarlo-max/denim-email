/**
 * runScan — parent workflow for every scan trigger (onboarding, cron,
 * manual, feedback). Wraps the existing Inngest pipeline chain under a
 * single durable workflow so one function owns the scan lifecycle.
 *
 * Responsibilities:
 * 1. Advance ScanJob.phase PENDING → DISCOVERING, run smart discovery,
 *    persist the discovered email ids.
 * 2. Handle the empty-scan short circuit: no emails → phase=COMPLETED +
 *    scan.completed event with reason="no-emails-found", then exit.
 * 3. Advance ScanJob.phase DISCOVERING → EXTRACTING and hand off to the
 *    existing chain by emitting scan.emails.discovered. From that point
 *    the chain (fanOutExtraction → extractBatch → checkExtractionComplete
 *    → runCoarseClustering → runCaseSplitting → runSynthesis) runs
 *    independently; runSynthesis emits scan.completed at the end and
 *    runOnboarding (Task 9) picks it up to advance schema state.
 *
 * Failure handling: a thrown error from any step lands in the catch block,
 * which calls markScanFailed (sets ScanJob.phase=FAILED + status=FAILED +
 * errorPhase + errorMessage) and re-throws so Inngest records the failure.
 * retries=0 because failures are recorded explicitly — we don't want silent
 * retries hiding a bad schema config or Gmail token issue.
 */
import type { DiscoveryQuery, EntityGroupInput } from "@denim/types";
import { NonRetriableError } from "inngest";
import { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { runSmartDiscovery } from "@/lib/services/discovery";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { advanceScanPhase, markScanFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";

export const runScan = inngest.createFunction(
  {
    id: "run-scan",
    triggers: [{ event: "scan.requested" }],
    concurrency: [{ key: "event.data.schemaId", limit: 1 }],
    // Failures are recorded explicitly via markScanFailed in the catch
    // block below. A silent retry here would mask config / token issues
    // that the operator needs to see.
    retries: 0,
  },
  async ({ event, step }) => {
    const { scanJobId, schemaId, userId } = event.data;

    try {
      // ---- Step 1: PENDING → DISCOVERING, run smart discovery ------------
      const discoveryResult = await step.run("run-discovery", async () => {
        return advanceScanPhase({
          scanJobId,
          from: "PENDING",
          to: "DISCOVERING",
          work: async () => {
            const schema = await prisma.caseSchema.findUniqueOrThrow({
              where: { id: schemaId },
              include: {
                entityGroups: {
                  orderBy: { index: "asc" },
                  include: {
                    entities: {
                      where: { isActive: true },
                      select: { name: true, type: true },
                    },
                  },
                },
                entities: {
                  where: { isActive: true },
                  select: { name: true },
                },
              },
            });

            const accessToken = await getValidGmailToken(userId);
            const gmailClient = new GmailClient(accessToken);

            // discoveryQueries is stored as Json; cast through unknown since
            // the runtime shape matches DiscoveryQuery[] by construction.
            const queries = (schema.discoveryQueries ?? []) as unknown as DiscoveryQuery[];
            const entityGroups: EntityGroupInput[] = schema.entityGroups.map((g) => ({
              whats: g.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name),
              whos: g.entities.filter((e) => e.type === "SECONDARY").map((e) => e.name),
            }));
            const knownEntityNames = schema.entities.map((e) => e.name);

            const { emailIds } = await runSmartDiscovery(
              gmailClient,
              queries,
              entityGroups,
              knownEntityNames,
              schema.domain ?? "general",
              schemaId,
              scanJobId,
            );

            // Persist the discovery output so downstream stages and polling
            // can read it without re-running Gmail queries.
            await prisma.scanJob.update({
              where: { id: scanJobId },
              data: {
                totalEmails: emailIds.length,
                discoveredEmailIds: emailIds as unknown as object,
                startedAt: new Date(),
                statusMessage: `Discovered ${emailIds.length} email(s)`,
              },
            });

            return emailIds;
          },
        });
      });

      // If advanceScanPhase returned "skipped", the scan was already past
      // DISCOVERING — an Inngest retry landed on an in-progress workflow.
      // Read the previously-persisted discoveredEmailIds to continue.
      const actualEmailIds: string[] =
        discoveryResult === "skipped"
          ? await step.run("load-persisted-discovery", async () => {
              logger.info({
                service: "runScan",
                operation: "discovery.skipped",
                scanJobId,
              });
              const scan = await prisma.scanJob.findUniqueOrThrow({
                where: { id: scanJobId },
                select: { discoveredEmailIds: true },
              });
              return (scan.discoveredEmailIds as string[] | null) ?? [];
            })
          : discoveryResult;

      // ---- Step 2: empty-scan short circuit ------------------------------
      if (actualEmailIds.length === 0) {
        await step.run("complete-empty-scan", async () => {
          // Multi-phase jump: DISCOVERING → COMPLETED. advanceScanPhase
          // only checks the `from` matches, so skipping EXTRACTING /
          // CLUSTERING / SYNTHESIZING is allowed.
          await advanceScanPhase({
            scanJobId,
            from: "DISCOVERING",
            to: "COMPLETED",
            work: async () => {
              await prisma.scanJob.update({
                where: { id: scanJobId },
                data: {
                  status: "COMPLETED",
                  completedAt: new Date(),
                  totalEmails: 0,
                  statusMessage: "No emails found",
                },
              });
            },
          });
          await inngest.send({
            name: "scan.completed",
            data: {
              schemaId,
              scanJobId,
              emailCount: 0,
              reason: "no-emails-found",
            },
          });
        });
        logger.info({
          service: "runScan",
          operation: "runScan.emptyScanComplete",
          scanJobId,
          schemaId,
        });
        return;
      }

      // ---- Step 3: DISCOVERING → EXTRACTING, hand off to pipeline --------
      // CAS advance and event emission are separate operations. Emitting
      // inside work() races with downstream functions that read the phase
      // before the CAS commits (see docs/01_denim_lessons_learned.md, Bug 3).
      await step.run("advance-to-extracting", async () => {
        await advanceScanPhase({
          scanJobId,
          from: "DISCOVERING",
          to: "EXTRACTING",
          work: async () => {
            // Phase-only transition — no side effects inside work().
          },
        });
      });

      await step.run("emit-discovered", async () => {
        await inngest.send({
          name: "scan.emails.discovered",
          data: {
            schemaId,
            userId,
            scanJobId,
            emailIds: actualEmailIds,
          },
        });
      });

      logger.info({
        service: "runScan",
        operation: "runScan.handedOff",
        scanJobId,
        schemaId,
        emailCount: actualEmailIds.length,
      });
      // The chain (fanOutExtraction → … → runSynthesis) runs independently
      // from here. runOnboarding listens for the scan.completed event that
      // runSynthesis emits at the end.
    } catch (error) {
      // NonRetriableError shouldn't be wrapped — rethrow so Inngest records
      // it as a terminal failure. Everything else flows through
      // markScanFailed so ScanJob.phase + status end up FAILED with the
      // error recorded.
      if (error instanceof NonRetriableError) throw error;

      logger.error({
        service: "runScan",
        operation: "runScan.caught",
        scanJobId,
        schemaId,
        error: error instanceof Error ? error.message : String(error),
      });

      // The error could have happened in DISCOVERING or in the handoff to
      // EXTRACTING. We record DISCOVERING as the failure phase because
      // that's the only phase runScan itself advances; anything later
      // (fanOutExtraction et al) records its own phase via its own handler.
      //
      // CRITICAL: both markScanFailed AND the scan.completed emit happen
      // inside step.run so Inngest makes them durable. Without step.run,
      // a crash between the mark and the emit (or a flaky network during
      // the emit) would leave runOnboarding hanging for the full 20-minute
      // timeout. step.run retries the emit on failure.
      await step.run("mark-scan-failed", async () => {
        await markScanFailed(scanJobId, "DISCOVERING", error);
      });
      await step.run("emit-scan-failed-event", async () => {
        await inngest.send({
          name: "scan.completed",
          data: {
            schemaId,
            scanJobId,
            reason: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      });

      throw error;
    }
  },
);
