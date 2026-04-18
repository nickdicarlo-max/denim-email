/**
 * Integration tests for the onboarding state-machine helpers.
 *
 * Covers phaseIndex/scanPhaseIndex ordering, the happy-path CAS transition,
 * idempotent skip on a re-run, unexpected-pre-state error, and the CAS-loss
 * case where another writer advances the row between our read and write.
 *
 * Runs against the live DB via the integration harness — CaseSchema.update
 * has a hard FK on User and requires real rows, so mocking the client would
 * lose the invariants we're trying to prove.
 */
import { NonRetriableError } from "inngest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  advanceScanPhase,
  advanceSchemaPhase,
  markScanFailed,
  markSchemaFailed,
  phaseIndex,
  scanPhaseIndex,
} from "@/lib/services/onboarding-state";
import { createTestSchema, type TestSchemaResult } from "../helpers/test-schema";
import { cleanupTestUser, createTestUser, type TestUser } from "../helpers/test-user";
import { withTimeout } from "../helpers/timeout";

let testUser: TestUser;

async function seedSchema(
  phase:
    | "PENDING"
    | "GENERATING_HYPOTHESIS"
    | "FINALIZING_SCHEMA"
    | "PROCESSING_SCAN"
    | "AWAITING_REVIEW"
    | "COMPLETED"
    | "NO_EMAILS_FOUND"
    | "FAILED"
    | null,
): Promise<TestSchemaResult> {
  const ts = await createTestSchema(testUser.userId);
  await prisma.caseSchema.update({
    where: { id: ts.schema.id },
    data: { phase },
  });
  return ts;
}

async function cleanupSchema(schemaId: string): Promise<void> {
  // Cascade removes entities, tags, fields, scanJobs etc. created by helper.
  await prisma.caseSchema.delete({ where: { id: schemaId } });
}

async function seedScan(
  schemaId: string,
  phase:
    | "PENDING"
    | "IDLE"
    | "DISCOVERING"
    | "EXTRACTING"
    | "CLUSTERING"
    | "SYNTHESIZING"
    | "COMPLETED"
    | "FAILED",
) {
  return prisma.scanJob.create({
    data: {
      schemaId,
      userId: testUser.userId,
      totalEmails: 0,
      triggeredBy: "ONBOARDING",
      phase,
    },
  });
}

