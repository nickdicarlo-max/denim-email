# Onboarding State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the onboarding flow as a durable, resumable, observable server-side state machine with `CaseSchema` as the workflow handle, a first-class `ScanJob` abstraction reusable for cron/manual/feedback scans, and a single flat polling contract between server and client.

**Architecture:** Two state machines — `CaseSchema.phase` owns onboarding-only phases (PENDING → GENERATING_HYPOTHESIS → FINALIZING_SCHEMA → PROCESSING_SCAN → AWAITING_REVIEW → COMPLETED), `ScanJob.phase` owns scan-only phases (PENDING → DISCOVERING → EXTRACTING → CLUSTERING → SYNTHESIZING → COMPLETED). One writer per column, CAS-on-phase for every transition, no denormalized counters (everything computed on demand from Email/Case/ScanFailure rows). The HTTP polling endpoint (`GET /api/onboarding/:schemaId`) merges the two state machines into a single flat response so the client has one phase enum and one progress object to render against. Two parent Inngest workflows (`runOnboarding`, `runScan`) orchestrate existing pipeline functions via events; the pipeline functions are refactored to add CAS but keep their current per-stage retry/concurrency independence (Option B from design discussion).

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres, Inngest 4.x, Vitest, TypeScript strict, React 19.

**Design discussion source:** Architecture conversation on 2026-04-07 (this session). Key decisions:
- Extend `CaseSchema` with workflow columns; no separate `OnboardingSession` table
- Compute all counters on demand, drop denormalized fields
- `ScanJob` is first-class and reusable across triggers (enum `ScanTrigger`)
- Add `ScanFailure` table (per-email failures replace `failedEmails` counter)
- CAS-on-phase on every pipeline stage transition
- Failure recovery = option A (resume from failed phase via re-emit)
- Hard switch on routes (no soft cutover); no data preservation needed
- Polling merge happens server-side — flat response only

