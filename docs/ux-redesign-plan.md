# Plan: Major UX Redesign — Case Engine Consumer Experience

## Context

Complete redesign of the Case Engine front-end to transform from a developer-facing dashboard into a consumer-grade mobile-first experience. The clustering pipeline is close to correct (AI audit fixes pending). This plan covers the full UX overhaul: routing, case feed, onboarding, topic management, notes, notifications, billing, and the design collaboration workflow.

**Design tool:** Stitch by Google → exports HTML/CSS + DESIGN.md + screenshots. Claude Code reads designs and implements as React/Next.js components.

**Performance:** Case feed must load instantly for returning users. See `docs/autoresearch-perf-agent-plan.md` for the autonomous perf optimization agent (separate workstream).

---

## 1. Design Collaboration Workflow: Stitch → Code

### What Stitch exports
- **HTML/CSS** — raw markup per screen
- **DESIGN.md** — agent-friendly markdown describing the design system (colors, fonts, spacing, components)
- **Screenshots** — high-fidelity PNGs of each screen
- **Figma export** — optional refinement path

### Recommended pipeline: Stitch → Claude Code

```
1. Design screens in Stitch (user)
2. Export DESIGN.md + screenshots for each screen
3. Drop into docs/designs/{screen-name}/ in the repo
4. Claude Code reads the screenshot (multimodal) + DESIGN.md
5. Implements as React/Tailwind components matching the design pixel-for-pixel
6. Preview with Claude Preview or browser, iterate
```

**Key files to create:**
- `docs/designs/DESIGN.md` — global design system (colors, fonts, spacing, radii, dark mode tokens)
- `docs/designs/{screen}/` — per-screen folder with screenshot + notes
- Reference DESIGN.md in CLAUDE.md so every session inherits the design language

**Why this works well:**
- Stitch's DESIGN.md is specifically built for AI agents
- Claude Code can read screenshots and match visual patterns
- Iterating is fast: change in Stitch → re-export → Claude Code updates components
- No Figma middleman needed (but available if desired)

---

## 2. Routing Architecture Redesign

### Current routes
```
/                                    → Marketing landing (public)
/interview                           → Onboarding (multi-step cards)
/dashboard                           → Schema list (authenticated)
/dashboard/[schemaId]                → Schema detail
/dashboard/[schemaId]/cases          → Case feed (single schema)
/dashboard/[schemaId]/cases/[caseId] → Case detail
```

### Proposed routes
```
/                  → SMART: auth check → returning user? → /feed : → /welcome
/welcome           → Marketing landing page (pricing, trial, CTA)
/onboarding        → New onboarding flow (interview → subscribe → connect → scan → review)
/feed              → UNIFIED case feed (all schemas, sorted by urgency) ← PRIMARY SCREEN
/feed/[caseId]     → Case detail (slide-up or full page)
/note/new          → Create a personal note/todo
/settings          → Settings hub
/settings/topics   → List all topics (schemas) with stats
/settings/topics/new      → Add new topic (re-enter interview)
/settings/topics/[id]     → Edit topic (entities, tags, fields)
/settings/topics/[id]/dashboard → Quality/stats for this topic
/settings/notifications   → Notification preferences
/settings/subscription    → Billing/Stripe portal
```

### Smart root redirect (`/`)
```ts
// proxy.ts or page.tsx
// Authenticated + has schemas → redirect to /feed
// Authenticated + no schemas → redirect to /onboarding
// Not authenticated → show /welcome (marketing)
```

This means returning users hit `/` and land on their feed with zero extra clicks.

---

## 3. Unified Case Feed (All Schemas)

### Core change
Currently the feed is per-schema (`/dashboard/[schemaId]/cases`). New feed shows ALL cases across ALL user schemas in one view, sorted by urgency.

### New API: `GET /api/feed`
```ts
// Query all cases for all user's schemas
const cases = await prisma.case.findMany({
  where: {
    schema: { userId: user.id },
    urgency: { not: 'IRRELEVANT' },
    // Hide resolved/past cases by default
  },
  include: {
    schema: { select: { id: true, name: true, domain: true } },
    entity: { select: { name: true } },
    actions: { where: { status: 'PENDING' }, take: 2, orderBy: { dueDate: 'asc' } },
  },
  orderBy: [
    // Urgency-first ordering (DB-level, not JS)
    { lastEmailDate: 'desc' },
  ],
  take: 30,
});
```

