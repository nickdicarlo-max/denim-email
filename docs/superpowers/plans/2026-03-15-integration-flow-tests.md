# Integration Flow Tests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 4 missing integration flow tests (interview, extraction, synthesis edge cases, feedback) with explicit timeout reporting for long-running AI calls.

**Architecture:** Each flow test uses the existing test helpers (test-user, test-schema, test-emails) and exercises real services against the dev Supabase DB. Interview and feedback tests hit HTTP routes (require running dev server). Extraction and synthesis tests call services directly. All AI calls are live (Claude for interview/synthesis, Gemini for extraction). A shared `withTimeout()` helper wraps every AI-dependent call so timeouts surface as named failures, not silent hangs.

**Tech Stack:** Vitest, Supabase Auth (admin API for test users), Prisma, Claude API, Gemini API, Next.js API routes

---

## File Structure

**Create:**
- `apps/web/tests/integration/helpers/timeout.ts` — `withTimeout()` helper for named timeout errors
- `apps/web/tests/integration/helpers/gmail-fixtures.ts` — `GmailMessageFull` fixture factory for extraction tests
- `apps/web/tests/integration/flows/interview.test.ts` — HTTP route tests for hypothesis + finalize
- `apps/web/tests/integration/flows/extraction.test.ts` — `extractEmail()` with live Gemini
- `apps/web/tests/integration/flows/synthesis-edge-cases.test.ts` — re-synthesis skip guard, action dedup, field aggregation
- `apps/web/tests/integration/flows/feedback.test.ts` — feedback API + FeedbackEvent creation
- `apps/web/src/app/api/feedback/route.ts` — feedback API route (does not exist yet, needed for feedback test)
- `apps/web/src/lib/services/feedback.ts` — FeedbackService (does not exist yet, needed for feedback test)
- `apps/web/src/lib/validation/feedback.ts` — Zod schema for feedback input

**Modify:**
- `apps/web/vitest.integration.config.ts` — increase `testTimeout` to 600000 (10 min) for multi-AI-call tests

**Existing (no changes):**
- `apps/web/tests/integration/helpers/test-user.ts`
- `apps/web/tests/integration/helpers/test-schema.ts`
- `apps/web/tests/integration/helpers/test-emails.ts`
- `apps/web/tests/integration/helpers/api-client.ts`
- `apps/web/tests/integration/helpers/setup.ts`

---

## Chunk 1: Shared Infrastructure

### Task 1: Timeout Helper

**Files:**
- Create: `apps/web/tests/integration/helpers/timeout.ts`

- [ ] **Step 1: Create the timeout helper**

```typescript
// apps/web/tests/integration/helpers/timeout.ts

/**
 * Races a promise against a timer. On timeout, throws a descriptive error
 * that names the operation and duration so test output is never ambiguous.
 *
 * Usage:
 *   await withTimeout(api.post("/api/interview/hypothesis", input), 120_000, "POST /api/interview/hypothesis (live Claude)")
 *
 * On timeout:
 *   Error: TIMEOUT: POST /api/interview/hypothesis (live Claude) did not respond within 120s
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () =>
        reject(
          new Error(
            `TIMEOUT: ${label} did not respond within ${ms / 1000}s`,
          ),
        ),
      ms,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timerId!);
  }
}
```

- [ ] **Step 2: Verify file was created**

Run: `ls apps/web/tests/integration/helpers/timeout.ts`
Expected: file exists

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/helpers/timeout.ts
git commit -m "feat: add withTimeout helper for integration test timeout reporting"
```

---

### Task 2: Gmail Fixture Factory

**Files:**
- Create: `apps/web/tests/integration/helpers/gmail-fixtures.ts`

The extraction test needs `GmailMessageFull` objects that mimic what the Gmail API returns. This factory builds them from minimal input.

- [ ] **Step 1: Create the fixture factory**

```typescript
// apps/web/tests/integration/helpers/gmail-fixtures.ts