**Eval context:** Eval Session 1 (#12) failed end-to-end due to response-shape mismatch (#17), silent email drops (#16), TOCTOU idempotency races (#14), hung loading screens (#15), and review schema context (#18). This plan replaces the band-aid fixes from the earlier audit with the structural redesign. Eval rerun happens after this plan lands.

---

## Execution Progress (as of 2026-04-08)

**Branch:** `feature/ux-overhaul` · **Position:** 17 of 18 tasks landed, **Phases 0–10 complete** (server state machine + HTTP routes + client flow collapse + dead code deleted + e2e test suite) · **Next:** Task 17 — Phase 11 cron stub + Task 18 final verification

**Auto-memory mirror:** `~/.claude/projects/C--Users-alkam-Documents-NDSoftware-denim-email/memory/project_onboarding_state_machine_progress.md` carries a richer version of this header (architecture diagrams, file inventory, test matrix, remaining-task summaries). When the two disagree, trust this in-repo header — it updates in the same commit as the task. Use the memory file for context, not as the source of truth.

### File inventory (state machine + pipeline)

**New service files:**
- `apps/web/src/lib/services/scan-metrics.ts` — `computeScanMetrics` / `computeSchemaMetrics` (compute-on-demand counters)
- `apps/web/src/lib/services/onboarding-state.ts` — `advanceSchemaPhase` / `advanceScanPhase` / `markSchemaFailed` / `markScanFailed` + phase ordering
- `apps/web/src/lib/services/onboarding-polling.ts` — `derivePollingResponse` flat merge for the client

**New Inngest workflows:**
- `apps/web/src/lib/inngest/scan.ts` — `runScan` parent (consumes `scan.requested`, owns `PENDING → DISCOVERING → EXTRACTING`)
- `apps/web/src/lib/inngest/onboarding.ts` — `runOnboarding` parent (consumes `onboarding.session.started`, owns all `CaseSchema.phase` transitions)

**New HTTP routes (Phase 7 complete):**
- `apps/web/src/app/api/onboarding/start/route.ts` — `POST` (Task 10; idempotent session claim on client-supplied ULID)
- `apps/web/src/app/api/onboarding/[schemaId]/route.ts` — `GET` polling / `POST` review confirm / `DELETE` cancel (Task 11)
- `apps/web/src/app/api/onboarding/[schemaId]/retry/route.ts` — `POST` resume from the parsed failed phase (Task 12)
- `apps/web/src/app/api/schemas/[schemaId]/scans/route.ts` — `GET` list 50 most recent scans / `POST` manual rescan with 409 conflict guard (Task 13)
- `apps/web/src/app/api/schemas/[schemaId]/scans/[scanJobId]/route.ts` — `GET` per-scan detail with failures + metrics (Task 13)

**New client surface (Phase 8 complete):**
- `apps/web/src/components/onboarding/flow.tsx` — switch component mapping `OnboardingPollingResponse.phase` to one of ten per-phase subcomponents
- `apps/web/src/components/onboarding/phase-{pending,generating,finalizing,discovering,extracting,clustering,synthesizing,no-emails,failed}.tsx` — nine progress/terminal screens
- `apps/web/src/components/onboarding/phase-review.tsx` — lifted from the old review page; POSTs to Task 11's `/api/onboarding/:schemaId` confirm handler
- `apps/web/src/app/onboarding/[schemaId]/page.tsx` — 2s polling observer page that drives the flow and navigates on `phase=COMPLETED`
- `apps/web/src/app/onboarding/connect/page.tsx` — modified to POST to `/api/onboarding/start` with a client-generated ULID and route to the observer page (was: POST to `/api/interview/hypothesis` → route to `/onboarding/scanning`)

**Modified files worth tracking:** `apps/web/prisma/schema.prisma`, `apps/web/src/lib/services/interview.ts` (split), `apps/web/src/lib/services/extraction.ts` (ScanFailure writes + `firstScanJobId`), `apps/web/src/lib/services/cluster.ts` (counter writes removed), `apps/web/src/lib/inngest/functions.ts` (CAS wiring + exports), `apps/web/src/app/(authenticated)/settings/topics/page.tsx`, `apps/web/scripts/eval-diagnose.ts`, `packages/types/src/events.ts`. The `api/schemas/[schemaId]/status/route.ts` that was earlier in this list was deleted in Task 15.

### Task status

| Phase | Task | Status | Commit | Notes |
|-------|------|--------|--------|-------|
| 0 | 1. Schema migration + enums + ScanFailure | ✅ done | `952d0bf` / `b92ff2e` | |
| 1 | 2. `computeScanMetrics` / `computeSchemaMetrics` helpers | ✅ done | `8354c6e` | 8 integration tests. `Case`→`Email` is via `CaseEmail` junction (plan snippet was wrong). |
| 1 | 3. Replace all dropped-counter reads | ✅ done | `d42de28` | Also fixed `ScanTrigger` enum casing in 3 route handlers. `status/route.ts` returns `casesMerged: 0`, `clustersCreated: 0` for client compat. `eval-diagnose.ts` has metric helpers inlined. |
| 2 | 4. `advanceSchemaPhase` / `advanceScanPhase` CAS helpers | ✅ done | `a51cbd1` | 18 integration tests. `advanceScanPhase` uses `scan.phase` (read value) in the `where` clause so legacy IDLE rows satisfy a `from: PENDING` request. |
| 3 | 5. `derivePollingResponse` merge function | ✅ done | `daaf034` | 20 integration tests (not mocked — `CaseSchema` has too many required fields). Added `phase === COMPLETED` branch the plan missed. ACTIVE takes precedence over stale FAILED. |
| 4 | 6. Extract `persistSchemaRelations` from `finalizeSchema` | ✅ done | `529262d` | Split into `createSchemaStub` + `persistSchemaRelations` + delegating `finalizeSchema` wrapper. Stub and relation writes are in separate transactions now — orphan DRAFT/PENDING stub possible on failure (intentional). |
| 5 | 7. CAS in pipeline + ScanFailure writes + firstScanJobId | ✅ done | `5f6a4a0` | Every pipeline phase write via `advanceScanPhase`. ScanFailure rows per-email (upsert) + per-batch (createMany + skipDuplicates). Email create paths carry `firstScanJobId`/`lastScanJobId`. `ExtractEmailResult`/`ProcessBatchResult` drop `failed`. `runSynthesis` emits `scan.completed` for Task 9. |
| 6 | 8. `runScan` parent orchestrator | ✅ done | `6803130` | Consumes `scan.requested`, empty-scan short-circuit (`DISCOVERING → COMPLETED` multi-phase jump), hands off via `scan.emails.discovered`. `retries=0`. Added `scan.requested` / `scan.completed` to `DenimEvents`. |
| 7 | 9. `runOnboarding` parent orchestrator | ✅ done | `b8dc3b0` | Drives `CaseSchema.phase` through the full state machine, waits for `scan.completed` with 20m timeout + match on scanJobId, quality gate for unsynthesized cases. `persistSchemaRelations` `validation`/`confirmations` made optional. **Removed TRANSITIONAL `activate-schema` step from `runSynthesis`.** Added `onboarding.session.started` to `DenimEvents`. |
| 7 | 10. POST /api/onboarding/start | ✅ done | `a36480c` | Idempotent on client-supplied ULID, 202 on fresh + existing, 403 on different user. Reuses `InterviewInputSchema`. `createSchemaStub` now accepts optional client-supplied `schemaId`. |
| 7 | 11. GET /api/onboarding/[schemaId] + POST (confirm) + DELETE (cancel) | ✅ done | `926e8af` | Polling via `derivePollingResponse`, POST CAS-flips `AWAITING_REVIEW → COMPLETED` + `status=ACTIVE` (resolves status-flip deferred debt), DELETE emits `onboarding.session.cancelled` + archives. Added `ARCHIVED` to `SchemaStatus` enum (live ALTER TYPE against DB), added `cancelOn` to `runOnboarding`, added `onboarding.session.cancelled` to `DenimEvents`. 20/20 onboarding-polling tests still green. |
| 7 | 12. POST /api/onboarding/[schemaId]/retry | ✅ done | `1d37294` | **Deviation from plan snippet:** parses the failed phase out of `phaseError` ("[PHASE] message") and resets to that instead of resetting to PENDING. Plan snippet's reset-to-PENDING would re-run `persistSchemaRelations`, which is not idempotent and would create duplicate entity/tag rows. Only resumable pre-scan phases honored; unknown values fall back to PENDING. Scan-stage failures are a v1 limitation (20m waitForEvent timeout — Task 13's concern). |
| 7 | 13. Scan management routes | ✅ done | `ac72787` | **Plan path deviation:** `[id]` → `[schemaId]` to match repo convention (`api/schemas/[schemaId]/{status,summary}` already exists). GET list + POST manual rescan (409 conflict with existing active scan, returns scanJobId so the client can redirect) + GET per-scan detail with 50 most recent failures and computed metrics. **Task 13 does NOT resolve the Task 12 scan-stage retry limitation** (see deferred debt) — a manual rescan creates a new `triggeredBy=MANUAL` ScanJob, but `runOnboarding.waitForEvent` matches on the original scanJobId, so the new scan's `scan.completed` event is ignored by the still-waiting workflow. Scan-metrics tests 8/8 still green. |
| 8 | 14. OnboardingFlow switch component | ✅ done | `8c8495e` | 10 phase components + `flow.tsx` switch + observer page at `app/onboarding/[schemaId]/page.tsx` (2s poll loop against Task 11's GET handler) + `connect/page.tsx` rewired to `POST /api/onboarding/start` with a client-generated ULID. Added `ulid` to `apps/web`. Typecheck clean first try; onboarding-polling 20/20 still green. `phase-review.tsx` is lifted from the standalone review page with the submit target pointed at Task 11's confirm handler. **Gap:** the plan sketch for `phase-extracting.tsx` referenced a `recentDiscoveries.entities` feed that `OnboardingPollingResponse` doesn't carry — shipping with just emails-processed/total, can add the discoveries feed later without a schema change. The old `onboarding/scanning/page.tsx` and `onboarding/review/page.tsx` are still live — Task 15 deletes them. |
| 9 | 15. Remove old routes and pages | ✅ done | `b5b42a9` | All 8 plan files deleted (4 interview routes, status route, scanning page, review page, scan-stream component) + empty parent dirs cleaned up. Also deleted `interview.test.ts` entirely (all tests were HTTP against deleted routes) and trimmed the "HTTP Finalize Route" describe block from `entity-groups.test.ts` (17→13 tests). Updated the JSDoc example in `tests/integration/helpers/timeout.ts`. Typecheck clean on first try, no broken imports. **Correction:** the earlier doc note that `api/schemas/[schemaId]/status/route.ts` was still referenced by `settings/topics/page.tsx` was wrong — grep confirmed zero references. |
| 10 | 16. End-to-end integration tests | ✅ done | `eba7dac` + `b68b3d4` | **Scoped pragmatically** — 4 test files instead of the plan's 5, covering structural guarantees without requiring live AI / Gmail: `onboarding-scan-accounting.test.ts` (6 tests, pure Prisma — pins the `processed+excluded+failed==total` invariant), `onboarding-concurrent-start.test.ts` (4 tests, Next+Inngest required — Task 10 idempotency under race), `onboarding-routes.test.ts` (18 tests, Next+Inngest required — HTTP contracts for Tasks 11/12/13), `onboarding-happy-path.test.ts` (1 test, gated on `RUN_E2E_HAPPY=1`). **Tests caught two real production bugs** (fixed in `b68b3d4`): (a) `handleApiError` didn't recognize `ZodError` — any `.parse()` call site returned 500 on invalid input instead of 400, now fixed for every route; (b) Task 10's start route had a TOCTOU race between `findUnique` and `createSchemaStub` — three parallel POSTs with the same ULID made two losers hit `P2002` and return 500. Fixed by catching `P2002` + re-resolving the winner + applying the ownership check, keeping the idempotent 202 contract. **Full Task 16 suite: 28/28 passing.** Plan deviation: all tests use real `createTestUser()` + Bearer auth, not the plan sketches' fake `x-test-user-id` header. |
| 11 | 17. Cron stub | ⏳ next | | `apps/web/src/lib/inngest/cron.ts` that fires `scan.requested` for stale schemas (uses `lastScannedAt`). |
| 11 | 18. Full verification + status doc update | ⏳ pending | | Typecheck + all integration tests + eval rerun. Flip the canonical status doc to "refactor complete". |

### Known deferred debt (intentional)

- **Scan-stage retry doesn't actually recover.** Task 12's retry route resets the schema to its failed phase and re-emits `onboarding.session.started`, which works cleanly for pre-scan failures (PENDING / GENERATING_HYPOTHESIS / FINALIZING_SCHEMA). For a `PROCESSING_SCAN` failure the route re-enters `runOnboarding.waitForEvent` against the **original** scanJobId, but that ScanJob is still in `phase=FAILED`, so no `scan.completed` event will ever be emitted and the resumed workflow hits the 20m timeout. Task 13's manual-rescan route creates a new `triggeredBy=MANUAL` ScanJob but with a **different** id, so the waiting workflow ignores its completion event as well. A proper fix needs either (a) a per-scan retry route that resets `ScanJob.phase=PENDING` and re-emits `scan.requested` with the same scanJobId, or (b) the onboarding retry route creating a new onboarding ScanJob and threading the new id through a replacement `scan.requested` event. Deferring until a scan-stage failure actually bites in practice.
- **Inngest-outage stranding in `POST /api/onboarding/start`** (new in Task 16). If `inngest.send()` throws after `createSchemaStub` has already committed — e.g. Inngest transient outage, dev server not running — the stub row is stranded in `phase=PENDING` with no workflow ever started. The next retry of the same schemaId hits the fast-path idempotency branch in the route and returns 202 without re-emitting, so the client sees success but the schema is dead. A proper fix needs either (a) the idempotent path detects "PENDING with no ScanJob for this schemaId" and re-emits the event, or (b) an outbox-pattern write so the stub create and the event emit land in one atomic unit. Task 16's concurrent-start test specifically does NOT cover this case — Inngest must be up for the test to pass.
- **`casesMerged` / `clustersCreated` fabricated as 0** in `api/schemas/[schemaId]/status/route.ts` for client compatibility. Cleanup can remove them entirely.
- **Stale comment** in `schema.prisma:211` references `schema.emailCount` (removed in Phase 0). Cosmetic.

### Resolved debt

- ~~ScanFailure row writes~~ — resolved in Task 7 (`5f6a4a0`).
- ~~Transitional `status=ONBOARDING → ACTIVE` flip in `runSynthesis`~~ — resolved in Task 9 (`b8dc3b0`).
- ~~No automatic `status=ACTIVE` on AWAITING_REVIEW~~ — resolved in Task 11 (`926e8af`). Review-confirmation `POST /api/onboarding/:schemaId` CAS-flips `AWAITING_REVIEW → COMPLETED` + `status=ACTIVE` in one `updateMany`.

### Verification routine

1. `cd apps/web && pnpm typecheck` → exit 0
2. Task's new integration test — `pnpm exec vitest run --config vitest.integration.config.ts <name>` from `apps/web/`
3. Related tests that might regress (e.g. `entity-groups` when touching `interview.ts`) — one file at a time (the singleton test user trips up multi-file runs)
4. Package unit tests — `pnpm -r --filter '!web' test` (126 tests: types 2 + engine 92 + ai 32)
5. `pnpm biome check --write <files>`, then re-run the task test
6. Update this header + the auto-memory mirror + `docs/00_denim_current_status.md` in the same commit sweep as the code change, or as a trailing `docs(plan):` commit

**Dev server dependencies:** HTTP tests need `pnpm --filter web dev` on `:3000`. Inngest event-chain tests need `npx inngest-cli@latest dev` on `:8288`. The core state-machine suite (scan-metrics, onboarding-state, onboarding-polling) is pure Prisma and doesn't need either.

---

## Phase 0: Prisma model migration

### Task 1: Add new Prisma models and columns

**Files:**
- Modify: `apps/web/prisma/schema.prisma`

- [ ] **Step 1: Add new enums and columns to schema.prisma**

Add the following enums (inside the enum section, alphabetical with existing):

```prisma
enum SchemaPhase {
  PENDING
  GENERATING_HYPOTHESIS
  FINALIZING_SCHEMA
  PROCESSING_SCAN
  AWAITING_REVIEW
  COMPLETED
  NO_EMAILS_FOUND
  FAILED
}

enum ScanTrigger {
  ONBOARDING
  CRON_DAILY
  CRON_HOURLY
  MANUAL
  FEEDBACK
}
```

Modify the `CaseSchema` model. Keep all existing fields, add these inside the model:

```prisma
  // Onboarding workflow state machine — null after AWAITING_REVIEW confirmed
  phase           SchemaPhase?
  phaseError      String?
  phaseErrorAt    DateTime?
  phaseUpdatedAt  DateTime?

  // Raw onboarding inputs + intermediate (only meaningful during onboarding)
  inputs          Json?
  hypothesis      Json?

  // Cron / re-scan watermark
  lastScannedAt   DateTime?

  // Relation to failures (per-email scan errors)
  scanFailures    ScanFailure[]
```

Modify the `ScanJob` model. Keep existing fields, add these:

```prisma
  triggeredBy         ScanTrigger                  @default(ONBOARDING)
  discoveredEmailIds  Json?
  errorPhase          ScanPhase?
  errorMessage        String?
  failures            ScanFailure[]
```

Add the new `ScanFailure` model at the end of the file before the last enum block:

```prisma
model ScanFailure {
  id              String    @id @default(cuid())
  scanJobId       String
  schemaId        String
  gmailMessageId  String
  phase           ScanPhase
  errorMessage    String
  errorStack      String?
  attemptCount    Int       @default(1)
  createdAt       DateTime  @default(now())

  scanJob         ScanJob    @relation(fields: [scanJobId], references: [id], onDelete: Cascade)
  schema          CaseSchema @relation(fields: [schemaId], references: [id], onDelete: Cascade)

  @@unique([scanJobId, gmailMessageId])
  @@index([schemaId, createdAt])
}
```

Modify the `Email` model. Add these fields:

```prisma
  firstScanJobId  String?
  lastScanJobId   String?
```

- [ ] **Step 2: Mark dropped counter columns for removal**

In `CaseSchema`, DELETE these fields (they will become computed-on-demand in later tasks):

```
emailCount  Int @default(0)
caseCount   Int @default(0)
```

In `ScanJob`, DELETE these fields:

```
processedEmails   Int @default(0)
excludedEmails    Int @default(0)
failedEmails      Int @default(0)
casesCreated      Int @default(0)
casesMerged       Int @default(0)
clustersCreated   Int @default(0)
estimatedCostUsd  Decimal?
```

Do NOT delete `ScanJob.totalEmails` — that's set once at discovery and represents the intended work, not a running counter.

- [ ] **Step 3: Apply migration via supabase-db skill**

```
Use the .claude/skills/supabase-db.md skill to generate and apply the migration.
Migration name: onboarding-state-machine
```

Expected: new columns added, dropped columns removed, `ScanFailure` table created.

- [ ] **Step 4: Regenerate Prisma client**

Run: `pnpm --filter web prisma generate`
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 5: Find everywhere the dropped fields are read**

Run: `pnpm biome check apps/web packages 2>&1 | head -100`

Note every file that now has a type error for the dropped fields. These will be fixed in Phase 1.

- [ ] **Step 6: Commit**

```bash
git add apps/web/prisma/schema.prisma apps/web/prisma/migrations/
git commit -m "feat(schema): add onboarding state machine columns, ScanFailure table, drop counter fields"
```

---

## Phase 1: Compute-on-demand counter reads

Replace every read of the dropped counter fields with an on-demand `count()` / `sum()` query. No behavior changes yet — this is pure refactoring to unblock dropping the denormalized columns.

### Task 2: Add compute-on-demand helpers

**Files:**
- Create: `apps/web/src/lib/services/scan-metrics.ts`
- Create: `apps/web/src/lib/services/scan-metrics.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/src/lib/services/scan-metrics.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { computeScanMetrics, computeSchemaMetrics } from "./scan-metrics";

describe("computeScanMetrics", () => {
  beforeEach(async () => {
    // test setup — seed a schema + scanJob + emails + failures
    // (assumes integration test harness; skip if unit-only env)
  });

  it("returns zero counters for a fresh scan with no emails", async () => {
    const scan = await prisma.scanJob.create({
      data: {
        schemaId: "test-schema",
        userId: "test-user",
        totalEmails: 0,
        triggeredBy: "ONBOARDING",
      },
    });
    const metrics = await computeScanMetrics(scan.id);
    expect(metrics.totalEmails).toBe(0);
    expect(metrics.processedEmails).toBe(0);
    expect(metrics.excludedEmails).toBe(0);
    expect(metrics.failedEmails).toBe(0);
    expect(metrics.estimatedCostUsd).toBe(0);
  });

  it("counts emails by firstScanJobId and isExcluded", async () => {
    // seed a scan with 3 processed, 2 excluded, 1 failed
    // ...
    const metrics = await computeScanMetrics(scanId);
    expect(metrics.processedEmails).toBe(3);
    expect(metrics.excludedEmails).toBe(2);
    expect(metrics.failedEmails).toBe(1);
    expect(metrics.totalEmails).toBe(6);
  });

  it("sums cost from ExtractionCost rows keyed on scanJobId", async () => {
    // seed extraction_costs for the scan
    const metrics = await computeScanMetrics(scanId);
    expect(metrics.estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe("computeSchemaMetrics", () => {
  it("counts Email rows by schemaId for emailCount", async () => {
    const metrics = await computeSchemaMetrics("test-schema");
    expect(metrics.emailCount).toBeGreaterThanOrEqual(0);
  });

  it("counts Case rows by schemaId for caseCount", async () => {
    const metrics = await computeSchemaMetrics("test-schema");
    expect(metrics.caseCount).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test scan-metrics.test -- --run`
Expected: FAIL with "computeScanMetrics is not defined"

- [ ] **Step 3: Implement the helpers**

```typescript
// apps/web/src/lib/services/scan-metrics.ts
import { prisma } from "@/lib/prisma";

export interface ScanMetrics {
  totalEmails: number;       // from ScanJob.totalEmails (durable)
  processedEmails: number;   // count Email where firstScanJobId=scanId, !isExcluded
  excludedEmails: number;    // count Email where firstScanJobId=scanId, isExcluded
  failedEmails: number;      // count ScanFailure where scanJobId=scanId
  estimatedCostUsd: number;  // sum ExtractionCost.estimatedCostUsd where scanJobId=scanId
  casesCreated: number;      // count Case where scanJobId=scanId (via any email)
}

export async function computeScanMetrics(scanJobId: string): Promise<ScanMetrics> {
  const [scan, processed, excluded, failed, costSum] = await Promise.all([
    prisma.scanJob.findUnique({
      where: { id: scanJobId },
      select: { totalEmails: true, schemaId: true },
    }),
    prisma.email.count({
      where: { firstScanJobId: scanJobId, isExcluded: false },
    }),
    prisma.email.count({
      where: { firstScanJobId: scanJobId, isExcluded: true },
    }),
    prisma.scanFailure.count({
      where: { scanJobId },
    }),
    prisma.extractionCost.aggregate({
      where: { scanJobId },
      _sum: { estimatedCostUsd: true },
    }),
  ]);

  if (!scan) {
    return {
      totalEmails: 0,
      processedEmails: 0,
      excludedEmails: 0,
      failedEmails: 0,
      estimatedCostUsd: 0,
      casesCreated: 0,
    };
  }

  // casesCreated: distinct Case.id for cases whose clusters reference emails
  // from this scan. Approximate via emails joined to cases for now.
  const casesCreated = await prisma.case.count({
    where: {
      schemaId: scan.schemaId,
      emails: { some: { firstScanJobId: scanJobId } },
    },
  });

  return {
    totalEmails: scan.totalEmails,
    processedEmails: processed,
    excludedEmails: excluded,
    failedEmails: failed,
    estimatedCostUsd: Number(costSum._sum.estimatedCostUsd ?? 0),
    casesCreated,
  };
}

export interface SchemaMetrics {
  emailCount: number;
  caseCount: number;
  actionCount: number;
}

export async function computeSchemaMetrics(schemaId: string): Promise<SchemaMetrics> {
  const [emailCount, caseCount, actionCount] = await Promise.all([
    prisma.email.count({ where: { schemaId, isExcluded: false } }),
    prisma.case.count({ where: { schemaId } }),
    prisma.caseAction.count({ where: { schemaId } }),
  ]);
  return { emailCount, caseCount, actionCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test scan-metrics.test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/services/scan-metrics.ts apps/web/src/lib/services/scan-metrics.test.ts
git commit -m "feat(services): compute-on-demand scan and schema metrics"
```

### Task 3: Replace all reads of dropped counters

**Files:**
- Modify: `apps/web/src/app/api/schemas/[schemaId]/status/route.ts`
- Modify: `apps/web/src/app/api/feed/route.ts` (if it references emailCount/caseCount)
- Modify: `apps/web/src/lib/services/extraction.ts:458-492` (remove counter increments)
- Modify: `apps/web/src/lib/inngest/functions.ts` (remove counter-increment side effects from pipeline steps)
- Modify: `apps/web/src/components/feed/feed-client.tsx` (if it displays counts)

- [ ] **Step 1: Enumerate affected files**

Run: `pnpm --filter web tsc --noEmit 2>&1 | tee /tmp/dropped-fields.txt`

Every line in `/tmp/dropped-fields.txt` mentioning `emailCount`, `caseCount`, `processedEmails`, `excludedEmails`, `failedEmails`, `casesCreated`, `casesMerged`, `clustersCreated`, or `estimatedCostUsd` is a read site.

- [ ] **Step 2: For each read site, replace with computeScanMetrics / computeSchemaMetrics call**

Example transform for `app/api/schemas/[schemaId]/status/route.ts`:

```typescript
// BEFORE
const schema = await prisma.caseSchema.findUnique({
  where: { id: schemaId },
  select: { emailCount: true, caseCount: true, status: true, userId: true },
});
return NextResponse.json({ emailCount: schema.emailCount, caseCount: schema.caseCount, ... });

// AFTER
import { computeSchemaMetrics } from "@/lib/services/scan-metrics";

const schema = await prisma.caseSchema.findUnique({
  where: { id: schemaId },
  select: { status: true, userId: true },
});
const metrics = await computeSchemaMetrics(schemaId);
return NextResponse.json({ emailCount: metrics.emailCount, caseCount: metrics.caseCount, ... });
```

Example transform for extraction counter-increment removal in `lib/services/extraction.ts` (around lines 458–492, the isNewEmail block that increments schemaTag/caseSchema/entity emailCount):

```typescript
// BEFORE — inside the isNewEmail transaction
await tx.caseSchema.update({
  where: { id: schemaId },
  data: { emailCount: { increment: 1 } },
});
await tx.entity.update({ ... { increment: 1 } });

// AFTER — delete these updates entirely. Emit the count via scan-metrics on read.
// Tag counts still need tracking (used in clustering weight calibration),
// so keep the schemaTag emailCount increment but log a TODO to migrate it.
```

For each file, apply the transform and re-run typecheck until green.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter web tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Run unit tests**

Run: `pnpm -r test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: replace denormalized counter reads with compute-on-demand"
```

---

## Phase 2: CAS helpers + state-machine tests

### Task 4: Write state-machine helpers with CAS

**Files:**
- Create: `apps/web/src/lib/services/onboarding-state.ts`
- Create: `apps/web/src/lib/services/onboarding-state.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/src/lib/services/onboarding-state.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  advanceSchemaPhase,
  advanceScanPhase,
  markSchemaFailed,
  markScanFailed,
  phaseIndex,
  scanPhaseIndex,
} from "./onboarding-state";

async function seedSchema(phase: any = "PENDING") {
  return prisma.caseSchema.create({
    data: {
      id: `test-${Date.now()}-${Math.random()}`,
      userId: "test-user",
      name: "test",
      status: "DRAFT",
      phase,
      inputs: {} as any,
    },
  });
}

describe("phaseIndex", () => {
  it("orders phases monotonically", () => {
    expect(phaseIndex("PENDING")).toBeLessThan(phaseIndex("GENERATING_HYPOTHESIS"));
    expect(phaseIndex("GENERATING_HYPOTHESIS")).toBeLessThan(phaseIndex("FINALIZING_SCHEMA"));
    expect(phaseIndex("FINALIZING_SCHEMA")).toBeLessThan(phaseIndex("PROCESSING_SCAN"));
    expect(phaseIndex("PROCESSING_SCAN")).toBeLessThan(phaseIndex("AWAITING_REVIEW"));
    expect(phaseIndex("AWAITING_REVIEW")).toBeLessThan(phaseIndex("COMPLETED"));
  });

  it("terminal states are all max index", () => {
    expect(phaseIndex("COMPLETED")).toBeGreaterThanOrEqual(phaseIndex("AWAITING_REVIEW"));
    expect(phaseIndex("NO_EMAILS_FOUND")).toBeGreaterThanOrEqual(phaseIndex("DISCOVERING"));
    expect(phaseIndex("FAILED")).toBeGreaterThanOrEqual(phaseIndex("PENDING"));
  });
});

describe("advanceSchemaPhase", () => {
  it("advances from expected pre-state to post-state", async () => {
    const schema = await seedSchema("PENDING");
    const result = await advanceSchemaPhase({
      schemaId: schema.id,
      from: "PENDING",
      to: "GENERATING_HYPOTHESIS",
      work: async () => "worked",
    });
    expect(result).toBe("worked");
    const after = await prisma.caseSchema.findUniqueOrThrow({ where: { id: schema.id } });
    expect(after.phase).toBe("GENERATING_HYPOTHESIS");
    expect(after.phaseUpdatedAt).toBeTruthy();
  });

  it("is idempotent — skips if already past from-state", async () => {
    const schema = await seedSchema("FINALIZING_SCHEMA");
    const result = await advanceSchemaPhase({
      schemaId: schema.id,
      from: "PENDING",
      to: "GENERATING_HYPOTHESIS",
      work: async () => "should-not-run",
    });
    expect(result).toBe("skipped");
    const after = await prisma.caseSchema.findUniqueOrThrow({ where: { id: schema.id } });
    expect(after.phase).toBe("FINALIZING_SCHEMA"); // unchanged
  });

  it("throws NonRetriableError on unexpected state", async () => {
    const schema = await seedSchema("FAILED");
    await expect(
      advanceSchemaPhase({
        schemaId: schema.id,
        from: "PENDING",
        to: "GENERATING_HYPOTHESIS",
        work: async () => "nope",
      }),
    ).rejects.toThrow(/expected PENDING/);
  });

  it("CAS-loses gracefully — no-op when another writer advances first", async () => {
    const schema = await seedSchema("PENDING");
    // Simulate a concurrent writer advancing the phase between our read and write
    const work = async () => {
      await prisma.caseSchema.update({
        where: { id: schema.id },
        data: { phase: "GENERATING_HYPOTHESIS" },
      });
      return "work-ran";
    };
    await expect(
      advanceSchemaPhase({
        schemaId: schema.id,
        from: "PENDING",
        to: "GENERATING_HYPOTHESIS",
        work,
      }),
    ).rejects.toThrow(/CAS lost/);
  });
});

describe("markSchemaFailed", () => {
  it("sets phase=FAILED with errorMessage and phaseError fields", async () => {
    const schema = await seedSchema("EXTRACTING");
    await markSchemaFailed(schema.id, "EXTRACTING", new Error("boom"));
    const after = await prisma.caseSchema.findUniqueOrThrow({ where: { id: schema.id } });
    expect(after.phase).toBe("FAILED");
    expect(after.phaseError).toContain("boom");
    expect(after.phaseErrorAt).toBeTruthy();
  });
});

describe("advanceScanPhase", () => {
  // Symmetric tests for ScanJob phase transitions
  it("advances scan from DISCOVERING to EXTRACTING", async () => {
    // ... seed scanJob, call advanceScanPhase, assert ...
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test onboarding-state.test -- --run`
Expected: FAIL with "advanceSchemaPhase is not defined"

- [ ] **Step 3: Implement the helpers**

```typescript
// apps/web/src/lib/services/onboarding-state.ts
import { prisma } from "@/lib/prisma";
import type { SchemaPhase, ScanPhase } from "@prisma/client";
import { NonRetriableError } from "inngest";

// Monotonic ordering of schema phases. Terminal states are all given the max
// index so idempotency checks ("already past") short-circuit correctly.
const SCHEMA_PHASE_ORDER: Record<SchemaPhase, number> = {
  PENDING: 0,
  GENERATING_HYPOTHESIS: 1,
  FINALIZING_SCHEMA: 2,
  PROCESSING_SCAN: 3,
  AWAITING_REVIEW: 4,
  COMPLETED: 5,
  NO_EMAILS_FOUND: 99,
  FAILED: 99,
};

export function phaseIndex(phase: SchemaPhase | null | undefined): number {
  if (!phase) return -1;
  return SCHEMA_PHASE_ORDER[phase] ?? -1;
}

const SCAN_PHASE_ORDER: Record<ScanPhase, number> = {
  IDLE: 0,
  PENDING: 0,
  DISCOVERING: 1,
  EXTRACTING: 2,
  CLUSTERING: 3,
  SYNTHESIZING: 4,
  COMPLETED: 5,
  FAILED: 99,
};

export function scanPhaseIndex(phase: ScanPhase | null | undefined): number {
  if (!phase) return -1;
  return SCAN_PHASE_ORDER[phase] ?? -1;
}

export interface AdvanceSchemaPhaseOpts<T> {
  schemaId: string;
  from: SchemaPhase;
  to: SchemaPhase;
  work: () => Promise<T>;
}

/**
 * Atomically advance a CaseSchema's phase from `from` to `to`.
 * - Reads current phase first
 * - Returns "skipped" if already past `from` (idempotent re-run)
 * - Throws NonRetriableError if in an unexpected state
 * - Runs `work()` only if pre-state matches
 * - Uses CAS (updateMany with phase in where clause) to advance
 */
export async function advanceSchemaPhase<T>(
  opts: AdvanceSchemaPhaseOpts<T>,
): Promise<T | "skipped"> {
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: opts.schemaId },
    select: { phase: true },
  });

  // Idempotent skip: already past the `from` state.
  if (phaseIndex(schema.phase) > phaseIndex(opts.from)) {
    return "skipped";
  }

  if (schema.phase !== opts.from) {
    throw new NonRetriableError(
      `advanceSchemaPhase: expected phase=${opts.from}, got phase=${schema.phase} (schemaId=${opts.schemaId})`,
    );
  }

  const result = await opts.work();

  const updated = await prisma.caseSchema.updateMany({
    where: { id: opts.schemaId, phase: opts.from },
    data: {
      phase: opts.to,
      phaseUpdatedAt: new Date(),
      phaseError: null,
      phaseErrorAt: null,
    },
  });

  if (updated.count !== 1) {
    throw new NonRetriableError(
      `advanceSchemaPhase: CAS lost on ${opts.from} → ${opts.to} (schemaId=${opts.schemaId})`,
    );
  }

  return result;
}

export async function markSchemaFailed(
  schemaId: string,
  phaseAtFailure: SchemaPhase,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.caseSchema.update({
    where: { id: schemaId },
    data: {
      phase: "FAILED",
      phaseError: `[${phaseAtFailure}] ${message}`,
      phaseErrorAt: new Date(),
      phaseUpdatedAt: new Date(),
    },
  });
}

export interface AdvanceScanPhaseOpts<T> {
  scanJobId: string;
  from: ScanPhase;
  to: ScanPhase;
  work: () => Promise<T>;
}

export async function advanceScanPhase<T>(
  opts: AdvanceScanPhaseOpts<T>,
): Promise<T | "skipped"> {
  const scan = await prisma.scanJob.findUniqueOrThrow({
    where: { id: opts.scanJobId },
    select: { phase: true },
  });

  if (scanPhaseIndex(scan.phase) > scanPhaseIndex(opts.from)) {
    return "skipped";
  }

  if (scan.phase !== opts.from) {
    throw new NonRetriableError(
      `advanceScanPhase: expected phase=${opts.from}, got phase=${scan.phase} (scanJobId=${opts.scanJobId})`,
    );
  }

  const result = await opts.work();

  const updated = await prisma.scanJob.updateMany({
    where: { id: opts.scanJobId, phase: opts.from },
    data: { phase: opts.to },
  });

  if (updated.count !== 1) {
    throw new NonRetriableError(
      `advanceScanPhase: CAS lost on ${opts.from} → ${opts.to} (scanJobId=${opts.scanJobId})`,
    );
  }

  return result;
}

export async function markScanFailed(
  scanJobId: string,
  phaseAtFailure: ScanPhase,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: {
      phase: "FAILED",
      status: "FAILED",
      errorPhase: phaseAtFailure,
      errorMessage: message,
      completedAt: new Date(),
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test onboarding-state.test -- --run`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/services/onboarding-state.ts apps/web/src/lib/services/onboarding-state.test.ts
git commit -m "feat(services): CAS-on-phase helpers for schema and scan state machines"
```

---

## Phase 3: Polling response merge

### Task 5: Write derivePollingResponse merge function

**Files:**
- Create: `apps/web/src/lib/services/onboarding-polling.ts`
- Create: `apps/web/src/lib/services/onboarding-polling.test.ts`

- [ ] **Step 1: Write failing tests covering every phase combination**

```typescript
// apps/web/src/lib/services/onboarding-polling.test.ts
import { describe, it, expect } from "vitest";
import { derivePollingResponse } from "./onboarding-polling";
import type { CaseSchema, ScanJob } from "@prisma/client";

function mockSchema(overrides: Partial<CaseSchema>): CaseSchema {
  return {
    id: "schema-123",
    userId: "user-1",
    name: "Test",
    status: "DRAFT",
    phase: "PENDING",
    phaseError: null,
    phaseErrorAt: null,
    phaseUpdatedAt: new Date(),
    inputs: null,
    hypothesis: null,
    lastScannedAt: null,
    // ... include other required CaseSchema fields with sensible defaults
    ...overrides,
  } as CaseSchema;
}

function mockScan(overrides: Partial<ScanJob>): ScanJob {
  return {
    id: "scan-123",
    schemaId: "schema-123",
    userId: "user-1",
    status: "RUNNING",
    phase: "EXTRACTING",
    triggeredBy: "ONBOARDING",
    totalEmails: 100,
    discoveredEmailIds: null,
    errorPhase: null,
    errorMessage: null,
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as ScanJob;
}

describe("derivePollingResponse", () => {
  describe("pre-scan schema phases", () => {
    it("PENDING → PENDING", async () => {
      const res = await derivePollingResponse(mockSchema({ phase: "PENDING" }), null);
      expect(res.phase).toBe("PENDING");
    });

    it("GENERATING_HYPOTHESIS → GENERATING_HYPOTHESIS", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "GENERATING_HYPOTHESIS" }),
        null,
      );
      expect(res.phase).toBe("GENERATING_HYPOTHESIS");
    });

    it("FINALIZING_SCHEMA → FINALIZING_SCHEMA", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "FINALIZING_SCHEMA" }),
        null,
      );
      expect(res.phase).toBe("FINALIZING_SCHEMA");
    });
  });

  describe("PROCESSING_SCAN drills into the active scan", () => {
    it("scan phase DISCOVERING → DISCOVERING", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "PROCESSING_SCAN" }),
        mockScan({ phase: "DISCOVERING" }),
      );
      expect(res.phase).toBe("DISCOVERING");
    });

    it("scan phase EXTRACTING → EXTRACTING with progress", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "PROCESSING_SCAN" }),
        mockScan({ phase: "EXTRACTING", totalEmails: 100 }),
      );
      expect(res.phase).toBe("EXTRACTING");
      expect(res.progress?.emailsTotal).toBe(100);
    });

    it("scan phase CLUSTERING → CLUSTERING", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "PROCESSING_SCAN" }),
        mockScan({ phase: "CLUSTERING" }),
      );
      expect(res.phase).toBe("CLUSTERING");
    });

    it("scan phase SYNTHESIZING → SYNTHESIZING", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "PROCESSING_SCAN" }),
        mockScan({ phase: "SYNTHESIZING" }),
      );
      expect(res.phase).toBe("SYNTHESIZING");
    });

    it("scan FAILED during PROCESSING_SCAN → FAILED with errorPhase", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "PROCESSING_SCAN" }),
        mockScan({ phase: "FAILED", errorPhase: "EXTRACTING", errorMessage: "gemini timeout" }),
      );
      expect(res.phase).toBe("FAILED");
      expect(res.error?.phase).toBe("EXTRACTING");
      expect(res.error?.message).toContain("gemini timeout");
    });

    it("PROCESSING_SCAN with no scan row → defensive DISCOVERING (logs)", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "PROCESSING_SCAN" }),
        null,
      );
      expect(res.phase).toBe("DISCOVERING"); // fallback
    });
  });

  describe("terminal states", () => {
    it("schema status ACTIVE → COMPLETED with nextHref", async () => {
      const res = await derivePollingResponse(
        mockSchema({ status: "ACTIVE", phase: null }),
        null,
      );
      expect(res.phase).toBe("COMPLETED");
      expect(res.nextHref).toBe("/feed?schema=schema-123");
    });

    it("phase NO_EMAILS_FOUND → NO_EMAILS_FOUND", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "NO_EMAILS_FOUND" }),
        null,
      );
      expect(res.phase).toBe("NO_EMAILS_FOUND");
    });

    it("phase AWAITING_REVIEW → AWAITING_REVIEW", async () => {
      const res = await derivePollingResponse(
        mockSchema({ phase: "AWAITING_REVIEW" }),
        null,
      );
      expect(res.phase).toBe("AWAITING_REVIEW");
    });

    it("phase FAILED → FAILED with schema-level errorMessage", async () => {
      const res = await derivePollingResponse(
        mockSchema({
          phase: "FAILED",
          phaseError: "[GENERATING_HYPOTHESIS] claude 429",
        }),
        null,
      );
      expect(res.phase).toBe("FAILED");
      expect(res.error?.message).toContain("claude 429");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test onboarding-polling.test -- --run`
Expected: FAIL with "derivePollingResponse is not defined"

- [ ] **Step 3: Implement derivePollingResponse**

```typescript
// apps/web/src/lib/services/onboarding-polling.ts
import type { CaseSchema, ScanJob } from "@prisma/client";
import { logger } from "@/lib/logger";
import { computeScanMetrics } from "./scan-metrics";

export type OnboardingPhase =
  | "PENDING"
  | "GENERATING_HYPOTHESIS"
  | "FINALIZING_SCHEMA"
  | "DISCOVERING"
  | "EXTRACTING"
  | "CLUSTERING"
  | "SYNTHESIZING"
  | "AWAITING_REVIEW"
  | "COMPLETED"
  | "NO_EMAILS_FOUND"
  | "FAILED";

export interface OnboardingPollingResponse {
  schemaId: string;
  phase: OnboardingPhase;
  progress: {
    emailsTotal?: number;
    emailsProcessed?: number;
    emailsExcluded?: number;
    emailsFailed?: number;
    casesTotal?: number;
    casesSynthesized?: number;
  };
  recentDiscoveries?: { entities: Array<{ name: string; emailCount: number }> };
  error?: { phase: string; message: string; retryable: boolean };
  nextHref?: string;
  updatedAt: string;
}

/**
 * Merge the CaseSchema and active ScanJob state machines into a single
 * flat response shape. The client reads only `phase` and `progress`
 * and never needs to know about the two-row underlying structure.
 *
 * This is the seam between the internal state machines and the client.
 * Every branch is covered by unit tests — if you add a state, add a test.
 */
export async function derivePollingResponse(
  schema: CaseSchema,
  onboardingScan: ScanJob | null,
): Promise<OnboardingPollingResponse> {
  const base = {
    schemaId: schema.id,
    progress: {},
    updatedAt: (schema.phaseUpdatedAt ?? schema.updatedAt ?? new Date()).toISOString(),
  };

  // Terminal: user has confirmed, schema is ACTIVE.
  if (schema.status === "ACTIVE") {
    return {
      ...base,
      phase: "COMPLETED",
      nextHref: `/feed?schema=${schema.id}`,
    };
  }

  // Terminal: schema-level failure.
  if (schema.phase === "FAILED") {
    return {
      ...base,
      phase: "FAILED",
      error: {
        phase: schema.phaseError?.match(/^\[([^\]]+)\]/)?.[1] ?? "UNKNOWN",
        message: schema.phaseError ?? "Unknown error",
        retryable: true,
      },
    };
  }

  // Terminal: empty discovery.
  if (schema.phase === "NO_EMAILS_FOUND") {
    return { ...base, phase: "NO_EMAILS_FOUND" };
  }

  // User checkpoint.
  if (schema.phase === "AWAITING_REVIEW") {
    return { ...base, phase: "AWAITING_REVIEW" };
  }

  // Pre-scan schema-owned phases.
  if (schema.phase === "PENDING") return { ...base, phase: "PENDING" };
  if (schema.phase === "GENERATING_HYPOTHESIS") return { ...base, phase: "GENERATING_HYPOTHESIS" };
  if (schema.phase === "FINALIZING_SCHEMA") return { ...base, phase: "FINALIZING_SCHEMA" };

  // PROCESSING_SCAN: the active scan owns the visible state.
  if (schema.phase === "PROCESSING_SCAN") {
    if (!onboardingScan) {
      // Shouldn't happen — PROCESSING_SCAN is only written in a tx with scan job creation.
      // Defensive fallback: show DISCOVERING and log.
      logger.error({
        service: "onboarding-polling",
        operation: "derivePollingResponse.missingScan",
        schemaId: schema.id,
      });
      return { ...base, phase: "DISCOVERING" };
    }

    if (onboardingScan.phase === "FAILED") {
      return {
        ...base,
        phase: "FAILED",
        error: {
          phase: onboardingScan.errorPhase ?? "UNKNOWN",
          message: onboardingScan.errorMessage ?? "Scan failed",
          retryable: true,
        },
      };
    }

    // Map scan phase 1:1 to user-facing phase.
    const scanPhaseToUserPhase: Record<string, OnboardingPhase> = {
      PENDING: "DISCOVERING",
      IDLE: "DISCOVERING",
      DISCOVERING: "DISCOVERING",
      EXTRACTING: "EXTRACTING",
      CLUSTERING: "CLUSTERING",
      SYNTHESIZING: "SYNTHESIZING",
      COMPLETED: "SYNTHESIZING", // orchestrator will flip schema to AWAITING_REVIEW shortly
    };

    const metrics = await computeScanMetrics(onboardingScan.id);

    return {
      ...base,
      phase: scanPhaseToUserPhase[onboardingScan.phase] ?? "DISCOVERING",
      progress: {
        emailsTotal: metrics.totalEmails,
        emailsProcessed: metrics.processedEmails,
        emailsExcluded: metrics.excludedEmails,
        emailsFailed: metrics.failedEmails,
      },
    };
  }

  // Defensive: unknown phase.
  logger.error({
    service: "onboarding-polling",
    operation: "derivePollingResponse.unknownPhase",
    schemaId: schema.id,
    phase: schema.phase,
  });
  return { ...base, phase: "PENDING" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test onboarding-polling.test -- --run`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/services/onboarding-polling.ts apps/web/src/lib/services/onboarding-polling.test.ts
git commit -m "feat(services): derivePollingResponse merges schema and scan state machines"
```

---

## Phase 4: Split finalizeSchema

### Task 6: Extract persistSchemaRelations from finalizeSchema

**Files:**
- Modify: `apps/web/src/lib/services/interview.ts`

- [ ] **Step 1: Identify the current finalizeSchema structure**

The current `finalizeSchema` (interview.ts around line 193) does both CaseSchema creation AND relation creation (entities, tags, groups, fields) in one transaction. We need to split them so the workflow can:
1. Create the CaseSchema row early (at `/api/onboarding/start` time — needed for the session id)
2. Populate relations later (after hypothesis generation in the workflow)

- [ ] **Step 2: Write the new `createSchemaStub` function**

Add to `apps/web/src/lib/services/interview.ts`:

```typescript
/**
 * Create a minimal CaseSchema row at the start of onboarding.
 * This is called synchronously from POST /api/onboarding/start to claim
 * the session id; the rest of the schema (entities, tags, groups, fields)
 * is populated later by the workflow in persistSchemaRelations().
 */
export async function createSchemaStub(opts: {
  schemaId: string; // client-supplied ULID
  userId: string;
  inputs: InterviewInput;
}): Promise<void> {
  await prisma.caseSchema.create({
    data: {
      id: opts.schemaId,
      userId: opts.userId,
      name: "Setting up...", // placeholder; overwritten by persistSchemaRelations
      status: "DRAFT",
      phase: "PENDING",
      phaseUpdatedAt: new Date(),
      inputs: opts.inputs as Prisma.JsonValue,
      // domain and other fields populated later
    },
  });
}
```

- [ ] **Step 3: Extract persistSchemaRelations from finalizeSchema**

Refactor existing `finalizeSchema` into a new function `persistSchemaRelations` that assumes the `CaseSchema` row already exists and writes only the related rows (entities, tags, groups, fields) plus updates name/domain/discoveryQueries on the existing row. Keep the existing `finalizeSchema` function for any other callers but have it delegate to `createSchemaStub` + `persistSchemaRelations`.

```typescript
export async function persistSchemaRelations(
  schemaId: string,
  hypothesis: Hypothesis,
): Promise<void> {
  // Wraps the current transaction body from finalizeSchema (minus the row creation).
  // Updates name/domain/discoveryQueries on the existing row, creates entity/tag/group rows.
  await prisma.$transaction(async (tx) => {
    await tx.caseSchema.update({
      where: { id: schemaId },
      data: {
        name: hypothesis.schemaName,
        domain: hypothesis.domain,
        discoveryQueries: hypothesis.discoveryQueries as Prisma.JsonValue,
        // any other fields that finalizeSchema currently sets
      },
    });

    // entities
    for (const entity of hypothesis.entities) {
      await tx.entity.create({
        data: {
          schemaId,
          name: entity.name,
          type: entity.type,
          aliases: entity.aliases as Prisma.JsonValue,
          // ...
        },
      });
    }

    // entity groups (same as finalizeSchema body)
    // tags (same)
    // extracted fields (same)
  });
}

// Keep the old finalizeSchema for any external callers
export async function finalizeSchema(
  hypothesis: Hypothesis,
  validation: HypothesisValidation,
  confirmations: Confirmations,
  opts: { userId: string },
): Promise<string> {
  const schemaId = createId(); // existing cuid/ulid helper
  await createSchemaStub({ schemaId, userId: opts.userId, inputs: { /* derive */ } as InterviewInput });
  await persistSchemaRelations(schemaId, hypothesis);
  return schemaId;
}
```

- [ ] **Step 4: Run typecheck and tests**

```bash
pnpm --filter web tsc --noEmit
pnpm -r test
```

Expected: clean typecheck, tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/services/interview.ts
git commit -m "refactor(interview): split finalizeSchema into createSchemaStub + persistSchemaRelations"
```

---

## Phase 5: Refactor existing pipeline functions to use CAS

### Task 7: Add CAS-on-phase to extractBatch, clustering, synthesis functions

**Files:**
- Modify: `apps/web/src/lib/inngest/functions.ts`

- [ ] **Step 1: Identify every phase write in the pipeline**

Audit the file for every `prisma.scanJob.update` that writes `phase:`. Each one becomes a `advanceScanPhase` call.

Specifically:
- `fanOutExtraction` "update-scan-job" step: writes phase=EXTRACTING (transition PENDING → EXTRACTING or DISCOVERING → EXTRACTING)
- `runCoarseClustering` "start-clustering" step: writes phase=CLUSTERING (transition EXTRACTING → CLUSTERING)
- `runCaseSplitting`: also phase=CLUSTERING (may be redundant — consolidate)
- `runSynthesis` "update-phase" step: writes phase=SYNTHESIZING (transition CLUSTERING → SYNTHESIZING)
- `runSynthesis` "complete-job" step: writes phase=COMPLETED + status=COMPLETED (transition SYNTHESIZING → COMPLETED)

- [ ] **Step 2: Replace each raw update with advanceScanPhase**

Example for fanOutExtraction:

```typescript
// BEFORE
await step.run("update-scan-job", async () => {
  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: { status: "RUNNING", phase: "EXTRACTING", totalEmails: emailIds.length, startedAt: new Date() },
  });
});

// AFTER
import { advanceScanPhase } from "@/lib/services/onboarding-state";

await step.run("advance-to-extracting", async () => {
  await advanceScanPhase({
    scanJobId,
    from: "DISCOVERING",
    to: "EXTRACTING",
    work: async () => {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: { status: "RUNNING", startedAt: new Date() },
      });
    },
  });
});
```

Apply the same transform for the clustering and synthesis transitions.

- [ ] **Step 3: Remove the schema.phase update from runSynthesis**

`runSynthesis` currently does `updateMany({ where: { id: schemaId, status: "ONBOARDING" }, data: { status: "ACTIVE" } })` at the end. This is the wrong place for that write now — the new `runOnboarding` orchestrator owns `CaseSchema.phase`, not the scan pipeline. Remove this block; we'll handle the transition via event in Phase 6.

- [ ] **Step 4: Emit scan.completed event at end of runSynthesis**

```typescript
await step.run("emit-scan-completed", async () => {
  await inngest.send({
    name: "scan.completed",
    data: { schemaId, scanJobId, synthesizedCount, failedCount },
  });
});
```

- [ ] **Step 5: Remove the onFailure handler from extractBatch**

The `onFailure` handler we added in the previous audit session can be removed — failures now go through `ScanFailure` rows and the per-email accounting is structural (Phase 1). Keep the basic retry logic but remove the counter-increment side effect.

- [ ] **Step 6: Update processEmailBatch to write ScanFailure rows**

In `apps/web/src/lib/services/extraction.ts`, update the catch block in `processEmailBatch` to write a `ScanFailure` row instead of incrementing a `failed` counter:

```typescript
// BEFORE
} catch (error) {
  failed++;
  logger.error({ ... });
}

