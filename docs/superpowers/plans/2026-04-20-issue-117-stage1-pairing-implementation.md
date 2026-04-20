# Implementation Plan — #117 Stage 1 per-whats pairing + safety hygiene

**Date:** 2026-04-20
**Branch:** `feature/perf-quality-sprint`
**Spec:** `docs/superpowers/specs/2026-04-19-issue-117-stage1-pairing-and-hygiene.md`

## Pre-flight findings

- `UserThingResult` currently lives in `apps/web/src/lib/discovery/user-hints-discovery.ts`, NOT `packages/types`. Spec implies leave it local — the DTO copy in `apps/web/src/lib/services/onboarding-polling.ts` (`Stage1UserThingDTO`) also needs the new `sourcedFromWho?: string` field so the UI can read it.
- `InterviewInput.groups` already exists in `packages/types/src/schema.ts`.
- `InterviewInputSchema` already declares `groups: z.array(EntityGroupSchema).default([])` (validation/interview.ts), so the start-route body already accepts `groups`. No Zod change needed.
- `buildHypothesisPrompt(input, tunables)` in `packages/ai/src/prompts/interview-hypothesis.ts` already reads `input.groups` directly. `generateHypothesis` / `validateHypothesis` are not on the active Stage 1 pipeline (only `scripts/eval-run.ts`), so no additional wiring required for Claude to see pairings — as long as we persist `groups` into the `inputs` JSONB, it flows end-to-end.
- Stage 1 pipeline = `runDomainDiscovery` in `apps/web/src/lib/inngest/domain-discovery-fn.ts`, which loads `inputs` from CaseSchema and calls `discoverUserNamedThings` / `discoverUserNamedContacts`.

## Order constraint

Types first, engine/ai second, backend wiring third, API route fourth, UI last. Compilation stays green at every commit.

## Tasks

### Task 1 — Add `sourcedFromWho` to `UserThingResult` + polling DTO
**Files:**
- `apps/web/src/lib/discovery/user-hints-discovery.ts` (interface)
- `apps/web/src/lib/services/onboarding-polling.ts` (Stage1UserThingDTO)

Add `sourcedFromWho?: string` as an optional field. No callers break; optional field.

**Verification:** `pnpm typecheck` clean.

**Commit:** `feat(types): #117 add sourcedFromWho to UserThingResult + DTO`

### Task 2 — Extend `discoverUserNamedThings` with pairing + safety filter
**File:** `apps/web/src/lib/discovery/user-hints-discovery.ts`