import type { GmailMessageFull } from "@/lib/gmail/types";

interface GmailFixtureInput {
  id: string;
  threadId: string;
  subject: string;
  senderEmail: string;
  senderDisplayName: string;
  body: string;
  date?: Date;
  isReply?: boolean;
  attachmentCount?: number;
  recipients?: string[];
}

/**
 * Build a GmailMessageFull fixture from minimal input.
 * Derives senderDomain, sender string, and defaults from the input.
 */
export function buildGmailFixture(input: GmailFixtureInput): GmailMessageFull {
  const domain = input.senderEmail.split("@")[1];
  return {
    id: input.id,
    threadId: input.threadId,
    subject: input.subject,
    sender: `${input.senderDisplayName} <${input.senderEmail}>`,
    senderEmail: input.senderEmail,
    senderDomain: domain,
    senderDisplayName: input.senderDisplayName,
    recipients: input.recipients ?? [],
    date: input.date ?? new Date(),
    snippet: input.body.slice(0, 100),
    isReply: input.isReply ?? false,
    labels: [],
    body: input.body,
    attachmentIds: [],
    attachmentCount: input.attachmentCount ?? 0,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/tests/integration/helpers/gmail-fixtures.ts
git commit -m "feat: add Gmail fixture factory for extraction integration tests"
```

---

### Task 3: Increase Vitest Integration Timeout

**Files:**
- Modify: `apps/web/vitest.integration.config.ts`

Some pipeline steps (synthesis with multiple Claude calls) can take several minutes. The current 300s (5 min) timeout is tight. Bump to 600s (10 min) as the global fallback. Individual tests use `withTimeout()` with tighter per-operation limits.

- [ ] **Step 1: Update the config**

Change `testTimeout: 300000` to `testTimeout: 600000`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/vitest.integration.config.ts
git commit -m "chore: increase integration test timeout to 10 min for multi-AI-call flows"
```

---

## Chunk 2: Interview Flow Test

### Task 4: Interview Flow Test (HTTP)

**Files:**
- Create: `apps/web/tests/integration/flows/interview.test.ts`

**Prerequisites:** Dev server running (`pnpm --filter web dev`), `.env.local` with `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

This test hits the HTTP routes, exercising auth middleware, Zod validation, and the full Claude call chain.

- [ ] **Step 1: Create the test file**

```typescript
// apps/web/tests/integration/flows/interview.test.ts

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
  }, 420_000); // 7 min: 2 Claude calls + DB writes + possible Gmail discovery attempt
});
```

- [ ] **Step 2: Run the test to verify it works**

Run: `pnpm --filter web test:integration -- --testPathPattern=interview`
Expected: All 4 tests pass (requires dev server running for HTTP calls)

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/flows/interview.test.ts
git commit -m "feat: add interview flow integration test (HTTP, live Claude)"
```

---

## Chunk 3: Extraction Flow Test

### Task 5: Extraction Flow Test (fixture Gmail, live Gemini)

**Files:**
- Create: `apps/web/tests/integration/flows/extraction.test.ts`

**Prerequisites:** `.env.local` with `GEMINI_API_KEY` (or `GOOGLE_AI_API_KEY`), database connection.

This test calls `extractEmail()` directly with fixture `GmailMessageFull` objects and lets Gemini do real extraction. Tests the full orchestration: exclusion check → Gemini call → entity resolution → upsert → denormalized count updates.

- [ ] **Step 1: Create the test file**