// AFTER
} catch (error) {
  await prisma.scanFailure.upsert({
    where: { scanJobId_gmailMessageId: { scanJobId: options.scanJobId, gmailMessageId: messageId } },
    create: {
      scanJobId: options.scanJobId,
      schemaId: options.schemaId,
      gmailMessageId: messageId,
      phase: "EXTRACTING",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : null,
    },
    update: {
      attemptCount: { increment: 1 },
      errorMessage: error instanceof Error ? error.message : String(error),
    },
  });
  logger.error({ ... });
}
```

And remove the `failed` local counter entirely. Update the return type of `processEmailBatch`:

```typescript
export interface ProcessBatchResult {
  processed: number;
  excluded: number;
  // failed removed — derived from ScanFailure table on demand
}
```

- [ ] **Step 7: Set firstScanJobId on new Email rows**

In `extractEmail` (around the upsert at line 412+), the create path should set `firstScanJobId: options.scanJobId`. The update path should set `lastScanJobId: options.scanJobId` but leave `firstScanJobId` alone.

- [ ] **Step 8: Run tests**

```bash
pnpm --filter web tsc --noEmit
pnpm -r test
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/inngest/functions.ts apps/web/src/lib/services/extraction.ts
git commit -m "refactor(pipeline): CAS-on-phase transitions, ScanFailure rows, firstScanJobId"
```

---

## Phase 6: runScan orchestrator

### Task 8: Create runScan parent workflow

**Files:**
- Create: `apps/web/src/lib/inngest/scan.ts`
- Modify: `apps/web/src/lib/inngest/functions.ts` (export list)

- [ ] **Step 1: Create runScan function**

```typescript
// apps/web/src/lib/inngest/scan.ts
import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { GmailClient } from "@/lib/gmail/client";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { runSmartDiscovery } from "@/lib/services/discovery";
import { advanceScanPhase, markScanFailed } from "@/lib/services/onboarding-state";

