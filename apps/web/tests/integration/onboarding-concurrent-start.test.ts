/**
 * Concurrent POST /api/onboarding/start test.
 *
 * Fires three simultaneous POSTs with the same client-supplied ULID
 * and asserts that the server-side idempotency guard in Task 10 holds
 * under race conditions:
 *
 *   - all three requests return 202 (no 4xx / 5xx),
 *   - exactly one CaseSchema row lands in the DB,
 *   - at most one response carries `idempotent: false` (the "winner"
 *     that actually created the row; the losers see the existing row
 *     and return idempotent: true),
 *   - the winner's schemaId matches the client-supplied ULID (no
 *     server-side id generation path).
 *
 * The test does NOT wait for the Inngest workflow to complete. We
 * only care that the HTTP handler + createSchemaStub + idempotency
 * check hold under parallel load. The `runOnboarding` workflow that
 * fires off `onboarding.session.started` runs asynchronously; if the
 * Inngest dev server isn't up, the workflow never executes and the
 * schema stays in phase=PENDING forever — fine for this test.
 *
 * Requires BOTH dev servers running:
 *   - Next dev server on TEST_BASE_URL (default http://localhost:3000):
 *     `pnpm --filter web dev`
 *   - Inngest dev server on :8288: `npx inngest-cli@latest dev`
 *
 * The start route synchronously calls `inngest.send(...)` to emit
 * `onboarding.session.started`, so Inngest must be reachable or the
 * route returns 500. We don't care that the workflow actually runs
 * for this test, only that the event was accepted by the dev server.
 *
 * Run: pnpm --filter web exec vitest run --config vitest.integration.config.ts onboarding-concurrent-start
 */
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createApiClient } from "./helpers/api-client";
import {
  cleanupTestUser,
  createTestUser,
  seedGmailToken,
  type TestUser,
} from "./helpers/test-user";

