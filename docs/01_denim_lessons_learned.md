# Lessons Learned

Running log of production-impacting bugs, their root causes, and the architectural
rules they exposed as missing. Each entry should make the next engineer (or AI agent)
less likely to repeat the same class of mistake.

---

## 2026-04-09: Human test — three showstoppers on first click

**Context:** First live human test of the onboarding flow. All unit tests (133/133)
and integration tests (60/60) passed. The system failed on the very first user
interaction.

### Bug 1: FK constraint on `case_schemas.userId`

**Symptom:** `POST /api/onboarding/start` → 500, Prisma throws
`Foreign key constraint violated on case_schemas_userId_fkey`.

**Root cause:** Supabase creates users in `auth.users` during Google OAuth, but
nothing created the matching row in `public.users`. The auth callback was supposed
to handle this, but it had its own bug (Bug 2). The test helpers did it manually
with `prisma.user.upsert`, masking the gap.

**Fix:** Added `prisma.user.upsert` to `withAuth` middleware so every authenticated
request ensures the app-level user row exists.

**Rule exposed:** **Test helpers must not do work the production path doesn't.**
The `createTestUser()` helper upserted the user row, papering over the fact that
no production code did this. Integration tests passed because the helper did the
work, not because the system did.

**Architectural gap:** The Table Ownership Map in `engineering-practices.md` listed
User as owned by "AuthService", but there was no AuthService — just a test helper
and a token-storage function that happened to upsert. Ownership was claimed but
never implemented.

---

### Bug 2: Gmail tokens silently never stored

**Symptom:** Scan phase fails with "Gmail not connected. Please connect Gmail first."
despite completing OAuth successfully.

**Root cause:** The auth callback at `/auth/callback/route.ts` called
`supabase.auth.exchangeCodeForSession(code)` but destructured only `{ error }`,
discarding the `data` property. It then called `supabase.auth.getSession()` to
retrieve the session — but Supabase does **not** persist `provider_token` or
`provider_refresh_token` in session storage. They are only available in the
`exchangeCodeForSession` response. The token store code ran, found no
`provider_token`, logged a warning (`callback.storeTokens.skipped`), and continued.
The user was redirected as if everything worked.

**Fix:** Capture `{ data: exchangeData, error }` from `exchangeCodeForSession()`
and use `exchangeData.session.provider_token` directly.

**Rules exposed:**

1. **Warnings that indicate broken functionality must be errors.** A missing
   `provider_token` is not a "skip" — it means the core feature (Gmail access)
   will not work. The log level should have been `error`, and the callback should
   have redirected to an error page, not silently continued.

2. **Understand the session lifecycle of your auth provider.** Supabase's
   `provider_token` is ephemeral — it exists only in the OAuth exchange response.
   This is documented but non-obvious. When integrating third-party auth, document
   exactly where each token is available and verify with a real OAuth flow, not
   just unit tests with mocked sessions.

3. **The happy path must be tested with a real OAuth flow at least once before
   declaring a feature complete.** Mocked auth in integration tests cannot catch
   this class of bug.

---

### Bug 3: CAS race in fan-out-extraction

**Symptom:** `fan-out-extraction` Inngest function fails immediately with
`NonRetriableError` from `advanceScanPhase` CAS check. Pipeline stalls,
`run-onboarding` waits 20 minutes for a `scan.completed` event that never arrives.

**Root cause:** `runScan` emits the `scan.emails.discovered` event **inside** the
`work()` callback of `advanceScanPhase(DISCOVERING → EXTRACTING)`. The event is
dispatched to Inngest before the CAS `updateMany` commits. `fanOutExtraction`
starts, also calls `advanceScanPhase(DISCOVERING → EXTRACTING)`, reads the
not-yet-updated phase, passes the guard, runs its `work()`, then loses the CAS
race when `runScan`'s `updateMany` commits first.

**Fix:** Removed the redundant `advanceScanPhase` call from `fanOutExtraction`.
`runScan` owns the DISCOVERING → EXTRACTING transition; `fanOutExtraction` just
updates status fields.

**Rule exposed:** **Each CAS transition must have exactly one owner, and the owner
must not emit downstream events inside the `work()` callback.** If function A
advances phase X → Y and emits an event that triggers function B, and B also tries
to advance X → Y, the CAS is no longer a guard — it's a race. The event emission
must happen **after** the CAS commits (outside `work()`), or the downstream
function must not attempt the same transition.