/**
 * Parent workflow for every scan — onboarding, cron, manual, feedback.
 * Orchestrates: discovery → hand off to existing extraction chain → wait for
 * scan.completed (emitted by runSynthesis) → optional post-processing.
 *
 * This function OWNS ScanJob.phase transitions for DISCOVERING and the
 * initial EXTRACTING handoff. Once it emits scan.emails.discovered, the
 * existing fanOutExtraction/extractBatch/runCoarseClustering/runSynthesis
 * chain takes over (each function advances its own CAS phase).
 */
export const runScan = inngest.createFunction(
  {
    id: "run-scan",
    triggers: [{ event: "scan.requested" }],
    concurrency: [{ key: "event.data.schemaId", limit: 1 }],
    retries: 0, // failures are explicit via markScanFailed + FAILED phase
  },
  async ({ event, step }) => {
    const { scanJobId, schemaId, userId } = event.data as {
      scanJobId: string;
      schemaId: string;
      userId: string;
    };

    try {
      // Step 1: advance to DISCOVERING and run smart discovery
      const emailIds = await step.run("run-discovery", async () => {
        return advanceScanPhase({
          scanJobId,
          from: "PENDING",
          to: "DISCOVERING",
          work: async () => {
            const schema = await prisma.caseSchema.findUniqueOrThrow({
              where: { id: schemaId },
              include: {
                entityGroups: {
                  orderBy: { index: "asc" },
                  include: { entities: { where: { isActive: true }, select: { name: true, type: true } } },
                },
                entities: { where: { isActive: true }, select: { name: true } },
              },
            });

            const accessToken = await getValidGmailToken(userId);
            const gmailClient = new GmailClient(accessToken);
            const queries = schema.discoveryQueries as Array<{ query: string; label: string }>;
            const entityGroups = schema.entityGroups.map((g) => ({
              whats: g.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name),
              whos: g.entities.filter((e) => e.type === "SECONDARY").map((e) => e.name),
            }));
            const knownEntityNames = schema.entities.map((e) => e.name);

            const { emailIds } = await runSmartDiscovery(
              gmailClient,
              queries,
              entityGroups,
              knownEntityNames,
              schema.domain ?? "general",
              schemaId,
            );

            await prisma.scanJob.update({
              where: { id: scanJobId },
              data: {
                totalEmails: emailIds.length,
                discoveredEmailIds: emailIds as any,
                startedAt: new Date(),
              },
            });

            return emailIds;
          },
        });
      });

      // Skipped? Workflow is resuming past discovery — read current scan state.
      if (emailIds === "skipped") {
        logger.info({ service: "runScan", operation: "discovery.skipped", scanJobId });
        // No-op; subsequent steps will handle it via their own CAS checks.
      }

      const actualEmailIds: string[] =
        emailIds === "skipped"
          ? ((
              await prisma.scanJob.findUniqueOrThrow({
                where: { id: scanJobId },
                select: { discoveredEmailIds: true },
              })
            ).discoveredEmailIds as string[]) ?? []
          : emailIds;

      // Zero results: mark scan complete with zero totalEmails and exit.
      if (actualEmailIds.length === 0) {
        await step.run("complete-empty-scan", async () => {
          await prisma.scanJob.update({
            where: { id: scanJobId },
            data: {
              phase: "COMPLETED",
              status: "COMPLETED",
              completedAt: new Date(),
              totalEmails: 0,
            },
          });
          await inngest.send({
            name: "scan.completed",
            data: { scanJobId, schemaId, emailCount: 0, reason: "no-emails-found" },
          });
        });
        return;
      }

      // Step 2: hand off to fanOutExtraction via existing event
      await step.run("hand-off-extraction", async () => {
        await advanceScanPhase({
          scanJobId,
          from: "DISCOVERING",
          to: "EXTRACTING",
          work: async () => {
            await inngest.send({
              name: "scan.emails.discovered",
              data: { schemaId, userId, scanJobId, emailIds: actualEmailIds },
            });
          },
        });
      });

      // No further steps — the existing chain (fanOutExtraction → extractBatch →
      // checkExtractionComplete → runCoarseClustering → runCaseSplitting →
      // runSynthesis) runs independently and emits scan.completed at the end.
      // runOnboarding is the one that waits on that event, not this function.
    } catch (error) {
      if (error instanceof NonRetriableError) throw error;
      logger.error({
        service: "runScan",
        operation: "runScan.caught",
        scanJobId,
        schemaId,
        error: error instanceof Error ? error.message : String(error),
      });
      await markScanFailed(scanJobId, "DISCOVERING", error);
      throw error;
    }
  },
);
```

- [ ] **Step 2: Export runScan from the functions module**

In `apps/web/src/lib/inngest/functions.ts`, at the export list:

```typescript
import { runScan } from "./scan";

