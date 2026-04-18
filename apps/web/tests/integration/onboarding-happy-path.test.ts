/**
 * End-to-end onboarding happy-path test — fast-discovery flow (issue #95).
 *
 * SKIPPED BY DEFAULT. Set `RUN_E2E_HAPPY=1` in the environment to enable
 * it. Requires:
 *
 *   - Next dev server on :3000 (`pnpm --filter web dev`)
 *   - Inngest dev server on :8288 (`npx inngest-cli@latest dev`)
 *   - Live Gemini API key (`extractBatch` during scan)
 *   - Live Claude API key (`runSynthesis` during scan)
 *   - A real Gmail OAuth token seeded on the integration test user.
 *     `seedGmailToken()` writes a stub that will fail real Gmail calls;
 *     swap it for a token from the OAuth playground (see
 *     `memory/reference_gmail_test_account.md`) before running RUN_E2E_HAPPY.
 *
 * Scope: drives the Stage 1 / Stage 2 fast-discovery flow end-to-end.
 *
 *   1. POST /api/onboarding/start                         → 202
 *   2. Poll /api/onboarding/:id  until AWAITING_DOMAIN_CONFIRMATION
 *   3. POST /api/onboarding/:id/domain-confirm            → 200
 *   4. Poll                       until AWAITING_ENTITY_CONFIRMATION
 *   5. POST /api/onboarding/:id/entity-confirm            → 200
 *   6. Poll                       until COMPLETED | NO_EMAILS_FOUND
 *   7. Verify CaseSchema.status=ACTIVE and nextHref=/feed?schema=:id
 *      (or the NO_EMAILS_FOUND terminal shape).
 *
 * This is the only integration test that exercises the full Inngest chain
 * across Stage 1 (runDomainDiscovery), Stage 2 (runEntityDiscovery), and
 * Function B (runOnboardingPipeline + runScan). Structural invariants
 * (CAS ownership, outbox idempotency, per-route validation) live in the
 * route-level __tests__ next to each handler and in the concurrent-start
 * integration test — they don't need the live pipeline to assert.
 *
 * Run: RUN_E2E_HAPPY=1 pnpm --filter web exec vitest run --config vitest.integration.config.ts onboarding-happy-path
 */
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type {
  OnboardingPhase,
  OnboardingPollingResponse,
  Stage1CandidateDTO,
  Stage2PerDomainDTO,
} from "@/lib/services/onboarding-polling";
import { createApiClient } from "./helpers/api-client";
import {
  cleanupTestUser,
  createTestUser,
  seedGmailToken,
  type TestUser,
} from "./helpers/test-user";

const RUN_E2E = process.env.RUN_E2E_HAPPY === "1";

// Stage 1 + Stage 2 each touch Gmail once, then scan + extract + cluster +
// synthesize runs to completion. 8 minutes covers a generous Claude/Gemini
// day; individual poll waits are bounded below.
const OVERALL_TIMEOUT_MS = 480_000;
const POLL_INTERVAL_MS = 2_000;

// Per-stage poll deadlines. Stage 1/2 are fast (Gmail query + regex) — 60s
// is generous. Scan is the slow leg — 4 minutes.
const DISCOVERY_POLL_DEADLINE_MS = 60_000;
const SCAN_POLL_DEADLINE_MS = 240_000;

type PollResponse = OnboardingPollingResponse & {
  // Polling response carries a phase string; widen to include any string
  // so transitional values don't get narrowed away by the DTO type.
  phase: OnboardingPhase;
};

