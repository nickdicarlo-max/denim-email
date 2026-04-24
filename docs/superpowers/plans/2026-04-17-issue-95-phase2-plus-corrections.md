# Issue #95 Plan — Phase 5+ Corrections (2026-04-17, trimmed 2026-04-18)

**Purpose:** Patch list for `docs/superpowers/plans/2026-04-16-issue-95-fast-discovery-rebuild.md` for Phase 5+ code that has not yet been written. All corrections bring plan samples back in line with the codebase conventions already used by Phase 0/1 (commits `0f3e991`..`96ff38d`) and carried through Phases 2–4 (commits through `2c13672`).

**How to use:** Go through each correction in order; apply to the plan file; commit once.

**Source of findings:** 3 parallel subagent audits on 2026-04-17.

**Counts (remaining):** 2 Critical, 5 Medium, 0 Nit. *(2026-04-18: P5-1 / P5-2 / P5-3 retired — Task 5.0 rewritten to build-time codegen; the concerns they raised — install step, wholesale replacement, Vercel cwd fragility — are either embedded in the new task or structurally impossible under codegen. One new Medium P5-4 added.)*

---

## Phases 2–4: code-complete

Phase 2 (Stage 2 entity discovery), Phase 3 (review-screen UX), and Phase 4 (pipeline cutover) are code-complete through commit `2c13672`. Corrections originally listed here (originally 18 Critical, 9 Medium, 1 Nit) were either (a) applied to the plan before implementation, (b) resolved by implementation choices captured in `docs/superpowers/plans/2026-04-17-issue-95-phase2-deviations.md`, or (c) made moot by subsequent refactors. The earlier revision of this file is available in git history if archaeology is needed.

---

## Guiding principle

Phase 0/1 did **not** rename existing code. The plan was originally drafted with fictional names/signatures (e.g., `STAGE2_TUNABLES`, `isGmailAuthError`, 3-arg `createFunction`) that were never in the codebase. Phase 0/1 correctly adopted the real conventions; Phase 2–4 maintained them. Every correction below updates the plan's Phase 5+ samples to match the same conventions.

---

## Phase 5 — Spec files as YAML via build-time codegen

### Task 5.0

**History:** Task 5.0 was rewritten on 2026-04-18 from a runtime-`readFileSync` loader to a build-time codegen pipeline (Option 1). The new flow: YAML source → Zod-validated generator → committed `domain-shapes.generated.ts` with `as const` literals → thin runtime wrapper with zero I/O and zero Zod. Previous entries P5-1 / P5-2 / P5-3 described the obsolete draft and are retired:

- **P5-1 (install step)** — folded into Step 0 of the rewritten Task 5.0 (`pnpm --filter web add -D js-yaml @types/js-yaml`; now devDep-only because YAML is never read at runtime).
- **P5-2 (wholesale replacement)** — now the explicit wording of Step 5 in the rewritten Task 5.0 (delete the hardcoded Record from `e3242be`, re-export from `.generated.ts`). Task 0.3 tests still pass for the same count-match reason.
- **P5-3 (Vercel cwd fragility)** — **structurally impossible under codegen.** The generated file is a plain `.ts` import, bundled by Turbopack like any other source; there is no `process.cwd()` at request time. No preview-gate needed for this axis.

| # | Concern | Correction | Severity |
|---|---|---|---|
| P5-4 | CI must enforce codegen drift — without it, a dev can edit YAML without regenerating, and prod ships with stale domain shapes | Task 5.0 Step 6 wires `.github/workflows/ci.yml` to run `pnpm --filter web generate:domain-shapes && git diff --exit-code apps/web/src/lib/config/domain-shapes.generated.ts`. This single check catches both stale commits (regen produces a diff) and hand-edits of the artifact (regen reverts them, producing a diff). Verify the CI job step lands in the same PR as Task 5.0 — not in a follow-up. | Medium |

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
| P7-2 | Imports `extractPropertyCandidates`, `extractSchoolCandidates`, `deriveAgencyEntity` | These don't exist until Phases 2/3 complete | Resolved by Phase 2 completion (commits through `2c13672`). Still note: **Task 7.3 depends on Phase 2 entity extractors being on `main` / the working branch.** | Medium |

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

## Summary counts by phase (remaining)

| Phase | Critical | Medium | Nit | Clean tasks |
|---|---|---|---|---|
| 5 | 0 | 1 | 0 | — *(P5-1/P5-2/P5-3 retired 2026-04-18; P5-4 added for codegen drift check)* |
| 6 | 1 | 1 | 0 | 6.2, 6.4, 6.5 |
| 7 | 1 | 2 | 0 | 7.1, 7.2, 7.4, 7.6, 7.7 |
| 8 | 0 | 1 | 0 | 8.1, 8.2, 8.4 |
| 9 | 0 | 0 | 0 | All clean |
| **Total** | **2** | **5** | **0** | — |

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