export const functions = [
  runScan,                       // NEW
  fanOutExtraction,
  extractBatch,
  checkExtractionComplete,
  runCoarseClustering,
  runCaseSplitting,
  runSynthesis,
  runClusteringCalibration,
  resynthesizeOnFeedback,
  dailyQualitySnapshot,
  dailyStatusDecay,
];
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter web tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/inngest/scan.ts apps/web/src/lib/inngest/functions.ts
git commit -m "feat(inngest): runScan parent workflow for all scan triggers"
```

---

## Phase 7: runOnboarding orchestrator + routes

### Task 9: Create runOnboarding parent workflow

**Files:**
- Create: `apps/web/src/lib/inngest/onboarding.ts`
- Modify: `apps/web/src/lib/inngest/functions.ts` (export list)

- [ ] **Step 1: Create runOnboarding function**

```typescript
// apps/web/src/lib/inngest/onboarding.ts
import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  advanceSchemaPhase,
  markSchemaFailed,
} from "@/lib/services/onboarding-state";
import {
  persistSchemaRelations,
} from "@/lib/services/interview";
import { generateHypothesis } from "@/lib/services/interview";
import type { InterviewInput, Hypothesis } from "@denim/types";

export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    triggers: [{ event: "onboarding.session.started" }],
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { key: "event.data.userId", limit: 3 },
    ],
    retries: 0,
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data as { schemaId: string; userId: string };

    try {
      // Step 1: Generate hypothesis from inputs
      await step.run("generate-hypothesis", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "PENDING",
          to: "GENERATING_HYPOTHESIS",
          work: async () => {
            const schema = await prisma.caseSchema.findUniqueOrThrow({
              where: { id: schemaId },
              select: { inputs: true },
            });
            const inputs = schema.inputs as InterviewInput | null;
            if (!inputs) throw new NonRetriableError("Missing inputs on CaseSchema");
            const hypothesis = await generateHypothesis(inputs, { userId });
            await prisma.caseSchema.update({
              where: { id: schemaId },
              data: { hypothesis: hypothesis as any },
            });
          },
        });
      });

      // Step 2: Persist schema relations (entities, tags, groups, fields)
      await step.run("finalize-schema", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "GENERATING_HYPOTHESIS",
          to: "FINALIZING_SCHEMA",
          work: async () => {
            const schema = await prisma.caseSchema.findUniqueOrThrow({
              where: { id: schemaId },
              select: { hypothesis: true },
            });
            const hypothesis = schema.hypothesis as Hypothesis | null;
            if (!hypothesis) throw new NonRetriableError("Missing hypothesis on CaseSchema");
            await persistSchemaRelations(schemaId, hypothesis);
          },
        });
      });

      // Step 3: Create the onboarding ScanJob and transition to PROCESSING_SCAN
      const scanJobId = await step.run("create-scan-job", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "FINALIZING_SCHEMA",
          to: "PROCESSING_SCAN",
          work: async () => {
            const scan = await prisma.scanJob.create({
              data: {
                schemaId,
                userId,
                status: "PENDING",
                phase: "PENDING",
                triggeredBy: "ONBOARDING",
                totalEmails: 0, // set by runScan discovery step
              },
            });
            return scan.id;
          },
        });
      });

      if (scanJobId === "skipped") {
        // Re-entering this step on resume — find the existing scan
        const existing = await prisma.scanJob.findFirst({
          where: { schemaId, triggeredBy: "ONBOARDING" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (!existing) throw new NonRetriableError("Resumed but no onboarding scan found");
      }

      const actualScanJobId: string =
        scanJobId === "skipped"
          ? (
              await prisma.scanJob.findFirstOrThrow({
                where: { schemaId, triggeredBy: "ONBOARDING" },
                orderBy: { createdAt: "desc" },
                select: { id: true },
              })
            ).id
          : scanJobId;

      // Step 4: Emit scan.requested to kick off runScan
      await step.run("request-scan", async () => {
        await inngest.send({
          name: "scan.requested",
          data: { scanJobId: actualScanJobId, schemaId, userId },
        });
      });

      // Step 5: Wait for scan.completed event
      const completion = await step.waitForEvent("wait-for-scan", {
        event: "scan.completed",
        timeout: "20m",
        if: `event.data.scanJobId == "${actualScanJobId}"`,
      });

      if (!completion) {
        throw new NonRetriableError("Scan timed out after 20 minutes");
      }

      // Step 6: Quality gate and advance to AWAITING_REVIEW
      await step.run("advance-to-review", async () => {
        const reason = (completion.data as any).reason;

        // No emails found → terminal state, not awaiting review
        if (reason === "no-emails-found") {
          await prisma.caseSchema.updateMany({
            where: { id: schemaId, phase: "PROCESSING_SCAN" },
            data: { phase: "NO_EMAILS_FOUND", phaseUpdatedAt: new Date() },
          });
          return;
        }

        // Verify every OPEN case has been synthesized
        const unsynthesized = await prisma.case.count({
          where: { schemaId, status: "OPEN", synthesizedAt: null },
        });
        if (unsynthesized > 0) {
          throw new Error(`${unsynthesized} cases still unsynthesized`);
        }

        await prisma.caseSchema.updateMany({
          where: { id: schemaId, phase: "PROCESSING_SCAN" },
          data: { phase: "AWAITING_REVIEW", phaseUpdatedAt: new Date() },
        });
      });
    } catch (error) {
      logger.error({
        service: "runOnboarding",
        operation: "runOnboarding.caught",
        schemaId,
        error: error instanceof Error ? error.message : String(error),
      });
      const schema = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true },
      });
      await markSchemaFailed(schemaId, schema?.phase ?? "PENDING", error);
      throw error;
    }
  },
);
```

- [ ] **Step 2: Add runOnboarding to functions export**

```typescript
// apps/web/src/lib/inngest/functions.ts
import { runOnboarding } from "./onboarding";

