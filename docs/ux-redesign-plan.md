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
    { nextActionDate: { sort: 'asc', nulls: 'last' } },
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

### Deterministic Status Decay (CRITICAL — No AI Involvement)

**Status: IMPLEMENTED (2026-03-31)**
- `computeNextActionDate` + `computeCaseDecay` in `packages/engine/src/actions/lifecycle.ts`
- Daily cron: `apps/web/src/lib/inngest/daily-status-decay.ts` (6 AM ET)
- Read-time freshness: applied in `/api/cases` route via `computeCaseDecay`
- Feed sort: `nextActionDate ASC NULLS LAST, lastEmailDate DESC`
- Post-synthesis urgency override now uses full `computeCaseDecay` (all action types)

**Problem:** Today, Case.status and CaseAction.status are set at synthesis time and never updated.
If we scan Monday, find a Friday event, a week later the case still shows as OPEN/IMMINENT.
The `EXPIRED` action status exists in the enum but is never set by any code path.

**Solution: Three layers, all pure deterministic logic, zero AI calls.**

#### Layer 1: Pure engine function (`@denim/engine`)

```ts
// packages/engine/src/actions/lifecycle.ts (NEW or extend existing)

interface CaseDecayInput {
  caseStatus: CaseStatus;       // OPEN, IN_PROGRESS, RESOLVED
  caseUrgency: string;          // IMMINENT, THIS_WEEK, etc.
  actions: Array<{
    id: string;
    status: ActionStatus;       // PENDING, DONE, EXPIRED, etc.
    dueDate: Date | null;
    eventStartTime: Date | null;
    eventEndTime: Date | null;
  }>;
  lastEmailDate: Date;
}

interface CaseDecayResult {
  updatedUrgency: string;
  updatedStatus: CaseStatus;
  expiredActionIds: string[];   // actions to mark EXPIRED
  changed: boolean;             // whether anything changed
}

function computeCaseDecay(input: CaseDecayInput, now: Date): CaseDecayResult {
  const expiredActionIds: string[] = [];

  // Step 1: Find PENDING actions whose dates have passed
  for (const action of input.actions) {
    if (action.status !== 'PENDING') continue;
    const actionDate = action.eventEndTime ?? action.eventStartTime ?? action.dueDate;
    if (actionDate && actionDate < now) {
      expiredActionIds.push(action.id);
    }
  }

  // Step 2: After expiring, check remaining live actions
  const remainingPending = input.actions.filter(
    a => a.status === 'PENDING' && !expiredActionIds.includes(a.id)
  );
  const liveActions = remainingPending.filter(a => {
    const d = a.eventEndTime ?? a.eventStartTime ?? a.dueDate;
    return d && d >= now;
  });

  // Step 3: Derive urgency from nearest live action
  let updatedUrgency = input.caseUrgency;
  let updatedStatus = input.caseStatus;

  if (input.caseStatus === 'RESOLVED') {
    // Already resolved — don't change
  } else if (liveActions.length === 0 && remainingPending.length === 0) {
    // All actions expired or done — case is resolved
    updatedUrgency = 'NO_ACTION';
    updatedStatus = 'RESOLVED';
  } else if (liveActions.length > 0) {
    // Recalculate urgency from nearest upcoming action
    const nearest = liveActions
      .map(a => a.eventStartTime ?? a.dueDate)
      .filter(Boolean)
      .sort((a, b) => a!.getTime() - b!.getTime())[0];

    if (nearest) {
      const hoursUntil = (nearest.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursUntil <= 48) updatedUrgency = 'IMMINENT';
      else if (hoursUntil <= 168) updatedUrgency = 'THIS_WEEK';
      else updatedUrgency = 'UPCOMING';
    }
  }

  const changed = updatedUrgency !== input.caseUrgency
    || updatedStatus !== input.caseStatus
    || expiredActionIds.length > 0;

  return { updatedUrgency, updatedStatus, expiredActionIds, changed };
}
```

**Key properties:**
- Pure function, no I/O, no Date.now() — takes `now` as parameter
- Fully testable with unit tests and fixture data
- Lives in `@denim/engine` (follows package boundary rule)
- Uses `eventEndTime` preferentially (event is over after it ends, not when it starts)

#### Layer 2: Daily Inngest cron job

