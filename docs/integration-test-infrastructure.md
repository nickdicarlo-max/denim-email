# Integration Test Infrastructure

## Problem

Unit tests pass but the application doesn't work because:
- Auth flows aren't tested (every route requires a signed-in user)
- Pipeline stages work in isolation but fail at handoff points
- Fixture data is clean but real data flows are messy
- The AI writes tests that mirror the implementation, not the intention

## Solution

Build integration test infrastructure that lets the AI coding agent verify
complete flows without human involvement. The human focuses on qualitative
judgment (are the cases good?), not basic functionality (does sign-in work?).

---

## Architecture

```
tests/
  integration/
    helpers/
      test-user.ts          # Creates and authenticates a test user
      test-schema.ts         # Creates a complete CaseSchema with known data
      test-emails.ts         # Seeds realistic email fixture data
      test-cases.ts          # Seeds cases with known structure
      api-client.ts          # Authenticated HTTP client for API routes
      cleanup.ts             # Tears down test data between runs
    flows/
      interview.test.ts      # Full interview flow: input -> schema in DB
      extraction.test.ts     # Email -> extraction -> Email rows in DB
      clustering.test.ts     # Extracted emails -> cases in DB
      synthesis.test.ts      # Clustered emails -> case titles/summaries/actions
      feedback.test.ts       # User correction -> events -> re-synthesis
      full-pipeline.test.ts  # Email in -> case card out (end-to-end)
```

---

## Test User Helper

The test user bypasses real Google OAuth but creates a real Supabase session.
Every integration test starts with a signed-in user.

```typescript
// tests/integration/helpers/test-user.ts

import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,  // Admin client, bypasses RLS
);

// Test user credentials (only in test environment)
const TEST_USER = {
  email: "test-integration@denim-email.test",
  password: "test-password-not-for-production",
};

/**
 * Creates a test user in Supabase Auth and returns an authenticated session.
 * Call once in beforeAll(). The session token is used by apiClient for all requests.
 *
 * Uses Supabase's admin API to create the user (no real Google OAuth needed).
 */
export async function createTestUser() {
  // Create user via admin API (idempotent: returns existing user if email matches)
  const { data: authUser, error: createError } =
    await supabaseAdmin.auth.admin.createUser({
      email: TEST_USER.email,
      password: TEST_USER.password,
      email_confirm: true,  // Skip email verification
    });

  if (createError && !createError.message.includes("already exists")) {
    throw new Error(`Failed to create test user: ${createError.message}`);
  }

  // Sign in to get a session token
  const { data: session, error: signInError } =
    await supabaseAdmin.auth.signInWithPassword({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });

  if (signInError) {
    throw new Error(`Failed to sign in test user: ${signInError.message}`);
  }

  return {
    userId: session.user.id,
    accessToken: session.session.access_token,
    refreshToken: session.session.refresh_token,
  };
}

/**
 * Deletes all data for the test user. Call in afterAll().
 * Cascade deletes handle most cleanup via the Prisma schema.
 */
export async function cleanupTestUser(userId: string) {
  // Delete schemas (cascades to entities, tags, emails, cases, actions, etc.)
  await prisma.caseSchema.deleteMany({ where: { userId } });

  // Delete the auth user
  await supabaseAdmin.auth.admin.deleteUser(userId);
}
```

---

## Authenticated API Client

Every integration test calls API routes through this client.
It attaches the test user's auth token to every request.

```typescript
// tests/integration/helpers/api-client.ts

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

/**
 * HTTP client that attaches auth headers to every request.
 * Mirrors what the Chrome extension does.
 */
export function createApiClient(accessToken: string) {
  async function request(method: string, path: string, body?: unknown) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    return {
      status: response.status,
      data,
      ok: response.ok,
    };
  }

  return {
    get: (path: string) => request("GET", path),
    post: (path: string, body: unknown) => request("POST", path, body),
    put: (path: string, body: unknown) => request("PUT", path, body),
    delete: (path: string) => request("DELETE", path),
  };
}
```

---

## Test Schema Helper

Creates a complete, realistic CaseSchema with known data.
Tests assert against this known structure.

