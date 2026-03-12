# Cross-Reference Audit: UI, Schema, Build Plan, Interview

Tracing every visible UI element back to its schema source, verifying the build plan
covers it, and confirming the interview populates it.

Last updated: 2026-03-07

---

## 1. Case Card (Feed View)

Each visible element on the case card traced to its source:

| UI Element | Prototype Field | Schema Source | Build Phase | Interview Source | Status |
|---|---|---|---|---|---|
| **Title** | `caseData.title` | `Case.title` | Phase 5 (synthesis) | AI generates | OK |
| **Last Sender** | `caseData.lastSender` | **NOT ON CASE MODEL** | Phase 5 or 6 | N/A (derived) | **GAP** |
| **Last Activity** | `caseData.lastActivity` | **NOT ON CASE MODEL** | Phase 5 or 6 | N/A (derived) | **GAP** |
| **Status Label** | `caseData.status` | `Case.status` (OPEN/IN_PROGRESS/RESOLVED) | Phase 5 | AI infers | OK (but enum mismatch - see below) |
| **Status Text** | `caseData.summary.end` | `Case.summary.end` (JSON) | Phase 5 | AI generates | OK |
| **Display Tags** | `caseData.tags` | `Case.displayTags` | Phase 5 | AI curates | OK |
| **Email Count** | `caseData.emailCount` | `Case.caseEmails.length` (computed) | Phase 4-5 | N/A | OK (needs query or denormalize) |
| **Highlight Label** | `caseData.highlight.label` | `ExtractedFieldDef.name` (where showOnCard=true) | Phase 5 | Interview goals | OK |
| **Highlight Value** | `caseData.highlight.value` | `Case.aggregatedData[fieldName]` | Phase 5 | N/A (computed) | OK |
| **Action Items** | NOT IN PROTOTYPE | `CaseAction` rows (status=PENDING) | Phase 5 | N/A (extracted) | **GAP - need to add to UI** |
| **Scope Header** | `caseData.entity` | `Entity.name` (via `Case.entityId`) | Phase 4 | Interview whats | OK |

### Gaps Found:

**GAP 1: `lastSender` and `lastActivity` are not on the Case model.**
The UI shows "Mike Chen, City Planning - 2h ago" but the Case table has no fields for this. These are derived from the most recent email in the case.

**Fix options:**
- A) Denormalize: Add `lastSenderName String?` and `lastEmailDate DateTime?` to Case. Update on each new email or synthesis run.
- B) Query at render time: Join Case -> CaseEmail -> Email, order by date desc, take 1.

**Recommendation:** Option A (denormalize). This data is displayed on every card in the feed. Querying per card is expensive. The synthesis step already processes all emails, so it can set these fields.

**Add to Case model:**
```prisma
  lastSenderName    String?               // Most recent email sender display name
  lastSenderEntity  String?               // Enriched: "Mike Chen, City Planning"
  lastEmailDate     DateTime?             // Most recent email date in case
```

**GAP 2: Action items not in the case card prototype.**
We designed the action checkbox UI conceptually but the case-engine-prototype.jsx doesn't render CaseActions on cards. The build plan Phase 6.2 mentions "action item preview" but the prototype doesn't show it.

**Fix:** Update prototype to show pending actions on the card (checkbox + title + due date). We discussed this layout earlier:
```
┌─────────────────────────────────────┐
│ [] Sign permission slip (due Fri)   │
└─────────────────────────────────────┘
```

**GAP 3: Status enum mismatch.**
- Prototype uses: "active" / "resolved"
- Schema uses: OPEN / IN_PROGRESS / RESOLVED
- The "Status:" label on the card shows "Status:" for active and "Resolved:" for resolved

**Fix:** The UI should map OPEN and IN_PROGRESS both to the amber "STATUS:" label, and RESOLVED to the green "RESOLVED:" label. The build plan Phase 6.2 should note this mapping.

---

## 2. Case Detail View

