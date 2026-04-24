# Interview-to-Schema Mapping (v2)

Every user input during the interview must populate specific database fields.
This document traces each one and defines what the email scan must discover
to complete the picture.

Last updated: 2026-03-07 (v2: streamlined two-step interview with goals)

---

## Interview Design: 3 User Actions on Card 1

The entire Card 1 interview consists of:
1. **Role** (1 tap) -- highest leverage input in the system
2. **Names** (type + add, what and who) -- the search terms
3. **Goals** (0-4 taps, optional) -- priority tuning

No follow-up questions. No context textarea.
Everything else is AI-inferred or email-scan-discovered.

---

## Action 1: Role Selection

User taps one of six role cards.

| User Input | Schema Destination | Field Type | Notes |
|---|---|---|---|
| Role ID ("parent") | `CaseSchema.domain` | String | Stored directly |
| Role ID | `CaseSchema.interviewResponses.role` | JSON | Raw answer preserved |
| Role ID | `CaseSchema.description` | String | Composed into description |
| Role -> domain | `CaseSchema.clusteringConfig` | JSON | AI generates domain-tuned constants |
| Role -> domain | `CaseSchema.summaryLabels` | JSON | AI selects domain-appropriate labels |
| Role -> domain | `CaseSchema.secondaryEntityConfig` | JSON | AI generates type templates |
| Role -> domain | `SchemaTag` rows | Multiple rows | AI generates tag taxonomy |
| Role -> domain | `ExtractedFieldDef` rows | Multiple rows | AI generates field definitions |

**One tap populates 6+ schema fields via AI inference.** This is why role selection
exists as a discrete step rather than being inferred from names.

### What the AI generates per domain (from role alone, before names):

**school_parent:**
- clusteringConfig: mergeThreshold=35, timeDecay.fresh=60, reminderCollapseEnabled=true, caseSizeThreshold=5
- summaryLabels: { beginning: "What", middle: "Details", end: "Action Needed" }
- secondaryEntityConfig: [Teacher/Coach (affinity 25), School Admin (15), Team Parent (10)]
- Tags: Action Required, Schedule, Payment, Permission/Form, Game/Match, Practice, Cancellation, Volunteer
- ExtractedFields: eventDate (showOnCard), eventLocation, amount

**property:**
- clusteringConfig: mergeThreshold=45, timeDecay.fresh=45, reminderCollapseEnabled=false, caseSizeThreshold=10
- summaryLabels: { beginning: "Issue", middle: "Activity", end: "Status" }
- secondaryEntityConfig: [Vendor (affinity 30), Tenant (20)]
- Tags: Maintenance, Tenant, Vendor, Financial, Lease, Inspection, Compliance, Emergency
- ExtractedFields: cost (showOnCard), deadline

**construction:**
- clusteringConfig: mergeThreshold=45, timeDecay.fresh=45, reminderCollapseEnabled=false, caseSizeThreshold=10
- summaryLabels: { beginning: "Issue", middle: "Progress", end: "Current Status" }
- secondaryEntityConfig: [Subcontractor (30), Architect/Engineer (25), Inspector (20)]
- Tags: RFI, Change Order, Submittal, Schedule, Permits, Safety, Invoice/Payment, Punch List
- ExtractedFields: cost (showOnCard), deadline (showOnCard), percentComplete

**legal:**
- clusteringConfig: mergeThreshold=55, timeDecay.fresh=90, reminderCollapseEnabled=false, caseSizeThreshold=15
- summaryLabels: { beginning: "Matter", middle: "Proceedings", end: "Status" }
- secondaryEntityConfig: [Opposing Counsel (25), Court (15)]
- Tags: Filing, Discovery, Motion, Hearing, Settlement, Billing, Correspondence, Deadline
- ExtractedFields: deadline (showOnCard), filingDate

**agency:**
- clusteringConfig: mergeThreshold=45, timeDecay.fresh=45, reminderCollapseEnabled=false, caseSizeThreshold=8
- summaryLabels: { beginning: "Brief", middle: "Progress", end: "Status" }
- secondaryEntityConfig: [Client Contact (25), Collaborator (15)]
- Tags: Deliverable, Feedback, Meeting, Timeline, Budget, Approval, Creative, Strategy
- ExtractedFields: deadline (showOnCard), budget

---

## Action 2: Name the Whats and Whos

User types names into guided inputs. Blue chips = whats, amber chips = whos.

### Each "WHAT" name (Primary Entity):