```typescript
// tests/integration/helpers/test-schema.ts

import { prisma } from "@/lib/prisma";

/**
 * Creates a fully populated CaseSchema for testing.
 * Returns the schema and all related entities/tags/fields.
 *
 * Uses the school_parent domain because it has the most
 * diverse data (events, payments, permissions, multiple entities).
 */
export async function createTestSchema(userId: string) {
  const schema = await prisma.caseSchema.create({
    data: {
      userId,
      name: "Test School Schema",
      description: "Integration test schema",
      domain: "school_parent",
      status: "ACTIVE",
      interviewResponses: {
        role: "parent",
        whats: ["Vail Mountain School", "Eagle Valley SC"],
        whos: ["Coach Martinez"],
        goals: ["actions", "schedule"],
      },
      summaryLabels: {
        beginning: "What",
        middle: "Details",
        end: "Action Needed",
      },
      clusteringConfig: {
        mergeThreshold: 35,
        threadMatchScore: 100,
        tagMatchScore: 30,
        subjectMatchScore: 15,
        actorAffinityScore: 25,
        subjectAdditiveBonus: 5,
        timeDecayDays: { fresh: 60, recent: 120, stale: 365 },
        weakTagDiscount: 0.5,
        frequencyThreshold: 0.4,
        anchorTagLimit: 2,
        caseSizeThreshold: 5,
        caseSizeMaxBonus: 10,
        reminderCollapseEnabled: true,
        reminderSubjectSimilarity: 0.85,
        reminderMaxAge: 30,
      },
      extractionPrompt: "Extract tags from: Action Required, Schedule, Payment...",
      synthesisPrompt: "Generate case summary with labels: What, Details, Action Needed...",
      defaultScanDepthDays: 90,
    },
  });

  // Create entities
  const vms = await prisma.entity.create({
    data: {
      schemaId: schema.id,
      name: "Vail Mountain School",
      type: "PRIMARY",
      autoDetected: false,
      confidence: 1.0,
      isActive: true,
      aliases: ["VMS", "Vail Mountain"],
    },
  });

  const evsc = await prisma.entity.create({
    data: {
      schemaId: schema.id,
      name: "Eagle Valley SC",
      type: "PRIMARY",
      autoDetected: false,
      confidence: 1.0,
      isActive: true,
      aliases: ["EVSC", "Eagle Valley Soccer"],
    },
  });

  const coach = await prisma.entity.create({
    data: {
      schemaId: schema.id,
      name: "Coach Martinez",
      type: "SECONDARY",
      secondaryTypeName: "Coach",
      autoDetected: false,
      confidence: 1.0,
      isActive: true,
      aliases: ["Martinez", "Coach M"],
    },
  });

  // Create tags
  const tags = await Promise.all(
    [
      "Action Required", "Schedule", "Payment",
      "Permission/Form", "Game/Match", "Practice",
    ].map((name) =>
      prisma.schemaTag.create({
        data: {
          schemaId: schema.id,
          name,
          description: `${name} related emails`,
          aiGenerated: true,
          isActive: true,
          autoWeight: 1.0,
        },
      })
    )
  );

  // Create extracted field definitions
  const eventDateField = await prisma.extractedFieldDef.create({
    data: {
      schemaId: schema.id,
      name: "eventDate",
      type: "DATE",
      description: "Date of the event or deadline",
      source: "BODY",
      format: "relative",
      showOnCard: true,
      aggregation: "LATEST",
    },
  });

  return { schema, entities: { vms, evsc, coach }, tags, fields: { eventDateField } };
}
```

---

## Test Email Fixtures

Realistic email data that exercises edge cases.

