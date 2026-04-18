/**
 * Integration tests for derivePollingResponse — the merge function that
 * flattens the (CaseSchema.phase, ScanJob.phase) state machines into a
 * single client-facing polling response.
 *
 * Uses real DB rows rather than hand-mocked Prisma types because CaseSchema
 * has ~15 required fields (JSON configs, prompts, etc.) that would be tedious
 * to hand-construct. Every branch in derivePollingResponse has a test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { derivePollingResponse } from "@/lib/services/onboarding-polling";
import { createTestSchema, type TestSchemaResult } from "../helpers/test-schema";
import { cleanupTestUser, createTestUser, type TestUser } from "../helpers/test-user";
import { withTimeout } from "../helpers/timeout";

let testUser: TestUser;

async function freshSchema(overrides: {
  phase?:
    | "PENDING"
    | "GENERATING_HYPOTHESIS"
    | "FINALIZING_SCHEMA"
    | "PROCESSING_SCAN"
    | "AWAITING_REVIEW"
    | "COMPLETED"
    | "NO_EMAILS_FOUND"
    | "FAILED"
    | null;
  status?: "DRAFT" | "ONBOARDING" | "ACTIVE" | "PAUSED";
  phaseError?: string | null;
}): Promise<TestSchemaResult> {
  const ts = await createTestSchema(testUser.userId);
  await prisma.caseSchema.update({
    where: { id: ts.schema.id },
    data: {
      phase: overrides.phase ?? null,
      status: overrides.status ?? "DRAFT",
      phaseError: overrides.phaseError ?? null,
    },
  });
  return ts;
}

async function freshSchemaRow(overrides: Parameters<typeof freshSchema>[0]) {
  const ts = await freshSchema(overrides);
  const row = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: ts.schema.id },
  });
  return { ts, row };
}

async function seedScan(
  schemaId: string,
  opts: {
    phase:
      | "PENDING"
      | "IDLE"
      | "DISCOVERING"
      | "EXTRACTING"
      | "CLUSTERING"
      | "SYNTHESIZING"
      | "COMPLETED"
      | "FAILED";
    totalEmails?: number;
    errorPhase?:
      | "PENDING"
      | "IDLE"
      | "DISCOVERING"
      | "EXTRACTING"
      | "CLUSTERING"
      | "SYNTHESIZING"
      | "COMPLETED"
      | "FAILED";
    errorMessage?: string;
  },
) {
  return prisma.scanJob.create({
    data: {
      schemaId,
      userId: testUser.userId,
      triggeredBy: "ONBOARDING",
      phase: opts.phase,
      totalEmails: opts.totalEmails ?? 0,
      errorPhase: opts.errorPhase ?? null,
      errorMessage: opts.errorMessage ?? null,
    },
  });
}

async function cleanupSchema(schemaId: string): Promise<void> {
  await prisma.caseSchema.delete({ where: { id: schemaId } });
}

describe("derivePollingResponse", () => {
  beforeAll(async () => {
    testUser = await withTimeout(createTestUser(), 30_000, "createTestUser");
  });

  afterAll(async () => {
    await cleanupTestUser(testUser.userId);
  });

  // -------------------------------------------------------------------------
  // Pre-scan phases
  // -------------------------------------------------------------------------
  describe("pre-scan schema phases", () => {
    it("PENDING → PENDING", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PENDING" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("PENDING");
        expect(res.schemaId).toBe(ts.schema.id);
        expect(res.progress).toEqual({});
        expect(res.error).toBeUndefined();
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("GENERATING_HYPOTHESIS → GENERATING_HYPOTHESIS", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "GENERATING_HYPOTHESIS" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("GENERATING_HYPOTHESIS");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    // Legacy row fallback: FINALIZING_SCHEMA no longer appears in the new
    // #95 flow, but existing rows may still be in that phase after a
    // partial migration. derivePollingResponse maps them to
    // GENERATING_HYPOTHESIS so the UI renders a plausible "setting up…"
    // state instead of flashing to PENDING via the unknown-phase fallback.
    it("FINALIZING_SCHEMA → GENERATING_HYPOTHESIS (legacy row fallback)", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "FINALIZING_SCHEMA" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("GENERATING_HYPOTHESIS");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });
  });

  // -------------------------------------------------------------------------
  // PROCESSING_SCAN — drills into the active ScanJob
  // -------------------------------------------------------------------------
  describe("PROCESSING_SCAN drills into the active scan", () => {
    it("scan phase DISCOVERING → DISCOVERING", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PROCESSING_SCAN" });
      try {
        const scan = await seedScan(ts.schema.id, { phase: "DISCOVERING" });
        const res = await derivePollingResponse(row, scan);
        expect(res.phase).toBe("DISCOVERING");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("scan phase EXTRACTING → EXTRACTING with progress counters", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PROCESSING_SCAN" });
      try {
        const scan = await seedScan(ts.schema.id, {
          phase: "EXTRACTING",
          totalEmails: 100,
        });
        const res = await derivePollingResponse(row, scan);
        expect(res.phase).toBe("EXTRACTING");
        expect(res.progress.emailsTotal).toBe(100);
        expect(res.progress.emailsProcessed).toBe(0);
        expect(res.progress.emailsExcluded).toBe(0);
        expect(res.progress.emailsFailed).toBe(0);
        expect(res.progress.casesTotal).toBe(0);
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("scan phase CLUSTERING → CLUSTERING", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PROCESSING_SCAN" });
      try {
        const scan = await seedScan(ts.schema.id, { phase: "CLUSTERING" });
        const res = await derivePollingResponse(row, scan);
        expect(res.phase).toBe("CLUSTERING");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("scan phase SYNTHESIZING → SYNTHESIZING", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PROCESSING_SCAN" });
      try {
        const scan = await seedScan(ts.schema.id, { phase: "SYNTHESIZING" });
        const res = await derivePollingResponse(row, scan);
        expect(res.phase).toBe("SYNTHESIZING");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("scan phase COMPLETED → SYNTHESIZING (orchestrator hasn't flipped schema yet)", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PROCESSING_SCAN" });
      try {
        const scan = await seedScan(ts.schema.id, { phase: "COMPLETED" });
        const res = await derivePollingResponse(row, scan);
        expect(res.phase).toBe("SYNTHESIZING");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("scan phase PENDING maps to DISCOVERING (don't flash in-between state)", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PROCESSING_SCAN" });
      try {
        const scan = await seedScan(ts.schema.id, { phase: "PENDING" });
        const res = await derivePollingResponse(row, scan);
        expect(res.phase).toBe("DISCOVERING");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("scan FAILED during PROCESSING_SCAN → FAILED with errorPhase + message", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PROCESSING_SCAN" });
      try {
        const scan = await seedScan(ts.schema.id, {
          phase: "FAILED",
          errorPhase: "EXTRACTING",
          errorMessage: "gemini timeout",
        });
        const res = await derivePollingResponse(row, scan);
        expect(res.phase).toBe("FAILED");
        expect(res.error?.phase).toBe("EXTRACTING");
        expect(res.error?.message).toContain("gemini timeout");
        expect(res.error?.retryable).toBe(true);
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("PROCESSING_SCAN with no scan row → defensive DISCOVERING fallback", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PROCESSING_SCAN" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("DISCOVERING");
        // Progress stays empty in the defensive fallback — no scan metrics to read.
        expect(res.progress).toEqual({});
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Terminal states
  // -------------------------------------------------------------------------
  describe("terminal states", () => {
    it("schema status ACTIVE → COMPLETED with nextHref", async () => {
      const { ts, row } = await freshSchemaRow({ phase: null, status: "ACTIVE" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("COMPLETED");
        expect(res.nextHref).toBe(`/feed?schema=${ts.schema.id}`);
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("ACTIVE status takes precedence over FAILED phase", async () => {
      // Edge case: a stale phase=FAILED shouldn't block an already-live schema.
      const { ts, row } = await freshSchemaRow({
        phase: "FAILED",
        status: "ACTIVE",
        phaseError: "[PROCESSING_SCAN] old failure",
      });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("COMPLETED");
        expect(res.error).toBeUndefined();
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("phase NO_EMAILS_FOUND → NO_EMAILS_FOUND", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "NO_EMAILS_FOUND" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("NO_EMAILS_FOUND");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("phase AWAITING_REVIEW → AWAITING_REVIEW", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "AWAITING_REVIEW" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("AWAITING_REVIEW");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("phase FAILED → FAILED with extracted errorPhase from phaseError", async () => {
      const { ts, row } = await freshSchemaRow({
        phase: "FAILED",
        phaseError: "[GENERATING_HYPOTHESIS] claude 429",
      });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("FAILED");
        expect(res.error?.phase).toBe("GENERATING_HYPOTHESIS");
        expect(res.error?.message).toContain("claude 429");
        expect(res.error?.retryable).toBe(true);
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("phase FAILED with malformed phaseError → UNKNOWN error phase", async () => {
      const { ts, row } = await freshSchemaRow({
        phase: "FAILED",
        phaseError: "no brackets here",
      });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("FAILED");
        expect(res.error?.phase).toBe("UNKNOWN");
        expect(res.error?.message).toBe("no brackets here");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("phase COMPLETED (not yet ACTIVE) → COMPLETED with nextHref", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "COMPLETED" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("COMPLETED");
        expect(res.nextHref).toBe(`/feed?schema=${ts.schema.id}`);
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------
  describe("response shape", () => {
    it("includes updatedAt as an ISO string", async () => {
      const { ts, row } = await freshSchemaRow({ phase: "PENDING" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("defensive fallback on null phase (unknown state) → PENDING", async () => {
      const { ts, row } = await freshSchemaRow({ phase: null, status: "DRAFT" });
      try {
        const res = await derivePollingResponse(row, null);
        expect(res.phase).toBe("PENDING");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });
  });
});
