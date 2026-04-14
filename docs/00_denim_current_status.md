# Denim Email — Current Status

Last updated: 2026-04-14 (E2E verification day — outbox confirm route, mid-scan PRIMARY discovery, 6 perf issues filed)

Historical sessions (Phases 0–7 baseline, per-phase detail, bug archaeology): `docs/archive/denim_session_history.md`.

## Baseline

Phases 0–7 complete. `feature/ux-overhaul` carries Waves 1–3 of the UX overhaul plus the 2026-04-12 pipeline fixes and 2026-04-13 review-screen/entity-grouping work documented below. Typecheck clean; 133 unit tests passing; pending manual E2E verification before merge to `main`.

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

## What's Next

### Immediate
- Merge `feature/ux-overhaul` to `main` — two clean E2E runs, 6/6 eval PASS each, nothing blocking
- Sprint-plan #77–#82 (speedup) + UX Phase 4 items

### Open pipeline issues (prioritized)
- **#73** Review screen timing — partially addressed by Plan 1; timing variance remains (~48–107s)
- **#59** PM threshold — default fixed for new schemas; existing at 45 may need data migration
- **#57** Raw email cache — second topic re-fetches every email already pulled
- **#38** Eval Session 2 — relevance filtering too conservative, review screen too passive (paired with #75 orphan mining)
- **#35** Extraction relevance gate excludes valid emails (paired with #76 fix)
- **#16** Silent email dropping — clean on 80 + 200 runs; needs larger-scan verification
- **#19** Clustering non-determinism — extraction (Gemini) variance remains

### After Merge: Schema Additions
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

