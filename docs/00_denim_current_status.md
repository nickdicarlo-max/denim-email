# Denim Email — Current Status

Last updated: 2026-04-15 (afternoon — Phase 3 CODE-COMPLETE on `feature/perf-quality-sprint`; E2E measurement pending)

Historical sessions (Phases 0–7 baseline, per-phase detail, bug archaeology): `docs/archive/denim_session_history.md`.

## Baseline

Phases 0–7 complete. **`feature/ux-overhaul` merged to `main` on 2026-04-14 via PR #83** (merge commit `ff8aa43`). Active branch is now `feature/perf-quality-sprint`. Typecheck clean; 153 unit tests passing (up from 144 after #85's parser tests). Phase 1 + Phase 2 verified end-to-end on 3 live runs (see 2026-04-15 session block below); Phase 3 ready to start.

## Deferred debt

- **Scan-stage retry doesn't actually recover a `PROCESSING_SCAN` failure.** Task 12's retry route handles pre-scan failures (`PENDING` / `GENERATING_HYPOTHESIS` / `FINALIZING_SCHEMA`) cleanly, but a scan-stage failure leaves the ScanJob in `phase=FAILED` and the resumed `runOnboarding.waitForEvent` hits its 20m timeout. Task 13's manual-rescan route creates a new scanJobId that the waiting workflow ignores. Deferred until a scan-stage failure actually bites in practice (none observed in testing).
- ~~**Inngest-outage stranding in `POST /api/onboarding/start`**~~ — **resolved by #33** (2026-04-09). Transactional outbox pattern: stub + outbox row written atomically; `drainOnboardingOutbox` cron retries failed emissions. The fragile TOCTOU P2002-catch is also eliminated — `onboarding_outbox.schemaId` PK is the sole idempotency guard.
- **`casesMerged` / `clustersCreated` fabricated as 0** in clients for backward compat; cleanup can remove them from the client response in a future pass. Cosmetic.

### Canonical progress doc + deeper detail

See the "Execution Progress" header inside `docs/superpowers/plans/2026-04-07-onboarding-state-machine.md`. It has per-task commit SHAs, file inventory, 29 plan deviations, and the verification routine I followed for each task. The refactor is **complete** — that plan is the canonical archaeology if you need to dig into any specific task's rationale.



### Pipeline Root Cause Investigation & Fixes (2026-04-12)

Deep investigation into April 11 test run failures. Two schemas tested:
"April 11 Test Girls Activities" (school_parent) and "April 11 Property
Management" (property). Multi-session data-driven diagnosis using probe
scripts against live DB data.

**Root cause #1: Synthetic ID MERGE failure (#58, closes #37)**

The gravity model assigns synthetic IDs ("new-case-0") to newly created
cases in memory. MERGE decisions reference these IDs, but the write phase
at cluster.ts:338 looked them up in the DB where real cases have CUIDs.
`if (!targetExists) continue;` silently skipped every MERGE. Both schemas
had 0 MERGE cluster records, 100% CREATEs.

Evidence: GA gravity model simulation produced 20 CREATE + 34 MERGE
decisions. All 34 MERGEs had scores 36-45 (above threshold 35). 48 orphaned
emails had entityId=soccer set correctly at creation (never re-processed).
6 orphans had alternativeCaseId="new-case-1"/"new-case-6" -- synthetic IDs
leaked into the DB.

Fix: Build `syntheticToReal` mapping during CREATE writes in the transaction.
Resolve MERGE targetCaseId and alternativeCaseId through the map. No changes
to @denim/types or @denim/engine (pure function stays pure). Commit d9cbba6.

**Root cause #2: PM mergeThreshold=45 unreachable (#59)**

Property domain had mergeThreshold=45 but max achievable score without
sender-entity match is 35 (subject 20 + tag 15). Zero merges possible
regardless of the synthetic ID bug.

Fix: Lowered property domain default from 45 to 30 in interview-hypothesis.ts.
Added ceiling validation in interview.ts: if AI-generated mergeThreshold > 40,
cap at 30. Commit d9cbba6.

**Additional fixes (commit 46743a8):**

- **#60 Case-splitting visibility** -- Catch block now writes PipelineIntelligence
  error row with `output: { error: true, errorMessage, errorType }`. Diagnostic
  write wrapped in its own try/catch to avoid masking the original error.
- **#61 Case tags populated** -- All 3 case-creation sites (coarse CREATE, split
  CREATE, catch-all) now populate anchorTags, allTags, displayTags from email
  tags. Added `tags: true` to emailDetails query in split phase.
- **#47 Extraction race guard** -- Added `extractionCompleteEmitted` boolean to
  ScanJob with CAS guard: `updateMany({ where: { extractionCompleteEmitted: false } })`.
  Only the first checkExtractionComplete invocation emits; subsequent ones no-op.

