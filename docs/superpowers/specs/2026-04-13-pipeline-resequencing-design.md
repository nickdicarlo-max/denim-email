# Pipeline Resequencing: Review Gate Before Pipeline

**Date:** 2026-04-13
**Status:** Approved
**Related issues:** #63 (transaction timeout), #64 (78 cases), #65 (quality gate)

## Problem

The onboarding pipeline on `feature/ux-overhaul` runs the entire discovery +
extraction + clustering + synthesis pipeline BEFORE showing the user the review
screen. This caused three failures on 2026-04-13:

1. **78 cases** for a 5-activity kids schema because validation-discovered
   entities (JudgeFite PM, Twilio, Charles Schwab, etc.) were auto-promoted
   to PRIMARY with their own EntityGroups -- the user never got a chance to
   reject them.
2. **18-minute wait** before seeing anything -- hypothesis + domain expansion
   + extraction + clustering + 78 sequential synthesis calls.
3. **Quality gate failure** -- 1 of 78 synthesis calls failed, which killed
   the entire onboarding ("1 OPEN case still unsynthesized").

On `main`, the flow was: user enters keywords -> hypothesis + validation
(~30 seconds) -> Card 4 review screen with toggleable entities -> user
confirms -> THEN pipeline runs on confirmed scope only. This worked correctly
and produced 7-12 cases.

## Root Cause

The `onboarding.ts` state machine reordered the phases so that
`persistSchemaRelations` (which creates Entity rows and EntityGroups) and the
full scan pipeline run BEFORE the user sees the review screen. The auto-
confirmation logic at line 307-314 confirms ALL discovered entities without
user input:

```ts
confirmedEntities: validation.discoveredEntities.map((e) => e.name),
confirmedTags: validation.suggestedTags.map((t) => t.name),
```

This means every auto-detected entity becomes a PRIMARY with its own
EntityGroup, generates discovery queries, pulls in unrelated emails, and
creates cases.

## Solution: Reorder Phases

Move the review gate (AWAITING_REVIEW) to BEFORE the pipeline, not after.
The user confirms which entities to include before any extraction, clustering,
or synthesis runs.

### Current Phase Order (broken)

```
PENDING -> GENERATING_HYPOTHESIS -> FINALIZING_SCHEMA -> PROCESSING_SCAN -> AWAITING_REVIEW -> COMPLETED
```

Steps inside onboarding.ts:
1. generate-hypothesis: Claude hypothesis + Gmail validation + domain expansion
2. finalize-schema: auto-confirm all entities, call persistSchemaRelations
3. create-scan-job: create ScanJob, advance to PROCESSING_SCAN
4. request-scan: emit scan.requested, full pipeline runs
5. wait-for-scan: wait up to 20m for scan.completed
6. advance-to-awaiting-review: quality gate, then show review
7. User confirms -> COMPLETED

### New Phase Order (fix)

```
PENDING -> GENERATING_HYPOTHESIS -> AWAITING_REVIEW -> PROCESSING_SCAN -> COMPLETED
```

Steps:
1. generate-hypothesis: Claude hypothesis + Gmail validation + domain expansion (same as current)
2. advance-to-awaiting-review: store hypothesis + validation as JSON, advance to AWAITING_REVIEW, STOP
3. User sees Card 4, toggles entities, clicks confirm
4. API route: persistSchemaRelations with confirmed entities only, create ScanJob, emit event
5. resume-pipeline: Inngest picks up, runs discovery + extraction + clustering + synthesis
6. advance-to-completed: COMPLETED

### Key behavioral change

`persistSchemaRelations` moves from inside onboarding.ts (Step 2, auto-confirm)
to the POST /api/onboarding/:schemaId route (Step 4, user-confirmed). The
function itself doesn't change -- it just receives confirmed entities instead
of all entities.

## Detailed File Changes

### 1. `apps/web/src/lib/inngest/onboarding.ts`

**Current structure (one function, runs straight through):**
- `runOnboarding` triggered by `onboarding.session.started`
- Steps: generate-hypothesis -> validate-hypothesis -> finalize-schema -> create-scan-job -> request-scan -> wait-for-scan -> advance-to-awaiting-review

**New structure (split into two functions):**

#### Function A: `runOnboarding` (triggered by `onboarding.session.started`)

Keeps steps 1 and 1b (generate-hypothesis, validate-hypothesis) exactly as-is.
Then instead of finalize-schema, advances directly to AWAITING_REVIEW:

```
Step 1: generate-hypothesis (same)
  - PENDING -> GENERATING_HYPOTHESIS
  - Load inputs, call generateHypothesis, store on schema row

Step 1b: validate-hypothesis (same)
  - Load hypothesis, run Gmail sample scan
  - resolveWhoEmails, validateHypothesis pass 1
  - Domain expansion pass 2
  - Store merged validation on schema row

Step 2: advance-to-awaiting-review (NEW)
  - advanceSchemaPhase(GENERATING_HYPOTHESIS -> AWAITING_REVIEW)
  - No work callback needed -- hypothesis + validation are already stored
  - Function exits. Inngest workflow is done.
```

**Removed from this function:**
- finalize-schema step (moves to API route)
- create-scan-job step (moves to API route)
- request-scan step (moves to Function B)
- wait-for-scan step (moves to Function B)
- advance-to-awaiting-review step (replaced by advance-to-awaiting-review above)
- Quality gate (no longer needed -- review happens before pipeline)

#### Function B: `runOnboardingPipeline` (NEW, triggered by `onboarding.review.confirmed`)

```
Step 1: create-scan-job
  - advanceSchemaPhase(AWAITING_REVIEW -> PROCESSING_SCAN)
  - Create ScanJob row in work callback
  - Return scanJobId

Step 2: resolve-scan-job (idempotent re-entry, same pattern as current)

Step 3: request-scan
  - Emit scan.requested event (same as current)

Step 4: wait-for-scan
  - waitForEvent("scan.completed", timeout: 20m, match: "data.schemaId")
  - Same timeout and match semantics as current

Step 5: advance-to-completed
  - advanceSchemaPhase(PROCESSING_SCAN -> COMPLETED)
  - Set status = ACTIVE
  - No quality gate needed (see rationale below)
```

**Concurrency and cancelOn:** Same as current runOnboarding -- keyed on
schemaId (limit 1) and userId (limit 3). CancelOn matches
onboarding.session.cancelled on data.schemaId.

**Error handling:** Same pattern -- catch block calls markSchemaFailed with
current phase and re-throws.

**Quality gate removal rationale:** The quality gate (unsynthesized case count
check) existed because the review screen was post-pipeline -- showing a user
cases that weren't fully synthesized was bad UX. Now the review screen is
pre-pipeline, and COMPLETED means "pipeline finished, go to feed." If 1 of
15 synthesis calls fails, the user sees 14 good cases in their feed. The
failed case either gets retried by Inngest or shows as an empty card. This
is better than blocking the entire onboarding. Issue #65 tracks improving
this further if needed.

### 2. `apps/web/src/app/api/onboarding/[schemaId]/route.ts` (POST handler)

**Current behavior:**
- CAS flip: AWAITING_REVIEW -> COMPLETED, status -> ACTIVE
- Apply entity toggles (isActive true/false)
- Return success