```typescript
// apps/web/tests/integration/flows/extraction.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, cleanupTestUser, type TestUser } from "../helpers/test-user";
import { createTestSchema, type TestSchemaResult } from "../helpers/test-schema";
import { buildGmailFixture } from "../helpers/gmail-fixtures";
import { withTimeout } from "../helpers/timeout";
import { extractEmail } from "@/lib/services/extraction";
import { prisma } from "@/lib/prisma";
import type { ExtractionSchemaContext } from "@denim/types";

let testUser: TestUser;
let testSchema: TestSchemaResult;
let schemaContext: ExtractionSchemaContext;
let entities: { name: string; type: "PRIMARY" | "SECONDARY"; aliases: string[] }[];
let exclusionRules: { ruleType: string; pattern: string; isActive: boolean }[];

describe("Extraction Flow (live Gemini)", () => {
  beforeAll(async () => {
    testUser = await withTimeout(
      createTestUser(),
      30_000,
      "createTestUser",
    );
    testSchema = await createTestSchema(testUser.userId);

    // Load schema context the same way the service does
    const schema = await prisma.caseSchema.findUniqueOrThrow({
      where: { id: testSchema.schema.id },
      include: {
        tags: { select: { name: true, description: true, isActive: true } },
        entities: { select: { name: true, type: true, aliases: true, isActive: true } },
        extractedFields: { select: { name: true, type: true, description: true, source: true } },
        exclusionRules: { select: { ruleType: true, pattern: true, isActive: true } },
      },
    });

    schemaContext = {
      domain: schema.domain ?? "general",
      tags: schema.tags.filter((t) => t.isActive).map((t) => ({ name: t.name, description: t.description ?? "" })),
      entities: schema.entities.filter((e) => e.isActive).map((e) => ({
        name: e.name,
        type: e.type as "PRIMARY" | "SECONDARY",
        aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
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
    expect(result.failed).toBe(false);
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

    // Record schema emailCount before re-extraction
    const schemaBefore = await prisma.caseSchema.findUniqueOrThrow({
      where: { id: testSchema.schema.id },
      select: { emailCount: true },
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
    expect(result.failed).toBe(false);

    // Should not have created a duplicate
    const emailCount = await prisma.email.count({
      where: {
        schemaId: testSchema.schema.id,
        gmailMessageId: "extract_test_1",
      },
    });
    expect(emailCount).toBe(1);

    // emailCount should NOT have incremented again
    const schemaAfter = await prisma.caseSchema.findUniqueOrThrow({
      where: { id: testSchema.schema.id },
      select: { emailCount: true },
    });
    expect(schemaAfter.emailCount).toBe(schemaBefore.emailCount);

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
    expect(result.failed).toBe(false);

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
  // Denormalized counts
  // -------------------------------------------------------------------
  it("schema and entity emailCounts are correct", async () => {
    const schema = await prisma.caseSchema.findUniqueOrThrow({
      where: { id: testSchema.schema.id },
      select: { emailCount: true },
    });

    // We extracted 1 real email + 1 excluded (excluded should NOT count)
    // The idempotent re-extraction should NOT double-count
    expect(schema.emailCount).toBe(1);
  });

  // -------------------------------------------------------------------
  // ExtractionCost logged
  // -------------------------------------------------------------------
  it("ExtractionCost row was created for the Gemini call", async () => {
    const costs = await prisma.extractionCost.findMany({
      where: {
        email: { schemaId: testSchema.schema.id },
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
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter web test:integration -- --testPathPattern=extraction`
Expected: All 5 tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/flows/extraction.test.ts
git commit -m "feat: add extraction flow integration test (fixture Gmail, live Gemini)"
```

---

## Chunk 4: Synthesis Edge Cases Test

### Task 6: Synthesis Edge Cases Test

**Files:**
- Create: `apps/web/tests/integration/flows/synthesis-edge-cases.test.ts`

**Prerequisites:** `.env.local` with `ANTHROPIC_API_KEY`, database connection.

This test focuses on behaviors NOT covered by `full-pipeline.test.ts`: the skip guard, re-synthesis with new emails, action dedup across runs, and field aggregation. It seeds data, clusters, synthesizes, then manipulates state and re-synthesizes.

- [ ] **Step 1: Create the test file**

```typescript
// apps/web/tests/integration/flows/synthesis-edge-cases.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, cleanupTestUser, type TestUser } from "../helpers/test-user";
import { createTestSchema, type TestSchemaResult } from "../helpers/test-schema";
import { seedTestEmails } from "../helpers/test-emails";
import { withTimeout } from "../helpers/timeout";
import { clusterNewEmails } from "@/lib/services/cluster";
import { synthesizeCase } from "@/lib/services/synthesis";
import { prisma } from "@/lib/prisma";

