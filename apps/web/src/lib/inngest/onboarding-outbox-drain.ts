/**
 * drainOnboardingOutbox — generic transactional outbox drain (#33, #67).
 *
 * The `onboarding_outbox` table holds one row per (schemaId, eventName)
 * pair that needs to be emitted to Inngest. Producers write the row
 * inside the same Prisma transaction as the state change that triggered
 * it, then fire a best-effort `inngest.send` for happy-path latency. If
 * the optimistic emit fails (Inngest unreachable, network blip, cloud
 * outage), the row stays in `PENDING_EMIT` and this drain is the
 * guaranteed recovery path.
 *
 * Current producers:
 *   - POST /api/onboarding/start        -> "onboarding.session.started"  (#33)
 *   - POST /api/onboarding/[schemaId]   -> "onboarding.review.confirmed" (#67)
 *
 * The drain is event-generic: it reads `eventName` + `payload` from each
 * row and sends exactly what's there. Adding a new lifecycle event means
 * writing a new outbox row from a new producer — no drain change needed.
 *
 * Runs every minute. Pulls a small batch of `PENDING_EMIT` rows whose
 * `nextAttemptAt` has arrived, tries to emit each, and either flips the
 * row to `EMITTED` on success or bumps `attempts` + sets an exponential
 * backoff `nextAttemptAt` on failure. Rows that cross `MAX_ATTEMPTS`
 * transition to `DEAD_LETTER` for human attention.
 *
 * ## Duplicate-emission safety
 *
 * The producing route's optimistic emit and this drain can both fire
 * the same event. Downstream Inngest functions use `advanceSchemaPhase`
 * CAS guards and no-op when the schema has already moved past the
 * expected `from` phase — so double emission is safe at the workflow
 * layer.
 *
 * ## Cron vs event trigger
 *
 * This function uses a real `{ cron: "..." }` trigger. It's a
 * production recovery path that needs to run autonomously.
 */
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { inngest } from "./client";

/**
 * Minimal row shape the drain needs. Declared locally (not as
 * `Pick<OnboardingOutbox, ...>`) so the function can accept rows loaded
 * either from Prisma directly OR from inside an Inngest `step.run`
 * (where Dates are serialized to strings in the return type). The
 * primitive fields this type narrows to are stable across both.
 */
export interface DrainRow {
  schemaId: string;
  eventName: string;
  userId: string;
  attempts: number;
  payload: unknown;
}

/**
 * How many outbox rows to load per tick. Small enough that a single drain
 * run stays well under the function timeout even when every row fails,
 * large enough to handle normal bursts without falling behind.
 */
const BATCH_SIZE = 25;

/**
 * Maximum number of emission attempts before transitioning to DEAD_LETTER.
 * With exponential backoff capped at 60s, MAX_ATTEMPTS=10 gives roughly
 * 9 minutes of retries — enough to ride out transient Inngest outages
 * without flooding logs forever.
 */
const MAX_ATTEMPTS = 10;

/**
 * Exponential backoff with a 60-second cap. Matches the tone of the
 * existing AI `callWithRetry` policy.
 */
function backoffMs(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** attempts);
}

/**
 * Drain a single outbox row. Exported so the integration test can invoke
 * the row-level logic directly without wiring up a full Inngest runtime.
 */
export async function drainOutboxRow(row: DrainRow): Promise<"emitted" | "retry" | "dead_letter"> {
  // Composite PK on (schemaId, eventName) after #67; the `where` clause uses
  // the Prisma-generated compound key form.
  const whereKey = {
    schemaId_eventName: { schemaId: row.schemaId, eventName: row.eventName },
  };
  try {
    await inngest.send({
      name: row.eventName,
      // Payload is whatever the producer stored — passing it through
      // opaquely keeps the drain event-generic. Event-specific shape is
      // enforced by the producer and consumer, not by the drain.
      data: row.payload as Record<string, unknown>,
    });
    await prisma.onboardingOutbox.update({
      where: whereKey,
      data: {
        status: "EMITTED",
        emittedAt: new Date(),
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    return "emitted";
  } catch (err) {
    const nextAttempts = row.attempts + 1;
    const dead = nextAttempts >= MAX_ATTEMPTS;
    await prisma.onboardingOutbox.update({
      where: whereKey,
      data: {
        status: dead ? "DEAD_LETTER" : "PENDING_EMIT",
        attempts: nextAttempts,
        lastError: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
        lastAttemptAt: new Date(),
        nextAttemptAt: new Date(Date.now() + backoffMs(nextAttempts)),
      },
    });
    if (dead) {
      logger.error({
        service: "inngest",
        operation: "drainOnboardingOutbox.deadLetter",
        schemaId: row.schemaId,
        eventName: row.eventName,
        userId: row.userId,
        attempts: nextAttempts,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
    return dead ? "dead_letter" : "retry";
  }
}

export const drainOnboardingOutbox = inngest.createFunction(
  {
    id: "drain-onboarding-outbox",
    // Real cron — production recovery path, needs to run autonomously.
    triggers: [{ cron: "TZ=UTC */1 * * * *" }],
    // Single instance — we don't want two concurrent drain runs racing
    // to emit the same outbox row twice in one tick.
    concurrency: { limit: 1 },
    retries: 0,
  },
  async ({ step }) => {
    const rows: DrainRow[] = await step.run("load-pending", () =>
      prisma.onboardingOutbox.findMany({
        where: {
          status: "PENDING_EMIT",
          nextAttemptAt: { lte: new Date() },
          attempts: { lt: MAX_ATTEMPTS },
        },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        select: {
          schemaId: true,
          eventName: true,
          userId: true,
          attempts: true,
          payload: true,
        },
      }),
    );

    if (rows.length === 0) {
      return { loaded: 0, emitted: 0, retry: 0, deadLetter: 0 };
    }

    let emitted = 0;
    let retry = 0;
    let deadLetter = 0;

    for (const row of rows) {
      const outcome = await step.run(
        `emit-${row.schemaId}-${row.eventName}`,
        () => drainOutboxRow(row),
      );
      if (outcome === "emitted") emitted++;
      else if (outcome === "retry") retry++;
      else deadLetter++;
    }

    logger.info({
      service: "inngest",
      operation: "drainOnboardingOutbox.complete",
      loaded: rows.length,
      emitted,
      retry,
      deadLetter,
    });

    return { loaded: rows.length, emitted, retry, deadLetter };
  },
);