export const functions = [
  runOnboarding,                 // NEW
  runScan,
  fanOutExtraction,
  // ...
];
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/inngest/onboarding.ts apps/web/src/lib/inngest/functions.ts
git commit -m "feat(inngest): runOnboarding parent workflow with CAS + resume support"
```

### Task 10: POST /api/onboarding/start

**Files:**
- Create: `apps/web/src/app/api/onboarding/start/route.ts`

- [ ] **Step 1: Implement the start route**

```typescript
// apps/web/src/app/api/onboarding/start/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { createSchemaStub } from "@/lib/services/interview";
import { logger } from "@/lib/logger";

const StartBodySchema = z.object({
  schemaId: z.string().min(10), // client-supplied ULID
  inputs: z.object({
    role: z.string().optional(),
    domain: z.string(),
    whats: z.array(z.string()).default([]),
    whos: z.array(z.string()).default([]),
    customDescription: z.string().optional(),
    groups: z.array(z.unknown()).default([]),
    goals: z.array(z.string()).default([]),
  }),
});

/**
 * POST /api/onboarding/start
 *
 * Claims an onboarding session. The client generates a ULID and sends it as
 * the schemaId. If a row with that id already exists for this user, the
 * request is idempotent (returns the existing session without side effects).
 * Otherwise, creates the CaseSchema stub and emits onboarding.session.started
 * to kick off the workflow.
 */
export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = StartBodySchema.parse(await request.json());

    // Idempotency: look up by id (stable across retries from the same client)
    const existing = await prisma.caseSchema.findUnique({
      where: { id: body.schemaId },
      select: { id: true, userId: true, phase: true },
    });

    if (existing) {
      if (existing.userId !== userId) {
        return NextResponse.json(
          { error: "Forbidden", code: 403, type: "FORBIDDEN" },
          { status: 403 },
        );
      }
      logger.info({
        service: "onboarding",
        operation: "start.idempotent",
        userId,
        schemaId: body.schemaId,
        phase: existing.phase,
      });
      return NextResponse.json({ data: { schemaId: existing.id } }, { status: 202 });
    }

    // Create stub and fire the workflow
    await createSchemaStub({
      schemaId: body.schemaId,
      userId,
      inputs: body.inputs,
    });

    await inngest.send({
      name: "onboarding.session.started",
      data: { schemaId: body.schemaId, userId },
    });

    logger.info({
      service: "onboarding",
      operation: "start.created",
      userId,
      schemaId: body.schemaId,
    });

    return NextResponse.json({ data: { schemaId: body.schemaId } }, { status: 202 });
  } catch (error) {
    return handleApiError(error, { service: "onboarding", operation: "start", userId });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/api/onboarding/start/route.ts
git commit -m "feat(api): POST /api/onboarding/start claims session and emits workflow event"
```

### Task 11: GET /api/onboarding/[schemaId] (polling)

**Files:**
- Create: `apps/web/src/app/api/onboarding/[schemaId]/route.ts`

- [ ] **Step 1: Implement the GET + POST + DELETE handlers**

```typescript
// apps/web/src/app/api/onboarding/[schemaId]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { derivePollingResponse } from "@/lib/services/onboarding-polling";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";

function extractSchemaId(url: string): string | null {
  const m = url.match(/\/api\/onboarding\/([^/?]+)/);
  return m?.[1] ?? null;
}

// GET — polling endpoint
export const GET = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemaId(request.url);
    if (!schemaId) {
      return NextResponse.json(
        { error: "schemaId required", code: 400, type: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }

    const schema = await prisma.caseSchema.findUnique({ where: { id: schemaId } });
    if (!schema) {
      return NextResponse.json(
        { error: "Not found", code: 404, type: "NOT_FOUND" },
        { status: 404 },
      );
    }
    if (schema.userId !== userId) {
      return NextResponse.json(
        { error: "Forbidden", code: 403, type: "FORBIDDEN" },
        { status: 403 },
      );
    }

    const onboardingScan = await prisma.scanJob.findFirst({
      where: { schemaId, triggeredBy: "ONBOARDING" },
      orderBy: { createdAt: "desc" },
    });

    const response = await derivePollingResponse(schema, onboardingScan);
    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error, { service: "onboarding", operation: "poll", userId });
  }
});

// POST — confirm review and complete onboarding
const ConfirmSchema = z.object({
  topicName: z.string().min(1).max(100),
  entityToggles: z
    .array(z.object({ id: z.string(), isActive: z.boolean() }))
    .default([]),
});

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemaId(request.url);
    if (!schemaId) {
      return NextResponse.json(
        { error: "schemaId required", code: 400, type: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    const body = ConfirmSchema.parse(await request.json());

    const schema = await prisma.caseSchema.findUnique({ where: { id: schemaId } });
    if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (schema.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // CAS: only advance from AWAITING_REVIEW
    const updated = await prisma.caseSchema.updateMany({
      where: { id: schemaId, phase: "AWAITING_REVIEW" },
      data: {
        phase: "COMPLETED",
        status: "ACTIVE",
        name: body.topicName.trim(),
        phaseUpdatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      // Already confirmed or not in review — check current state
      const current = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true, status: true },
      });
      if (current?.status === "ACTIVE") {
        return NextResponse.json({ data: { status: "already-completed" } });
      }
      return NextResponse.json(
        { error: `Cannot confirm from phase ${current?.phase}` },
        { status: 409 },
      );
    }

    if (body.entityToggles.length > 0) {
      await prisma.$transaction(
        body.entityToggles.map((t) =>
          prisma.entity.update({
            where: { id: t.id },
            data: { isActive: t.isActive },
          }),
        ),
      );
    }

    logger.info({
      service: "onboarding",
      operation: "confirm",
      userId,
      schemaId,
    });

    return NextResponse.json({ data: { schemaId, status: "completed" } });
  } catch (error) {
    return handleApiError(error, { service: "onboarding", operation: "confirm", userId });
  }
});

// DELETE — cancel an in-flight onboarding
export const DELETE = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemaId(request.url);
    if (!schemaId) return NextResponse.json({ error: "schemaId required" }, { status: 400 });

    const schema = await prisma.caseSchema.findUnique({ where: { id: schemaId } });
    if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (schema.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Emit cancellation event (runOnboarding listens via cancelOn)
    await inngest.send({
      name: "onboarding.session.cancelled",
      data: { schemaId, userId },
    });

    // Mark schema as archived so it doesn't show up in active lists
    await prisma.caseSchema.update({
      where: { id: schemaId },
      data: { status: "ARCHIVED", phase: null },
    });

    return NextResponse.json({ data: { status: "cancelled" } });
  } catch (error) {
    return handleApiError(error, { service: "onboarding", operation: "cancel", userId });
  }
});
```

- [ ] **Step 2: Add cancelOn to runOnboarding**

Update `apps/web/src/lib/inngest/onboarding.ts`:

```typescript
export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    triggers: [{ event: "onboarding.session.started" }],
    cancelOn: [{ event: "onboarding.session.cancelled", match: "data.schemaId" }],  // NEW
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { key: "event.data.userId", limit: 3 },
    ],
    retries: 0,
  },
  // ...
);
```

- [ ] **Step 3: Add ARCHIVED to SchemaStatus enum if not already present**

Check `apps/web/prisma/schema.prisma`. If `ARCHIVED` is not in `SchemaStatus`, add it and migrate.

- [ ] **Step 4: Run typecheck and commit**

```bash
pnpm --filter web tsc --noEmit
git add apps/web/src/app/api/onboarding/[schemaId]/route.ts apps/web/src/lib/inngest/onboarding.ts apps/web/prisma/
git commit -m "feat(api): GET/POST/DELETE /api/onboarding/:schemaId with CAS confirm and cancel"
```

### Task 12: POST /api/onboarding/[schemaId]/retry

**Files:**
- Create: `apps/web/src/app/api/onboarding/[schemaId]/retry/route.ts`

- [ ] **Step 1: Implement retry route**

```typescript
// apps/web/src/app/api/onboarding/[schemaId]/retry/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";

