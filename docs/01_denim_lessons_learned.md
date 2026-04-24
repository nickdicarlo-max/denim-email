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

## 2026-04-16: Config-as-spec still needs runtime validation before locking

**Context:** Entity Robustness Phase 1 produced 3 locked per-domain spec files (`property.md`, `school_parent.md`, `agency.md`) under `docs/domain-input-shapes/`. Each contains a Stage 1 Gmail keyword list that will drive domain detection in the forthcoming fast-discovery onboarding rebuild (issue #95). The agency keyword list was drafted from consulting-industry formal vocabulary (invoice, scope, deliverable, retainer, kickoff, SOW, milestone, etc.) and shipped with a `Status: DRAFT — Nick to review` marker. Before flipping to LOCKED, we validated against a local sample of 417 real Gmail messages from Nick's inbox.

### Discovery 9: The drafted agency keyword list had 0% recall on known-agency senders

**Symptom:** Running the draft keyword list against 19 emails from 3 known-agency senders (Portfolio Pro Advisors × 2 contacts, Stallion × 1 contact) produced **0/19 subject matches**. Every single known-agency email would have been filtered out by Stage 1's keyword gate.

**Root cause:** The gap between drafted vocabulary and *observed* vocabulary. The draft list captured how consulting is *described on a website* (commercial, contractual, project-lifecycle terms). Actual client traffic uses *working* vocabulary — "AI Session #2", "V7 Update - Teams Call", "Stallion slides", "Few documents", "Intermediate Round - Demo File To Use", "Rhodes Data Test Sample". The formal list and the working list overlap almost not at all.

**Fix:** Extended the agency list with 10 working-vocabulary terms (`call, meeting, session, update, slides, documents, demo, round, initiative, project`). Post-extension:
- Per-email subject recall: 0% → 42%
- And — more decisively — both client domains now land in Stage 1's top-5 domain aggregation (ranks 2 and 4 of 10 candidates in the sample).

The domain-aggregation result is the one that matters. Stage 1's job is not to match every email; it's to surface the sender domain. A few keyword hits per domain is enough for the domain to rank.

**Rule exposed:** **Configuration that reads like a spec (keyword lists, regex patterns, threshold values) still needs to be validated against real production-shaped data before it's locked.** A markdown table of "Stage 1 keywords" reviewed by a domain expert is not sufficient evidence — the expert's intuition reflects formal vocabulary, and the real data reflects informal vocabulary. The gap between them is invisible until you run the filter.

**The validation workflow** (applied to the agency list, re-usable for every future domain):

1. **Collect an oracle.** A small list of senders the user confirms are in-scope for the domain. For agency, Nick named 3 addresses across 2 client domains. The oracle does not need to be large; it needs to be ground truth.
2. **Collect a realistic inbox sample.** The `denim_samples_individual/` folder holds 417 Gmail JSON files (`payload.headers`, `payload.parts[].body.data` as UTF-8 byte arrays, `labelIds`). Gitignored — local-only, because it contains real PII.
3. **Per-sender recall script.** Walks the sample, filters to the oracle senders, counts per-keyword subject matches against each sender's emails. Reports N/N matched, top keywords, and a list of *missed* subjects so the reviewer can eyeball what vocabulary is absent. The miss list is where the signal comes from — it reveals the gap between drafted and observed vocabulary in a glance.
4. **Stage 1 aggregation simulation.** Walks the sample with the full Stage 1 filter chain applied (`-category:promotions`, drop `PUBLIC_PROVIDERS`, drop user's own domain), groups keyword-matching emails by sender domain, reports top-10 domains by filtered count, and reports the **rank** of the target domains. This is the question that actually matters: does the domain land in top-5?

**The decision rule:** flip `DRAFT → LOCKED` only when both are true —
- Per-email recall is meaningful (>30%) on the oracle senders, AND
- Oracle domains rank in Stage 1's top-5 after filtering.

Per-email recall alone is insufficient. A domain can rank top-5 with only modest per-email recall if the domain has enough total traffic.

**Why the validator scripts stay untracked:** they embed specific business contacts and reference a gitignored sample folder. The *result* of the validation (recall numbers, domain ranks) is captured in the `LOCKED` marker inside the spec file so the validation trail survives even without the scripts. Future domain validation (construction, legal, general, company-internal per issue #94) re-writes the scripts rather than depending on artifacts in the repo.

**Meta:** This is a config-correctness analog of Bug 1, Bug 5, and Bug 6 — the test suite cannot catch this class of mistake because there is no test suite for a markdown file. The only defense is this manual validation gate, applied preventively before the spec file is treated as authoritative by downstream code.

**Rule for Phase 2+ of the fast-discovery rebuild (issue #95):** the Stage 1 keyword list must be read from the spec files at runtime AND the same validation harness must be runnable against any fresh user inbox during onboarding, so a user whose vocabulary diverges from the lab sample can be detected and flagged before the onboarding silently misses their domains.

---

## 2026-04-18: Gmail reconnect loop — Bug 2 reappeared as a Next.js boundary trap

**Context:** First live E2E of the post-#95 onboarding flow. User hit the scan phase, got a "Google connection lost" screen, clicked Reconnect Google, completed OAuth consent — and landed back on the same failure screen. Three retries, same result. Logs showed the OAuth callback was firing and returning 200, but `user.googleTokens` stayed NULL in the DB.

### Bug 7: Server route imports a constant from a `"use client"` module → TypeError swallowed as warn

**Symptom:** `/auth/callback` redirected to the happy-path destination, but `user.googleTokens` was never written. UI rendered "Google connection lost" on the next poll, user re-OAuthed, same stall. Infinite reconnect loop with no user-visible error.

**Root cause (two compounding failures):**

1. **Client Reference wrap at the module boundary.** `GMAIL_SCOPES` was exported from `apps/web/src/lib/gmail/oauth-config.ts`, which had `"use client"` at the top (the file also exports the client-only `signInWithGmail` function). When `/auth/callback/route.ts` (a server route) imported `GMAIL_SCOPES` from that file, Next.js App Router's RSC layer wrapped the export into a **Client Reference object** — not the raw string. Inside `storeGmailTokens`, the scope check `tokens.scope.includes("gmail.readonly")` threw `TypeError: tokens.scope.includes is not a function` because `.includes` isn't on a Client Reference.

2. **The try/catch in the callback logged `warn` and continued to happy-path redirect.** The TypeError got swallowed by a `logger.warn({ operation: "callback.storeTokens.failed" })` block, then the callback issued a 307 redirect to `/onboarding/category` as though storage had succeeded. The user saw a normal-looking redirect into the app, where the next poll immediately hit the "no credentials" state and rendered the reconnect screen again.

**This is Bug 2 (2026-04-09) reappearing.** Same class — *a broken critical feature swallowed as a warn* — different mechanics. Bug 2's rule was explicitly documented (*"Warnings that indicate broken functionality must be errors"*) but the callback's outer try/catch still used `warn` + continue on a path where continuing was never safe.

**Fix (shipped as issue #105, commits `d34e8c4` → `3a7245b`): `GmailCredentials` bounded context.** Not a patch on the specific instance — a structural refactor that makes the class of bug impossible to write.

- **One module owns credentials.** `apps/web/src/lib/gmail/credentials/` is the sole owner of the `user.googleTokens` column. Every read/write goes through its typed API (`getCredentialRecord`, `getAccessToken`, `storeCredentials`, `invalidateCredentials`). No other code reaches the column directly.
- **Zod parsing at every external trust boundary.** Supabase exchange response, Google `/token` refresh response, Google `tokeninfo` response — all Zod-parsed on entry. A shape drift (Client Reference wrap, API change, scope denial) surfaces as a clean `ValidationError`, not a `TypeError` five frames deep.
- **Typed errors replace string matching.** `GmailCredentialError` (extends `AuthError`) carries a `CredentialFailure` payload (`{ reason, remedy }`). The UI branches on `response.credentialFailure?.remedy === "reconnect"` — no more `matchesGmailAuthError(errorMessage)` string-match that would break whenever server-side error text drifted.
- **Fail-closed everywhere.** Every auth-adjacent catch block in the callback ends in a visible error redirect with a typed `reason` code. No `warn` + continue. If credentials can't be stored, the user sees an error page, not a fake-success redirect.
- **Server/client module boundary enforced structurally.** `lib/gmail/` split into three sub-directories:
  - `shared/` — constants, no directives, importable from either side
  - `client/` — `"use client"`, functions/components only
  - `credentials/` — server-only
  And a Biome `noRestrictedImports` rule in `biome.json` fails CI if any file under `credentials/`, `shared/`, `lib/inngest/**`, `lib/services/**`, `lib/middleware/**`, `app/api/**`, or `app/auth/**/route.ts` imports from `lib/gmail/client/**`. Verified by probe: intentional violation fails `biome check` with the project-specific error message.

**Rule 1 (exposed, preventive): External boundary responses must be Zod-parsed before reaching business logic.** Never pass a raw response shape (Supabase exchange, Google `/token`, Gmail API) into storage or classification code. A parser schema at the boundary turns runtime `TypeError` into a typed `ValidationError` at the place it happens.

**Rule 2 (re-affirmed, now with a second data point after Bug 2): Catch blocks in auth paths must fail closed.** If `storeCredentials` throws, the ONLY correct response is an error redirect or an error response — never a redirect to a happy-path destination. `warn` + continue is banned in any catch block whose try block can leave the system in an inconsistent state (missing credentials, uncommitted CAS, half-written events).

**Rule 3 (exposed, structural): Constants shared between server and client must live in a `shared/` directory with no `"use client"` directive. Never re-export a plain value from a `"use client"` module.** TypeScript does not warn when a server file imports a value from a `"use client"` module — it only sees a valid import. The Client Reference wrapping happens at bundle time. The only defenses are (a) a directory convention that makes the intent visible, and (b) a Biome `noRestrictedImports` rule that fails CI on cross-boundary imports. Both are now in place for `lib/gmail/`; new subsystems that cross the client/server line (future Slack integration, calendar, extension bridge) must adopt the same three-directory layout.

**Meta:** This is the third time a Bug-2-class failure has shipped (2026-04-09 original, 2026-04-10 Bug 4 duplication variant, now this). Each prior fix addressed the specific instance without closing the class. The #105 refactor is the first fix that closes the class structurally — typed errors make string-matching unreachable, Zod at boundaries makes untyped inputs unreachable, the Biome rule makes the Client Reference wrap unreachable. Preventive rigor moved from "code review catches it" to "CI catches it by construction."

**Verification artifacts:**
- Contract test fixtures under `apps/web/src/lib/gmail/credentials/__tests__/fixtures/` — real recorded shapes for Supabase exchange (with/without provider_token) and Google `/token` (happy/invalid_grant). Parsers test suite catches any future shape drift at CI time.
- Biome rule verified with a temporary violation probe — rule fires with the project-specific message citing the 2026-04-18 bug and pointing at the `shared/` alternative.
- Net code change: **+93 insertions, −345 deletions** across steps 1–7. The bounded context replaces ~400 lines of scattered string-based auth handling.

---

## 2026-04-19: Inngest system events must be registered in DenimEvents

**Context:** During #109 investigation, noticed `run-coarse-clustering (failure)` initializing in the Inngest log paired with `POST /api/inngest?fnId=...-failure&stepId=step 400` from Next. The onFailure handler couldn't actually run — Inngest rejected its invocation at the validation layer.

### Discovery 10: `inngest/function.failed` must be in the typed event union or every `onFailure` handler 400s

**Symptom:** When a function exhausts retries and terminally fails, Inngest dispatches an internal `inngest/function.failed` event. Functions declared with `inngest.createFunction({ ..., onFailure })` implicitly listen on this event filtered by `function_id`. With the event missing from `DenimEvents`, Inngest rejected the onFailure call with `EventValidationError: Event not found in triggers: inngest/function.failed`. Net effect: scans crashed at whatever phase the pipeline died at, no terminal `status=FAILED` got written, no `scan.completed` reason=failed event fired, the schema hung in `PROCESSING_SCAN` until the 20-minute `runOnboarding.waitForEvent` timeout — or indefinitely if the schema was created by the old code path without the timeout.

**Root cause:** `packages/types/src/events.ts` defined the app's custom events (`onboarding.*`, `scan.*`, `extraction.*`, `synthesis.*`, `feedback.*`, `cron.*`) but missed the Inngest-internal events. These aren't code you emit — they're platform events the runtime emits automatically — but your typed event union has to include them for the typed SDK wrappers to validate invocations against them.

**Fix (commit `36e2250`):** Added `inngest/function.failed` to `DenimEvents` with the documented SDK payload shape (`function_id`, `run_id`, `error`, `event`). Registration alone fixes it — the four existing `onFailure` handlers in `apps/web/src/lib/inngest/functions.ts` were correctly structured all along. Typecheck caught no code change requirement.

**Rule exposed:** **When consuming any platform-emitted event, check whether the platform's typed SDK requires the event to be declared in your union.** For Inngest this includes every `inngest/*` event your app depends on — today only `function.failed` via `onFailure`, but future additions (`function.cancelled` via `cancelOn`, debounced handlers, or any rate-limit event) would follow the same pattern. If a platform event you consume isn't in your event union, it will either fail validation at invocation (Inngest's behavior) or silently never fire (other platforms). Both are silent-failure traps.

**Meta:** This is a class cousin of Bug 2 / Bug 7 — critical functionality silently not running. The Inngest case is slightly better than the Bug 7 Client Reference case because the failure surfaces as a 400 in the Next log (if you're watching). But the onFailure handler never gets a chance to leave a terminal row, so the downstream effect (scan hangs) is identical. Preventive detection: grep every Inngest function for `onFailure:` and verify the event the SDK will dispatch on failure is in `DenimEvents`.

---

## 2026-04-19: `instanceof` across workspace packages is unreliable under Turbopack dev

**Context:** During #105 credentials refactor verification, spotted a schema that failed at `runDomainDiscovery` with the new error message text from the credentials module (`"[DISCOVERING_DOMAINS] Gmail not connected"`) but `phaseCredentialFailure` NULL in the DB. The catch block that was supposed to extract the typed failure payload fell through to the untyped branch. Class identity was the culprit.

### Discovery 11: `err instanceof GmailCredentialError` returns false even when err WAS constructed as one

**Symptom:** The Inngest catch block in `domain-discovery-fn.ts` used `err instanceof GmailCredentialError` to decide whether the error carried a typed `credentialFailure` payload. In Next.js dev mode under Turbopack, that check returned false — silently, without a compile error — even when the error was an actual `GmailCredentialError`. Result: `typedFailure` was `undefined`, `markSchemaFailed` wrote the error message text to `phaseError` but left `phaseCredentialFailure` NULL, and the UI rendered the generic "Setup failed / Try again" screen instead of the "Google connection lost / Reconnect Google" flow that unblocked the user.

**Root cause:** Turbopack can load a workspace-package module (e.g. `@denim/types`) as two distinct module instances when it's imported from different chunks. One chunk's `throw new GmailCredentialError(...)` used class constructor A; the catching chunk's `instanceof` comparison referenced class constructor B. Same source, different runtime identity. JavaScript `instanceof` walks the prototype chain looking for a specific constructor function reference; two parallel module instantiations of the same source produce two different function references, and the chain walk fails.

**Fix (commit `0f0c022`):** Added duck-typed helpers to `packages/types/src/gmail-credentials.ts`:
- `isCredentialFailure(value)` — shape guard checking for `reason: string` + `remedy: string`.
- `extractCredentialFailure(err)` — pulls `err.credentialFailure` if present and shape-valid.

Swapped `instanceof` in three catch sites (`domain-discovery-fn.ts` outer catch, `entity-discovery-fn.ts` outer catch + per-domain rethrow gate) to `extractCredentialFailure(err) !== undefined`. Added 6 regression tests including a plain shaped object test that simulates the Turbopack scenario — a `{ credentialFailure: {...} }` not constructed via `GmailCredentialError` still extracts correctly. Left one `instanceof AuthError` check in `functions.ts:197` — intentional, `AuthError` is the broader class and the identity coupling is shallower.

**Rule exposed:** **`instanceof` on classes defined in a workspace package is unreliable for error branching in dev mode.** Provide a duck-typed helper alongside every workspace-package class used for catch-block decisions. Prefer the duck-typed helper in every cross-module catch site. Same-module `instanceof` still works (auth callback's in-process `instanceof` was intentionally left as-is) — the failure mode is specifically cross-module-instance identity.

**Preventive checklist:**

1. For every `@denim/*` package export used in error branching (`instanceof SomeClass`), export a matching `isSomeClass(value)` / `extractSomeThing(err)` helper.
2. In every `catch (err)` block in `apps/web/src/lib/inngest/**`, `apps/web/src/lib/services/**`, prefer the duck-type helper over `instanceof`.
3. When writing regression tests for typed errors, include a "plain shaped object" variant — same fields, not constructed via `new` — to simulate the runtime that caused the bug.

**Why the tests didn't catch it:** `service.test.ts` creates and catches `GmailCredentialError` in the same module. Same module = same constructor instance = `instanceof` works. The failure mode is specifically bundle-time duplication across chunks, which only manifests at runtime in dev mode against the Turbopack bundler. Unit tests running under Vitest (no Turbopack involved) wouldn't reproduce it even if you wrote them perfectly. The regression test added here covers the *shape* (plain object with `credentialFailure`) rather than the *bundler scenario* — good enough to prevent someone from reverting back to `instanceof`.

**Meta:** Third failure mode today (after Bug 7 Client Reference wrap, Discovery 10 event-union registration) where the platform's runtime behavior silently broke typed code that looked correct. All three share the shape: *the TypeScript types said it was fine, the runtime disagreed, and the failure surfaced as a silent drop somewhere downstream instead of an error at the point of miscompile*. Preventive rule for the class: **every cross-module decision that relies on runtime identity (instanceof, symbol equality, constructor match) should have a duck-typed or Zod-parsed fallback.**

---

## 2026-04-19: Persist markers, not records, when the records already exist

**Context:** During #112 Tier 2 design, I proposed a new JSONB column `stage1ConfirmedUserContacts` carrying full contact records (`{ query, matchCount, senderEmail, senderDomain, errorCount }[]`). Nick pushed back: *"are these using the data schema we have? I feel we have the columns we need to do this, no?"* Spawned a schema-check agent which flagged the duplication.

### Discovery 12: Confirmation markers, not duplicated records

**Symptom:** Avoided (caught pre-commit via schema analysis). My proposed column would have duplicated every field in the already-persisted `stage1UserContacts` column. At confirm time, we'd rewrite the full record (same senderEmail, same matchCount, same everything) just to mark "user ticked this." `stage1UserContacts` is immutable discovery output; `stage1ConfirmedUserContacts` would have been immutable *selected-subset-of-discovery-output*.

**Root cause:** I conflated two distinct data needs. The discovery stage (Stage 1 find-or-tell) produces all the hits plus the "no results" entries. The confirmation stage (domain-confirm transaction) needs to remember *which* of those entries the user selected. Different concerns, and the second one only needs a key into the first. Storing the full records in both places means:

- Write amplification (paying for bytes we already have).
- Drift risk (if discovery output ever gets corrected/reprocessed, the confirmation snapshot stays stale).
- Confusing semantics (which column is the source of truth for `senderEmail`?).

**Fix (commit `c44a5ba`):** New column is `stage1ConfirmedUserContactQueries: string[]` — just the query strings (`["farrukh malik", "margaret potter"]`). `runEntityDiscovery` cross-references this set against `stage1UserContacts` at read time to pull the full context for each confirmed query. Single source of truth for the contact records. The confirmation layer is pure metadata.

**Rule exposed:** **When persisting "user's choice" data that correlates with existing "discovery output" data, persist only the minimal marker (key, ID, query string), not the full record.** The discovery output stays the source of truth; the marker set is a pointer. Same applies to: which emails the user excluded on review, which entities the user renamed, which case tags the user added. Every "user confirmed / rejected / selected" signal is a set of keys, not a set of records.

**Heuristic for the next designer:** Before adding a new column shaped like `Array<{foo, bar, baz}>`, check whether any of (foo, bar, baz) already live in another column on the same table keyed on the same logical identity. If yes, the new column should be `Array<identityKey>` — persist the identity, not the fields.

**Meta:** This is the prevention-time analog of the duplication rules in Bug 4 and Round 2. Those rules were about *code duplication* — same decision logic in two files. This one is about *data duplication* — same record fields in two columns. Both drift silently. The Bug-4 rule was re-discovered during code review; this one was re-discovered during schema review. Same shape of catch.

---

## 2026-04-19: Parallel agent dispatch for "is this design right?" checks

**Context:** Before committing to the #115 + #112 Tier 2 slice, Nick asked two parallel questions: *"are we using the schema we have?"* (implementation question) and *"is this the next right task to work on?"* (prioritization question). Rather than serialize these behind my proposed design, dispatched both in parallel to specialized subagents and used the answers to inform the execution.

### Discovery 13: Architectural pressure-testing via parallel subagents is cheap

**Symptom (positive):** Both questions returned answers within ~1 minute, both surfaced blind spots in the original proposal:

1. The schema-check agent caught the record-vs-marker duplication (Discovery 12 above) that would have made the next designer curse.
2. The prioritization agent confirmed the slice was right but flagged that *"running evals against a still-opaque Stage 2 burns a run on UX noise"* — a framing I hadn't articulated that makes the polish-first order defensible beyond gut.

Neither agent rubber-stamped. Both forced revisions before any code was written.

**Rule exposed:** **At the "before I start coding" checkpoint, dispatch parallel subagents when you have (a) an architectural call worth pressure-testing and (b) a prioritization call worth second-opinion-ing.** Good uses:

- "Given this proposed interface, is there existing data that could carry it?" → Explore or schema-architect agent.
- "Is this the highest-leverage next task vs these alternatives?" → general-purpose with issue-list access.
- "What failure modes does this design have under retry/concurrency/offline?" → code-reviewer or architect agent.
- "Is the test I'm about to write going to catch the class of bug I care about?" → code-reviewer.

The cost (~2 minutes of parallel dispatch + ~5 minutes of reading the returns) is trivial relative to the cost of shipping a bad architecture that then has to be refactored. The key is *parallel*, not *serial* — serial dispatch adds latency without extra independence, and you're tempted to let the first answer bias the second.

**Anti-pattern to avoid:** spawning subagents for narrow implementation questions the main agent can answer in 30 seconds by reading a file. Subagents are valuable for *breadth* (multi-file search, issue-list aggregation, cross-theme analysis) and for *independence* (a second opinion that didn't see your proposal). They're overkill for "what's the signature of this function."

**Meta:** Today's sprint produced three class-preventive discoveries (10, 11, 12) and the workflow that caught one of them (13) worth preserving. The parallel-agent dispatch is a tool for the sprint toolbox, not a lesson about a specific code class. Promoting it here because the skill is "when to reach for this tool" and the answer is "at design-check gates, not during execution."

---

## 2026-04-21: Third CAS-second-writer bug — rewind primitive was wrong

**Context:** Issue #127 (2026-04-20) added `PATCH /api/onboarding/:schemaId/inputs` so a user could Back-button from the Stage 1 review screen, fix a WHAT typo, and Save without a full wipe + OAuth round-trip. The PATCH called `rewindSchemaInputs` which set `CaseSchema.phase = "DISCOVERING_DOMAINS"` directly (not through `advanceSchemaPhase`) and re-emitted `onboarding.domain-discovery.requested`. It worked exactly once — then broke.

### Bug 8 (caught in live E2E): `runDomainDiscovery` silently skips after a rewind

**Symptom:** During live E2E on 2026-04-21, the user started schema `01KPR8Z0…`, walked to Stage 1 review, clicked Back → edit → Save. Inngest logs showed the first `runDomainDiscovery` run completed in 9 seconds (correct). The second run, triggered by the PATCH's re-emit, finished in 0.5 seconds with an empty output and no DB writes. The observer page polled `DISCOVERING_DOMAINS` for 15+ minutes with no error anywhere.

**Root cause:** `runDomainDiscovery` (`apps/web/src/lib/inngest/domain-discovery-fn.ts:54`) guards on `advanceSchemaPhase({ from: "PENDING", to: "DISCOVERING_DOMAINS" })`. After `rewindSchemaInputs` set phase to `DISCOVERING_DOMAINS` directly, the CAS `from` guard rejected (`from=PENDING` no longer matched `phase=DISCOVERING_DOMAINS`), `advanceSchemaPhase` returned `"skipped"`, and the function returned `{ skipped: true }` without running any Gmail work.

**Rule re-affirmed (third data point, after Bug 3 2026-04-09 and the near-miss idempotency patterns #6/#11):** **Each `from → to` CAS transition must have exactly one writer, and it must be the CAS helper — not a direct `updateMany` that sets `phase`.** `rewindSchemaInputs` was a second writer for `→ DISCOVERING_DOMAINS`. Patching the CAS `from` to accept both `PENDING` and `DISCOVERING_DOMAINS` would have masked the issue for this pair while leaving the class of bug wide open for the next rewind.

**Fix (shipped as issue #130):** Remove the rewind primitive. The Back-edit button now routes to `/onboarding/names?from=<oldSchemaId>`. Saving POSTs `/api/onboarding/start` with a fresh schemaId AND `abandonSchemaId: <oldSchemaId>`. The start route's existing `$transaction` gains one `updateMany` that flips the old row from `DRAFT` → `ABANDONED`. New enum value; zero migration risk. All list/count queries exclude ABANDONED. The `/inputs` route and `rewindSchemaInputs` service are deleted.

**Why this is structural, not a patch:** After #130, schema phases only move forward. There is no rewind primitive; there is no second-writer path. Every CAS `from → to` pair retains a single writer. New features that would otherwise "roll back" a schema must instead create a new schema — the `abandonSchemaId` pattern is the template.

**Meta:** This was caught by running the live E2E (mid-test, the Stage 1 reload hung for 15+ minutes). A unit test couldn't have caught it because the unit-tested `rewindSchemaInputs` does exactly what it claims (flips phase + nulls stage1). The interaction bug is only visible once Inngest dispatches the downstream function and the CAS owner silently skips. Integration coverage via the live-E2E shakedown remains the only defense for this class until we add a cross-function CAS-ownership test harness. Secondary lesson, recorded 2026-04-21 and saved as a feedback memory: never diagnose a 404 or a silent stall as "dev server related" without pasting the concrete file evidence (compiled route directory, generated `.next/dev/types/validator.ts` contents, etc.) — two days of loose diagnosis on the Turbopack stale-cache issue preceded the actual root-cause dig for this bug.

---

## 2026-04-22: Eval-harness surfaced four latent bugs that tests missed

**Context:** Built the onboarding eval harness this session (`apps/web/scripts/eval-onboarding.ts`) to drive Stage 1 + Stage 2 + full synthesis against the 417-email `denim_samples_individual/` corpus through the REAL production service functions (via `FixtureGmailClient` + `AI_RESPONSE_CACHE=fixture`). First run exposed four production bugs the 309-test suite didn't catch. All four are class-instances of patterns already in this document — but each instance required the eval to surface it.

### Bug 9: `UPDATE "Entity"` in raw SQL — wrong physical table name

**Symptom:** First Part B run (synthesis) threw `Raw query failed. Code: 42P01. Message: relation "Entity" does not exist` from `persistConfirmedEntities` (`apps/web/src/lib/services/interview.ts:1193`). Every user who has confirmed an entity through `/entity-confirm` where any SECONDARY has a resolved senderEmail alias would have hit this.

**Root cause:** `prisma/schema.prisma` has `model Entity { ... @@map("entities") }` — the physical table name is `entities` (snake_cased). The raw `$executeRaw` alias-merge path used `UPDATE "Entity"` (PascalCase model name). PostgreSQL with quoted identifiers is case-sensitive, so the query looked for a table literally named `Entity` that doesn't exist.

**Why tests missed it:** The only test that triggers the `$executeRaw` branch would need a SECONDARY entity with aliases, and the alias path is only populated for SECONDARY entities whose `identityKey` resolves to a Stage 1 `senderEmail` (#121). Integration-test fixtures haven't exercised that combination. Unit tests mock Prisma entirely. The bug is dormant under both.

**Fix:** `UPDATE "Entity"` → `UPDATE "entities"` at `interview.ts:1193`. One-character column swap.

**Rule exposed:** **Every `$executeRaw` / `$queryRaw` against a Prisma model must use the physical table name from `@@map`, not the model name.** Prisma silently renames everywhere else; raw SQL is the only place you can drift. Grep pattern for preventive audit: for every `$executeRaw` or `$queryRaw` call in the codebase, check each quoted identifier against the `@@map` on the corresponding model in `schema.prisma`. Catch #12 in the Patterns list.

### Discovery 14: Zod `.optional()` does NOT accept explicit `null`

**Symptom:** Stage 2 eval for agency schema: the portfolioproadvisors.com Gemini call returned 5 candidate entities, all with non-empty names and frequencies. The Zod parse at the trust boundary rejected the entire response (`schemaInvalid` error log, 11 issues). All 5 entities silently dropped. The entity-confirm screen showed "We didn't find specific things inside portfolioproadvisors.com" — invisible to the user, who just saw an empty cluster.

**Root cause:** `entity-discovery.ts:76-77` defined `sourced_from_who: z.string().optional()` and `related_what: z.string().optional()`. Gemini, following the prompt, returned these fields as explicit `null` when the entity wasn't paired (as it should — the field was absent-by-value). Zod's `.optional()` accepts `undefined` OR absent fields, but rejects `null`. Every entity in the response had `null` for at least one of these fields → each one failed validation → the `safeParse` rejected the whole batch → `errorCount++` and empty candidates returned.

**Why tests missed it:** `entity-discovery.ts` has no unit test that exercises a Gemini response with explicit `null` values. Fixture-based tests for parsers use hand-authored JSON that tends to omit optional fields rather than emit them as null. The bug only surfaces when the LLM follows the prompt literally.

**Fix:** `z.string().optional()` → `z.string().nullable().optional()` on both fields.

**Rule exposed:** **When Zod-parsing AI responses, optional string fields MUST be `.nullable().optional()` unless you can prove the model never emits explicit null.** LLM prompt compliance is not a guarantee — the model can and will return `null` where you expected `undefined`. Defensive pattern: for every AI response schema, any field that is optional at the semantic level uses `.nullable().optional()`. Same rule applies to enums, numbers, and arrays. The performance cost is zero; the coverage gain is real.

**Preventive check:** grep every `packages/ai/src/parsers/` file and every `z.object(` near a `callClaude` / `callGemini` call for `.optional()` without an accompanying `.nullable()` on a field type that could conceivably be `null`. Add `.nullable()` unless the prompt explicitly requires absence-over-null.

### Discovery 15: `FixtureGmailClient` query parser silently returned zero matches for production-shape queries

**Symptom:** First Part A discovery run for school_parent: `Stage 1 done (428 ms) — 0 domain candidates`. But `scripts/validate-stage1-real-samples.ts` (which uses its own stub, bypassing FixtureGmailClient) produced 5 candidates with `email.teamsnap.com` at #1. Same corpus, same production code, different "Gmail client" — different answers.

**Root cause:** `FixtureGmailClient.evaluateQuery` tokenized `from:`, `subject:`, quoted phrases, and `OR` — but broke on three query shapes the production Stage 1 query generator emits:
1. **`subject:(A OR B OR C)`** — parenthesized field groups. The tokenizer advanced past `:` then consumed until the next space, taking `subject:("practice"` as a single token and leaving `OR "game")` etc. as stray words. Production query: `subject:("practice" OR "game" OR ... OR "guitar") -category:promotions newer_than:365d`.
2. **`-category:promotions`** — negation. Treated as unquoted word, matched nothing.
3. **`from:*@domain.com`** — wildcard. Treated as literal substring match.

All three failures returned zero candidates silently — same shape as "no matching emails in corpus."

**Why existing tests missed it:** FixtureGmailClient had unit tests for `searchEmails(query)` with simple queries. Stage 1's actual query generator emits compound queries that nothing exercised end-to-end. `validate-stage1-real-samples.ts` sidestepped the problem by using a hand-rolled stub that did keyword-matching directly against sample subjects — so it was giving correct answers using different logic than production.

**Fix (landed this session):** Rewrote `tokenize` + `filterByToken` in `fixture-client.ts` to handle `subject:(...)` / `from:(...)` paren groups via a shared `expandFieldValues` helper, added negation support via a leading `-` branch, added `from:*@domain.com` wildcard handling, added `category:CATEGORY_NAME` + `label:NAME` filters.

**Rule exposed:** **Every fake/mock of an external API must be exercised against a production-shape input before being trusted. A mock that silently returns zero results looks identical to a mock that correctly handles the query — there is no runtime error to catch.** The production query generator is the oracle: whatever query shapes it can emit, the fake must handle. When adding a new production query shape (or discovering a missing one via eval), add a test in the fake's suite that runs that shape and asserts non-zero results against the fixture corpus.

**Coverage test template for fakes:**
```ts
it("handles the production Stage 1 query shape", () => {
  const client = new FixtureGmailClient(realSamples);
  const query = buildStage1Query("school_parent", 365);
  const ids = await client.listMessageIds(query, 500);
  expect(ids.length).toBeGreaterThan(0);  // smoke test
});
```
Catch #13 in the Patterns list.

### Discovery 16: Eval harness drifted from production Stage 2 fanout

**Symptom:** After fixing Discovery 15, the agency eval produced domain candidates but the entity-confirm screen showed "Margaret Potter" (seeded WHO) as an `otter.ai` entity instead of a `portfolioproadvisors.com` one — even though `stage1UserContacts` correctly recorded `mpotter@portfolioproadvisors.com` with 9 matches. The user reviewing the screens flagged this as "surprising — I expected mpotter and gtrevino to surface under PPA."

**Root cause:** The Inngest `runEntityDiscovery` function builds a `userSeedsByDomain` map AFTER calling `discoverEntitiesForDomain` and prepends those seeds to the per-domain candidate list. My first eval harness called `discoverEntitiesForDomain` directly and skipped the seed-prepend step. Divergence was invisible to the hard assertions (which check that WHOs appear in `stage1UserContacts`, not that they appear on the entity-confirm screen), but visible to the user on visual review.

**Why this is Bug 1 / Bug 5 / Bug 6 all over again:** Same class as "test helper does work production path doesn't" — just applied to the eval harness. The harness inlined domain-specific orchestration logic that should have been a shared service-layer function. Eval harnesses ARE test infrastructure; the rule applies.

**Fix (landed this session):** Extracted `buildStage2Context()` + `runStage2ForDomain()` + `runStage2Fanout()` into `apps/web/src/lib/services/stage2-fanout.ts`. The Inngest `runEntityDiscovery` shrank by ~120 lines and now calls these helpers; the eval harness calls them too. Single source of truth for seed-prepend + paired-WHO resolution + per-domain error handling. Zero behavior change — verified by rerun producing identical reports (cached, 15-23ms per domain).

**Rule re-affirmed (fifth data point of this class, after Bugs 1 / 4 / 5 / 6):** **When an eval harness or test helper orchestrates production code, it must call the exact same entry-point functions the production path calls. If the only existing entry point is embedded in an Inngest function, a route handler, or a specific controller, extract the orchestration into a shared service module first — THEN have both call sites use it.** Do NOT inline the logic into the harness "because it's just a test" — that IS the trap.

**Pattern template:** `stage2-fanout.ts` is the canonical example. Production-side: `runEntityDiscovery` loads its schema snapshot inside `step.run`, calls `buildStage2Context(schema)`, fans out `runStage2ForDomain(ctx, d, gmailClient)` inside per-domain `step.run`s. Harness-side: eval-onboarding loads the schema snapshot directly, calls the same `buildStage2Context`, calls `runStage2ForDomain` with a `FixtureGmailClient`. Both reach the same service function for anything non-trivial. The only thing each side owns independently is its own invocation mechanics (Inngest `step.run` boundaries vs. plain `Promise.all`).

**Meta:** Discoveries 14-16 plus Bug 9 are the direct product of building the eval and running it against real corpus data. All four were in production code before this session; none would have been caught by the existing 309-test suite. **The eval harness is now the preventive-rigor layer for this class of bug.** Future additions to Stage 1 / Stage 2 / synthesis logic should re-run the three-schema eval before being considered done; the "did we just break something that only shows up under realistic input shapes" question has an answer now.

---

## 2026-04-23: User-typed names in `inputs.groups` drift from persisted entity names

**Context:** Closing issue #130 step 7a — wiring `EntityGroup` + `Entity.groupId` + `Entity.associatedPrimaryIds` through `persistConfirmedEntities` so the Phase-2/3 confirm flow stops producing orphan entities. The extracted `linkEntityGroups` helper looked up entities by `inputs.groups[].whats[i]` / `whos[i]` against a `Map<name, entity>` built from the persisted rows. Unit tests passed. The first property eval (fresh schemaId `cmoc1dmur00008gqeyyd0anah`) revealed every SECONDARY had empty `associatedPrimaryIds` despite `groupId` being populated on all entities.

### Discovery 17: Confirm-flow canonicalisation drifts entity names out from under stable-by-name lookups

**Symptom:** Property schema post-run DB spot-check: Timothy / Vivek / Krystin (SECONDARIES) all had `"assoc_count": 0`. Expected: `[peavy_id, bucknell_id, healey_id]` on each (1:N pairing — one group with 3 addresses + 3 contacts). The `groupMemberAssignments` writes DID land (all entities had `groupId` set), so the helper was running, just failing to build a non-empty `primaryIdsInGroup` for the one group.

**Root cause:** `inputs.groups` stores the user's original typed strings — `"851 Peavy"`, `"3910 Bucknell"`, `"2310 Healey"`. The confirm flow (eval's `autoConfirmEntitiesAndAdvance` mirroring the Gemini-augmented entity-confirm route) persists entities with canonicalised names — `"851 Peavy Road"`, `"3910 Bucknell Drive"`, `"2310 Healey Drive"`. Exact name lookup (`entityByName.get("851 Peavy")`) returns `undefined` → `primaryIdsInGroup` is empty → the `associatedPrimaryByFingerprint` block is skipped (requires BOTH primaries and secondaries non-empty) → no `associatedPrimaryIds` write fires. The SECONDARIES still got linked to their EntityGroup because the SECONDARY names happened to match exactly, but their associatedPrimaryIds denormalisation — the thing the scan pipeline actually reads at Stage 5 — was never written.

**Why the existing unit tests missed it:** Every test fixture in `link-entity-groups.test.ts` used the same name as both the group entry AND the persisted entity (`{ whats: ["Lanier"] }` with a persisted entity named `"Lanier"`). That matches the legacy hypothesis flow (where `hypothesis.entities[i].name` feeds both `inputs.groups` and the persisted row). It does not match the Phase-2/3 confirm flow, which canonicalises on the way through.

**Fix:** Added a tolerant `resolveByTypedName(typedName, expectedType)` inside the helper:
1. Exact-name match on `entityByName` (fast path; legacy path + matching SECONDARIES stay at score 1000).
2. Case-insensitive exact match.
3. Case-insensitive prefix match — user's typed string is a prefix of a persisted entity name, with a space or hyphen boundary (so `"851 Peavy"` matches `"851 Peavy Road"` but not `"851 Peavyville"`).
4. Token-subset match — every token the user typed appears in the entity's token set (so `"Margaret Potter"` matches either exact or a longer canonical form).
Picks the highest-scoring candidate; ties broken by the longest name. Restricted to the same `type` so a typed WHAT can't accidentally bind to a SECONDARY of the same name and vice versa. Two regression tests added (`"resolves typed names that are a prefix of the augmented persisted entity name (property schema regression)"` + `"restricts fuzzy matching to the correct type"`).

**Rule exposed:** **When a helper resolves a user-supplied string against a set of persisted rows that may have been canonicalised between user input and persistence, prefer resolution by the most stable identifier available — and if forced to resolve by name, build a tolerant matcher that handles prefix + token-subset + case-insensitive equivalence, restricted by the other dimensions that disambiguate (in this case, `type`).** Exact-name lookups are a latent bug anywhere a value crosses a stage that may rewrite it (AI canonicalisation, suffix normalisation, alias merging). The lookup will pass unit tests where nothing rewrites, then fail in production where something does.

**Why this wasn't caught earlier:** The legacy hypothesis flow didn't trigger it (Claude uses hypothesis entity names verbatim — no drift between `inputs.groups` and persisted rows). The Phase-2/3 flow adds an augmentation step inside the confirm screen → persist path, and that's where names drift. The eval caught it because the eval exercises the Phase-2/3 path end-to-end with realistic user inputs and realistic AI-augmented confirm-screen state.

**Preventive check:** For any name-based lookup between "user-typed text" and "persisted entity row," audit for intervening rewriters (domain canonicalisers, alias mergers, Gemini-augmentation passes). Either (a) resolve by `identityKey` / another stable ID instead of by name, or (b) use a tolerant matcher with documented fallback rules. Catch #15 in the Patterns list.

---

## 2026-04-23: Prefer record-the-decision over silent-drop when future context may resolve the ambiguity

**Context:** Closing issue #130 step 7b — universalising paired-WHO routing so a SECONDARY paired with N primaries (Timothy/Krystin/Vivek each paired with 3 addresses) can still route its generic emails to the right case. Extraction's Stage 5 is the sender-fallback path that reads `Entity.associatedPrimaryIds`; before today, it silently dropped to orphan when the list had >1 primaries because "it's ambiguous."

### Discovery 18: Silent-drop-on-ambiguity loses information the downstream pipeline could have used

**Symptom:** Eval runs for property showed Timothy's / Krystin's / Vivek's generic emails (no specific address in subject, no address in Gemini's summary) dropping to `entityId: null` even when the thread clearly related to a specific property. Cluster.ts had nothing to work with — the orphan looked identical to "no signal found anywhere." Today's extraction logic:

```ts
} else if (senderPrimaryIds.length > 1) {
  // Multiple associated primaries — ambiguous, leave null.
  routeMethod = null;
  routeDetail = `... ambiguous, skipping`;
}
```

The `skipping` log was honest about what the line of code did; what it didn't convey was that the Email row itself retained NO memory of the ambiguity — no list of candidates, no way for a later stage (cluster, feedback loop, future re-extraction) to say "pick up where we left off."

**Root cause of the design gap (not a code bug — a missing primitive):** Stage 5 was built as a pure decision function: "can I pick one primary right now? yes → set entityId; no → give up." But the right question at Stage 5 is different: "can I pick one primary right now? yes → set entityId; no → *record what I know so far*, defer the decision." Cluster time has information extraction time doesn't (thread siblings), so deferring is strictly better than dropping.

**Fix (step 7b, this session):**
1. **Prisma schema:** new `Email.candidatePrimaryIds: Json @default("[]")` column (additive migration; `ALTER TABLE` via supabase-db skill).
2. **Extraction Stage 5 write path:** on `senderPrimaryIds.length > 1`, set `candidatePrimaryIds = senderPrimaryIds`, set `routingDecision.method = "sender_ambiguous"`, emit `extraction.ambiguousSender.recorded` info log. entityId stays null — honest about not having resolved.
3. **Cluster pre-pass read path:** new `thread-adjacency.ts` pure helper. For each orphan with non-empty `candidatePrimaryIds`, query sibling emails in the same thread that have `entityId ∈ candidatePrimaryIds`. If exactly one distinct primary matches → adopt it + stamp `routingDecision.method = "thread_adjacency"` + clear `candidatePrimaryIds`. 0 or >1 → stay orphan.
4. **Idempotent:** rerunning extraction clears `candidatePrimaryIds` to `[]` when a content match takes over; rerunning cluster is a no-op on a resolved email (empty candidate list).

**Rule exposed:** **When a pipeline stage can't make a routing decision with the information it has, record the inputs it had — not just "null" — so a later stage with more context can finish the job.** The `candidatePrimaryIds` column is the pattern: record the candidate set, the reason-code, and any other inputs that would help a smarter pass resolve later. Downstream code is free to ignore the record (behaviour-neutral), but CAN use it (new capability unlocked). Silent-drop is strictly weaker than defer-with-record.

**Operational signals this unlocks:**
- `routingDecision.method IN ("sender_ambiguous", "thread_adjacency")` is now queryable to measure how often the paired-WHO fallback fires and how often thread-adjacency resolves it. Property's first fresh eval: 2 `sender_ambiguous` orphans, 0 resolved via adjacency (those 2 were alone in their threads — honest floor, not a silent failure).
- The same pattern generalises: any future "ambiguous at stage N, resolvable at stage N+1" case can follow the same schema-column + pure-helper-between-stages template. `cluster.ts::resolveByThreadAdjacency` is the canonical example.

**Pattern template:**
```ts
// Stage N — decision function that can defer:
if (canResolve) { result.entityId = pickOne(); }
else if (hasCandidates) {
  result.candidatePrimaryIds = candidates;
  result.routingDecision.method = "sender_ambiguous";
  logger.info({ operation: "ambiguousSender.recorded", ... });
}

// Stage N+1 — reader of deferred decisions:
const resolutions = resolveByThreadAdjacency(orphans, siblings);
// Updates the row + clears the deferred state when it can; leaves honest
// unresolved otherwise. Never swallows the ambiguity.
```

Catch #16 in the Patterns list.

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

### 6. "Spec reviewed, not spec validated"

If a config artifact (keyword list, regex pattern, threshold value, decision table)
is drafted from domain expertise and reviewed by eye, it hasn't been validated. The
expert's intuition reflects formal/deliberate vocabulary; real traffic reflects
informal/working vocabulary. The gap is invisible until you run the filter against
real production-shaped data.

**Check:** Before flipping any `Status: DRAFT` marker to `LOCKED` on a config-as-spec
artifact, collect an oracle (known-good inputs), run the draft against a realistic
sample, and measure two numbers: (a) per-input recall on the oracle, and (b) the rank
of the oracle's identifying attribute (sender domain, entity name, etc.) in whatever
aggregate the config produces. The LOCKED marker should carry both numbers so the
validation trail survives. See the 2026-04-16 agency keyword-list entry above for
the canonical version of this workflow.

### 7. "Plain constant exported from `"use client"`"

If a `.ts` file starts with `"use client"` AND exports a non-component, non-hook value
(string, number, object, function that isn't a React hook), a server-side import of
that value gets wrapped into a Next.js Client Reference object — not the raw value.
Subsequent operations like `.includes()` / `.length` / iteration silently break with
a `TypeError: x is not a function` several frames deep. TypeScript does not warn
because the import is valid at type level; the wrapping happens at bundle time.

**Check:** Constants shared between server and client live in `shared/` directories
with no directives. Never co-locate plain values with `"use client"` code. For
`lib/gmail/`, the Biome `noRestrictedImports` rule in `biome.json` fails CI when any
server surface imports from `lib/gmail/client/**` — the same pattern should extend
to every future subsystem that crosses the client/server line.

### 8. "Warn-and-continue in an auth-adjacent catch"

If a `try/catch` wrapping credential storage, token refresh, OAuth exchange, or any
write whose absence would break the next user action logs `warn` and continues to
the happy-path destination, the user enters an infinite retry loop with no
user-visible error. This class has shipped three times: 2026-04-09 (Bug 2),
2026-04-10 (Bug 4 variant), 2026-04-18 (Bug 7). Each prior fix addressed the
instance; the #105 refactor closes the class.

**Check:** Every catch block in auth paths (`/auth/*`, `storeCredentials`,
`getAccessToken`, token refresh) must end in an error response or error redirect
with a typed `reason` code. Grep for `logger.warn` inside auth-adjacent try/catch
blocks — each one needs a comment explaining why continuing is safe (in practice,
the answer is almost always "it isn't" and the `warn` should be an error redirect).

### 9. "Platform event consumed without being in the typed union"

If an Inngest function declares `onFailure`, `cancelOn`, or any trigger that
listens on a platform-emitted event (events under the `inngest/*` namespace),
the event must be in `DenimEvents` or the handler 400s at invocation and the
feature silently doesn't run. TypeScript won't warn — the `onFailure` signature
accepts any handler — but the Inngest runtime validates against the typed union
at dispatch time.

**Check:** Grep `onFailure:|cancelOn:` under `apps/web/src/lib/inngest/`. For
each, verify the event the SDK will dispatch (`inngest/function.failed`,
`inngest/function.cancelled`, `inngest/scheduled.timer`, etc.) is in
`packages/types/src/events.ts`. When adding a new Inngest function with
cross-function listening, add the relevant platform events to the union first.

### 10. "`instanceof` across workspace packages"

`err instanceof GmailCredentialError` returns false in Next.js dev mode when the
thrown error and the catching code loaded `@denim/types` as two distinct module
instances (Turbopack class-duplication across chunks). Same-module tests pass,
cross-module runtime lies. Silent misclassification — the catch block reads
`undefined` from the `.credentialFailure` property access against a class whose
identity didn't match, and the UI renders the wrong error screen.

**Check:** For every `@denim/*` class used in error branching, ship a duck-typed
companion (`isThing(value)` / `extractThing(err)`). Prefer the duck-typed helper
in catch blocks that sit across module boundaries — Inngest functions, service
methods, API routes. Same-module `instanceof` (e.g., within a single file) is
still safe. When writing regression tests for typed errors, include a
"plain shaped object" variant — same fields, not constructed via `new` — to
simulate the bundle-time duplication the runtime produces.

### 11. "Persisted record duplicates a column already on the row"

If a new column is shaped `Array<{foo, bar, baz}>` and any of (foo, bar, baz)
already live on the same row (logical identity: same schemaId, same domain, same
whatever), you're about to write the same data twice. The confirmation/selection
layer only needs the minimal marker — an identityKey or query string — pointing
into the source-of-truth column.

**Check:** Before adding a JSONB column that stores records, grep the prisma
schema on the same model for fields with the same names. If a match exists, the
new column should be `Array<identityKey>` (marker set) instead — the source
column is the record store, the new column is the pointer set. Applies to user-
confirmation markers, calibration selections, feedback flags, anything that
records "which existing thing did the user pick."

### 12a. "Raw SQL identifier doesn't match `@@map`"

If a `$executeRaw` or `$queryRaw` call uses a quoted identifier for a Prisma
model that has `@@map("snake_cased")`, the raw query hits the PascalCase name
and PostgreSQL fails with `relation "Entity" does not exist`. The rest of the
codebase uses Prisma's typed API which knows the mapping; the raw query is
the only place you can drift. Ships silent until the specific code path runs
(e.g. SECONDARY entity with aliases, triggering `$executeRaw` in
`persistConfirmedEntities`). See Bug 9 (2026-04-22).

**Check:** Grep for `$executeRaw`, `$executeRawUnsafe`, `$queryRaw`,
`$queryRawUnsafe` in `apps/web/src/`. For each quoted identifier, open
`schema.prisma` and verify the model's `@@map` matches. Tools like Prisma
Studio won't help here — the raw SQL bypasses the ORM entirely. If you
need the model name to stay PascalCase in the raw query, drop `@@map` and
use a Prisma migration to rename the physical table.

### 12b. "Zod `.optional()` on an AI-response field without `.nullable()`"

If an external AI response schema has `z.string().optional()` on a field the
model might emit as explicit `null`, the whole response fails validation and
downstream code sees an empty/defaulted result. LLM prompt compliance is not
a guarantee — the model can return `null` where you told it to omit the field.
See Discovery 14 (2026-04-22) where every portfolioproadvisors.com entity
dropped because `sourced_from_who: null` rejected the response.

**Check:** For every Zod schema wrapping a Claude or Gemini response, every
optional string / number / enum field should be `.nullable().optional()`
unless you can prove the model never emits explicit null. Defensive pattern
has zero cost. Grep pattern: `.optional()` inside a file that also imports
`callClaude` or `callGemini`. Add `.nullable()` in front of `.optional()`
unless the prompt explicitly requires absence-over-null.

### 13. "Fake of an external API silently returning zero matches"

If a fake / mock / fixture-backed replacement of an external API has its own
query parser or matching logic, a production-shape input it doesn't handle
returns zero results with no error. Zero results is indistinguishable from
"no matches in the fixture set." Eval passes with "0 domain candidates" look
identical to "the corpus genuinely has none." See Discovery 15 (2026-04-22)
where `FixtureGmailClient` silently ignored `subject:(A OR B)` groups and
`-category:promotions` negations, making every Stage 1 eval return empty
until the tokenizer was fixed.

**Check:** For every external-API fake (`FixtureGmailClient`, any MSW handler,
any test harness that implements its own query/filter logic), run the
production query generator's actual output shapes through it and assert
non-zero results against a realistic fixture. Grep for files named
`fixture-client.ts`, `fake-*.ts`, or `mock-*.ts` under `apps/web/src/`;
for each, verify there's at least one test that feeds it a real-shape
query and gets meaningful results. A passing eval against real corpus data
is the canonical smoke test.

### 14. "Eval harness inlines orchestration that lives in the production path"

If an eval or test harness that drives production service code inlines the
fan-out logic, seed-merging, error partitioning, or any orchestration step
that the production entry point (Inngest function, API route, service
controller) also performs, the harness WILL drift from production behavior.
Hard-assertion metrics can pass while the actual production shape silently
diverges. See Discovery 16 (2026-04-22) where the eval harness skipped the
user-seed prepend step, hiding Margaret Potter / George Trevino / Farrukh
Malik from the entity-confirm screen that the eval was supposed to validate.

**Check:** For every new eval or integration harness that calls production
services directly, identify every orchestration step between the entry
point and the leaf service call. Any step that's non-trivial (seed
prepending, paired-context resolution, error partitioning, idempotency
guards) must live in a shared service module that BOTH the production
entry point AND the harness call. If the production entry point is an
Inngest function with that logic inline, extract the logic first. See
`apps/web/src/lib/services/stage2-fanout.ts` for the template:
`buildStage2Context` + `runStage2ForDomain` both sides share.

### 12. "Direct `updateMany` on a CAS-owned column"

If a route or service sets `phase`, `status`, or any column whose transitions
are guarded by a CAS helper (`advanceSchemaPhase`, `advanceScanPhase`) via a
plain `updateMany`/`update`, it is a second writer by definition — even if it's
"only a reset" or "only a rewind." The downstream CAS owner will silently skip
when its `from` guard no longer matches. All instances of this class (Bug 3
2026-04-09, and Bug 8 2026-04-21) shipped past tests and were caught only in
live E2E.

**Check:** For every column that has a CAS helper, grep for direct writes:
```
grep -rn "updateMany.*phase:\|update.*phase:" apps/web/src/
```
Every hit should be inside the CAS helper OR have a comment explaining why the
caller is bypassing it (e.g. the DELETE route explicitly nulls phase on
cancellation). **"Rewind" is never a valid reason — create a new row instead.**
If a feature appears to require rewinding a schema/scan row (e.g. an "edit and
restart" UX), the correct primitive is to create a NEW row and flip the old
row's `status` to a terminal value (ABANDONED, ARCHIVED), then let the old row's
in-flight work finish into a dead row. See the #130 refactor for the template.

### 15. "Exact-name lookup across a canonicalisation boundary"

If a helper resolves a user-supplied string (typed input, form field, stored JSON
key) against a set of persisted rows and anything between input and persistence
may rewrite the name — AI canonicalisation, suffix normalisation, alias merging,
title-casing — exact-name lookup will silently miss. Unit tests that use the
same name on both sides pass; production misses. The lookup returns `undefined`
and the "both sides non-empty" guard skips the write. No error, no log.

**Check:** For any `Map<string, ...>` built from entity names or labels and
queried with user-supplied strings, audit the pipeline from the string's
origin to its use. Either (a) switch to an identifier-based lookup
(`identityKey`, row ID), or (b) use a tolerant matcher that handles
prefix + token-subset + case-insensitive equivalence, restricted by any
disambiguating dimension available (here: `type`). Grep:
```
grep -rn "entityByName\|labelByName\|nameToId" apps/web/src/ packages/
```
For every hit, walk the input's journey. Phase-2/3 confirm flow is the
worst offender — it augments names; the legacy hypothesis flow didn't.

### 16. "Silent-drop-on-ambiguity loses information the next stage could use"

If a decision function ("route this email to a primary") can't resolve
uniquely and sets the result to null/undefined without persisting *what
candidates it considered*, downstream stages have lost the evidence. No
thread-adjacency pass, no feedback-loop hint, no future re-extraction can
pick up where the decision was left — the ambiguity is gone, not deferred.

**Check:** For any stage that returns null-on-ambiguous, verify one of
two is true: (a) there is no downstream stage that could plausibly have
more information (dead end — silent-null is fine), or (b) the ambiguity
case persists its inputs (candidate list, reason-code, source refs) on
the row so a downstream stage can revisit. `Email.candidatePrimaryIds`
(issue #130 step 7b) is the canonical pattern — the column is additive,
behaviour-neutral on its own, and unlocks thread-adjacency resolution in
`cluster.ts::resolveByThreadAdjacency`. Grep for `"ambiguous"` / `"skipping"`
in routing code and audit each hit for "did I just throw away information
someone else could have used?"

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