**Architectural gap:** `engineering-practices.md` documents single-writer table
ownership but says nothing about CAS transition ownership. The state machine
refactor (Task 18) introduced `advanceSchemaPhase` and `advanceScanPhase` as CAS
helpers, but didn't codify the rule that each `from → to` pair must be owned by
exactly one function.

---

## 2026-04-10: Auth error handling — duplicated decision logic

**Context:** Fixing a UX bug where expired Gmail tokens showed a generic "Setup
failed" error instead of prompting the user to reconnect. The fix required
detecting auth-related error messages in two places: the Inngest pipeline (to
skip retries and fail fast) and the onboarding UI (to show a "Reconnect Google"
button). Both ended up with identical pattern-matching functions that checked
the same four string substrings.

### Bug 4: Duplicated error classification with no shared source of truth

**Symptom:** After fixing the auth error UX, the "Reconnect Google" screen
didn't appear for "Gmail access revoked, please reconnect." because only one of
the two detection functions included "revoked" as a pattern. The server-side
copy had it, the client-side copy didn't.

**Root cause:** Auth error detection logic was written inline in two files:
`isGmailAuthError()` in `lib/inngest/functions.ts` and `isAuthError()` in
`components/onboarding/phase-failed.tsx`. Both checked against hardcoded string
patterns tied to exact error messages thrown by `lib/services/gmail-tokens.ts`.
When the pattern list was updated in one file, the other wasn't updated — a
classic drift bug.

The same duplication pattern existed for Gmail OAuth configuration (scope,
`access_type`, `prompt`) across 4 client components and 1 server route, and for
the authenticated-fetch boilerplate (session check + Bearer header) across 8+
components.

**Fix:** Extract each duplicated decision into a single shared module:
- `lib/gmail/auth-errors.ts` — auth error pattern matching
- `lib/gmail/oauth-config.ts` — OAuth scope and `signInWithGmail()` helper
- `lib/supabase/authenticated-fetch.ts` — `authenticatedFetch()` helper

**Rule exposed:** **When the same decision logic appears in more than one file,
extract a single source of truth.** The canonical location should live near the
domain it describes — Gmail auth patterns live in `lib/gmail/`, not in a generic
`utils/` folder. The key test: if someone changes the source of truth (e.g., an
error message in `gmail-tokens.ts`), does the consumer break at compile time or
silently at runtime? String matching inherently breaks at runtime, so minimizing
the number of copies minimizes the blast radius.

**What is NOT duplication:** Similar-looking code that serves different purposes
at different architectural layers. Phase mappings in `onboarding-state.ts` (CAS
ordering), `onboarding-polling.ts` (DB-to-API flattening), and `flow.tsx`
(phase-to-component routing) look like three copies of the same enum, but they
are three distinct transforms. TypeScript exhaustiveness checking on the switch
in `flow.tsx` catches drift if a new phase is added. Likewise, Prisma queries
that load similar relations for different pipeline stages (extraction vs.
synthesis vs. clustering) are semantically different — coupling them via a shared
loader would be premature abstraction.

---

## 2026-04-10: Round 2 duplication audit — Bug 1 reappeared

**Context:** After shipping Round 1 duplication cleanup (auth errors, OAuth
config, authenticated fetch, skeleton), a deeper audit found 5 more patterns
with real drift risk. One of them was a direct repeat of Bug 1 from 2026-04-09
— the same class of bug, in a slightly different shape, one day later.

### Bug 5: Test helper re-diverged from production auth upsert

**Symptom:** During the Round 2 audit, the `createTestUser` integration test
helper was found to be doing `prisma.user.upsert` with an **id-first** where
clause. Production `withAuth` middleware does an **email-first** upsert to
handle Google account re-auth where Supabase may rotate the userId between
sessions. These are semantically different — a test passing with id-first
does not verify the production path works.

**Root cause:** When Bug 1 was fixed on 2026-04-09, the production middleware
was updated to do the email-first upsert, and the test helper was left with
its own id-first upsert "because the test is isolated and doesn't need the
re-auth handling." That reasoning was wrong in the same way Bug 1 was wrong:
**if the test helper does DB work that production also does, but differently,
then the test doesn't exercise the production code path.** A regression to
production auth would not be caught by tests.

**Fix:** Extract `ensureUserRow()` into `lib/services/user.ts`. Both
`withAuth` middleware and `createTestUser` helper call it. Single code path,
single behavior, drift is impossible.