```ts
// apps/web/src/lib/inngest/functions/daily-status-decay.ts

export const dailyStatusDecay = inngest.createFunction(
  { id: "daily-status-decay", concurrency: { limit: 1 } },
  { cron: "TZ=America/New_York 0 6 * * *" },  // 6 AM daily
  async ({ step }) => {
    const now = new Date();

    // Find all non-terminal cases with pending actions
    const cases = await step.run("load-cases", async () => {
      return prisma.case.findMany({
        where: {
          status: { not: 'RESOLVED' },
          urgency: { notIn: ['IRRELEVANT'] },
        },
        include: {
          actions: { where: { status: 'PENDING' } },
        },
      });
    });

    // Apply decay to each case
    for (const case of cases) {
      const result = computeCaseDecay({
        caseStatus: case.status,
        caseUrgency: case.urgency,
        actions: case.actions,
        lastEmailDate: case.lastEmailDate,
      }, now);

      if (result.changed) {
        await step.run(`update-case-${case.id}`, async () => {
          await prisma.$transaction([
            // Expire actions
            ...result.expiredActionIds.map(id =>
              prisma.caseAction.update({
                where: { id },
                data: { status: 'EXPIRED' },
              })
            ),
            // Update case status + urgency
            prisma.case.update({
              where: { id: case.id },
              data: {
                status: result.updatedStatus,
                urgency: result.updatedUrgency,
              },
            }),
          ]);
        });
      }
    }
  }
);
```

**This ensures:** Every morning, all cases are evaluated against today's date. The Monday-scanned Friday-event case gets marked RESOLVED on Saturday morning's run.

#### Layer 3: Read-time freshness check (API/feed)

Even between cron runs, the feed should show correct status. When loading cases for the feed:

```ts
// In the feed API or server component
const now = new Date();
const casesWithFreshStatus = cases.map(c => {
  const decay = computeCaseDecay(c, now);
  return {
    ...c,
    displayUrgency: decay.updatedUrgency,  // computed, not stored
    displayStatus: decay.updatedStatus,
    isPastDue: decay.expiredActionIds.length > 0 && decay.updatedStatus !== 'RESOLVED',
  };
});
```

This means even if the cron job hasn't run yet today, the user sees correct status. The cron job's role is to persist the changes to the DB so queries/filters work correctly.

#### Layer 4: Urgency recalculation on every view (not just daily)

The `computeCaseDecay` function also recalculates urgency tiers:
- Friday case shows IMMINENT on Thursday
- Shows THIS_WEEK on Monday
- Shows NO_ACTION / RESOLVED the following Monday

This happens automatically because urgency is derived from `hoursUntil` the nearest live action.

### Past/resolved cases
- Default: hidden from feed (or collapsed at bottom behind "Show past")
- Still exist in data for clustering accuracy
- Accessible via filter toggle
- Deterministic decay moves them here automatically — no user action needed

---

## 4. Case Mood Detection (Awards, Achievements, Milestones)

### Problem
Currently the pipeline has zero sentiment awareness. Urgency is action-focused only (IMMINENT, THIS_WEEK, etc.). A child's award ceremony and a plumbing emergency get the same visual treatment. Positive events deserve celebration, not just task management.

### New field: `Case.mood`
```prisma
// Add to Case model
mood  String  @default("NEUTRAL")  // CELEBRATORY, POSITIVE, NEUTRAL, URGENT, NEGATIVE
```

### Synthesis prompt addition
In the synthesis system prompt (after urgency instructions), add:

```
MOOD ASSESSMENT:
Assess the emotional tone of this case based on its emails:
- "CELEBRATORY" — awards, honors, achievements, milestones, graduations, recognitions,
  winning, accomplishments. These are moments to celebrate.
- "POSITIVE" — good news, confirmations, successful completions, thank-you messages.
  Pleasant but not milestone-level.
- "NEUTRAL" — standard logistics, scheduling, routine updates. Most cases are this.
- "URGENT" — problems requiring immediate attention, emergencies, escalations, complaints.
- "NEGATIVE" — bad news, cancellations, denials, disputes, failures.

Examples of CELEBRATORY detection:
- "St Agnes Academic Awards Ceremony" → CELEBRATORY
- "Congratulations! [child] selected for All-Star team" → CELEBRATORY
- "End of season banquet and trophy presentation" → CELEBRATORY
- "Your child has been nominated for Student of the Month" → CELEBRATORY
```

