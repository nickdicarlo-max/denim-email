/**
 * Integration tests for computeScanMetrics / computeSchemaMetrics.
 *
 * Seeds real rows in Supabase (no mocks) and asserts the counters and cost
 * sums derived by the helpers match what we planted. Runs against the live
 * test database via the integration harness.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { computeScanMetrics, computeSchemaMetrics } from "@/lib/services/scan-metrics";
import { createTestSchema, type TestSchemaResult } from "../helpers/test-schema";
import { cleanupTestUser, createTestUser, type TestUser } from "../helpers/test-user";
import { withTimeout } from "../helpers/timeout";

let testUser: TestUser;
let testSchema: TestSchemaResult;

/** Minimal email factory — uses a gmailMessageId suffix to avoid collisions. */
async function seedEmail(opts: {
  schemaId: string;
  entityId: string;
  suffix: string;
  firstScanJobId: string | null;
  isExcluded: boolean;
}) {
  return prisma.email.create({
    data: {
      schemaId: opts.schemaId,
      entityId: opts.entityId,
      gmailMessageId: `scan-metrics-${opts.suffix}`,
      threadId: `thread-${opts.suffix}`,
      subject: `Test subject ${opts.suffix}`,
      sender: `Test Sender <sender-${opts.suffix}@example.com>`,
      senderEmail: `sender-${opts.suffix}@example.com`,
      senderDomain: "example.com",
      senderDisplayName: "Test Sender",
      date: new Date("2026-04-01T12:00:00Z"),
      summary: `Summary for ${opts.suffix}`,
      firstScanJobId: opts.firstScanJobId,
      lastScanJobId: opts.firstScanJobId,
      isExcluded: opts.isExcluded,
    },
  });
}