```typescript
// tests/integration/helpers/test-emails.ts

import { prisma } from "@/lib/prisma";

/**
 * Seeds realistic email fixtures into the database.
 * These simulate what ExtractionService would produce from real Gmail data.
 *
 * Includes:
 * - Multiple threads about the same topic (should cluster together)
 * - Emails from different entities (should stay separate)
 * - A misrouted email (should be flagged as low confidence)
 * - A reminder duplicate (should collapse, not create new action)
 * - An email from a noise sender (should be excluded)
 */
export async function seedTestEmails(schemaId: string, entityIds: { vmsId: string; evscId: string }) {
  const emails = [
    // --- VMS Permission Slip Thread (3 emails, should become 1 case) ---
    {
      gmailMessageId: "msg_vms_perm_1",
      threadId: "thread_vms_perm",
      schemaId,
      entityId: entityIds.vmsId,
      senderEmail: "office@vailmountainschool.org",
      senderDomain: "vailmountainschool.org",
      senderDisplayName: "VMS Office",
      subject: "Permission Slip: Denver Zoo Field Trip - Due March 15",
      date: new Date("2026-03-01T10:00:00Z"),
      summary: "Permission slip required for Denver Zoo field trip on March 20. Due by March 15.",
      tags: ["Permission/Form", "Action Required"],
      extractedData: { eventDate: "2026-03-20" },
      isReply: false,
      isExcluded: false,
    },
    {
      gmailMessageId: "msg_vms_perm_2",
      threadId: "thread_vms_perm",
      schemaId,
      entityId: entityIds.vmsId,
      senderEmail: "office@vailmountainschool.org",
      senderDomain: "vailmountainschool.org",
      senderDisplayName: "VMS Office",
      subject: "REMINDER: Permission Slip Due March 15",
      date: new Date("2026-03-10T10:00:00Z"),
      summary: "Reminder: Denver Zoo permission slip still needed. Due in 5 days.",
      tags: ["Permission/Form", "Action Required"],
      extractedData: { eventDate: "2026-03-20" },
      isReply: false,
      isExcluded: false,
    },
    {
      gmailMessageId: "msg_vms_perm_3",
      threadId: "thread_vms_perm",
      schemaId,
      entityId: entityIds.vmsId,
      senderEmail: "teacher@vailmountainschool.org",
      senderDomain: "vailmountainschool.org",
      senderDisplayName: "Mrs. Patterson",
      subject: "RE: Permission Slip: Denver Zoo Field Trip - Due March 15",
      date: new Date("2026-03-12T14:00:00Z"),
      summary: "Mrs. Patterson confirms the bus leaves at 8:30am. Bring a sack lunch.",
      tags: ["Permission/Form", "Schedule"],
      extractedData: { eventDate: "2026-03-20" },
      isReply: true,
      isExcluded: false,
    },

    // --- EVSC Practice Schedule (2 emails, separate case from permission slip) ---
    {
      gmailMessageId: "msg_evsc_sched_1",
      threadId: "thread_evsc_sched",
      schemaId,
      entityId: entityIds.evscId,
      senderEmail: "coach@eaglevalleysc.org",
      senderDomain: "eaglevalleysc.org",
      senderDisplayName: "Coach Martinez",
      subject: "Updated Practice Schedule - Spring Season",
      date: new Date("2026-03-05T16:00:00Z"),
      summary: "Spring practice starts March 18. Tuesday/Thursday 5:30-7pm at Oak Park.",
      tags: ["Schedule", "Practice"],
      extractedData: { eventDate: "2026-03-18" },
      isReply: false,
      isExcluded: false,
    },
    {
      gmailMessageId: "msg_evsc_sched_2",
      threadId: "thread_evsc_sched",
      schemaId,
      entityId: entityIds.evscId,
      senderEmail: "coach@eaglevalleysc.org",
      senderDomain: "eaglevalleysc.org",
      senderDisplayName: "Coach Martinez",
      subject: "RE: Updated Practice Schedule - Spring Season",
      date: new Date("2026-03-06T09:00:00Z"),
      summary: "Correction: Thursday practice is at 6pm, not 5:30pm. Sorry for confusion.",
      tags: ["Schedule", "Practice"],
      extractedData: { eventDate: "2026-03-18" },
      isReply: true,
      isExcluded: false,
    },

    // --- VMS Payment (different case within same entity) ---
    {
      gmailMessageId: "msg_vms_payment_1",
      threadId: "thread_vms_payment",
      schemaId,
      entityId: entityIds.vmsId,
      senderEmail: "billing@vailmountainschool.org",
      senderDomain: "vailmountainschool.org",
      senderDisplayName: "VMS Billing",
      subject: "Spring Activity Fee Invoice - $125",
      date: new Date("2026-03-03T08:00:00Z"),
      summary: "Spring activity fee of $125 due by March 20. Pay online or send check.",
      tags: ["Payment"],
      extractedData: { amount: 125 },
      isReply: false,
      isExcluded: false,
    },

    // --- Noise email (should be excluded) ---
    {
      gmailMessageId: "msg_noise_1",
      threadId: "thread_noise",
      schemaId,
      entityId: null,
      senderEmail: "noreply@schoolnewsletter.com",
      senderDomain: "schoolnewsletter.com",
      senderDisplayName: "School Newsletter",
      subject: "Weekly Digest: Top Education Stories",
      date: new Date("2026-03-07T12:00:00Z"),
      summary: "Newsletter content about education trends.",
      tags: [],
      extractedData: {},
      isReply: false,
      isExcluded: true,
    },
  ];

  const created = await prisma.email.createMany({ data: emails });
  return { count: created.count, emails };
}
```