| User Input | Schema Destination | Notes |
|---|---|---|
| Name text | `Entity.name` | New row, type=PRIMARY, autoDetected=false, confidence=1.0 |
| Name text | `Entity.aliases` | AI generates aliases from name |
| Name text | `CaseSchema.discoveryQueries` | AI generates Gmail queries from name |
| Set of all whats | `CaseSchema.primaryEntityConfig.name` | AI infers entity type label ("Activity", "Property") |
| Set of all whats | `CaseSchema.primaryEntityConfig.description` | AI generates description |
| Set of all whats | `CaseSchema.name` | AI generates schema display name |

**Discovery query generation per "what" name:**
- Domain guess: "Vail Mountain School" -> `from:vailmountainschool` (try common patterns)
- Subject search: `subject:"Vail Mountain School"`
- Body search: `"Vail Mountain School"` (quoted phrase in body)
- The email scan (Card 3) validates which queries return results

**Alias generation per "what" name:**
- Abbreviations: "Vail Mountain School" -> ["VMS", "Vail Mountain", "the school"]
- Partial matches: "Eagle Valley Soccer Club" -> ["Eagle Valley SC", "EVSC", "soccer"]

**What names also refine domain inference (no follow-up needed):**
- "Oakwood HOA" in property domain -> AI adjusts to HOA/co-op variant
- "Eagle Valley Soccer" in school_parent domain -> AI includes sports tags
- "Harbor View Renovation" in construction -> AI infers renovation-specific tags

### Each "WHO" name (Secondary Entity):

| User Input | Schema Destination | Notes |
|---|---|---|
| Name text | `Entity.name` | New row, type=SECONDARY, autoDetected=false, confidence=1.0 |
| Name text | `Entity.secondaryTypeName` | AI classifies into type from secondaryEntityConfig |
| Name text | `Entity.associatedPrimaryIds` | Empty initially, filled during scan |
| Name text | `CaseSchema.discoveryQueries` | AI may add sender-based queries |

If no "who" names are provided, secondary entity TYPES are still generated from
domain knowledge. Specific INSTANCES are discovered from sender domains during scan.

---

## Action 3: Goal Selection

User taps 0-4 goal pills. Multi-select. Optional.

| Goal ID | Schema Effect | Details |
|---|---|---|
| deadlines | `ExtractedFieldDef` "deadline": showOnCard=true | Surfaces deadline on case cards |
| deadlines | `CaseSchema.extractionPrompt` emphasis | Prioritizes deadline extraction |
| deadlines | `CaseAction` priority | DEADLINE type actions weighted higher |
| costs | `ExtractedFieldDef` "cost": showOnCard=true | Surfaces cost on case cards |
| costs | `CaseSchema.extractionPrompt` emphasis | Emphasizes cost extraction from invoices |
| costs | `CaseAction` priority | PAYMENT type actions weighted higher |
| actions | `CaseSchema.extractionPrompt` emphasis | Action item detection prioritized |
| actions | `CaseSchema.summaryLabels.end` | Set to "Action Needed" if not already |
| schedule | `ExtractedFieldDef` "eventDate": showOnCard=true | Surfaces next event on cards |
| status | `CaseSchema.summaryLabels.end` | Reinforces status-focused end section |
| permits | `SchemaTag` "Permits" weight boost | Tag gets higher clustering weight |
| billing | New `ExtractedFieldDef` "billableHours" | Created if not already present |
| organized | (no specific change) | Default behavior, no special tuning |

If no goals selected, AI uses domain defaults:
- school_parent -> actions + deadlines
- property -> costs + status
- construction -> costs + deadlines
- legal -> deadlines + status
- agency -> deadlines + actions

---

## Card 2: Gmail Connect

| Action | Schema Destination | Notes |
|---|---|---|
| OAuth completes | `User.googleTokens` | Encrypted tokens |
| (no user input beyond consent) | | gmail.readonly scope only |

---

## Card 3: Email Scan

Validates hypothesis, discovers new data.

| Discovered Data | Schema Destination | Notes |
|---|---|---|
| Sender domains + frequency | New `Entity` rows (SECONDARY) | autoDetected=true, confidence 0.7-0.9 |
| User entity names found in email | `Entity.confidence` updated | Confirmation signal |
| User entity names NOT found | (unchanged) | Card 4 shows "Not found in email yet" |
| Noise senders | New `ExclusionRule` rows | source="interview" |
| Internal domain patterns | `CaseSchema.primaryEntityConfig.internalDomains` | Detected from scan |
| Subject keyword patterns | Validates `SchemaTag` suggestions | Tags show email match counts on Card 4 |
| Discovery query validation | `CaseSchema.discoveryQueries` | Zero-result queries flagged |

