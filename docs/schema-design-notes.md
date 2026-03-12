# Schema Design Notes

**Date:** 2026-03-05
**Status:** Draft for review

---

## How to Read the Schema

The schema has four layers, each serving a different part of the system:

**Configuration layer** (set up once per topic, tuned over time):
- `CaseSchema` -- the interview-generated configuration
- `SchemaTag` -- tag taxonomy with auto-frequency weighting
- `ExtractedFieldDef` -- configurable data extraction definitions
- `Entity` -- primary (boundary) + secondary (signal) entities
- `ExclusionRule` -- learned ignore patterns

**Data layer** (populated during scans):
- `Email` -- rich metadata record (the search index)
- `EmailAttachment` -- normalized attachment inventory
- `Case` -- clustered email groups with AI summaries
- `CaseAction` -- extracted action items with dedup and lifecycle
- `CaseEmail` -- junction with assignment audit trail
- `Cluster` -- clustering decision audit trail

**Feedback layer** (populated by user interaction):
- `FeedbackEvent` -- every correction, rating, and edit
- `QualitySnapshot` -- daily accuracy computation

**Infrastructure layer** (system operations):
- `User` -- auth and OAuth tokens
- `ScanJob` -- pipeline job tracking
- `ExtractionCost` -- per-email token usage

---

## Key Design Decisions

### 1. CaseSchema stores JSON configs, not normalized tables

`clusteringConfig`, `primaryEntityConfig`, `secondaryEntityConfig`, `summaryLabels`,
`discoveryQueries`, and `copilotConfig` are all JSON fields on CaseSchema rather
than separate tables.

**Why:** These are configuration blobs that are read as a unit and written as a unit
(during interview or settings changes). They're never queried individually across
schemas ("find all schemas with mergeThreshold > 50"). Normalizing them would add
join complexity for zero query benefit.

**Exception:** `SchemaTag` and `ExtractedFieldDef` ARE normalized because they're
referenced by name from email-level data (tags array) and need per-row metadata
(weights, frequency counts, showOnCard flags).

### 2. Email stores parsed header fields separately

`sender`, `senderEmail`, `senderDomain`, `senderDisplayName` are four separate
fields rather than one sender string.

**Why:** Clustering needs `senderDomain` for exclusion rule matching. Entity
enrichment needs `senderEmail` for contact dedup. The UI needs `senderDisplayName`
for display. Parsing these at query time from a combined string is wasteful and
error-prone. Parse once at extraction time, store the components.

### 3. EmailAttachment is a separate table, not JSON on Email

**Why:** Queryability. "Find all invoices across all cases" or "show all PDFs from
this vendor" or "what's the total file size we've processed" are queries you'll
want for the quality dashboard, cost analysis, and eventually search. JSON arrays
inside Email make these queries expensive and awkward.

The Email table keeps denormalized counts (`attachmentCount`, `totalAttachmentBytes`,
`hasProcessedAttachments`) for the common case where you just need to know whether
attachments exist, without joining.

### 4. CaseEmail junction tracks assignment provenance

The junction between Case and Email isn't a bare many-to-many. It records HOW
the email was assigned (`assignedBy`), the score at assignment time, and whether
the user later corrected it (`wasReassigned`).

**Why:** This is gold for debugging clustering quality. If you see a pattern where
emails assigned by CLUSTERING with scores between 45-55 get reassigned at a high
rate, you know your merge threshold is too low. The reassignment data feeds directly
into the breaking-in curve and co-pilot suggestions.

**Constraint:** `@@unique([emailId])` enforces that an email belongs to at most one
case. This is a deliberate constraint. In TCS, emails belong to exactly one case per
property. In the generic engine, same rule: one email, one case, one schema. If the
user disagrees, they move the email (which is a correction signal).

### 5. FeedbackEvent stores raw events, QualitySnapshot stores aggregated metrics