---

## Flow Tests

These are the tests the AI can run to verify basic functionality.
Each test exercises a complete flow, not a single function.

### Interview Flow Test

```typescript
// tests/integration/flows/interview.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, cleanupTestUser } from "../helpers/test-user";
import { createApiClient } from "../helpers/api-client";

describe("Interview Flow", () => {
  let userId: string;
  let api: ReturnType<typeof createApiClient>;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.userId;
    api = createApiClient(user.accessToken);
  });

  afterAll(async () => {
    await cleanupTestUser(userId);
  });

  it("rejects unauthenticated requests", async () => {
    const unauthApi = createApiClient("invalid-token");
    const res = await unauthApi.post("/api/interview/hypothesis", {
      role: "parent",
      domain: "school_parent",
      whats: ["Test School"],
      whos: [],
      goals: ["actions"],
    });
    expect(res.status).toBe(401);
  });

  it("validates input with Zod", async () => {
    const res = await api.post("/api/interview/hypothesis", {
      role: "parent",
      // missing required fields: domain, whats
    });
    expect(res.status).toBe(400);
    expect(res.data.code).toBe("VALIDATION_ERROR");
  });

  it("generates hypothesis and returns valid SchemaHypothesis", async () => {
    const res = await api.post("/api/interview/hypothesis", {
      role: "parent",
      domain: "school_parent",
      whats: ["Test Elementary School"],
      whos: ["Coach Smith"],
      goals: ["actions", "schedule"],
    });

    expect(res.status).toBe(200);
    expect(res.data.data).toBeDefined();

    const hypothesis = res.data.data;

    // Structure checks
    expect(hypothesis.domain).toBe("school_parent");
    expect(hypothesis.schemaName).toBeTruthy();
    expect(hypothesis.primaryEntity.name).toBeTruthy();
    expect(hypothesis.tags.length).toBeGreaterThanOrEqual(5);
    expect(hypothesis.entities.length).toBeGreaterThanOrEqual(1);
    expect(hypothesis.clusteringConfig.mergeThreshold).toBeLessThan(40);
    expect(hypothesis.discoveryQueries.length).toBeGreaterThanOrEqual(1);

    // Verify entity from user input exists
    const school = hypothesis.entities.find(
      (e: any) => e.name === "Test Elementary School"
    );
    expect(school).toBeDefined();
    expect(school.type).toBe("PRIMARY");
    expect(school.aliases.length).toBeGreaterThan(0);

    // Verify goals affect showOnCard
    const showOnCardFields = hypothesis.extractedFields.filter(
      (f: any) => f.showOnCard
    );
    expect(showOnCardFields.length).toBeGreaterThan(0);
  }, 60000); // 60s timeout for AI call
});
```

### Full Pipeline Flow Test