let testUser: TestUser;
let testSchema: TestSchemaResult;

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
    await withTimeout(
      clusterNewEmails(testSchema.schema.id),
      60_000,
      "clusterNewEmails (setup)",
    );
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
    });
    expect(cases.length).toBeGreaterThanOrEqual(1);

    const targetCase = cases[0];

    await withTimeout(
      synthesizeCase(targetCase.id, testSchema.schema.id),
      300_000,
      `synthesizeCase (first run, caseId=${targetCase.id})`,
    );

    const updated = await prisma.case.findUniqueOrThrow({
      where: { id: targetCase.id },
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
    const cases = await prisma.case.findMany({
      where: { schemaId: testSchema.schema.id },
    });
    const targetCase = cases[0];

    const before = await prisma.case.findUniqueOrThrow({
      where: { id: targetCase.id },
      select: { synthesizedAt: true, title: true },
    });

    expect(before.synthesizedAt).toBeTruthy();
    const originalSynthesizedAt = before.synthesizedAt!.toISOString();

    // Re-synthesize — should skip
    await withTimeout(
      synthesizeCase(targetCase.id, testSchema.schema.id),
      30_000,
      "synthesizeCase (skip guard — no new emails, should return fast)",
    );

    const after = await prisma.case.findUniqueOrThrow({
      where: { id: targetCase.id },
      select: { synthesizedAt: true, title: true },
    });

    expect(after.synthesizedAt!.toISOString()).toBe(originalSynthesizedAt);
    expect(after.title).toBe(before.title);
  }, 60_000);

  // -------------------------------------------------------------------
  // Re-synthesis after adding a new email updates the case
  // -------------------------------------------------------------------
  it("adding new email and re-synthesizing updates synthesizedAt", async () => {
    const cases = await prisma.case.findMany({
      where: { schemaId: testSchema.schema.id },
    });
    const targetCase = cases[0];

    const before = await prisma.case.findUniqueOrThrow({
      where: { id: targetCase.id },
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
        caseId: targetCase.id,
        emailId: newEmail.id,
        assignedBy: "CLUSTERING",
        clusteringScore: 90,
      },
    });

    // Re-synthesize — should NOT skip because there's a new email
    await withTimeout(
      synthesizeCase(targetCase.id, testSchema.schema.id),
      300_000,
      "synthesizeCase (re-synthesis with new email)",
    );

    const after = await prisma.case.findUniqueOrThrow({
      where: { id: targetCase.id },
      select: { synthesizedAt: true },
    });

    // synthesizedAt should have been updated
    expect(after.synthesizedAt!.getTime()).toBeGreaterThan(
      before.synthesizedAt!.getTime(),
    );
  }, 360_000);

  // -------------------------------------------------------------------
  // Action dedup: same fingerprint across runs produces 1 action
  // -------------------------------------------------------------------
  it("action dedup prevents duplicate actions across synthesis runs", async () => {
    const cases = await prisma.case.findMany({
      where: { schemaId: testSchema.schema.id },
    });
    const targetCase = cases[0];

    const actionsBefore = await prisma.caseAction.findMany({
      where: { caseId: targetCase.id },
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
  }, 600_000); // Up to 10 min for multiple Claude calls
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter web test:integration -- --testPathPattern=synthesis-edge`
Expected: All 5 tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/flows/synthesis-edge-cases.test.ts
git commit -m "feat: add synthesis edge case integration tests (skip guard, resynth, dedup)"
```

---

## Chunk 5: Feedback Flow (Service + API + Test)

### Task 7: Feedback Validation Schema

**Files:**
- Create: `apps/web/src/lib/validation/feedback.ts`

- [ ] **Step 1: Create the Zod schema**

```typescript
// apps/web/src/lib/validation/feedback.ts

import { z } from "zod";

export const FeedbackInputSchema = z.object({
  schemaId: z.string().uuid("schemaId must be a valid UUID"),
  type: z.enum([
    "THUMBS_UP",
    "THUMBS_DOWN",
    "EMAIL_MOVE",
    "EMAIL_EXCLUDE",
    "CASE_MERGE",
    "CASE_SPLIT",
    "TAG_EDIT",
    "ENTITY_MERGE",
    "ENTITY_EDIT",
  ]),
  caseId: z.string().uuid().optional(),
  emailId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).optional(),
});

export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/validation/feedback.ts
git commit -m "feat: add Zod validation schema for feedback input"
```

---

### Task 8: Feedback Service

**Files:**
- Create: `apps/web/src/lib/services/feedback.ts`

Write owner for: FeedbackEvent. Also updates Email.isExcluded for EMAIL_EXCLUDE events.

- [ ] **Step 1: Create the service**

```typescript
// apps/web/src/lib/services/feedback.ts

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { FeedbackInput } from "@/lib/validation/feedback";

interface FeedbackResult {
  eventId: string;
}

/**
 * Record a feedback event. Write owner for FeedbackEvent table.
 * Also handles side effects for specific event types.
 */
export async function recordFeedback(
  input: FeedbackInput,
  userId: string,
): Promise<FeedbackResult> {
  const start = Date.now();

  // Verify the schema belongs to this user
  const schema = await prisma.caseSchema.findFirst({
    where: { id: input.schemaId, userId },
    select: { id: true },
  });

  if (!schema) {
    const { NotFoundError } = await import("@denim/types");
    throw new NotFoundError("Schema not found");
  }

  // Create the FeedbackEvent (append-only)
  const event = await prisma.feedbackEvent.create({
    data: {
      schemaId: input.schemaId,
      eventType: input.type,
      caseId: input.caseId ?? null,
      emailId: input.emailId ?? null,
      payload: input.payload ?? {},
    },
  });

  // Side effects by event type
  if (input.type === "EMAIL_EXCLUDE" && input.emailId) {
    await prisma.email.update({
      where: { id: input.emailId },
      data: {
        isExcluded: true,
        excludeReason: "user:manual",
      },
    });
  }

  const durationMs = Date.now() - start;
  logger.info({
    service: "feedback",
    operation: "recordFeedback",
    userId,
    schemaId: input.schemaId,
    type: input.type,
    eventId: event.id,
    durationMs,
  });

  return { eventId: event.id };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/services/feedback.ts
git commit -m "feat: add FeedbackService (recordFeedback, append-only events)"
```

---

### Task 9: Feedback API Route

**Files:**
- Create: `apps/web/src/app/api/feedback/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
// apps/web/src/app/api/feedback/route.ts

import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { recordFeedback } from "@/lib/services/feedback";
import { FeedbackInputSchema } from "@/lib/validation/feedback";
import { ValidationError } from "@denim/types";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();

    const parsed = FeedbackInputSchema.safeParse(body);
    if (!parsed.success) {
      const messages = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new ValidationError(messages);
    }

    const result = await recordFeedback(parsed.data, userId);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error, {
      service: "feedback",
      operation: "POST /api/feedback",
      userId,
    });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/api/feedback/route.ts
git commit -m "feat: add POST /api/feedback route"
```

---

### Task 10: Feedback Flow Test

**Files:**
- Create: `apps/web/tests/integration/flows/feedback.test.ts`

**Prerequisites:** Dev server running, database connection.

This test creates a user + schema + emails, clusters and synthesizes to get cases, then tests feedback via HTTP routes.

- [ ] **Step 1: Create the test file**

```typescript
// apps/web/tests/integration/flows/feedback.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, cleanupTestUser, type TestUser } from "../helpers/test-user";
import { createTestSchema, type TestSchemaResult } from "../helpers/test-schema";
import { seedTestEmails } from "../helpers/test-emails";
import { createApiClient } from "../helpers/api-client";
import { withTimeout } from "../helpers/timeout";
import { clusterNewEmails } from "@/lib/services/cluster";
import { synthesizeCase } from "@/lib/services/synthesis";
import { prisma } from "@/lib/prisma";

let testUser: TestUser;
let testSchema: TestSchemaResult;
let api: ReturnType<typeof createApiClient>;
let caseIds: string[] = [];

describe("Feedback Flow (HTTP)", () => {
  beforeAll(async () => {
    testUser = await withTimeout(createTestUser(), 30_000, "createTestUser");
    testSchema = await createTestSchema(testUser.userId);
    api = createApiClient(testUser.accessToken);

    await seedTestEmails(testSchema.schema.id, {
      vmsId: testSchema.entities.vms.id,
      evscId: testSchema.entities.evsc.id,
      coachId: testSchema.entities.coach.id,
    });

    // Cluster to create cases
    await withTimeout(
      clusterNewEmails(testSchema.schema.id),
      60_000,
      "clusterNewEmails (feedback setup)",
    );

    // Synthesize all cases
    const cases = await prisma.case.findMany({
      where: { schemaId: testSchema.schema.id },
    });
    caseIds = cases.map((c) => c.id);

    for (const c of cases) {
      await withTimeout(
        synthesizeCase(c.id, testSchema.schema.id),
        300_000,
        `synthesizeCase (feedback setup, caseId=${c.id})`,
      );
    }
  }, 600_000); // Up to 10 min for full pipeline setup

  afterAll(async () => {
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  // -------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------
  it("rejects unauthenticated feedback request with 401", async () => {
    const unauthApi = createApiClient("invalid-token");
    const res = await withTimeout(
      unauthApi.post("/api/feedback", {
        schemaId: testSchema.schema.id,
        type: "THUMBS_UP",
        caseId: caseIds[0],
      }),
      15_000,
      "POST /api/feedback (unauth)",
    );
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------
  // Zod Validation
  // -------------------------------------------------------------------
  it("rejects invalid feedback type with 400", async () => {
    const res = await withTimeout(
      api.post("/api/feedback", {
        schemaId: testSchema.schema.id,
        type: "INVALID_TYPE",
        caseId: caseIds[0],
      }),
      15_000,
      "POST /api/feedback (invalid type)",
    );
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------
  // THUMBS_DOWN creates FeedbackEvent
  // -------------------------------------------------------------------
  it("thumbs down creates FeedbackEvent", async () => {
    const res = await withTimeout(
      api.post("/api/feedback", {
        schemaId: testSchema.schema.id,
        type: "THUMBS_DOWN",
        caseId: caseIds[0],
        payload: { reason: "Wrong emails grouped together" },
      }),
      15_000,
      "POST /api/feedback (THUMBS_DOWN)",
    );

    expect(res.status).toBe(200);

    const body = res.data as { data: { eventId: string } };
    expect(body.data.eventId).toBeTruthy();

    // Verify in DB
    const event = await prisma.feedbackEvent.findUnique({
      where: { id: body.data.eventId },
    });
    expect(event).toBeDefined();
    expect(event!.eventType).toBe("THUMBS_DOWN");
    expect(event!.caseId).toBe(caseIds[0]);
    expect(event!.schemaId).toBe(testSchema.schema.id);
  });

  // -------------------------------------------------------------------
  // EMAIL_EXCLUDE sets isExcluded on email
  // -------------------------------------------------------------------
  it("email exclude marks email as excluded", async () => {
    // Find a non-excluded email
    const email = await prisma.email.findFirst({
      where: {
        schemaId: testSchema.schema.id,
        isExcluded: false,
      },
    });
    expect(email).toBeDefined();

    const res = await withTimeout(
      api.post("/api/feedback", {
        schemaId: testSchema.schema.id,
        type: "EMAIL_EXCLUDE",
        emailId: email!.id,
        payload: { reason: "Not relevant" },
      }),
      15_000,
      "POST /api/feedback (EMAIL_EXCLUDE)",
    );

    expect(res.status).toBe(200);

    // Verify email is now excluded
    const updated = await prisma.email.findUniqueOrThrow({
      where: { id: email!.id },
    });
    expect(updated.isExcluded).toBe(true);
    expect(updated.excludeReason).toBe("user:manual");
  });

  // -------------------------------------------------------------------
  // THUMBS_UP works
  // -------------------------------------------------------------------
  it("thumbs up creates FeedbackEvent", async () => {
    const res = await withTimeout(
      api.post("/api/feedback", {
        schemaId: testSchema.schema.id,
        type: "THUMBS_UP",
        caseId: caseIds[0],
      }),
      15_000,
      "POST /api/feedback (THUMBS_UP)",
    );

    expect(res.status).toBe(200);

    const body = res.data as { data: { eventId: string } };
    expect(body.data.eventId).toBeTruthy();
  });

  // -------------------------------------------------------------------
  // RLS: another user can't feedback on this schema
  // -------------------------------------------------------------------
  it("another user gets 404 when targeting this schema", async () => {
    // Create a second user
    const otherUser = await prisma.user.create({
      data: {
        id: "other-user-" + Date.now(),
        email: "other@test.com",
        displayName: "Other User",
      },
    });

    // We can't easily get an auth token for a second Supabase user in the same test,
    // so test the service directly instead of HTTP
    const { recordFeedback } = await import("@/lib/services/feedback");

    let threw = false;
    try {
      await recordFeedback(
        {
          schemaId: testSchema.schema.id,
          type: "THUMBS_UP",
          caseId: caseIds[0],
        },
        otherUser.id,
      );
    } catch (error: any) {
      threw = true;
      expect(error.constructor.name).toBe("NotFoundError");
    }

    expect(threw).toBe(true);

    // Clean up other user
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  // -------------------------------------------------------------------
  // FeedbackEvents are append-only
  // -------------------------------------------------------------------
  it("multiple feedback events accumulate (append-only)", async () => {
    const events = await prisma.feedbackEvent.findMany({
      where: { schemaId: testSchema.schema.id },
      orderBy: { createdAt: "asc" },
    });

    // We created THUMBS_DOWN, EMAIL_EXCLUDE, and THUMBS_UP above
    expect(events.length).toBeGreaterThanOrEqual(3);

    // All events should have distinct IDs and timestamps
    const ids = events.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter web test:integration -- --testPathPattern=feedback`
Expected: All 7 tests pass (requires dev server running for HTTP calls)

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/flows/feedback.test.ts
git commit -m "feat: add feedback flow integration test (HTTP, service, append-only events)"
```

---

## Chunk 6: Final Verification

### Task 11: Run All Integration Tests

- [ ] **Step 1: Run the full integration suite**

Run: `pnpm --filter web test:integration`
Expected: All test files pass:
- `flows/full-pipeline.test.ts` (existing)
- `flows/interview.test.ts` (new)
- `flows/extraction.test.ts` (new)
- `flows/synthesis-edge-cases.test.ts` (new)
- `flows/feedback.test.ts` (new)

Note: `fileParallelism: false` means tests run sequentially. Total time will be 10-30 minutes depending on AI API response times.

- [ ] **Step 2: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: complete integration test suite (4 new flow tests + helpers)"
```