**Why:** Separation of concerns. FeedbackEvents are append-only, never modified,
and may be used for detailed analysis (what specific emails get moved most often?
what tag is associated with the most corrections?). QualitySnapshots are computed
daily from the event stream and power the UI metric bar.

The accuracy formula:
```
corrections = thumbsDown + emailMoves + caseMerges + caseSplits
accuracy = 1 - (corrections / casesViewed)
```

Phase transitions:
- CALIBRATING: totalSignals < threshold (default 5)
- TRACKING: totalSignals >= threshold, accuracy computed
- STABLE: accuracy >= 95% for 7+ consecutive days

### 6. ExclusionRule learns from user behavior

When a user swipes "exclude from scans" on an email, the system:
1. Logs a FeedbackEvent with type EMAIL_EXCLUDE
2. Marks the email as `isExcluded = true`
3. Checks: have 3+ emails from this sender domain been excluded?
   - Yes: auto-create an ExclusionRule for the domain (source: "system_suggested")
   - No: just the individual exclusion

This is the "invisible learning" loop. The user excludes a few newsletters, and
the system learns to ignore that domain going forward.

### 7. CaseAction: Actions as a first-class model, not an extracted field

Actions ("sign permission slip by Friday") evolve over time. A static extracted
string can't track: Is this done? Is this the same action mentioned in 7 reminder
emails? Did the due date change? Has it been synced to the calendar?

**Action dedup via fingerprint:** When the AI extracts an action candidate from a
new email, it generates a normalized fingerprint (lowercase, stop words removed).
If an existing action on the same case has a matching fingerprint, the system
updates rather than creates:
- Add the email ID to `sourceEmailIds`
- Increment `reminderCount`
- Update `dueDate` if the new email changes it (log the change in `changeLog`)
- Update `lastUpdatedByEmailId`