```typescript
// tests/integration/flows/full-pipeline.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, cleanupTestUser } from "../helpers/test-user";
import { createTestSchema } from "../helpers/test-schema";
import { seedTestEmails } from "../helpers/test-emails";
import { prisma } from "@/lib/prisma";

// Import the actual services (not mocked)
import { ClusterService } from "@/lib/services/cluster";
import { SynthesisService } from "@/lib/services/synthesis";

describe("Full Pipeline: Emails -> Cases", () => {
  let userId: string;
  let schemaId: string;
  let entityIds: { vmsId: string; evscId: string };

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.userId;

    const testData = await createTestSchema(userId);
    schemaId = testData.schema.id;
    entityIds = {
      vmsId: testData.entities.vms.id,
      evscId: testData.entities.evsc.id,
    };

    await seedTestEmails(schemaId, entityIds);
  });

  afterAll(async () => {
    await cleanupTestUser(userId);
  });

  it("clusters emails into correct number of cases", async () => {
    // Run clustering on the seeded emails
    const unassignedEmails = await prisma.email.findMany({
      where: { schemaId, isExcluded: false },
    });

    const result = await ClusterService.clusterNewEmails(
      schemaId,
      unassignedEmails.map((e) => e.id)
    );

    // We seeded 3 topics: VMS permission, EVSC schedule, VMS payment
    // Expect 3 cases (noise email was excluded)
    const cases = await prisma.case.findMany({ where: { schemaId } });
    expect(cases.length).toBe(3);

    // VMS permission thread (3 emails) should be one case
    const permissionCase = cases.find((c) =>
      c.title?.toLowerCase().includes("permission") ||
      c.title?.toLowerCase().includes("field trip") ||
      c.title?.toLowerCase().includes("zoo")
    );
    expect(permissionCase).toBeDefined();

    // Check emails are assigned correctly
    const permCaseEmails = await prisma.caseEmail.findMany({
      where: { caseId: permissionCase!.id },
    });
    expect(permCaseEmails.length).toBe(3);  // All 3 permission thread emails
  });

  it("synthesizes case with correct summary labels", async () => {
    const cases = await prisma.case.findMany({ where: { schemaId } });

    for (const caseRow of cases) {
      // Run synthesis
      await SynthesisService.synthesizeCase(caseRow.id);
    }

    // Reload cases with synthesis results
    const synthesized = await prisma.case.findMany({ where: { schemaId } });

    for (const caseRow of synthesized) {
      // Every case should have a title
      expect(caseRow.title).toBeTruthy();
      expect(caseRow.title!.length).toBeLessThan(80);

      // Summary should have all three sections
      const summary = caseRow.summary as any;
      expect(summary.beginning).toBeTruthy();
      expect(summary.middle).toBeTruthy();
      expect(summary.end).toBeTruthy();

      // Display tags should exist
      const displayTags = caseRow.displayTags as string[];
      expect(displayTags.length).toBeGreaterThanOrEqual(1);
      expect(displayTags.length).toBeLessThanOrEqual(3);

      // Denormalized fields should be set
      expect(caseRow.lastSenderName).toBeTruthy();
      expect(caseRow.lastEmailDate).toBeDefined();
    }
  }, 120000); // 2 min timeout for multiple AI calls

  it("extracts action items from permission slip emails", async () => {
    const cases = await prisma.case.findMany({ where: { schemaId } });
    const permissionCase = cases.find((c) =>
      c.title?.toLowerCase().includes("permission") ||
      c.title?.toLowerCase().includes("field trip") ||
      c.title?.toLowerCase().includes("zoo")
    );

    if (!permissionCase) {
      throw new Error("Permission case not found. Check clustering.");
    }

    const actions = await prisma.caseAction.findMany({
      where: { caseId: permissionCase.id },
    });

    // Should have at least 1 action (sign permission slip)
    expect(actions.length).toBeGreaterThanOrEqual(1);

    // The reminder email should NOT create a duplicate action
    // (reminder collapse: 2 emails about same permission slip = 1 action)
    const permissionActions = actions.filter(
      (a) =>
        a.title.toLowerCase().includes("permission") ||
        a.title.toLowerCase().includes("sign")
    );
    expect(permissionActions.length).toBe(1);

    // That action should have reminderCount > 0
    expect(permissionActions[0].reminderCount).toBeGreaterThan(0);
  });

  it("excluded email is not in any case", async () => {
    const excludedEmail = await prisma.email.findFirst({
      where: { schemaId, isExcluded: true },
    });
    expect(excludedEmail).toBeDefined();

    const assignment = await prisma.caseEmail.findFirst({
      where: { emailId: excludedEmail!.id },
    });
    expect(assignment).toBeNull();
  });

  it("cases are scoped to the correct primary entity", async () => {
    const cases = await prisma.case.findMany({
      where: { schemaId },
      include: { entity: true },
    });

    for (const caseRow of cases) {
      // Every case has an entity
      expect(caseRow.entity).toBeDefined();

      // Entity is one of our known primary entities
      expect([entityIds.vmsId, entityIds.evscId]).toContain(caseRow.entityId);
    }

    // VMS should have 2 cases (permission + payment), EVSC should have 1 (schedule)
    const vmsCases = cases.filter((c) => c.entityId === entityIds.vmsId);
    const evscCases = cases.filter((c) => c.entityId === entityIds.evscId);
    expect(vmsCases.length).toBe(2);
    expect(evscCases.length).toBe(1);
  });
});
```

