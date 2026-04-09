/**
 * cronDailyScans — periodic re-scan emitter.
 *
 * Walks every ACTIVE CaseSchema whose `lastScannedAt` is stale (null or
 * older than the cron interval) and fires a `scan.requested` event for
 * each, which the `runScan` parent workflow picks up from there. No live
 * API calls happen inside this function — it only creates ScanJob rows
 * and emits events, so the critical-path runtime is bounded by Prisma
 * latency plus N × one Inngest event emission.
 *
 * ## Trigger shape (event-driven for v1, cron-ready)
 *
 * Task 17 intentionally leaves this function on an EVENT trigger
 * (`cron.daily.scans.trigger`) rather than a real `{ cron: "..." }`
 * trigger. The team can fire the event manually via the Inngest
 * dashboard or `inngest.send(...)` to validate the end-to-end wiring
 * against a dev environment before enabling the schedule in production.
 *
 * When ready to enable a real schedule, swap the `triggers` entry from
 *   `{ event: "cron.daily.scans.trigger" }`
 * to e.g.
 *   `{ cron: "TZ=UTC 0 6 * * *" }`
 * and the rest of the function continues to work unchanged. The
 * `STALE_THRESHOLD_MS` constant should be tuned to match the new cron
 * interval (e.g. 23h threshold for a daily 0 6 cron, so a user who
 * actively scanned at 5:45am doesn't get re-scanned at 6:00am).
 *
 * ## Stale filter
 *
 * A schema is "stale" and eligible for re-scan when:
 *   - `status === ACTIVE` (live schemas only — DRAFT, ONBOARDING, PAUSED,
 *     and ARCHIVED schemas are deliberately excluded; cron can't rescue
 *     a mid-flight onboarding or a user-paused schema), AND
 *   - `lastScannedAt IS NULL` (never scanned, e.g. an ACTIVE schema that
 *     was created before Task 17 landed and has no watermark yet), OR
 *     `lastScannedAt < now - STALE_THRESHOLD_MS` (aged out).
 *
 * ## Conflict handling
 *
 * Each per-schema step does a last-minute check for an already-active
 * ScanJob (status IN ["PENDING", "RUNNING"]) and skips emission if one
 * exists. This handles three scenarios cleanly:
 *   1. A manual rescan was kicked off seconds before the cron ran.
 *   2. A previous cron run's scan is still in progress (if the scan
 *      takes longer than the cron interval).
 *   3. An onboarding scan is mid-flight on a schema that just flipped
 *      to ACTIVE via the review-confirm handler.
 *
 * The `runScan` concurrency key (per schemaId, limit 1) would also catch
 * double-scheduling at the Inngest level, but the explicit DB check here
 * means we never create the orphaned ScanJob row in the first place.
 *
 * ## Task 17 scope boundaries
 *
 * This function does NOT:
 *   - handle per-schema `scanFrequency` settings (the user-facing
 *     "manual" / "daily" / "hourly" enum on CaseSchema). Honoring that
 *     requires either per-frequency cron functions or a single cron
 *     that partitions work — deferred to a follow-up.
 *   - respect user time zones. A global UTC cron isn't ideal for a
 *     user-facing "daily" label. Deferred.
 *   - perform its own retries or dead-lettering. If an individual
 *     per-schema step throws, Inngest's default retry policy applies
 *     to that step; other schemas in the batch still run.
 */
import type { CaseSchema } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { inngest } from "./client";

/**
 * 23 hours — a schema that last scanned 23h ago is considered stale
 * enough to re-scan on a daily cron. Tuning this shorter than 24h
 * gives slack so a daily cron that runs at 06:00 doesn't skip a
 * schema that last scanned at 06:05 the previous day.
 */
const STALE_THRESHOLD_MS = 23 * 60 * 60 * 1000;

type StaleSchemaRow = Pick<CaseSchema, "id" | "userId">;

export const cronDailyScans = inngest.createFunction(
  {
    id: "cron-daily-scans",
    triggers: [{ event: "cron.daily.scans.trigger" }],
    // Single instance — we don't want two concurrent cron runs racing
    // to create duplicate ScanJobs for the same schema.
    concurrency: { limit: 1 },
    // Per-step Inngest retries are fine; function-level retries would
    // re-walk the entire schema list and duplicate work. Keep retries
    // off at the top level.
    retries: 0,
  },
  async ({ step }) => {
    const startedAt = new Date();

    // -----------------------------------------------------------------
    // 1. Load stale ACTIVE schemas.
    // -----------------------------------------------------------------
    const staleSchemas: StaleSchemaRow[] = await step.run("load-stale-schemas", async () => {
      const cutoff = new Date(startedAt.getTime() - STALE_THRESHOLD_MS);
      return prisma.caseSchema.findMany({
        where: {
          status: "ACTIVE",
          OR: [{ lastScannedAt: null }, { lastScannedAt: { lt: cutoff } }],
        },
        select: { id: true, userId: true },
        orderBy: { lastScannedAt: { sort: "asc", nulls: "first" } },
      });
    });

    logger.info({
      service: "cron",
      operation: "cronDailyScans.loaded",
      staleCount: staleSchemas.length,
      cutoffMs: STALE_THRESHOLD_MS,
    });

    if (staleSchemas.length === 0) {
      return { staleCount: 0, emittedCount: 0, skippedCount: 0 };
    }

    // -----------------------------------------------------------------
    // 2. Per-schema step: conflict check + create ScanJob + emit event.
    //    Each schema runs in its own step.run for Inngest durability —
    //    if one schema's emission fails, the rest of the batch still
    //    completes.
    // -----------------------------------------------------------------
    let emittedCount = 0;
    let skippedCount = 0;
    for (const schema of staleSchemas) {
      const outcome = await step.run(
        `emit-scan-${schema.id}`,
        async (): Promise<"emitted" | "skipped-active-scan"> => {
          // Last-mile conflict check: don't create a duplicate scan if
          // something else (manual rescan, earlier cron run, onboarding)
          // is already running for this schema.
          const active = await prisma.scanJob.findFirst({
            where: {
              schemaId: schema.id,
              status: { in: ["PENDING", "RUNNING"] },
            },
            select: { id: true },
          });
          if (active) {
            return "skipped-active-scan";
          }

          const scanJob = await prisma.scanJob.create({
            data: {
              schemaId: schema.id,
              userId: schema.userId,
              status: "PENDING",
              phase: "PENDING",
              triggeredBy: "CRON_DAILY",
              totalEmails: 0,
            },
            select: { id: true },
          });

          await inngest.send({
            name: "scan.requested",
            data: {
              scanJobId: scanJob.id,
              schemaId: schema.id,
              userId: schema.userId,
            },
          });

          return "emitted";
        },
      );

      if (outcome === "emitted") emittedCount++;
      else skippedCount++;
    }

    logger.info({
      service: "cron",
      operation: "cronDailyScans.complete",
      staleCount: staleSchemas.length,
      emittedCount,
      skippedCount,
    });

    return {
      staleCount: staleSchemas.length,
      emittedCount,
      skippedCount,
    };
  },
);