### Filter bar (below bottom nav)
- **Topic chips**: Color-coded by schema. E.g., "🏠 Property" "⚽ Kids Activities" "📋 Work"
- **Entity chips**: Nested under topic. E.g., under "Kids Activities": "Soccer", "Lanier", "Dance"
- Clicking a topic chip shows only that schema's cases
- Clicking an entity chip further narrows to that primary entity

### Card visual hierarchy (top to bottom)
1. **Topic emoji + Entity name** — "⚽ Soccer" (largest, boldest)
2. **Case title** — "Spring Tournament Registration"
3. **When** — "Thu Mar 27, 3:30 PM" (clean readable, highlighted if imminent)
4. **Where** — "Oak Park Field" (clickable → Google Maps)
5. **Summary** — 1-2 line preview (summary.end)
6. **Actions** — "📋 Register by Mar 26" / "💳 Pay $150"
7. **Status indicator** — visual only (color/icon, not text badge)

### Deterministic status decay
Cases must update status as time passes WITHOUT an AI call:
```ts
// Client-side or cron: check case actions
function computeDisplayStatus(case: CaseForUI, now: Date): DisplayStatus {
  const pendingActions = case.actions.filter(a => a.status === 'PENDING');
  const allPastDue = pendingActions.every(a => a.dueDate && a.dueDate < now);
  const hasUpcoming = pendingActions.some(a => a.dueDate && a.dueDate > now);

  if (case.status === 'RESOLVED') return 'resolved';
  if (pendingActions.length === 0) return 'no-action';
  if (allPastDue) return 'past-due'; // was urgent, now overdue
  if (hasUpcoming) return 'active';
  return 'open';
}
```

### Past/resolved cases
- Default: hidden from feed (or collapsed at bottom behind "Show past")
- Still exist in data for clustering accuracy
- Accessible via filter toggle

---

## 4. Case Card Design

### Emoji assignment
Add to synthesis prompt: "Assign a single emoji that represents this case's topic/activity."
Store as `Case.emoji: String?` (1-2 chars).

### Visual separation
- Cards with clear borders/shadows, generous padding
- Urgency indicated by left border color (red=imminent, amber=this-week, green=upcoming, gray=past)
- Unread dot
- Event time prominently displayed for time-sensitive cases

### Blank space fill
When feed has <5 cases, show encouraging/funny messages:
- "All caught up! 🎉 Go enjoy your day."
- "Your inbox is working for you now."
- Randomized from a curated list

---

## 5. Bottom Navigation (Mobile)

```
┌─────────────────────────────────┐
│  [Feed]    [+ Note]    [⚙️]    │
└─────────────────────────────────┘
```

- **Feed** — `/feed` (primary, highlighted)
- **+ Note** — `/note/new` (create personal todo/note)
- **Settings** — `/settings` (gear icon)

### Settings screen
- Add a Topic → `/settings/topics/new`
- Review & Edit My Topics → `/settings/topics`
- Dashboard → `/settings/topics/[id]/dashboard`
- Notifications → `/settings/notifications`
- Subscription → `/settings/subscription`

---

## 6. New User Flow

### Landing page (`/welcome`)
- Value proposition: "Your email, organized into action"
- Visual: animated case cards being created from emails
- Pricing: $5/month, 7-day free trial, cancel anytime
- CTA: "Start Free Trial" → `/onboarding`

### Onboarding (`/onboarding`)

**Step 1: What are you tracking?**
- "What kind of emails do you want organized?"
- User types entity names (e.g., "Soccer", "1501 Sylvan")
- Below their input: animated fake case cards appear using their words
- Minimal UI — just a text input and animated preview

**Step 2: Who sends you these emails?**
- "Name a few people who email you about these"
- User types names
- Progressive disclosure: "You don't need everyone — just a few to help us find the rest"

