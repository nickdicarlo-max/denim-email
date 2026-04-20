# Stage 1 per-whats pairing + safety hygiene (#117)

**Date:** 2026-04-19
**Issue:** [#117](https://github.com/nickdicarlo-max/denim-email/issues/117)
**Status:** Design approved, pending implementation plan

## Problem

Stage 1's per-whats lookup (`discoverUserNamedThings`) runs a Gmail full-text search for each topic the user entered — e.g. `"soccer" -category:promotions newer_than:56d` — and picks the most-common sender domain as the `topDomain`. On the 2026-04-19 live Girls Activities run (schema `01KPM0R4QS72E8B1M0A1BDJWYC`), this returned:

| whats | topDomain | reality |
|---|---|---|
| soccer | `bucknell.edu` (10 matches) | should be `email.teamsnap.com` |
| dance  | `news.bloomberg.com` (3 matches, Matt Levine) | noise |
| guitar, lanier, st agnes | null (0) | — |

Downstream, those noise domains were pre-checked into `stage2ConfirmedDomains`, Stage 2 ran over newsletter content, and the run produced a single case with 4 emails while 38 real ZSA TeamSnap emails ended up orphaned.

**Two root causes stacked:**

1. **Low precision on generic terms** — `"soccer"` matches Bucknell alumni newsletters that talk about university athletics.
2. **Low recall on activity platforms** — TeamSnap subjects like `"New game: ZSA U11/12 Girls Spring 2026 Competitive Rise"` don't contain the word "soccer", so the real target is invisible to the query.

Neither can be solved by smarter full-text querying alone. The user knows "Ziad Allan = soccer" — a mapping the system can't infer but the data model already had a place for (`EntityGroupInput` in `packages/types/src/schema.ts:6`). The onboarding UI never collected the pairing and the discovery code never consumed it.

## Solution

Start using `InterviewInput.groups` the way its type comment said it was meant to be used:

```ts
export interface EntityGroupInput {
  whats: string[]; // PRIMARY entity names in this sub-group
  whos: string[]; // SECONDARY entity names in this sub-group
}

export interface InterviewInput {
  ...
  whats: string[]; // Flattened from groups (backward compat)
  whos: string[]; // Flattened from groups (backward compat)
  groups: EntityGroupInput[]; // The paired structure — source of truth
}
```

Pairing is **optional** and the UI must make this obvious. Users whose WHOs are cross-cutting (property manager's Timothy Bishop across 11 addresses) leave pairings blank; those schemas run exactly as today. Users who can pair (parent's Ziad Allan = soccer) get a far stronger signal because `from:"Ziad Allan"` matches the display name on TeamSnap notifications — where `"soccer"` full-text does not.

## Data shape

No migration. `InterviewInput.groups: EntityGroupInput[]` already exists; the `inputs` JSONB column on `CaseSchema` accepts anything. We start populating `groups` from the onboarding UI and reading it in Stage 1 discovery.

### Examples

**Paired (Girls Activities):**
```json
{
  "whats": ["soccer", "guitar", "dance", "st agnes"],
  "whos":  ["Ziad Allan"],
  "groups": [
    { "whats": ["soccer"], "whos": ["Ziad Allan"] }
  ]
}
```

**Mixed (some paired, some cross-cutting):**
```json
{
  "whats": ["soccer", "dance", "st agnes"],
  "whos":  ["Ziad Allan", "Mrs. Chen", "Principal Smith"],
  "groups": [
    { "whats": ["soccer"], "whos": ["Ziad Allan"] },
    { "whats": ["dance"],  "whos": ["Mrs. Chen"]  }
  ]
}
```
`Principal Smith` is unpaired → stays in `whos[]`, no group entry, treated as cross-topic.

**All unpaired (Property Management — the default case):**
```json
{
  "whats": [11 addresses],
  "whos":  ["Timothy Bishop", "Krystin Jernigan", "Vivek Gupta"],
  "groups": []
}
```

### Invariants

- Every WHO in a group is also in the flat `whos[]`
- Every WHAT in a group is also in the flat `whats[]`
- The UI may write both representations or only the flat lists
- Downstream code prefers `groups` when present, falls back to the flat lists otherwise

## UI collection

The change is inline in the existing Q1 screen (`src/app/onboarding/names/page.tsx`) — no new screen, no new step.

After a user has ≥1 WHAT and adds a WHO, each WHO row expands with the WHATs shown as toggleable pill chips:

```
Who emails you about these?
Optional. Just a few names to help us find the rest.
If a person focuses on one topic, tap it below. If they help with several, leave blank.

[ Ziad Allan ]  [x]
  focuses on:  ( soccer ✓ ) ( guitar ) ( dance ) ( st agnes )

[ Mrs. Chen ]  [x]
  focuses on:  ( soccer ) ( guitar ) ( dance ✓ ) ( st agnes )

[ Principal Smith ]  [x]
  focuses on:  ( soccer ) ( guitar ) ( dance ) ( st agnes )    -- none = cross-topic
```

**Copy:**
- Section intro adds one line: *"If a person focuses on one topic, tap it below. If they help with several, leave blank."*
- Each WHO row shows *"focuses on:"* as a quiet label
- Pairing is purely opt-in: no asterisk, no required flag, no warning on continue

**Visual:**
- Selected WHAT chips reuse the same `bg-accent-soft` accent color as WHAT chips above, so paired = same color cues unity
- Unselected chips use the muted neutral used elsewhere
- Property case (11 WHATs, 3 cross-cutting WHOs) intentionally looks busy — the user skips the pairing pills and continues, matching their mental model

**State:**
- Local component state adds `Map<who, Set<what>>` alongside existing `whos[]`
- On Continue, derive `groups: EntityGroupInput[]`: one group per paired WHO; unpaired WHOs contribute nothing to `groups` but stay in `whos[]`
- `onboardingStorage.setNames({ whats, whos, groups, name? })` — accepts optional `groups`; older saved sessions without `groups` still load

**Edge cases:**
- Remove a WHAT → remove it from any WHO's pairing map
- Remove a WHO → drop their pairing entry
- Rename — not supported today, out of scope

## Discovery semantics

Query plan stays simple — same Gmail calls as today, run in parallel. Pairing changes *attribution at aggregation time*, not what queries we send.

### Per-WHAT attribution

1. If the WHAT appears in any group:
   - Collect all WHOs paired with this WHAT across all groups
   - Pick the single WHO with the highest `matchCount` from `discoverUserNamedContacts`
   - Use that WHO's result as the attributed source:
     - `topDomain` for the WHAT = `senderDomain` from the chosen WHO
     - `matchCount` for the WHAT = that WHO's `matchCount`
     - Tag the result with `sourcedFromWho: "<name>"` so UI can show provenance
   - If every paired WHO returned 0 matches, **fall back to the full-text `"<what>"` result** (don't leave the WHAT empty). `sourcedFromWho` is then absent.
2. If the WHAT is unpaired:
   - Keep today's full-text `"<what>" -category:promotions newer_than:56d` behavior
   - Apply a small safety filter on the resulting `topDomain` (see below)

### Per-WHO attribution

- Paired or not, the `from:"<name>"` query runs as today
- Unpaired WHO → topic-agnostic SECONDARY (current behavior, unchanged)
- Paired WHO → same plus their result becomes the driver for paired WHATs' topDomain

### Safety filter on unpaired WHAT topDomain

Small hygiene on the residual full-text path, since paired WHATs no longer run through it:

- Drop subdomains starting with `news.`, `alerts.`, `t.` — almost always marketing
- Drop `.edu` domains unless the user's own domain is also `.edu` (extends the existing `userDomain` filter)
- **Don't filter** `email.` or `mail.` subdomains — activity platforms like `email.teamsnap.com` use them

Implementation: extend `aggregateThingResult` in `user-hints-discovery.ts` with a filter pass between the domain-counts map and `topDomain` selection.

### Type addition

`UserThingResult` gets one optional field:

```ts
interface UserThingResult {
  query: string;
  matchCount: number;
  topDomain: string | null;
  topSenders: ReadonlyArray<string>;
  errorCount: number;
  // NEW:
  sourcedFromWho?: string;  // name of paired WHO when attribution came from a pairing
}
```

No new DB columns — `stage1UserThings` already stores this as JSONB.

### UI knock-on

The domain-confirmation row for a paired WHAT changes copy from:

> `soccer — 10 emails from bucknell.edu`

to:

> `soccer — 12 emails from email.teamsnap.com (via Ziad Allan)`

`phase-domain-confirmation.tsx:273` updates to conditionally append `(via <name>)` when `thing.sourcedFromWho` is present.

### Backward compatibility

- Schemas with `groups: []` run exactly as today — zero behavior change
- New schemas that populate `groups` get the new attribution path
- Safety filter applies to all schemas going forward, but only suppresses obvious noise like `news.bloomberg.com` and alumni `.edu` domains

## Downstream touchpoints

Four small wiring changes to make pairing flow end-to-end:

### 1. `POST /api/onboarding/start` Zod schema

Accept optional `groups`. Old payloads still validate:

```ts
groups: z.array(
  z.object({
    whats: z.array(z.string().min(1)).min(1),
    whos:  z.array(z.string().min(1)).min(1),
  })
).optional()
```

### 2. `inputs` JSONB on `CaseSchema`

No schema migration. Start writing `groups` alongside `whats` / `whos`.

### 3. `discoverUserNamedThings` signature

Current:
```ts
discoverUserNamedThings(client, whats, userDomain)
```

New:
```ts
discoverUserNamedThings(
  client,
  whats,
  userDomain,
  options?: {
    whoResults: UserContactResult[];   // from discoverUserNamedContacts
    groups: EntityGroupInput[];
  }
)
```

When `options.groups` is non-empty, cross-reference each WHAT against the groups. For paired WHATs, attribute from the matching WHO's result (from `options.whoResults`). The per-WHAT Gmail query still runs for the 0-match fallback case. Safety filter applies only to the full-text fallback output.

Call site in `src/lib/inngest/domain-discovery-fn.ts:75-83` — the `Promise.all([discoverDomains, discoverUserNamedThings, discoverUserNamedContacts])` becomes sequentially-aware: `discoverUserNamedContacts` first, then pass its results into `discoverUserNamedThings`. Small wall-clock cost (two phases instead of one parallel burst) but only if there are any WHOs — negligible in practice.

### 4. Hypothesis prompt

`packages/ai/src/prompts/interview-hypothesis.ts` already accepts `entityGroups` as an optional parameter. `buildValidationPrompt` in `validate.ts` already consumes it. Currently we pass an empty array. Wire through from `runDomainDiscovery` → `generateHypothesis` so Claude sees the pairing too.

### No changes to

- Stage 2 extraction logic (#102 territory)
- Relevance gate (#118 territory)
- Clustering, synthesis, cluster writer

## Verification

### Unit tests

`src/lib/discovery/__tests__/user-hints-discovery.test.ts` — new cases:
- Paired WHAT gets `topDomain` from the matching WHO's result
- Paired WHAT with 0-match WHO falls back to full-text
- `sourcedFromWho` populated on paired attribution, absent on full-text path
- Safety filter drops `news.*`, `alerts.*`, `t.*`, non-user `.edu`
- Safety filter keeps `email.*`, `mail.*`
- Backward-compat: empty groups → identical to today's output

### Integration test

`apps/web/tests/integration/onboarding/stage1-with-groups.test.ts` (new) — full Stage 1 run with groups populated against a mocked Gmail client. Asserts `stage1UserThings.soccer.topDomain === "email.teamsnap.com"` and `sourcedFromWho === "Ziad Allan"`.

### Live E2E

Re-run Girls Activities on the same Gmail account with pairing:

- Input: `whats: ["soccer", "guitar", "dance", "st agnes"]`, `whos: ["Ziad Allan"]`, `groups: [{whats: ["soccer"], whos: ["Ziad Allan"]}]`
- Expected `stage1UserThings.soccer.topDomain === "email.teamsnap.com"` (not `bucknell.edu`)
- Expected `stage2ConfirmedDomains` excludes `bucknell.edu` and `news.bloomberg.com`
- Expected `stage1UserThings.soccer.sourcedFromWho === "Ziad Allan"`

### Property regression

Re-run Property Management with the same inputs as the 2026-04-19 afternoon run (all unpaired). Expected: `stage1UserThings` and case count identical to that run. Zero regression.

## Honest caveat — this ticket's ceiling

#117 fixes the domain-confirmation step, not the downstream case output. The Girls run's real failures stack:

| Failure | Ticket | Status after #117 alone |
|---|---|---|
| `bucknell.edu` + `news.bloomberg.com` wrongly confirmed | **#117** | **Fixed** |
| Stage 2 only extracted "Game at Academy" (TeamSnap subjects don't match regex) | #102 | Still broken |
| Relevance gate excluded 79% of emails | #118 | Still broken |
| Only 4 emails in the case instead of 50+ | #102 + #118 | Still broken |

Expect final case quality for Girls Activities to remain suppressed until #102 and #118 compound on top of this fix. This is deliberate sequencing: #117 is upstream, solves it first, then #102 (Stage 2 regex) and #118 (gate) can unlock the rest of the pipeline.

The pairing mechanism also improves agency-domain runs (Portfolio Pro Advisors, Stallion) the same way: a paired contact's `from:` result gives a deterministic domain where `"PPA"` full-text would pick newsletter noise.

## Out of scope

- Stage 1 keyword-aggregator hygiene (#100) — different code path; separate ticket broadened post-test
- Stage 2 school-domain TeamSnap extraction (#102) — follow-up
- Relevance-gate over-exclusion (#118) — follow-up
- Case fragmentation under single entities (#86) — clustering layer, not Stage 1