function extractSchemaId(url: string): string | null {
  const m = url.match(/\/api\/onboarding\/([^/?]+)\/retry/);
  return m?.[1] ?? null;
}

/**
 * POST /api/onboarding/:schemaId/retry
 *
 * Clears the FAILED state and re-emits onboarding.session.started so the
 * workflow resumes from wherever it failed. Each step's CAS-on-phase check
 * ensures already-completed steps are skipped.
 */
export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemaId(request.url);
    if (!schemaId) return NextResponse.json({ error: "schemaId required" }, { status: 400 });

    const schema = await prisma.caseSchema.findUnique({ where: { id: schemaId } });
    if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (schema.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (schema.phase !== "FAILED") {
      return NextResponse.json(
        { error: `Cannot retry from phase ${schema.phase}` },
        { status: 409 },
      );
    }

    // Determine where to resume from by inspecting what's already done
    // Simplest approach: clear FAILED and reset to the last non-failed phase.
    // For v1 we clear to PENDING and let each step's idempotency skip.
    await prisma.caseSchema.update({
      where: { id: schemaId },
      data: {
        phase: "PENDING",
        phaseError: null,
        phaseErrorAt: null,
        phaseUpdatedAt: new Date(),
      },
    });

    await inngest.send({
      name: "onboarding.session.started",
      data: { schemaId, userId },
    });

    logger.info({
      service: "onboarding",
      operation: "retry",
      userId,
      schemaId,
    });

    return NextResponse.json({ data: { schemaId, status: "retrying" } });
  } catch (error) {
    return handleApiError(error, { service: "onboarding", operation: "retry", userId });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/api/onboarding/[schemaId]/retry/route.ts
git commit -m "feat(api): POST /api/onboarding/:schemaId/retry re-emits workflow event"
```

### Task 13: Scan management routes

**Files:**
- Create: `apps/web/src/app/api/schemas/[id]/scans/route.ts`
- Create: `apps/web/src/app/api/schemas/[id]/scans/[scanJobId]/route.ts`

- [ ] **Step 1: Implement list + create-manual-rescan**

```typescript
// apps/web/src/app/api/schemas/[id]/scans/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { computeScanMetrics } from "@/lib/services/scan-metrics";

function extractSchemaId(url: string): string | null {
  const m = url.match(/\/api\/schemas\/([^/?]+)\/scans/);
  return m?.[1] ?? null;
}

// GET — list recent scans for a schema (audit log)
export const GET = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemaId(request.url);
    if (!schemaId) return NextResponse.json({ error: "schemaId required" }, { status: 400 });

    const schema = await prisma.caseSchema.findUnique({ where: { id: schemaId } });
    if (!schema || schema.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scans = await prisma.scanJob.findMany({
      where: { schemaId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Attach computed metrics
    const withMetrics = await Promise.all(
      scans.map(async (s) => ({
        ...s,
        metrics: await computeScanMetrics(s.id),
      })),
    );

    return NextResponse.json({ data: withMetrics });
  } catch (error) {
    return handleApiError(error, { service: "scans", operation: "list", userId });
  }
});

// POST — manual rescan (creates a new ScanJob and fires runScan)
export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemaId(request.url);
    if (!schemaId) return NextResponse.json({ error: "schemaId required" }, { status: 400 });

    const schema = await prisma.caseSchema.findUnique({ where: { id: schemaId } });
    if (!schema || schema.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Conflict: an active scan already exists
    const activeScan = await prisma.scanJob.findFirst({
      where: { schemaId, status: { in: ["PENDING", "RUNNING"] } },
    });
    if (activeScan) {
      return NextResponse.json(
        {
          error: "Scan already in progress",
          code: 409,
          type: "CONFLICT",
          data: { scanJobId: activeScan.id },
        },
        { status: 409 },
      );
    }

    const scan = await prisma.scanJob.create({
      data: {
        schemaId,
        userId,
        status: "PENDING",
        phase: "PENDING",
        triggeredBy: "MANUAL",
        totalEmails: 0,
      },
    });

    await inngest.send({
      name: "scan.requested",
      data: { scanJobId: scan.id, schemaId, userId },
    });

    return NextResponse.json({ data: { scanJobId: scan.id } }, { status: 202 });
  } catch (error) {
    return handleApiError(error, { service: "scans", operation: "manual-rescan", userId });
  }
});
```

- [ ] **Step 2: Implement per-scan detail route**

```typescript
// apps/web/src/app/api/schemas/[id]/scans/[scanJobId]/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { computeScanMetrics } from "@/lib/services/scan-metrics";

function extractIds(url: string): { schemaId: string; scanJobId: string } | null {
  const m = url.match(/\/api\/schemas\/([^/?]+)\/scans\/([^/?]+)/);
  if (!m) return null;
  return { schemaId: m[1], scanJobId: m[2] };
}

