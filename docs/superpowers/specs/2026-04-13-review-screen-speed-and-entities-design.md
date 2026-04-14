# Review Screen: Speed + Entity Grouping

**Date:** 2026-04-13
**Branch:** feature/ux-overhaul
**Problem:** Review screen takes 73s to appear (target: <30s) and hides all SECONDARY discovered entities, which are the most actionable review data.

## Success Criteria

1. Review screen appears in <45s from connect page POST (stretch: <30s)
2. Discovered SECONDARY entities appear grouped under their related user topic
3. Entities with no clear topic association appear in a flat "Discoveries" section
4. No regressions: confirm flow still creates correct Entity/EntityGroup/SchemaTag rows

## Part 1: Two-Pass Scan — Open Pass 1 (Pre-Confirm), Targeted Pass 2 (Post-Confirm)

**What:** Pass 1 runs pre-confirm with a small, time-bounded random sample to generate the review screen fast. Pass 2 runs post-confirm and reads ONLY emails related to confirmed entities and their domains — never random inbox emails.

### Pass 1: Pre-confirm (blocks review screen, must be fast)

- `gmail.sampleScan(100)` — 100 random emails (was 200)
- **Constrained to last 8 weeks** (`newer_than:56d`) — currently scans entire inbox history
- Intentionally broad and random — purpose is to discover entities the user didn't think to mention
- One Claude validation call on the 100 samples
- Writes hypothesis + validation to schema, advances to AWAITING_REVIEW

### Pass 2: Post-confirm (Function B, user isn't on a spinner)

- User has toggled entities ON/OFF — we now know which are worth expanding
- Load confirmed entities only (isActive=true) from the DB
- For each confirmed entity's alias emails, build expansion targets using the rule:
  - **Corporate/org domain** (e.g., `@email.teamsnap.com`, `@stagnes.com`): expand by **domain** — `from:email.teamsnap.com newer_than:56d`
  - **Generic provider** (e.g., `@gmail.com`, `@yahoo.com`, `@outlook.com`, etc. — see `GENERIC_SENDER_DOMAINS` list): expand by **full sender address** — `from:ziad.allan@gmail.com newer_than:56d`
  - This prevents `from:gmail.com` from pulling every personal email in the inbox
- Run Gmail search for each target, up to 200 emails per target
- Run `validateHypothesis` on those targeted samples (NOT a random inbox scan)
- Write any new discovered entities as Entity rows
- Cap: up to 5 targets × 200 emails = 1000 emails max reaching Gemini (was 5 × 50 = 250)

**Why the cost math works:** Pass 2 emails are now pre-filtered by domain of a user-confirmed entity. Every email Gemini sees has a high prior probability of being relevant, so we can read deeper (200 per domain) without burning tokens on random inbox noise. Pass 1 stays small (100) precisely because it IS random.

**Why this is an improvement over the current design:** Currently Pass 2 expands domains for ALL discovered entities regardless of user intent, then blocks the review screen on that work. The new design expands only confirmed domains, and does so when the user isn't waiting.

### Files

- `apps/web/src/lib/inngest/onboarding.ts` (Function A) — remove Pass 2 loop from validate-hypothesis step; change `sampleScan(200)` to use new config values; add `newer_than:56d` constraint to Pass 1
- `apps/web/src/lib/inngest/onboarding.ts` (Function B) — add new `expand-confirmed-domains` step between confirm and `scan.requested` emission
- `apps/web/src/lib/gmail/client.ts` — extend `sampleScan` to accept an optional `newerThan` parameter (e.g., "56d") that gets appended to the Gmail query
- `apps/web/src/lib/services/interview.ts` — keep `resolveWhoEmails`; replace `extractTrustedDomains` (returns `string[]` of domains) with a new `extractExpansionTargets` that returns `Array<{type: "domain" | "sender", value: string}>` — domain for corporate senders, full sender address for generic-provider senders
- **NEW:** `apps/web/src/lib/config/onboarding-tunables.ts` — centralized config for all onboarding tunables (see Part 5)

## Part 5: Centralized Onboarding Tunables

**What:** Currently onboarding tunables are hardcoded in multiple places (module-level constants in `onboarding.ts`, inline magic numbers in function calls, hardcoded `56d` in `discovery.ts`). Centralize them in one config file so they're easy to tune during testing.

**New file:** `apps/web/src/lib/config/onboarding-tunables.ts`

```typescript
export const ONBOARDING_TUNABLES = {
  // Pass 1: broad random sample before review screen
  pass1: {
    sampleSize: 100,       // was sampleScan(200)
    lookback: "56d",       // 8 weeks; was unbounded
  },
  // Pass 2: targeted domain expansion after user confirms
  pass2: {
    maxDomainsToExpand: 5,           // was MAX_DOMAINS_TO_EXPAND
    emailsPerDomain: 200,            // was DOMAIN_EXPANSION_CAP = 50
    lookback: "56d",                 // 8 weeks
  },
  // Discovery (full scan, already exists in discovery.ts)
  discovery: {
    lookback: "56d",                 // was DISCOVERY_LOOKBACK
    maxTotalEmails: 200,             // was DISCOVERY_MAX_EMAILS
  },
} as const;
```