**Step 3: Subscribe & Connect**
- First click → Stripe Checkout (card collection, 7-day trial, $5/month)
- Stripe success URL → Gmail OAuth flow
- Gmail success → scanning screen

**Step 4: Scanning animation**
- Real-time progress from scan job
- Show actual sender names/subjects as they're discovered
- "Scanning your inbox... found 47 relevant emails"

**Step 5: Review & Configure**
- Show discovered entities grouped by what they entered
- EXTRA discoveries → drag to "Save for Later" box (seeds Topic 2)
- Items that belong together → drag to merge
- Clear language: "If any of these should be grouped with something you entered, drag them together"
- Tags and people editing
- Name the topic

**Step 6: First feed (newly onboarded state)**
- Explainer overlay/tooltips on first visit
- "Here are your first cases. As more email arrives, we'll get smarter."

---

## 7. Personal Notes / Todos

### New model
```prisma
model UserNote {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  schemaId    String?  // optionally linked to a topic
  title       String
  body        String?
  dueDate     DateTime?
  status      NoteStatus @default(OPEN) // OPEN, DONE, DISMISSED
  calendarEventId String?
  calendarSynced  Boolean @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Notes appear in the feed alongside cases, sorted by the same urgency logic.
They're visually distinct (different card style, "📝" marker).

---

## 8. Topic Editing

### `/settings/topics/[id]`
- **Primary Entities**: Add/remove (what cases are clustered around)
- **Secondary Entities**: Add/remove (who sends email)
- **Tags**: Add/remove (categorization)
- **Extracted Fields**: Add/remove (what data to pull from emails)
- **Delete topic** button (with confirmation + cascade warning)

### Impact of editing
- Adding entities → triggers re-scan to find matching emails
- Removing entities → mark cases as "orphaned", user confirms deletion or merge
- Adding tags → next synthesis picks them up
- Removing tags → existing cases keep old tags, new synthesis won't use them

---

## 9. Dashboard & Quality Stats

### `/settings/topics/[id]/dashboard`
Single-page stats for one topic:

| Metric | Source |
|--------|--------|
| Emails scanned | CaseSchema.emailCount |
| Emails in cases | SUM(Case.emailCount) |
| Total cases | CaseSchema.caseCount |
| Open items | COUNT(CaseAction WHERE status=PENDING) |
| Corrections made | COUNT(FeedbackEvent) |
| Accuracy trend | QualitySnapshot series |

### Feedback text box
Free-text input: "Tell us how we can improve your cases"
→ Stored as FeedbackEvent with type TEXT_FEEDBACK
→ Fed to next calibration/synthesis as learned vocabulary

---

## 10. Notification Preferences

### `/settings/notifications`
- **Daily email digest**: On/off, time of day selection
- **SMS for urgent items**: On/off, phone number
- **Push notifications**: On/off (PWA)
- **Digest email includes**: Configurable (new cases, upcoming deadlines, action items)

### New model
```prisma
model NotificationPreference {
  id              String  @id @default(cuid())
  userId          String  @unique
  user            User    @relation(fields: [userId], references: [id])
  emailDigest     Boolean @default(true)
  emailDigestTime String  @default("08:00") // local time
  smsUrgent       Boolean @default(false)
  phoneNumber     String?
  pushEnabled     Boolean @default(false)
  updatedAt       DateTime @updatedAt
}
```

---

## 11. Calendar Integration

### Read: Compare against calendar
- Extend OAuth to request `calendar.events.readonly`
- Match CaseAction events against existing calendar events
- Show "Already on calendar ✓" or "Not on calendar — Add?"

### Write: Add to calendar
- Extend OAuth to request `calendar.events` (read+write)
- One-click "Add to Calendar" on action items
- Store calendarEventId for dedup
- Update if action details change (date, location)

---

## 12. Responsive Design Targets

| Surface | Width | Layout |
|---------|-------|--------|
| Mobile web (primary) | 375-428px | Bottom nav, single column, cards full-width |
| Tablet | 768px | Bottom nav, 2-column card grid |
| Laptop | 1280px | Side nav or top nav, 2-3 column grid |
| Chrome sidebar | 400px | Same as mobile layout |

---

## 13. Stripe Integration

### New user flow
- Stripe Checkout Session (hosted page)
- Trial: 7 days
- Price: $5/month
- Card collected upfront, charged on day 7
- Webhook: `checkout.session.completed` → update User.stripeCustomerId, subscriptionTier
- Webhook: `customer.subscription.deleted` → downgrade/pause

### Schema additions
```prisma
model User {
  // add:
  stripeCustomerId    String?  @unique
  subscriptionStatus  String   @default("trialing") // trialing, active, canceled, past_due
  subscriptionEndDate DateTime?
  trialEndDate        DateTime?
}
```

---

## 14. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- Smart root redirect (proxy.ts)
- New route structure (/feed, /welcome, /settings/*)
- Unified case feed API (cross-schema query)
- Bottom nav component
- loading.tsx skeletons + parallel queries (from perf plan)

### Phase 2: Case Feed UX (Week 2-3)
- New case card design with visual hierarchy
- Emoji assignment in synthesis
- Deterministic status decay (client-side)
- Filter bar (topic chips + entity chips)
- Past/resolved case hiding

### Phase 3: New User Flow (Week 3-4)
- Landing page (/welcome)
- Stripe integration (checkout, webhooks)
- Redesigned onboarding (interview → subscribe → connect → scan → review)
- Drag-to-merge and save-for-later UX
- Scanning animation with real data

### Phase 4: Notes & Settings (Week 4-5)
- UserNote model + CRUD
- Notes in feed alongside cases
- Topic editing screen
- Dashboard/stats page
- Notification preferences

### Phase 5: Calendar & Polish (Week 5-6)
- Calendar read/write integration
- Calendar accept status display
- PWA manifest + install prompt
- Funny empty states
- First-run tooltips for newly onboarded users

---

## Design Decisions (Confirmed)

1. **Inner Circle** = AI-detected priority tier ABOVE IMMINENT. The 2-3 most critical items right now. Feed shows these first with distinct visual treatment (e.g., glow, larger card, "Focus Now" badge).
2. **Chrome extension + PWA** = Both, shared components. Same React component library at ~400px width. PWA for mobile/desktop standalone. Extension for Chrome sidebar while browsing. `components/` shared between `apps/web` and `apps/extension`.
3. **Daily digest** = AI-generated smart summary email with deep links. "You have 3 items due today, 2 new cases since yesterday. Here's what needs attention..."
4. **Notes** = Standalone by default, optionally linked to a topic. Appear in the unified feed alongside cases.

5. **Topic 2 onboarding** = Hybrid. If save-for-later items exist from topic 1 scan, offer quick-add first (pre-populated, just needs naming). If starting from scratch or no saved items, run full interview flow. Both paths available from Settings → Add Topic.

6. **Terminology** = "Topic" everywhere. "Add a Topic", "Your Topics", "Kids Activities topic".
7. **Visual mood** = User exploring in Stitch first. Will share designs and we implement from there.

## Remaining Design Questions

1. **Feed urgency tiers** — Proposed order: Inner Circle → Imminent → This Week → Upcoming → No Action → (Past/Resolved hidden). Confirm?
2. **Subscription gate** — What can free/trial users see? Full feed but limited topics? Or feed locked behind subscription?
3. **Error/empty states** — Friendly/casual tone? ("All caught up! 🎉")
4. **Accessibility** — WCAG AA target?

---

## 15. Pipeline Data Flow Map (Verified Against Code)

### End-to-End Pipeline

```
USER INTERVIEW
  │ Input: role, domain, entity groups (whats/whos), goals
  │ AI: Claude Sonnet → SchemaHypothesis (entities, tags, fields, queries, clusteringConfig)
  │ Gap: AI generates discovery queries with ZERO email data (purely theoretical)
  ▼