### API Route Flow Test (Feedback)

```typescript
// tests/integration/flows/feedback.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, cleanupTestUser } from "../helpers/test-user";
import { createTestSchema } from "../helpers/test-schema";
import { seedTestEmails } from "../helpers/test-emails";
import { createApiClient } from "../helpers/api-client";
import { prisma } from "@/lib/prisma";

describe("Feedback Flow", () => {
  let userId: string;
  let api: ReturnType<typeof createApiClient>;
  let schemaId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.userId;
    api = createApiClient(user.accessToken);

    const testData = await createTestSchema(userId);
    schemaId = testData.schema.id;
    // ... seed emails and run clustering/synthesis to create cases
  });

  afterAll(async () => {
    await cleanupTestUser(userId);
  });

  it("thumbs down creates FeedbackEvent and returns success", async () => {
    const cases = await prisma.case.findMany({ where: { schemaId } });
    const targetCase = cases[0];

    const res = await api.post("/api/feedback", {
      schemaId,
      type: "THUMBS_DOWN",
      caseId: targetCase.id,
      payload: { reason: "Wrong emails grouped" },
    });

    expect(res.status).toBe(200);

    // Verify event was created
    const events = await prisma.feedbackEvent.findMany({
      where: { schemaId, type: "THUMBS_DOWN" },
    });
    expect(events.length).toBe(1);
    expect(events[0].caseId).toBe(targetCase.id);
  });

  it("RLS prevents accessing another user's data", async () => {
    // Create a second user
    const otherUser = await createTestUser();  // Needs unique email
    const otherApi = createApiClient(otherUser.accessToken);

    // Try to access first user's schema
    const res = await otherApi.get(`/api/quality/${schemaId}`);
    // Should get 404 (not 403, to avoid leaking schema existence)
    expect(res.status).toBe(404);

    await cleanupTestUser(otherUser.userId);
  });
});
```

---

## What These Tests Catch That Unit Tests Miss

| Failure | Unit Test | Integration Test |
|---|---|---|
| Auth middleware rejects bad tokens | not tested | CAUGHT |
| Zod rejects malformed input at API boundary | tested in isolation | CAUGHT in real request |
| Service writes to wrong table | not tested | CAUGHT (assertion on DB state) |
| Clustering puts emails in wrong case | tested with fixtures | CAUGHT with realistic data |
| Synthesis fails but case still has emails | not tested | CAUGHT (assertions on partial state) |
| Reminder dedup creates duplicate actions | tested with perfect fixtures | CAUGHT with realistic thread |
| RLS lets user A see user B's data | not tested | CAUGHT |
| Excluded email leaks into a case | not tested | CAUGHT |
| Denormalized fields not set in same transaction | not tested | CAUGHT (null check) |
| Inngest event payload doesn't match what next stage expects | not tested | CAUGHT (pipeline flows end-to-end) |

---

## How to Add This to the Build Plan

Add as Phase 1.5 (after hypothesis testing, before Gmail):

**Phase 1.5: Integration Test Infrastructure**

1. Create test helpers: test-user.ts, test-schema.ts, test-emails.ts, api-client.ts, cleanup.ts
2. Create interview flow test (authenticated requests, Zod validation, hypothesis generation)
3. Configure vitest for integration tests (separate config, longer timeouts, test DB)
4. Add TEST_DATABASE_URL to GitHub Actions secrets
5. Add integration tests to CI (on merge to main)

Then each subsequent phase adds its own flow test using the shared helpers:
- Phase 3 adds extraction.test.ts
- Phase 4 adds clustering.test.ts
- Phase 5 adds synthesis.test.ts and full-pipeline.test.ts
- Phase 7 adds feedback.test.ts

---

## What You Test vs. What the AI Tests

**AI tests (integration tests, automated):**
- Does auth work?
- Does data flow from A to B to C?
- Are the right rows in the database after each step?
- Do emails end up in the right cases?
- Do actions dedup correctly?
- Does RLS block cross-user access?

**You test (manual, qualitative):**
- Are the case titles actually good?
- Does the summary tell a coherent story?
- Are the tags useful or generic?
- Would you trust this to organize your real email?
- Is the side panel scannable in 2 seconds?