**Files that import this:**
- `apps/web/src/lib/inngest/onboarding.ts` (Functions A and B)
- `apps/web/src/lib/services/discovery.ts` (replace `DISCOVERY_LOOKBACK` and cap constants)

**Expected timing for review screen:** ~25-35s (hypothesis 10-15s + Pass 1 validation ~15s with 100 emails + Inngest overhead ~3s).

## Part 2: Add `relatedUserThing` to Validation Output

**What:** Each discovered entity in the validation response includes a `relatedUserThing` field — the exact user-entered topic name this entity most relates to, or `null` if no clear single association.

**Rules:**
- Value must be one of the user's original WHAT entries (exact match, case-insensitive)
- Claude picks the single strongest association (no multi-select)
- Cross-topic entities (e.g., a parent who emails about soccer AND dance) get `null`
- Unrelated entities (e.g., "Business Talent Group") get `null`

**Files:**
- `packages/ai/src/prompts/interview-validate.ts` — add `relatedUserThing` to the discovered entity schema in the system prompt, and add the user's WHATs list to the user prompt so Claude knows the valid values
- `packages/ai/src/parsers/validation-parser.ts` — add `relatedUserThing: z.string().nullable().default(null)` to DiscoveredEntitySchema
- `packages/types/src/schema.ts` — add `relatedUserThing?: string | null` to the discoveredEntities item type in HypothesisValidation

## Part 3: Review Screen Entity Grouping

**What:** Restructure `ReviewEntities` to show two sections:

### Section 1: "Your Topics"

Each user-entered WHAT as a header, with related discoveries listed below:
- PRIMARY entities whose `aliases` contain the user thing name (existing behavior)
- SECONDARY entities whose `relatedUserThing` matches the user thing name (new)
- Each row: entity name, email count, include/exclude toggle
- If nothing discovered for a thing: "No additional items found" (existing text)

### Section 2: "Discoveries"

Flat list of all remaining entities — both PRIMARY and SECONDARY — that don't associate with any specific user topic:
- Entities with `relatedUserThing: null`
- PRIMARY entities that aren't alias-matches for any user thing
- Same toggle UI (include/exclude)

**Files:**
- `apps/web/src/components/onboarding/review-entities.tsx` — restructure filtering logic, rename "Your Things" to "Your Topics", merge old "New Discoveries" into unified "Discoveries" section
- `apps/web/src/components/onboarding/phase-review.tsx` — ensure `relatedUserThing` flows through from validation JSON to `EntityData` (add field to interface)

## Part 4: Diagnose Script Fixes

Fix `diagnose-hypothesis.ts` issues found during first run:
- Entity query uses `displayName` (wrong) — should be `name` (**already fixed**)
- Add `confirmedTags` output (section 4 only showed suggestedTags, not the confirmed ones from the hypothesis)
- Add note on discovery queries: "blank at AWAITING_REVIEW is correct — written at confirm time"
- Add note on confirmed entities: "type not available — confirmedEntities is string[] by design"

**File:** `apps/web/scripts/diagnose-hypothesis.ts`

## Design Clarifications (from first test run)

### Suggested tags are off-topic — by design
The validation scans 200 random inbox emails, not topic-filtered ones. `suggestedTags` surface patterns from the broader inbox (Property Management, Consulting, etc.). The topic-relevant tags (Practice, Game/Match, Schedule) are in `confirmedTags` from the hypothesis. Suggested tags are low-value noise for this user's review decision but not broken.

### Confidence = entity quality, not topic relevance
`confidence: 0.82` means "82% sure this is a distinct entity in the email data." It says nothing about relevance to the user's entered topics. `relatedUserThing` (Part 2) provides the topic-relevance signal. No confidence threshold change needed — we show everything and let the user toggle.

### Confirmed entities are string[] — no type field
The validation prompt returns `confirmedEntities` as plain names: `["soccer", "dance", "ziad allan"]`. The type (PRIMARY/SECONDARY) comes from the hypothesis, not validation. The `type=?` in the diagnose script was printing a nonexistent field.

### Discovery queries blank at AWAITING_REVIEW — correct
`createSchemaStub` writes `discoveryQueries: []` as a placeholder. Real queries are written by `persistSchemaRelations` at confirm time. The queries exist in the hypothesis JSON (section 3c) and are not lost.

## What This Does NOT Change

- Confirm flow (`POST /api/onboarding/:schemaId`) — unchanged
- `persistSchemaRelations` — unchanged, entity toggles work the same way
- Hypothesis generation — unchanged
- Pass 1 validation — unchanged (same prompt, same Claude call, same Gmail sample)
- `resolveWhoEmails` — unchanged (still enriches WHO aliases in Pass 1)
- Entity/EntityGroup/SchemaTag DB writes — unchanged

## Testing

- Run the same test: school_parent domain, soccer/dance/lanier/st agnes/guitar + ziad allan
- Verify review screen appears in <45s
- Verify ZSA, TeamSnap, Pia spring dance show appear under their respective topics
- Verify Amy DiCarlo, Rental Properties, etc. appear in "Discoveries"
- Run `npx tsx scripts/diagnose-hypothesis.ts` after to inspect data (no crash, confirmedTags shown)
- Confirm flow should still work (toggle entities, name topic, click "Show me my cases!")
- Run existing unit tests: `pnpm -r test` should stay green
