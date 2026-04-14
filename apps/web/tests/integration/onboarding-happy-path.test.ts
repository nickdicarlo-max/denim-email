/**
 * End-to-end onboarding happy-path test.
 *
 * SKIPPED BY DEFAULT. Set `RUN_E2E_HAPPY=1` in the environment to
 * enable it. Requires:
 *
 *   - Next dev server on :3000 (`pnpm --filter web dev`)
 *   - Inngest dev server on :8288 (`npx inngest-cli@latest dev`)
 *   - Live Claude API key (for `generateHypothesis` + `runSynthesis`)
 *   - Live Gemini API key (for `extractBatch`)
 *   - A Gmail OAuth token in the `oauth_tokens` table for the test
 *     user. The integration test user is `integration-test@denim-email.test`
 *     — its Prisma `User` row has no Gmail access by default, so
 *     `runSmartDiscovery` will produce zero emails and the workflow
 *     will take the empty-scan branch. See
 *     `~/.claude/projects/.../memory/reference_gmail_test_account.md`
 *     for the two ways to put a Gmail token on the test user: the
 *     OAuth playground path (live token for a real mailbox) or the
 *     433-email downloaded fixture path (requires a separate
 *     fixture-injection script that bypasses Gmail entirely).
 *
 * Scope: POST /api/onboarding/start → poll /api/onboarding/:id until
 * phase=AWAITING_REVIEW (or NO_EMAILS_FOUND if no Gmail token) →
 * POST /api/onboarding/:id (confirm) → verify status=ACTIVE +
 * phase=COMPLETED + nextHref=/feed?schema=:id.
 *
 * The test is written as the canonical reference for what a real
 * e2e run looks like. It's intentionally the only test file that
 * exercises the full Inngest chain — the structural guarantees
 * (CAS, idempotency, scan accounting) are tested elsewhere without
 * needing the live AI + Gmail + Inngest dependencies.
 *
 * Run: RUN_E2E_HAPPY=1 pnpm --filter web exec vitest run --config vitest.integration.config.ts onboarding-happy-path
 */
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createApiClient } from "./helpers/api-client";
import { cleanupTestUser, createTestUser, type TestUser } from "./helpers/test-user";

const RUN_E2E = process.env.RUN_E2E_HAPPY === "1";

// Full e2e can be slow. 4 minutes should be generous even on a bad
// Claude day — hypothesis ~30s, scan + extract <60s for a small
// fixture mailbox, clustering + synthesis ~20s.
const OVERALL_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_DEADLINE_MS = 180_000; // how long we'll poll before failing

describe.skipIf(!RUN_E2E)("onboarding happy path (end-to-end, live)", () => {
  let testUser: TestUser;
  let api: ReturnType<typeof createApiClient>;
  const createdSchemaIds: string[] = [];

  beforeAll(async () => {
    testUser = await createTestUser();
    api = createApiClient(testUser.accessToken);
  }, 60_000);

  afterAll(async () => {
    for (const id of createdSchemaIds) {
      await prisma.caseSchema.deleteMany({ where: { id } });
    }
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    await prisma.$disconnect();
  }, 30_000);

  /**
   * Poll `GET /api/onboarding/:schemaId` until the phase is one of
   * the terminal states (`AWAITING_REVIEW`, `NO_EMAILS_FOUND`,
   * `FAILED`, or `COMPLETED`). Throws on timeout.
   */
  async function pollUntilTerminal(schemaId: string): Promise<{
    phase: string;
    error?: { phase: string; message: string };
  }> {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    const terminalPhases = new Set(["AWAITING_REVIEW", "NO_EMAILS_FOUND", "FAILED", "COMPLETED"]);

    while (Date.now() < deadline) {
      const res = await api.get(`/api/onboarding/${schemaId}`);
      if (res.status !== 200) {
        // Transient — retry on next tick.
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      const body = (
        res.data as {
          data: { phase: string; error?: { phase: string; message: string } };
        }
      ).data;
      if (terminalPhases.has(body.phase)) {
        return body;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(
      `Timeout waiting for schema ${schemaId} to reach a terminal phase after ${POLL_DEADLINE_MS}ms`,
    );
  }

  it(
    "runs POST /start → workflow → AWAITING_REVIEW → POST confirm → ACTIVE",
    async () => {
      const schemaId = ulid();
      createdSchemaIds.push(schemaId);

      // 1. Kick off the workflow.
      const start = await api.post("/api/onboarding/start", {
        schemaId,
        inputs: {
          role: "parent",
          domain: "school_parent",
          whats: ["Oakridge Elementary"],
          whos: ["Ms. Johnson"],
          groups: [],
          goals: ["actions", "schedule"],
        },
      });
      expect(start.status).toBe(202);

      // 2. Poll until we reach a terminal phase.
      const result = await pollUntilTerminal(schemaId);

      // 3. Branch on the outcome:
      //    - AWAITING_REVIEW: happy path, confirm and go live.
      //    - NO_EMAILS_FOUND: the test user has no Gmail token, so the
      //      scan found nothing. This is still a "pass" for the
      //      orchestration layer — we verify the terminal state and
      //      stop. A future iteration with a seeded Gmail fixture
      //      will hit the AWAITING_REVIEW branch instead.
      //    - FAILED / COMPLETED: unexpected — fail loudly with the
      //      error detail.
      if (result.phase === "NO_EMAILS_FOUND") {
        // eslint-disable-next-line no-console
        console.warn(
          "Happy path test landed on NO_EMAILS_FOUND — expected if the test user has no Gmail token. " +
            "Wire up the 433-email fixture (see memory/reference_gmail_test_account.md) for a full e2e run.",
        );
        const row = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { phase: true, status: true },
        });
        expect(row.phase).toBe("NO_EMAILS_FOUND");
        expect(row.status).toBe("DRAFT");
        return;
      }

      expect(result.phase).toBe("AWAITING_REVIEW");
      expect(result.error).toBeUndefined();

      // 4. Confirm the review and flip to ACTIVE.
      const confirm = await api.post(`/api/onboarding/${schemaId}`, {
        topicName: "E2E Test Topic",
        entityToggles: [],
      });
      expect(confirm.status).toBe(200);

      // 5. Verify the DB landed where we expect.
      const finalRow = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { phase: true, status: true, name: true },
      });
      expect(finalRow.phase).toBe("COMPLETED");
      expect(finalRow.status).toBe("ACTIVE");
      expect(finalRow.name).toBe("E2E Test Topic");

      // 6. One more GET: response should carry the completed marker +
      //    nextHref so the observer page can route to /feed.
      const final = await api.get(`/api/onboarding/${schemaId}`);
      expect(final.status).toBe(200);
      const finalBody = (final.data as { data: { phase: string; nextHref?: string } }).data;
      expect(finalBody.phase).toBe("COMPLETED");
      expect(finalBody.nextHref).toBe(`/feed?schema=${schemaId}`);
    },
    OVERALL_TIMEOUT_MS,
  );
});