VALIDATION (100 email samples, 120-char snippets)
  │ AI: Claude Sonnet → confirmedEntities, discoveredEntities, suggestedTags
  │ Gap: Only 2% of emails sampled; snippets severely truncated
  ▼
SCHEMA FINALIZED → DB: CaseSchema, Entity, EntityGroup, SchemaTag, ExtractedFieldDef
  ▼
DISCOVERY (Gmail search using hypothesis queries)
  │ Queries: from hypothesis + AI-generated smart queries
  │ Cap: 200 emails max, 56-day lookback
  │ Gap: Hard cap may miss relevant emails; lookback window fixed
  ▼
EXTRACTION (per email, via Gemini Flash)
  │ Input: full email body + schema context (tags, entities, fields, entity groups)
  │ Output: summary, tags, extractedData, detectedEntities, relevanceScore, routingDecision
  │ 🔴 Gap: NO today's date — Gemini can't assess temporal relevance
  │ Gate: relevanceScore < 0.4 → excluded
  │ Routing: 4-stage content-first (AI entity → subject match → detected entities → sender)
  ▼
COARSE CLUSTERING (Gravity Model — pure functions, zero AI)
  │ Input: emails with entityId + existing cases
  │ Scoring: threadScore + subjectScore + actorScore × timeDecay
  │ Weights: from clusteringConfig (interview) or tunedClusteringConfig (calibration)
  │ Decision: score ≥ mergeThreshold → MERGE into case; else → CREATE new case
  ▼