**Rule exposed (re-confirming the 2026-04-09 rule, now with a second
data point):** **Any DB operation that happens in both test setup and
production code MUST be extracted into a shared function.** The test helper
calling through the same function as production is non-negotiable — there
is no "lightweight test version" exception. If the production function is
too slow or heavy for tests, the right fix is to speed up the production
function, not to reimplement it in the test helper.

**Meta-observation:** Bug 1 and Bug 5 are the same bug at two different
severity levels. Bug 1 was caught on a live human test after 133/133 tests
passed. Bug 5 was caught by a duplication audit, not by tests. This means
**the test suite still cannot catch this class of bug** even after Bug 1's
fix. The only defense is the extraction rule above, applied preventively
during code review.

### Other Round 2 findings (not new bugs, but drift risk eliminated)

All extracted to shared modules in the Round 2 cleanup:
- `lib/middleware/ownership.ts` — `assertResourceOwnership` (was 9 routes
  hand-coding auth checks, 2 skipped for security-by-obscurity preservation)
- `lib/middleware/request-params.ts` — typed URL param extraction (was 4
  different approaches across 9 routes)
- `lib/logger-helpers.ts` — `withLogging` wrapper (was 10 hand-written
  start/duration pairs; also caught a latent `operation` name collision
  in cluster.ts `applyCaseSplitResult`)
- `lib/ai/cost-constants.ts` + `lib/ai/cost-tracker.ts` — `logAICost` and
  centralized model pricing (was 3 files duplicating Claude pricing constants
  and 6 sites writing ExtractionCost rows)

---

## 2026-04-13: Inngest step that writes DB rows must use upsert, not create

**Context:** Building the new `expand-confirmed-domains` step in Function B
(post-confirm Pass 2 domain expansion). The step writes new discovered Entity
rows at the end of its work inside a `prisma.$transaction`. First draft used
`prisma.entity.create` per discovery. Code review flagged it before merge.

### Bug 6 (caught pre-merge): Non-idempotent Entity writes in a retryable Inngest step

**Symptom:** Would have surfaced as a unique-constraint violation on Inngest
retry. The `@@unique([schemaId, name, type])` index on `entities` would reject
the second create for the same name. The outer try/catch in the step swallows
errors, so the pipeline would continue — but we'd waste a full Pass 2 on retry
(5 targets × up to 200 emails each through Gemini + Claude) before the
duplicate write failed the transaction and rolled back.

**Root cause:** Inngest steps re-execute from the top on retry. Any DB write
that happens outside of an idempotency guard will run again. Using `create`
inside a transaction means the retry either: (a) succeeds with a duplicate
row if no unique constraint exists, or (b) fails with a constraint violation
after wasting all the upstream I/O and AI spend.

**Fix:** Replaced with `prisma.entity.upsert({ where: { schemaId_name_type:
... }, create: {...}, update: {} })`. Empty `update` means idempotent retries
are a no-op. The unique constraint becomes the guard, not the trap.

**Rule exposed:** **Any Inngest step that writes DB rows must use `upsert` (or
an explicit idempotency guard at the top of the step), not `create`.** The
pattern:
- `create` is safe only if (a) the parent function has `retries: 0` AND (b)
  no retry mechanism exists upstream (no `waitForEvent`, no backoff).
- `upsert` with empty `update: {}` is the default for any insert that might
  re-run. Pair it with a composite unique constraint on the logical identity.
- For writes that genuinely need "did we already do this" semantics (e.g.,
  "don't charge the card twice"), add an idempotency-token column and
  check/insert it as the first step of the work.

**Meta:** This was caught by code review, not by tests. Like Bug 1 and Bug 5,
the test suite cannot detect this class of bug — Inngest retries are a
property of the runtime, not the code. Preventive review is the only defense.
Add to the review checklist: for every new `step.run(..., async () => {
...prisma.* })` block, verify all writes are idempotent.

---

## 2026-04-15: Fan-out pattern is not one-size-fits-all

