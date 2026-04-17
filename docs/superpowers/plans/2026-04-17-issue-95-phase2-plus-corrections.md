# Issue #95 Plan — Phase 2+ Corrections (2026-04-17)

**Purpose:** Patch list for `docs/superpowers/plans/2026-04-16-issue-95-fast-discovery-rebuild.md` before any Phase 2+ code is written. All corrections bring plan samples back in line with the codebase conventions already used by Phase 0/1 (commits `0f3e991`..`96ff38d`).

**How to use:** Go through each correction in order; apply to the plan file; commit once.

**Source of findings:** 3 parallel subagent audits on 2026-04-17.

**Counts:** 18 Critical, 19 Medium, 6 Nit.

---

## Guiding principle

Phase 0/1 did **not** rename existing code. The plan was originally drafted with fictional names/signatures (e.g., `STAGE2_TUNABLES`, `isGmailAuthError`, 3-arg `createFunction`) that were never in the codebase. Phase 0/1 correctly adopted the real conventions. Every correction below updates the plan's Phase 2+ samples to match what Phase 0/1 already uses and what the rest of the codebase has used since day one.

---

## Phase 2 — Stage 2 Entity Discovery

### Task 2.1 — Levenshtein dedup (lines 1396–1554)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P2-1 | 1482 | `import { STAGE2_TUNABLES } from "@/lib/config/onboarding-tunables"` | `import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables"` | Critical |
| P2-2 | 1503–1504 | `STAGE2_TUNABLES.levenshteinShortThreshold` / `.levenshteinLongThreshold` | `ONBOARDING_TUNABLES.stage2.levenshteinShortThreshold` / `ONBOARDING_TUNABLES.stage2.levenshteinLongThreshold` | Critical |

### Task 2.2 — Property entity (lines 1556–1770)

Largely clean — already uses `ONBOARDING_TUNABLES.stage2.topNEntities` correctly. No corrections.

### Task 2.3 — School entity (lines 1771–2014)

Clean. No corrections.

### Task 2.4 — Agency entity (lines 2015–2184)

Clean. No corrections.

### Task 2.5 — Stage 2 dispatcher + Inngest wrapper (lines 2185–2551)

This task has the heaviest drift. Apply all corrections below as a group.

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P2-3 | 2253 | `import { STAGE2_TUNABLES } from "@/lib/config/onboarding-tunables"` | `import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables"` | Critical |
| P2-4 | 2286–2292 | `STAGE2_TUNABLES.lookbackDays`, `STAGE2_TUNABLES.maxMessagesPerDomain`, `STAGE2_TUNABLES.fetchBatchSize` | `ONBOARDING_TUNABLES.stage1.lookbackDays`, `ONBOARDING_TUNABLES.stage2.maxMessagesPerDomain`, `ONBOARDING_TUNABLES.stage1.fetchBatchSize` (per the file-level comment, Stage 2 reuses `stage1.lookbackDays` and `stage1.fetchBatchSize`) | Critical |
| P2-5 | 2287, 2202, 2226 | `client.searchEmails(q, N)` returning string IDs; `gmailClient.searchEmails` in tests returning `["1","2"]` | `client.listMessageIds(q, N)` returning `Promise<string[]>` (added in Task 1.2, commit `d383de6`). `searchEmails` returns `GmailMessageMeta[]`, not IDs — wrong method. Update dispatcher call site + all Task 2.5 test mocks. | Critical |
| P2-6 | 2418 | `import { isGmailAuthError } from "@/lib/gmail/auth-errors"` | `import { matchesGmailAuthError } from "@/lib/gmail/auth-errors"` (the actual exported name, used by `domain-discovery-fn.ts` line 12) | Critical |
| P2-7 | 2439–2451 | 3-arg `inngest.createFunction({config}, { event: "..." }, async handler)` | 2-arg `inngest.createFunction({ id, triggers: [{ event: "..." }], cancelOn, concurrency, retries }, async handler)` — match `runDomainDiscovery` (commit `96ff38d`) | Critical |
| P2-8 | 2519 | `advanceSchemaPhase(schemaId, "DISCOVERING_ENTITIES", "AWAITING_ENTITY_CONFIRMATION")` — positional args | `advanceSchemaPhase({ schemaId, from: "DISCOVERING_ENTITIES", to: "AWAITING_ENTITY_CONFIRMATION", work: async () => { ... } })` — opts object with `work` callback; returns `work()` result or `"skipped"` | Critical |
| P2-9 | 2527 | `markSchemaFailed(schemaId, errorMessage)` — 2 args | `markSchemaFailed(schemaId, phaseAtFailure, error)` — 3 args including the phase the schema was in when it failed | Critical |
| P2-10 | Task 2.5 (implicit) | Fires `onboarding.entity-discovery.requested` but never adds it to `DenimEvents` | Add explicit sub-step: extend `packages/types/src/events.ts` — add `"onboarding.entity-discovery.requested": { data: { schemaId: string; userId: string } }` to `DenimEvents` union. Required for `inngest.send` typecheck. Mirror how `onboarding.domain-discovery.requested` was registered. | Critical |
| P2-11 | 2542, 2546 | "Register `runEntityDiscovery` in the Inngest serve config" — `git add apps/web/src/app/api/inngest/route.ts` | Register in `apps/web/src/lib/inngest/functions.ts` (the array exported to `serve`) — route.ts imports that array and passes it to `serve`. Matches where `runDomainDiscovery` is registered. | Critical |
| P2-12 | Task 2.5 Step 5 (Prisma ADD COLUMN) | `ALTER TABLE case_schemas ADD COLUMN stage2Candidates jsonb, ADD COLUMN stage2ConfirmedDomains jsonb` | **Drop this step entirely.** Columns already exist in `schema.prisma` lines 168–169 (added in commit `96ff38d`, Task 1.6b). | Critical |
| P2-13 | 2316–2371 | Dispatcher `switch(algorithm)` has no `default` | Add exhaustiveness check: `default: { const _x: never = algorithm; throw new Error(...) }` | Medium |
| P2-14 | 2474–2508 | `step.run("discover-${confirmedDomain}", ...)` uses raw domain as id (may contain `.`) | Slugify the id (`confirmedDomain.replace(/[^a-z0-9]/gi, "-")`) to keep Inngest dashboard readable | Medium |