| UI Element | Prototype Field | Schema Source | Build Phase | Status |
|---|---|---|---|---|
| **Back button** | (navigation) | N/A | Phase 6 | OK |
| **Title** | `caseData.title` | `Case.title` | Phase 5 | OK |
| **Entity / Actor subtitle** | `caseData.entity / caseData.secondaryEntity` | `Entity.name / Case.primaryActor.name` | Phase 5 | OK |
| **Tags (colored pills)** | `caseData.tags` | `Case.displayTags` | Phase 5 | OK |
| **Email count badge** | `caseData.emailCount` | Computed from caseEmails | Phase 4-5 | OK |
| **Status badge** | `caseData.status` | `Case.status` | Phase 5 | OK (enum mapping needed) |
| **Summary: Beginning** | `caseData.summary.beginning` | `Case.summary.beginning` | Phase 5 | OK |
| **Summary: Middle** | `caseData.summary.middle` | `Case.summary.middle` | Phase 5 | OK |
| **Summary: End** | `caseData.summary.end` | `Case.summary.end` | Phase 5 | OK |
| **Summary section labels** | Hardcoded "Issue/Activity/Current Status" | `CaseSchema.summaryLabels` | Phase 1 | **GAP - not dynamic** |
| **Thumbs up/down** | Interactive, logs events | `FeedbackEvent` rows | Phase 7 | OK |
| **Thumbs down reasons** | Bottom sheet options | `FeedbackEvent.payload.reason` | Phase 7 | OK |
| **Action item checkboxes** | NOT IN PROTOTYPE | `CaseAction` rows | Phase 5 | **GAP - need to add** |
| **Email list: sender** | `email.sender` | `Email.senderDisplayName` + entity enrichment | Phase 3 | OK |
| **Email list: date** | `email.date` | `Email.date` (formatted relative) | Phase 3 | OK |
| **Email list: subject** | `email.subject` | `Email.subject` | Phase 3 | OK |
| **Email list: summary** | `email.summary` | `Email.summary` | Phase 3 | OK |
| **Email list: tags** | `email.tags` | `Email.tags` (JSON array) | Phase 3 | OK |
| **"Might belong in" hint** | `email.betterCase` | `Email.alternativeCaseId` -> lookup Case.title | Phase 5 | OK |
| **Swipe: Move** | Opens case picker | Creates `FeedbackEvent` (EMAIL_MOVE) + updates `CaseEmail` | Phase 7 | OK |
| **Swipe: Exclude** | Toast + marks excluded | `Email.isExcluded=true` + `FeedbackEvent` (EMAIL_EXCLUDE) | Phase 7 | OK |
| **Bottom bar: Merge** | Opens case picker | `FeedbackEvent` (CASE_MERGE) + case records updated | Phase 7 | OK |
| **Bottom bar: Split** | AI suggests split | `FeedbackEvent` (CASE_SPLIT) + new case created | Phase 7 | OK |

### Gaps Found:

**GAP 4: Summary section labels are hardcoded in the prototype.**
The case detail renders "Issue", "Activity", "Current Status" as labels, but these should come from `CaseSchema.summaryLabels`. A school parent case should show "What", "Details", "Action Needed". The prototype doesn't read from the schema.

**Fix:** The case detail component needs the CaseSchema (or at least the summaryLabels) in its props/context. The API response for a case should include the schema's summary labels.

**GAP 5: Action items not rendered in case detail.**
The case detail shows summary + thumbs + emails, but no action item section. We designed the checkbox UX conceptually but didn't add it to the prototype.

**Fix:** Add action items section between the summary and the email list. Show pending actions as checkboxes, done actions with strikethrough. Each action shows title, due date (if any), and type icon. Tap checkbox to mark done.

---

## 3. Quality Metrics Screen

| UI Element | Prototype Field | Schema Source | Build Phase | Status |
|---|---|---|---|---|
| **Accuracy %** | Computed from metrics state | `QualitySnapshot.accuracy` | Phase 7 | OK |
| **Calibrating progress** | signals collected / needed | `QualitySnapshot.totalSignals` vs threshold | Phase 7 | OK |
| **Cases Viewed** | `metrics.casesViewed` | `QualitySnapshot.casesViewed` | Phase 7 | OK |
| **Corrections** | `metrics.corrections` | `QualitySnapshot.totalCorrections` | Phase 7 | OK |
| **Thumbs Up** | `metrics.thumbsUp` | `QualitySnapshot.thumbsUp` | Phase 7 | OK |
| **Thumbs Down** | `metrics.thumbsDown` | `QualitySnapshot.thumbsDown` | Phase 7 | OK |
| **Event Log** | `eventLog` array | `FeedbackEvent` rows ordered by createdAt | Phase 7 | OK |

No gaps. Quality metrics screen aligns cleanly with schema.

---

## 4. Interview Flow

