# Pattern C — corpus frequency mining for Stage 2 entity extraction (#102)

**Date:** 2026-04-19
**Issue:** [#102](https://github.com/nickdicarlo-max/denim-email/issues/102)
**Status:** Design approved, pending implementation plan
**Depends on:** [#117](https://github.com/nickdicarlo-max/denim-email/issues/117) (pairing infrastructure — merged on `feature/perf-quality-sprint`)

## Problem

Stage 2 school_parent entity extraction (`apps/web/src/lib/discovery/school-entity.ts`) runs two deterministic regex patterns:

- **Pattern A** — institution names (religious-prefix branch, or `<Name> + School/Academy/Church/...` suffix branch)
- **Pattern B** — activity/team names (`<U##|CapWord> + sport_keyword`)

Both patterns require specific surface shapes. Activity-platform event notifications (TeamSnap, GameChanger, ClassDojo) violate both:

```
"New game: ZSA U11/12 Girls Spring 2026 Competitive Rise )) vs. Rise ECNL"
"New event: Practice"
"Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Event"
"Event Reminder: Practice, March 29, 4:30 PM"
```

Pattern B misses because `ZSA` is followed by `U11/12`, not a sport keyword. Pattern A misses because there's no institution suffix. Subjects like `"New event: Practice"` have no team name at all — not extractable.

**Result on the 2026-04-19 live Girls Activities run (schema `01KPM0R4QS72E8B1M0A1BDJWYC`):** 38 orphaned TeamSnap emails. Stage 2 produced one wrong PRIMARY (`"Game at Academy"`). The actual team name (`"ZSA U11/12 Girls Spring 2026 Competitive Rise"`) never surfaced.

**Rejected framing:** hand-written per-platform regexes (TeamSnap-specific Pattern C, GameChanger-specific Pattern D, etc.). Fragile, manual, every platform needs its own code change.

## Solution

**Mine the corpus statistically.** For each confirmed Stage-1 domain, collect all subjects, find n-grams that repeat across ≥N subjects, filter out event-verb/stopword-only phrases, and rank by (frequency desc, length desc). The repeating proper-noun phrase that remains is the team or class name.

Why this works on the Girls corpus:

- `"ZSA U11/12 Girls Spring 2026 Competitive Rise"` appears in 3+ subjects → survives
- `"New game"`, `"New event"`, `"Event Reminder"` → all stopwords → filtered
- `"Rise ECNL"`, `"Houston Select"` (opponents) → capitalized but each appears in only 1 subject → below threshold

Domain-agnostic: the same algorithm works for any activity platform, class newsletter, or school announcement feed where the entity name repeats.

**Scope:** added as complementary Pattern C alongside the existing A and B. A and B stay for small-corpus cases where statistical signal is weak (n-gram mining needs ≥3 subjects).

## Algorithm

Pure, deterministic, no I/O. Lives in `packages/engine/src/entity/frequency-mining.ts`.

**Steps:**

1. **Tokenize** each subject. Word-level tokens preserving original case for display. Split on whitespace plus the punctuation set `: ) ( ] [ , ; ! ? " ` and the literal `vs.` separator. Keep alphanumeric inner punctuation (`U11/12`, `2026`, `ZSA`). Drop tokens of 1-2 characters unless all-caps (keeps `ZSA`, drops `of`, `on`, `re`).
2. **Generate n-grams** per subject for `n` in `[2, 8]`. Upper bound 8 captures multi-token team names without exploding the search space.
3. **Filter noise n-grams.** An n-gram is noise if:
   - Every token (lowercased) is in the stopword set: `new, game, practice, event, reminder, updated, cancelled, vs, rsvp, reply, fwd, re, for, the, and, or, a, an, to, from, at, on, in, of`
   - OR contains no proper-noun-like token (no capitalized word of 3+ chars, no all-caps abbreviation, no digit-sequence of length ≥2)

   Stopword matching is case-insensitive; token display retains original case.
4. **Count frequencies.** For each surviving n-gram, count distinct subjects it appeared in (not raw occurrences).
5. **Prune to maximal.** If n-gram `G` has the same subject count as a superstring `G'`, drop `G`. Keeps the longest/most-specific form.
6. **Rank + threshold.** Keep n-grams with count ≥ `minFrequency` (default 3). Sort by `(count DESC, length DESC)`. Return top-K (default 20).

**Why `minFrequency = 3`:** Below this threshold, n-gram signal is too noisy. At or above, Pattern C reliably surfaces real entities on the Girls corpus. Configurable via `MineOptions` for testing and tuning.

**Stopword list rationale:** These words are *activity signals* (great for knowing an email is relevant — Stage 1 keyword filter uses them) but they are not *entity candidates*. Including `game` as an entity would produce the wrong PRIMARY. Event-verb words end up in case titles downstream ("ZSA vs. Rise ECNL — game"), which is the case synthesis layer's job.

## Output shape + types

```ts
// packages/engine/src/entity/frequency-mining.ts

export interface FrequencyCandidate {
  phrase: string;
  frequency: number;          // distinct-subject count
  subjectIndices: number[];   // which input subjects matched (for downstream tagging)
}

export interface MineOptions {
  minFrequency?: number;      // default 3
  maxNgramTokens?: number;    // default 8
  stopWords?: ReadonlySet<string>;   // defaults to SCHOOL_EVENT_STOPWORDS
  topK?: number;              // default 20
}

export function mineFrequentPhrases(
  subjects: ReadonlyArray<{ subject: string; frequency?: number }>,
  options?: MineOptions,
): FrequencyCandidate[];

export const SCHOOL_EVENT_STOPWORDS: ReadonlySet<string>;
```

## Integration into `school-entity.ts`

`extractSchoolCandidates` stays the Stage 2 school entry point. Adds Pattern C as a third phase alongside A and B, then merges results through the existing Levenshtein dedup.

```ts
export interface SchoolCandidate {
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  pattern: "A" | "B" | "C";   // "C" is corpus-mined
  // NEW for Pattern C + #117 pairing:
  sourcedFromWho?: string;    // e.g. "Ziad Allan"
  relatedWhat?: string;       // e.g. "soccer"
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

`SubjectInput` extends to `SubjectInputWithSender` carrying an optional `senderEmail`. Small internal-to-`apps/web` breaking change — call sites in `entity-discovery-fn.ts` and the property extractor updated to pass the field (property extractor ignores it).

**Dedup across patterns.** The existing per-pattern Levenshtein dedup stays; a final merge pass runs after all three. If the same normalized key is produced by multiple patterns (e.g., Pattern A and Pattern C both surface `"St Agnes"` because the institution repeats in subjects often enough to also pass the frequency threshold), keep one entry. Pattern preference in a collision: `A > B > C`. The deterministic pattern label wins because Pattern A/B are more precise signals when they fire; Pattern C only "owns" a candidate when neither A nor B extracted it.

## WHO-paired corpus scoping (#117 integration)

No extra Gmail calls. Uses subjects already fetched by Stage 2.

**Flow:**

1. `entity-discovery-fn.ts` reads `schema.inputs.groups` and `stage1UserContacts` (both present post-#117)
2. Resolves each paired WHO to their `senderEmail` from `stage1UserContacts.senderEmail`
3. Passes `pairedWhoAddresses` into `extractSchoolCandidates`
4. Inside the extractor, Pattern C runs twice when pairings exist:
   - **Full-view** — all confirmed-domain subjects, no sender filter
   - **Narrow-view per paired WHO** — subjects where `senderEmail` matches the paired address
5. Narrow-view candidates get tagged with `sourcedFromWho` and `relatedWhat`
6. Merge results; dedup preserves the paired tagging when a candidate appears in both views

**Girls Activities trace:**

1. User pairs `soccer → Ziad Allan` at Q1 (from #117)
2. Stage 1 confirms `email.teamsnap.com`; `stage1UserContacts` has `Ziad Allan → donotreply@email.teamsnap.com`
3. Stage 2 queries `from:*@email.teamsnap.com` → ~50 subjects, all with `senderEmail: donotreply@email.teamsnap.com`
4. Full-view and narrow-view are the same corpus (only one sender)
5. Pattern C extracts `"ZSA U11/12 Girls Spring 2026 Competitive Rise"` with `sourcedFromWho: "Ziad Allan"`, `relatedWhat: "soccer"`

**Multi-team trace (hypothetical):**

1. Two kids on TeamSnap, user pairs `soccer → Ziad Allan` AND `lacrosse → Coach Martinez`
2. Stage 2 corpus has 80 subjects across both teams
3. Narrow-view by Ziad (50 subjects) → `"ZSA U11/12 Girls..."` with `relatedWhat: soccer`
4. Narrow-view by Martinez (30 subjects) → `"Gray Wolves Lacrosse..."` with `relatedWhat: lacrosse`
5. Full-view Pattern C may duplicate one of the above; dedup merges

**Unpaired fallback (all property schemas, school_parent users who skipped pairing):**

- `options.pairedWhoAddresses` empty or absent
- Only full-view Pattern C runs
- No `sourcedFromWho` / `relatedWhat` tagging
- Zero regression from existing behavior

**Downstream use of `relatedWhat`:**

Not required by this ticket. The field lands in the Stage 2 confirmation payload; the UI ignores it for now. #66 (relatedUserThing persistence) can consume it later to group candidates under user topics.

## Package location + boundaries

**New file** — `packages/engine/src/entity/frequency-mining.ts`. Pure algorithm.

**Edited** — `apps/web/src/lib/discovery/school-entity.ts`. Imports `mineFrequentPhrases`, adds Pattern C branch, extends `SchoolCandidate`.

**Edited** — `apps/web/src/lib/inngest/entity-discovery-fn.ts`. Reads `groups` + `stage1UserContacts`, resolves paired addresses, passes into extractor.

**Boundary checks:**

- `packages/engine` stays I/O-free — frequency-mining is pure text analysis
- `packages/ai` untouched
- `packages/types` untouched (tag fields live on the in-memory `SchoolCandidate`, not persisted)
- No DB migration
- No new external deps (n-gram counting is ~30 lines of plain TS)

**Why engine, not discovery?** `@denim/engine` already houses other pure text utilities (`jaroWinkler`, `fuzzyMatch` in `matching.ts`). Putting the algorithm there means property and agency extractors can call it later without going through a school-specific file.

## Testing + verification

### Engine unit tests — `packages/engine/src/entity/__tests__/frequency-mining.test.ts`

`@denim/engine` is zero-I/O, so tests embed real subjects copy-pasted from the 433-email real-sample corpus as literal fixtures. Same strings, just hard-coded — exercises the algorithm against production signal without file I/O.

Fixture cases:

- **TeamSnap soccer** — 6-8 real subjects including `"New game: ZSA U11/12 Girls Spring 2026 Competitive Rise )) vs. Rise ECNL"`, `"New event: Practice"`, `"Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Event"`. Expected top candidate: `"ZSA U11/12 Girls Spring 2026 Competitive Rise"` with frequency ≥ 3.
- **Small-corpus edge** — 2 subjects only. Expected: empty output (below `minFrequency`).
- **All-noise** — 10 copies of `"New event: Practice"`. Expected: empty output (no proper-noun residue).
- **Multi-entity** — 20 subjects spanning two distinct team names. Expected: both surface, ranked.
- **Stopword filter** — subject `"New game 2026"` alone. Expected: no candidate (stopwords + year only, no proper noun).

### Validator script extension — `apps/web/scripts/validate-stage1-real-samples.ts`

Extend (or add sibling `validate-stage2-real-samples.ts`) to run `extractSchoolCandidates` with Pattern C over the full 433-email gitignored real-sample corpus. Matches the pattern memory `reference_stage_validator.md` describes for Stage 1.

Acceptance on the real corpus:

- `"ZSA U11/12 Girls Spring 2026 Competitive Rise"` (or a Levenshtein-neighbor variant) surfaces with frequency ≥ 3
- No regression on the existing 3/3 + 7/8 ground-truth cases — Patterns A and B still fire for non-TeamSnap school entities
- Manual eyeball on the full top-20: Pattern C doesn't introduce noise entities

### Integration test stub — `apps/web/tests/integration/stage2-with-pattern-c.test.ts`

`describe.skip`-stubbed, matching the #117 pattern. Wired up when we have a mocked-Gmail integration runner that can feed pre-canned subject lists to the Stage 2 pipeline without hitting live Gmail.

### Live E2E

Re-run the Girls Activities schema from 2026-04-19 afternoon, this time with #117 pairing in place plus #102 landed:

- `ZSA U11/12 Girls Spring 2026 Competitive Rise` (or a close Levenshtein variant) appears as a PRIMARY at Stage 2 confirmation
- Tagged with `sourcedFromWho: "Ziad Allan"`, `relatedWhat: "soccer"`
- `"Game at Academy"` no longer dominates
- Property regression check: same Property Management inputs produce identical output to the 2026-04-19 afternoon run (unpaired → Pattern C runs in full-view only, output overlaps A/B enough to dedup cleanly, no new PRIMARIES)

## Honest caveat — this ticket's ceiling

#102 fixes Stage 2 entity extraction for activity-platform subjects. It does not fix:

- **#118 relevance gate over-exclusion** — 79% of school_parent emails were excluded on the 2026-04-19 run. Until #118 lands, even with the right team name confirmed at Stage 2, the final case will still be under-populated.
- **Case fragmentation inside a single entity** — #86 territory, separate ticket.

Expect the full Girls Activities win to compound across #117 + #102 + #118. This ticket delivers the Stage 2 piece: the correct team name surfaces, is confirmable by the user, and downstream clustering has a non-trivial entity to work with.

## Future evaluation captured

[#120](https://github.com/nickdicarlo-max/denim-email/issues/120) — when we next revisit hypothesis generation, compare Pattern A/B/C precision and recall side-by-side on the real corpus. Deferred until after immediate pipeline fixes land.

## Out of scope

- Hand-written per-platform regexes (explicitly rejected in design)
- Replacing Pattern B with the frequency miner — kept separate per "option (b)" chosen at design time
- Downstream use of `relatedWhat` — #66 territory
- Property or agency Stage 2 extractor changes — they have strong deterministic signals; Pattern C is scoped to school_parent for this ticket
- Relevance gate fixes — #118