---

## Phase 3 — Review Screen UX

### Task 3.1 — POST `/domain-confirm` route (lines 2554–2740)

Route body is clean. **Test mocks need full rewrite.** These are IDOR-class — same shape as issue #99.

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P3-1 | 2672–2681 | Mocks `withAuth` as `(handler) => (req, ctx) => handler(req, { ...ctx, user: { id: "user-1" } })` — 2-arg handler with `user` + `ctx.params` | `withAuth(handler)` is a single-arg wrapper returning `async (request: NextRequest) => ...` and calling `handler({ userId, request })`. Mock must be: `(handler) => async (request) => handler({ userId: "user-1", request })`. See `apps/web/src/lib/middleware/auth.ts:19-20`. | Critical |
| P3-2 | 2696, 2702–2705 | Calls `POST(request, { params: Promise.resolve({ schemaId: "s" }) })` — 2-arg | Real POST reads `schemaId` via `extractOnboardingSchemaId(request)` which parses the URL pathname segment. Tests must build `new Request("http://x/api/onboarding/<schemaId>/domain-confirm", ...)` with the full path; invoke as `POST(request)` — single arg. | Critical |
| P3-3 | 2664–2671 | Mocks `prisma.$transaction` inline but never mocks `writeStage2ConfirmedDomains` | Add `vi.mock("@/lib/services/interview", ...)` stub for `writeStage2ConfirmedDomains` — otherwise route calls real impl against the fake `tx` client → NPE | Critical |

### Task 3.2 — POST `/entity-confirm` route (lines 2741–2929)

Route body clean. Tests inherit P3-1, P3-2, P3-3 — apply same three corrections to Task 3.2 test.

### Task 3.3 — GET polling extension (lines 2930–2979)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P3-4 | 2940–2963 | Adds `stage1Candidates` etc. to response by appending assignments to `resp` | (a) Extend `OnboardingPhase` union in `apps/web/src/lib/services/onboarding-polling.ts:15–25` with the 4 new phase values (`DISCOVERING_DOMAINS`, `AWAITING_DOMAIN_CONFIRMATION`, `DISCOVERING_ENTITIES`, `AWAITING_ENTITY_CONFIRMATION`). (b) Add explicit branches returning a new object literal per branch — function uses if/return chains, not a mutable `resp`. Without this, unknown phases fall through to `PENDING` and masks the new UI entirely. | Medium |