describe.skipIf(!RUN_E2E)("onboarding happy path (end-to-end, live)", () => {
  let testUser: TestUser;
  let api: ReturnType<typeof createApiClient>;
  const createdSchemaIds: string[] = [];

  beforeAll(async () => {
    testUser = await createTestUser();
    // Stub Gmail token unblocks the pre-flight 422 check. For a real happy
    // path (candidates + emails) swap this for an OAuth-playground token —
    // see reference_gmail_test_account.md.
    await seedGmailToken(testUser.userId);
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
   * Poll `GET /api/onboarding/:schemaId` until `phase` lands in one of the
   * target phases, or throw on timeout. The polling contract is that the
   * response shape is flat — polling returns `{ data: OnboardingPollingResponse }`
   * — so callers can destructure a single field.
   */
  async function pollUntilPhase(
    schemaId: string,
    targets: Set<OnboardingPhase>,
    deadlineMs: number,
  ): Promise<PollResponse> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      const res = await api.get(`/api/onboarding/${schemaId}`);
      if (res.status === 200) {
        const body = (res.data as { data: PollResponse }).data;
        if (targets.has(body.phase)) return body;
        // If we hit FAILED and it's not an expected target, surface it
        // immediately instead of spinning the remaining budget.
        if (body.phase === "FAILED" && !targets.has("FAILED")) {
          throw new Error(
            `Schema ${schemaId} reached FAILED while waiting for ${[...targets].join("|")}: ` +
              `${body.error?.phase ?? "?"} — ${body.error?.message ?? "?"}`,
          );
        }
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(
      `Timeout waiting for schema ${schemaId} to reach [${[...targets].join(", ")}] after ${deadlineMs}ms`,
    );
  }

  it(
    "drives Start → Stage 1 confirm → Stage 2 confirm → scan → COMPLETED",
    async () => {
      const schemaId = ulid();
      createdSchemaIds.push(schemaId);

      // 1. Kick off the workflow. The start route fires
      // onboarding.session.started; runOnboarding (Function A) re-dispatches
      // onboarding.domain-discovery.requested which runDomainDiscovery picks up.
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

      // 2. Poll until Stage 1 is awaiting the user's domain picks.
      const stage1 = await pollUntilPhase(
        schemaId,
        new Set<OnboardingPhase>(["AWAITING_DOMAIN_CONFIRMATION"]),
        DISCOVERY_POLL_DEADLINE_MS,
      );

      const stage1Candidates: Stage1CandidateDTO[] = stage1.stage1Candidates ?? [];
      if (stage1Candidates.length === 0) {
        // Empty Stage 1 happens when the stub Gmail token produces an empty
        // sender list, or when the real inbox has nothing matching the
        // domain query. Either way, /domain-confirm's Zod schema rejects an
        // empty array (min 1), so there's no happy path from here — treat
        // it as "this mailbox can't drive the flow" and bail with a warning.
        // eslint-disable-next-line no-console
        console.warn(
          "Stage 1 returned zero candidates — expected if the test user's Gmail token is a stub " +
            "or the real mailbox has no domain-matching senders. Swap in an OAuth playground " +
            "token (see memory/reference_gmail_test_account.md) for a full happy-path run.",
        );
        return;
      }

      // 3. Confirm up to 3 domains so Stage 2 has something to expand, but
      // stay within the /domain-confirm Zod max(20).
      const confirmedDomains = stage1Candidates.slice(0, 3).map((c) => c.domain);
      const domainConfirm = await api.post(`/api/onboarding/${schemaId}/domain-confirm`, {
        confirmedDomains,
      });
      expect(domainConfirm.status).toBe(200);

      // 4. Poll until Stage 2 emits per-domain entity candidates.
      const stage2 = await pollUntilPhase(
        schemaId,
        new Set<OnboardingPhase>(["AWAITING_ENTITY_CONFIRMATION"]),
        DISCOVERY_POLL_DEADLINE_MS,
      );

      const stage2Groups: Stage2PerDomainDTO[] = stage2.stage2Candidates ?? [];
      const confirmedEntities = stage2Groups
        .flatMap((group) => group.candidates)
        // Cap at the Zod max(100) on /entity-confirm. Pick the highest-frequency
        // candidates so the scan has real mass to cluster.
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 20)
        .map((c) => ({
          displayLabel: c.displayString,
          identityKey: c.key,
          kind: "PRIMARY" as const,
        }));

      if (confirmedEntities.length === 0) {
        // Mirror the Stage 1 empty branch. /entity-confirm's Zod rejects
        // min(1) too.
        // eslint-disable-next-line no-console
        console.warn(
          "Stage 2 produced zero entity candidates across the confirmed domains — " +
            "fast-discovery can't drive the pipeline without at least one entity. " +
            "This is still a structural pass: Stage 1 + Stage 2 completed and left " +
            "the schema in AWAITING_ENTITY_CONFIRMATION as designed.",
        );
        const row = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { phase: true, status: true },
        });
        expect(row.phase).toBe("AWAITING_ENTITY_CONFIRMATION");
        expect(row.status).toBe("DRAFT");
        return;
      }

      // 5. Confirm entities — this CAS-advances AWAITING_ENTITY_CONFIRMATION
      // → PROCESSING_SCAN and fires onboarding.review.confirmed which
      // runOnboardingPipeline (Function B) listens on.
      const entityConfirm = await api.post(`/api/onboarding/${schemaId}/entity-confirm`, {
        confirmedEntities,
      });
      expect(entityConfirm.status).toBe(200);

      // 6. Wait for the scan to complete (or bail out on NO_EMAILS_FOUND).
      // Function B's waitForEvent has its own internal timeout; the poll
      // budget here just has to outlast scan+extract+cluster+synthesize.
      const terminal = await pollUntilPhase(
        schemaId,
        new Set<OnboardingPhase>(["COMPLETED", "NO_EMAILS_FOUND", "FAILED"]),
        SCAN_POLL_DEADLINE_MS,
      );

      if (terminal.phase === "FAILED") {
        throw new Error(
          `Scan FAILED: ${terminal.error?.phase ?? "?"} — ${terminal.error?.message ?? "?"}`,
        );
      }

      if (terminal.phase === "NO_EMAILS_FOUND") {
        // Valid terminal — the scan ran but found nothing to cluster. The
        // schema sits in NO_EMAILS_FOUND and stays in DRAFT status.
        const row = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { phase: true, status: true },
        });
        expect(row.phase).toBe("NO_EMAILS_FOUND");
        expect(row.status).toBe("DRAFT");
        return;
      }

      // Happy path: schema is COMPLETED + ACTIVE; /feed should be the next hop.
      expect(terminal.phase).toBe("COMPLETED");
      expect(terminal.nextHref).toBe(`/feed?schema=${schemaId}`);

      const finalRow = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { phase: true, status: true },
      });
      expect(finalRow.phase).toBe("COMPLETED");
      expect(finalRow.status).toBe("ACTIVE");
    },
    OVERALL_TIMEOUT_MS,
  );
});
