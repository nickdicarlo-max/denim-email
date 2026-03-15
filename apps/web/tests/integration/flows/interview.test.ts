import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, cleanupTestUser, type TestUser } from "../helpers/test-user";
import { createApiClient } from "../helpers/api-client";
import { withTimeout } from "../helpers/timeout";
import { prisma } from "@/lib/prisma";

let testUser: TestUser;
let api: ReturnType<typeof createApiClient>;

// Track schemaIds created during finalize test for cleanup
const createdSchemaIds: string[] = [];

describe("Interview Flow (HTTP)", () => {
  beforeAll(async () => {
    testUser = await withTimeout(
      createTestUser(),
      30_000,
      "createTestUser (Supabase Auth)",
    );
    api = createApiClient(testUser.accessToken);
  }, 60_000);

  afterAll(async () => {
    // Clean up any schemas created during finalize tests
    for (const schemaId of createdSchemaIds) {
      await prisma.caseSchema.deleteMany({ where: { id: schemaId } });
    }
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  // -------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------
  it("rejects unauthenticated request with 401", async () => {
    const unauthApi = createApiClient("invalid-token-abc123");
    const res = await withTimeout(
      unauthApi.post("/api/interview/hypothesis", {
        role: "parent",
        domain: "school_parent",
        whats: ["Test School"],
        whos: [],
        goals: ["actions"],
      }),
      15_000,
      "POST /api/interview/hypothesis (unauth)",
    );
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------
  // Zod Validation
  // -------------------------------------------------------------------
  it("rejects invalid input with 400 and VALIDATION_ERROR", async () => {
    const res = await withTimeout(
      api.post("/api/interview/hypothesis", {
        role: "parent",
        // missing: domain, whats, goals
      }),
      15_000,
      "POST /api/interview/hypothesis (invalid input)",
    );
    expect(res.status).toBe(400);
    const data = res.data as { type?: string };
    expect(data.type).toBe("VALIDATION_ERROR");
  });

  // -------------------------------------------------------------------
  // Hypothesis Generation (live Claude call)
  // -------------------------------------------------------------------
  it("generates hypothesis with valid structure", async () => {
    const res = await withTimeout(
      api.post("/api/interview/hypothesis", {
        role: "parent",
        domain: "school_parent",
        whats: ["Oakridge Elementary"],
        whos: ["Coach Thompson"],
        goals: ["actions", "schedule"],
      }),
      180_000,
      "POST /api/interview/hypothesis (live Claude call)",
    );

    expect(res.status).toBe(200);

    const body = res.data as { data: Record<string, unknown> };
    expect(body.data).toBeDefined();

    const h = body.data as any;

    // Domain preserved
    expect(h.domain).toBe("school_parent");

    // Schema name generated
    expect(h.schemaName).toBeTruthy();

    // Primary entity config exists
    expect(h.primaryEntity).toBeDefined();
    expect(h.primaryEntity.name).toBeTruthy();

    // Tags: at least 5
    expect(h.tags.length).toBeGreaterThanOrEqual(5);

    // Entities: at least 1 (the user-provided school)
    expect(h.entities.length).toBeGreaterThanOrEqual(1);
    const school = h.entities.find(
      (e: any) =>
        e.name.toLowerCase().includes("oakridge") ||
        e.name.toLowerCase().includes("elementary"),
    );
    expect(school).toBeDefined();
    expect(school.type).toBe("PRIMARY");

    // Clustering config has reasonable mergeThreshold
    expect(h.clusteringConfig).toBeDefined();
    expect(h.clusteringConfig.mergeThreshold).toBeGreaterThan(0);
    expect(h.clusteringConfig.mergeThreshold).toBeLessThan(100);

    // Discovery queries generated
    expect(h.discoveryQueries.length).toBeGreaterThanOrEqual(1);

    // Summary labels generated
    expect(h.summaryLabels).toBeDefined();
    expect(h.summaryLabels.beginning).toBeTruthy();
    expect(h.summaryLabels.middle).toBeTruthy();
    expect(h.summaryLabels.end).toBeTruthy();

    // Extracted fields generated
    expect(h.extractedFields.length).toBeGreaterThanOrEqual(1);
  }, 240_000);

  // -------------------------------------------------------------------
  // Finalize (writes to DB)
  // -------------------------------------------------------------------
  it("finalizes schema and creates DB rows", async () => {
    // First generate a hypothesis to finalize
    const hypRes = await withTimeout(
      api.post("/api/interview/hypothesis", {
        role: "parent",
        domain: "school_parent",
        whats: ["Finalize Test School"],
        whos: [],
        goals: ["actions"],
      }),
      180_000,
      "POST /api/interview/hypothesis (for finalize test)",
    );
    expect(hypRes.status).toBe(200);

    const hypothesis = (hypRes.data as any).data;

    // Build minimal validation + confirmations to finalize
    const validation = {
      confirmedEntities: [],
      discoveredEntities: [],
      suggestedTags: [],
      confidenceScore: 0.8,
      sampleEmailCount: 0,
      scanDurationMs: 0,
    };

    const confirmations = {
      confirmedEntities: [],
      removedEntities: [],
      confirmedTags: [],
      removedTags: [],
      schemaName: "Integration Test Schema",
    };

    const finalRes = await withTimeout(
      api.post("/api/interview/finalize", {
        hypothesis,
        validation,
        confirmations,
      }),
      180_000,
      "POST /api/interview/finalize (DB write + optional Gmail discovery)",
    );

    // Finalize may partially fail (Gmail token missing for discovery) but
    // schema creation should succeed — check for 200 with schemaId
    expect(finalRes.status).toBe(200);

    const finalData = (finalRes.data as any).data;
    expect(finalData.schemaId).toBeTruthy();

    const schemaId = finalData.schemaId;
    createdSchemaIds.push(schemaId);

    // Verify DB state: CaseSchema exists
    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      include: {
        entities: true,
        tags: true,
        extractedFields: true,
      },
    });

    expect(schema).toBeDefined();
    expect(schema!.name).toBe("Integration Test Schema");
    expect(schema!.domain).toBe("school_parent");
    expect(schema!.status).toBe("ONBOARDING");

    // Entities created from hypothesis
    expect(schema!.entities.length).toBeGreaterThanOrEqual(1);

    // Tags created from hypothesis
    expect(schema!.tags.length).toBeGreaterThanOrEqual(5);

    // Extracted field defs created
    expect(schema!.extractedFields.length).toBeGreaterThanOrEqual(1);
  }, 420_000);
});