### Task 3.3b — drain extension (lines 2980–3047)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P3-5 | Entire task | Add `OUTBOX_EMITTERS` registry + `isOutboxEventName` allowlist | **Task is a no-op — delete it.** `apps/web/src/lib/inngest/onboarding-outbox-drain.ts` is already event-generic (sends `{ name: row.eventName, data: row.payload }`). File-level comment explicitly says "adding a new lifecycle event means writing a new outbox row from a new producer — no drain change needed." | Medium |
| P3-6 | 2989, 3046 | Path `drain-onboarding-outbox.ts` | Real filename: `onboarding-outbox-drain.ts`. If Task 3.3b retained for any verification-only reason, fix path. | Medium |

### Task 3.4–3.6 — components + flow dispatch (lines 3048–3473)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P3-7 | 3440–3462 | `flow.tsx` uses `pollingData` + passes `refresh` callback to `PhasePending` | Real prop is `response: OnboardingPollingResponse`; no `refresh` callback is threaded through (polling owns refresh at parent). Update variable name + drop `refresh` plumbing. | Nit/Medium |

---

## Phase 4 — Pipeline Cutover

### Task 4.1 — rewrite `runOnboarding` (lines 3478–3535)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P4-1 | 3488–3517 | 3-arg `inngest.createFunction({config}, { event: "onboarding.session.started" }, async handler)` | 2-arg `createFunction({ id, triggers: [{event: "onboarding.session.started"}], cancelOn, concurrency, retries }, async handler)` — match current `runOnboarding` at `apps/web/src/lib/inngest/onboarding.ts:49–64`. **Critically, keep the existing `cancelOn` and `concurrency: { key: "event.data.userId" }` — plan drops both.** | Critical |
| P4-2 | 3497 | `const schemaId: string = event.data.schemaId;` — drops `userId` | `const { schemaId, userId } = event.data;` — `userId` needed downstream for Gmail token load | Critical |
| P4-3 | 3512 | Emitted `onboarding.domain-discovery.requested` payload omits `userId` | Include `userId` in payload: `{ name: "onboarding.domain-discovery.requested", data: { schemaId, userId } }` | Critical |
| P4-4 | 3502 | `select: { id: true, phase: true, domain: true }` + `throw if (!schema.domain)` | The check is correct IF `domain` is populated at stub-creation time. Currently `createSchemaStub` (interview.ts:329–365) does NOT set `domain`. Task 4.4 must wire `domain` into the stub caller BEFORE Task 4.1's check can succeed. Without this fix, every new onboarding throws "Schema missing domain". | Critical |

### Task 4.2 — trim `runOnboardingPipeline` (lines 3536–3595)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P4-5 | 3563 | Grep for `advanceSchemaPhase` expecting `AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN` call to delete | No such call exists. The `AWAITING_REVIEW → PROCESSING_SCAN` advance happens inside `create-scan-job` step (onboarding.ts:592–624) via `advanceSchemaPhase({from:"AWAITING_REVIEW", to:"PROCESSING_SCAN"})`. Rewrite Task 4.2 Step 2: change `from: "AWAITING_REVIEW"` → `from: "AWAITING_ENTITY_CONFIRMATION"` in `create-scan-job`. | Medium |
| P4-6 | 3568–3582 | Terminal `PROCESSING_SCAN → COMPLETED` step uses `tx.caseSchema.update` | `advance-to-completed` (onboarding.ts:714–725) uses `advanceSchemaPhase({ work: async () => { await prisma.caseSchema.update(...) } })` — there is no `tx` in scope. Use `prisma.caseSchema.update` in the snippet. | Medium |

### Task 4.3 — old POST redirect (lines 3596–3622)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P4-7 | 3601–3611 | Bare `export async function POST() { return NextResponse.json(..., 410) }` | Current `POST = withAuth(async ({userId, request}) => ...)` includes `#33` idempotency (returns 200 `already-confirmed` for stale retries). Returning 410 for those would break in-flight retries. Keep the `withAuth` wrapper and short-circuit with 410 only for phases that don't match the old flow; return 200 `already-confirmed` if schema is already in a new-flow phase. | Medium |

