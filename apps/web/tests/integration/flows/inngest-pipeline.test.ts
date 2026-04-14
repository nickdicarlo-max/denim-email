/**
 * Inngest Pipeline Wiring Integration Tests
 *
 * Test 2A: Direct Service Wiring (always runs)
 *   Proves clustering → synthesis work when called in the same order Inngest
 *   would, with proper ScanJob phase transitions.
 *
 * Test 2B: Real Inngest Event Chain (skips unless TEST_INNGEST=true)
 *   Proves emitting an Inngest event actually triggers the handler chain
 *   and ScanJob reaches COMPLETED.
 *
 * Prerequisites:
 *   - .env.local with DATABASE_URL, SUPABASE keys, ANTHROPIC_API_KEY
 *   - `pnpm --filter web prisma generate` has been run
 *   - For 2B: Inngest dev server running, TEST_INNGEST=true in .env.local
 *
 * Run: pnpm --filter web test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { clusterNewEmails } from "@/lib/services/cluster";
import { synthesizeCase } from "@/lib/services/synthesis";
import { seedTestEmails } from "../helpers/test-emails";
import { createTestSchema, type TestSchemaResult } from "../helpers/test-schema";
import { cleanupTestUser, createTestUser, type TestUser } from "../helpers/test-user";

let testUser: TestUser;
let testSchema: TestSchemaResult;

// ---------------------------------------------------------------------------
// Test 2A: Direct Service Wiring (always runs)
// ---------------------------------------------------------------------------
describe("Pipeline Wiring: ScanJob phase transitions + clustering → synthesis", () => {
  let scanJobId: string;

  beforeAll(async () => {
    testUser = await createTestUser();
    testSchema = await createTestSchema(testUser.userId);
    await seedTestEmails(testSchema.schema.id, {
      vmsId: testSchema.entities.vms.id,
      evscId: testSchema.entities.evsc.id,
      coachId: testSchema.entities.coach.id,
    });

    // CaseSchema.emailCount is compute-on-demand now — no seeding needed.

    // Create a ScanJob at RUNNING/EXTRACTING as if extraction just finished.
    // Counters (processedEmails/excludedEmails/failedEmails/casesCreated) are
    // computed on demand from Email + ScanFailure + Case rows.
    const scanJob = await prisma.scanJob.create({
      data: {
        schemaId: testSchema.schema.id,
        userId: testUser.userId,
        status: "RUNNING",
        phase: "EXTRACTING",
        totalEmails: 7,
        statusMessage: "Extraction done, starting clustering...",
        startedAt: new Date(),
      },
    });
    scanJobId = scanJob.id;
  }, 60_000);

  afterAll(async () => {
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
  }, 30_000);

  it("runs clustering → synthesis with ScanJob phase transitions", async () => {
    const schemaId = testSchema.schema.id;

    // --- Phase: CLUSTERING ---
    await prisma.scanJob.update({
      where: { id: scanJobId },
      data: {
        phase: "CLUSTERING",
        statusMessage: "Clustering emails into cases...",
      },
    });

    const clusterResult = await clusterNewEmails(schemaId, scanJobId);

    expect(clusterResult.casesCreated).toBeGreaterThan(0);
    expect(clusterResult.clustersCreated).toBeGreaterThan(0);

    // Update ScanJob with status message only — counters are derived.
    await prisma.scanJob.update({
      where: { id: scanJobId },
      data: {
        statusMessage: `Clustering done: ${clusterResult.casesCreated} created, ${clusterResult.casesMerged} merged`,
      },
    });

    // Verify ScanJob phase. Counts are now asserted via Case rows directly,
    // which is what computeScanMetrics/computeSchemaMetrics read from.
    const afterClustering = await prisma.scanJob.findUniqueOrThrow({
      where: { id: scanJobId },
    });
    expect(afterClustering.phase).toBe("CLUSTERING");
    const actualCaseCount = await prisma.case.count({
      where: { schemaId: testSchema.schema.id },
    });
    expect(actualCaseCount).toBeGreaterThan(0);

    // --- Phase: SYNTHESIZING ---
    await prisma.scanJob.update({
      where: { id: scanJobId },
      data: {
        phase: "SYNTHESIZING",
        statusMessage: "Generating case summaries and actions...",
      },
    });

    // Load all OPEN cases for this schema (same pattern as runSynthesis in functions.ts)
    // Two-pass clustering may delete coarse cases and create split replacements,
    // so cluster.resultCaseId from pass 1 can point to deleted cases.
    const openCases = await prisma.case.findMany({
      where: { schemaId, status: "OPEN" },
      select: { id: true },
    });

    const caseIds = openCases.map((c) => c.id);

    expect(caseIds.length).toBeGreaterThan(0);

    // Synthesize each case (live Claude)
    for (const caseId of caseIds) {
      await synthesizeCase(caseId, schemaId, scanJobId);
    }

    // --- Phase: COMPLETED ---
    await prisma.scanJob.update({
      where: { id: scanJobId },
      data: {
        phase: "COMPLETED",
        status: "COMPLETED",
        completedAt: new Date(),
        statusMessage: `Pipeline complete: ${caseIds.length} cases synthesized`,
      },
    });

    // --- Final assertions ---
    const finalJob = await prisma.scanJob.findUniqueOrThrow({
      where: { id: scanJobId },
    });
    expect(finalJob.phase).toBe("COMPLETED");
    expect(finalJob.status).toBe("COMPLETED");
    expect(finalJob.completedAt).toBeTruthy();
    // casesCreated is now derived — assert via Case rows directly.
    const finalCaseCount = await prisma.case.count({
      where: { schemaId: testSchema.schema.id },
    });
    expect(finalCaseCount).toBeGreaterThan(0);

    const cases = await prisma.case.findMany({
      where: { schemaId },
      select: { id: true, title: true, synthesizedAt: true },
    });

    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.title).toBeTruthy();
      expect(c.synthesizedAt).toBeTruthy();
    }

    console.log(`Direct wiring test: ${cases.length} cases synthesized, ScanJob COMPLETED`);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Test 2B: Real Inngest Event Chain (skips unless TEST_INNGEST=true)
// ---------------------------------------------------------------------------
const HAS_INNGEST = process.env.TEST_INNGEST === "true";

describe.skipIf(!HAS_INNGEST)("Inngest Event Chain: extraction.all.completed → COMPLETED", () => {
  let scanJobId: string;
  let schemaId: string;

  // Need a separate user/schema for this test to avoid conflicts with 2A
  let inngestTestUser: TestUser;

  beforeAll(async () => {
    inngestTestUser = await createTestUser();
    const schema = await createTestSchema(inngestTestUser.userId);
    schemaId = schema.schema.id;

    await seedTestEmails(schemaId, {
      vmsId: schema.entities.vms.id,
      evscId: schema.entities.evsc.id,
      coachId: schema.entities.coach.id,
    });

    // CaseSchema.emailCount is compute-on-demand now — no seeding needed.

    // Create ScanJob at EXTRACTING (as if extraction just finished). Counter
    // fields are derived by computeScanMetrics.
    const scanJob = await prisma.scanJob.create({
      data: {
        schemaId,
        userId: inngestTestUser.userId,
        status: "RUNNING",
        phase: "EXTRACTING",
        totalEmails: 7,
        statusMessage: "Extraction done, ready for clustering via Inngest...",
        startedAt: new Date(),
      },
    });
    scanJobId = scanJob.id;
  }, 60_000);

  afterAll(async () => {
    if (inngestTestUser?.userId) {
      await cleanupTestUser(inngestTestUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  it("emitting extraction.all.completed triggers the full clustering → synthesis chain", async () => {
    // Import inngest client dynamically to avoid issues when Inngest isn't configured
    const { inngest } = await import("@/lib/inngest/client");

    // Emit the event that triggers runClustering → runSynthesis
    await inngest.send({
      name: "extraction.all.completed",
      data: { schemaId, scanJobId },
    });

    console.log(`Emitted extraction.all.completed for schema=${schemaId}, scanJob=${scanJobId}`);

    // Poll ScanJob until COMPLETED or timeout
    const POLL_INTERVAL_MS = 3_000;
    const MAX_WAIT_MS = 300_000; // 5 minutes
    const startTime = Date.now();

    let finalPhase = "EXTRACTING";

    while (Date.now() - startTime < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const job = await prisma.scanJob.findUniqueOrThrow({
        where: { id: scanJobId },
      });

      finalPhase = job.phase;
      console.log(
        `Poll: phase=${job.phase}, status=${job.status}, elapsed=${Math.round((Date.now() - startTime) / 1000)}s`,
      );

      if (job.status === "FAILED") {
        throw new Error(`ScanJob failed: ${job.statusMessage ?? "unknown error"}`);
      }

      if (job.phase === "COMPLETED" && job.status === "COMPLETED") {
        break;
      }
    }

    expect(finalPhase).toBe("COMPLETED");

    // Verify cases were synthesized
    const cases = await prisma.case.findMany({
      where: { schemaId },
      select: { id: true, title: true, synthesizedAt: true },
    });

    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.title).toBeTruthy();
      expect(c.synthesizedAt).toBeTruthy();
    }

    console.log(`Inngest chain test: ${cases.length} cases synthesized via event chain`);
  }, 360_000);
});