---

## Card 4: User Review

| User Action | Schema Effect | Notes |
|---|---|---|
| Toggle entity OFF | `Entity.isActive = false` | Excluded, not deleted |
| Toggle entity ON | `Entity.isActive = true` | Default |
| + Add another entity | New `Entity` row | autoDetected=false, confidence=1.0 |
| Toggle tag OFF | `SchemaTag.isActive = false` | Removed from extraction |
| Toggle tag ON | `SchemaTag.isActive = true` | Default |
| + Add tag | New `SchemaTag` row | aiGenerated=false, AI generates description |
| "Looks good" | `CaseSchema.status = ONBOARDING` | Triggers full scan |
| "Looks good" | `CaseSchema.extractionPrompt` generated | All active tags + entities + fields |
| "Looks good" | `CaseSchema.synthesisPrompt` generated | Summary labels + domain |

---

## Complete Data Flow

```
CARD 1 Step 1: Role (1 tap)
  |
  +--> CaseSchema.domain
  +--> CaseSchema.clusteringConfig (domain defaults)
  +--> CaseSchema.summaryLabels
  +--> CaseSchema.secondaryEntityConfig (type templates)
  +--> SchemaTag rows (domain taxonomy)
  +--> ExtractedFieldDef rows (domain fields)
  |
CARD 1 Step 2: What names (type + add)
  |
  +--> Entity rows (PRIMARY, autoDetected=false, confidence=1.0)
  +--> Entity.aliases (AI-generated)
  +--> CaseSchema.discoveryQueries (AI from names)
  +--> CaseSchema.primaryEntityConfig (AI infers type)
  +--> CaseSchema.name (AI generates)
  |
CARD 1 Step 2: Who names (type + add, optional)
  |
  +--> Entity rows (SECONDARY, autoDetected=false, confidence=1.0)
  +--> Entity.secondaryTypeName (AI classifies)
  +--> CaseSchema.discoveryQueries (sender queries)
  |
CARD 1 Step 3: Goals (0-4 taps, optional)
  |
  +--> ExtractedFieldDef.showOnCard adjustments
  +--> Extraction prompt emphasis
  +--> Action type priorities
  |
CARD 2: Gmail Connect
  |
  +--> User.googleTokens
  |
CARD 3: Email Scan
  |
  +--> New Entity rows (SECONDARY, autoDetected=true)
  +--> Entity.confidence updates
  +--> CaseSchema.discoveryQueries validation
  +--> CaseSchema.primaryEntityConfig.internalDomains
  +--> ExclusionRule rows
  |
CARD 4: User Review + Finalize
  |
  +--> Entity.isActive toggles
  +--> SchemaTag.isActive toggles
  +--> New Entity/SchemaTag rows (user-added)
  +--> CaseSchema.interviewResponses (all raw answers stored)
  +--> CaseSchema.extractionPrompt (generated)
  +--> CaseSchema.synthesisPrompt (generated)
  +--> CaseSchema.status = ONBOARDING
  +--> Triggers Inngest full scan job
```

---

## Testing Checklist

After running the interview for a test scenario, verify:

**Card 1 outputs (before scan):**
- [ ] CaseSchema.domain matches role selection
- [ ] CaseSchema.interviewResponses contains { role, whats, whos, goals }
- [ ] Entity rows exist for each "what" (type=PRIMARY, autoDetected=false)
- [ ] Entity rows exist for each "who" (type=SECONDARY, autoDetected=false)
- [ ] CaseSchema.clusteringConfig differs from defaults based on domain
- [ ] CaseSchema.summaryLabels are domain-appropriate
- [ ] CaseSchema.discoveryQueries has at least one query per "what" name
- [ ] If goals selected: showOnCard flags on ExtractedFieldDef reflect goals

**Card 3 outputs (after scan):**
- [ ] New Entity rows from scan (autoDetected=true, confidence < 1.0)
- [ ] ExclusionRule rows for noise patterns
- [ ] SchemaTag rows with descriptions
- [ ] ExtractedFieldDef rows with correct showOnCard flags

**Card 4 outputs (after finalize):**
- [ ] CaseSchema.status = ONBOARDING
- [ ] CaseSchema.extractionPrompt references all active tags and entity types
- [ ] CaseSchema.synthesisPrompt references summary labels
- [ ] Disabled entities have isActive=false
- [ ] Disabled tags have isActive=false
- [ ] User-added entities/tags persisted with correct flags