### Zod schema addition
```ts
// synthesis-parser.ts — add to synthesisResultSchema
mood: z.enum(["CELEBRATORY", "POSITIVE", "NEUTRAL", "URGENT", "NEGATIVE"]).default("NEUTRAL"),
```

### UX treatment by mood

| Mood | Card border | Emoji hint | Extra visual |
|------|------------|------------|-------------|
| CELEBRATORY | Gold/yellow left border | 🏆🎉🥇⭐ (AI picks) | Subtle sparkle/confetti accent, "Congrats!" badge |
| POSITIVE | Green left border | AI picks | Checkmark accent |
| NEUTRAL | Default gray | AI picks | None |
| URGENT | Red left border | ⚠️ or AI picks | Pulse animation |
| NEGATIVE | Orange left border | AI picks | Warning icon |

### Where it flows
1. **Synthesis** assigns `mood` (AI already has full email context — zero extra API calls)
2. **Case model** stores `mood` as a string field
3. **Feed API** returns `mood` with case data
4. **Case card component** reads `mood` and applies visual treatment
5. **Deterministic decay** doesn't change mood — it's set at synthesis and only updates on re-synthesis

### Emoji interaction with mood
The existing emoji field stays as topic-identifier (⚽, 🏠, 📋). Mood is orthogonal — a soccer case could be CELEBRATORY (trophy ceremony) or NEUTRAL (practice schedule). The card shows both: topic emoji + mood visual treatment.

---

## 5. Case Card Design

### Emoji assignment
Already in plan (Fix 5): AI assigns topic emoji at synthesis time.
Store as `Case.emoji: String?` (1-2 chars).

### Visual separation
- Cards with clear borders/shadows, generous padding
- Left border color driven by **mood first, urgency second**:
  - CELEBRATORY → gold border (overrides urgency color)
  - URGENT mood → red border
  - Otherwise: urgency-based (red=imminent, amber=this-week, green=upcoming, gray=past)
- Unread dot
- Event time prominently displayed for time-sensitive cases
- Celebratory cards get sparkle/confetti accent + "🏆" badge

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
- Pricing: $10/month, 7-day free trial, cancel anytime
- CTA: "Start Free Trial" → `/onboarding`

### Onboarding (`/onboarding`)

**Step 1: What are you tracking?**
- "What topics from your email do you want to get organized?"
 - Subheadline: "Pick one area of your life that generates too much email. You'll add more topics later."
- Clickable interview categories  (e.g., "Kids Activities", "Work Projects", "Investments", "Something Else")

**Step 2: Add the specific {Step 1 selected category} topics**
- You wanted to organize Kids Activities, first enter the kids activities we will organize
- text field input for Activities, like "Soccer", "Dance", "School Name", "Guitar Lessons"
- text field, same some of the people who email you about these activities, like coaches and teacher names
- Below their input: animated fake case cards appear using their words
- Minimal UI — just a text input and animated preview
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
- "Here are your first cases with actions. As more emails each day, we will organize those automatically."

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

### Fix 1: Add today's date to Extraction prompt (HIGH) — ✅ COMPLETE
**Commit:** d844bd6 (2026-03-24). `TODAY'S DATE: ${today}` in system prompt. Service passes today at extraction.ts line 176.

### Fix 2: Add today's date to Case Splitting prompt (MEDIUM) — ✅ COMPLETE
**Commit:** d844bd6 (2026-03-24). `today` param added to CaseSplittingInput. Service passes today at cluster.ts line 644.

### Fix 3: Add Zod validation to Discovery Intelligence (MEDIUM) — ✅ COMPLETE
**Commit:** d844bd6 (2026-03-24). Parser created at `packages/ai/src/parsers/discovery-intelligence-parser.ts`. Used at discovery.ts line 305.

### Fix 4: Pass real frequency tables to Calibration (HIGH) — ✅ COMPLETE
**Commit:** d844bd6 (2026-03-24). cluster.ts lines 1125-1188 compute real word frequency tables from case emails with case assignment info, top 20 per entity.

### Fix 5: Add emoji to synthesis output — ✅ COMPLETE
**Commit:** d844bd6 (2026-03-24). `Case.emoji` field added to schema. Synthesis prompt requests emoji. Parser validates with Zod.