- Add optional `options?: { whoResults: UserContactResult[]; groups: EntityGroupInput[] }` param
- Split `aggregateThingResult` into two internal helpers: `aggregateFullTextThingResult` (today's logic + safety filter) and `attributeFromPairedWho` (new)
- New safety filter in full-text path: drop domains that match `/^news\./`, `/^alerts\./`, `/^t\./`, or end in `.edu` when `userDomain` doesn't end in `.edu`. KEEP `email.*` / `mail.*`.
- Pairing logic:
  1. For each WHAT, collect paired WHOs from `options.groups`.
  2. Pick the WHO with highest `matchCount` from `options.whoResults`.
  3. If that WHO has `matchCount > 0`, set `topDomain = senderDomain`, `matchCount = who.matchCount`, `sourcedFromWho = who.query`. Skip the full-text Gmail call (spec says "the per-WHAT Gmail query still runs for the 0-match fallback case" — actually re-read: spec says run it for the fallback case, so we always run it but ignore unless fallback).
  4. Simpler execution: always run full-text; if paired WHO has matches, override; if paired WHO has 0 matches, use full-text result (which goes through the safety filter).
- Import `EntityGroupInput` from `@denim/types`.

**Verification:** extend `user-hints-discovery.test.ts` with 6 new test cases (per spec § Verification):
- Paired WHAT gets `topDomain` from highest-matchCount paired WHO
- Paired WHAT with all-0-match WHOs falls back to full-text
- `sourcedFromWho` populated on paired, absent on full-text
- Safety filter drops `news.bloomberg.com`
- Safety filter drops `alerts.foo.com`, `t.bar.com`
- Safety filter drops `bucknell.edu` when user not on .edu; keeps it when user IS on .edu
- Safety filter KEEPS `email.teamsnap.com` and `mail.something.com`
- Empty groups → identical output (regression)

Run `pnpm --filter web test user-hints-discovery` and verify all pass.

**Commit:** `feat(discovery): #117 per-whats pairing attribution + safety filter`

### Task 3 — Sequence `discoverUserNamedContacts` before `discoverUserNamedThings`
**File:** `apps/web/src/lib/inngest/domain-discovery-fn.ts`

Replace the `Promise.all` with:
1. Kick off `discoverDomains` and `discoverUserNamedContacts` in parallel.
2. Await both.
3. Call `discoverUserNamedThings(gmail, whats, userDomain, { whoResults: userContacts, groups })` once contacts return.

Load `groups` from `inputs?.groups ?? []` in the same block. Broaden the inline `inputs` type cast to include `groups?: EntityGroupInput[]`.

Small wall-clock cost only when the user has WHOs. If no WHOs, `userContacts` is `[]` and the pairing path is a no-op.

**Verification:** `pnpm typecheck` clean. No new unit test (wiring only).

**Commit:** `feat(inngest): #117 sequence user contacts before user things for pairing`

### Task 4 — Verify API route + stub already accept `groups`
**Files checked, NO changes expected:**
- `apps/web/src/app/api/onboarding/start/route.ts` — `StartBodySchema.inputs` = `InterviewInputSchema` which already declares `groups`.
- `apps/web/src/lib/services/interview.ts` — `createSchemaStub` persists `inputs` as-is JSONB.

**Verification:** confirm by reading; no code change. If anything's missing, fix here.

### Task 5 — Extend `onboarding-storage` to accept `groups`
**File:** `apps/web/src/lib/onboarding-storage.ts`

Add `groups?: EntityGroupInput[]` to `OnboardingNames`. Older saved sessions (without `groups`) still load — JSON parse just returns undefined for the new field.

**Verification:** `pnpm typecheck`.

**Commit:** `feat(onboarding): #117 persist groups in onboarding-storage`

### Task 6 — UI pairing in names/page.tsx
**File:** `apps/web/src/app/onboarding/names/page.tsx`

- Add local `pairings: Map<string, Set<string>>` state (WHO → set of WHATs)
- When a WHAT is removed, remove it from every entry's Set
- When a WHO is removed, drop their entry
- Below each WHO row, if `whats.length > 0`, render "focuses on:" + pill chips for each WHAT that toggle membership
- Selected chip: `bg-accent-soft text-accent-text`; unselected: muted neutral
- Section intro adds the copy: *"If a person focuses on one topic, tap it below. If they help with several, leave blank."*
- On Continue: derive `groups: EntityGroupInput[]` = [for each WHO with ≥1 paired WHAT, push `{ whats: [...selected], whos: [who] }`]. Unpaired WHOs contribute nothing to groups.
- Persist via `onboardingStorage.setNames({ whats, whos, groups, name? })`

**Verification:** `pnpm typecheck` and `pnpm biome check --apply`. Manual smoke (deferred — can't run dev server in this agent): names page renders, pills toggle, groups JSON correct on Continue.

**Commit:** `feat(onboarding): #117 inline WHO→WHAT pairing chips on names page`

### Task 7 — Wire `groups` through to API POST /start
**File:** to be located — search for the submit path that calls `POST /api/onboarding/start`.

Inspect the Stage-1 trigger (likely `apps/web/src/app/onboarding/connect/page.tsx` or similar). Ensure it reads `groups` from `onboardingStorage.getNames()` and includes it in the POST body's `inputs`.

**Verification:** `pnpm typecheck`.

**Commit:** `feat(onboarding): #117 forward groups to POST /onboarding/start`

### Task 8 — UI provenance label on paired WHATs
**File:** `apps/web/src/components/onboarding/phase-domain-confirmation.tsx`

At line ~273, conditionally append ` (via <sourcedFromWho>)` when `thing.sourcedFromWho` is present.

**Verification:** `pnpm typecheck`, `pnpm biome check --apply`.

**Commit:** `feat(ui): #117 show provenance on paired WHAT rows`

### Task 9 — Integration test stub (deferred run)
**File (new):** `apps/web/tests/integration/onboarding/stage1-with-groups.test.ts`

Minimal skeleton that mocks the Gmail client and asserts the end-to-end Stage 1 output includes `sourcedFromWho`. Skip execution in this agent (integration tests need dev server). Leave `describe.skip(...)` or mark TODO so CI doesn't fail.

**Commit:** `test(integration): #117 stub Stage 1 groups E2E test`

### Task 10 — Final verification pass
- `pnpm typecheck`
- `pnpm -r test` (unit only, no integration)
- `pnpm biome check --apply`

Fix any lingering issues with small follow-up commits.

## Invariants re-verified

- `groups: []` path = today's behavior (unit test enforces)
- No DB migration (inputs JSONB already there)
- Pairing is optional in UI (never gates continue)
- Packages stay I/O-free (we only touched `packages/` if at all — and this plan avoids that; all logic lives in `apps/web`)

## Out of scope

Same as spec: #100, #102, #118, #86. No Stage 2 changes, no relevance-gate work.