export const GET = withAuth(async ({ userId, request }) => {
  try {
    const ids = extractIds(request.url);
    if (!ids) return NextResponse.json({ error: "ids required" }, { status: 400 });

    const scan = await prisma.scanJob.findUnique({
      where: { id: ids.scanJobId },
      include: {
        schema: { select: { userId: true } },
        failures: { take: 50, orderBy: { createdAt: "desc" } },
      },
    });
    if (!scan || scan.schemaId !== ids.schemaId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (scan.schema.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const metrics = await computeScanMetrics(scan.id);
    return NextResponse.json({ data: { ...scan, metrics } });
  } catch (error) {
    return handleApiError(error, { service: "scans", operation: "detail", userId });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/schemas/
git commit -m "feat(api): schema scan list + manual rescan + per-scan detail routes"
```

---

## Phase 8: Client flow collapse

### Task 14: Create OnboardingFlow switch component

**Files:**
- Create: `apps/web/src/components/onboarding/flow.tsx`
- Create: `apps/web/src/components/onboarding/phase-*.tsx` (one file per phase)
- Create: `apps/web/src/app/onboarding/[schemaId]/page.tsx`

- [ ] **Step 1: Create the phase component files**

For each phase, create a small component. Example for extracting (the richest one):

```typescript
// apps/web/src/components/onboarding/phase-extracting.tsx
"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

interface Props {
  response: OnboardingPollingResponse;
}

export function PhaseExtracting({ response }: Props) {
  const { progress, recentDiscoveries } = response;
  const total = progress.emailsTotal ?? 0;
  const processed = progress.emailsProcessed ?? 0;
  const percent = total > 0 ? Math.min(95, Math.round((processed / total) * 100)) : 20;

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <h1 className="font-serif text-2xl text-primary text-center">Reading your emails</h1>
      <div className="w-full h-2 bg-surface-highest rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      {total > 0 && (
        <p className="text-sm text-secondary">
          {processed} of {total} emails
        </p>
      )}
      {recentDiscoveries?.entities && recentDiscoveries.entities.length > 0 && (
        <div className="flex flex-col gap-1 max-w-sm">
          {recentDiscoveries.entities.slice(0, 10).map((e) => (
            <p key={e.name} className="text-sm text-secondary animate-fadeIn">
              <span className="text-accent mr-2">&rarr;</span>
              {e.name}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
```

Create similar simple components for: `phase-pending.tsx`, `phase-generating.tsx`, `phase-finalizing.tsx`, `phase-discovering.tsx`, `phase-clustering.tsx`, `phase-synthesizing.tsx`, `phase-no-emails.tsx`, `phase-failed.tsx`. Each ~30 lines, takes the same `Props { response }` and renders the matching message.

For `phase-review.tsx`, lift the content from the current `apps/web/src/app/onboarding/review/page.tsx` (entity toggles, topic name input, finalize button). It should POST to `/api/onboarding/:schemaId` instead of `/api/interview/review-finalize`.

- [ ] **Step 2: Create the flow switch component**

```typescript
// apps/web/src/components/onboarding/flow.tsx
"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";
import { PhasePending } from "./phase-pending";
import { PhaseGenerating } from "./phase-generating";
import { PhaseFinalizing } from "./phase-finalizing";
import { PhaseDiscovering } from "./phase-discovering";
import { PhaseExtracting } from "./phase-extracting";
import { PhaseClustering } from "./phase-clustering";
import { PhaseSynthesizing } from "./phase-synthesizing";
import { PhaseReview } from "./phase-review";
import { PhaseNoEmails } from "./phase-no-emails";
import { PhaseFailed } from "./phase-failed";

export function OnboardingFlow({ response }: { response: OnboardingPollingResponse }) {
  switch (response.phase) {
    case "PENDING":                return <PhasePending response={response} />;
    case "GENERATING_HYPOTHESIS":  return <PhaseGenerating response={response} />;
    case "FINALIZING_SCHEMA":      return <PhaseFinalizing response={response} />;
    case "DISCOVERING":            return <PhaseDiscovering response={response} />;
    case "EXTRACTING":             return <PhaseExtracting response={response} />;
    case "CLUSTERING":             return <PhaseClustering response={response} />;
    case "SYNTHESIZING":           return <PhaseSynthesizing response={response} />;
    case "AWAITING_REVIEW":        return <PhaseReview response={response} />;
    case "NO_EMAILS_FOUND":        return <PhaseNoEmails response={response} />;
    case "FAILED":                 return <PhaseFailed response={response} />;
    case "COMPLETED":              return null; // page handles redirect
  }
}
```

- [ ] **Step 3: Create the observer page**

```typescript
// apps/web/src/app/onboarding/[schemaId]/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/flow";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { createBrowserClient } from "@/lib/supabase/client";
import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

export default function OnboardingObserverPage() {
  const router = useRouter();
  const params = useParams<{ schemaId: string }>();
  const schemaId = params.schemaId;
  const [response, setResponse] = useState<OnboardingPollingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const supabase = createBrowserClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setError("Not authenticated"); return; }

        const res = await fetch(`/api/onboarding/${schemaId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.status === 404) { setError("Onboarding session not found"); return; }
        if (res.status === 403) { setError("Forbidden"); return; }
        if (!res.ok) return; // transient, retry next tick

        const data: OnboardingPollingResponse = await res.json();
        if (cancelled) return;
        setResponse(data);

        if (data.phase === "COMPLETED" && data.nextHref) {
          router.push(data.nextHref);
        }
      } catch {
        // silent retry on next tick
      }
    }

    poll(); // immediate first fetch
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [schemaId, router]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <p className="text-overdue">{error}</p>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <OnboardingProgress currentStep={3} totalSteps={5} />
      <div className="flex flex-1 flex-col items-center justify-center w-full max-w-md mx-auto">
        <OnboardingFlow response={response} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update connect page to POST to /api/onboarding/start with a client-generated id**

```typescript
// Modify apps/web/src/app/onboarding/connect/page.tsx

// Add ulid generator
import { ulid } from "ulid";  // if not installed: pnpm --filter web add ulid

// Replace the hypothesis POST effect with:
useEffect(() => {
  if (status !== "connected") return;
  if (hypothesisCalledRef.current) return;
  hypothesisCalledRef.current = true;

  const category = onboardingStorage.getCategory();
  const names = onboardingStorage.getNames();
  if (!category || !names) return;

  setStatus("generating");

  const schemaId = onboardingStorage.getSchemaId() ?? ulid();
  onboardingStorage.setSchemaId(schemaId);

  const supabase = createBrowserClient();
  supabase.auth
    .getSession()
    .then(({ data: { session } }) => {
      if (!session) throw new Error("No session");
      return fetch("/api/onboarding/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          schemaId,
          inputs: {
            role: category.role,
            domain: category.domain,
            whats: names.whats,
            whos: names.whos,
            customDescription: category.customDescription,
          },
        }),
      });
    })
    .then(async (res) => {
      if (!res.ok) throw new Error(`start failed: ${res.status}`);
      return res.json();
    })
    .then(() => {
      router.push(`/onboarding/${schemaId}`);
    })
    .catch((err: unknown) => {
      hypothesisCalledRef.current = false;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    });
}, [status, router]);
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/onboarding/ apps/web/src/app/onboarding/[schemaId]/ apps/web/src/app/onboarding/connect/
git commit -m "feat(onboarding): observer page with flow switch and phase components"
```

---

## Phase 9: Delete dead code

### Task 15: Remove old routes and pages

**Files:**
- Delete: `apps/web/src/app/api/interview/hypothesis/route.ts`
- Delete: `apps/web/src/app/api/interview/finalize/route.ts`
- Delete: `apps/web/src/app/api/interview/validate/route.ts`
- Delete: `apps/web/src/app/api/interview/review-finalize/route.ts`
- Delete: `apps/web/src/app/api/schemas/[schemaId]/status/route.ts` (replaced by /api/onboarding/:id)
- Delete: `apps/web/src/app/onboarding/scanning/page.tsx`
- Delete: `apps/web/src/app/onboarding/review/page.tsx`
- Delete: `apps/web/src/components/onboarding/scan-stream.tsx`

- [ ] **Step 1: Delete files**

```bash
rm apps/web/src/app/api/interview/hypothesis/route.ts
rm apps/web/src/app/api/interview/finalize/route.ts
rm apps/web/src/app/api/interview/validate/route.ts
rm apps/web/src/app/api/interview/review-finalize/route.ts
rm apps/web/src/app/api/schemas/[schemaId]/status/route.ts
rm apps/web/src/app/onboarding/scanning/page.tsx
rm apps/web/src/app/onboarding/review/page.tsx
rm apps/web/src/components/onboarding/scan-stream.tsx
```

- [ ] **Step 2: Also delete empty parent dirs**

```bash
rmdir apps/web/src/app/api/interview/hypothesis || true
rmdir apps/web/src/app/api/interview/finalize || true
rmdir apps/web/src/app/api/interview/validate || true
rmdir apps/web/src/app/api/interview/review-finalize || true
rmdir apps/web/src/app/api/interview || true
rmdir apps/web/src/app/api/schemas/[schemaId]/status || true
rmdir apps/web/src/app/onboarding/scanning || true
rmdir apps/web/src/app/onboarding/review || true
```

- [ ] **Step 3: Run typecheck — fix any broken imports**

```bash
pnpm --filter web tsc --noEmit
```

Expected: any remaining errors are import references to the deleted files. Fix them by either removing the import or pointing at the new equivalent.

- [ ] **Step 4: Run all tests**

```bash
pnpm -r test
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete old interview routes and onboarding pages"
```

---

## Phase 10: Integration tests

### Task 16: End-to-end integration tests

**Files:**
- Create: `apps/web/tests/integration/onboarding-happy-path.test.ts`
- Create: `apps/web/tests/integration/onboarding-resume.test.ts`
- Create: `apps/web/tests/integration/onboarding-concurrent-start.test.ts`
- Create: `apps/web/tests/integration/onboarding-no-emails.test.ts`
- Create: `apps/web/tests/integration/scan-accounting.test.ts`

- [ ] **Step 1: Write happy path test**

```typescript
// apps/web/tests/integration/onboarding-happy-path.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { ulid } from "ulid";

describe("onboarding happy path (integration)", () => {
  const testUserId = "test-happy-" + ulid();

  beforeEach(async () => {
    await prisma.caseSchema.deleteMany({ where: { userId: testUserId } });
  });

  it("creates schema, runs workflow, ends at AWAITING_REVIEW", async () => {
    const schemaId = ulid();

    // Step 1: POST /api/onboarding/start (simulated inline)
    // Since this is an integration test, call the route handler directly
    // via the request shape or call the underlying createSchemaStub + emit.

    const response = await fetch("http://localhost:3000/api/onboarding/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user-id": testUserId, // test-only auth bypass
      },
      body: JSON.stringify({
        schemaId,
        inputs: {
          domain: "school_parent",
          whats: ["My Kid School"],
          whos: [],
        },
      }),
    });
    expect(response.status).toBe(202);

    // Wait for workflow to advance (poll the GET endpoint)
    let phase = "PENDING";
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const res = await fetch(`http://localhost:3000/api/onboarding/${schemaId}`, {
        headers: { "x-test-user-id": testUserId },
      });
      const data = await res.json();
      phase = data.phase;
      if (["AWAITING_REVIEW", "NO_EMAILS_FOUND", "FAILED"].includes(phase)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    expect(phase).toBe("AWAITING_REVIEW");
  }, 90_000);
});
```

- [ ] **Step 2: Write resume-after-interrupt test**

```typescript
// apps/web/tests/integration/onboarding-resume.test.ts
describe("onboarding resume after simulated crash", () => {
  it("re-runs workflow from PENDING, advancePhase skips completed steps", async () => {
    const schemaId = ulid();
    // manually seed a CaseSchema already past PENDING
    await prisma.caseSchema.create({
      data: {
        id: schemaId,
        userId: "test-resume",
        name: "mid-flight",
        status: "DRAFT",
        phase: "FINALIZING_SCHEMA",
        inputs: { domain: "school_parent", whats: ["School"], whos: [] } as any,
        hypothesis: { /* pre-seed */ } as any,
      },
    });

    // Re-emit the workflow event — steps 1 and 2 should "skip" cleanly
    await inngest.send({
      name: "onboarding.session.started",
      data: { schemaId, userId: "test-resume" },
    });

    // Assert phase advances past FINALIZING_SCHEMA without the workflow
    // re-running generate-hypothesis or re-creating relations
    // ...
  });
});
```

- [ ] **Step 3: Write concurrent start test**

```typescript
// apps/web/tests/integration/onboarding-concurrent-start.test.ts
describe("concurrent POST /api/onboarding/start with same id", () => {
  it("produces exactly one schema row and one workflow run", async () => {
    const schemaId = ulid();
    const body = JSON.stringify({
      schemaId,
      inputs: { domain: "school_parent", whats: ["x"], whos: [] },
    });
    const headers = { "Content-Type": "application/json", "x-test-user-id": "test-conc" };

    const [r1, r2, r3] = await Promise.all([
      fetch("http://localhost:3000/api/onboarding/start", { method: "POST", headers, body }),
      fetch("http://localhost:3000/api/onboarding/start", { method: "POST", headers, body }),
      fetch("http://localhost:3000/api/onboarding/start", { method: "POST", headers, body }),
    ]);

    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(r3.status).toBe(202);

    const rows = await prisma.caseSchema.count({ where: { id: schemaId } });
    expect(rows).toBe(1);
  });
});
```

- [ ] **Step 4: Write scan-accounting invariant test**

```typescript
// apps/web/tests/integration/scan-accounting.test.ts
import { computeScanMetrics } from "@/lib/services/scan-metrics";

describe("scan accounting invariant", () => {
  it("processedEmails + excludedEmails + failedEmails == totalEmails after complete scan", async () => {
    // Run a complete onboarding against a seeded Gmail test fixture of 50 emails
    // ... trigger scan, wait for completion ...

    const metrics = await computeScanMetrics(scanJobId);
    const accounted = metrics.processedEmails + metrics.excludedEmails + metrics.failedEmails;
    expect(accounted).toBe(metrics.totalEmails);
  });
});
```

- [ ] **Step 5: Run the integration test suite**

```bash
pnpm --filter web test:integration
```

Expected: all passing (requires dev server running + mocked AI).

- [ ] **Step 6: Commit**

```bash
git add apps/web/tests/integration/
git commit -m "test(integration): onboarding state machine happy path, resume, concurrent, accounting"
```

---

## Phase 11: Cron stub + final verification

### Task 17: Add cron stub

**Files:**
- Create: `apps/web/src/lib/inngest/cron.ts`

- [ ] **Step 1: Create the stub**

```typescript
// apps/web/src/lib/inngest/cron.ts
import { inngest } from "./client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Daily cron scan emitter. STUBBED — not scheduled on any cron trigger yet.
 * Exists to prove the architecture: when we want to enable it, change the
 * trigger to `{ cron: "0 6 * * *" }` and the rest works.
 */
export const cronDailyScans = inngest.createFunction(
  {
    id: "cron-daily-scans",
    triggers: [{ event: "cron.daily.scans.trigger" }], // manual trigger for now
  },
  async ({ step }) => {
    const schemas = await step.run("load-active-schemas", async () => {
      return prisma.caseSchema.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, userId: true },
      });
    });

    logger.info({
      service: "cron",
      operation: "cronDailyScans",
      schemaCount: schemas.length,
    });

    for (const schema of schemas) {
      await step.run(`emit-scan-${schema.id}`, async () => {
        // Skip if active scan already running
        const active = await prisma.scanJob.findFirst({
          where: { schemaId: schema.id, status: { in: ["PENDING", "RUNNING"] } },
        });
        if (active) return;

        const scan = await prisma.scanJob.create({
          data: {
            schemaId: schema.id,
            userId: schema.userId,
            status: "PENDING",
            phase: "PENDING",
            triggeredBy: "CRON_DAILY",
            totalEmails: 0,
          },
        });
        await inngest.send({
          name: "scan.requested",
          data: { scanJobId: scan.id, schemaId: schema.id, userId: schema.userId },
        });
      });
    }
  },
);
```

- [ ] **Step 2: Export from functions**

```typescript
// apps/web/src/lib/inngest/functions.ts
import { cronDailyScans } from "./cron";

export const functions = [
  // ...existing...
  cronDailyScans,
];
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/inngest/cron.ts apps/web/src/lib/inngest/functions.ts
git commit -m "feat(inngest): daily cron scan stub (event-triggered, not scheduled)"
```

### Task 18: Full verification + status doc update

- [ ] **Step 1: Run full typecheck**

```bash
pnpm typecheck
```

Expected: clean across all packages.

- [ ] **Step 2: Run full unit test suite**

```bash
pnpm -r test
```

Expected: all passing.

- [ ] **Step 3: Run integration tests**

```bash
pnpm --filter web test:integration
```

Expected: all passing.

- [ ] **Step 4: Manual smoke test**

1. Wipe DB via `/supabase-db` skill
2. Start dev server: `pnpm --filter web dev`
3. Start Inngest dev: `npx inngest-cli@latest dev`
4. Complete fresh onboarding flow in browser
5. Verify: URL becomes `/onboarding/[schemaId]`, phases progress observably, lands on AWAITING_REVIEW, confirm → /feed
6. Mid-flow, hit refresh during EXTRACTING — verify page re-renders at the same phase, no duplicate scans created
7. Verify in DB: exactly one CaseSchema row, exactly one ScanJob row with triggeredBy=ONBOARDING

- [ ] **Step 5: Update status doc**

Add to `docs/00_denim_current_status.md` under a new section:

```markdown
## Onboarding State Machine Refactor (2026-04-07 → TBD)

Full architectural rewrite of the onboarding flow (plan: `docs/superpowers/plans/2026-04-07-onboarding-state-machine.md`).

**What changed:**
- `CaseSchema` is the workflow handle — client-supplied id, new `phase` enum for onboarding state
- `ScanJob` is first-class, reusable across triggers (onboarding/cron/manual/feedback)
- All counter fields dropped; metrics computed on demand via `computeScanMetrics` / `computeSchemaMetrics`
- New `ScanFailure` table for per-email failures
- Two parent Inngest workflows: `runOnboarding` (front half + review handoff) + `runScan` (discovery + pipeline)
- New routes: `POST /api/onboarding/start`, `GET/POST/DELETE /api/onboarding/:id`, `POST /api/onboarding/:id/retry`, `GET/POST /api/schemas/:id/scans`
- Old routes deleted: `/api/interview/*`, `/api/schemas/:id/status`
- `/onboarding/[schemaId]` observer page collapses scanning + review into one switch-rendered flow
- CAS-on-phase for every state transition (no two-writer problems)

**Resolves eval issues:** #14 (idempotency via client-supplied id + CAS), #15 (polling observer replaces slow timer), #16 (accounting is structural, no counters to drift), #17 (flat polling response, no shape mismatch), #18 (schemaId in URL from millisecond zero).
```

- [ ] **Step 6: Final commit**

```bash
git add docs/00_denim_current_status.md
git commit -m "docs(status): onboarding state machine refactor complete"
```

---

## Self-review checklist

Before declaring the plan done, verify:

- [ ] Every dropped counter field has a compute-on-demand replacement and every reader is updated
- [ ] Every phase transition in both state machines is covered by a test
- [ ] Every route handler has ownership verification (userId check)
- [ ] Every Inngest function has explicit `retries: 0` + `cancelOn` (onboarding only) + concurrency keys
- [ ] CAS helpers are the only code path that writes `.phase` columns (single writer)
- [ ] Integration tests cover: happy path, resume mid-flow, concurrent start, no-emails terminal, scan accounting invariant
- [ ] Old `/api/interview/*` routes are fully deleted
- [ ] `/onboarding/scanning` and `/onboarding/review` page files are deleted
- [ ] `scan-stream.tsx` is deleted
- [ ] The plan file produces a working system at every commit boundary (no "half-finished" intermediate states)