### Task 4.4 — skinny `createSchemaStub` (lines 3623–3645)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P4-8 | 3628–3634 | "Remove any code that pre-fills `hypothesis` / `validation` / `primaryEntityConfig`. New stub sets only `phase = PENDING`, `inputs`, `domain`." | Current stub (interview.ts:329–365) already doesn't set `hypothesis`/`validation`. It DOES set placeholders for `name`, `description`, `primaryEntityConfig:{}`, `discoveryQueries:[]`, `summaryLabels:{}`, `clusteringConfig:{}`, `extractionPrompt:""`, `synthesisPrompt:""`, `status:"DRAFT"` — these exist because those columns are likely NOT NULL. Before removing, verify each column's nullability in `schema.prisma`; any NOT NULL column must either stay defaulted in the stub or be migrated to nullable. **Separately, Task 4.4 must add `domain: inputs.domain` to the stub write** — closes the gap P4-4 depends on. | Medium |

### Task 4.4c — Inngest endpoint signing (lines 3671–3715)

Clean — plan correctly anticipates a real change. `apps/web/src/app/api/inngest/route.ts` currently has `serve({ client: inngest, functions })` with no `signingKey`. This is a genuine mandatory step, not a verification-only check. No plan edit needed.

---

## Phase 5 — Spec files as YAML runtime config

### Task 5.0 (lines 3763–3864)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P5-1 | 3802 + 4068 | Imports `yaml from "js-yaml"` but no install step in Task 5.0 | Add Step: `pnpm --filter web add js-yaml && pnpm --filter web add -D @types/js-yaml` at top of Task 5.0 | Medium |
| P5-2 | 3798–3836 | Rewrites `domain-shapes.ts` to `readFileSync` YAML at module load | Explicitly note this **deletes** the hardcoded `DOMAIN_SHAPES` Record that landed in commit `e3242be`. Not coexistence — wholesale replacement. Tests from Task 0.3 continue to pass because YAML keyword counts match the TS values. | Medium |
| P5-3 | 3818 | `path.resolve(process.cwd(), "../../docs/...")` | Plan already flags Vercel cwd fragility in Step 7. Add deployment verification as hard gate: first preview must smoke-test the YAML load, with fallback to build-step JSON if cwd differs on Vercel. | Medium |

---

## Phase 6 — Cleanup

### Task 6.3 — remove `GENERATING_HYPOTHESIS` (lines 4410–4455)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P6-1 | Entire task | Plan modifies only `schema.prisma` and leaves the enum value in place | **Blast radius is 18 files.** Grep `GENERATING_HYPOTHESIS` finds references in: `packages/types/src/events.ts`, `apps/web/src/lib/inngest/onboarding.ts`, `apps/web/src/lib/services/onboarding-state.ts` (SCHEMA_PHASE_ORDER line 35), `onboarding-polling.ts`, `app/api/onboarding/[schemaId]/retry/route.ts`, `components/onboarding/phase-generating.tsx`, `flow.tsx`, plus 3 integration tests. Add explicit sweep step: route references to `DISCOVERING_DOMAINS` or guard as deprecated no-op. If enum value is retained (current plan), explicitly state: "leave `GENERATING_HYPOTHESIS: 1` in `SCHEMA_PHASE_ORDER`." | Critical |

### Task 6.1 — delete orphan code (lines 4332–4382)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P6-2 | 4338 | Deletes `packages/ai/src/__tests__/validation-parser.test.ts` | Issue #70 added this test in commit `9a658fd`. Confirm deletion is intentional. If parser regex is reused anywhere, transplant test before deleting. | Medium |

### Task 6.4 — CAS Transition Ownership Map (lines 4456–4497)

Clean — map exists at `docs/01_denim_lessons_learned.md:425`. No correction.

---

## Phase 7 — Eval Framework

### Ordering gate (plan-wide)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P7-1 | 4746, 4753, 5319 + Task 6.1 start | Prose asserts "Task 7.4 MUST run before Phase 6" but Task 6.1 has no gate | Add to Task 6.1 as **Step 0**: `[ ] Verify Task 7.4 differential eval is committed (check git log for "docs(eval): differential run" or equivalent). Abort if not present. Phase 6 deletes the old path — after this commit, 7.4 cannot be re-run.` | Critical |