CASE SPLITTING (AI — Claude Sonnet)
  │ Input: coarse clusters with freq words (top 20), email samples (30 per cluster), corrections (20)
  │ Output: split cases with titles, discriminator words, emailId assignments
  │ 🔴 Gap: NO today's date — can't distinguish past vs upcoming events
  │ Phase routing: CALIBRATING/TRACKING → AI split; STABLE → deterministic split
  ▼
SYNTHESIS (AI — Claude Sonnet)
  │ Input: all case emails (subject, sender, date, summary, tags, isReply) + schema context
  │ ✅ TODAY'S DATE INCLUDED — urgency determination works
  │ Output: title, 3-part summary, displayTags, primaryActor, actions, status, urgency
  │ Action dedup: fingerprint matching against existing actions
  ▼
CALIBRATION (AI — Claude Sonnet, runs after synthesis in CALIBRATING/TRACKING phases)
  │ Input: current config + cluster summary + last 50 corrections + learned vocabulary
  │ 🔴 Gap: frequencyTables passed as EMPTY {} — prompt expects data but gets none
  │ Output: tunedConfig (weights), discriminatorVocabulary (learned words)
  │ Phase transitions: CALIBRATING → TRACKING (5+ signals) → STABLE (7 days at 95%+ accuracy)
  ▼
FEEDBACK LOOP (user corrections)
  │ Types: EMAIL_MOVE, EMAIL_EXCLUDE, THUMBS_UP/DOWN, CASE_MERGE, CASE_SPLIT
  │ EMAIL_MOVE → re-synthesis of both source + target cases
  │ EMAIL_EXCLUDE → auto-creates ExclusionRule after 3+ from same domain
  │ All events → immutable FeedbackEvent log → feeds calibration
  ▼
QUALITY TRACKING (daily snapshot)
  │ accuracy = 1 - (corrections / casesViewed) over 30-day window
  │ Controls phase transitions
```

### What the AI Sees at Each Stage

| Stage | Today's Date | Email Content | Schema Context | Corrections | Frequency Data |
|-------|:---:|:---:|:---:|:---:|:---:|
| Hypothesis | ❌ | ❌ | User input only | ❌ | ❌ |
| Validation | ❌ | 100 × 120-char | Hypothesis | ❌ | ❌ |
| Discovery Intelligence | ❌ | 15 × 300-char body | Entities + groups | ❌ | ❌ |
| Extraction | ❌🔴 | Full body | Tags, entities, fields, groups | ❌ | ❌ |
| Case Splitting | ❌🔴 | 30 samples per cluster | Domain + vocabulary | 20 recent | Top 20 words ✅ |
| Calibration | ❌ | ❌ | Config + cluster stats | 50 recent | ❌🔴 (hardcoded {}) |
| Synthesis | ✅ | All email summaries | Full schema context | ❌ | ❌ |

---

## 16. AI Audit Fixes (Pre-UX Redesign)

These fixes should be applied BEFORE the UX redesign because they directly affect case quality, which is what users see.

### Fix 1: Add today's date to Extraction prompt (HIGH)
**File:** `packages/ai/src/prompts/extraction.ts`
- Add `today?: string` parameter to `buildExtractionPrompt()`
- Include `TODAY'S DATE: ${today}` in system prompt near relevance assessment section
**File:** `apps/web/src/lib/services/extraction.ts`
- Pass `today: new Date().toISOString().slice(0, 10)` to prompt builder