**Context:** Sprint Phase 3 aimed to parallelize BOTH Claude synthesis AND Claude case-splitting via Inngest fan-out (issue #78). Synthesis fan-out landed cleanly in `2c6b373`. Case-splitting fan-out was deferred to a follow-up issue (#86) after discovering the two phases have structurally different AI call shapes.

### Discovery 7: Not every per-item-serial Claude phase is a fan-out candidate

**Symptom:** Plan called for "mirror the three-function shape" used for synthesis (`synthesizeCaseWorker` + `checkSynthesisComplete`) on case-splitting. Agent investigating the refactor found that the mirror did not exist: case-splitting is not per-case at the AI layer.

**Root cause:** Two phases that look similar from the outside have different AI call shapes:

- **Synthesis** — one Claude call per Case. Inputs for each call are independent. Natural completion marker on the row (`Case.synthesizedAt`). Writes are idempotent per-case. **Fans out cleanly.**
- **Case-splitting** — one Claude call per *scan*, taking ALL coarse clusters at once. Claude decides splits across the entire set — clusters can merge or split *relative to each other*. The write path is a single atomic delete-coarse / create-split transaction in `cluster.ts`. No per-cluster completion marker. **Does not fan out without refactoring both the Claude call shape AND the write-owner transaction.**

**Rule exposed:** **Before dispatching a fan-out refactor, verify the AI call is actually per-item.** A phase taking N seconds per N items does not imply N independent Claude calls. The three questions to answer before agreeing to fan out:
1. Is the AI call per-item, or cross-item? (Read the prompt-builder input shape.)
2. Does a per-item completion marker exist on the row, or is completion scan-level? (Read the schema.)
3. Is the write path per-item or atomic-all? (Read the service write phase.)

If any answer is "cross-item" or "atomic-all," fan-out requires an upstream refactor first. Either reshape the Claude call (one-per-item), or route the work through a different optimization (deterministic short-circuit, cheaper model, caching).

**Meta-lesson:** The deferred work was not a regression or a bug — it was a correct stop. The agent could have forced the refactor to fit the plan's shape, but the resulting code would have been wrong (either race conditions between per-cluster writes, or silent correctness loss from splitting a decision that needs global context). **Surfacing "this does not fit" is a first-class outcome.** The follow-up issue (#86) captured the architectural discussion and proposed an alternative (deterministic day-2 routing via learned vocabulary) that is both more impactful and more natural for the code's actual shape.

---

## 2026-04-15: Onboarding and day-2 share the same code path

**Context:** Discussion during Phase 3 of the sprint surfaced an architectural distinction that is not currently reflected in the code: the system has two operating modes with very different cost/latency tolerances, but only one pipeline implementation.

### Discovery 8: The cron path and the onboarding path are the same workflow

**Symptom:** No runtime bug — this is latent architectural debt, surfaced during design discussion.

**Root cause:** `cronDailyScans` (`apps/web/src/lib/inngest/cron.ts:81`) fires a generic `scan.requested` event for each stale ACTIVE schema. This event is handled by `runScan` (`apps/web/src/lib/inngest/scan.ts:34`) — whose doc comment explicitly says it is "the parent workflow for every scan trigger (onboarding, cron, manual, feedback)". The chain (discovery → extraction → coarse clustering → case splitting → synthesis) runs unchanged for both a 200-email onboarding scan and a 5-email daily cron scan.

Implications that surface only at volume:
- Daily cron for an active schema re-runs full Gemini extraction, full Claude case-splitting, and full Claude synthesis for each batch of 2-20 new emails. At 100 users × daily × 10 emails average, that is substantial Claude/Gemini spend for what should be mostly deterministic routing.
- The `learnedVocabulary` input field in `packages/ai/src/prompts/case-splitting.ts:31` is designed to let Claude build on prior calibration — but there is no path today that uses it *deterministically* (matching against vocabulary without the Claude call) when the entity is known.

**Rule exposed:** **When a system has distinct operating modes (e.g., first-time vs. steady-state), the code should branch early, not run the same pipeline for both.** Sharing a code path between "generous cost/latency budget, must discover what matters" and "tight cost/latency budget, must match against what we already discovered" is a debt position. The branch point should be as early as the control flow allows (here: `runScan` reading `ScanJob.triggeredBy`).

**Important caveat preserved in #86:** Even with day-2 deterministic routing, entity discovery (inter-entity) must stay dynamic. If "567 Maple St" appears in a new email, it must surface as a new primary entity with its own coarse cluster. Only case-splitting (intra-entity, within a known entity with learned vocabulary) is a candidate for determinism. Collapsing these two concerns is how you miss genuinely new things.

**Meta:** This is the same class of latent debt as Bug 4 (duplicated auth error classification across files) — one implementation serving two semantically-different purposes. The difference is scale: Bug 4 duplicated across ~10 lines per file; this one duplicates the full pipeline's cost structure across two operating regimes. Deferred to #86 as a strategic refactor rather than a hot fix.

---

## Patterns to watch for

These bugs share common shapes. When you see one of these patterns, stop
and verify before shipping.

### 1. "The test helper does it"

If a test helper creates data, provisions resources, or performs setup that the
production code path also needs — verify the production path actually does it.
Test helpers should **use** the production code, not **replace** it.

**Check:** For every `create`/`upsert` in test helpers, grep for the same
operation in `apps/web/src/`. If it only exists in `tests/`, you have a gap.

### 2. "The warning is fine"

If a code path logs a warning and continues, ask: **does the user's feature still
work?** If not, it's not a warning — it's a silent failure. Warnings are for
degraded-but-functional states. Missing OAuth tokens are not degraded; they are
broken.

**Check:** Grep for `logger.warn` in critical paths (auth, token storage, event
emission). Each one should have a comment explaining why the feature still works
without whatever was warned about.

### 3. "Two functions, same transition"

If an Inngest event triggers a function that advances the same phase the emitter
just advanced, you have a race. The CAS helper will catch it at runtime, but
runtime failures in a pipeline mean stalled workflows and confused users.

**Check:** For every `advanceScanPhase` / `advanceSchemaPhase` call, verify the
`from → to` pair appears in exactly one Inngest function. If two functions share
the same transition, one of them shouldn't be calling the CAS helper.

### 5. "Same logic, two files"

If the same decision (error classification, config values, feature flags) is
implemented in more than one file, the copies will drift. String-based matching
is especially dangerous because drift is silent — no compiler error, no test
failure, just a user who sees the wrong screen.

**Check:** When adding logic that classifies, detects, or decides, grep for
similar patterns in the codebase first. If you find a match, extract a shared
module before adding another copy.

### 4. "Match on a field the trigger doesn't have"

Inngest `waitForEvent({ match: "data.someField" })` compares the incoming event's
field against the **same field on the trigger event**. If the trigger event doesn't
have that field, the comparison is `undefined !== actualValue` — it silently never
matches, and the workflow times out.

**Check:** For every `waitForEvent` with a `match` clause, verify the matched field
exists on both the trigger event schema AND the awaited event schema. If the field
names differ between events, you can't use `match` — use `if` instead.

---

## CAS Transition Ownership Map

Added 2026-04-09 after Bug 3. Each `from → to` transition must be owned by
exactly one Inngest function.

### ScanJob.phase transitions

| Transition | Owner | Notes |
|---|---|---|
| PENDING → DISCOVERING | `runScan` | |
| DISCOVERING → EXTRACTING | `runScan` | Emits `scan.emails.discovered` after CAS commits |
| DISCOVERING → COMPLETED | `runScan` | Empty-scan short circuit |
| EXTRACTING → CLUSTERING | `runCoarseClustering` | |
| CLUSTERING → SYNTHESIZING | `runSynthesis` | |
| SYNTHESIZING → COMPLETED | `runSynthesis` | Emits `scan.completed` inside work (safe — no downstream function re-advances) |

### CaseSchema.phase transitions

| Transition | Owner | Notes |
|---|---|---|
| PENDING → GENERATING_HYPOTHESIS | `runOnboarding` (Function A) | |
| GENERATING_HYPOTHESIS → AWAITING_REVIEW | `runOnboarding` (Function A) | Hypothesis + validation stored as JSON |
| AWAITING_REVIEW → PROCESSING_SCAN | `POST /api/onboarding/:schemaId` | API route, CAS via updateMany |
| PROCESSING_SCAN → COMPLETED | `runOnboardingPipeline` (Function B) | Sets status=ACTIVE in work callback |
| PROCESSING_SCAN → NO_EMAILS_FOUND | `runOnboardingPipeline` (Function B) | |

Updated 2026-04-13: Pipeline resequenced so AWAITING_REVIEW comes before
PROCESSING_SCAN. The user confirms entities on the review screen before the
pipeline runs. `runOnboarding` was split into Function A (pre-review) and
Function B (`runOnboardingPipeline`, post-review). The AWAITING_REVIEW →
PROCESSING_SCAN transition is owned by the API route (not Inngest) because
it requires user input. This is safe: the API route uses CAS (updateMany
with WHERE phase=AWAITING_REVIEW) and Function B only starts after receiving
the `onboarding.review.confirmed` event that the route emits post-CAS.
