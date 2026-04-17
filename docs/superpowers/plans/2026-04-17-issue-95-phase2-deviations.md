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

## Open items / future tasks

- Task 2.4 (agency-entity) — not yet started.
- Task 2.5 (dispatcher + Inngest wrapper) — corrections already applied to the plan; deviations during implementation TBD.

Append new sections here as tasks land.
