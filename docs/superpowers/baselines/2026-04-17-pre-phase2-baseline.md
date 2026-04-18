# Pre-Phase-2 Baseline — 2026-04-17

**Captured:** 2026-04-17 16:15 local (Friday).
**Branch:** `feature/perf-quality-sprint`
**Git HEAD:** `25e3f201400a04bb942f7a799863ec4f77793b51` — "feat: issue 95 fast discovery rebuild phaes 2 + corrections development"

**Purpose:** known-good snapshot of typecheck + test + validator state immediately before Phase 2 (Stage 2 Entity Discovery) coding begins. Any Phase 2 task that regresses a number below should be investigated against this baseline.

---

## Typecheck

| Workspace | Result |
|---|---|
| `packages/types` | ✅ clean |
| `packages/engine` | ✅ clean |
| `packages/ai` | ✅ clean |
| `apps/web` | ✅ clean |

Command: `pnpm typecheck` — exit 0. All 4 workspaces pass `tsc --noEmit`.

---

## Unit tests

| Package | Files | Passed | Failed | Duration |
|---|---|---|---|---|
| `packages/types` | 1 | **2** | 0 | 1.23s |
| `packages/ai` | 5 | **52** | 0 | 2.98s |
| `packages/engine` | 6 | **92** | 0 | 3.41s |
| `apps/web` | 10 | **44** | 0 | 4.65s |
| **Total** | **22** | **190** | **0** | ~12s |

Command: `pnpm -r test` — exit 0. No skipped, no flaky retries observed.

Note: status doc claimed 188 (52 + 92 + 44). Actual is 190 — `packages/types` contributes 2 tests that the running total had been omitting.

---

## Stage 1 real-sample validator

Command: `cd apps/web && npx tsx ../../scripts/validate-stage1-real-samples.ts` — exit 0.

417 real Gmail samples loaded from `Denim_Samples_Individual/` (gitignored).

| Check | Result | Detail |
|---|---|---|
| property: judgefite.com top-3 | ✅ | rank 1 (3 keyword-matching emails) |
| agency: portfolioproadvisors.com top-5 | ✅ | rank 2 (5 keyword-matching emails) |
| agency: stallionis.com top-5 | ✅ | rank 4 (3 keyword-matching emails) |

**Stage 2 scaffolding:** entity-discovery module not yet implemented (expected — Phase 2 target). Ground-truth expectations print as reference: 4 fixtures covering property × judgefite (5 addresses), agency × PPA (1 derived entity), agency × stallionis (1 derived entity), school_parent × teamsnap (ZSA team).

---

## Biome (format + lint)

Command: `pnpm biome check` — exit 0.

- 263 files checked in 1329ms
- 278 errors
- 153 warnings
- 35 infos
- 0 fixes applied

**Anomaly:** exit 0 despite 278 reported errors. These are the pre-existing CRLF line-ending issues documented in the 2026-04-15 session log ("biome check identical to baseline (pre-existing CRLF issues only)"). Counts stable across recent sessions — treat as noise floor, not a regression signal. Phase 2 should target `diff from this line count`, not absolute zero.

---

## Git state

```
HEAD       25e3f20 feat: issue 95 fast discovery rebuild phaes 2 + corrections development
HEAD~1     3d4a58e docs(status): log #95 Phase 0 + Phase 1 code-complete + real-sample validation
HEAD~2     96ff38d feat(inngest): runDomainDiscovery + CaseSchema stage1/stage2 columns
HEAD~3     aa940e1 test(discovery): integration test for discoverDomains
HEAD~4     a6d9ab5 feat(discovery): buildStage1Query + discoverDomains entry point
```

Commit `25e3f20` (just before baseline capture) bundled:
- Main plan trim (−1,279 lines)
- Corrections doc (+244 lines): `docs/superpowers/plans/2026-04-17-issue-95-phase2-plus-corrections.md`
- Phase 0/1 archive (+1,306 lines): `docs/superpowers/plans/archive/2026-04-16-issue-95-phase0-1-archive.md`
- Previously-untracked validator scripts now tracked: `simulate-stage1-domains.mjs` (86), `validate-agency-keywords.mjs` (145), `validate-stage1-real-samples.ts` (412)
- `.claude/settings.local.json` (5-line change)

**Working tree (at capture time):**
```
M docs/superpowers/plans/2026-04-16-issue-95-fast-discovery-rebuild.md
```

The plan file has ongoing unstaged edits — the other coding agent is actively applying the corrections from `2026-04-17-issue-95-phase2-plus-corrections.md`. This is expected.

---

## Summary

**Baseline captured: 190 tests green, typecheck clean across all 4 workspaces, Stage 1 validator 3/3 ✅, biome at 278-error noise floor.**

Use this file as the reference point for Phase 2 regression checks. After each Phase 2 task commits, re-run `pnpm -r test` and compare counts to this table; re-run the validator to confirm Stage 1 didn't regress; watch biome's error count for drift (ignore the existing 278, look for new ones).