| UI Element | Prototype Step | Schema Destination | Build Phase | Status |
|---|---|---|---|---|
| **Role cards** | Card 1 Step 1 | `CaseSchema.domain` | Phase 1 | OK |
| **Back on role badge** | Card 1 Step 2 | (navigation, resets state) | Phase 1 | OK |
| **What name input** | Card 1 Step 2 | `Entity` rows (PRIMARY) | Phase 1 | OK |
| **What chips** | Card 1 Step 2 | Visual state, commits on finalize | Phase 1 | OK |
| **Who name input** | Card 1 Step 2 | `Entity` rows (SECONDARY) | Phase 1 | OK |
| **Who chips** | Card 1 Step 2 | Visual state, commits on finalize | Phase 1 | OK |
| **Goal pills** | Card 1 Step 3 | `ExtractedFieldDef.showOnCard`, prompt emphasis | Phase 1 | OK |
| **Gmail connect** | Card 2 | `User.googleTokens` | Phase 2 | OK |
| **Email scan progress** | Card 3 | `ScanJob` progress fields | Phase 2-3 | OK |
| **Sender domain cards** | Card 3 | Feed into entity discovery | Phase 2 | OK |
| **Entity cards (Card 4)** | Card 4 | `Entity.isActive` toggle | Phase 1 | OK |
| **+ Add another entity** | Card 4 | New `Entity` row | Phase 1 | OK |
| **Tag pills (Card 4)** | Card 4 | `SchemaTag.isActive` toggle | Phase 1 | OK |
| **+ Add tag** | Card 4 | New `SchemaTag` row | Phase 1 | OK |
| **Summary labels** | Card 4 (read-only) | `CaseSchema.summaryLabels` | Phase 1 | OK |
| **Extracted fields list** | Card 4 (read-only) | `ExtractedFieldDef` rows | Phase 1 | OK |
| **Clustering config** | Card 4 (read-only) | `CaseSchema.clusteringConfig` | Phase 1 | OK |
| **"Looks good" button** | Card 4 | `CaseSchema.status = ONBOARDING`, generates prompts | Phase 1 | OK |
| **Confirmation screen** | Post-Card 4 | Triggers Inngest scan job | Phase 2-3 | OK |

No gaps. Interview prototype aligns with schema mapping.

---

## 5. Feed-Level Features

| UI Element | Prototype | Schema Source | Build Phase | Status |
|---|---|---|---|---|
| **Scope headers (entity groups)** | `entityGroups` computed from cases | `Entity.name` (PRIMARY, isActive=true) | Phase 4 | OK |
| **Scope filter (tappable)** | `scopeFilter` state | Client-side filter on `Case.entityId` | Phase 6 | OK |
| **"Showing: X" bar** | Visible when filtered | Client-side state | Phase 6 | OK |
| **Filter tabs (all/active/resolved)** | `filter` state | Client-side filter on `Case.status` | Phase 6 | OK |
| **Metric bar** | `MetricBar` component | `QualitySnapshot` or computed from events | Phase 7 | OK |
| **"+ Organize something new"** | Bottom button | Launches interview flow (Card 1) | Phase 6 | OK |
| **Settings icon** | Header | Opens schema settings (not built) | Post-MVP | OK |
| **Pulse icon** | Header | Opens quality metrics screen | Phase 7 | OK |

No gaps.

---

## 6. Build Plan Phase Coverage

Checking that every schema table has a build phase that creates/populates it:

| Table | Created In | Populated In | Queried In | Status |
|---|---|---|---|---|
| User | Phase 0 (auth) | Phase 0 | All phases | OK |
| CaseSchema | Phase 1 (interview) | Phase 1 | Phases 3-9 | OK |
| SchemaTag | Phase 1 (interview) | Phase 1, updated Phase 3 | Phases 3-5 | OK |
| ExtractedFieldDef | Phase 1 (interview) | Phase 1 | Phases 3, 5 | OK |
| Entity | Phase 1 (interview) | Phase 1, Phase 2-3 (scan) | Phases 3-5 | OK |
| ExclusionRule | Phase 2-3 (scan) | Phase 3, Phase 7 (feedback) | Phase 3 | OK |
| Email | Phase 3 (extraction) | Phase 3 | Phases 4-6 | OK |
| EmailAttachment | Phase 3 (extraction) | Phase 3 | Phase 5-6 | OK |
| Cluster | Phase 4 (clustering) | Phase 4 | Phase 5 (synthesis trigger) | OK |
| Case | Phase 5 (synthesis) | Phase 5 | Phase 6 (UI) | OK |
| CaseAction | Phase 5 (synthesis) | Phase 5, Phase 8 (calendar) | Phase 6 (UI) | OK |
| CaseEmail | Phase 4-5 | Phase 4-5, Phase 7 (moves) | Phase 6 | OK |
| FeedbackEvent | Phase 7 | Phase 7 | Phase 7 (quality) | OK |
| QualitySnapshot | Phase 7 | Phase 7 (daily job) | Phase 6-7 | OK |
| ScanJob | Phase 2-3 | Phase 2-3, Phase 9 | Phase 6 (progress) | OK |
| ExtractionCost | Phase 3 | Phase 3, Phase 5 | Phase 7 (admin) | OK |

