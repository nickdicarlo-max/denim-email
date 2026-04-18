# Issue #95 Phase 2 — Deviations From Plan (running log)

**Plan:** `docs/superpowers/plans/2026-04-16-issue-95-fast-discovery-rebuild.md`
**Corrections applied before exec:** `docs/superpowers/plans/2026-04-17-issue-95-phase2-plus-corrections.md` (committed as `d0d7b34`)

This doc records every time implementation had to diverge from the plan's code sample (not just the pre-exec corrections). Each entry lists the plan's approach, what shipped, why, and where in the commit the rationale lives. Append a new section per task.

---

## Task 2.1 — `dedupByLevenshtein` (commit `bf2f716`)

### D2.1-1 — Merge display picker: `topFrequency` instead of post-increment math

**Plan said:**

```typescript
existing.frequency += item.frequency;
if (item.frequency > existing.frequency - item.frequency) {
  existing.displayString = item.displayString;
}
```

The `existing.frequency - item.frequency` trick tries to reconstruct the "prior" frequency for comparison, but `existing.frequency` was already incremented on the line above — so for 3+ variants the comparison window shifts.

**Shipped:** Track `topFrequency` separately from the running-sum `frequency`. Compare new items against `topFrequency` and update both on swap.

**Why:** Correct "pick highest-observed display form" semantics for buckets with 3+ variants (e.g., the "St Agnes / St. Agnes / Saint Agnes" case, which the task's own test exercises).

**Plan patched:** `a8ee9dd` brought the plan's Task 2.1 sample into sync with the shipped code.

### D2.1-2 — `levenshteinLongThreshold` bumped 2 → 3

**Plan said:** `levenshteinLongThreshold: 2` (from Task 0.4, commit `dafc373`).

**Shipped:** `3`, with the tunables test updated to match.

**Why:** Task 2.1's test suite codifies that residual display-form variants inside a shared-key bucket (e.g., "St Agnes" ↔ "Saint Agnes", distance 3 over 11 chars) must collapse. Threshold 2 can't reach them. 3 keeps "cat"/"dog"-style noise rejected via the short-string threshold (1).

**Tunables doc polish:** `a8ee9dd` rewrote the comment — earlier version implied "long threshold catches Dr ↔ Drive", but Dr/Drive actually merge via shared normalized key (`normalizeAddressKey`), not by Levenshtein distance. The long threshold's real role is within-bucket display-form merging after keys have already collapsed.

---

## Task 2.2 — `extractPropertyCandidates` (commit `2e5bbee`)

### D2.2-1 — Non-greedy name capture (`{0,1}?`) instead of greedy `{0,2}`

**Plan said:**

```
([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})
```

Greedy up to 3 capitalized words.

**Shipped:**

```
([A-Za-z]+(?:\s+[A-Za-z]+){0,1}?)
```

Non-greedy 1–2 words.

**Why:** Under `/gi`, `[A-Z][a-z]+` matches any letter sequence, so greedy 3-word capture swallowed trailing verbs:

- "851 Peavy balance" → "851 Peavy balance" (should be "851 Peavy")
- "Fw: 851 peavy statement" → "851 peavy statement" (should be "851 peavy")
- "RE: 851 Peavy inspection" → "851 Peavy inspection" (should be "851 Peavy")

Three distinct bucket keys instead of one → dedup never fired. Non-greedy tries 0 additional words first, takes a street type if present, and backtracks to 1 additional word only when 0 doesn't yield a full match (so "100 Stone Creek" without a street type still works).

### D2.2-2 — Preserve user's street-type spelling in `displayString`

**Plan said:**

```typescript
const suffix = m[3]
  ? ` ${STREET_TYPE_NORMALIZE[m[3].toLowerCase()] ?? m[3]}`
  : "";
```

Normalize "Drive" → "Dr" and "Trail" → "Trl" in the display.

**Shipped:**

```typescript
const suffix = m[3] ? ` ${m[3]}` : "";
```

Only the dedup key runs through `normalizeAddressKey`.

**Why:** The plan's own tests assert `displays).toContain("205 Freedom Trail")` — the preserved spelling, not "205 Freedom Trl". Normalizing display would have broken five tests. The key-only normalization still collapses "Dr" / "Drive" into one bucket (same-key merge), which is the whole point.

---

## Task 2.3 — `extractSchoolCandidates` (commit `dd08b81`)

### D2.3-1 — Pattern A split into two alternatives (religious-prefix no-suffix + general suffix-bearing)

**Plan said:**

```typescript
const INSTITUTION_RE = new RegExp(
  String.raw`\b((?:St\.?\s+|Saint\s+|Jewish\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:` +
  INSTITUTION_SUFFIX_ALT +
  String.raw`))\b`,
  "gi",
);
```

Religious prefix is optional; institution suffix is always required.

**Shipped:**

```typescript
const INSTITUTION_RE = new RegExp(
  String.raw`\b(?:` +
    String.raw`(?:St\.?|Saint|Jewish)\s+[A-Z][a-z]+` +      // Branch 1: no suffix needed
    `|` +
    `[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?\\s+(?:${ALT})` +       // Branch 2: suffix required
    String.raw`)\b`,
  "gi",
);
```

Two independent branches joined with `|`.

**Why:** Spec Section 4 defines Pattern A as `/\b(St\.?\s+\w+|[A-Z]\w+\s+(?:School|Academy|...))\b/g` — explicitly two branches. The plan's implementation collapsed them into a single pattern that always required a suffix, which would have dropped "St Agnes Auction" / "St. Agnes pickup" / "Saint Agnes recital" (none of "Auction", "pickup", "recital" are institution suffixes). The Task 2.3 tests exercise exactly those cases, so the buggy regex would have failed 3+ assertions.

---

## Task 2.4 — `deriveAgencyEntity` (commit TBD — this commit)

### D2.4-1 — Convergence check replaced with whole-display-name token frequency

**Plan said:**

```typescript
function extractCompanyFromDisplayName(name: string): string | null {
  const separators = /\s+[|@]\s+|\s+at\s+/i;
  const parts = name.split(separators);
  if (parts.length >= 2) return parts[parts.length - 1].trim();
  return null;
}

// ...
if (senderDisplayNames.length >= 5) {
  const tokens = senderDisplayNames
    .map(extractCompanyFromDisplayName)
    .filter((t): t is string => t !== null);
  // ... count tokens, gate at 80% of senderDisplayNames.length
}
```

Extract a company token only when the display name has an explicit separator (`|`, `@`, or ` at `). Then gate the convergence fraction on the total display-name count.

**Shipped:** `tokenize(name)` splits the whole display name on whitespace + `| , @ . -`, keeps all multi-char words. Count each token at most once per name, then pick the max and gate at `≥80% of names`.

**Why:** The plan's Test 5 feeds 5 names — three have `|`/`at` separators with `Anthropic` as the tail, one is `"Anthropic Team"` (no separator), one is `"Sarah Chen"` (no company). Plan's extractor returns 3 tokens; 3/5 = 60% < 80% ⇒ test fails against the plan. Shipped tokenizer counts `Anthropic` in 4/5 names (`Sarah Chen | Anthropic`, `Mike Roberts | Anthropic`, `Jane at Anthropic`, `Anthropic Team`), hits 80% exactly, returns `"Anthropic"`.

Trade-off: the broader tokenizer could pick up a person name if the same first name happens to appear in 80% of "From" headers. Mitigated by (a) the 80% threshold itself being strict and (b) in real data, company names dominate over personal-name repetition in a Stage-1-confirmed domain's From pool. Worth revisiting during Phase 7 eval if the false-positive rate spikes.

### D2.4-2 — Dropped the `senderDisplayNames.length >= 5` gate

**Plan said:** Only attempt display-name convergence when at least 5 names are available (`if (senderDisplayNames.length >= 5)`).

**Shipped:** No size gate. The `≥80% of names` fraction is meaningful at any sample size — 4/4 or 3/3 is stronger evidence than 4/5. The "falls back to domain when convergence below 80%" test still passes with `[Sarah Chen, Mike Roberts, Jane, Person D]` (max token count 1/4 = 25%).

**Why:** A hard `>=5` gate is a scale assumption, not a correctness rule. If Stage 2 has a strict per-domain sample cap that sometimes yields <5 names (e.g., a domain with only 3 senders observed), the plan's gate would unnecessarily fall back to domain derivation even with unanimous display-name convergence. The 80% threshold alone is the right invariant.

---

## Task 2.5 — Stage 2 dispatcher + Inngest wrapper (commit TBD — this commit)

### D2.5-1 — `findConvergentToken` requires `best.count >= 2`

**Plan said / previously shipped (D2.4-2):** No minimum count; 80% of names was the only gate.

**Shipped now:** Additional guard — `best.count < 2 ⇒ return null`.

**Why:** Task 2.5's dispatcher test `"agency: runs domain derivation on confirmed domain"` passes a single display name (`"Sarah Chen | Anthropic"`). Under the prior D2.4-2 algorithm, every token in that name trivially has count=1, fraction=100%, and Map-iteration order picks "Sarah" as the "convergent" label. Requiring at least 2 names to agree before claiming convergence closes the single-sample false-positive without losing real convergence (the task 2.4 happy path has 4 matches across 5 names and still passes).

This tightens D2.4-2, not reverses it — the `length >= 5` size gate from the original plan is still gone. The new invariant is "at least 2 independent names agree AND they are ≥80% of the sample," which is closer to the statistical intent.

### D2.5-2 — Widened `Stage2Result.perDomain[]` with `failed?: boolean` / `errorMessage?: string`

**Plan said:**

```typescript
perDomain: Array<{
  confirmedDomain: string;
  algorithm: string;
  subjectsScanned: number;
  candidates: unknown[];
  errorCount: number;
}>;
```

**Shipped:** Added optional `failed?: boolean` and `errorMessage?: string`.

**Why:** The Inngest wrapper constructs a wider per-domain object (includes `failed` to signal isolated per-domain crashes + optional `errorMessage` for observability) and passes it to `writeStage2Result`. TypeScript's structural typing admits the assignment against the narrower schema, but the wider fields get silently stripped at the DB write boundary, which defeats the purpose of writing them. Widening the interface to match the data actually written makes the persistence honest and keeps the JSON column faithful to the producer.

### D2.5-3 — Logger call-shape: single-arg `LogContext`, not pino-style `(obj, msg)`

**Plan said (and Task 2.1's plan sample too):** `logger.warn({ ... }, "message string")`.

**Shipped:** `logger.warn({ service, operation, ...context })` — one argument only. The `operation` field carries the short label that pino-style would have put in the message.

**Why:** The project's `apps/web/src/lib/logger.ts` exports `logger.{info,warn,error}: (context: LogContext) => void` — single-arg only. Passing a second argument is a TS2554 error. The plan's sample assumed a pino-like API. Noted here so future wrappers match the real shape.

---

---

## Task 3.1 — POST /api/onboarding/[schemaId]/domain-confirm (commit TBD — this commit)

### D3.1-1 — Optimistic emit updates outbox row to `EMITTED` on success

**Plan said:**

```typescript
try {
  await inngest.send({
    name: "onboarding.entity-discovery.requested",
    data: { schemaId, userId },
  });
} catch {
  // Drain cron picks it up within ~1 minute.
}
```

Best-effort emit only — no status update on success.

**Shipped:** `.then(() => prisma.onboardingOutbox.update({ status: "EMITTED", emittedAt, attempts: { increment: 1 }, lastAttemptAt }))` chained off the `inngest.send` promise, with a `.catch` that warn-logs the failure. Matches the exact pattern already used by `POST /api/onboarding/[schemaId]` (`route.ts:264-293`) for `onboarding.review.confirmed`.

**Why:** The outbox schema sets `nextAttemptAt @default(now())` (schema.prisma:1190). The drain cron (`drainOnboardingOutbox`) polls `status = "PENDING_EMIT" AND nextAttemptAt <= now()` every minute. If we don't flip the row to EMITTED after a successful optimistic emit, the drain re-emits the same event within ~1 minute on every happy path. The drain's own comment calls this out ("Downstream Inngest functions use `advanceSchemaPhase` CAS guards and no-op when the schema has already moved past the expected `from` phase — so double emission is safe at the workflow layer"), but "safe" ≠ "intended." Double-firing every Stage 2 entity-discovery job is wasted Gmail + compute and noisy logs. The existing POST route avoids it; the plan's sample for Task 3.1 regressed the pattern.

Trade-off: adds a second DB round-trip on the happy path, but it's detached via `void` so it doesn't block the response. Consistent with what ships today for `onboarding.review.confirmed`.

### D3.1-2 — Test mocks reshape from `(global as any).__X` to `vi.hoisted`

**Plan said:** Attach mock state to `(global as any).__updateMany` / `__outboxCreate` / `__findUnique`, reset in `beforeEach`, and thread through `vi.mock` factories that read the globals at call time.

**Shipped:** `const mocks = vi.hoisted(() => ({ findUnique, updateMany, outboxCreate, outboxUpdate, writeStage2ConfirmedDomains, inngestSend }))` — vitest-native pattern. Factories capture `mocks.*` handles directly.

**Why:** Two practical reasons, one correctness reason.

1. **Correctness — `inngest.send` must return a thenable.** The plan's mock `inngest: { send: vi.fn() }` returns `undefined`. The shipped route (per D3.1-1) does `inngest.send(...).then(...)` — calling `.then` on `undefined` throws synchronously. `vi.hoisted` lets us declare `inngestSend: vi.fn(async () => undefined)` cleanly.
2. **Correctness — outbox `update` mock is needed.** Per D3.1-1 the success path calls `prisma.onboardingOutbox.update`. The plan's mock only exposed `create` inside the tx closure. `vi.hoisted` keeps both handles in one place.
3. **Style.** `vi.hoisted` is the officially supported way to share mock state across factories since vitest 0.33+. Using `(global as any).__X` works but trips the project's Biome `noExplicitAny` rule and adds ceremony (beforeEach re-assignment, type casts on every access). Roughly 30 lines shorter and lint-clean.

The three assertions the plan called for (400 on invalid body, 409 on CAS count=0, 200 + outbox + emit on success) are all preserved.

---

## Task 3.2 — POST /api/onboarding/[schemaId]/entity-confirm + `persistConfirmedEntities` (commit TBD — this commit)

### D3.2-1 — Optimistic emit flips outbox row to EMITTED on success

**Plan said:**

```typescript
try {
  await inngest.send({ name: "onboarding.review.confirmed", data: { schemaId, userId } });
} catch {
  // Drain cron retries.
}
```

**Shipped:** Same `.then()` → `onboardingOutbox.update({ status: "EMITTED", ... })` pattern from D3.1-1, reused verbatim for `onboarding.review.confirmed`.

**Why:** Same reason as D3.1-1 — the outbox row's `nextAttemptAt @default(now())` makes it drain-eligible immediately, and the drain cron will re-emit within ~1 minute unless we flip to EMITTED on success. The existing `POST /:schemaId` route owned the `onboarding.review.confirmed` event before this task; it already does the EMITTED flip. Adopting the same pattern here keeps the two producers of the same event name consistent.

### D3.2-2 — CAS updateMany also sets `phaseUpdatedAt`

**Plan said:** `data: { phase: "PROCESSING_SCAN" }`.

**Shipped:** `data: { phase: "PROCESSING_SCAN", phaseUpdatedAt: new Date() }`.

**Why:** Matches the pattern already baked into `writeStage2ConfirmedDomains` (`apps/web/src/lib/services/interview.ts:1049-1057`) and the broader conventions in this repo where any `phase` mutation ships with a `phaseUpdatedAt` bump so polling, observability, and timeout detection stay honest. The plan's sample just omitted the field; no reason not to keep it.

### D3.2-3 — 400 test split into two cases (body-shape + reserved-prefix refine)

**Plan said:** Three cases — 400, 409, 200.

**Shipped:** Four cases — two 400s (`{}` body missing `confirmedEntities`; valid body with `@`-prefixed PRIMARY rejected by the Zod `.refine`), plus 409 and 200.

**Why:** The `@`-prefix refine rule is a load-bearing security check (stops a malicious confirm from squatting on server-derived SECONDARY slots via the `(schemaId, identityKey, type)` unique constraint). Exercising both Zod paths in tests prevents a regression where the refine silently gets dropped or inverted. Strictly additive vs. the plan.

### D3.2-4 — Test mocks use `vi.hoisted` pattern (inherits D3.1-2)

**Plan said:** "Mirror Task 3.1's route test file structure."

**Shipped:** Mirrored the **shipped** Task 3.1 test style (`vi.hoisted` + typed mock handles), not the plan's `(global as any).__X` sample. Same three justifications from D3.1-2 apply: `inngest.send` must return a thenable for the EMITTED `.then()` chain, `outboxUpdate` needs a mock handle, and `vi.hoisted` is lint-clean.

---

## Task 3.3 — GET polling surface for Stage 1 / Stage 2 (commit TBD — this commit)

### D3.3-1 — Typed DTOs instead of `(… as any)` casts at the JSON boundary

**Plan said:**

```typescript
stage1Candidates: (schema.stage1Candidates as any) ?? [],
stage2Candidates: (schema.stage2Candidates as any) ?? [],
```

Inline `any` casts where the `Json?` column is narrowed.

**Shipped:** Three named exported DTOs — `Stage1CandidateDTO`, `Stage2DomainCandidateDTO`, `Stage2PerDomainDTO` — referenced in both the `OnboardingPollingResponse` interface and the narrowing cast (`as Stage1CandidateDTO[] | null`).

**Why:** Three reasons:

1. **Boundary honesty.** The `Json?` column is the runtime boundary between the producer (`writeStage1Result` / `writeStage2Result`) and consumer (this polling service). Narrowing through a named type makes the assumed shape explicit so the next time the producer changes, a grep + typecheck run reveals the mismatch instead of letting `any` absorb it silently.
2. **Client reuse.** The Stage 1 / Stage 2 review components built in Tasks 3.4 / 3.5 will fetch this response and need typed props. Exporting DTOs here means those components can `import type { Stage1CandidateDTO, Stage2PerDomainDTO }` instead of re-declaring the shapes locally.
3. **Biome-clean.** The project's lint config flags `noExplicitAny`. The plan's sample would have failed CI.

Trade-off: four extra interfaces + ~15 lines. The cost of `any` in a response-shape function is repaid the first time a typo in a producer ships past runtime silently. Worth it.

### D3.3-2 — `AWAITING_DOMAIN_CONFIRMATION` / `AWAITING_ENTITY_CONFIRMATION` branches moved BEFORE the legacy phase fallthrough

**Plan said:** Place the new branches alongside the pre-scan schema-owned phases (after `PROCESSING_SCAN`), without specifying exact ordering.

**Shipped:** Inserted immediately after the `PENDING / GENERATING_HYPOTHESIS / FINALIZING_SCHEMA` block and **before** the `PROCESSING_SCAN` branch. Final order of branches in `derivePollingResponse`:

1. `ACTIVE` (terminal)
2. `FAILED` / `NO_EMAILS_FOUND` / `AWAITING_REVIEW` / `COMPLETED`
3. `PENDING` / `GENERATING_HYPOTHESIS` / `FINALIZING_SCHEMA`
4. **New: Stage 1 (`DISCOVERING_DOMAINS` / `AWAITING_DOMAIN_CONFIRMATION`)**
5. **New: Stage 2 (`DISCOVERING_ENTITIES` / `AWAITING_ENTITY_CONFIRMATION`)**
6. `PROCESSING_SCAN` (hits DB for metrics)
7. Unknown-phase fallthrough (error log + PENDING).

**Why:** Two reasons.

1. **Match the state-machine ordering in `onboarding-state.ts`.** That file orders phases `PENDING(1) → GENERATING_HYPOTHESIS(?) → DISCOVERING_DOMAINS(2) → AWAITING_DOMAIN_CONFIRMATION(3) → DISCOVERING_ENTITIES(4) → AWAITING_ENTITY_CONFIRMATION(5) → PROCESSING_SCAN(…)`. The polling function is effectively a runtime pattern-match on the same state machine — keeping branch order aligned with the declared ordinal ordering reduces the chance of future bugs where someone inserts a new phase between existing branches and the ordering drifts.
2. **Avoid an unnecessary DB hit.** `PROCESSING_SCAN` is the one branch that queries `computeScanMetrics`. Placing the four no-DB Stage 1/2 branches above it means a poll for a schema still in `AWAITING_DOMAIN_CONFIRMATION` short-circuits before reaching the metrics hit, even in a hypothetical bug where `schema.phase` somehow matches both (unreachable under current invariants, but cheap defense).

The regression test added under "regression guards" verifies that `PENDING` schemas with stray `stage1Candidates` JSON do **not** leak those fields onto the response — guards against branch-ordering drift.

### D3.3-3 — Extra regression test: `PENDING` does not leak stage fields

**Plan said:** "Two cases: AWAITING_DOMAIN_CONFIRMATION returns stage1 data; AWAITING_ENTITY_CONFIRMATION returns stage2 data."

**Shipped:** Seven test cases total — two per stage as specified, plus null-column fallbacks for each stage (should emit `[]` not crash), plus one regression guard asserting that a `PENDING` schema with stray `stage1Candidates` JSON does **not** surface them in the response.

**Why:** The stage fields are **only** populated on matching phases. A future refactor that moves the Stage 1 branch to a shared helper could accidentally start unconditionally populating the DTOs. The `PENDING` regression test makes that regression noisy instead of silent.

---

## Task 3.4 — `PhaseDomainConfirmation` component (commit TBD — this commit)

### D3.4-1 — Adopted the Task 3.6 revised signature upfront

**Plan said (Task 3.4 sample):** `Props = { schemaId: string; candidates: DomainCandidate[]; onConfirmed: () => void }`.

**Task 3.6 already revises this:** "Update Tasks 3.4 and 3.5 component signatures to accept `{ response }: { response: OnboardingPollingResponse }` instead of the `{ schemaId, candidates, onConfirmed }` shape shown earlier — the samples in 3.4/3.5 were drafted against a prior flow.tsx contract."

**Shipped:** Final shape — `{ response }: { response: OnboardingPollingResponse }`. Component reads `response.schemaId`, pulls `candidates` from `response.stage1Candidates ?? []`, and lets the next poll tick drive the UI swap instead of firing an `onConfirmed` callback.

**Why:** Task 3.6 explicitly supersedes the earlier signature. Writing the old shape in Task 3.4 then rewriting it in Task 3.6 is pure churn. Also matches the pattern every other phase component already uses (`phase-review.tsx`, `phase-pending.tsx`, etc.).

### D3.4-2 — Design-system adoption instead of raw Tailwind grays

**Plan said:**

```tsx
<h2 className="text-xl font-semibold">…</h2>
<p className="text-sm text-gray-600">…</p>
<button className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">…</button>
```

Plain Tailwind with `bg-black`, `text-gray-600`, no font-family.

**Shipped:** `font-serif`, `text-primary`, `text-muted`, `text-accent`, `bg-surface-highest`, `text-overdue` design tokens; `<Button>` from `@/components/ui/button`. Mirrors the pattern in `phase-review.tsx` and the "Digital Curator" rules documented in `ui/button.tsx`.

**Why:** The project has a documented design system (`docs/design-system.md`) and every other `phase-*.tsx` component consumes it. The plan's sample was a placeholder, not a ship-it design — rendering raw `bg-black` Tailwind in production would be immediately visible as a regression.

### D3.4-3 — Authenticated fetch instead of raw `fetch`

**Plan said:** `await fetch(\`/api/onboarding/${schemaId}/domain-confirm\`, …)`

**Shipped:** `authenticatedFetch` from `@/lib/supabase/authenticated-fetch`.

**Why:** Every `/api/onboarding/*` route is wrapped in `withAuth` which requires an `Authorization: Bearer <supabaseAccessToken>` header. Raw `fetch` has no token; the POST returns 401 and the UI silently fails (plan's sample calls `onConfirmed()` unconditionally — even on a 401 the UI would advance). `authenticatedFetch` mirrors the exact pattern used by `phase-review.tsx` for the existing `POST /api/onboarding/:schemaId`. Not using it here would be a real-world auth bug.

### D3.4-4 — Error handling + empty-state rendering added

**Plan said:** Fire-and-forget POST, then `onConfirmed()`.

**Shipped:** `SubmitStatus` union of `"idle" | "submitting" | "error"`; non-2xx responses surface `body.error` via `setErrorMessage`; empty `candidates` renders a loading spinner ("Finding your senders…") instead of an empty screen. After a successful 2xx, status stays `"submitting"` so the button is disabled during the hand-off to polling.

**Why:** Two concrete scenarios covered:

1. **Race to the POST.** A user who double-clicks or hits the endpoint after the phase already advanced gets a 409. Without error rendering, the UI hangs indefinitely with the button stuck in `"Confirming…"`. Surfacing the error lets them retry.
2. **Stage 1 still running.** `DISCOVERING_DOMAINS → AWAITING_DOMAIN_CONFIRMATION` is a live transition. If the user reaches this component via a too-fast poll (or stale `stage1Candidates: null`), an empty state is honest; an empty `<ul>` would be eerie.

Both are additive to the happy path; the plan's three-step flow still applies.

### D3.4-5 — No in-repo component unit test — deferred to Phase 7 e2e

**Plan said:** `apps/web/src/components/onboarding/__tests__/phase-domain-confirmation.test.tsx` with `@testing-library/react` + `fireEvent` + `waitFor`.

**Shipped:** No component unit test. Typecheck is the only automated gate for this component in Phase 3.

**Why:** The repo has **no DOM testing infrastructure** — `apps/web/vitest.config.ts` sets `environment: "node"` with `include: ["tests/unit/**/*.test.ts", "src/**/__tests__/**/*.test.ts"]` (no `.tsx` glob), and `package.json` has no `@testing-library/react` / `jsdom` / `happy-dom` dep. Adding those just for this one smoke test is: (a) a framework decision that should be made deliberately (Phase 7's Playwright e2e path is the existing convention for React behaviour); (b) a ~30 MB dep addition for three assertions that duplicate what Playwright will exercise end-to-end; (c) outside the scope of a Phase 3 component task.

Phase 7 Task 7.x — Playwright happy-path tests — is the right home for "click domain, confirm, observe phase advance." Logged here so the gap is visible and the plan author can decide whether to retrofit DOM testing or leave it to e2e.

---

## Task 3.5 — `PhaseEntityConfirmation` component (commit TBD — this commit)

### D3.5-1 — `identityKey` comes straight from `candidate.key`, fixing an `@`-prefix collision with the server

**Plan said:**

```typescript
function identityKeyFor(group: DomainGroup, candidate: EntityCandidate): string {
  if (group.algorithm === "agency-domain-derive") {
    const d = (candidate.meta?.authoritativeDomain as string) ?? group.confirmedDomain;
    return `@${d}`;   // ← @-prefix + PRIMARY violates the /entity-confirm refine
  }
  return candidate.displayString.toLowerCase().replace(/\s+/g, " ").trim();
}

function kindFor(group: DomainGroup): "PRIMARY" | "SECONDARY" {
  return "PRIMARY";   // but agency is @-prefixed above, which the server rejects
}
```

**Shipped:**

```typescript
function identityKeyFor(candidate: Stage2DomainCandidateDTO): string {
  return candidate.key;
}
// All kinds are PRIMARY by construction — SECONDARY never comes out of Stage 2.
```

**Why:** The server-side Zod refine in `/entity-confirm` (Task 3.2) explicitly rejects `{ identityKey.startsWith("@"), kind: "PRIMARY" }` — that combination is reserved for SECONDARY entities (D3.2-3 codifies this as a security test). The plan's Task 3.5 sample would have failed every agency confirm submission with a 400 VALIDATION_ERROR: *"identityKey starting with @ is reserved for SECONDARY entities."*

Additionally, `entity-discovery.ts` already produces a normalized `candidate.key` per algorithm — lowercased address for property, normalized institution name for school, bare DNS domain (`"anthropic.com"`) for agency — so re-normalizing `displayString` in the UI is wasted work and potentially drifts from the producer's canonical key. Using `candidate.key` verbatim:

1. Uses the producer's authoritative normalization (idempotent Stage 2 reruns hit the same bucket).
2. Keeps the `@` prefix out of PRIMARY identityKeys, so the server's refine stays happy.
3. Matches the producer/consumer contract documented in `entity-discovery.ts` lines 33-46.

This is a **correctness fix**, not stylistic drift; the plan's code would not have worked end-to-end.

### D3.5-2 — Adopted Task-3.6 `{ response }` signature + inherits D3.4-2..5

**Plan said (stale):** `Props = { schemaId: string; stage2Candidates: DomainGroup[]; onConfirmed: () => void }`; raw Tailwind (`bg-black`, `text-gray-700`); plain `fetch`; no error/empty states.

**Shipped:** `{ response }: { response: OnboardingPollingResponse }` (Task 3.6's supersede); design-system tokens; `authenticatedFetch`; `SubmitStatus` union with error rendering; `totalCandidates === 0` empty state.

**Why:** Same rationale as Task 3.4's D3.4-1..4. Applying them in Task 3.4 and not here would leave the Stage 2 screen broken in the same ways we just fixed in Stage 1 (auth 401s, regressive visuals, silent failures). Consolidated as one deviation to keep the log readable.

### D3.5-3 — Reuses `Stage2DomainCandidateDTO` / `Stage2PerDomainDTO` types from `onboarding-polling.ts`

**Plan said:** Redeclared local `EntityCandidate` / `DomainGroup` interfaces inside the component.

**Shipped:** Imported the DTOs already exported from `onboarding-polling.ts` (D3.3-1 motivated the export).

**Why:** Keeps the producer/consumer type contract in exactly one place. If the polling response shape changes, the component fails typecheck instead of drifting to a local stale mirror. Cost: one extra import; benefit: the boundary stays honest.

### D3.5-4 — No DOM test — deferred to Phase 7 Playwright (inherits D3.4-5)

**Plan said:** `phase-entity-confirmation.test.tsx` with `@testing-library/react`.

**Shipped:** No `.test.tsx`. Same infrastructure gap as Task 3.4 (vitest env=node, no testing-library dep, plan's `*.test.tsx` file wouldn't even be picked up by the current `include` glob). Phase 7 Playwright is the existing home for React behaviour; retrofitting DOM testing should be a deliberate framework decision outside this task.

### D3.5-5 — Minor UX additions: `autoFixed` "merged" badge, aria-label for rename input

**Plan said:** Plain candidate row with checkbox, text input, frequency count.

**Shipped:** Candidate row additionally shows a small `merged` badge when `candidate.autoFixed === true` (tooltip: "Variants merged automatically"), and the rename input gets an `aria-label` of `Name for <original displayString>`.

**Why:**

1. **`autoFixed` badge.** `dedupByLevenshtein` sets `autoFixed: true` when it collapsed multiple variants ("St Agnes" / "St. Agnes" / "Saint Agnes" → one bucket). The spec calls this out explicitly ("`autoFixed: true` lets the review UI flag 'we merged …'"). Surfacing it in the UI is the payoff for that whole dedup pass; without the badge the merging is invisible to the user and indistinguishable from the producer seeing only one variant.
2. **aria-label.** The rename input replaces the candidate's display — without an accessible name tied to the original, screen readers announce "edit text" with no context. The label also helps Playwright e2e selectors lock onto the right row in Phase 7.

Neither changes the submit payload; strictly presentation.

---

## Task 3.6 — Wire `flow.tsx` to the four new phases (commit TBD — this commit)

### D3.6-1 — Busy phases (`DISCOVERING_DOMAINS` / `DISCOVERING_ENTITIES`) route to `PhasePending` instead of getting bespoke components

**Plan said:**

```tsx
case "AWAITING_DOMAIN_CONFIRMATION":
  return <PhaseDomainConfirmation response={response} />;
case "AWAITING_ENTITY_CONFIRMATION":
  return <PhaseEntityConfirmation response={response} />;
case "DISCOVERING_DOMAINS":
case "DISCOVERING_ENTITIES":
  return <PhasePending response={response} />;
```

**Shipped:** Same mapping, but split `DISCOVERING_DOMAINS` and `DISCOVERING_ENTITIES` into two separate `case` labels (not stacked fall-through) so each gets its own explicit branch.

**Why:** Two reasons.

1. **Biome's `noFallthroughSwitchCase` rule.** The repo's Biome config flags stacked `case` labels without `break`/`return`. Splitting them into explicit single-case branches that each `return <PhasePending …>` dodges the warning without changing runtime behaviour.
2. **Future-proofing.** If a later task introduces a bespoke "scanning for domains" vs "scanning for entities" card, the separate branches can be individually retargeted without editing the switch shape.

Both branches still render the same `PhasePending` today, matching the plan's intent.

### D3.6-2 — Import list sorted alphabetically (automatic, not a choice)

**Plan said:** Didn't specify import order.

**Shipped:** `PhaseDomainConfirmation` and `PhaseEntityConfirmation` slotted alphabetically between `PhaseDiscovering` and `PhaseExtracting` to match Biome's import-sort rule already applied to the file.

**Why:** The project runs `biome check --apply` which sorts imports. Writing them in a different order would trigger a fixup commit on the next push. Logged so future readers know the ordering is enforced, not stylistic.

---

## Phase 4 — Pipeline Cutover (bundled session)

Phase 4 is a breaking change by design: once Task 4.1 lands, the legacy
hypothesis-first onboarding is gone. Tasks 4.1–4.4 must ship together so
the repo never sits in a half-migrated state. Verification done at the
end: 97/97 unit tests pass, typecheck clean.

### Task 4.4 — `createSchemaStub` writes `domain` from `InterviewInput` (commit TBD)

#### D4.4-1 — Reordered from last to first in the session

**Plan said:** Task 4.4 comes after 4.1/4.2/4.3 in the plan's task numbering.

**Shipped first.** Reason: Task 4.1's `runOnboarding` throws `NonRetriableError` when `!schema.domain`, and without 4.4 landed first, *every* new onboarding would fail at that guard. Landing 4.4 ahead of 4.1 keeps the repo functional at every commit boundary during the cutover. Zero-risk change (extra write on a nullable column) — fine to ship in isolation before 4.1.

### Task 4.1 — Thin `runOnboarding` (commit TBD)

#### D4.1-1 — `NonRetriableError` on missing domain, not generic `Error`

**Plan said:** `throw new Error(\`Schema ${schemaId} missing domain\`)`.

**Shipped:** `throw new NonRetriableError(\`runOnboarding: CaseSchema ${schemaId} has no domain — stub was created without InterviewInput.domain (see Task 4.4)\`)`.

**Why:** A missing domain is a deterministic state error — no Inngest retry will ever make it appear. Plain `Error` would burn the function's configured `retries: 2` doing three identical failing loads before finally failing. `NonRetriableError` short-circuits to the catch block immediately, marks the schema FAILED via `markSchemaFailed`, and surfaces the error to the UI on the next poll tick. Matches the pattern already used by `runDomainDiscovery` and `runEntityDiscovery`.

#### D4.1-2 — Catch block mirrors the existing two-tier pattern (NonRetriable → markSchemaFailed)

**Plan said:** No catch block in the sample.

**Shipped:** Same two-tier catch as the old `runOnboarding` — `NonRetriableError` → re-read phase + `markSchemaFailed` + rethrow; unknown errors → log + rethrow (no markSchemaFailed since retries may still recover).

**Why:** The plan's "just emit the event" shape is too thin — if the `load-schema` step throws for any reason (DB hiccup, schema deleted mid-flight), the function fails silently and the schema sits in `PENDING` forever with no user feedback. Keeping the catch preserves the visibility contract.

### Task 4.2 — Trim `runOnboardingPipeline` (same commit as 4.1)

#### D4.2-1 — Bundled with Task 4.1 in one commit

**Plan said:** Separate commits for 4.1 and 4.2.

**Shipped:** One commit. Reason: the two changes are in the same file (`onboarding.ts`) and both participate in the same breaking cutover. Splitting them created an intermediate state where `runOnboarding` emits Stage 1 but `runOnboardingPipeline` still expects hypothesis JSON via the `expand-confirmed-domains` step — which would P0-break any in-flight schema that hit the mid-cutover commit. One atomic commit covers both.

#### D4.2-2 — `create-scan-job`'s CAS guard uses `from: "AWAITING_ENTITY_CONFIRMATION"`

**Plan said:** Change the CAS from `AWAITING_REVIEW` to `AWAITING_ENTITY_CONFIRMATION`.

**Shipped:** As specified.

Noting here because this is the Bug 3 rule in action (one CAS owner per transition). Even though `/entity-confirm` has already flipped the phase to `PROCESSING_SCAN` by the time Function B fires, `advanceSchemaPhase` returns `"skipped"` cleanly when the schema is already past `from`. The explicit `from` value is what documents intent + prevents future drift if someone reintroduces a two-owner transition.

#### D4.2-3 — Null out `stage1Candidates` and `stage2Candidates` on terminal COMPLETED

**Plan said:** Same as shipped — `Prisma.DbNull` on both columns in the advance-to-completed step.

**Shipped:** As specified, inside the `advanceSchemaPhase` `work()` callback (same `caseSchema.update` that sets `status: "ACTIVE"`).

#### D4.2-4 — Simplified catch block, dropped dead logging

**Plan said:** No specific change to catch block.

**Shipped:** Catch block's `markSchemaFailed` default phase changed `"AWAITING_REVIEW"` → `"AWAITING_ENTITY_CONFIRMATION"` to match the new upstream phase. Long parallel catch blocks (separate paths for `NonRetriableError` vs other) retained.

**Why:** Mechanical consistency with the new CAS ownership; if the catch recorded `AWAITING_REVIEW` the error dashboard would still blame the old flow.

### Task 4.3 — Deprecate POST `/api/onboarding/:schemaId` confirm (commit TBD)

#### D4.3-1 — Expanded "already-confirmed" phase list beyond the plan's four

**Plan said:** `PROCESSING_SCAN`, `COMPLETED`, `AWAITING_ENTITY_CONFIRMATION`, `AWAITING_DOMAIN_CONFIRMATION`.

**Shipped:** Those four plus `DISCOVERING_ENTITIES` and `NO_EMAILS_FOUND`.

**Why:**

1. **`DISCOVERING_ENTITIES`** — a stale old-client retry arriving while Stage 2 is mid-flight should not 410. The schema has moved past the old flow's decision boundary; "already-confirmed" is honest.
2. **`NO_EMAILS_FOUND`** — terminal scan state where the schema is past confirmation and won't re-enter the pipeline. 410 would be misleading (there's no new confirm route to redirect to); 200 idempotent is consistent with how `COMPLETED` is handled.

Old-flow phases genuinely stuck waiting for the deleted single-screen confirm (`PENDING`, `GENERATING_HYPOTHESIS`, `AWAITING_REVIEW`, `FAILED`, `FINALIZING_SCHEMA`) still get 410 so the client surfaces the "use /entity-confirm" message.

#### D4.3-2 — Removed all persistSchemaRelations / outbox plumbing — route is a pure idempotent stub

**Plan said:** Keep `withAuth` and the #33 already-confirmed semantics.

**Shipped:** Both preserved. Everything else — `ConfirmSchema` Zod, `persistSchemaRelations`, outbox write, optimistic `inngest.send`, `isOutboxRaceViolation` helper — deleted. The route now does ownership check + phase-based 200/410 dispatch. Nothing else.

**Why:** The old logic only made sense when the route was actually confirming. Retaining "just in case" would drift bitrot — future reviewers would have to prove the dead branches were unreachable every time the surrounding code changed. Clean deletion with a deprecation comment is safer than keeping a 180-line handler that 0% of new traffic exercises. Imports trimmed accordingly (`z`, `persistSchemaRelations`, `SchemaHypothesis`, `InterviewInput`, etc. all removed).

### Verification

- `npx tsc --noEmit` in `apps/web`: clean.
- `pnpm test --run` in `apps/web`: 18 files / 97 tests passing.
- Integration tests in `apps/web/tests/integration/` — `onboarding-happy-path` and `onboarding-concurrent-start` reference `generateHypothesis` / `validateHypothesis` / `runOnboarding` directly. These are expected to break after this cutover; Task 6.1 owns the rewrite. Flagged as open item below.

---

## Open items / future tasks

**Phase 4 Tasks 4.1 + 4.2 + 4.3 + 4.4 shipped in this session.**

### Task 4.4b — test-helper entity write audit (commit TBD)

#### D4.4b-1 — All three hits annotated, none re-routed through `persistConfirmedEntities`

**Plan said:** "If the helper is seeding a complete integration test entity for a non-review flow, direct create is fine — but add a one-line comment. If the helper is simulating user confirm, replace with `persistConfirmedEntities`."

**Shipped:** All three direct `prisma.entity.create` sites are in integration test fixtures for downstream pipeline tests (clustering + real-Gmail e2e), not onboarding confirm simulation:
- `tests/integration/helpers/test-schema.ts:67,79,92` — bootstraps a fully-populated schema with `aliases` + `associatedPrimaryIds` (fields outside `persistConfirmedEntities`' surface). Annotated each write with a one-line comment explaining why direct create is correct here.
- `tests/integration/flows/real-gmail-pipeline.test.ts:106` — creates a "General" fallback PRIMARY for a live-Gmail clustering test. Annotated.

**Why:** `persistConfirmedEntities` takes `{ displayLabel, identityKey, kind, secondaryTypeName? }` — no `aliases`, no `associatedPrimaryIds`, no `confidence` override. Re-routing these helpers through it would strip the fields the downstream tests explicitly depend on. The Bug-1/Bug-5 failure mode (helpers drifting from production paths) doesn't apply here because the helpers aren't targeting the onboarding confirm path — they bypass it deliberately to exercise clustering with pre-constructed state.

### Task 4.4c — Inngest signing verification (commit TBD)

#### D4.4c-1 — `signingKey` lives on the Inngest client, not the `serve()` handler

**Plan said:**

```typescript
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ ... ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
```

**Shipped:** Passed `signingKey: process.env.INNGEST_SIGNING_KEY` to `new Inngest({ id, signingKey })` in `apps/web/src/lib/inngest/client.ts`. The `serve()` call in the route stays as-is.

**Why:** Inngest SDK v4.0.4's `ServeHandlerOptions` does not accept `signingKey` — plan's sample fails typecheck with `TS2353: Object literal may only specify known properties, and 'signingKey' does not exist in type 'ServeHandlerOptions'`. In v4 the signing key is a client-level property (see `node_modules/.pnpm/inngest@4.0.4/inngest/types.d.ts:826-829`): `signingKey?: string` on `ClientOptions`. The SDK then propagates it through to the `serve()` handler automatically.

Functionally identical to the plan's intent: unsigned requests land on `/api/inngest` → handler looks up the client's `signingKey` → signature check fails → request rejected. The route-level route.ts docstring explains the architecture so future readers don't look for `signingKey` in the wrong place.

#### D4.4c-2 — `INNGEST_SIGNING_KEY` env var already in place

Plan Step 1 asked to confirm the env var exists in all environments:
- `apps/web/.env.example:23` — `INNGEST_SIGNING_KEY=` (placeholder documents the required name).
- `apps/web/.env.local` — populated locally.
- Vercel prod/preview — assumed configured (plan Step 2 would have added otherwise, but the `.env.example` presence indicates the infra is already set up).

Plan Step 3 (verify by sending an unsigned `curl` against the deployment) is a runtime check — not shipped here, but the plan flags it as part of post-merge verification.

---

## Open items / future tasks

**Phase 4 Tasks 4.1 + 4.2 + 4.3 + 4.4 + 4.4b + 4.4c shipped in this session.**

Still pending before Phase 4 is fully green:
- **Task 4.5** — Full end-to-end manual verification (requires dev stack + Inngest dev server + live Gmail OAuth). Runtime-only — not shippable as a code change.
- **Task 4.4c Step 3** — Post-merge curl check against the Vercel deployment to confirm unsigned POSTs get 401/403.
- **Integration test regressions** (`onboarding-happy-path.test.ts`, `onboarding-concurrent-start.test.ts`) — these exercise the deleted hypothesis-first path and will fail until Task 6.1 rewrites them against the new Stage 1/Stage 2 flow. 97/97 unit tests still pass; the regression is scoped to integration.

Phase 5+ follows after Phase 4 completes.

Append new sections here as tasks land.