describe("POST /api/onboarding/start — concurrent idempotency", () => {
  let testUser: TestUser;
  let api: ReturnType<typeof createApiClient>;
  const createdSchemaIds: string[] = [];

  beforeAll(async () => {
    testUser = await createTestUser();
    // Start route's 422 GMAIL_NOT_CONNECTED pre-flight gates on
    // `user.googleTokens` existence. The concurrent idempotency tests fire
    // valid bodies and expect 202 — seed a stub token so the pre-flight
    // passes. The Inngest workflow runs async after 202, so a stub is fine;
    // these tests never wait for Gmail calls.
    await seedGmailToken(testUser.userId);
    api = createApiClient(testUser.accessToken);
  }, 60_000);

  afterAll(async () => {
    // Delete any schemas this test created before tearing down the user
    // (cleanupTestUser would also drop them via cascade, but being explicit
    // makes the row count assertion above trustworthy).
    for (const id of createdSchemaIds) {
      await prisma.caseSchema.deleteMany({ where: { id } });
    }
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  const fixtureInputs = {
    role: "parent",
    domain: "school_parent",
    whats: ["Test School"],
    whos: [],
    groups: [] as Array<{ whats: string[]; whos: string[] }>,
    goals: ["actions"],
  };

  it("three parallel POSTs with the same ULID produce exactly one row", async () => {
    const schemaId = ulid();
    createdSchemaIds.push(schemaId);
    const body = { schemaId, inputs: fixtureInputs };

    const [r1, r2, r3] = await Promise.all([
      api.post("/api/onboarding/start", body),
      api.post("/api/onboarding/start", body),
      api.post("/api/onboarding/start", body),
    ]);

    // All three must have been accepted (202). The Task 10 handler always
    // returns 202 on both fresh and idempotent paths.
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(r3.status).toBe(202);

    // Response body shape: { data: { schemaId, idempotent } }. At least one
    // of the three must carry the freshly-created schemaId; at most one
    // should claim idempotent: false. Under a perfect-order race we expect
    // exactly one with false and two with true, but Prisma's unique-
    // constraint path could serialize the upserts in a way that makes all
    // three see the row as existing — we allow 0 or 1 with idempotent=false.
    const payloads = [r1, r2, r3].map((r) => {
      const data = (r.data as { data: { schemaId: string; idempotent: boolean } }).data;
      expect(data.schemaId).toBe(schemaId);
      return data;
    });
    const freshCount = payloads.filter((p) => p.idempotent === false).length;
    expect(freshCount).toBeLessThanOrEqual(1);

    // Exactly one CaseSchema row must exist for this id. This is the
    // structural invariant Task 10 exists to guarantee — if two writers
    // raced past the lookup check, we'd see the unique-constraint error
    // or (worse) a duplicate row.
    const rows = await prisma.caseSchema.count({ where: { id: schemaId } });
    expect(rows).toBe(1);

    // And that row must belong to the test user (not some other caller
    // who happened to be racing at the same time).
    const row = await prisma.caseSchema.findUniqueOrThrow({
      where: { id: schemaId },
      select: { userId: true, phase: true },
    });
    expect(row.userId).toBe(testUser.userId);

    // #33 outbox pattern: exactly one OnboardingOutbox row must also exist
    // for this schemaId. The outbox.schemaId PK is the sole idempotency
    // guard in the new route flow — if concurrent losers had slipped past
    // the unique constraint, we'd see 2+ rows here. We don't assert on
    // status because the optimistic emit is fire-and-forget and may or
    // may not have flipped PENDING_EMIT → EMITTED by the time this runs.
    const outboxRows = await prisma.onboardingOutbox.count({ where: { schemaId } });
    expect(outboxRows).toBe(1);
    const outbox = await prisma.onboardingOutbox.findUniqueOrThrow({
      where: {
        schemaId_eventName: { schemaId, eventName: "onboarding.session.started" },
      },
      select: { userId: true, eventName: true },
    });
    expect(outbox.userId).toBe(testUser.userId);
    expect(outbox.eventName).toBe("onboarding.session.started");
  }, 30_000);

  it("sequential retry with the same ULID is idempotent (second call returns idempotent=true)", async () => {
    const schemaId = ulid();
    createdSchemaIds.push(schemaId);
    const body = { schemaId, inputs: fixtureInputs };

    const first = await api.post("/api/onboarding/start", body);
    expect(first.status).toBe(202);
    const firstData = (first.data as { data: { schemaId: string; idempotent: boolean } }).data;
    expect(firstData.schemaId).toBe(schemaId);
    expect(firstData.idempotent).toBe(false);

    const second = await api.post("/api/onboarding/start", body);
    expect(second.status).toBe(202);
    const secondData = (second.data as { data: { schemaId: string; idempotent: boolean } }).data;
    expect(secondData.schemaId).toBe(schemaId);
    expect(secondData.idempotent).toBe(true);

    const rows = await prisma.caseSchema.count({ where: { id: schemaId } });
    expect(rows).toBe(1);
  }, 30_000);

  it("rejects unauthenticated request with 401", async () => {
    const unauthApi = createApiClient("invalid-token-abc123");
    const schemaId = ulid();
    const res = await unauthApi.post("/api/onboarding/start", {
      schemaId,
      inputs: fixtureInputs,
    });
    expect(res.status).toBe(401);

    // And no row should have been created.
    const rows = await prisma.caseSchema.count({ where: { id: schemaId } });
    expect(rows).toBe(0);
  }, 15_000);

  it("rejects invalid input with 400 (missing domain field)", async () => {
    const schemaId = ulid();
    const res = await api.post("/api/onboarding/start", {
      schemaId,
      inputs: {
        role: "parent",
        // missing: domain, whats, goals
      },
    });
    expect(res.status).toBe(400);

    // And no row should have been created.
    const rows = await prisma.caseSchema.count({ where: { id: schemaId } });
    expect(rows).toBe(0);
  }, 15_000);
});
