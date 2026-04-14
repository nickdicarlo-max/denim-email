import type { ExtractionSchemaContext } from "@denim/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { extractEmail } from "@/lib/services/extraction";
import { buildGmailFixture } from "../helpers/gmail-fixtures";
import { createTestSchema, type TestSchemaResult } from "../helpers/test-schema";
import { cleanupTestUser, createTestUser, type TestUser } from "../helpers/test-user";
import { withTimeout } from "../helpers/timeout";

let testUser: TestUser;
let testSchema: TestSchemaResult;
let schemaContext: ExtractionSchemaContext;
let entities: { name: string; type: "PRIMARY" | "SECONDARY"; aliases: string[] }[];
let exclusionRules: { ruleType: string; pattern: string; isActive: boolean }[];

describe("Extraction Flow (live Gemini)", () => {
  beforeAll(async () => {
    testUser = await withTimeout(createTestUser(), 30_000, "createTestUser");
    testSchema = await createTestSchema(testUser.userId);

    // Load schema context the same way the service does
    const schema = await prisma.caseSchema.findUniqueOrThrow({
      where: { id: testSchema.schema.id },
      include: {
        tags: { select: { name: true, description: true, isActive: true } },
        entities: {
          select: { name: true, type: true, aliases: true, isActive: true, autoDetected: true },
        },
        extractedFields: { select: { name: true, type: true, description: true, source: true } },
        exclusionRules: { select: { ruleType: true, pattern: true, isActive: true } },
      },
    });

    schemaContext = {
      domain: schema.domain ?? "general",
      tags: schema.tags
        .filter((t) => t.isActive)
        .map((t) => ({ name: t.name, description: t.description ?? "" })),
      entities: schema.entities
        .filter((e) => e.isActive)
        .map((e) => ({
          name: e.name,
          type: e.type as "PRIMARY" | "SECONDARY",
          aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
          isUserInput: !e.autoDetected,
        })),
      extractedFields: schema.extractedFields.map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description,
        source: f.source ?? "BODY",
      })),
      exclusionPatterns: schema.exclusionRules.filter((r) => r.isActive).map((r) => r.pattern),
    };

    entities = schemaContext.entities;

    // Create an exclusion rule for testing
    await prisma.exclusionRule.create({
      data: {
        schemaId: testSchema.schema.id,
        ruleType: "DOMAIN",
        pattern: "spam-newsletter.com",
        isActive: true,
        source: "user",
      },
    });

    // Reload exclusion rules
    const rules = await prisma.exclusionRule.findMany({
      where: { schemaId: testSchema.schema.id },
      select: { ruleType: true, pattern: true, isActive: true },
    });
    exclusionRules = rules;
  }, 60_000);

  afterAll(async () => {
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  // -------------------------------------------------------------------
  // Basic extraction
  // -------------------------------------------------------------------
  it("extracts a school email with summary, tags, and entity", async () => {
    const msg = buildGmailFixture({
      id: "extract_test_1",
      threadId: "thread_extract_1",
      subject: "Spring Concert - March 25th at 6pm",
      senderEmail: "music@vms.edu",
      senderDisplayName: "VMS Music Department",
      body: "Dear parents, please join us for the spring concert on March 25th at 6pm in the auditorium. Students should arrive by 5:30pm in concert attire. There is no cost for attendance.",
    });

    const result = await withTimeout(
      extractEmail(msg, schemaContext, entities, exclusionRules, {
        schemaId: testSchema.schema.id,
        userId: testUser.userId,
      }),
      120_000,
      "extractEmail (live Gemini) - school concert email",
    );

    expect(result.excluded).toBe(false);
    expect(result.emailId).toBeTruthy();

    // Verify Email row in DB
    const email = await prisma.email.findUnique({
      where: { id: result.emailId },
    });

    expect(email).toBeDefined();
    expect(email!.gmailMessageId).toBe("extract_test_1");
    expect(email!.summary).toBeTruthy();
    expect(email!.summary.length).toBeGreaterThan(10);
    expect(Array.isArray(email!.tags)).toBe(true);
    expect((email!.tags as string[]).length).toBeGreaterThanOrEqual(1);
  }, 180_000);

  // -------------------------------------------------------------------
  // Idempotency (upsert)
  // -------------------------------------------------------------------
  it("re-extracting same email upserts without duplicates", async () => {
    const msg = buildGmailFixture({
      id: "extract_test_1", // Same gmailMessageId as above
      threadId: "thread_extract_1",
      subject: "Spring Concert - March 25th at 6pm",
      senderEmail: "music@vms.edu",
      senderDisplayName: "VMS Music Department",
      body: "Dear parents, please join us for the spring concert on March 25th at 6pm in the auditorium. Students should arrive by 5:30pm in concert attire. There is no cost for attendance.",
    });

    // Record schema emailCount before re-extraction (compute-on-demand)
    const emailCountBefore = await prisma.email.count({
      where: { schemaId: testSchema.schema.id, isExcluded: false },
    });

    const result = await withTimeout(
      extractEmail(msg, schemaContext, entities, exclusionRules, {
        schemaId: testSchema.schema.id,
        userId: testUser.userId,
      }),
      120_000,
      "extractEmail (idempotency re-run)",
    );

    expect(result.excluded).toBe(false);

    // Should not have created a duplicate
    const emailCount = await prisma.email.count({
      where: {
        schemaId: testSchema.schema.id,
        gmailMessageId: "extract_test_1",
      },
    });
    expect(emailCount).toBe(1);

    // emailCount should NOT have incremented again
    const emailCountAfter = await prisma.email.count({
      where: { schemaId: testSchema.schema.id, isExcluded: false },
    });
    expect(emailCountAfter).toBe(emailCountBefore);

    // Email should have reprocessedAt set
    const email = await prisma.email.findFirst({
      where: { schemaId: testSchema.schema.id, gmailMessageId: "extract_test_1" },
    });
    expect(email!.reprocessedAt).toBeTruthy();
  }, 180_000);

  // -------------------------------------------------------------------
  // Exclusion rule
  // -------------------------------------------------------------------
  it("email from excluded domain is marked excluded", async () => {
    const msg = buildGmailFixture({
      id: "extract_test_excluded",
      threadId: "thread_excluded",
      subject: "Weekly Deals and Promotions",
      senderEmail: "noreply@spam-newsletter.com",
      senderDisplayName: "Spam Newsletter",
      body: "Check out these amazing deals!",
    });

    const result = await withTimeout(
      extractEmail(msg, schemaContext, entities, exclusionRules, {
        schemaId: testSchema.schema.id,
        userId: testUser.userId,
      }),
      30_000,
      "extractEmail (excluded domain) - should skip Gemini call",
    );

    expect(result.excluded).toBe(true);

    // Email row exists but is excluded
    const email = await prisma.email.findUnique({
      where: { id: result.emailId },
    });
    expect(email!.isExcluded).toBe(true);
    expect(email!.excludeReason).toBe("rule:domain");

    // ExclusionRule matchCount incremented
    const rule = await prisma.exclusionRule.findFirst({
      where: {
        schemaId: testSchema.schema.id,
        ruleType: "DOMAIN",
        pattern: "spam-newsletter.com",
      },
    });
    expect(rule!.matchCount).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // -------------------------------------------------------------------
  // Compute-on-demand email count
  // -------------------------------------------------------------------
  it("schema email count (non-excluded) is correct", async () => {
    // We extracted 1 real email + 1 excluded (excluded should NOT count)
    // The idempotent re-extraction should NOT double-count
    const count = await prisma.email.count({
      where: { schemaId: testSchema.schema.id, isExcluded: false },
    });
    expect(count).toBe(1);
  });

  // -------------------------------------------------------------------
  // ExtractionCost logged
  // -------------------------------------------------------------------
  it("ExtractionCost row was created for the Gemini call", async () => {
    // Find email IDs for this schema to filter costs
    const emails = await prisma.email.findMany({
      where: { schemaId: testSchema.schema.id },
      select: { id: true },
    });
    const emailIds = emails.map((e) => e.id);

    const costs = await prisma.extractionCost.findMany({
      where: {
        emailId: { in: emailIds },
        operation: "extraction",
      },
    });

    // At least 1 cost row (initial extraction). Re-extraction also creates one.
    expect(costs.length).toBeGreaterThanOrEqual(1);
    expect(costs[0].model).toContain("gemini");
    expect(costs[0].inputTokens).toBeGreaterThan(0);
    expect(costs[0].outputTokens).toBeGreaterThan(0);
    expect(costs[0].latencyMs).toBeGreaterThan(0);
  });
});