All tables covered.

---

## 7. Summary of All Gaps

### Must Fix in Schema (before build)

**GAP 1: Add derived fields to Case model for feed performance**
```prisma
// Add to Case model:
  lastSenderName    String?
  lastSenderEntity  String?    // Enriched: "Mike Chen, City Planning"
  lastEmailDate     DateTime?
```
These are set during synthesis (Phase 5) and updated when new emails merge into the case.

### Must Fix in UI Prototype (before Phase 6)

**GAP 2: Add CaseAction rendering to case card**
The card should show pending actions as checkboxes between the status line and the footer.
This was designed conceptually but not added to case-engine-prototype.jsx.

**GAP 3: Add CaseAction rendering to case detail**
The detail view needs an action items section between summary and email list.
Pending actions: checkbox + title + due date + type icon.
Done actions: strikethrough.
Each action: tap to mark done, creates FeedbackEvent.

**GAP 4: Case detail summary labels should be dynamic**
Currently hardcoded "Issue / Activity / Current Status". Should read from
CaseSchema.summaryLabels. The case detail API response needs to include the schema's
summary labels, or the client needs to fetch the schema once and cache it.

### Must Fix in Build Plan

**GAP 5: Phase 1 SchemaHypothesis interface is stale**
The interface in the build plan still references `suggestedEntities` on primaryEntity
and a flat `discoveryQueries: string[]`. These should be updated to match the current
interview flow where entities come from user-typed whats/whos and queries are generated
per entity name.

Updated interface should include:
- `goals: string[]` (from goal pills)
- Remove `suggestedEntities` from primaryEntity (entities come from user input, not AI suggestion)
- `discoveryQueries` should be `{ query: string, source: string, entityName: string }[]`

**GAP 6: Phase 1 test descriptions are stale**
The 5 test descriptions in Test 1.A are free-text strings from the old textarea design.
They should be updated to structured inputs matching the new interview:
```
Test case 1: role="parent", whats=["Vail Mountain School", "Eagle Valley SC"],
             whos=["Coach Martinez"], goals=["actions", "schedule"]
```

**GAP 7: Phase 5 synthesis output doesn't mention lastSender fields**
Phase 5 tasks should include populating `Case.lastSenderName`, `Case.lastSenderEntity`,
and `Case.lastEmailDate` during synthesis.

**GAP 8: Phase 6 card spec should reference CaseAction**
Phase 6.2 says "action item preview" but doesn't detail the data source or rendering.
Should reference `CaseAction` rows with status=PENDING, limited to 2 on the card.

### Nice to Have (post-MVP)

**GAP 9: Status label uses schema summaryLabels.end**
The "STATUS:" label on the card is hardcoded. It could optionally use
`CaseSchema.summaryLabels.end` value as the label (e.g. "ACTION NEEDED:" for school).
Low priority since "STATUS:" is universally understood.

---

## 8. Recommended Fix Order

1. **Schema: Add lastSender fields to Case** (2 min, add 3 fields)
2. **Schema: Verify enum mapping** (CaseStatus OPEN/IN_PROGRESS -> UI "active")
3. **Build plan: Update Phase 1 interface to match interview v2** (10 min, rewrite types)
4. **Build plan: Update test cases for structured input** (10 min)
5. **Build plan: Add lastSender to Phase 5 synthesis output** (2 min, add to task list)
6. **Build plan: Detail CaseAction rendering in Phase 6** (5 min)
7. **UI prototype: Add actions to cards and detail** (when ready to iterate on UI again)
8. **UI prototype: Dynamic summary labels** (when ready to iterate on UI again)