### Fix 2: Add today's date to Case Splitting prompt (MEDIUM)
**File:** `packages/ai/src/prompts/case-splitting.ts`
- Add `today?: string` parameter to `buildCaseSplittingPrompt()`
- Include in system prompt
**File:** `apps/web/src/lib/services/cluster.ts`
- Pass today to prompt builder in `aiCaseSplit()`

### Fix 3: Add Zod validation to Discovery Intelligence (MEDIUM)
**File:** Create `packages/ai/src/parsers/discovery-intelligence-parser.ts`
- Define Zod schema for `{ relevantQueries, excludeDomains, reasoning }`
**File:** `apps/web/src/lib/services/discovery.ts` — use new parser
**File:** `packages/ai/src/index.ts` — export new parser

### Fix 4: Pass real frequency tables to Calibration (HIGH — learning loop)
**File:** `apps/web/src/lib/services/cluster.ts` (line ~1124)
- Currently: `frequencyTables: {}`
- Fix: Thread `FrequencyTable[]` data from `splitCoarseClusters()` through to `applyCalibration()`
- Or recompute frequency tables in `applyCalibration()` by reading case emails

### Fix 5: Add emoji to synthesis output (NEW — for UX redesign)
**File:** `packages/ai/src/prompts/synthesis.ts`
- Add to prompt: "Assign a single emoji (1-2 chars) that represents this case's topic/activity"
**File:** `packages/ai/src/parsers/synthesis-parser.ts`
- Add `emoji: z.string().optional()` to Zod schema
**File:** `apps/web/prisma/schema.prisma`
- Add `emoji String?` to Case model

---

## 17. Revised Implementation Phases

### Phase 0: AI Pipeline Fixes (Before UX work)
- Fix 1: Today's date in extraction prompt
- Fix 2: Today's date in case-splitting prompt
- Fix 3: Zod parser for discovery intelligence
- Fix 4: Real frequency tables in calibration
- Fix 5: Emoji in synthesis output
- **Verify:** Re-run pipeline on test schema, confirm improved case quality

### Phase 1: Performance + Foundation (Week 1-2)
- Parallel queries + loading.tsx skeletons (from perf plan)
- Smart root redirect (proxy.ts)
- New route structure (/feed, /welcome, /settings/*)
- Unified case feed API (cross-schema query)
- Bottom nav component
- Deterministic status decay (pure function, no AI call)

### Phase 2: Case Feed UX (Week 2-3) — NEEDS STITCH DESIGNS
- New case card design with visual hierarchy
- Filter bar (topic chips + entity chips)
- Inner Circle priority tier
- Past/resolved case hiding
- Empty state messages

### Phase 3: New User Flow (Week 3-4) — NEEDS STITCH DESIGNS
- Landing page (/welcome)
- Stripe integration (checkout, webhooks)
- Redesigned onboarding with drag-to-merge, save-for-later
- Scanning animation with real data

### Phase 4: Notes & Settings (Week 4-5)
- UserNote model + CRUD + feed integration
- Topic editing screen (add/remove entities, tags, fields)
- Dashboard/stats page
- Notification preferences

### Phase 5: Calendar & Polish (Week 5-6)
- Calendar read/write integration
- PWA manifest + install prompt
- First-run tooltips
- Daily digest email (AI-generated)

---

## Next Steps

1. **Immediate:** Implement Phase 0 (AI audit fixes) — no design dependency
2. **Parallel:** User designs key screens in Stitch → `docs/designs/`
3. **Then:** Phase 1 (performance + routing foundation) — no design dependency
4. **Design-dependent:** Phases 2-3 wait for Stitch designs
5. **Ongoing:** Iterate: Stitch → export → Claude Code implements → preview → feedback