**New behavior:**
- CAS flip: AWAITING_REVIEW -> PROCESSING_SCAN (not COMPLETED -- pipeline hasn't run yet)
- Apply entity toggles (same)
- Call `persistSchemaRelations(schemaId, hypothesis, validation, confirmations)`
  - hypothesis and validation read from schema row (already stored by runOnboarding Function A)
  - confirmations built from the entity toggles the user just submitted
- Create ScanJob row
- Emit `onboarding.review.confirmed` event with { schemaId, userId, scanJobId }
- Return success (observer page starts polling, sees PROCESSING_SCAN phases)

**Building confirmations from entity toggles:**

The current review UI sends `entityToggles: [{ id, isActive }]`. The API
route needs to convert these into the `FinalizeConfirmations` shape that
`persistSchemaRelations` expects. The route will:

1. Read hypothesis + validation from the schema row
2. Read the entity toggles from the request body
3. Build confirmations:
   - `confirmedEntities`: names of entities where isActive=true from the
     toggles, mapped against validation.discoveredEntities
   - `removedEntities`: names where isActive=false
   - `confirmedTags`: all suggested tags (or add tag toggles to UI later)
   - `removedTags`: []
4. Call persistSchemaRelations with these confirmations

**Important nuance:** Currently entities are already persisted in the DB by
the time the review screen loads (finalize-schema created them). In the new
flow, entities DON'T EXIST yet when the review screen loads -- they're just
JSON in hypothesis + validation on the schema row. The review UI currently
loads entities from `GET /api/schemas/:schemaId` which queries Entity rows.

This means the review UI needs a different data source. Two options:

**Option A (recommended):** The review UI reads hypothesis + validation JSON
from the schema row instead of Entity rows. The `GET /api/schemas/:schemaId`
endpoint (or the polling endpoint) returns the raw hypothesis entities +
discovered entities so Card 4 can render them. No Entity rows needed yet.

**Option B:** Keep creating Entity rows in the generate-hypothesis step (as
candidate rows), let the review UI read them, and then the confirm step
activates/deactivates them. This is closer to the current code but means
Entity rows exist before confirmation, which is what caused the auto-
promotion problem.

**Go with Option A.** It's cleaner: Entity rows only exist after
confirmation, which matches the mental model. The review UI renders from
JSON, not DB rows.

### 3. `apps/web/src/components/onboarding/phase-review.tsx`

**Current:** Loads entities from `GET /api/schemas/:schemaId` (Entity rows).

**New:** Loads hypothesis + validation from the schema row (JSON). The
component already has the `EntityData` interface -- it just needs to build
that array from the JSON instead of from DB rows.

Changes:
- The `GET /api/schemas/:schemaId` response (or a new field on the polling
  response) includes `hypothesis.entities` + `validation.discoveredEntities`
- `phase-review.tsx` maps these into the existing `EntityData[]` shape
- `handleFinalize` sends the same `entityToggles` payload, but keyed by
  entity NAME (not DB id, since Entity rows don't exist yet)
- The POST handler uses names to build confirmations for persistSchemaRelations

### 4. `apps/web/src/lib/services/onboarding-state.ts`

**Change the phase ordering:**

```ts
const SCHEMA_PHASE_ORDER: Record<SchemaPhase, number> = {
  PENDING: 0,
  GENERATING_HYPOTHESIS: 1,
  // FINALIZING_SCHEMA removed from ordering (still in enum for backward compat)
  FINALIZING_SCHEMA: 2,    // keep index for any existing rows
  AWAITING_REVIEW: 3,      // WAS 4, now before PROCESSING_SCAN
  PROCESSING_SCAN: 4,      // WAS 3, now after AWAITING_REVIEW
  COMPLETED: 5,
  NO_EMAILS_FOUND: 99,
  FAILED: 99,
};
```

This change makes the CAS idempotency checks work correctly for the new
ordering. `advanceSchemaPhase(GENERATING_HYPOTHESIS -> AWAITING_REVIEW)` will
succeed because 3 > 1. `advanceSchemaPhase(AWAITING_REVIEW -> PROCESSING_SCAN)`
will succeed because 4 > 3.

### 5. `apps/web/src/lib/services/onboarding-polling.ts`

**Changes:**
- When `schema.phase === "AWAITING_REVIEW"`, return phase "AWAITING_REVIEW"
  (same as current, no change needed)
- When `schema.phase === "PROCESSING_SCAN"`, map through scan sub-phases
  (DISCOVERING, EXTRACTING, CLUSTERING, SYNTHESIZING) same as current
- Remove FINALIZING_SCHEMA from the user-facing phases (it no longer appears
  in the flow). If polled during the brief FINALIZING_SCHEMA window (legacy
  rows), map it to GENERATING_HYPOTHESIS.

### 6. `packages/types/src/events.ts`

**Add new event:**

```ts
"onboarding.review.confirmed": {
  /** User confirmed entities on the review screen. Triggers pipeline. */
  data: {
    schemaId: string;
    userId: string;
  };
};
```

### 7. `apps/web/prisma/schema.prisma`

**No changes.** The SchemaPhase enum already has all needed values. The
FINALIZING_SCHEMA value stays in the enum for backward compatibility with
any existing rows (it just won't be used in new onboarding flows).

## What Does NOT Change

- `@denim/engine` -- pure clustering/scoring/entity logic, zero changes
- `@denim/ai` -- prompts and parsers, zero changes
- `apps/web/src/lib/services/discovery.ts` -- smart discovery, zero changes
- `apps/web/src/lib/services/extraction.ts` -- email extraction, zero changes
- `apps/web/src/lib/services/cluster.ts` -- gravity model + write phase, zero changes
- `apps/web/src/lib/services/synthesis.ts` -- case synthesis, zero changes
- `apps/web/src/lib/services/interview.ts` -- `persistSchemaRelations` itself
  doesn't change, just called from a different place with user-confirmed data
- `apps/web/src/lib/inngest/functions.ts` -- pipeline functions (fanOut,
  extractBatch, clustering, synthesis), zero changes
- `apps/web/src/lib/inngest/scan.ts` -- runScan, zero changes
- `apps/web/src/components/onboarding/review-entities.tsx` -- review entity
  list component, zero changes (data shape stays the same)
- All other onboarding phase components (phase-pending, phase-generating,
  phase-discovering, etc.) -- zero changes
- Outbox pattern (`OnboardingOutbox`, `drainOnboardingOutbox`) -- zero changes
- CAS helpers (`advanceSchemaPhase`, `advanceScanPhase`) -- zero changes

## CAS Transition Ownership Map (updated)

### CaseSchema.phase transitions

| Transition | Owner | Notes |
|---|---|---|
| PENDING -> GENERATING_HYPOTHESIS | runOnboarding (Function A) | Same as current |
| GENERATING_HYPOTHESIS -> AWAITING_REVIEW | runOnboarding (Function A) | NEW -- was GH -> FINALIZING_SCHEMA |
| AWAITING_REVIEW -> PROCESSING_SCAN | POST /api/onboarding/:schemaId | NEW -- API route, not Inngest |
| PROCESSING_SCAN -> COMPLETED | runOnboardingPipeline (Function B) | Was PS -> AWAITING_REVIEW |
| PROCESSING_SCAN -> NO_EMAILS_FOUND | runOnboardingPipeline (Function B) | Same owner change |

Note: AWAITING_REVIEW -> PROCESSING_SCAN is owned by the API route, not an
Inngest function. This is safe because the API route uses CAS (updateMany
with WHERE phase=AWAITING_REVIEW) and the Inngest function only starts after
receiving the event that the API route emits post-CAS.

### ScanJob.phase transitions

No changes. runScan still owns all scan phase transitions.

## Sequence Diagram

```
User                  API Route              Inngest (Function A)      Inngest (Function B)       Pipeline
  |                      |                         |                         |                      |
  |-- POST /start ------>|                         |                         |                      |
  |                      |-- emit session.started ->|                        |                      |
  |                      |                         |                         |                      |
  |                      |                  generate-hypothesis              |                      |
  |                      |                  (Claude call ~5s)                |                      |
  |                      |                         |                         |                      |
  |                      |                  validate-hypothesis              |                      |
  |                      |                  (Gmail + Claude ~20s)            |                      |
  |                      |                         |                         |                      |
  |                      |                  advance to AWAITING_REVIEW       |                      |
  |                      |                  (Function A exits)               |                      |
  |                      |                         |                         |                      |
  |<-- poll: AWAITING_REVIEW ---------------+      |                         |                      |
  |                      |                         |                         |                      |
  |  (User reviews entities on Card 4)             |                         |                      |
  |  (Toggles off JudgeFite, Twilio, etc.)         |                         |                      |
  |                      |                         |                         |                      |
  |-- POST /confirm ---->|                         |                         |                      |
  |                      |-- persistSchemaRelations |                         |                      |
  |                      |   (confirmed only)       |                         |                      |
  |                      |-- CAS: AR -> PS          |                         |                      |
  |                      |-- create ScanJob         |                         |                      |
  |                      |-- emit review.confirmed ->                        |                      |
  |                      |                         |                         |                      |
  |<-- poll: DISCOVERING -------------------+      |                  create-scan-job               |
  |<-- poll: EXTRACTING --------------------+      |                  request-scan ------> pipeline |
  |<-- poll: CLUSTERING --------------------+      |                  wait-for-scan                 |
  |<-- poll: SYNTHESIZING ------------------+      |                         |               ...    |
  |                      |                         |                  scan.completed <------ done   |
  |                      |                         |                  advance to COMPLETED          |
  |<-- poll: COMPLETED, nextHref=/feed -----+      |                         |                      |
```

## Testing Strategy

1. **Integration test: happy path** -- create schema, emit session.started,
   verify phase reaches AWAITING_REVIEW (not PROCESSING_SCAN). Confirm via
   API, verify phase reaches PROCESSING_SCAN, verify pipeline runs.

2. **Integration test: entity toggle** -- auto-detected entity toggled off
   in confirm request -> verify Entity row has isActive=false -> verify
   discovery queries don't include that entity.

3. **Integration test: CAS race on confirm** -- two concurrent POST /confirm
   requests -> only one succeeds, other gets 409.

4. **Manual test: school_parent schema** -- enter soccer/guitar/lanier/st
   agnes/dance, verify review screen shows ~30 seconds after start, verify
   discovered entities like "JudgeFite PM" appear with "Not now" toggle,
   confirm with only kids activities, verify <15 cases created.

## Risk Assessment

- **Low risk:** Phase ordering change in onboarding-state.ts. The CAS helpers
  use monotonic ordering, so as long as AWAITING_REVIEW < PROCESSING_SCAN,
  all transitions work. Existing FAILED/NO_EMAILS_FOUND terminal states are
  unaffected (index 99).

- **Medium risk:** Review UI data source change (Entity rows -> JSON). The
  EntityData interface is the same, but the mapping from hypothesis +
  validation JSON to EntityData needs to handle all the fields the current
  Entity rows have (aliases, confidence, emailCount, likelyAliasOf, etc.).
  These fields all come from the validation response, so the data is
  available -- it just needs to be mapped correctly.

- **Low risk:** The POST /confirm route doing more work (persistSchemaRelations
  + ScanJob creation + event emission). This is the same work the finalize
  route did on main. The transaction timeout fix (#63, 15s) applies here too
  since persistSchemaRelations is the same function.
