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

## Patterns to watch for

These three bugs share common shapes. When you see one of these patterns, stop
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
| PENDING → GENERATING_HYPOTHESIS | `runOnboarding` | |
| GENERATING_HYPOTHESIS → FINALIZING_SCHEMA | `runOnboarding` | |
| FINALIZING_SCHEMA → PROCESSING_SCAN | `runOnboarding` | |
| PROCESSING_SCAN → AWAITING_REVIEW | `runOnboarding` | |
| PROCESSING_SCAN → NO_EMAILS_FOUND | `runOnboarding` | |

All schema-phase transitions are owned by a single function (`runOnboarding`),
so no cross-function races are possible.