### Task 7.3 — runner (lines 4694–4745)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P7-2 | Imports `extractPropertyCandidates`, `extractSchoolCandidates`, `deriveAgencyEntity` | These don't exist until Phases 2/3 complete | Add explicit note: **Task 7.3 cannot land before Phase 2 Task 2.4 (agency-entity) completes.** | Medium |

### Task 7.5 — CI integration (lines 4776–4813)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P7-3 | 4793 | Imports `SLO.stage1.p95Ms` from Task 8.1 | 7.5 is sequenced before 8.1. Either reorder (7.5 after 8.1) or remove the SLO import from 7.5 and use a local constant that 8.1 later refactors to read from `slo.ts`. | Medium |

### Task 7.7 — outbox chaos test

Clean — imports from `onboarding-outbox-drain.ts` (correct filename).

---

## Phase 8 — SLOs

### Task 8.3 — runtime telemetry (lines 5157–5213)

| # | Plan lines | Plan says | Correct to | Severity |
|---|---|---|---|---|
| P8-1 | Task body | Targets NEW files `domain-discovery-fn.ts` + `entity-discovery-fn.ts` | Note relationship to existing `stepDurationMs` emissions in `apps/web/src/lib/inngest/onboarding.ts` (commit `fcc8420`). Task 6.1's deletion of old hypothesis code drops those emissions with it — Task 8.3 is their replacement for the new flow. Add a sentence making this explicit. | Medium |

### Task 8.1 — slo.ts (lines 4998–5068)

Clean — file doesn't exist, clean create.

---

## Phase 9 — Rollback Runbook

### Scenario B SQL

Clean — all column names (`stage1Candidates`, `stage1QueryUsed`, `stage1MessagesSeen`, `stage1ErrorCount`, `stage2Candidates`, `stage2ConfirmedDomains`, `identityKey`) match `schema.prisma` exactly. Unique constraint recreation on `(schemaId, name, type)` correctly undoes the `(schemaId, identityKey, type)` swap.

---

## Summary counts by phase

| Phase | Critical | Medium | Nit | Clean tasks |
|---|---|---|---|---|
| 2 | 10 | 2 | 0 | 2.2, 2.3, 2.4 |
| 3 | 3 | 3 | 1 | 3.2 body, 3.4, 3.5 |
| 4 | 4 | 3 | 0 | 4.4b, 4.4c (correctly anticipated), 4.5 |
| 5 | 0 | 3 | 0 | — |
| 6 | 1 | 1 | 0 | 6.2, 6.4, 6.5 |
| 7 | 1 | 2 | 0 | 7.1, 7.2, 7.4, 7.6, 7.7 |
| 8 | 0 | 1 | 0 | 8.1, 8.2, 8.4 |
| 9 | 0 | 0 | 0 | All clean |
| **Total** | **19** | **15** | **1** | — |

---

## Appendix: canonical signatures to reference while patching

- `withAuth`: `apps/web/src/lib/middleware/auth.ts:19–20`
- `extractOnboardingSchemaId`: `apps/web/src/lib/middleware/request-params.ts`
- `advanceSchemaPhase`: `apps/web/src/lib/services/onboarding-state.ts:99–137`
- `markSchemaFailed`: `apps/web/src/lib/services/onboarding-state.ts`
- `createFunction` reference shape: `apps/web/src/lib/inngest/onboarding.ts:49–64` + `apps/web/src/lib/inngest/domain-discovery-fn.ts`
- Inngest function registration: `apps/web/src/lib/inngest/functions.ts`
- `ONBOARDING_TUNABLES`: `apps/web/src/lib/config/onboarding-tunables.ts`
- `GmailClient.listMessageIds` / `.getMessageMetadata`: `apps/web/src/lib/gmail/client.ts`
- `matchesGmailAuthError`: `apps/web/src/lib/gmail/auth-errors.ts`
- `OnboardingPhase` union: `apps/web/src/lib/services/onboarding-polling.ts:15–25`
- `drainOnboardingOutbox`: `apps/web/src/lib/inngest/onboarding-outbox-drain.ts:85–98`
- CAS Transition Ownership Map: `docs/01_denim_lessons_learned.md:425`
- `DenimEvents`: `packages/types/src/events.ts`
