/**
 * Full Pipeline Integration Test
 *
 * Seeds realistic school-parent emails into the dev Supabase DB, then runs
 * the real clusterNewEmails and synthesizeCase services (including live Claude
 * API calls) to verify the pipeline produces correct cases.
 *
 * Prerequisites:
 *   - .env.local with DATABASE_URL, SUPABASE keys, ANTHROPIC_API_KEY
 *   - `pnpm --filter web prisma generate` has been run
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

describe("Full Pipeline: Emails -> Clustering -> Synthesis", () => {
  beforeAll(async () => {
    testUser = await createTestUser();
    testSchema = await createTestSchema(testUser.userId);
    await seedTestEmails(testSchema.schema.id, {
      vmsId: testSchema.entities.vms.id,
      evscId: testSchema.entities.evsc.id,
      coachId: testSchema.entities.coach.id,
    });
  }, 60_000);

  afterAll(async () => {
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    // Disconnect Prisma to avoid open handles
    await prisma.$disconnect();
  }, 30_000);

  // -----------------------------------------------------------------------
  // Test 1: Clustering
  // -----------------------------------------------------------------------
  it("clusters emails into 3 cases", async () => {
    const result = await clusterNewEmails(testSchema.schema.id);

    expect(result.casesCreated).toBe(3);
    expect(result.casesMerged).toBe(0);

    // Verify the 3 cases exist
    const cases = await prisma.case.findMany({
      where: { schemaId: testSchema.schema.id },
      include: {
        caseEmails: { include: { email: { select: { gmailMessageId: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    expect(cases).toHaveLength(3);

    // Find each case by its emails' gmailMessageIds
    const permissionCase = cases.find((c) =>
      c.caseEmails.some((ce) => ce.email.gmailMessageId === "msg_vms_perm_1"),
    );
    const scheduleCase = cases.find((c) =>
      c.caseEmails.some((ce) => ce.email.gmailMessageId === "msg_evsc_sched_1"),
    );
    const paymentCase = cases.find((c) =>
      c.caseEmails.some((ce) => ce.email.gmailMessageId === "msg_vms_payment_1"),
    );

    expect(permissionCase).toBeDefined();
    expect(scheduleCase).toBeDefined();
    expect(paymentCase).toBeDefined();

    // Permission case should have 3 emails (the thread)
    expect(permissionCase!.caseEmails).toHaveLength(3);

    // Schedule case should have 2 emails
    expect(scheduleCase!.caseEmails).toHaveLength(2);

    // Payment case should have 1 email
    expect(paymentCase!.caseEmails).toHaveLength(1);
  }, 30_000);

  // -----------------------------------------------------------------------
  // Test 2: Synthesis (live Claude API call)
  // -----------------------------------------------------------------------
  it("synthesizes cases with titles and summaries", async () => {
    const cases = await prisma.case.findMany({
      where: { schemaId: testSchema.schema.id },
    });

    for (const c of cases) {
      await synthesizeCase(c.id, testSchema.schema.id);
    }

    // Re-fetch after synthesis
    const synthesized = await prisma.case.findMany({
      where: { schemaId: testSchema.schema.id },
    });

    for (const c of synthesized) {
      // Title should be non-empty and reasonable length
      expect(c.title).toBeTruthy();
      expect(c.title.length).toBeLessThan(80);

      // Summary should have beginning/middle/end
      const summary = c.summary as { beginning: string; middle: string; end: string };
      expect(summary).toBeDefined();
      expect(summary.beginning).toBeTruthy();
      expect(summary.middle).toBeTruthy();
      expect(summary.end).toBeTruthy();

      // displayTags should be 1-3 items
      const displayTags = c.displayTags as string[];
      expect(displayTags.length).toBeGreaterThanOrEqual(1);
      expect(displayTags.length).toBeLessThanOrEqual(3);

      // synthesizedAt should be set
      expect(c.synthesizedAt).toBeTruthy();

      // lastSenderName should be set
      expect(c.lastSenderName).toBeTruthy();
    }
  }, 180_000);

  // -----------------------------------------------------------------------
  // Test 3: Action items
  // -----------------------------------------------------------------------
  it("creates action items for permission case", async () => {
    // Find the permission case (entity=VMS, 3 emails)
    const permissionCase = await prisma.case.findFirst({
      where: {
        schemaId: testSchema.schema.id,
        entityId: testSchema.entities.vms.id,
        caseEmails: {
          some: {
            email: { gmailMessageId: "msg_vms_perm_1" },
          },
        },
      },
      include: { actions: true },
    });

    expect(permissionCase).toBeDefined();
    expect(permissionCase!.actions.length).toBeGreaterThanOrEqual(1);

    // At least one action should be PENDING with a title and fingerprint
    const pendingActions = permissionCase!.actions.filter((a) => a.status === "PENDING");
    expect(pendingActions.length).toBeGreaterThanOrEqual(1);

    for (const action of pendingActions) {
      expect(action.title).toBeTruthy();
      expect(action.fingerprint).toBeTruthy();
    }
  });

  // -----------------------------------------------------------------------
  // Test 4: Excluded email not clustered
  // -----------------------------------------------------------------------
  it("excluded email not in any case", async () => {
    const excludedEmail = await prisma.email.findFirst({
      where: {
        schemaId: testSchema.schema.id,
        isExcluded: true,
      },
      include: { caseEmails: true },
    });

    expect(excludedEmail).toBeDefined();
    expect(excludedEmail!.caseEmails).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Test 5: Entity scoping
  // -----------------------------------------------------------------------
  it("cases scoped to correct primary entities", async () => {
    const vmsCases = await prisma.case.findMany({
      where: {
        schemaId: testSchema.schema.id,
        entityId: testSchema.entities.vms.id,
      },
    });

    const evscCases = await prisma.case.findMany({
      where: {
        schemaId: testSchema.schema.id,
        entityId: testSchema.entities.evsc.id,
      },
    });

    // VMS should have 2 cases (permission + payment)
    expect(vmsCases).toHaveLength(2);

    // EVSC should have 1 case (schedule)
    expect(evscCases).toHaveLength(1);
  });
});
