/**
 * Entity Groups Integration Test
 *
 * Tests the complete entity groups flow:
 * 1. Zod validation of FinalizeConfirmations (with and without groups)
 * 2. finalizeSchema with groups → EntityGroup rows created, entities linked
 * 3. Group-scoped associatedPrimaryIds (not blanket)
 * 4. Extraction schema context includes entityGroups from DB
 * 5. Extraction prompt renders group context for Gemini
 * 6. Backward compat: no groups = blanket association
 *
 * Does NOT require a running dev server or live AI calls.
 * Run: pnpm --filter web vitest run --config vitest.integration.config.ts tests/integration/flows/entity-groups.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestUser, cleanupTestUser, type TestUser } from "../helpers/test-user";
import { finalizeSchema } from "@/lib/services/interview";
import { FinalizeConfirmationsSchema } from "@/lib/validation/interview";
import { buildExtractionPrompt } from "@denim/ai";
import type { SchemaHypothesis, HypothesisValidation } from "@denim/types";

let testUser: TestUser;
const createdSchemaIds: string[] = [];

// Minimal hypothesis fixture — no live Claude call needed
const FIXTURE_HYPOTHESIS: SchemaHypothesis = {
  domain: "school_parent",
  schemaName: "Kids Activities",
  primaryEntity: {
    name: "Activity",
    description: "A school or extracurricular activity",
  },
  secondaryEntityTypes: [
    {
      name: "Coach",
      description: "Coach or instructor",
      derivedFrom: "sender",
      affinityScore: 30,
    },
  ],
  entities: [
    { name: "Soccer", type: "PRIMARY", secondaryTypeName: null, aliases: ["ZSA Soccer"], confidence: 1.0, source: "user_input" },
    { name: "Dance", type: "PRIMARY", secondaryTypeName: null, aliases: [], confidence: 1.0, source: "user_input" },
    { name: "Lanier", type: "PRIMARY", secondaryTypeName: null, aliases: ["Lanier Middle School"], confidence: 1.0, source: "user_input" },
    { name: "St Agnes", type: "PRIMARY", secondaryTypeName: null, aliases: ["Saint Agnes"], confidence: 1.0, source: "user_input" },
    { name: "Ziad Allan", type: "SECONDARY", secondaryTypeName: "Coach", aliases: [], confidence: 1.0, source: "user_input" },
  ],
  tags: [
    { name: "Schedule", description: "Schedule changes", expectedFrequency: "high", isActionable: false },
    { name: "Action Required", description: "Needs parent action", expectedFrequency: "high", isActionable: true },
    { name: "Game/Match", description: "Game information", expectedFrequency: "medium", isActionable: false },
    { name: "Practice", description: "Practice info", expectedFrequency: "high", isActionable: false },
    { name: "Payment", description: "Fees or payments", expectedFrequency: "medium", isActionable: true },
  ],
  extractedFields: [
    { name: "eventDate", type: "DATE", description: "Event date", source: "BODY", format: "date", showOnCard: true, aggregation: "LATEST" },
  ],
  summaryLabels: { beginning: "What", middle: "Details", end: "Action Needed" },
  clusteringConfig: {
    mergeThreshold: 35,
    threadMatchScore: 100,
    tagMatchScore: 15,
    subjectMatchScore: 20,
    actorAffinityScore: 10,
    subjectAdditiveBonus: 5,
    timeDecayDays: { fresh: 60, recent: 120, stale: 365 },
    weakTagDiscount: 0.5,
    frequencyThreshold: 0.1,
    anchorTagLimit: 3,
    caseSizeThreshold: 5,
    caseSizeMaxBonus: 10,
    reminderCollapseEnabled: true,
    reminderSubjectSimilarity: 0.85,
    reminderMaxAge: 7,
  },
  discoveryQueries: [
    { query: "soccer", label: "Soccer", entityName: "Soccer", source: "entity_name" },
    { query: "from:ziad", label: "Ziad Allan", entityName: "Ziad Allan", source: "entity_name" },
  ],
  exclusionPatterns: ["noreply@"],
};

const FIXTURE_VALIDATION: HypothesisValidation = {
  confirmedEntities: [],
  discoveredEntities: [],
  confirmedTags: [],
  suggestedTags: [],
  noisePatterns: [],
  sampleEmailCount: 0,
  scanDurationMs: 0,
  confidenceScore: 0.5,
};

describe("Entity Groups: Zod Validation", () => {
  it("accepts confirmations with valid groups", () => {
    const result = FinalizeConfirmationsSchema.safeParse({
      confirmedEntities: [],
      removedEntities: [],
      confirmedTags: [],
      removedTags: [],
      groups: [
        { whats: ["Soccer"], whos: ["Ziad Allan"] },
        { whats: ["Dance", "Lanier"], whos: [] },
        { whats: ["St Agnes"], whos: [] },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groups).toHaveLength(3);
      expect(result.data.groups![0].whos[0]).toBe("Ziad Allan");
    }
  });

  it("accepts confirmations without groups (backward compat)", () => {
    const result = FinalizeConfirmationsSchema.safeParse({
      confirmedEntities: [],
      removedEntities: [],
      confirmedTags: [],
      removedTags: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groups).toBeUndefined();
    }
  });

  it("rejects groups with empty whats", () => {
    const result = FinalizeConfirmationsSchema.safeParse({
      confirmedEntities: [],
      removedEntities: [],
      confirmedTags: [],
      removedTags: [],
      groups: [{ whats: [], whos: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects entity names exceeding 255 chars", () => {
    const result = FinalizeConfirmationsSchema.safeParse({
      confirmedEntities: [],
      removedEntities: [],
      confirmedTags: [],
      removedTags: [],
      groups: [{ whats: ["a".repeat(256)], whos: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from entity names", () => {
    const result = FinalizeConfirmationsSchema.safeParse({
      confirmedEntities: [],
      removedEntities: [],
      confirmedTags: [],
      removedTags: [],
      groups: [{ whats: ["  Soccer  "], whos: ["  Ziad Allan  "] }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groups![0].whats[0]).toBe("Soccer");
      expect(result.data.groups![0].whos[0]).toBe("Ziad Allan");
    }
  });

  it("rejects more than 20 groups", () => {
    const groups = Array.from({ length: 21 }, (_, i) => ({
      whats: [`Entity ${i}`],
      whos: [],
    }));
    const result = FinalizeConfirmationsSchema.safeParse({
      confirmedEntities: [],
      removedEntities: [],
      confirmedTags: [],
      removedTags: [],
      groups,
    });
    expect(result.success).toBe(false);
  });
});

describe("Entity Groups: HTTP Finalize Route (requires running dev server)", () => {
  let api: ReturnType<typeof import("../helpers/api-client").createApiClient>;

  beforeAll(async () => {
    testUser = await createTestUser();
    const { createApiClient } = await import("../helpers/api-client");
    api = createApiClient(testUser.accessToken);
  }, 60_000);

  afterAll(async () => {
    for (const schemaId of createdSchemaIds) {
      await prisma.caseSchema.deleteMany({ where: { id: schemaId } });
    }
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  it("POST /api/interview/finalize with groups creates EntityGroup rows in DB", async () => {
    // This is the exact payload shape the client sends
    const res = await api.post("/api/interview/finalize", {
      hypothesis: FIXTURE_HYPOTHESIS,
      validation: FIXTURE_VALIDATION,
      confirmations: {
        confirmedEntities: [],
        removedEntities: [],
        confirmedTags: [],
        removedTags: [],
        schemaName: "HTTP Groups Test",
        groups: [
          { whats: ["Soccer"], whos: ["Ziad Allan"] },
          { whats: ["Dance", "Lanier"], whos: [] },
          { whats: ["St Agnes"], whos: [] },
        ],
      },
    });

    // Should succeed (Gmail discovery may fail without token, but schema creation succeeds)
    expect(res.status).toBe(200);
    const schemaId = (res.data as any).data?.schemaId;
    expect(schemaId).toBeTruthy();
    createdSchemaIds.push(schemaId);

    // Verify EntityGroup rows via DB
    const groups = await prisma.entityGroup.findMany({
      where: { schemaId },
      orderBy: { index: "asc" },
      include: {
        entities: { select: { name: true, type: true }, orderBy: { name: "asc" } },
      },
    });

    expect(groups).toHaveLength(3);
    expect(groups[0].entities.map((e) => e.name).sort()).toEqual(["Soccer", "Ziad Allan"]);
    expect(groups[1].entities.map((e) => e.name).sort()).toEqual(["Dance", "Lanier"]);
    expect(groups[2].entities.map((e) => e.name)).toEqual(["St Agnes"]);

    // Verify Ziad is only associated with Soccer
    const ziad = await prisma.entity.findFirst({
      where: { schemaId, name: "Ziad Allan" },
      select: { associatedPrimaryIds: true, groupId: true },
    });
    expect(ziad!.groupId).toBeTruthy();
    const assocIds = ziad!.associatedPrimaryIds as string[];
    expect(assocIds).toHaveLength(1);

    const soccer = await prisma.entity.findFirst({
      where: { schemaId, name: "Soccer", type: "PRIMARY" },
      select: { id: true },
    });
    expect(assocIds[0]).toBe(soccer!.id);
  }, 60_000);

  it("POST /api/interview/finalize rejects invalid groups with 400", async () => {
    const res = await api.post("/api/interview/finalize", {
      hypothesis: FIXTURE_HYPOTHESIS,
      validation: FIXTURE_VALIDATION,
      confirmations: {
        confirmedEntities: [],
        removedEntities: [],
        confirmedTags: [],
        removedTags: [],
        groups: [{ whats: [], whos: [] }], // Invalid: empty whats
      },
    });

    expect(res.status).toBe(400);
    const body = res.data as { error?: string };
    expect(body.error).toContain("Invalid confirmations");
  }, 30_000);

  it("POST /api/interview/finalize rejects oversized entity names with 400", async () => {
    const res = await api.post("/api/interview/finalize", {
      hypothesis: FIXTURE_HYPOTHESIS,
      validation: FIXTURE_VALIDATION,
      confirmations: {
        confirmedEntities: [],
        removedEntities: [],
        confirmedTags: [],
        removedTags: [],
        groups: [{ whats: ["a".repeat(256)], whos: [] }],
      },
    });

    expect(res.status).toBe(400);
  }, 30_000);

  it("POST /api/interview/finalize without groups uses blanket association", async () => {
    const res = await api.post("/api/interview/finalize", {
      hypothesis: FIXTURE_HYPOTHESIS,
      validation: FIXTURE_VALIDATION,
      confirmations: {
        confirmedEntities: [],
        removedEntities: [],
        confirmedTags: [],
        removedTags: [],
        // No groups field
      },
    });

    expect(res.status).toBe(200);
    const schemaId = (res.data as any).data?.schemaId;
    expect(schemaId).toBeTruthy();
    createdSchemaIds.push(schemaId);

    // No EntityGroup rows
    const groups = await prisma.entityGroup.findMany({ where: { schemaId } });
    expect(groups).toHaveLength(0);

    // Ziad should be blanket-associated with all primaries
    const ziad = await prisma.entity.findFirst({
      where: { schemaId, name: "Ziad Allan" },
      select: { associatedPrimaryIds: true, groupId: true },
    });
    expect(ziad!.groupId).toBeNull();
    expect((ziad!.associatedPrimaryIds as string[]).length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});

describe("Entity Groups: Direct Service Tests", () => {
  let serviceTestUser: TestUser;
  const serviceSchemaIds: string[] = [];

  beforeAll(async () => {
    serviceTestUser = await createTestUser();
  }, 60_000);

  afterAll(async () => {
    for (const schemaId of serviceSchemaIds) {
      await prisma.caseSchema.deleteMany({ where: { id: schemaId } });
    }
    if (serviceTestUser?.userId) {
      await cleanupTestUser(serviceTestUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  it("creates EntityGroup rows with correct group-entity linkage", async () => {
    const confirmations = {
      confirmedEntities: [] as string[],
      removedEntities: [] as string[],
      confirmedTags: [] as string[],
      removedTags: [] as string[],
      groups: [
        { whats: ["Soccer"], whos: ["Ziad Allan"] },
        { whats: ["Dance", "Lanier"], whos: [] },
        { whats: ["St Agnes"], whos: [] },
      ],
    };

    const schemaId = await finalizeSchema(
      FIXTURE_HYPOTHESIS,
      FIXTURE_VALIDATION,
      confirmations,
      { userId: serviceTestUser.userId },
    );
    serviceSchemaIds.push(schemaId);

    // --- Verify EntityGroup rows ---
    const groups = await prisma.entityGroup.findMany({
      where: { schemaId },
      orderBy: { index: "asc" },
      include: {
        entities: {
          select: { name: true, type: true, groupId: true },
          orderBy: { name: "asc" },
        },
      },
    });

    expect(groups).toHaveLength(3);

    // Group 0: Soccer + Ziad Allan
    expect(groups[0].index).toBe(0);
    expect(groups[0].entities.map((e) => e.name).sort()).toEqual(["Soccer", "Ziad Allan"]);

    // Group 1: Dance + Lanier
    expect(groups[1].index).toBe(1);
    expect(groups[1].entities.map((e) => e.name).sort()).toEqual(["Dance", "Lanier"]);

    // Group 2: St Agnes
    expect(groups[2].index).toBe(2);
    expect(groups[2].entities.map((e) => e.name)).toEqual(["St Agnes"]);
  }, 30_000);

  it("sets group-scoped associatedPrimaryIds (not blanket)", async () => {
    const schemaId = serviceSchemaIds[0];

    // Ziad Allan should only be associated with Soccer (his group), not all primaries
    const ziad = await prisma.entity.findFirst({
      where: { schemaId, name: "Ziad Allan", type: "SECONDARY" },
      select: { associatedPrimaryIds: true, groupId: true },
    });

    expect(ziad).toBeDefined();
    expect(ziad!.groupId).toBeTruthy(); // Should have a groupId

    const assocIds = ziad!.associatedPrimaryIds as string[];
    expect(assocIds).toHaveLength(1); // Only Soccer, not all 4 primaries

    // Verify it points to Soccer specifically
    const soccer = await prisma.entity.findFirst({
      where: { schemaId, name: "Soccer", type: "PRIMARY" },
      select: { id: true },
    });
    expect(assocIds[0]).toBe(soccer!.id);
  }, 15_000);

  it("stores groups in interviewResponses", async () => {
    const schemaId = serviceSchemaIds[0];

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { interviewResponses: true },
    });

    const responses = schema!.interviewResponses as { groups?: unknown[] };
    expect(responses.groups).toBeDefined();
    expect(responses.groups).toHaveLength(3);
  }, 15_000);

  it("all entities have a groupId", async () => {
    const schemaId = serviceSchemaIds[0];

    const entities = await prisma.entity.findMany({
      where: { schemaId, isActive: true },
      select: { name: true, groupId: true },
    });

    // All 5 entities (4 PRIMARY + 1 SECONDARY) should have groupId set
    for (const entity of entities) {
      expect(entity.groupId, `Entity "${entity.name}" should have a groupId`).toBeTruthy();
    }
  }, 15_000);

  it("loads entityGroups into extraction schema context from DB", async () => {
    const schemaId = serviceSchemaIds[0];

    // Simulate what the extraction service does: load schema with entityGroups
    const schema = await prisma.caseSchema.findUniqueOrThrow({
      where: { id: schemaId },
      include: {
        tags: { where: { isActive: true }, select: { name: true, description: true, isActive: true } },
        entities: { where: { isActive: true }, select: { name: true, type: true, aliases: true, isActive: true, autoDetected: true } },
        extractedFields: { select: { name: true, type: true, description: true, source: true } },
        exclusionRules: { where: { isActive: true }, select: { ruleType: true, pattern: true, isActive: true } },
        entityGroups: {
          orderBy: { index: "asc" },
          include: { entities: { where: { isActive: true }, select: { name: true, type: true, isActive: true } } },
        },
      },
    });

    // Build entityGroups the same way extraction service does
    const entityGroups = schema.entityGroups.map((g) => ({
      whats: g.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name),
      whos: g.entities.filter((e) => e.type === "SECONDARY").map((e) => e.name),
    }));

    expect(entityGroups).toHaveLength(3);
    expect(entityGroups[0]).toEqual({ whats: ["Soccer"], whos: ["Ziad Allan"] });
    expect(entityGroups[1].whats.sort()).toEqual(["Dance", "Lanier"]);
    expect(entityGroups[1].whos).toEqual([]);
    expect(entityGroups[2]).toEqual({ whats: ["St Agnes"], whos: [] });
  }, 15_000);

  it("extraction prompt renders group context for Gemini", async () => {
    const schemaContext = {
      domain: "school_parent",
      tags: [{ name: "Schedule", description: "Schedule changes" }],
      entities: [
        { name: "Soccer", type: "PRIMARY" as const, aliases: [], isUserInput: true },
        { name: "Ziad Allan", type: "SECONDARY" as const, aliases: [], isUserInput: true },
        { name: "Dance", type: "PRIMARY" as const, aliases: [], isUserInput: true },
        { name: "Lanier", type: "PRIMARY" as const, aliases: [], isUserInput: true },
        { name: "St Agnes", type: "PRIMARY" as const, aliases: [], isUserInput: true },
      ],
      extractedFields: [],
      exclusionPatterns: [],
      entityGroups: [
        { whats: ["Soccer"], whos: ["Ziad Allan"] },
        { whats: ["Dance", "Lanier"], whos: [] },
        { whats: ["St Agnes"], whos: [] },
      ],
    };

    const email = {
      subject: "ZSA U11/12 Girls Practice Update",
      sender: "Ziad Allan <ziad@zsa.org>",
      senderEmail: "ziad@zsa.org",
      senderDomain: "zsa.org",
      senderDisplayName: "Ziad Allan",
      date: "2026-03-15T10:00:00Z",
      body: "Hi parents, practice is moved to Thursday this week.",
      isReply: false,
    };

    const prompt = buildExtractionPrompt(email, schemaContext);

    // Verify group section is in the prompt
    expect(prompt.system).toContain("ENTITY GROUPS");
    expect(prompt.system).toContain('"Soccer" (PRIMARY) + "Ziad Allan" (SECONDARY)');
    expect(prompt.system).toContain('"Dance" (PRIMARY), "Lanier" (PRIMARY)');
    expect(prompt.system).toContain('"St Agnes" (PRIMARY)');

    // Verify scoring guide
    expect(prompt.system).toContain("3+ names from same group");
    expect(prompt.system).toContain("relevanceEntity to the PRIMARY entity");
  });

  it("finalize without groups falls back to blanket association", async () => {
    const confirmations = {
      confirmedEntities: [] as string[],
      removedEntities: [] as string[],
      confirmedTags: [] as string[],
      removedTags: [] as string[],
      // No groups field
    };

    const schemaId = await finalizeSchema(
      FIXTURE_HYPOTHESIS,
      FIXTURE_VALIDATION,
      confirmations,
      { userId: serviceTestUser.userId },
    );
    serviceSchemaIds.push(schemaId);

    // No EntityGroup rows should be created
    const groups = await prisma.entityGroup.findMany({
      where: { schemaId },
    });
    expect(groups).toHaveLength(0);

    // Ziad Allan should be associated with ALL primaries (blanket)
    const ziad = await prisma.entity.findFirst({
      where: { schemaId, name: "Ziad Allan", type: "SECONDARY" },
      select: { associatedPrimaryIds: true, groupId: true },
    });

    expect(ziad!.groupId).toBeNull();
    const assocIds = ziad!.associatedPrimaryIds as string[];
    expect(assocIds.length).toBeGreaterThanOrEqual(2); // All primaries
  }, 30_000);
});
