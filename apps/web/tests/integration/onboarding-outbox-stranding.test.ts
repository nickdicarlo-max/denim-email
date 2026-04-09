/**
 * Inngest-outage stranding recovery test (#33).
 *
 * Pins the second failure mode that the transactional outbox refactor
 * was designed to fix: if `inngest.send` fails after the route commits
 * the CaseSchema stub + OnboardingOutbox row, the outbox row must stay
 * in `PENDING_EMIT` and the `drainOnboardingOutbox` cron must be able
 * to re-emit it later once Inngest is healthy again.
 *
 * Pre-refactor, a transient Inngest outage would leave the schema in
 * `phase=PENDING` with no workflow ever running, and the next retry
 * with the same schemaId would hit the idempotency fast-path and
 * return 202 without re-emitting. See issue #33 for the full analysis.
 *
 * ## Why this test doesn't fire a real POST
 *
 * The optimistic emit is fire-and-forget inside the route handler —
 * we can't reliably stub it from the test process because the route
 * runs in the Next dev server. Instead this test seeds the outbox row
 * directly (matching the shape the route would write on a transient
 * failure where the optimistic send threw) and then exercises the
 * drain path in isolation. The concurrent-start integration test
 * already covers the route→outbox write side of the contract.
 *
 * Requires the Next dev server and Inngest dev server running (same
 * preconditions as the rest of the integration suite). The Inngest
 * server must be reachable for the drain's real-emit step to succeed.
 *
 * Run: pnpm --filter web exec vitest run --config vitest.integration.config.ts onboarding-outbox-stranding
 */
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inngest } from "@/lib/inngest/client";
import { drainOutboxRow } from "@/lib/inngest/onboarding-outbox-drain";
import { prisma } from "@/lib/prisma";
import { createSchemaStub } from "@/lib/services/interview";
import { cleanupTestUser, createTestUser, type TestUser } from "./helpers/test-user";

describe("OnboardingOutbox drain — Inngest-outage stranding recovery (#33)", () => {
  let testUser: TestUser;
  const createdSchemaIds: string[] = [];

  const fixtureInputs = {
    role: "parent",
    domain: "school_parent",
    whats: ["Test School"],
    whos: [],
    groups: [] as Array<{ whats: string[]; whos: string[] }>,
    goals: ["actions"],
  };

  beforeAll(async () => {
    testUser = await createTestUser();
  }, 60_000);

  afterAll(async () => {
    for (const id of createdSchemaIds) {
      // Cascade deletes the OnboardingOutbox row via FK.
      await prisma.caseSchema.deleteMany({ where: { id } });
    }
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  it("stranded PENDING_EMIT row is recovered by the drain on the next tick", async () => {
    const schemaId = ulid();
    createdSchemaIds.push(schemaId);

    // Seed the state the route would leave after a transient Inngest
    // outage: the tx committed (stub + outbox row) and the best-effort
    // optimistic emit threw. The outbox row is still PENDING_EMIT with
    // attempts=0 (the optimistic failure never updated the row).
    await prisma.$transaction(async (tx) => {
      await createSchemaStub({
        tx,
        schemaId,
        userId: testUser.userId,
        inputs: fixtureInputs,
      });
      await tx.onboardingOutbox.create({
        data: {
          schemaId,
          userId: testUser.userId,
          eventName: "onboarding.session.started",
          payload: { schemaId, userId: testUser.userId },
        },
      });
    });

    // Sanity: stub in PENDING, outbox in PENDING_EMIT with no emissions.
    const preSchema = await prisma.caseSchema.findUniqueOrThrow({
      where: { id: schemaId },
      select: { phase: true },
    });
    expect(preSchema.phase).toBe("PENDING");

    const preOutbox = await prisma.onboardingOutbox.findUniqueOrThrow({
      where: { schemaId },
      select: { status: true, attempts: true, emittedAt: true },
    });
    expect(preOutbox.status).toBe("PENDING_EMIT");
    expect(preOutbox.attempts).toBe(0);
    expect(preOutbox.emittedAt).toBeNull();

    // Load the row shape the drain works with and run a single pass.
    const row = await prisma.onboardingOutbox.findUniqueOrThrow({ where: { schemaId } });
    const outcome = await drainOutboxRow(row);

    // Happy path: Inngest is healthy, the event is accepted, the row
    // flips to EMITTED.
    expect(outcome).toBe("emitted");

    const postOutbox = await prisma.onboardingOutbox.findUniqueOrThrow({
      where: { schemaId },
      select: { status: true, attempts: true, emittedAt: true, lastError: true },
    });
    expect(postOutbox.status).toBe("EMITTED");
    expect(postOutbox.attempts).toBe(1);
    expect(postOutbox.emittedAt).not.toBeNull();
    expect(postOutbox.lastError).toBeNull();
  }, 30_000);

  it("failed emit backs off and stays in PENDING_EMIT until MAX_ATTEMPTS", async () => {
    const schemaId = ulid();
    createdSchemaIds.push(schemaId);

    // Seed a fresh stranded row.
    await prisma.$transaction(async (tx) => {
      await createSchemaStub({
        tx,
        schemaId,
        userId: testUser.userId,
        inputs: fixtureInputs,
      });
      await tx.onboardingOutbox.create({
        data: {
          schemaId,
          userId: testUser.userId,
          eventName: "onboarding.session.started",
          payload: { schemaId, userId: testUser.userId },
        },
      });
    });

    // Force inngest.send to throw — simulates a transient outage during
    // the drain's own emit step.
    const sendSpy = vi.spyOn(inngest, "send").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    try {
      const row = await prisma.onboardingOutbox.findUniqueOrThrow({ where: { schemaId } });
      const outcome = await drainOutboxRow(row);
      expect(outcome).toBe("retry");
    } finally {
      sendSpy.mockRestore();
    }

    const postOutbox = await prisma.onboardingOutbox.findUniqueOrThrow({
      where: { schemaId },
      select: {
        status: true,
        attempts: true,
        lastError: true,
        lastAttemptAt: true,
        nextAttemptAt: true,
        emittedAt: true,
      },
    });
    expect(postOutbox.status).toBe("PENDING_EMIT");
    expect(postOutbox.attempts).toBe(1);
    expect(postOutbox.lastError).toContain("ECONNREFUSED");
    expect(postOutbox.lastAttemptAt).not.toBeNull();
    expect(postOutbox.emittedAt).toBeNull();
    // Backoff pushed nextAttemptAt into the future (capped at 60s).
    expect(postOutbox.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  }, 30_000);
});
