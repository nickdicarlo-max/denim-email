/**
 * Scan accounting invariant test.
 *
 * After a complete scan the compute-on-demand metrics must satisfy:
 *
 *     processedEmails + excludedEmails + failedEmails === totalEmails
 *
 * This invariant is the whole reason the Phase 0 migration dropped the
 * denormalized counter columns on ScanJob — they could drift relative
 * to the row sources. `computeScanMetrics` derives every number from
 * the authoritative tables (`Email.firstScanJobId`, `Email.isExcluded`,
 * `ScanFailure.scanJobId`) in one pass, so the invariant holds as long
 * as the pipeline correctly tags emails with `firstScanJobId` on the
 * happy path and writes a `ScanFailure` row on the failure path.
 *
 * This test doesn't exercise the real pipeline — it seeds the row
 * state directly and asserts `computeScanMetrics` aggregates them
 * correctly. The pipeline's behavior (every discovered email gets
 * exactly one terminal row: processed, excluded, or failed) is
 * tested elsewhere. Here we pin the accounting math.
 *
 * Does NOT require a running dev server or Inngest. Pure Prisma.
 *
 * Run: pnpm --filter web exec vitest run --config vitest.integration.config.ts onboarding-scan-accounting
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { computeScanMetrics } from "@/lib/services/scan-metrics";
import { createTestSchema } from "./helpers/test-schema";
import { cleanupTestUser, createTestUser, type TestUser } from "./helpers/test-user";

describe("scan accounting invariant", () => {
  let testUser: TestUser;
  let schemaId: string;
  const createdScanIds: string[] = [];

  beforeAll(async () => {
    testUser = await createTestUser();
    const schema = await createTestSchema(testUser.userId);
    schemaId = schema.schema.id;
  }, 60_000);

  afterAll(async () => {
    for (const id of createdScanIds) {
      await prisma.scanFailure.deleteMany({ where: { scanJobId: id } });
      await prisma.email.deleteMany({ where: { firstScanJobId: id } });
    }
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  async function createScan(totalEmails: number): Promise<string> {
    const scan = await prisma.scanJob.create({
      data: {
        schemaId,
        userId: testUser.userId,
        status: "COMPLETED",
        phase: "COMPLETED",
        triggeredBy: "ONBOARDING",
        totalEmails,
      },
      select: { id: true },
    });
    createdScanIds.push(scan.id);
    return scan.id;
  }

  async function seedEmails(
    scanId: string,
    opts: { processed: number; excluded: number },
  ): Promise<void> {
    const rows = [
      ...Array.from({ length: opts.processed }, (_, i) => ({
        schemaId,
        gmailMessageId: `processed_${scanId}_${i}`,
        threadId: `thread_processed_${scanId}_${i}`,
        subject: `Processed ${i}`,
        sender: "test@example.com",
        senderEmail: "test@example.com",
        senderDomain: "example.com",
        senderDisplayName: "Test",
        date: new Date(),
        isReply: false,
        threadPosition: 1,
        summary: "processed email",
        tags: [],
        extractedData: {},
        bodyLength: 100,
        firstScanJobId: scanId,
        lastScanJobId: scanId,
        isExcluded: false,
      })),
      ...Array.from({ length: opts.excluded }, (_, i) => ({
        schemaId,
        gmailMessageId: `excluded_${scanId}_${i}`,
        threadId: `thread_excluded_${scanId}_${i}`,
        subject: `Excluded ${i}`,
        sender: "noreply@newsletter.com",
        senderEmail: "noreply@newsletter.com",
        senderDomain: "newsletter.com",
        senderDisplayName: "Newsletter",
        date: new Date(),
        isReply: false,
        threadPosition: 1,
        summary: "",
        tags: [],
        extractedData: {},
        bodyLength: 0,
        firstScanJobId: scanId,
        lastScanJobId: scanId,
        isExcluded: true,
        excludeReason: "rule:domain",
      })),
    ];
    if (rows.length > 0) {
      await prisma.email.createMany({ data: rows });
    }
  }

  async function seedFailures(scanId: string, count: number): Promise<void> {
    if (count === 0) return;
    await prisma.scanFailure.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        scanJobId: scanId,
        schemaId,
        gmailMessageId: `failed_${scanId}_${i}`,
        phase: "EXTRACTING" as const,
        errorMessage: `seeded test failure ${i}`,
      })),
    });
  }

  it("processed + excluded + failed === totalEmails (5/3/2 split)", async () => {
    const total = 10;
    const scanId = await createScan(total);
    await seedEmails(scanId, { processed: 5, excluded: 3 });
    await seedFailures(scanId, 2);

    const metrics = await computeScanMetrics(scanId);

    expect(metrics.totalEmails).toBe(total);
    expect(metrics.processedEmails).toBe(5);
    expect(metrics.excludedEmails).toBe(3);
    expect(metrics.failedEmails).toBe(2);

    const accounted = metrics.processedEmails + metrics.excludedEmails + metrics.failedEmails;
    expect(accounted).toBe(metrics.totalEmails);
  }, 30_000);

  it("handles zero-scan edge case (totalEmails=0, no row seeding)", async () => {
    const scanId = await createScan(0);

    const metrics = await computeScanMetrics(scanId);

    expect(metrics.totalEmails).toBe(0);
    expect(metrics.processedEmails).toBe(0);
    expect(metrics.excludedEmails).toBe(0);
    expect(metrics.failedEmails).toBe(0);
    expect(metrics.casesCreated).toBe(0);
    expect(metrics.estimatedCostUsd).toBe(0);
  }, 30_000);

  it("handles all-processed edge case (no excludes, no failures)", async () => {
    const total = 7;
    const scanId = await createScan(total);
    await seedEmails(scanId, { processed: total, excluded: 0 });

    const metrics = await computeScanMetrics(scanId);

    expect(metrics.processedEmails).toBe(total);
    expect(metrics.excludedEmails).toBe(0);
    expect(metrics.failedEmails).toBe(0);
    expect(metrics.processedEmails + metrics.excludedEmails + metrics.failedEmails).toBe(
      metrics.totalEmails,
    );
  }, 30_000);

  it("handles all-excluded edge case (pure noise scan)", async () => {
    const total = 4;
    const scanId = await createScan(total);
    await seedEmails(scanId, { processed: 0, excluded: total });

    const metrics = await computeScanMetrics(scanId);

    expect(metrics.processedEmails).toBe(0);
    expect(metrics.excludedEmails).toBe(total);
    expect(metrics.failedEmails).toBe(0);
    expect(metrics.processedEmails + metrics.excludedEmails + metrics.failedEmails).toBe(
      metrics.totalEmails,
    );
  }, 30_000);

  it("handles all-failed edge case (scan-stage collapse)", async () => {
    const total = 3;
    const scanId = await createScan(total);
    await seedFailures(scanId, total);

    const metrics = await computeScanMetrics(scanId);

    expect(metrics.processedEmails).toBe(0);
    expect(metrics.excludedEmails).toBe(0);
    expect(metrics.failedEmails).toBe(total);
    expect(metrics.processedEmails + metrics.excludedEmails + metrics.failedEmails).toBe(
      metrics.totalEmails,
    );
  }, 30_000);

  it("does not count emails from a different scan (cross-scan isolation)", async () => {
    const scanA = await createScan(5);
    const scanB = await createScan(10);
    await seedEmails(scanA, { processed: 5, excluded: 0 });
    await seedEmails(scanB, { processed: 3, excluded: 7 });

    const metricsA = await computeScanMetrics(scanA);
    const metricsB = await computeScanMetrics(scanB);

    expect(metricsA.processedEmails).toBe(5);
    expect(metricsA.excludedEmails).toBe(0);
    expect(metricsB.processedEmails).toBe(3);
    expect(metricsB.excludedEmails).toBe(7);
  }, 30_000);
});
