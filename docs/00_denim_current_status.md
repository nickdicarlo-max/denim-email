# Denim Email — Current Status

Last updated: 2026-04-14 (doc cleanup; history moved to `docs/archive/denim_session_history.md`)

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

## What's Next (updated 2026-04-14)

### 2026-04-14 audit
Ground-truth audit confirmed plan-to-code fidelity for both 2026-04-13 plans (review-screen-speed and pipeline-resequencing) — no hallucination. Real gap is verification, not correctness. Follow-ups filed: **#67** (outbox for confirm route), **#68** (Entity `@@unique([schemaId,name])`), **#69** (Inngest retries 0→2), **#70** (validation-parser tests), **#71** (happy-path test audit/delete), **#72** (CI integration job + Playwright onboarding E2E), **#73** (review screen 107s vs 45s target — observed in first live run). **#56** closed (resolved by Plan 1).

### Immediate: Task 14 manual E2E verification
- Fresh onboarding run on `feature/ux-overhaul` to confirm <30s review-screen target
- Verify ZSA U11/12 Girls, TeamSnap, Pia spring dance show appear under their user topics
- Gates the merge to `main`

### Immediate: Verify clustering fixes with live pipeline run
- Run a fresh GA schema to confirm MERGE cluster records appear (not just CREATEs)
- Run a fresh PM schema to confirm threshold=30 produces merges
- Verify case tags display on feed cards
- Verify case-splitting writes PipelineIntelligence rows (success or error)

### Immediate: Merge feature/ux-overhaul to Main
- All 3 UX waves + pipeline fixes committed on `feature/ux-overhaul`
- Typecheck clean, 133 unit tests passing
- Ready for PR + merge to `main`

### Open pipeline issues (prioritized)
- **#59** PM threshold (partial) -- default lowered for new schemas, but existing
  PM schemas in DB still have 45. Consider calibration prompt fix or data migration.
- **#19** Clustering non-determinism -- partially resolved by #58 (merges no longer
  silently dropped). Remaining variance is from AI extraction (Gemini non-determinism).
- **#57** Raw email cache -- second topic re-fetches every email already pulled.
- ~~**#56** Wire validateHypothesis back into runOnboarding.~~ Resolved by the 2026-04-13 review-screen work — `validateHypothesis` is threaded through Function A (see `onboarding.ts` validate-hypothesis step). Verify and close.
- **#38** Eval Session 2 -- relevance filtering too conservative, review screen too passive.
- **#35** Extraction relevance gate excludes valid emails.
- **#16** Silent email dropping -- may be resolved; needs re-verification.

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