describe("onboarding-state helpers", () => {
  beforeAll(async () => {
    testUser = await withTimeout(createTestUser(), 30_000, "createTestUser");
  });

  afterAll(async () => {
    await cleanupTestUser(testUser.userId);
  });

  // -------------------------------------------------------------------------
  // Phase ordering
  // -------------------------------------------------------------------------
  describe("phaseIndex", () => {
    it("orders schema phases monotonically", () => {
      // Issue #95 fast-discovery order (AWAITING_REVIEW is legacy, kept
      // before PROCESSING_SCAN so old rows still compare sanely).
      expect(phaseIndex("PENDING")).toBeLessThan(phaseIndex("GENERATING_HYPOTHESIS"));
      expect(phaseIndex("GENERATING_HYPOTHESIS")).toBeLessThan(phaseIndex("DISCOVERING_DOMAINS"));
      expect(phaseIndex("DISCOVERING_DOMAINS")).toBeLessThan(
        phaseIndex("AWAITING_DOMAIN_CONFIRMATION"),
      );
      expect(phaseIndex("AWAITING_DOMAIN_CONFIRMATION")).toBeLessThan(
        phaseIndex("DISCOVERING_ENTITIES"),
      );
      expect(phaseIndex("DISCOVERING_ENTITIES")).toBeLessThan(
        phaseIndex("AWAITING_ENTITY_CONFIRMATION"),
      );
      expect(phaseIndex("AWAITING_ENTITY_CONFIRMATION")).toBeLessThan(
        phaseIndex("FINALIZING_SCHEMA"),
      );
      expect(phaseIndex("FINALIZING_SCHEMA")).toBeLessThan(phaseIndex("AWAITING_REVIEW"));
      expect(phaseIndex("AWAITING_REVIEW")).toBeLessThan(phaseIndex("PROCESSING_SCAN"));
      expect(phaseIndex("PROCESSING_SCAN")).toBeLessThan(phaseIndex("COMPLETED"));
    });

    it("treats terminal states as max index", () => {
      expect(phaseIndex("FAILED")).toBeGreaterThanOrEqual(phaseIndex("COMPLETED"));
      expect(phaseIndex("NO_EMAILS_FOUND")).toBeGreaterThanOrEqual(phaseIndex("COMPLETED"));
    });

    it("returns -1 for null/undefined phases", () => {
      expect(phaseIndex(null)).toBe(-1);
      expect(phaseIndex(undefined)).toBe(-1);
    });
  });

  describe("scanPhaseIndex", () => {
    it("orders scan phases monotonically", () => {
      expect(scanPhaseIndex("PENDING")).toBeLessThan(scanPhaseIndex("DISCOVERING"));
      expect(scanPhaseIndex("DISCOVERING")).toBeLessThan(scanPhaseIndex("EXTRACTING"));
      expect(scanPhaseIndex("EXTRACTING")).toBeLessThan(scanPhaseIndex("CLUSTERING"));
      expect(scanPhaseIndex("CLUSTERING")).toBeLessThan(scanPhaseIndex("SYNTHESIZING"));
      expect(scanPhaseIndex("SYNTHESIZING")).toBeLessThan(scanPhaseIndex("COMPLETED"));
    });

    it("treats PENDING and IDLE as equivalent initial states", () => {
      expect(scanPhaseIndex("PENDING")).toBe(scanPhaseIndex("IDLE"));
    });

    it("treats FAILED as max index", () => {
      expect(scanPhaseIndex("FAILED")).toBeGreaterThanOrEqual(scanPhaseIndex("COMPLETED"));
    });
  });

  // -------------------------------------------------------------------------
  // advanceSchemaPhase
  // -------------------------------------------------------------------------
  describe("advanceSchemaPhase", () => {
    it("advances from expected pre-state to post-state and runs work()", async () => {
      const ts = await seedSchema("PENDING");
      try {
        let workRan = false;
        const result = await advanceSchemaPhase({
          schemaId: ts.schema.id,
          from: "PENDING",
          to: "GENERATING_HYPOTHESIS",
          work: async () => {
            workRan = true;
            return "worked";
          },
        });
        expect(workRan).toBe(true);
        expect(result).toBe("worked");

        const after = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: ts.schema.id },
        });
        expect(after.phase).toBe("GENERATING_HYPOTHESIS");
        expect(after.phaseUpdatedAt).toBeTruthy();
        expect(after.phaseError).toBeNull();
        expect(after.phaseErrorAt).toBeNull();
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("is idempotent — skips and does not run work() when already past the from-state", async () => {
      const ts = await seedSchema("FINALIZING_SCHEMA");
      try {
        let workRan = false;
        const result = await advanceSchemaPhase({
          schemaId: ts.schema.id,
          from: "PENDING",
          to: "GENERATING_HYPOTHESIS",
          work: async () => {
            workRan = true;
            return "should-not-run";
          },
        });
        expect(result).toBe("skipped");
        expect(workRan).toBe(false);

        const after = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: ts.schema.id },
        });
        expect(after.phase).toBe("FINALIZING_SCHEMA");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("throws NonRetriableError on unexpected pre-state (null phase)", async () => {
      const ts = await seedSchema(null);
      try {
        await expect(
          advanceSchemaPhase({
            schemaId: ts.schema.id,
            from: "PENDING",
            to: "GENERATING_HYPOTHESIS",
            work: async () => "nope",
          }),
        ).rejects.toThrow(NonRetriableError);
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("CAS-loses gracefully when another writer advances between read and write", async () => {
      const ts = await seedSchema("PENDING");
      try {
        // Simulate a concurrent writer that advances the phase inside work().
        // Our updateMany should find 0 rows matching phase=PENDING and throw.
        const work = async () => {
          await prisma.caseSchema.update({
            where: { id: ts.schema.id },
            data: { phase: "GENERATING_HYPOTHESIS" },
          });
          return "work-ran";
        };

        await expect(
          advanceSchemaPhase({
            schemaId: ts.schema.id,
            from: "PENDING",
            to: "GENERATING_HYPOTHESIS",
            work,
          }),
        ).rejects.toThrow(/CAS lost/);

        // Sanity: the concurrent writer's value persists.
        const after = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: ts.schema.id },
        });
        expect(after.phase).toBe("GENERATING_HYPOTHESIS");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("clears phaseError/phaseErrorAt on a successful advance", async () => {
      const ts = await seedSchema("PENDING");
      try {
        await prisma.caseSchema.update({
          where: { id: ts.schema.id },
          data: {
            phaseError: "stale error from a previous attempt",
            phaseErrorAt: new Date("2020-01-01"),
          },
        });

        await advanceSchemaPhase({
          schemaId: ts.schema.id,
          from: "PENDING",
          to: "GENERATING_HYPOTHESIS",
          work: async () => "ok",
        });

        const after = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: ts.schema.id },
        });
        expect(after.phaseError).toBeNull();
        expect(after.phaseErrorAt).toBeNull();
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });
  });

  // -------------------------------------------------------------------------
  // markSchemaFailed
  // -------------------------------------------------------------------------
  describe("markSchemaFailed", () => {
    it("sets phase=FAILED with phaseError, phaseErrorAt, and phaseUpdatedAt", async () => {
      const ts = await seedSchema("PROCESSING_SCAN");
      try {
        await markSchemaFailed(ts.schema.id, "PROCESSING_SCAN", new Error("boom"));

        const after = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: ts.schema.id },
        });
        expect(after.phase).toBe("FAILED");
        expect(after.phaseError).toContain("boom");
        expect(after.phaseError).toContain("PROCESSING_SCAN");
        expect(after.phaseErrorAt).toBeTruthy();
        expect(after.phaseUpdatedAt).toBeTruthy();
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("coerces non-Error throwables into a message string", async () => {
      const ts = await seedSchema("PENDING");
      try {
        await markSchemaFailed(ts.schema.id, "PENDING", "plain string error");
        const after = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: ts.schema.id },
        });
        expect(after.phaseError).toContain("plain string error");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });
  });

  // -------------------------------------------------------------------------
  // advanceScanPhase
  // -------------------------------------------------------------------------
  describe("advanceScanPhase", () => {
    it("advances a scan job from DISCOVERING to EXTRACTING", async () => {
      const ts = await seedSchema(null);
      try {
        const scan = await seedScan(ts.schema.id, "DISCOVERING");
        const result = await advanceScanPhase({
          scanJobId: scan.id,
          from: "DISCOVERING",
          to: "EXTRACTING",
          work: async () => "extracted",
        });
        expect(result).toBe("extracted");
        const after = await prisma.scanJob.findUniqueOrThrow({
          where: { id: scan.id },
        });
        expect(after.phase).toBe("EXTRACTING");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("accepts IDLE as a PENDING-equivalent pre-state (legacy rows)", async () => {
      const ts = await seedSchema(null);
      try {
        const scan = await seedScan(ts.schema.id, "IDLE");
        const result = await advanceScanPhase({
          scanJobId: scan.id,
          from: "PENDING",
          to: "DISCOVERING",
          work: async () => "started",
        });
        expect(result).toBe("started");
        const after = await prisma.scanJob.findUniqueOrThrow({
          where: { id: scan.id },
        });
        expect(after.phase).toBe("DISCOVERING");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("is idempotent — skips when scan is already past the from-phase", async () => {
      const ts = await seedSchema(null);
      try {
        const scan = await seedScan(ts.schema.id, "CLUSTERING");
        let workRan = false;
        const result = await advanceScanPhase({
          scanJobId: scan.id,
          from: "EXTRACTING",
          to: "CLUSTERING",
          work: async () => {
            workRan = true;
            return "nope";
          },
        });
        expect(result).toBe("skipped");
        expect(workRan).toBe(false);
        const after = await prisma.scanJob.findUniqueOrThrow({
          where: { id: scan.id },
        });
        expect(after.phase).toBe("CLUSTERING");
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });

    it("CAS-loses gracefully when another writer advances the scan mid-work", async () => {
      const ts = await seedSchema(null);
      try {
        const scan = await seedScan(ts.schema.id, "DISCOVERING");
        const work = async () => {
          await prisma.scanJob.update({
            where: { id: scan.id },
            data: { phase: "EXTRACTING" },
          });
          return "work-ran";
        };
        await expect(
          advanceScanPhase({
            scanJobId: scan.id,
            from: "DISCOVERING",
            to: "EXTRACTING",
            work,
          }),
        ).rejects.toThrow(/CAS lost/);
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });
  });

  // -------------------------------------------------------------------------
  // markScanFailed
  // -------------------------------------------------------------------------
  describe("markScanFailed", () => {
    it("sets phase=FAILED, status=FAILED, errorPhase, errorMessage, completedAt", async () => {
      const ts = await seedSchema(null);
      try {
        const scan = await seedScan(ts.schema.id, "EXTRACTING");
        await markScanFailed(scan.id, "EXTRACTING", new Error("gemini timeout"));
        const after = await prisma.scanJob.findUniqueOrThrow({
          where: { id: scan.id },
        });
        expect(after.phase).toBe("FAILED");
        expect(after.status).toBe("FAILED");
        expect(after.errorPhase).toBe("EXTRACTING");
        expect(after.errorMessage).toContain("gemini timeout");
        expect(after.completedAt).toBeTruthy();
      } finally {
        await cleanupSchema(ts.schema.id);
      }
    });
  });
});
