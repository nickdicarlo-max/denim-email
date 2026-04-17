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

## Open items / future tasks

Task 3.1 shipped. Phase 3 Task 3.2 (POST /entity-confirm) is next.

Append new sections here as tasks land.