**Action types matter for UI treatment:**
- TASK: checkbox, mark done manually
- EVENT: shows date/time/location, "Add to Calendar" button
- PAYMENT: shows amount, checkbox
- DEADLINE: shows countdown, no checkbox (it passes or it doesn't)
- RESPONSE: indicates user needs to reply to someone

**Completion detection:** Three ways:
- USER: tapped the checkbox in the UI
- INFERRED: AI detected completion language in a subsequent email
  ("I sent the form this morning", "payment confirmed")
- CALENDAR: for EVENT type, the event date has passed

**Calendar integration:** One-way sync, action to Google Calendar.
Permission requested progressively (only when first needed, not during onboarding).
If an action's due date changes from a new email, the calendar event updates.

### 8. Per-topic clustering constants

Each CaseSchema has its own `clusteringConfig` JSON with domain-tuned constants.
The interview AI sets these based on the domain description:

- School email: lower mergeThreshold (35), longer time decay (60/120/180 days),
  reminder collapse enabled, lower case size threshold (5)
- Legal: higher mergeThreshold (55), very long time decay (90/180/365 days),
  stricter subject matching
- Property management: balanced defaults (45 threshold, 45/75/120 decay)

The key insight: these aren't user-facing settings. The interview AI infers them.
The user says "I'm a parent organizing school emails" and the system knows to
use looser clustering with long time horizons. The user says "I'm a lawyer tracking
client matters" and the system knows to use strict boundaries with very long decay.

---

## Data Flow: How an Email Becomes a Case

```
Gmail API
    |
    v
[1] Discovery: Gmail search using schema.discoveryQueries
    |
    v
[2] Dedup: Check email.gmailMessageId against existing emails for this schema
    |
    +-- Already exists --> skip (delta scan)
    |
    +-- New email --> continue
          |
          v
[3] Exclusion check: Match sender/subject against ExclusionRules
    |
    +-- Matches rule --> create Email with isExcluded=true, minimal metadata, DONE
    |
    +-- No match --> continue
          |
          v
[4] Extraction: Send email body + attachments to Gemini Vision
    |   - Single API call: body text + all processable attachments
    |   - Returns: summary, tags, extractedData, entity mentions, attachment summaries
    |   - Oversized attachments: process first 10 pages, note partial coverage
    |
    v
[5] Entity resolution: Match detected entities to known entities (Jaro-Winkler)
    |   - Assign primary entity (or flag as unknown for user review)
    |   - Match sender to secondary entity
    |
    v
[6] Persist Email + EmailAttachment records with full metadata
    |
    v
[7] Update SchemaTag frequencies (for auto-TF-IDF discount)
    |
    v
[8] Clustering: Score email against existing cases within same primary entity
    |   - Thread match: 100 pts
    |   - Tag match: tag.effectiveWeight * timeDecayMultiplier per anchor tag
    |   - Subject similarity: Jaro-Winkler, 40% threshold
    |   - Actor affinity: if enabled, same secondary entity bonus
    |   - Case size gravity: 10+ emails attract more
    |
    +-- Score >= mergeThreshold --> MERGE into highest-scoring case
    |
    +-- Score < mergeThreshold --> CREATE candidate (batch for cross-cluster merging)
          |
          v
[9] Cross-cluster merging: Score CREATE candidates against each other
    |   - Weak tag discount applied
    |   - Merge related clusters before case creation
    |
    v
[10] Case synthesis: Send cluster emails to Claude
     |   - Generate: title, summary (beginning/middle/end), displayTags, primaryActor
     |   - Extract actions: identify action items, dedup against existing case actions
     |   - For each action: generate fingerprint, check for existing match
     |     - Match found: update existing action (sourceEmailIds, dueDate, reminderCount)
     |     - No match: create new CaseAction
     |   - Set: anchorTags from strongest clustering tags
     |   - Compute: aggregatedData from email extractedData + fieldDef.aggregation
     |
     v
[11] Persist Case + CaseEmail records
     |
     v
[12] Quality check: Compute clusteringConfidence per email
     |   - Flag low-confidence assignments (alternativeCaseId)
     |
     v
[13] Update CaseSchema counts (emailCount, caseCount)
```

---

## Indexes Rationale

| Index | Purpose |
|-------|---------|
| `emails(schemaId, entityId)` | Feed view: all emails for an entity within a schema |
| `emails(schemaId, threadId)` | Clustering: thread affinity lookup |
| `emails(schemaId, date)` | Delta scanning: find emails newer than lastFullScanAt |
| `emails(schemaId, senderDomain)` | Exclusion rule matching |
| `emails(schemaId, isExcluded)` | Skip excluded emails during clustering |
| `cases(schemaId, entityId)` | Feed view: cases grouped by entity |
| `cases(schemaId, status)` | Filter tabs: active/resolved |
| `cases(schemaId, viewedAt)` | Unread case count (viewedAt IS NULL) |
| `feedback_events(schemaId, createdAt)` | Quality snapshot computation |
| `feedback_events(caseId)` | Per-case feedback history |
| `scan_jobs(schemaId, status)` | Job polling |
| `extraction_costs(createdAt)` | Cost reporting over time |

---

## What's NOT in the Schema (Intentionally)

**Full email body text.** Not stored. The summary + extractedData + attachment
summaries are sufficient for search and triangulation. When the full body is needed,
re-fetch from Gmail via gmailMessageId. Storing bodies would 10x the database size
and create a PII liability.

**Attachment file bytes.** Not stored. The metadata inventory is stored; the files
live in Gmail. Re-fetch targeted attachments via gmailAttachmentId when needed.

**User session/token management.** Handled by Supabase Auth, not custom tables.
The `googleTokens` field on User stores the encrypted OAuth credentials needed for
Gmail API access.

**Billing/subscription.** Out of scope for prototype. Will be added when pricing
model is finalized.

**Multi-user collaboration.** Each schema belongs to one user. The schema could
later be extended with a workspace/team concept by replacing `userId` with
`workspaceId`, but this is not in the prototype scope.