### Fix 6: Add mood detection to synthesis output — ✅ COMPLETE
**Commit:** 5d7c720 (2026-03-30). `Case.mood` field added to schema with `@default("NEUTRAL")`. Synthesis prompt includes MOOD ASSESSMENT section with 5 levels.

---

## 17. Revised Implementation Phases

### Phase 0: AI Pipeline Fixes (Before UX work) — ✅ COMPLETE
- ✅ Fix 1: Today's date in extraction prompt
- ✅ Fix 2: Today's date in case-splitting prompt
- ✅ Fix 3: Zod parser for discovery intelligence
- ✅ Fix 4: Real frequency tables in calibration
- ✅ Fix 5: Emoji in synthesis output
- ✅ Fix 6: Mood detection in synthesis output
- ⚠️ Fix A: Time-neutral language directive in synthesis prompt — PARTIAL (today's date provided, but no explicit "don't use relative time" rule)
- ⚠️ Fix B: Time-neutral language in extraction summaries — PARTIAL (same issue)
- ✅ Fix C: Action descriptions must use absolute dates — ISO 8601 enforced in synthesis prompt
- ⚠️ Fix E: Broaden post-synthesis expiry check — PARTIAL (only checks EVENT actions, misses DEADLINE/PAYMENT)
- ✅ **Schema:** `emoji` + `mood` fields on Case pushed to DB
- **Remaining work:** Fix A full directive, Fix B full directive, Fix E broadened filter

### Phase 1: Performance + Foundation (Week 1-2)
- Parallel queries + loading.tsx skeletons (from perf plan)
- Smart root redirect (proxy.ts)
- New route structure (/feed, /welcome, /settings/*)
- Unified case feed API (cross-schema query)
- Bottom nav component
- **Deterministic status decay (3 layers):**
  - `computeCaseDecay()` pure function in `@denim/engine/actions/lifecycle.ts`
  - Unit tests with fixture data (Monday scan → Friday event → next Monday = RESOLVED)
  - Daily Inngest cron job (`dailyStatusDecay`) persists changes at 6 AM
  - Read-time freshness in feed API (compute on load, don't wait for cron)
  - Urgency tiers recalculate automatically (IMMINENT → THIS_WEEK → UPCOMING → NO_ACTION)

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

## 18. Temporal Staleness Audit — Fixes

### The Core Problem
AI synthesis runs once and its output (titles, summaries, action descriptions, urgency) is displayed indefinitely. Text written on Day 1 with phrases like "this week", "waiting for approval", "upcoming Friday" becomes misleading by Day 8. Nine vectors identified.

### Fix A: Time-Neutral Language Directive in Synthesis Prompt (HIGH)
**File:** `packages/ai/src/prompts/synthesis.ts`

Add to system prompt:
```
TIME-NEUTRAL LANGUAGE RULE:
Your output will be displayed for days or weeks after generation. Do NOT use relative
time references that will become stale. Use absolute dates instead.

WRONG: "Meeting tomorrow", "due this Friday", "recently received", "coming up soon"
RIGHT: "Meeting on Thu Mar 27", "due Fri Mar 28", "received on Mar 20", "scheduled for Apr 3"

For summary.end (current status): Write in a way that ages well.
WRONG: "Waiting for approval" (implies it's still pending — may be resolved by the time user reads)
RIGHT: "Approval pending as of Mar 20" (reader knows when this was true)
WRONG: "In final stages of review"
RIGHT: "Under review since Mar 18; decision expected by Mar 25"
```

This is the highest-leverage fix — one prompt change affects all future synthesis output.

### Fix B: Time-Neutral Language in Extraction Summaries (HIGH)
**File:** `packages/ai/src/prompts/extraction.ts`

Email summaries are stored permanently. Add similar directive:
```
Write summaries using absolute dates, not relative time references.
WRONG: "Meeting scheduled for next Friday"
RIGHT: "Meeting scheduled for Fri Mar 28"
```

### Fix C: Action Descriptions Must Use Absolute Dates (MEDIUM)
**File:** `packages/ai/src/prompts/synthesis.ts` (action extraction section)

Action titles and descriptions like "Register by Friday" age poorly. Add:
```
Action titles and descriptions must use absolute dates.
WRONG: "Register by Friday"
RIGHT: "Register by Fri Mar 28"
WRONG: "Respond to email about tomorrow's meeting"
RIGHT: "Respond to email about Mar 27 meeting"
```

### Fix D: Freshness Indicator in UI (MEDIUM)
**Files:** `case-card.tsx`, `case-detail.tsx`, `case-summary.tsx`

Show when content was last synthesized:
- On case detail: "Last updated Mar 20" (from `case.synthesizedAt`)
- If synthesizedAt > 7 days ago: "⚠️ Summary may be outdated" subtle indicator
- Optional "Refresh" button that triggers re-synthesis of that single case

### Fix E: DEADLINE Actions Must Also Expire (HIGH)
**File:** `apps/web/src/lib/services/synthesis.ts` (lines 385-399)

The existing post-synthesis check ONLY expires EVENT actions. DEADLINE and PAYMENT actions with past dates are missed.

Fix: The `computeCaseDecay()` function from the deterministic decay plan already handles ALL action types by checking `dueDate` and `eventStartTime`. But the synthesis-time check should also be broadened:
```ts
// Currently: only checks actionType === 'EVENT'
// Fix: check ALL actions with dates
const actionsWithDates = caseData.actions.filter(a =>
  a.status === 'PENDING' && (a.dueDate || a.eventStartTime)
);
```

### Fix F: summary.end Should Include Synthesis Date Context (LOW)
**File:** `packages/ai/src/prompts/synthesis.ts`

Change the summary.end instruction from:
"Current status, next steps, or resolution"
To:
"Status as of TODAY'S DATE. Include the date context so readers know when this assessment was made. Example: 'As of Mar 20: awaiting signed permission slip; game registration closes Mar 28.'"

### Fix G: Staleness-Aware Feed Sorting (MEDIUM)

Cases with very old `synthesizedAt` and still-OPEN status may need attention. In the feed:
- Cases not re-synthesized in 14+ days with OPEN status → subtle "needs refresh" indicator
- Don't auto-re-synthesize (costs money) — let user trigger it
- Or: trigger re-synthesis if new email arrives in the case (already works via feedback events)

### Fix H: Recurring Event Re-evaluation (LOW)
**File:** synthesis prompt

The prompt says "Identify the NEXT upcoming event date as the primary action item" for recurring events. But after that event passes, no one creates the NEXT next event.

Options:
- For recurring cases, the daily cron could detect "all events passed but case is recurring" and mark it for re-synthesis
- Or: teach synthesis to create multiple future actions for recurring events (next 3 occurrences)
- Defer to Phase 5 — this is a nice-to-have

### Summary of Temporal Fixes

| Fix | Priority | Where | What | Status |
|-----|----------|-------|------|--------|
| A | HIGH | Synthesis prompt | Time-neutral language directive (absolute dates, no "this week") | ⚠️ PARTIAL — today's date provided but no explicit directive |
| B | HIGH | Extraction prompt | Same for email summaries | ⚠️ PARTIAL — same issue |
| C | MEDIUM | Synthesis prompt | Action titles/descriptions use absolute dates | ✅ COMPLETE — ISO 8601 enforced |
| D | MEDIUM | UI components | Freshness indicator + "last updated" display | Not started |
| E | HIGH | Synthesis service | DEADLINE/PAYMENT actions also expire (not just EVENT) | ⚠️ PARTIAL — only EVENT checked |
| F | LOW | Synthesis prompt | summary.end includes "as of [date]" context | Not started |
| G | MEDIUM | Feed API/UI | Staleness-aware indicators for old un-refreshed cases | Not started |
| H | LOW | Synthesis/cron | Recurring events need re-evaluation after all dates pass | Not started |

### When to Implement
- **Phase 0** (with AI audit fixes): ✅ Fix C done. ⚠️ Fixes A, B, E still need completion.
- **Phase 1** (with foundation): Fix D — freshness indicator is simple UI. **Also: deterministic status decay (computeCaseDecay + daily cron).**
- **Phase 2** (with case feed UX): Fix G — staleness-aware sorting/indicators
- **Phase 5** (polish): Fixes F, H — lower priority refinements

---

## Next Steps

1. **Immediate:** Implement Phase 0 (AI audit fixes) — no design dependency
2. **Parallel:** User designs key screens in Stitch → `docs/designs/`
3. **Then:** Phase 1 (performance + routing foundation) — no design dependency
4. **Design-dependent:** Phases 2-3 wait for Stitch designs
5. **Ongoing:** Iterate: Stitch → export → Claude Code implements → preview → feedback
