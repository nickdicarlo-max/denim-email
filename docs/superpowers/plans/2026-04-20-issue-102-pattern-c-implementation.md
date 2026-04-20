# Pattern C corpus frequency mining — implementation plan (#102)

**Date:** 2026-04-20
**Spec:** `docs/superpowers/specs/2026-04-19-issue-102-pattern-c-corpus-mining.md`
**Depends on:** #117 (merged on `feature/perf-quality-sprint`)
**Branch:** `feature/perf-quality-sprint`

The spec is the source of truth. This plan slices it into ~10 concrete
tasks in a build-order that keeps the repo compiling at every commit.
Each task has a file, an outcome, and a verification step.

## Ordering principle

Engine first (pure algorithm, zero deps). Then unit tests to lock in
behavior. Then `apps/web/discovery/school-entity.ts` — extends types in
place, imports the engine function. Then the inngest wiring (reads the
new schema fields from #117, passes pairings through). Then the
offline validator + integration stub. Biome / typecheck at the end.

Each step compiles and tests clean before moving on. Property and
agency Stage 2 behavior is unchanged throughout.

## Tasks

### Task 1 — Engine: new `frequency-mining.ts` module (pure)

**File:** `packages/engine/src/entity/frequency-mining.ts` (new)

**Shape:**
- `export const SCHOOL_EVENT_STOPWORDS: ReadonlySet<string>` — literal stopword list
  from spec § Algorithm step 3.
- `export interface FrequencyCandidate { phrase; frequency; subjectIndices }`.
- `export interface MineOptions { minFrequency?; maxNgramTokens?; stopWords?; topK? }`.
- `export function mineFrequentPhrases(subjects, options?): FrequencyCandidate[]`.

**Algorithm steps** (spec § Algorithm, in order):
1. Cap each subject to 200 chars for ReDoS parity with sibling regexes.
2. Tokenize: split on whitespace + `: ) ( ] [ , ; ! ? " | . -` and the
   literal sequence `vs.`. Preserve token case for display.
3. Drop tokens of 1-2 chars unless all-uppercase (keeps `ZSA`, drops `of`).
4. Generate n-grams per subject for `n ∈ [2, maxNgramTokens]`.
5. Filter noise: all-stopword OR no proper-noun-like token
   (no cap-start-3+, no all-caps abbrev, no digit-run-2+).
6. Count **distinct subjects** per n-gram (not raw occurrence).
7. Maximal prune: drop n-gram G if superstring G' shares same subject count.
8. Rank `(count DESC, length DESC)`, keep `count >= minFrequency`, top-K.

**Invariants:**
- Zero I/O. No `Date.now()`, no `console.*`, no env reads.
- No runtime dependencies outside existing engine imports.
- Defaults: `minFrequency=3`, `maxNgramTokens=8`, `topK=20`,
  `stopWords=SCHOOL_EVENT_STOPWORDS`.

**Verify:** `pnpm --filter @denim/engine typecheck`.

**Commit:** `feat(engine): #102 frequency-mining module (pure algorithm)`

---

### Task 2 — Engine re-exports

**File:** `packages/engine/src/index.ts` (edit)

Add:
```ts
export {
  mineFrequentPhrases,
  SCHOOL_EVENT_STOPWORDS,
} from "./entity/frequency-mining";
export type {
  FrequencyCandidate,
  MineOptions,
} from "./entity/frequency-mining";
```

**Verify:** `pnpm --filter @denim/engine typecheck` + `pnpm -r typecheck`.

**Commit:** included with Task 1 OR separate: `chore(engine): #102 re-export frequency-mining API`

---

### Task 3 — Engine unit tests

**File:** `packages/engine/src/__tests__/frequency-mining.test.ts` (new)
(Kept in `__tests__/` at package root to match sibling test layout —
  `matching.ts` lives at `entity/matching.ts` but its tests are
  at `__tests__/entity-matching.test.ts`.)

**Cases** (spec § Testing + verification):

1. **TeamSnap soccer fixture** — 6-8 real subjects (literals, not files):
   - `"New game: ZSA U11/12 Girls Spring 2026 Competitive Rise )) vs. Rise ECNL"`
   - `"New event: Practice"`
   - `"Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Event"`
   - `"Event Reminder: Practice, March 29, 4:30 PM"`
   - plus 3-4 more real variants to cross the freq≥3 line.
   - Expected: top candidate phrase contains `"ZSA U11/12 Girls Spring 2026 Competitive Rise"`, freq ≥ 3.
2. **Small-corpus edge** — 2 subjects. Expected `[]`.
3. **All-noise** — 10 copies of `"New event: Practice"`. Expected `[]`.
4. **Multi-entity** — 20 subjects, two distinct teams. Both surface.
5. **Stopword filter** — `"New game 2026"` alone. Expected `[]`.
6. **Stopword set export** — `SCHOOL_EVENT_STOPWORDS.has("game")` is true.

**Verify:** `pnpm --filter @denim/engine test`.

**Commit:** `test(engine): #102 frequency-mining fixtures from real Girls corpus`

---

### Task 4 — School entity: SubjectInputWithSender shape

**File:** `apps/web/src/lib/discovery/school-entity.ts` (edit)

Today `school-entity.ts` imports `SubjectInput` from `property-entity.ts`.
Option (minimally invasive): extend `SubjectInput` in `property-entity.ts`
with an optional `senderEmail?: string`. Property extractor already
loops by destructuring `{ subject, frequency }` and ignores other fields —
no code change in property needed.

Edits to `property-entity.ts`: just add `senderEmail?: string` to the
existing `SubjectInput` interface. One-line diff. No behavior change
(the property extractor does not read it).

Add a type alias in `school-entity.ts`:
```ts
export type SubjectInputWithSender = SubjectInput;
// where SubjectInput now optionally carries senderEmail
```

**Verify:** `pnpm -r typecheck`.

**Commit:** included with Task 5.

---

### Task 5 — School entity: Pattern C branch + extended `SchoolCandidate`

**File:** `apps/web/src/lib/discovery/school-entity.ts` (edit)

Type changes:
```ts
export interface SchoolCandidate {
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  pattern: "A" | "B" | "C";
  sourcedFromWho?: string;  // paired-WHO attribution when Pattern C came from narrow-view
  relatedWhat?: string;
}

export function extractSchoolCandidates(
  subjects: SubjectInputWithSender[],
  options?: {
    pairedWhoAddresses?: Array<{
      senderEmail: string;
      pairedWhat: string;
      pairedWho: string;
    }>;
  },
): SchoolCandidate[];
```

Flow:
1. Run existing Pattern A + Pattern B over all subjects unchanged.
2. Build Pattern-C candidates:
   - **Full-view** — always. Call `mineFrequentPhrases(subjects.map(s => ({subject: s.subject, frequency: s.frequency})))` → map each `FrequencyCandidate` to `SchoolCandidate { pattern: "C", key: normalizeKey(phrase), displayString: phrase, frequency: freq, autoFixed: false }`.
   - **Narrow-view per paired WHO** — only when `options?.pairedWhoAddresses` non-empty. For each `{senderEmail, pairedWhat, pairedWho}`: filter subjects to those whose `senderEmail` matches (case-insensitive), run the miner, tag results with `sourcedFromWho: pairedWho`, `relatedWhat: pairedWhat`.
3. Merge narrow-view ∪ full-view Pattern C: if same normalized key appears in both, prefer the narrow-view entry (it carries tags); sum frequencies (actually: take max to avoid double-count — narrow is a subset of full).
   - Simpler: dedup Pattern C entries by key, and if a narrow-view version exists pick it (drops the untagged full-view dup).
4. Levenshtein dedup within Pattern C (same call as A/B).
5. Final cross-pattern merge: collect per-pattern deduped outputs, then apply a single pass over the combined list. If the same normalized `key` appears under multiple patterns, **keep the one with the earliest pattern letter** (A > B > C). Merge frequency counts (sum? or max?) — spec says "keep one entry"; use **max** to preserve the distinct-subject semantic of Pattern C and the per-match counts of A/B without double-counting.
6. Sort by frequency desc, slice `topNEntities`.

**Verify:** `pnpm --filter web typecheck`.

**Commit:** `feat(discovery): #102 Pattern C corpus mining in school-entity`

---

### Task 6 — School entity tests

**File:** `apps/web/src/lib/discovery/__tests__/school-entity.test.ts` (edit)

Add cases:
- TeamSnap corpus → candidate with `pattern: "C"` appears.
- Paired WHO option threads `sourcedFromWho` + `relatedWhat` onto the candidate.
- Unpaired (no options) → Pattern C candidates present but no tags.
- Cross-pattern collision: a subject that yields Pattern A AND Pattern C on the same phrase (e.g. "St Agnes" repeated 5 times) → single candidate with `pattern: "A"`.

**Verify:** `pnpm --filter web test src/lib/discovery/__tests__/school-entity.test.ts`.

**Commit:** `test(discovery): #102 Pattern C + paired-WHO cases for school-entity`

---

### Task 7 — Inngest wiring: thread `senderEmail` + paired addresses

**File:** `apps/web/src/lib/discovery/entity-discovery.ts` (edit)
**File:** `apps/web/src/lib/inngest/entity-discovery-fn.ts` (edit)

`fetchSubjectsAndDisplayNames` already reads the `From` header. Also
extract the bare email address and return it alongside each subject so
the school branch can pass it to the extractor.

Surgical diff in `entity-discovery.ts`:
- Internal return shape becomes `{ subjects: Array<{subject: string; senderEmail: string}>; displayNames: string[]; errorCount: number }`.
- School branch maps those into `SubjectInputWithSender`.
- Property / agency branches remain unchanged (property ignores `senderEmail` silently; agency reads display names only).
- Accept a new optional param `pairedWhoAddresses?: Array<{senderEmail; pairedWhat; pairedWho}>` on `DiscoverEntitiesInput`. Pass through to `extractSchoolCandidates` only when `stage2Algorithm === "school-two-pattern"`.
- Propagate `sourcedFromWho` + `relatedWhat` into each school candidate's `meta` payload so the writer persists them in `inputs.stage2.candidates[].meta` alongside the existing `{pattern}` payload. (Already plumbed — `meta` is `Record<string, unknown>`.)

In `entity-discovery-fn.ts`:
- After `schema` load, read `schema.inputs` (JSONB) to get `groups: EntityGroupInput[]`.
- Read `stage1UserContacts` (already selected).
- Resolve paired-WHO-to-senderEmail by matching WHO `query` → `senderEmail` in `stage1UserContacts`.
- Build `pairedWhoAddresses` list: one entry per `(what, who)` pair where the who resolved.
- Pass into each `step.run("discover-…")`'s `discoverEntitiesForDomain` call.

No new Gmail calls, no schema migration, no DB field changes.

**Verify:** `pnpm --filter web typecheck`.

**Commit:** `feat(inngest): #102 thread senderEmail + paired WHOs into Stage 2`

---

### Task 8 — Offline validator extension

**File:** `scripts/validate-stage1-real-samples.ts` (edit — add extra
Stage 2 expectation block for the TeamSnap corpus using Pattern C),
OR create sibling `scripts/validate-stage2-real-samples.ts` with a
focused Pattern-C harness.

Chosen approach: **extend** the existing script. Update the
`STAGE2_EXPECTED` `school_parent × email.teamsnap.com` entry so its
`algorithmHint` notes that Pattern C should now surface the team; keep
the existing `minFrequency: 5` / `displayMatch: /ZSA.*U11.*Girls/` check.
It was scaffolded to fail before #102 — now it should pass.

If the samples dir is absent (CI), script exits early with a noted
"skipped — samples unavailable" line; otherwise runs as today.

**Verify:** `cd apps/web && npx tsx ../../scripts/validate-stage1-real-samples.ts`
(samples present — 417 json files confirmed in the workspace).

**Commit:** `test(validator): #102 flip TeamSnap expectation to pass with Pattern C`

---

### Task 9 — Integration test stub

**File:** `apps/web/tests/integration/stage2-with-pattern-c.test.ts` (new)

Matches #117 pattern. `describe.skip` stub. One `it("…", () => {})`
placeholder. Top comment explains it unlocks when a mocked-Gmail
integration runner exists.

**Verify:** `pnpm --filter web test` picks up the file without running skipped bodies.

**Commit:** `test(integration): #102 stub Stage 2 Pattern C integration test`

---

### Task 10 — Full-repo verification

Run in order:
1. `pnpm typecheck` — clean across workspaces.
2. `pnpm -r test` — all tests pass; counts recorded.
3. `pnpm biome check` — clean (use `--apply` for formatting only).
4. Validator script run against real samples.

If any check fails, fix and commit, do not skip. No new commit if
everything passes.

---

## Risks + mitigations

- **N-gram explosion on long subjects.** Mitigated by 200-char cap
  (same as A/B) and `maxNgramTokens=8`.
- **Full-view and narrow-view both surface same phrase.** Handled by
  Pattern-C-internal dedup before cross-pattern merge.
- **Property extractor accidentally consumes `senderEmail`.** It only
  destructures `{subject, frequency}`. Adding an optional field to
  `SubjectInput` is a non-breaking extension.
- **Cross-pattern dedup collides `ZSA U11/12 Girls Spring 2026
  Competitive Rise` (C) with a short Pattern B like `ZSA Soccer`.**
  `normalizeKey` normalizes casing/punctuation but not content — these
  would produce different keys; no false collision. Levenshtein dedup
  within patterns would not cross the threshold either.
- **Samples dir missing on CI.** Validator exits 0 with a "skipped"
  diagnostic; script is intentionally cwd-sensitive (already is today).

## Out of scope (explicitly, per spec)

- Relevance gate (#118).
- Agency Stage 2 changes.
- Replacing Pattern B with the miner (#120 future eval).
- Hypothesis prompt changes.
- UI changes beyond what already flows through the `meta` payload.
