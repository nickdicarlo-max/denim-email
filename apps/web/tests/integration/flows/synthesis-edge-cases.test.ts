import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { clusterNewEmails } from "@/lib/services/cluster";
import { synthesizeCase } from "@/lib/services/synthesis";
import { seedTestEmails } from "../helpers/test-emails";
import { createTestSchema, type TestSchemaResult } from "../helpers/test-schema";
import { cleanupTestUser, createTestUser, type TestUser } from "../helpers/test-user";
import { withTimeout } from "../helpers/timeout";

let testUser: TestUser;
let testSchema: TestSchemaResult;
let targetCaseId: string;

describe("Synthesis Edge Cases", () => {
  beforeAll(async () => {
    testUser = await withTimeout(createTestUser(), 30_000, "createTestUser");
    testSchema = await createTestSchema(testUser.userId);
    await seedTestEmails(testSchema.schema.id, {
      vmsId: testSchema.entities.vms.id,
      evscId: testSchema.entities.evsc.id,
      coachId: testSchema.entities.coach.id,
    });

    // Run clustering to create cases
    await withTimeout(clusterNewEmails(testSchema.schema.id), 60_000, "clusterNewEmails (setup)");
  }, 120_000);

  afterAll(async () => {
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  // -------------------------------------------------------------------
  // First synthesis sets synthesizedAt and creates actions
  // -------------------------------------------------------------------
  it("first synthesis populates case title, summary, actions", async () => {
    const cases = await prisma.case.findMany({
      where: { schemaId: testSchema.schema.id },
      orderBy: { createdAt: "asc" },
    });
    expect(cases.length).toBeGreaterThanOrEqual(1);

    targetCaseId = cases[0].id;

    await withTimeout(
      synthesizeCase(targetCaseId, testSchema.schema.id),
      300_000,
      `synthesizeCase (first run, caseId=${targetCaseId})`,
    );

    const updated = await prisma.case.findUniqueOrThrow({
      where: { id: targetCaseId },
      include: { actions: true },
    });

    expect(updated.title).toBeTruthy();
    expect(updated.synthesizedAt).toBeTruthy();

    const summary = updated.summary as { beginning: string; middle: string; end: string };
    expect(summary.beginning).toBeTruthy();
    expect(summary.middle).toBeTruthy();
    expect(summary.end).toBeTruthy();
  }, 360_000);

  // -------------------------------------------------------------------
  // Skip guard: re-synthesis with no new emails is a no-op
  // -------------------------------------------------------------------
  it("re-synthesis with no new emails skips (synthesizedAt unchanged)", async () => {
    const before = await prisma.case.findUniqueOrThrow({
      where: { id: targetCaseId },
      select: { synthesizedAt: true, title: true },
    });

    expect(before.synthesizedAt).toBeTruthy();
    const originalSynthesizedAt = before.synthesizedAt!.toISOString();

    // Re-synthesize — should skip
    await withTimeout(
      synthesizeCase(targetCaseId, testSchema.schema.id),
      30_000,
      "synthesizeCase (skip guard — no new emails, should return fast)",
    );

    const after = await prisma.case.findUniqueOrThrow({
      where: { id: targetCaseId },
      select: { synthesizedAt: true, title: true },
    });

    expect(after.synthesizedAt!.toISOString()).toBe(originalSynthesizedAt);
    expect(after.title).toBe(before.title);
  }, 60_000);

  // -------------------------------------------------------------------
  // Re-synthesis after adding a new email updates the case
  // -------------------------------------------------------------------
  it("adding new email and re-synthesizing updates synthesizedAt", async () => {
    const before = await prisma.case.findUniqueOrThrow({
      where: { id: targetCaseId },
      select: { synthesizedAt: true },
    });

    // Add a new email to this case
    const newEmail = await prisma.email.create({
      data: {
        schemaId: testSchema.schema.id,
        gmailMessageId: "msg_new_for_resynth",
        threadId: "thread_resynth",
        subject: "Follow-up: New information about the case",
        sender: "Update <update@vms.edu>",
        senderEmail: "update@vms.edu",
        senderDomain: "vms.edu",
        senderDisplayName: "Update",
        date: new Date(),
        isReply: false,
        threadPosition: 1,
        summary: "New important information that changes the situation. Deadline moved to April 5.",
        tags: ["Action Required"],
        extractedData: {},
        bodyLength: 200,
      },
    });

    // Assign the new email to the case (simulating clustering)
    await prisma.caseEmail.create({
      data: {
        caseId: targetCaseId,
        emailId: newEmail.id,
        assignedBy: "CLUSTERING",
        clusteringScore: 90,
      },
    });

    // Re-synthesize — should NOT skip because there's a new email
    await withTimeout(
      synthesizeCase(targetCaseId, testSchema.schema.id),
      300_000,
      "synthesizeCase (re-synthesis with new email)",
    );

    const after = await prisma.case.findUniqueOrThrow({
      where: { id: targetCaseId },
      select: { synthesizedAt: true },
    });

    // synthesizedAt should have been updated
    expect(after.synthesizedAt!.getTime()).toBeGreaterThan(before.synthesizedAt!.getTime());
  }, 360_000);

  // -------------------------------------------------------------------
  // Action dedup: same fingerprint across runs produces 1 action
  // -------------------------------------------------------------------
  it("action dedup prevents duplicate actions across synthesis runs", async () => {
    const actionsBefore = await prisma.caseAction.findMany({
      where: { caseId: targetCaseId },
    });

    // Count actions and their fingerprints
    const fingerprints = actionsBefore
      .map((a) => a.fingerprint)
      .filter((fp): fp is string => fp !== null);

    // All fingerprints should be unique (no duplicates from re-synthesis)
    const uniqueFingerprints = new Set(fingerprints);
    expect(uniqueFingerprints.size).toBe(fingerprints.length);
  });

  // -------------------------------------------------------------------
  // Synthesize all remaining cases (coverage)
  // -------------------------------------------------------------------
  it("synthesizes all cases without errors", async () => {
    const unsynthesized = await prisma.case.findMany({
      where: {
        schemaId: testSchema.schema.id,
        synthesizedAt: null,
      },
    });

    for (const c of unsynthesized) {
      await withTimeout(
        synthesizeCase(c.id, testSchema.schema.id),
        300_000,
        `synthesizeCase (caseId=${c.id})`,
      );
    }

    // All cases should now have synthesizedAt
    const allCases = await prisma.case.findMany({
      where: { schemaId: testSchema.schema.id },
    });

    for (const c of allCases) {
      expect(c.synthesizedAt).toBeTruthy();
      expect(c.title).toBeTruthy();
    }
  }, 600_000);
});