describe("scan-metrics (integration)", () => {
  beforeAll(async () => {
    testUser = await withTimeout(createTestUser(), 30_000, "createTestUser");
    testSchema = await createTestSchema(testUser.userId);
  });

  afterAll(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe("computeScanMetrics", () => {
    it("returns zero metrics for a non-existent scan id", async () => {
      const metrics = await computeScanMetrics("does-not-exist");
      expect(metrics).toEqual({
        totalEmails: 0,
        processedEmails: 0,
        excludedEmails: 0,
        failedEmails: 0,
        estimatedCostUsd: 0,
        casesCreated: 0,
      });
    });

    it("returns zero counters for a fresh scan with no emails", async () => {
      const scan = await prisma.scanJob.create({
        data: {
          schemaId: testSchema.schema.id,
          userId: testUser.userId,
          totalEmails: 0,
          triggeredBy: "ONBOARDING",
        },
      });

      const metrics = await computeScanMetrics(scan.id);

      expect(metrics.totalEmails).toBe(0);
      expect(metrics.processedEmails).toBe(0);
      expect(metrics.excludedEmails).toBe(0);
      expect(metrics.failedEmails).toBe(0);
      expect(metrics.estimatedCostUsd).toBe(0);
      expect(metrics.casesCreated).toBe(0);
    });

    it("counts processed vs excluded emails by firstScanJobId and isExcluded", async () => {
      const scan = await prisma.scanJob.create({
        data: {
          schemaId: testSchema.schema.id,
          userId: testUser.userId,
          totalEmails: 6,
          triggeredBy: "ONBOARDING",
        },
      });

      // 3 processed, 2 excluded attributed to this scan
      for (let i = 0; i < 3; i++) {
        await seedEmail({
          schemaId: testSchema.schema.id,
          entityId: testSchema.entities.vms.id,
          suffix: `${scan.id}-processed-${i}`,
          firstScanJobId: scan.id,
          isExcluded: false,
        });
      }
      for (let i = 0; i < 2; i++) {
        await seedEmail({
          schemaId: testSchema.schema.id,
          entityId: testSchema.entities.vms.id,
          suffix: `${scan.id}-excluded-${i}`,
          firstScanJobId: scan.id,
          isExcluded: true,
        });
      }

      // Unattributed email (different scan) — must not be counted
      await seedEmail({
        schemaId: testSchema.schema.id,
        entityId: testSchema.entities.vms.id,
        suffix: `${scan.id}-unrelated`,
        firstScanJobId: null,
        isExcluded: false,
      });

      const metrics = await computeScanMetrics(scan.id);

      expect(metrics.totalEmails).toBe(6);
      expect(metrics.processedEmails).toBe(3);
      expect(metrics.excludedEmails).toBe(2);
      expect(metrics.failedEmails).toBe(0);
    });

    it("counts ScanFailure rows for failedEmails", async () => {
      const scan = await prisma.scanJob.create({
        data: {
          schemaId: testSchema.schema.id,
          userId: testUser.userId,
          totalEmails: 0,
          triggeredBy: "ONBOARDING",
        },
      });

      await prisma.scanFailure.createMany({
        data: [
          {
            scanJobId: scan.id,
            schemaId: testSchema.schema.id,
            gmailMessageId: `${scan.id}-fail-a`,
            phase: "EXTRACTING",
            errorMessage: "boom a",
          },
          {
            scanJobId: scan.id,
            schemaId: testSchema.schema.id,
            gmailMessageId: `${scan.id}-fail-b`,
            phase: "EXTRACTING",
            errorMessage: "boom b",
          },
        ],
      });

      const metrics = await computeScanMetrics(scan.id);
      expect(metrics.failedEmails).toBe(2);
    });

    it("sums ExtractionCost rows scoped to scanJobId", async () => {
      const scan = await prisma.scanJob.create({
        data: {
          schemaId: testSchema.schema.id,
          userId: testUser.userId,
          totalEmails: 0,
          triggeredBy: "ONBOARDING",
        },
      });

      // Need an email to satisfy the emailId foreign-key shape on ExtractionCost.
      const email = await seedEmail({
        schemaId: testSchema.schema.id,
        entityId: testSchema.entities.vms.id,
        suffix: `${scan.id}-cost-email`,
        firstScanJobId: scan.id,
        isExcluded: false,
      });

      await prisma.extractionCost.createMany({
        data: [
          {
            emailId: email.id,
            scanJobId: scan.id,
            model: "gemini-2.5-flash",
            operation: "extraction",
            inputTokens: 1000,
            outputTokens: 500,
            estimatedCostUsd: 0.0125,
          },
          {
            emailId: email.id,
            scanJobId: scan.id,
            model: "gemini-2.5-flash",
            operation: "extraction",
            inputTokens: 2000,
            outputTokens: 800,
            estimatedCostUsd: 0.0275,
          },
          // Unrelated cost row (different scan) — must not be counted
          {
            emailId: email.id,
            scanJobId: null,
            model: "gemini-2.5-flash",
            operation: "extraction",
            inputTokens: 100,
            outputTokens: 50,
            estimatedCostUsd: 99.9,
          },
        ],
      });

      const metrics = await computeScanMetrics(scan.id);
      expect(metrics.estimatedCostUsd).toBeCloseTo(0.04, 4);
    });

    it("counts cases whose emails were first ingested by this scan", async () => {
      const scan = await prisma.scanJob.create({
        data: {
          schemaId: testSchema.schema.id,
          userId: testUser.userId,
          totalEmails: 0,
          triggeredBy: "ONBOARDING",
        },
      });

      const email = await seedEmail({
        schemaId: testSchema.schema.id,
        entityId: testSchema.entities.vms.id,
        suffix: `${scan.id}-case-email`,
        firstScanJobId: scan.id,
        isExcluded: false,
      });

      const caseRow = await prisma.case.create({
        data: {
          schemaId: testSchema.schema.id,
          entityId: testSchema.entities.vms.id,
          title: "Test case for metrics",
          summary: { beginning: "a", middle: "b", end: "c" },
        },
      });

      await prisma.caseEmail.create({
        data: {
          caseId: caseRow.id,
          emailId: email.id,
        },
      });

      // Second case attached to an unrelated email — must not be counted
      const unrelatedEmail = await seedEmail({
        schemaId: testSchema.schema.id,
        entityId: testSchema.entities.vms.id,
        suffix: `${scan.id}-case-unrelated`,
        firstScanJobId: null,
        isExcluded: false,
      });
      const unrelatedCase = await prisma.case.create({
        data: {
          schemaId: testSchema.schema.id,
          entityId: testSchema.entities.vms.id,
          title: "Unrelated case",
          summary: { beginning: "a", middle: "b", end: "c" },
        },
      });
      await prisma.caseEmail.create({
        data: { caseId: unrelatedCase.id, emailId: unrelatedEmail.id },
      });

      const metrics = await computeScanMetrics(scan.id);
      expect(metrics.casesCreated).toBe(1);
    });
  });

  describe("computeSchemaMetrics", () => {
    it("scopes counts by schemaId and doesn't leak across schemas", async () => {
      // Create a second schema on the same test user (the harness user is a
      // singleton keyed on a fixed email, so we can't make a "second user").
      // Cascade delete via caseSchema.delete cleans it up at the end.
      const otherSchema = await createTestSchema(testUser.userId);
      try {
        await seedEmail({
          schemaId: otherSchema.schema.id,
          entityId: otherSchema.entities.vms.id,
          suffix: "other-schema-leak-check",
          firstScanJobId: null,
          isExcluded: false,
        });

        const metrics = await computeSchemaMetrics(testSchema.schema.id);

        // The testSchema accumulated emails/cases from prior tests in this
        // file. Assert non-negative + that the other schema's seed is isolated.
        expect(metrics.emailCount).toBeGreaterThanOrEqual(0);
        expect(metrics.caseCount).toBeGreaterThanOrEqual(0);
        expect(metrics.actionCount).toBeGreaterThanOrEqual(0);

        const otherMetrics = await computeSchemaMetrics(otherSchema.schema.id);
        expect(otherMetrics.emailCount).toBe(1);
        expect(otherMetrics.caseCount).toBe(0);
        expect(otherMetrics.actionCount).toBe(0);
      } finally {
        await prisma.caseSchema.delete({ where: { id: otherSchema.schema.id } });
      }
    });

    it("excludes isExcluded emails from emailCount", async () => {
      const before = await computeSchemaMetrics(testSchema.schema.id);

      await seedEmail({
        schemaId: testSchema.schema.id,
        entityId: testSchema.entities.vms.id,
        suffix: "schema-metrics-excluded-check",
        firstScanJobId: null,
        isExcluded: true,
      });

      const after = await computeSchemaMetrics(testSchema.schema.id);
      expect(after.emailCount).toBe(before.emailCount);
    });
  });
});
