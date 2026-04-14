# Denim Email — Current Status

Last updated: 2026-04-14 (evening — perf + quality sprint kickoff; Phase 1 + 2 code-complete on `feature/perf-quality-sprint`)

Historical sessions (Phases 0–7 baseline, per-phase detail, bug archaeology): `docs/archive/denim_session_history.md`.

## Baseline

Phases 0–7 complete. **`feature/ux-overhaul` merged to `main` on 2026-04-14 via PR #83** (merge commit `ff8aa43`). Active branch is now `feature/perf-quality-sprint`. Typecheck clean; 144 unit tests passing (up from 139 after #70 added validation-parser tests); Phase 3 pending Nick's full E2E verification against Phase 2 changes.

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

## What's Next

### Immediate
- Full E2E on `feature/perf-quality-sprint` after Phase 2 (Nick's gate)
- Then: Phase 3 (#77 batch extraction → #78 synthesis fan-out → #82 live case count)

### Open pipeline issues (prioritized)
- **#73** Review screen timing — partially addressed by Plan 1; timing variance remains (~48–107s); will be re-measured at Phase 4.2
- **#59** PM threshold — default fixed for new schemas; existing at 45 may need data migration
- **#57** Raw email cache — Phase 5.5
- **#38** Eval Session 2 — Phase 5.2
- **#35** Extraction relevance gate — Phase 5.1
- **#19** Clustering non-determinism — extraction (Gemini) variance remains
- **#84** GmailMessageMeta Date JSON-replay hardening — latent only; defer

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

