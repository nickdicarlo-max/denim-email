/**
 * HTTP contract tests for the Phase 7 onboarding routes.
 *
 * Covers Tasks 11, 12, and 13 — every HTTP surface I can exercise
 * without running the Inngest workflow engine or touching live AI:
 *
 *   GET    /api/onboarding/:schemaId                   (Task 11 polling)
 *   POST   /api/onboarding/:schemaId                   (Task 11 review confirm)
 *   DELETE /api/onboarding/:schemaId                   (Task 11 cancel)
 *   POST   /api/onboarding/:schemaId/retry             (Task 12 retry)
 *   GET    /api/schemas/:schemaId/scans                (Task 13 list)
 *   POST   /api/schemas/:schemaId/scans                (Task 13 manual rescan)
 *   GET    /api/schemas/:schemaId/scans/:scanJobId     (Task 13 per-scan detail)
 *
 * Strategy: each test seeds a fresh CaseSchema in the specific
 * phase/status combination it wants to exercise, hits the route,
 * and asserts the DB + response shape. We don't wait for Inngest
 * workflows — the routes do their own CAS updates and event emits
 * synchronously, which is what we're testing.
 *
 * Requires a running Next dev server on TEST_BASE_URL (default
 * http://localhost:3000). Start with `pnpm --filter web dev`.
 *
 * Does NOT require an Inngest dev server. DELETE and retry send
 * events that are dropped on the floor if Inngest isn't running —
 * we only verify the DB-level side effects.
 *
 * Run: pnpm --filter web exec vitest run --config vitest.integration.config.ts onboarding-routes
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createApiClient } from "./helpers/api-client";
import { createTestSchema } from "./helpers/test-schema";
import { cleanupTestUser, createTestUser, type TestUser } from "./helpers/test-user";

describe("Onboarding routes — HTTP contracts", () => {
  let testUser: TestUser;
  let api: ReturnType<typeof createApiClient>;
  const createdSchemaIds: string[] = [];

  beforeAll(async () => {
    testUser = await createTestUser();
    api = createApiClient(testUser.accessToken);
  }, 60_000);

  afterAll(async () => {
    for (const id of createdSchemaIds) {
      await prisma.scanJob.deleteMany({ where: { schemaId: id } });
      await prisma.caseSchema.deleteMany({ where: { id } });
    }
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  /**
   * Seeds a fresh schema via the test-schema helper, then forces it into
   * a specific phase/status. Returns the schema id and tracks it for
   * cleanup.
   */
  async function seedSchema(opts: {
    phase:
      | "PENDING"
      | "GENERATING_HYPOTHESIS"
      // Issue #95 fast-discovery phases.
      | "DISCOVERING_DOMAINS"
      | "AWAITING_DOMAIN_CONFIRMATION"
      | "DISCOVERING_ENTITIES"
      | "AWAITING_ENTITY_CONFIRMATION"
      | "FINALIZING_SCHEMA"
      | "PROCESSING_SCAN"
      | "AWAITING_REVIEW"
      | "COMPLETED"
      | "NO_EMAILS_FOUND"
      | "FAILED";
    status?: "DRAFT" | "ONBOARDING" | "ACTIVE" | "PAUSED" | "ARCHIVED";
    phaseError?: string;
  }): Promise<string> {
    const result = await createTestSchema(testUser.userId);
    const schemaId = result.schema.id;
    createdSchemaIds.push(schemaId);

    await prisma.caseSchema.update({
      where: { id: schemaId },
      data: {
        phase: opts.phase,
        status: opts.status ?? "DRAFT",
        phaseError: opts.phaseError ?? null,
        phaseErrorAt: opts.phaseError ? new Date() : null,
        phaseUpdatedAt: new Date(),
      },
    });

    return schemaId;
  }

  // ---------------------------------------------------------------------
  // GET /api/onboarding/:schemaId — polling
  // ---------------------------------------------------------------------
  describe("GET /api/onboarding/[schemaId]", () => {
    it("returns flat polling response for a PENDING schema", async () => {
      const schemaId = await seedSchema({ phase: "PENDING" });
      const res = await api.get(`/api/onboarding/${schemaId}`);
      expect(res.status).toBe(200);
      const body = (
        res.data as {
          data: { schemaId: string; phase: string; progress: unknown };
        }
      ).data;
      expect(body.schemaId).toBe(schemaId);
      expect(body.phase).toBe("PENDING");
      expect(body.progress).toEqual({});
    });

    it("returns phase=COMPLETED + nextHref for a status=ACTIVE schema", async () => {
      const schemaId = await seedSchema({ phase: "COMPLETED", status: "ACTIVE" });
      const res = await api.get(`/api/onboarding/${schemaId}`);
      expect(res.status).toBe(200);
      const body = (
        res.data as {
          data: { phase: string; nextHref?: string };
        }
      ).data;
      expect(body.phase).toBe("COMPLETED");
      expect(body.nextHref).toBe(`/feed?schema=${schemaId}`);
    });

    it("returns phase=FAILED with error detail for a FAILED schema", async () => {
      const schemaId = await seedSchema({
        phase: "FAILED",
        phaseError: "[GENERATING_HYPOTHESIS] Claude rate limit exceeded",
      });
      const res = await api.get(`/api/onboarding/${schemaId}`);
      expect(res.status).toBe(200);
      const body = (
        res.data as {
          data: {
            phase: string;
            error?: { phase: string; message: string; retryable: boolean };
          };
        }
      ).data;
      expect(body.phase).toBe("FAILED");
      expect(body.error).toBeDefined();
      expect(body.error?.phase).toBe("GENERATING_HYPOTHESIS");
      expect(body.error?.message).toContain("rate limit");
      expect(body.error?.retryable).toBe(true);
    });

    it("returns 404 for a non-existent schemaId", async () => {
      const res = await api.get("/api/onboarding/does-not-exist-12345");
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // POST /api/onboarding/:schemaId — DEPRECATED shim (#95 Task 4.3, commit 2c13672)
  //
  // The single-screen review has been replaced by POST /:schemaId/domain-confirm
  // and POST /:schemaId/entity-confirm. This handler only absorbs stale retries:
  //   - New-flow / terminal phases  → 200 { status: "already-confirmed" }
  //   - Old-flow phases             → 410 Gone (points at /entity-confirm)
  // Body is not parsed, so Zod 400s no longer fire here.
  // ---------------------------------------------------------------------
  describe("POST /api/onboarding/[schemaId] — deprecation shim", () => {
    it("returns 410 Gone for AWAITING_REVIEW (old-flow phase)", async () => {
      const schemaId = await seedSchema({ phase: "AWAITING_REVIEW" });
      const res = await api.post(`/api/onboarding/${schemaId}`, {
        topicName: "Old-flow body",
        entityToggles: [],
      });
      expect(res.status).toBe(410);

      // Schema must not have moved — deprecation shim is side-effect-free.
      const row = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { phase: true, status: true },
      });
      expect(row.phase).toBe("AWAITING_REVIEW");
      expect(row.status).toBe("DRAFT");
    });

    it("returns 200 already-confirmed for an ACTIVE (terminal) schema", async () => {
      const schemaId = await seedSchema({ phase: "COMPLETED", status: "ACTIVE" });
      const res = await api.post(`/api/onboarding/${schemaId}`, {
        topicName: "Late retry",
        entityToggles: [],
      });
      expect(res.status).toBe(200);
      const body = (res.data as { data: { status: string } }).data;
      expect(body.status).toBe("already-confirmed");
    });

    it("returns 200 already-confirmed when the schema is in a new-flow phase", async () => {
      const schemaId = await seedSchema({ phase: "PROCESSING_SCAN" });
      const res = await api.post(`/api/onboarding/${schemaId}`, {
        topicName: "Late retry",
        entityToggles: [],
      });
      expect(res.status).toBe(200);
      const body = (res.data as { data: { status: string } }).data;
      expect(body.status).toBe("already-confirmed");
    });

    it("accepts an empty body — no Zod validation on the shim", async () => {
      const schemaId = await seedSchema({ phase: "AWAITING_DOMAIN_CONFIRMATION" });
      const res = await api.post(`/api/onboarding/${schemaId}`, {});
      expect(res.status).toBe(200);
      const body = (res.data as { data: { status: string } }).data;
      expect(body.status).toBe("already-confirmed");
    });
  });

  // ---------------------------------------------------------------------
  // DELETE /api/onboarding/:schemaId — cancel
  // ---------------------------------------------------------------------
  describe("DELETE /api/onboarding/[schemaId] (cancel)", () => {
    it("flips status to ARCHIVED and clears phase", async () => {
      const schemaId = await seedSchema({ phase: "PROCESSING_SCAN" });
      const res = await api.delete(`/api/onboarding/${schemaId}`);
      expect(res.status).toBe(200);
      const body = (res.data as { data: { status: string } }).data;
      expect(body.status).toBe("cancelled");

      const row = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { phase: true, status: true },
      });
      expect(row.status).toBe("ARCHIVED");
      expect(row.phase).toBeNull();
    });

    it("idempotent: already-ARCHIVED schema returns already-cancelled", async () => {
      const schemaId = await seedSchema({ phase: "PROCESSING_SCAN" });
      await prisma.caseSchema.update({
        where: { id: schemaId },
        data: { status: "ARCHIVED", phase: null },
      });

      const res = await api.delete(`/api/onboarding/${schemaId}`);
      expect(res.status).toBe(200);
      const body = (res.data as { data: { status: string } }).data;
      expect(body.status).toBe("already-cancelled");
    });
  });

  // ---------------------------------------------------------------------
  // POST /api/onboarding/:schemaId/retry — resume from failed phase
  // ---------------------------------------------------------------------
  describe("POST /api/onboarding/[schemaId]/retry", () => {
    it("parses phaseError and resets schema to the failed phase", async () => {
      const schemaId = await seedSchema({
        phase: "FAILED",
        phaseError: "[FINALIZING_SCHEMA] disk full during persist",
      });

      const res = await api.post(`/api/onboarding/${schemaId}/retry`);
      expect(res.status).toBe(200);
      const body = (
        res.data as {
          data: { schemaId: string; status: string; resumeFrom: string };
        }
      ).data;
      expect(body.schemaId).toBe(schemaId);
      expect(body.status).toBe("retrying");
      expect(body.resumeFrom).toBe("FINALIZING_SCHEMA");

      const row = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { phase: true, phaseError: true, phaseErrorAt: true },
      });
      expect(row.phase).toBe("FINALIZING_SCHEMA");
      expect(row.phaseError).toBeNull();
      expect(row.phaseErrorAt).toBeNull();
    });

    it("falls back to PENDING when phaseError is malformed", async () => {
      const schemaId = await seedSchema({
        phase: "FAILED",
        phaseError: "just a plain message with no [PHASE] prefix",
      });

      const res = await api.post(`/api/onboarding/${schemaId}/retry`);
      expect(res.status).toBe(200);
      const body = (res.data as { data: { resumeFrom: string } }).data;
      expect(body.resumeFrom).toBe("PENDING");

      const row = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { phase: true },
      });
      expect(row.phase).toBe("PENDING");
    });

    it("rejects retry from a non-FAILED phase with 409", async () => {
      const schemaId = await seedSchema({ phase: "AWAITING_REVIEW" });
      const res = await api.post(`/api/onboarding/${schemaId}/retry`);
      expect(res.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------
  // GET / POST /api/schemas/:schemaId/scans — Task 13 scan management
  // ---------------------------------------------------------------------
  describe("GET /api/schemas/[schemaId]/scans — list", () => {
    it("returns scan jobs for the schema with computed metrics", async () => {
      const schemaId = await seedSchema({ phase: "COMPLETED", status: "ACTIVE" });

      // Seed two scan jobs with different triggers.
      const scanA = await prisma.scanJob.create({
        data: {
          schemaId,
          userId: testUser.userId,
          status: "COMPLETED",
          phase: "COMPLETED",
          triggeredBy: "ONBOARDING",
          totalEmails: 5,
        },
      });
      const scanB = await prisma.scanJob.create({
        data: {
          schemaId,
          userId: testUser.userId,
          status: "COMPLETED",
          phase: "COMPLETED",
          triggeredBy: "MANUAL",
          totalEmails: 10,
        },
      });

      const res = await api.get(`/api/schemas/${schemaId}/scans`);
      expect(res.status).toBe(200);
      const body = (
        res.data as {
          data: Array<{
            id: string;
            triggeredBy: string;
            metrics: { totalEmails: number };
          }>;
        }
      ).data;
      expect(body.length).toBeGreaterThanOrEqual(2);

      const rowA = body.find((s) => s.id === scanA.id);
      const rowB = body.find((s) => s.id === scanB.id);
      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();
      expect(rowA?.metrics.totalEmails).toBe(5);
      expect(rowB?.metrics.totalEmails).toBe(10);
      expect(rowA?.triggeredBy).toBe("ONBOARDING");
      expect(rowB?.triggeredBy).toBe("MANUAL");
    });
  });

  describe("POST /api/schemas/[schemaId]/scans — manual rescan", () => {
    it("creates a new triggeredBy=MANUAL ScanJob and returns 202", async () => {
      const schemaId = await seedSchema({ phase: "COMPLETED", status: "ACTIVE" });
      const res = await api.post(`/api/schemas/${schemaId}/scans`);
      expect(res.status).toBe(202);
      const body = (res.data as { data: { scanJobId: string; status: string } }).data;
      expect(body.status).toBe("queued");
      expect(body.scanJobId).toBeTruthy();

      const scan = await prisma.scanJob.findUniqueOrThrow({
        where: { id: body.scanJobId },
        select: { schemaId: true, triggeredBy: true, phase: true, status: true },
      });
      expect(scan.schemaId).toBe(schemaId);
      expect(scan.triggeredBy).toBe("MANUAL");
      expect(scan.phase).toBe("PENDING");
      expect(scan.status).toBe("PENDING");
    });

    it("returns 409 when an active scan already exists", async () => {
      const schemaId = await seedSchema({ phase: "COMPLETED", status: "ACTIVE" });

      // Seed an active PENDING scan before calling POST.
      const existing = await prisma.scanJob.create({
        data: {
          schemaId,
          userId: testUser.userId,
          status: "PENDING",
          phase: "DISCOVERING",
          triggeredBy: "CRON_DAILY",
          totalEmails: 0,
        },
      });

      const res = await api.post(`/api/schemas/${schemaId}/scans`);
      expect(res.status).toBe(409);
      const body = res.data as {
        data?: { scanJobId: string };
      };
      expect(body.data?.scanJobId).toBe(existing.id);
    });
  });

  describe("GET /api/schemas/[schemaId]/scans/[scanJobId] — detail", () => {
    it("returns the scan row with failures and metrics", async () => {
      const schemaId = await seedSchema({ phase: "COMPLETED", status: "ACTIVE" });
      const scan = await prisma.scanJob.create({
        data: {
          schemaId,
          userId: testUser.userId,
          status: "COMPLETED",
          phase: "COMPLETED",
          triggeredBy: "ONBOARDING",
          totalEmails: 2,
        },
      });
      await prisma.scanFailure.create({
        data: {
          scanJobId: scan.id,
          schemaId,
          gmailMessageId: "msg_detail_fail_1",
          phase: "EXTRACTING",
          errorMessage: "seeded failure for detail test",
        },
      });

      const res = await api.get(`/api/schemas/${schemaId}/scans/${scan.id}`);
      expect(res.status).toBe(200);
      const body = (
        res.data as {
          data: {
            id: string;
            failures: Array<{ gmailMessageId: string; errorMessage: string }>;
            metrics: { totalEmails: number; failedEmails: number };
          };
        }
      ).data;
      expect(body.id).toBe(scan.id);
      expect(body.failures).toHaveLength(1);
      expect(body.failures[0].gmailMessageId).toBe("msg_detail_fail_1");
      expect(body.metrics.totalEmails).toBe(2);
      expect(body.metrics.failedEmails).toBe(1);
    });

    it("returns 404 when scanJobId belongs to a different schema", async () => {
      const schemaA = await seedSchema({ phase: "COMPLETED", status: "ACTIVE" });
      const schemaB = await seedSchema({ phase: "COMPLETED", status: "ACTIVE" });
      const scanInB = await prisma.scanJob.create({
        data: {
          schemaId: schemaB,
          userId: testUser.userId,
          status: "COMPLETED",
          phase: "COMPLETED",
          triggeredBy: "ONBOARDING",
          totalEmails: 0,
        },
      });

      // Ask for schemaA's view of schemaB's scan — should 404.
      const res = await api.get(`/api/schemas/${schemaA}/scans/${scanInB.id}`);
      expect(res.status).toBe(404);
    });
  });
});