**Issues filed during investigation (for backlog):**
- checkExtractionComplete race condition confirmed but mitigated by downstream CAS
- Case-splitting silently failed for both April 11 schemas (now visible via #60 fix)
- clusteringConfidence column on Email is dead (never written)

**Validation:** All changes typecheck clean, 133 unit tests pass. Gravity model
simulation confirms 34/34 merges resolve, 71/71 emails accounted for, 6/6
alternativeCaseIds resolve to real CUIDs.

### Review Screen Speed + Entity Grouping (2026-04-13)

**Problem from first live test:** Review screen took 72.8s to appear (target <30s),
and all discovered SECONDARY entities were hidden — "ZSA U11/12 Girls" (7 soccer
emails), "TeamSnap" (7 soccer emails), "Pia spring dance show" (1 dance email)
produced zero visibility on the review screen despite being the most actionable
discoveries. Only PRIMARY entities without alias matches ("Rental Properties",
"The Control Surface") surfaced, in a separate "New Discoveries" section. Under
each user topic the screen said "No additional items found" even when plenty was
found.

**Design decisions:**
- Pass 1 (pre-confirm, blocks review screen) shrinks to 100 random emails bounded
  to last 8 weeks. Purpose stays broad/exploratory — find things the user didn't
  mention.
- Pass 2 (domain expansion) moves from Function A (pre-review) to Function B
  (post-confirm). Targets ONLY user-confirmed entities — the user's toggles tell
  us which domains are worth expanding.
- Pass 2 expansion rule: corporate domains expand by domain
  (`from:email.teamsnap.com`), generic providers (@gmail, @yahoo, etc.) expand by
  specific sender address (`from:ziad.allan@gmail.com`). Prevents `from:gmail.com`
  from pulling every personal email in the inbox.
- Validation prompt adds `relatedUserThing` on each discovered entity so Claude
  labels which user topic the entity relates to (or null if cross-topic or
  unrelated).
- Review UI restructures to two sections: "Your Topics" (each user topic with
  related discoveries underneath) and "Discoveries" (flat list of everything
  else — the Amy DiCarlos, Timothy Bishops, Rental Properties).

**Changes shipped (15 commits, 80d9bf1 → 9b725de on feature/ux-overhaul):**

- `apps/web/src/lib/config/onboarding-tunables.ts` — NEW central config for sample
  sizes, lookback windows, per-target caps. Replaces hardcoded constants in
  `onboarding.ts` and `discovery.ts`.
- `packages/types/src/schema.ts` — `HypothesisValidation.discoveredEntities[].relatedUserThing`
- `packages/ai/src/parsers/validation-parser.ts` — Zod accepts `relatedUserThing`
  with `.default(null)`
- `packages/ai/src/prompts/interview-validate.ts` — 4th optional `userThings` param
  wires the user's entered topics into the system prompt with matching rules
- `apps/web/src/lib/services/interview.ts` — `validateHypothesis` threads
  `userThings`; `GENERIC_SENDER_DOMAINS` now exported
- `apps/web/src/lib/gmail/client.ts` — `sampleScan(maxResults, newerThan?)`
- `apps/web/src/lib/services/expansion-targets.ts` — NEW `extractExpansionTargets`
  (corporate domain vs generic-provider sender rule) + 6 unit tests
- `apps/web/src/lib/inngest/onboarding.ts` — Function A Pass 1 uses
  `sampleScan(100, "56d")`; Pass 2 loop removed from Function A; new
  `expand-confirmed-domains` step added to Function B with idempotent upsert
- `apps/web/src/lib/services/discovery.ts` — reads lookback + cap from config
- `apps/web/src/components/onboarding/review-entities.tsx` + `phase-review.tsx` —
  "Your Things" → "Your Topics"; unified "Discoveries" section; SECONDARY
  entities grouped under topics via `relatedUserThing`
- `apps/web/scripts/diagnose-hypothesis.ts` — fixed pre-existing typecheck errors
  (`name` not `displayName`, `lastAttemptAt` not `updatedAt`, scanJob relation
  filter); added `confirmedTags` output; clarifies empty discoveryQueries is
  expected at AWAITING_REVIEW

**Expected timing:** ~25-35s for review screen (hypothesis 10-15s + Pass 1
validation 15s + Inngest overhead ~3s). Pass 2 now runs invisibly during the
post-confirm scan progress UI.

**Open follow-up: #66** — `relatedUserThing` lives only in `schema.validation`
JSONB. `phase-review.tsx` Branch A (reads DB Entity rows) can't see it. Dead
path today (no entities exist at AWAITING_REVIEW), but activates if we ever
let users revisit the review screen. See issue for two fix options (join
JSONB in GET route vs. add column to Entity model).

**Pending:** Task 14 manual E2E verification — fresh onboarding run to confirm
<30s target and verify ZSA/TeamSnap/Pia appear under their topics.

## 2026-04-14 Session Log

### Audit (morning)
Three parallel Explore agents ground-truthed both 2026-04-13 plans (review-screen-speed and pipeline-resequencing) against the code — every factual claim matched. **No hallucination.** Real gap was verification (no CI-level integration, no Playwright E2E, happy-path test suspected of testing wrong things per Nick's distrust). Issues filed from the audit: **#67–#73**.

### Commits landed on `feature/ux-overhaul`
- **2b9f16e** `fix(onboarding): confirm route uses outbox + Function B owns phase advance`
  - OnboardingOutbox PK now composite `(schemaId, eventName)` (raw-SQL migration via supabase-db skill)
  - Drain function is event-generic (reads eventName + payload from row)
  - POST confirm route: no more phase flip — single `prisma.$transaction` commits `persistSchemaRelations` + outbox row; optimistic fire-and-forget emit; drain cron (1-min tick) is the guaranteed recovery path
  - Function B's existing `advanceSchemaPhase` + ScanJob creation now runs correctly (was being skipped)
  - `phase-review.tsx` renders "Starting your scan…" during submission window
  - Closes **#67** and **#74**
- **fcc8420** `obs(onboarding): per-step wall-clock telemetry in Function A`
  - `generate-hypothesis.complete` / `validate-hypothesis.complete` / `advance-to-awaiting-review.complete` / `runOnboarding.awaitingReview` all emit `stepDurationMs` + sub-step timings (dbReadMs, gmailTokenMs, gmailSampleScanMs, validateHypothesisMs, dbWriteMs)
- **5e64991** `chore(skills): add onboarding-timing skill`
  - `.claude/skills/onboarding-timing.md` — parses JSON logs into a timeline table (needs Claude Code restart to register as slash command)
- **7e5043b** `fix(extraction): mid-scan PRIMARY entity discovery via Stage 3b upsert`
  - Gemini's `detectedEntities` that name new PRIMARY entities (not in existing Entity list) are now upserted with a trust gate: sender ambiguous with 2+ associated primaries, OR subject literally contains the entity name, OR Gemini confidence ≥0.7
  - Idempotent under existing `@@unique([schemaId, name, type])`
  - Stage 4 refactored to reuse pre-resolved sender data (one fewer DB round-trip per email)
  - Closes **#76**

### Live E2E runs — both 6/6 PASS

| Schema | Domain | Emails | Cases | Duration | Key verification |
|---|---|---|---|---|---|
| `01KP6CF6QJPHS3Z4DHYDDK75CK` "Round 2 Girls Activities" | school_parent | 80 | 4 | ~4 min Function B | Entity grouping (ZSA/TeamSnap under soccer), 32 MERGEs (was 0 pre-#58), tag coverage 100%, outbox EMITTED |
| `01KP6DVWDSW1V0W1AT1X9H0DKP` "Property Management" | property | 200 | 16 | ~9 min Function B | mergeThreshold=30 produced 18 MERGEs (min score 31.7, med 34.3 — threshold at the edge exactly as predicted), splits 16, PipelineIntelligence row written |

### Issue hygiene

**Closed (verified in live data):**
- **#33** Start route outbox — baseline + confirmed by today's runs (both outbox events EMITTED attempts=1)
- **#56** validateHypothesis wired back — already resolved by Plan 1
- **#67** Confirm route outbox — by 2b9f16e
- **#68** Entity uniqueness — already fixed in earlier commit 17fcec8 (expand-confirmed-domains uses upsert with `schemaId_name_type`)
- **#74** PROCESSING_SCAN ownership — by 2b9f16e
- **#76** Mid-scan PRIMARY discovery — by 7e5043b

**Filed this session (still open):**
- **#69** Inngest retries 0→2 (needs step-level idempotency audit first)
- **#70** `validation-parser.test.ts` for `relatedUserThing` default-null + round-trip
- **#71** Audit or delete `onboarding-happy-path.test.ts` (no longer trusted as gate)
- **#72** CI integration job + Playwright onboarding E2E spec
- **#73** Review screen render time — 107s first run, 48s second (Claude variance)
- **#75** Post-scan orphan mining (topics the user never mentioned — Martial Arts belt-test from Amy DiCarlo)
- **#77** Gemini batch extraction (pack 5-10 emails per call, est. 3-5x extract speedup)
- **#78** Parallelize Claude synthesis + case-splitting (est. -3m on run 2)
- **#79** Anthropic prompt caching on validateHypothesis (est. -10s on Function A)
- **#80** Parallelize `generate-hypothesis` + `gmail.sampleScan` (est. -5s)
- **#81** Parallelize discovery query execution in run-scan (est. -20s)
- **#82** Live case count during synthesis (UX perceived-wait)

### Combined perf estimate (if #77–#82 land)
- Run 1 (80 emails, 4 cases): ~4min → ~1m30s
- Run 2 (200 emails, 16 cases): ~9min → ~3m40s
- Function A (user waits on Card 3): ~40s → ~25s

### Updated issues with run data
- **#19** Clustering non-determinism — substantially improved by #58 (32 MERGEs); remaining variance is Gemini
- **#59** PM threshold=30 — validated at the edge on run 2 (min merge score 31.7)
- **#25** Scanning UX — linked to all six speedup issues (#77–#82) as the perf umbrella
- **#21, #35, #38, #16, #65** — commented with observed data

## 2026-04-14 Evening Session — Perf + Quality Sprint Kickoff

### Merge to main
- PR #83 (`feature/ux-overhaul` → `main`) merged with merge commit `ff8aa43`.
- Carried Waves 1–3 of UX overhaul, 2026-04-12 pipeline fixes (#58 #59 #47 #60 #61), 2026-04-13 review-screen speed + entity grouping, 2026-04-14 outbox confirm route + mid-scan PRIMARY discovery + telemetry.
- `feature/ux-overhaul` kept around (not deleted) per Nick's request.

### Sprint branch + plan
- New branch `feature/perf-quality-sprint` off `main`.
- **Canonical plan:** `docs/superpowers/plans/2026-04-14-perf-and-quality-sprint.md` — 6 phases, 19 issues, locked order `69, 70, 79, 80, 81, 77, 78, 82, 63, 73, 25, 35, 38, 65, 75, 57, 71, 72, 66`. Tests (#71, #72) deferred to end because surface area changes.
- Execution method: subagent-driven-development (fresh subagent per task + two-stage review).

### Phase 1 — Safety foundations ✅ CODE-COMPLETE
- **#69** Step-level idempotency audit + retries 0→2 on both onboarding Inngest functions — commit `173f7ab`. Audit found 1 NEEDS GUARD: `create-scan-job` now has findFirst-and-reuse guard covering the window where `scanJob.create` succeeds but CAS `updateMany` fails.
- **#70** `validation-parser.test.ts` with 5 cases (explicit value, omitted default-null, explicit null, round-trip, invalid type) — commit `9a658fd`.
- Quick gate: typecheck clean, 139→144 tests pass. Full E2E pending.

### Phase 2 — Cheap perf wins ✅ CODE-COMPLETE
- **#79** Prompt caching on `validateHypothesis` system prefix — commit `45cb490`. Static/dynamic split with `cache_control: { type: "ephemeral" }` on the static block; `cacheReadInputTokens` / `cacheCreationInputTokens` logged. **Caveat:** current static prefix is ~500 tokens vs Sonnet 4.6's 1024-token minimum — infra is correct and production-safe, but cache won't activate until the prefix grows. Zero cost when inactive; lights up automatically later.
- **#80** Parallel `generate-hypothesis` + `gmail.sampleScan` in Function A — commit `2ddb60c`. Real code had sampleScan nested inside `validate-hypothesis`; implementer extracted it to a new sibling step `gmail-sample-scan` so `Promise.all` can run both against shared Inngest retry/checkpoint semantics.
- **#81** Parallel discovery query execution — commit `0884cee`. Added `p-limit@7.3.0` (new dep); concurrency=3; `.slice(0, maxEmails)` trims incidental over-fetch from racing workers.
- Quick gate: typecheck clean, 144/144. Full E2E pending.

### Expected Phase 2 wins (measurement pending)
- Function A: ~40s → ~35s (−5s from #80; #79 dormant until prefix grows)
- `run-scan` discovery: ~38s → ~15s (−23s from #81)

### Issues touched this session
- **Closed:** #16 (silent email dropping — two clean runs qualify)
- **Filed:** **#84** Harden `GmailMessageMeta.date` against Inngest JSON-replay (latent-only risk today; #80 made retry-replay more likely to execute)

### Next action on resume
1. Nick runs the full E2E on both schemas; captures structured logs; invokes `/onboarding-timing`
2. If baseline matches: dispatch Task 3.1 (#77 Gemini batch extraction — est. −2m on Run B)
3. If regression: bisect across `45cb490 → 2ddb60c → 0884cee`

### Skills hygiene
- `supabase-db` and `onboarding-timing` skills now installed at user scope (`~/.claude/skills/<name>/SKILL.md`) so they register as slash commands. Source-of-truth copies remain committed at `.claude/skills/*.md`. CLAUDE.md updated to document the install.

## 2026-04-15 Early-Morning Session — Phase 1 + 2 Verified End-to-End

### E2E runs (three schemas, all clean after in-flight parser fix)

| Schema | Domain | Emails in | Cases | Function A | Scan | Eval |
|---|---|---|---|---|---|---|
| `01KP6Z08X7QWQE11V1P045D6NG` Round 3 Girls Activities | school_parent | 200 | **12 → 5** | 57.8s | 5m 11s | PASS after #85 |
| `01KP7B8ZJGWGZ697CBYY5JXHCF` Consulting | agency | 69 (of 198) | 11 | **39.4s** | 5m 39s | 6/6 PASS |
| `01KP7C5VBFRMJ6ZT1ZZKWRAJVN` Round 4 Girls Activities | school_parent | 56 (of 108) | 5 | 46.6s | 3m 28s | 6/6 PASS |

### In-flight regression fix — case-splitting parser (#85, commit `a6d8007`)

Round 3 initially produced **12 cases with obvious duplicates** (3× ZSA U11/12 Soccer Practices at 10/12/18 emails each; 2× Pia Dance Show; etc.). Investigation (see #85):

- Coarse clustering was fine — 32 MERGE + 12 CREATE at gravity-model scores 35.6–45.0.
- `PipelineIntelligence[stage=case-splitting].output.error = true`, message `"cases.5.discriminators: Too small: expected array to have >=1 items"`.
- Zod schema in `packages/ai/src/parsers/case-splitting-parser.ts` parsed the whole envelope in one shot — one bad sub-case rejected all 6 returned by Claude.
- Catch block returned `{ clusterIds: [], casesCreated: 0 }`, so `runCaseSplitting` emitted `clustering.completed` with only coarse IDs. Synthesis ran on unsplit coarse output.

**Fix (`a6d8007`):**
- `packages/ai/src/parsers/case-splitting-parser.ts` — envelope + per-case parse; invalid sub-cases dropped, their emailIds salvaged to `catchAllEmailIds` for downstream discriminator reassignment. Only structurally broken envelopes throw.
- `packages/ai/src/prompts/case-splitting.ts` rule 6 — removed "Typical: 2-5 cases per entity" anchor; added explicit "no numeric cap" and MERGE-when-same-what's-next guidance.
- `packages/ai/src/__tests__/case-splitting-parser.test.ts` — 9 new tests including exact repro of Round 3's empty-discriminators failure. Suite 144 → 153.

Confirmed on Runs B and C: case-splitting `PipelineIntelligence` rows = 1 (no error), SPLIT cluster records present, previously-duplicated cases collapsed correctly.

### Phase 2 timing verdict (from `/onboarding-timing`)

- **#80** parallel genHyp + sampleScan — ✅ sampleScan fully hidden under generateHypothesis on every post-`2ddb60c` run.
- **#81** parallel discovery queries — ✅ 20+ searchEmails in ~4s on Round 3; 7 parallel in ~1s on Round 4 Pass 2.
- **#79** prompt caching — ✅ infra correct, **dormant**: `cacheReadInputTokens=0, cacheCreationInputTokens=0` on all calls (static prefix ~500 tok < Sonnet 4.6's 1024-token minimum). Zero cost; activates when prefix grows.
- Claude API variance (14.9s–28.2s on the same prompt) dominates the remaining Function A budget — not a code issue.

### Issues closed this session
- **#79** prompt caching — landed + dormant, closed with followup-if-prefix-grows note.
- **#80** parallel Function A — landed + verified across 3 runs.
- **#81** parallel discovery — landed + verified across 3 runs.
- **#85** case-splitting parser brittleness — fix + tests + E2E verification.

### Known soft issue (non-blocking, for later)
- Consulting run produced three PRIMARY entities for the same company — `Portfolio Pro Advisors`, `PPA`, `Portfolio Pro Advisors (PPA)`. Partially user-input driven (Nick entered "Asset Management" instead of the company name), but the product should also do cross-alias primary coalescence. Not filing today — revisit during Phase 5 quality work.

### Next action on resume (Phase 3 kickoff)
1. Dispatch Task 3.1 (**#77** Gemini batch extraction, 5–10 emails per call — estimated −2m on 200-email runs).
2. Then Task 3.2 (**#78** parallel synthesis + case-splitting fan-out — estimated −3m).
3. Then Task 3.3 (**#82** live case count during synthesis — UX perceived-wait).

Baseline for Phase 3 measurement: Run B (Consulting, 200 emails) = 339.5s scan / 5m 39s end-to-end; Run C (Girls Activities, 108 emails) = 207.5s / 3m 28s.

## 2026-04-15 Afternoon Session — Phase 3 Code-Complete

### Commits landed on `feature/perf-quality-sprint`

| Task | Issue | Commit | Summary |
|---|---|---|---|
| 3.1 Gemini batch extraction | **#77** | `7c0d1d0` | `CHUNK_SIZE=5` batched Gemini calls with `BatchExtractionSchema` in `@denim/ai`. Parser validates array length, sorts by index, strips index. On parse failure: quarantine fallback to per-email path. Exclusion-matched emails still short-circuit (cheap DB-only upsert). Tests: packages/ai 46 → 52. |
| 3.2 Synthesis fan-out | **#78** | `2c6b373` | `runSynthesis` refactored to fan out `synthesis.case.requested` events. New `synthesizeCaseWorker` (concurrency=4 per schemaId, retries=2) + `checkSynthesisComplete` (waits for all cases before emitting `scan.completed`). Mirrors existing `fanOutExtraction → extractBatch → checkExtractionComplete` pattern. Preserves `scan.completed` payload so downstream `runOnboarding` + polling unchanged. **Case-splitting fan-out deferred → #86** (single cross-entity Claude call + atomic delete/create write doesn't decompose cleanly). |
| 3.3 Live case count | **#82** | `f3b54ff` | Raw-SQL migration via supabase-db path: `scan_jobs.synthesizedCases`, `scan_jobs.totalCasesToSynthesize`. Denominator set in `runSynthesis` load-cases step using actual `findMany` count; per-case increment in `synthesizeCaseWorker` success path (not on failed path — counts completions, not attempts). Surfaced in polling response as optional fields; rendered in `phase-synthesizing.tsx` (plan said `phase-processing-scan.tsx` — that's the dispatcher, not the renderer). |

All three passes: typecheck clean vs baseline, `pnpm -r test` green (53/52 ai + 92 engine + 13 web + 2 types = 160 tests), `pnpm biome check` identical to baseline (pre-existing CRLF issues only).

### Architectural discovery — day-2 vs onboarding

During 3.2 implementation, two things surfaced that are bigger than the individual task:

1. **Case-splitting architecture doesn't fit per-case fan-out.** `splitCoarseClusters` is a SINGLE Claude call across ALL coarse clusters (cases can merge or split relative to each other) with an atomic delete-coarse / create-split transaction in `cluster.ts`. No natural per-cluster completion marker. Per-case fan-out would require refactoring both the Claude call shape AND the write-owner transaction.

2. **Onboarding and day-2 share the same code path today.** `cronDailyScans` (`cron.ts:81`) fires a generic `scan.requested` event handled by `runScan` (`scan.ts:34`) — the doc comment explicitly says it is "the parent workflow for every scan trigger (onboarding, cron, manual, feedback)". Day-2 re-runs the full AI pipeline (including Gemini per-email extraction + Claude case-splitting + Claude synthesis) for 2-20 new emails. No short-circuit to deterministic routing despite the onboarding-learned vocabulary (`learnedVocabulary` in `case-splitting.ts:31`) being explicitly designed for this.

These led to filing **#86 — Day-2 case-splitting: deterministic routing, no-op investigation, deferred fan-out**, which consolidates three threads into a single strategic issue with a phased proposal (A measure → B short-circuit → C day-2 routing → D fan-out only if still needed). Important nuance preserved in the issue: entity discovery (inter-entity) MUST stay dynamic (new "567 Maple St" still needs a new coarse cluster); only case-splitting (intra-entity) can become deterministic per known entity.

### Issues closed this session
- **#77** Gemini batch extraction — closed via commit trailer.
- **#78** Synthesis fan-out — closed via commit trailer, with splitting portion punted to #86.
- **#82** Live case count — closed via commit trailer.

### Issues filed this session
- **#86** Day-2 case-splitting consolidated strategic issue (see above).

### Expected Phase 3 wins (measurement pending)
- run-extraction (200 emails): ~3m10s → ~60s (3-5x, from Gemini batching)
- run-synthesis (16 cases): ~2m33s → ~40s (from concurrency=4)
- run-case-splitting: ~1m32s → **unchanged** (deferred to #86 strategic refactor)
- Total Function B (Run B Consulting 200 emails): ~9m → ~4m 50s (not the plan's ~3m 40s — splitting still serial)
- Observer UX: spinner → live "N of M" counter during synthesis

### Next action on resume
1. Nick runs full E2E on Run B (Consulting, 200 emails), measures Phase 3 actual gains via `/onboarding-timing`.
2. If baseline + no regressions: dispatch Phase 4 Task 4.1 (**#63** batch `persistSchemaRelations` round-trips).
3. If regression: bisect across `7c0d1d0 → 2c6b373 → f3b54ff`.

## 2026-04-15 Late Session — Phase 3 Measured + Tunables Consolidation

### Live E2E — Property Management, 200 emails

Schema `01KP8MRJQJXF302KP19NB5RAVR`, scanJob `cmo02y6x60022jgqeov2lboxj`.

**Result:** 6/6 PASS, 35 cases (34 synthesized + 1 failed → unstuck manually).

Key numbers from `/onboarding-timing`:

| Phase | Wall | Notes |
|---|---|---|
| Function A (hypothesis + validate + advance) | 35.4s | #80 parallel genHyp+sampleScan verified |
| Pass 2 domain expansion | 56.1s | 2 Claude calls dominated |
| Discovery + extraction fan-out | 39.0s | #81 parallel queries verified |
| Extraction (200 emails) | **169.5s** | vs projected ~60s — measurement revealed concurrency bottleneck |
| Clustering + case-splitting | 108.9s | unchanged, deferred to #86 |
| Synthesis (34 cases, concurrency=4) | 81.2s | verified; per-case 5–18s |

Function B real work (confirm → last synthesis): ~7m 35s vs ~9m baseline (~16% faster). Short of ~4m 50s projection because extraction and case-splitting both underperformed.

### Synthesis hang bug — fix `e804b70`

Case 34 of 35 failed Zod parse (Claude output truncated at `maxTokens: 4096` mid-`summary.middle`). Worker emitted `synthesis.case.completed status:"failed"` but `checkSynthesisComplete` counted pending via `synthesizedAt IS NULL`, so the failed case stayed "pending" forever and the scan never finalized.

**Fix:** Worker now stamps `case.synthesizedAt = NOW()` on failure as a terminal marker. `checkSynthesisComplete` now reads `synthesizedCount` / `failedCount` from `ScanJob.synthesizedCases` / `ScanJob.totalCasesToSynthesize` (populated by #82) instead of `synthesizedAt` state.

Unstuck the live run by manually stamping case 34 + firing one `synthesis.case.completed` event at the Inngest dev server. Finalizer ran, scan completed with the correct counters.

### Extraction bottleneck — diagnosis + fix `74e2138`

Phase 3's `#77` batching was engaged (40 Gemini batches of 5, 0 fallbacks) but wall was 169.5s, not ~60s. Root cause: **`extractBatch` Inngest concurrency limit = 3**.

Math: 40 batches × 6.0s avg ÷ 3 = 80s Gemini floor. Batching saves Inngest overhead, **not** Gemini output time — a 5-email batch returns ~5× the JSON payload, so per-call latency scales near-linearly.

**Fix:** Raised `extractBatch.concurrency` from 3 → 8. Projected: 40 ÷ 8 = 5 rounds × 6s = 30s Gemini floor + Gmail ≈ **~50s extraction wall (~3.4× faster)**. Gemini Flash 2.5 has 2000+ RPM headroom; DB pooler handles 8×5=40 parallel upserts. Tracked in **#88**.

### Tunables consolidation — `74e2138` → `b2c03fc` → `a2ae6f2` → `fe08121`

Extracted 20+ pipeline parameters from inline literals and prompt-file hardcodes into two tunables files:

**`apps/web/src/lib/config/onboarding-tunables.ts`** (extended):
- `extraction.chunkSize`, `batchConcurrency` (3 → **8**), `fanOutBatchSize`, `gmailPacingMs`, `relevanceThreshold`
- `discovery.queryConcurrency`, `broadScanLimit`, `bodySampleCount`
- `synthesis.caseConcurrency`, `synthesis.maxTokens` (**4096 → 6144**, closes #87)
- `pipeline.scanWaitTimeout`
- `ui.pollIntervalMs`

**`apps/web/src/lib/config/clustering-tunables.ts`** (NEW):
- `validator.unreachableCeiling` / `clampReachableValue` — the #59 math rails (docs scoring math inline)
- `weights.tagMatchScore` / `threadMatchScore`
- `reminder.subjectSimilarity` / `maxAgeDays`
- `domainDefaults.<domain>` for all 6 domains

**Lowered unreachable domain thresholds** (preserving differentiation inside the reachable ~35 range without sender-entity match):
- construction 45 → 35 (was silently clamped to 30)
- legal 55 → 38 (preserves "tightest domain" intent)
- agency 45 → 33 (was silently clamped to 30)
- general 45 → 32 (was silently clamped to 30)
- school_parent (35), property (30) unchanged

**Architectural change:** `buildHypothesisPrompt(input, tunables)` now takes numerics as a parameter. Package boundary respected — `packages/ai` stays pure; `apps/web` injects config. Types `ClusteringTunables` + `DomainNumerics` exported from `@denim/ai`. Content (tags/fields/labels) stays with the prompt file as copy, not tuning surface.

**Verification:** two forensic-agent passes (one per tunables file) caught 3 stragglers — all fixed in `fe08121`. Every declared tunable now has at least one non-declaration reference, and no duplicate hardcoded values remain in the pipeline paths. Library-layer defaults (e.g., `getEmailFullWithPacing(delayMs = 100)`) intentionally kept as literals for non-pipeline callers.

### Issues this session
- **Closed:** #87 (synthesis maxTokens bump resolved by tunable)
- **Filed:** #88 (extractBatch concurrency measurement), #90 (remaining un-migrated hardcoded values: cluster.ts maxTokens, prompt slice caps, model IDs)
- **Commented:** #89 (tunables centralization — partial done, rest tracked in #90)

### Commits landed
- `e804b70` fix(synthesis): stamp synthesizedAt on failure so scan finalizes
- `74e2138` perf(extraction): extractBatch concurrency 3→8 + centralize fan-out tunables
- `b2c03fc` refactor(tunables): centralize pipeline + clustering knobs, bump synthesis maxTokens
- `a2ae6f2` refactor(tunables): move per-domain clustering numerics out of the prompt file
- `fe08121` refactor(tunables): promote discovery broadScanLimit + bodySampleCount, fix gmail pacing duplicate

### Updated forecast for next Property run (200 emails)
- Extraction: 169.5s → ~50s (−119.5s from concurrency 3→8)
- Other phases unchanged
- **Function B work: ~7m 35s → ~5m 35s (−26%)** vs ~9m baseline
- Case-splitting (108.9s) still the biggest serial chunk; recovered only if/when #86 deterministic day-2 routing lands

### Next action on resume
1. Nick runs Property E2E to verify extraction ~50s wall + lowered mergeThreshold effect on merge count/scores
2. If clean: dispatch Phase 4.1 (#63 batch `persistSchemaRelations`)
3. If regressions: bisect across `74e2138 → b2c03fc → a2ae6f2 → fe08121`

## 2026-04-15 Late-Afternoon Session — Routing Gaps Diagnosed + Fixed

### Testing gaps from Property run forensics

Nick surfaced two symptoms from eval of the 200-email Property run (schema `01KP8MRJQJXF302KP19NB5RAVR`). DB forensics against the live `routingDecision` JSONB revealed:

**Gap 1 — 3 emails wrongly excluded as `relevance:low`** (all with `relevanceScore=0`):
- 2× "Re: 3910 Bucknell - MR" from Maurice Gallardo (subject literally names a user PRIMARY; 11-email thread with 9 from Timothy Bishop + Vivek Gupta SECONDARY entities)
- 1× "Re: FW: Commercial property proposal" from Shane Bowen (reply to Vivek Gupta thread)

Root cause: relevance-gate bypass was `senderIsKnownEntity`-only. Subject-contains-PRIMARY and thread-has-known-entity were both ignored.

**Gap 2 — 5+ emails misrouted into 851 Peavy case despite subjects naming a different PRIMARY.** Forensic pull of `routingDecision.routeMethod`/`detail` for each misrouted email showed:
- Subject "Re: 3910 Bucknell Drive-Foundation" from Timothy Bishop had `method=relevance, relevanceEntity="851 Peavy"` (wrong)
- The SAME subject from other senders correctly routed to 3910 Bucknell
- Subject "North 40 Projects" routed to 851 Peavy with `relevanceEntity="851 Peavy"` — subject doesn't mention Peavy at all

Root cause: Gemini hallucinated `relevanceEntity` under batch extraction (CHUNK_SIZE=5). When 3-4 of the 5 emails in a batch were about 851 Peavy (highest-volume entity, 36 emails), that context bled into the others' outputs. Architectural flaw compounded it: Stage 1 (Gemini `relevanceEntity`) ran BEFORE Stage 2 (deterministic subject content match), so the hallucination trumped the authoritative subject signal.

### Fixes landed — commit `bb23fe7`

**Relevance-gate bypass expanded** to fire if ANY of three deterministic signals match:
1. Sender is a known entity (existing)
2. **Subject contains any known entity name or alias** (new)
3. **Thread has ≥1 prior email with `senderEntityId !== null`** (new — one `prisma.email.findFirst` per low-relevance reply)

Bypass reason now logged (`bypassReason: "sender" | "subject" | "thread"`) for eval visibility. No Gemini output is trusted in the bypass path — every signal is deterministic.

**Routing stage order swapped** to make subject authoritative:
1. **Stage 1 (NEW):** subject-only PRIMARY name/alias match — immune to batch-context bleed
2. Stage 2: Gemini `relevanceEntity` (demoted from Stage 1)
3. Stage 3: summary content match (renamed/split from old Stage 2)
4. Stage 4: `detectedEntities`
5. Stage 4b: mid-scan PRIMARY creation (#76)
6. Stage 5: sender fallback

New `routeMethod="subject"` value makes eval queries straightforward.

### Issues filed / state

- **#87 closed** earlier today (synthesis maxTokens 4096 → 6144 via tunable)
- **#88 open** — extractBatch concurrency 3→8 measurement (next run verifies)
- **#91 open** — bypass expansion + subject-first routing (next run verifies)
- **#38 partially addressed** by #91 — relevance filtering was "too conservative"; the bypass triple should improve it measurably

### Phase 3 + 4 status per sprint plan

Sprint plan reference: `docs/superpowers/plans/2026-04-14-perf-and-quality-sprint.md`

**Phase 3 verification gate — still OPEN:**
- [x] Task 3.1 code-complete (#77, `7c0d1d0`)
- [x] Task 3.2 code-complete (#78, `2c6b373` — synthesis fan-out only; case-splitting deferred to #86)
- [x] Task 3.3 code-complete (#82, `f3b54ff`)
- [x] Extraction bottleneck diagnosed + fixed (#88, `74e2138` — concurrency 3→8)
- [ ] **Full verification protocol — pending Nick's next E2E**
- [ ] Function B target: originally ~3m 40s; revised forecast ~5m 35s due to case-splitting (#86) still serial
- [ ] Eval tag coverage still 100%, orphan rate unchanged
- [ ] Live counter visible during synthesis

**Phase 4 — not started:**
- [ ] 4.1 — #63 batch `persistSchemaRelations` DB round-trips (ready to dispatch after Phase 3 verification)
- [ ] 4.2 — #73 review-screen render time investigation (needs timing data from next run)
- [ ] 4.3 — #25 scanning UX umbrella close (verify child issues shipped, then close)

### Commits landed this session (8 total on `feature/perf-quality-sprint`)

- `e804b70` fix(synthesis): stamp synthesizedAt on failure so scan finalizes
- `74e2138` perf(extraction): extractBatch concurrency 3→8 + centralize fan-out tunables
- `b2c03fc` refactor(tunables): centralize pipeline + clustering knobs, bump synthesis maxTokens
- `a2ae6f2` refactor(tunables): move per-domain clustering numerics out of the prompt file
- `fe08121` refactor(tunables): promote discovery broadScanLimit + bodySampleCount, fix gmail pacing duplicate
- `847f0a8` docs: 2026-04-15 late session block (tunables consolidation)
- `bb23fe7` fix(extraction): expand relevance-gate bypass + prioritize subject over Gemini relevanceEntity

### Next action on resume

1. **Nick runs full Property E2E** — fresh schema to exercise the new routing
2. **Pull verification data via `/supabase-db`:**
   - Route-method histogram: `SELECT "routingDecision"->>'routeMethod' AS method, COUNT(*) FROM emails WHERE "schemaId" = '<new>' GROUP BY 1 ORDER BY 2 DESC`
   - Bypass reason counts in logs for the new schema
   - Email counts in Peavy vs 3910 Bucknell vs North 40 cases (expect shift away from Peavy)
   - Any remaining `relevance:low` exclusions where subject names a known entity
3. **If #91 clean + #88 clean (extraction ~50s):** dispatch **Phase 4.1 (#63)** — batch `persistSchemaRelations`
4. **If regressions:** bisect across today's 8 commits — relevance-gate expansion and routing swap are the risk surface
5. **If timing on Function A is still slow:** Phase 4.2 (#73) review-screen investigation using `/onboarding-timing`

## What's Next

### Immediate
- ~~Full E2E on `feature/perf-quality-sprint` after Phase 2~~ ✅ done 2026-04-15 early AM (3 runs, all GOOD post-#85)
- **Phase 3 code-complete** ✅ 2026-04-15 PM (commits `7c0d1d0`, `2c6b373`, `f3b54ff`) — E2E measurement pending
- **Phase 4 (#63 batch round-trips → #73 review screen render → #25 umbrella close)** — ready to start after Phase 3 measurement

### Open pipeline issues (prioritized)
- **#73** Review screen timing — partially addressed by Plan 1; timing variance remains (~48–107s); will be re-measured at Phase 4.2
- **#59** PM threshold — default fixed for new schemas; existing at 45 may need data migration
- **#57** Raw email cache — Phase 5.5
- **#38** Eval Session 2 — Phase 5.2
- **#35** Extraction relevance gate — Phase 5.1
- **#19** Clustering non-determinism — extraction (Gemini) variance remains
- **#84** GmailMessageMeta Date JSON-replay hardening — latent only; defer
- **#86** Day-2 case-splitting (deterministic routing + deferred fan-out + no-op investigation) — strategic refactor; scope beyond this sprint

### After Sprint: Schema Additions
- `UserNote` model -- for the "+ Note" button in bottom nav
- `NotificationPreference` model -- daily digest opt-in
- `User.stripeCustomerId / subscriptionStatus / trialEndDate` -- billing fields

### After Schema Additions: Notes & Polish (UX Phase 4)
- Note creation modal from bottom nav
- Note list view
- Account settings page (currently 404 stub)
- Topic edit page (rename, delete, re-scan)
- Notification preferences UI

### User Testing
- Once merged, gather real-user feedback on the new flow
- Observe user corrections -> calibration loop tunes clustering automatically
- Learning loop: gravity model weight adjustment from feedback (not yet built)

### Future Phases
- **Phase 4 polish**: notes, account, topic edit, notifications
- **Phase 5 calendar**: progressive OAuth, CalendarService, Add to Calendar buttons
- **Phase 6B**: Chrome extension + side panel
- **Phase 7.5**: Periodic scanning (automated daily scans)
- **Phase 8**: Calendar integration
- **Phase 9**: Scan automation & delta processing
- Playwright e2e tests for onboarding + feed + case detail (manual E2E done, automated suite next)

See `docs/roadmap.md` for the full feature roadmap beyond UX.

