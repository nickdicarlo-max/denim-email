# Denim — Screen Design Briefs for Stitch

**Purpose:** Complete screen-by-screen design brief for the Denim UX redesign. Each screen is numbered, titled, and described with enough detail to design in Stitch by Google. Work through these sequentially — earlier screens establish patterns reused in later ones.

**Primary target:** Mobile web (375-428px wide). Every screen should also work at 400px (Chrome sidebar) and scale up to tablet (768px) and laptop (1280px).

**Product name:** Denim
**Terminology:** "Topic" (not Schema/Channel), "Case" (a group of related emails), "Note" (user-created to-do)

**Bottom nav (persistent on all authenticated screens):**
```
+--------------------------------------+
|   Feed        + Note       Settings  |
+--------------------------------------+
```

---

## PUBLIC SCREENS

---

### Screen 01: Landing Page (`/welcome`)

**Who sees this:** Anyone not signed in. First impression of the product.

**Purpose:** Explain Denim's value, set expectations, convert to trial signup.

**Content sections (top to bottom):**

1. **Hero**
   - Headline: "Your email, organized into action"
   - Subheadline: "Denim reads your inbox, finds what matters, and turns it into a clear to-do list. No more digging through threads."
   - Primary CTA button: "Start Free Trial" -> `/onboarding`
   - Secondary link: "See how it works" (scrolls to demo section)

2. **Animated demo**
   - Visual showing emails flowing in from the left, being sorted into case cards on the right
   - Example case cards should show realistic data:
     - "Soccer — Spring Tournament Registration" (IMMINENT, gold celebratory border)
     - "Rental Property 1205 Summit — Maintenance Request, $250" (THIS_WEEK, amber border)
     - "Work — Q2 Planning Offsite" (UPCOMING, green border)
   - Cards should show the visual hierarchy: emoji + entity, title, date, location, action items

3. **How it works (3 steps)**
   - Step 1: "Tell us what you track" — icon of category cards + text input
   - Step 2: "Connect your Gmail" — icon of Gmail + shield (read-only, secure)
   - Step 3: "See your cases" — icon of organized case cards with action items

4. **Feature highlights (3-4 cards)**
   - "Smart organization" — AI groups your emails into actionable cases
   - "Nothing to miss" — Deadlines, events, and payments surfaced automatically
   - "Gets smarter" — The more you use it, the better it understands your email
   - "Your data is safe" — Read-only Gmail access, no email content stored

5. **Pricing**
   - Single plan: "$10/month"
   - "7-day free trial. Cancel anytime."
   - "Credit card required to start trial. You won't be charged for 7 days."
   - CTA button: "Start Free Trial" -> `/onboarding`

6. **Footer**
   - Links: Privacy Policy, Terms, Contact

**States:**
- Default (unauthenticated visitor)
- Returning visitor (consider "Welcome back" + sign-in prompt if cookie exists)

**Design notes:**
- Mobile: single column, hero fills viewport, scroll to reveal sections
- The animated demo is the most important visual — it should instantly convey what Denim does
- Pricing should be visible without excessive scrolling

---

### Screen 02: Sign In (`/sign-in`)

**Who sees this:** Returning users who aren't authenticated.

**Purpose:** Quick sign-in via Google OAuth (same account as Gmail connection).

**Content:**
- Denim logo
- "Welcome back"
- "Sign in with Google" button (primary, large)
- Small text: "We'll use the same Google account you connected during setup"
- Link: "New here? Start free trial" -> `/onboarding`

**Design notes:**
- Minimal — just the sign-in button centered on screen
- No email/password form (Google OAuth only)

---

## ONBOARDING SCREENS

**Flow overview:** Category -> Names + People -> Goals -> Subscribe & Connect -> Scanning -> Review -> First Feed

These 7 steps populate the complete schema: CaseSchema, Entity, EntityGroup, SchemaTag, ExtractedFieldDef, ExclusionRule, and all downstream pipeline tables. Each step is intentionally minimal — the system infers the rest from AI + email scan.

**Schema population during onboarding:**

| Step | Populates |
|------|-----------|
| Category (Screen 03) | CaseSchema.domain, .clusteringConfig, .summaryLabels, .secondaryEntityConfig, SchemaTag rows, ExtractedFieldDef rows |
| Names + People (Screen 04) | Entity rows (PRIMARY + SECONDARY), EntityGroup rows, CaseSchema.discoveryQueries, .primaryEntityConfig, .name |
| Goals (Screen 05) | ExtractedFieldDef.showOnCard, CaseSchema extraction/synthesis prompt emphasis |
| Subscribe & Connect (Screen 06) | User.stripeCustomerId, .subscriptionStatus, .googleTokens |
| Scanning (Screen 07) | ScanJob, Email, ExclusionRule (auto-detected), Entity (auto-discovered) |
| Review (Screen 08) | Entity.isActive toggles, SchemaTag.isActive toggles, new Entity/SchemaTag rows, CaseSchema.status -> ONBOARDING |

---

### Screen 03: Onboarding Step 1 — Pick a Category (`/onboarding`)

**Who sees this:** New users who clicked "Start Free Trial".

**Purpose:** Select the domain/role that drives the entire AI configuration. This single tap generates the tag taxonomy, summary labels, clustering config, secondary entity types, and extracted field definitions.

**Layout:**
- Progress indicator: Step 1 of 6 (subtle, top)
- Headline: "What do you want to organize?"
- Subheadline: "Pick one area of your life that generates too much email. You'll add more topics later."

**Category cards (tappable, one per row or 2-col grid):**

| Category | Emoji | Maps to domain | Example subheadline |
|----------|-------|-----------------|---------------------|
| Kids Activities | "Sports, school, lessons, clubs" | `school_parent` | Tags: Schedule, Payment, Permission, Game |
| Property Management | "Rentals, HOA, maintenance" | `property` | Tags: Maintenance, Tenant, Vendor, Financial |
| Work Projects | "Clients, deliverables, deadlines" | `agency` | Tags: Deliverable, Feedback, Meeting, Budget |
| Construction / Renovation | "Jobs, subs, permits, inspections" | `construction` | Tags: RFI, Change Order, Submittal, Permits |
| Legal | "Cases, filings, hearings" | `legal` | Tags: Filing, Discovery, Motion, Hearing |
| Something Else | "I'll describe it" | `general` | Free-text description field appears |

**"Something Else" behavior:**
- Shows a text input: "Describe what you track in a sentence"
- AI infers the best domain mapping + generates custom tags
- Example: "I manage a restaurant" -> generates restaurant-appropriate tags

**States:**
- Default: category cards displayed
- Selected: card highlights, transitions to Screen 04
- "Something Else" selected: text input slides in below

**Design notes:**
- This should feel like picking a personality, not filling out a form
- Each card should have an emoji, title, and 1-line description
- The subheadline "You'll add more topics later" reduces commitment anxiety
- One tap, maximum leverage — this is the highest-value input in the system

---

### Screen 04: Onboarding Step 2 — Name Your Topics + People (`/onboarding`)

**Who sees this:** After picking a category.

**Purpose:** Collect the primary entities (WHATs) and secondary entities (WHOs). These are the names the system searches for in email.

**Layout:**
- Progress indicator: Step 2 of 6
- Context badge showing category: "Kids Activities" (tappable to go back)
- Headline: "Name the specific things you track"
- Subheadline varies by category:
  - Kids Activities: "What activities, schools, or clubs fill your inbox?"
  - Property: "What properties or addresses do you manage?"
  - Work Projects: "What clients or projects generate the most email?"

**Section 1: Things (WHATs) — Primary Entities**
- Large text input with category-appropriate placeholder:
  - Kids Activities: "e.g., SocHcer, Dance, Vail Mountain School"
  - Property: "e.g., 1205 Summit Ave, Oak Park HOA"
  - Work Projects: "e.g., Acme Corp, Q2 Campaign"
- Enter/Return adds as a chip (blue chips)
- "Add another" link below chips
- Minimum 1 required to proceed

**Animated preview (below input):**
- As the user types, animated fake case cards appear using their words
- If user types "Soccer": a card appears -> "Soccer — Practice Schedule"
- If user types "1205 Summit": a card appears -> "1205 Summit — Maintenance Request"
- Cards animate in with subtle slide-up + fade
- This creates an immediate "aha moment" — they see the output before connecting email

**Section 2: People (WHOs) — Secondary Entities**
- Headline: "Who sends you email about these?"
- Subheadline: "Name a few people or organizations. Just a few to help us find the rest."
- Text input with placeholder:
  - Kids Activities: "e.g., Coach Williams, Principal Johnson"
  - Property: "e.g., ABC Plumbing, tenant Mike Chen"
- Amber chips for each entry
- This section is clearly optional ("Skip" is fine)

**Bottom:**
- "Continue" button (enabled after at least 1 WHAT entity)
- "Skip people for now" small link

**Schema effect:**
- Each WHAT -> Entity row (type=PRIMARY, autoDetected=false, confidence=1.0)
- Each WHO -> Entity row (type=SECONDARY, autoDetected=false, confidence=1.0)
- WHATs and WHOs entered together -> EntityGroup (pairing for associatedPrimaryIds)
- AI generates: Entity.aliases, CaseSchema.discoveryQueries, CaseSchema.primaryEntityConfig

**Design notes:**
- The animated preview cards are the key engagement hook — they should feel magical
- Combining WHATs + WHOs on one screen reduces step count while keeping the inputs distinct
- Input should support Enter key to add (not submit the form)
- Mobile keyboard should be visible and not cover the preview animation

---

### Screen 05: Onboarding Step 3 — What Matters Most? (`/onboarding`)

**Who sees this:** After naming entities and people.

**Purpose:** Optional goal selection that tunes what data gets surfaced on case cards. The domain already set sensible defaults — goals override/emphasize specific fields.

**Layout:**
- Progress indicator: Step 3 of 6
- Headline: "What matters most to you?"
- Subheadline: "We'll highlight these on your cases. Pick any that apply."

**Goal pills (multi-select, tappable):**

| Goal | Icon | Schema effect |
|------|------|---------------|
| Deadlines & due dates | Calendar icon | ExtractedFieldDef "deadline": showOnCard=true; extraction prompt emphasis |
| Costs & payments | Dollar icon | ExtractedFieldDef "cost": showOnCard=true; PAYMENT actions weighted higher |
| Action items & to-dos | Checkbox icon | CaseSchema.summaryLabels.end -> "Action Needed"; action extraction prioritized |
| Schedules & events | Clock icon | ExtractedFieldDef "eventDate": showOnCard=true |

**Pre-selected based on category:**
- Kids Activities: "Action items" + "Schedules" pre-selected
- Property: "Costs" + "Deadlines" pre-selected
- Work Projects: "Deadlines" + "Action items" pre-selected
- Construction: "Costs" + "Deadlines" pre-selected
- Legal: "Deadlines" + "Action items" pre-selected

**Bottom:**
- "Continue" button (works with 0 selections — defaults apply)
- "These look right" shortcut if pre-selections are acceptable

**Design notes:**
- This feels like a preference screen, not a required form
- Pre-selections reduce effort — most users will just confirm defaults
- 4 pills max — this should take 2 seconds
- Skip entirely if the user just hits Continue without changing anything

---

### Screen 06: Onboarding Step 4 — Subscribe & Connect (`/onboarding`)

**Who sees this:** After goals.

**Purpose:** Collect payment (via Stripe) and connect Gmail (via Google OAuth). Two sequential actions on one conceptual step.

**Layout:**
- Progress indicator: Step 4 of 6
- Headline: "Start your free trial"
- Key info block (card-style):
  - "$10/month after 7-day free trial"
  - "Cancel anytime — no commitment"
  - "Credit card required to start"
  - "You won't be charged until [concrete date 7 days from now]"
- Primary CTA: "Start Trial & Connect Gmail" (large button)
- Below button: "What happens next: We'll set up your payment, then connect to your Gmail (read-only access) to start finding your cases."

**Flow after button click:**
1. Redirect to Stripe Checkout (hosted page — we don't design this)
2. Stripe success -> redirect to Gmail OAuth consent screen (Google-hosted)
3. Gmail success -> redirect to Screen 07 (Scanning)

**Trust signals:**
- Lock icon + "Secure payment via Stripe"
- Shield icon + "Read-only Gmail access — we never send, delete, or modify your email"
- "Your data is encrypted and never shared"

**States:**
- Default: pricing and CTA
- Error: if Stripe or Gmail OAuth fails, return with "Something went wrong. Let's try again." + retry button

**Schema effect:**
- Stripe success -> User.stripeCustomerId, .subscriptionStatus="trialing", .trialEndDate
- Gmail success -> User.googleTokens (encrypted)

**Design notes:**
- Highest-friction screen — trust signals are critical
- Make the 7-day trial date concrete (show actual date like "Apr 6, 2026")
- The two-step nature (Stripe -> Gmail) should feel like one smooth action

---

### Screen 07: Onboarding Step 5 — Scanning Your Inbox (`/onboarding/scanning`)

**Who sees this:** Immediately after Gmail OAuth completes.

**Purpose:** Show real-time scanning progress while the pipeline runs (30-90 seconds). This is NOT a passive loading screen — it builds trust by showing real discoveries.

**Layout:**
- Progress indicator: Step 5 of 6
- Headline: "Scanning your inbox..."
- Animated scanner visual (progress bar, pulsing circle, or inbox icon with emails flying out)

**Real-time data feed (updates as scan progresses):**
- Counter: "Found 47 relevant emails" (increments live)
- Sender names appearing: "Discovered: Coach Williams, Oak Park League, Sports Authority"
- Subject samples scrolling: "Spring Tournament, Practice Schedule, Registration Form"
- Each line animates in as data arrives

**Bottom:**
- "This usually takes about a minute"
- No "skip" — they need the scan to complete

**States:**
- Scanning: animated, data streaming in via SSE/polling from ScanJob
- Complete: auto-transitions to Screen 08 with "Done! Let's review."

**Pipeline activity during this screen:**
- ScanJob created (status: RUNNING, phase: DISCOVERING -> EXTRACTING -> CLUSTERING -> SYNTHESIZING)
- Discovery: Gmail search using hypothesis queries
- Extraction: per-email via Gemini Flash (summary, tags, entities, relevance)
- Coarse clustering: gravity model groups emails
- Case splitting: AI refines clusters into cases
- Synthesis: AI generates titles, summaries, actions, urgency, emoji, mood

**Schema populated:**
- Email rows (with summary, tags, extractedData, routingDecision)
- Entity rows (autoDetected=true from scan discoveries)
- ExclusionRule rows (auto-detected noise patterns)
- Case rows (with title, summary, actions, urgency, emoji, mood)
- CaseEmail junction rows
- CaseAction rows
- ExtractionCost rows (pipeline cost tracking)
- PipelineIntelligence rows (AI reasoning audit)

**Design notes:**
- Showing real data creates trust — "it actually found things in my email"
- Don't show email bodies or sensitive content — just sender names and subject lines
- The animation should be engaging enough to hold attention for 30-90 seconds
- Show "emails scanned" vs "relevant emails found" to convey filtering

---

### Screen 08: Onboarding Step 6 — Review & Configure (`/onboarding/review`)

**Who sees this:** After scanning completes.

**Purpose:** Let the user review what was discovered, merge related items, save extras for later, and configure the Topic. This is the most complex onboarding screen — it finalizes the system configuration.

**Layout:**
- Progress indicator: Step 6 of 6
- Headline: "Here's what we found"
- Subheadline: "Review your setup. Drag items together to merge them, or drag extras to 'Save for Later.'"

**Section 1: Discovered entities grouped by user input**
Each WHAT from Screen 04 becomes a group:

```
  "Soccer" (what they entered)
    Confirmed: "Oak Park Soccer League" (12 emails)
    Discovered: "Spring Tournament Committee" (4 emails)
    Discovered: "Referee Association" (2 emails)

  "1205 Summit" (what they entered)
    Confirmed: "Oak Park HOA" (8 emails)
    Discovered: "ABC Plumbing" (3 emails)
```

**Section 2: Extra discoveries**
Items found that don't match any user input:
- "We also found these — drag them to a group above, or save them for later:"
  - "Martial Arts Academy" (5 emails)
  - "School Parent Association" (7 emails)

**Section 3: Save for Later box**
- Drop zone at bottom: "Save for Later"
- Subtext: "These will help you set up another Topic when you're ready"
- Items dragged here are visually distinct (grayed, "saved" badge)

**Merge interaction:**
- Drag an item onto another item or group to merge
- Visual feedback: target highlights, "drop to merge" tooltip
- On mobile: tap-to-select then "Move to..." as drag alternative

**Section 4: Tags (expandable, collapsed by default)**
- "Tags we'll use to organize:" followed by tag chips
- User can remove (X) or add new ones
- "Edit tags" link to expand

**Section 5: People (expandable, collapsed by default)**
- "People we'll look for:" followed by name chips
- Same add/remove pattern

**Section 6: Topic name**
- "Name this Topic:" with auto-suggested name (e.g., "Kids Activities")
- Editable text input

**Bottom:**
- "Looks good — show me my cases!" (primary CTA)

**Schema effect on finalize:**
- Entity.isActive toggles for disabled items
- New Entity/SchemaTag rows for user additions
- SchemaTag.isActive toggles for removed tags
- CaseSchema.name from topic name field
- CaseSchema.interviewResponses (all raw answers preserved)
- CaseSchema.extractionPrompt (generated from active tags + entities + fields)
- CaseSchema.synthesisPrompt (generated from summary labels + domain)
- CaseSchema.status -> ONBOARDING (triggers full pipeline run)

**Design notes:**
- This is the most critical screen for system accuracy
- "Merging" = "these are the same thing" — language must be crystal clear
- Drag-and-drop must work on mobile (touch drag + tap-to-select fallback)
- Show email counts next to each item — conveys credibility
- Saved-for-later items seed Topic 2 creation (Screen 21)

---

### Screen 09: First Feed — Newly Onboarded State (`/feed`)

**Who sees this:** Immediately after completing onboarding (first time on the feed).

**Purpose:** Introduce the feed with context. This is the same feed screen (Screen 10) but with first-run overlays.

**Overlay/tooltip elements (shown once, sequential, dismissible):**
1. Tooltip on first case card: "These are your cases — each one groups related emails into one view"
2. Tooltip on urgency indicator: "Red means something needs attention soon"
3. Tooltip on bottom nav "+ Note": "Add your own to-dos and reminders here"
4. Tooltip on bottom nav "Settings": "Manage your Topics, add new ones, and adjust settings"
5. Banner at top: "Welcome to Denim! Here are your first cases. As more email arrives, we'll get smarter."

**Design notes:**
- Tooltips appear one at a time, "Next" to advance, X to dismiss all
- Don't block the screen — let users see real data behind overlays
- After dismissal, never show again (stored in user preferences)
- If scan is still processing: show partial results + "Still finding cases..." indicator

---

## CORE APP SCREENS

---

### Screen 10: Case Feed — Primary Screen (`/feed`)

**Who sees this:** Every returning user, every time they open the app. THE primary screen.

**Purpose:** Show all cases across all Topics, sorted by urgency. Must be scannable in 2-3 seconds.

**Layout (top to bottom):**

1. **Header bar**
   - Denim logo (small, left)
   - User avatar (right, taps to account/settings)

2. **Filter bar (horizontally scrollable)**
   - "All" chip (selected by default)
   - Topic chips, color-coded with emoji: "Kids Activities", "Property", "Work"
   - When a topic is selected, entity sub-chips appear below: "Soccer", "Dance", "Lanier"
   - Selected state: filled/bold. Unselected: outlined/muted.

3. **Focus Now section (if 1-3 cases qualify)**
   - Cases with IMMINENT urgency or URGENT mood
   - Slightly larger cards or distinct glow/highlight
   - Separated from rest by subtle divider
   - Section only appears if qualifying cases exist

4. **Case card list (scrollable)**
   - Sorted: Focus Now -> This Week -> Upcoming -> No Action
   - Each card = Screen 11 component
   - Notes (from Screen 15) appear inline, visually distinct
   - Generous vertical spacing between cards
   - Infinite scroll or "Load more"

5. **Past/Resolved section (collapsed by default)**
   - "Show past cases" toggle at bottom of active cases
   - When expanded: dimmed cards for resolved/expired cases
   - These cases had their status/urgency updated by deterministic decay

6. **Bottom nav bar**
   - Feed (highlighted/active), + Note, Settings (gear)

**Feed data source:**
```
GET /api/feed
- All cases for all user schemas
- Filter: urgency != IRRELEVANT, status != RESOLVED (by default)
- Include: schema (name, domain), entity (name), pending actions (top 2)
- Order: lastEmailDate desc (with urgency-tier grouping)
- Read-time freshness: computeCaseDecay() applied on load
```

**States:**
- Loading: skeleton cards (Screen 13)
- Populated: mixed urgency cases with mood-colored borders
- Filtered: showing one Topic or Entity
- All caught up: <5 cases, encouraging message (Screen 12)
- Empty: no cases (Screen 12)

**Design notes:**
- This screen must be FAST — skeleton appears instantly, data streams in
- Cards must be scannable: emoji + entity + date readable at a glance
- Urgency conveyed by left border color, not text labels
- Mobile: single column, full-width cards
- Tablet: 2-column grid
- Laptop: 2-3 column grid with side nav instead of bottom nav

---

### Screen 11: Case Card Component (used in feed)

**Not a standalone screen — the atomic card component used in Screen 10.**

**Card anatomy:**

```
+-- [left border: mood/urgency color] ---------------------+
|                                                          |
|  [emoji] [Entity name]                [mood badge]       |
|  [Case title]                         [unread dot]       |
|                                                          |
|  [calendar icon] Thu Mar 27, 3:30 PM                     |
|  [pin icon] Oak Park Field                [maps link]    |
|                                                          |
|  Registration open. Forms due by Fri Mar 28.             |
|                                                          |
|  [ ] Register by Fri Mar 28                              |
|  [ ] Pay $150 tournament fee                             |
|                                                          |
|  Last updated: Mar 20                                    |
+----------------------------------------------------------+
```

**Visual elements:**
- **Left border** (4px): Color indicates mood first, urgency second
  - Gold: CELEBRATORY (overrides urgency)
  - Red: IMMINENT urgency or URGENT mood
  - Amber: THIS_WEEK
  - Green: UPCOMING or POSITIVE mood
  - Gray: NO_ACTION, resolved, or NEUTRAL past
- **Topic emoji + Entity name** (top left, bold, largest): "Soccer"
- **Mood badge** (top right, only for CELEBRATORY/URGENT):
  - CELEBRATORY: trophy/sparkle icon
  - URGENT: alert icon
- **Unread dot** (small, only if Case.viewedAt is null)
- **Case title** (second line, medium weight)
- **When** (calendar icon): clean readable date
  - If IMMINENT: highlighted/bold, "Tomorrow!" or relative label
  - If past: dimmed, "Past" label
- **Where** (pin icon): location text, tappable -> Google Maps
  - Only shown if CaseAction.eventLocation exists
- **Summary** (1-2 lines, muted): Case.summary.end content
- **Action items** (checkboxes, up to 2):
  - From CaseAction where status=PENDING, ordered by dueDate
  - Each shows: checkbox + title with absolute date
  - If >2: "+N more" link
- **Freshness** (bottom, smallest, muted): "Last updated: [synthesizedAt]"
  - If >7 days: "May be outdated" warning

**Card data mapping to schema:**

| UI Element | Schema Source |
|------------|-------------|
| Emoji | Case.emoji |
| Entity name | Entity.name (via Case.entityId) |
| Mood badge | Case.mood |
| Left border color | Case.mood + Case.urgency |
| Case title | Case.title |
| Unread dot | Case.viewedAt (null = unread) |
| Date/time | CaseAction.eventStartTime or .dueDate (nearest pending) |
| Location | CaseAction.eventLocation (nearest pending with location) |
| Summary | Case.summary.end |
| Action checkboxes | CaseAction (status=PENDING, top 2 by dueDate) |
| Freshness | Case.synthesizedAt |
| Topic chip | CaseSchema.name + CaseSchema.domain |

**Interaction:**
- Tap card -> navigate to Screen 14 (Case Detail)
- Tap checkbox -> mark CaseAction as DONE (inline, creates FeedbackEvent)
- Tap map link -> open Google Maps in new tab
- Long press -> future: quick actions menu

**Note card variant (for UserNote items in the feed):**
- "pencil" prefix instead of topic emoji
- Lighter/dashed border
- Title + due date + body preview
- Checkbox to mark as done

---

### Screen 12: Feed Empty States

**Shown when the feed has no (or very few) cases.**

**State A: Zero cases, scan still processing**
- Illustration of a tidy inbox
- "Your cases are being prepared..."
- "We're still processing your emails. Check back in a minute."
- Subtle loading animation

**State B: Zero active cases, all resolved/past**
- Illustration of relaxation
- Random encouraging message:
  - "All caught up! Go enjoy your day."
  - "Your inbox is working for you now."
  - "Nothing needs your attention. That's a win."
- "Show past cases" link

**State C: Fewer than 5 active cases**
- Normal cards shown
- Below last card: "Looking good — only [N] things need attention"

---

### Screen 13: Feed Loading Skeleton

**Shown instantly while data loads.**

- Same layout as Screen 10 with pulsing placeholder shapes
- Header bar: real (already rendered from layout)
- Filter bar: placeholder chips
- 3-4 card skeletons matching exact card dimensions (no layout shift):
  - Pulsing rectangle for emoji + entity
  - Pulsing rectangle for title
  - Shorter rectangle for date
  - Two short lines for summary
  - Neutral gray left border

---

### Screen 14: Case Detail (`/feed/[caseId]`)

**Who sees this:** User tapped a case card from the feed.

**Purpose:** Full detail view — all emails, all actions, summary, correction controls.

**Navigation:** Full page push from feed. Back arrow returns to feed.

**Layout (top to bottom):**

1. **Header**
   - Back arrow + "Back to Feed"

2. **Case header**
   - Topic emoji + Entity name (large)
   - Case title (headline size)
   - Mood badge if CELEBRATORY/URGENT
   - Status pill: "Active" (OPEN/IN_PROGRESS) / "Resolved" / "Past Due"
   - "Last updated [synthesizedAt]" (small, muted)
   - If stale (>7 days): "This summary may be outdated" + "Refresh" button

3. **Summary section**
   - Three-part summary with dynamic labels from CaseSchema.summaryLabels:
     - **[summaryLabels.beginning]:** Case.summary.beginning
     - **[summaryLabels.middle]:** Case.summary.middle
     - **[summaryLabels.end]:** Case.summary.end (with "as of [date]" context)
   - Example for school_parent: "What / Details / Action Needed"
   - Example for property: "Issue / Activity / Status"

4. **Key details (if ExtractedFieldDef.showOnCard fields have values)**
   - Clean grid/list of aggregated data from Case.aggregatedData:
     - "Amount: $150" (from ExtractedFieldDef type=NUMBER, format=currency)
     - "Deadline: Fri Mar 28" (from ExtractedFieldDef type=DATE)
     - "Location: Oak Park Field" (tappable -> Maps)
   - Only shown if Case.aggregatedData has non-null values

5. **Actions section**
   - Header: "To Do" or "Action Items"
   - Full list of CaseActions (not just top 2):
     - [ ] "Register by Fri Mar 28" — EVENT
     - [ ] "Pay $150 tournament fee" — PAYMENT
     - [ ] "Send medical form to coach" — TASK
   - Each action shows:
     - Checkbox (tap to mark DONE -> creates FeedbackEvent)
     - Title with absolute date (from CaseAction.title)
     - Type icon: calendar (EVENT), dollar (PAYMENT), clipboard (TASK), clock (DEADLINE), reply (RESPONSE)
     - "Add to Calendar" button for EVENT/DEADLINE types
     - Calendar status: "On your calendar" or "Not on calendar — Add?"
     - If CaseAction.amount: show amount inline
   - Completed/expired actions at bottom, dimmed, strikethrough

6. **Emails section**
   - Header: "Related Emails ([count])"
   - List of emails in case (newest first), from CaseEmail -> Email:
     - Sender name + date: "Coach Williams — Mar 18"
     - Subject line (Email.subject)
     - 1-line summary excerpt (Email.summary)
     - Tags as small chips (Email.tags)
   - Tap -> expand to full summary (accordion)
   - "Show more" if >10 emails

7. **Feedback section**
   - Header: "Is this case accurate?"
   - Thumbs up / Thumbs down buttons
   - If thumbs down: expand correction options:
     - "Move an email to a different case" -> email picker -> case picker
     - "This email doesn't belong here" -> email picker -> marks Email.isExcluded
     - "Merge this case with another" -> case picker
   - Free text: "Tell us how to improve" (placeholder)
   - Feedback -> FeedbackEvent rows (append-only)

**Schema fields displayed:**

| UI Element | Schema Source |
|------------|-------------|
| Summary labels | CaseSchema.summaryLabels |
| Summary content | Case.summary (JSON: beginning, middle, end) |
| Key details | Case.aggregatedData + ExtractedFieldDef definitions |
| Actions | CaseAction rows (caseId, ordered by dueDate) |
| Calendar status | CaseAction.calendarSynced, .calendarEventId |
| Emails | Email rows (via CaseEmail junction) |
| Primary actor | Case.primaryActor (JSON: name, entityType) |
| Tags | Case.displayTags |
| Staleness | Case.synthesizedAt |

**States:**
- Default: all sections shown
- Stale (synthesizedAt > 7 days): warning banner + refresh button
- Refreshing: spinner on summary while re-synthesis runs
- After feedback: "Thanks! We'll use this to improve."

---

### Screen 15: Create Note (`/note/new`)

**Who sees this:** User tapped "+ Note" in bottom nav.

**Purpose:** Create a personal to-do that appears in the feed alongside cases.

**Layout:**
- Header: "New Note" + close (X) button
- **Title field** (large): placeholder "What do you need to do?"
- **Body field** (expandable textarea): placeholder "Add details (optional)"
- **Due date** (optional): date picker
- **Link to Topic** (optional): dropdown of user's Topics, or "None"
- **Add to Calendar** toggle (shown if due date is set)
- Primary CTA: "Save Note"

**After save:** Brief "Note saved!" -> navigate to feed where note appears

**Note card in feed:**
- Visually distinct from case cards (lighter/dashed border, "pencil" marker)
- Title + due date + body preview
- Checkbox to mark done (inline)

**Schema:** UserNote (userId, title, body, dueDate, schemaId?, status, calendarEventId?)

---

## SETTINGS SCREENS

---

### Screen 16: Settings Hub (`/settings`)

**Who sees this:** User tapped gear icon in bottom nav.

**Layout — list of tappable menu rows:**

| Icon | Title | Subtitle | Route |
|------|-------|----------|-------|
| List | My Topics | Manage what Denim tracks | /settings/topics |
| Plus | Add a Topic | Set up a new category | /settings/topics/new |
| Bell | Notifications | Digest, alerts, preferences | /settings/notifications |
| Card | Subscription | Plan, billing, trial status | /settings/subscription |
| Person | Account | Email, sign out, delete | /settings/account |

---

### Screen 17: Topic List (`/settings/topics`)

**Who sees this:** From Settings -> My Topics.

**Purpose:** Overview of all Topics with stats. Entry point to edit or view dashboard.

**Per-topic card:**
```
+---------------------------------------+
|  [emoji] [Topic Name]                 |
|                                       |
|  Emails: 142   Cases: 7   Open: 3    |
|                                       |
|  [Edit]              [Dashboard]      |
+---------------------------------------+
```

**Data source:** CaseSchema.emailCount, CaseSchema.caseCount, COUNT(CaseAction WHERE status=PENDING)

**States:**
- No topics: "You haven't set up any Topics yet." + CTA
- One+ topics: scrollable card list

---

### Screen 18: Topic Editor (`/settings/topics/[id]`)

**Who sees this:** From Topic List -> Edit.

**Purpose:** Add/remove the data that configures how a Topic works.

**Layout:**
- Header: "Edit [CaseSchema.name]" + back arrow
- Editable topic name field
- Tappable topic emoji

**Collapsible sections:**

1. **Things You Track (Primary Entities)**
   - Chips: Entity rows where type=PRIMARY, schemaId=this
   - "+" to add new Entity row
   - "X" to remove (confirmation: "Removing Soccer will orphan 3 cases. Continue?")
   - Adding -> triggers re-scan to find matching emails

2. **People & Organizations (Secondary Entities)**
   - Chips: Entity rows where type=SECONDARY
   - "Auto-discovered" badge on autoDetected=true entities
   - "+" to add, "X" to remove

3. **Tags**
   - Chips: SchemaTag rows where isActive=true
   - "+" to add (creates SchemaTag, aiGenerated=false)
   - "X" to remove (sets SchemaTag.isActive=false)

4. **Extracted Fields**
   - List: ExtractedFieldDef rows with name + type
   - "+" to add (field name + type selector)
   - "X" to remove

5. **Danger Zone**
   - "Delete this Topic" (red, outline) -> Screen 23

---

### Screen 19: Topic Dashboard (`/settings/topics/[id]/dashboard`)

**Who sees this:** From Topic List -> Dashboard.

**Purpose:** Show the value Denim provides. Stats, trends, quality metrics.

**Stat cards (2x2 grid):**

| Stat | Source | Icon |
|------|--------|------|
| Emails Scanned | CaseSchema.emailCount | mail |
| Active Cases | CaseSchema.caseCount | folder |
| Open Actions | COUNT(CaseAction WHERE schemaId AND status=PENDING) | checkbox |
| Corrections Made | COUNT(FeedbackEvent WHERE schemaId) | pencil |

**Accuracy trend:**
- Line chart: QualitySnapshot.accuracy over 30-day window
- Current accuracy prominently displayed
- Shows the "breaking-in curve" improvement over time

**Feedback section:**
- "How can we improve?"
- Free text input -> stored as FeedbackEvent (type=TEXT_FEEDBACK)
- Past feedback shown below

---

### Screen 20: Notification Preferences (`/settings/notifications`)

**Toggle rows:**

| Setting | Default | Schema field |
|---------|---------|-------------|
| Daily Email Digest | ON | NotificationPreference.emailDigest |
| Delivery time | 8:00 AM | NotificationPreference.emailDigestTime |
| Urgent SMS Alerts | OFF | NotificationPreference.smsUrgent |
| Phone number | (hidden until SMS on) | NotificationPreference.phoneNumber |
| Push Notifications | OFF | NotificationPreference.pushEnabled |

**Digest includes (when digest ON):**
- Checkboxes: New cases, Upcoming deadlines (48h), Actions due today, Weekly correction summary

---

### Screen 21: Subscription Management (`/settings/subscription`)

**Status card:**
```
+---------------------------------------+
|  Denim Pro                            |
|  $5/month                             |
|                                       |
|  Status: [User.subscriptionStatus]    |
|  Next billing: [date]                 |
|  Payment: Visa ending 4242            |
|                                       |
|  [Manage Billing ->]                  |
|  (Opens Stripe Customer Portal)       |
+---------------------------------------+
```

**Trial variant:**
```
+---------------------------------------+
|  Free Trial                           |
|  [days] remaining                     |
|                                       |
|  Trial ends: [User.trialEndDate]      |
|  You'll be charged $5/month after     |
|                                       |
|  [Manage Billing ->]                  |
+---------------------------------------+
```

---

### Screen 22: Account (`/settings/account`)

**Who sees this:** From Settings -> Account.

**Layout:**
- Header: "Account" + back arrow
- **Email:** User.email (read-only, from Google)
- **Display name:** User.displayName (editable)
- **Timezone:** User.timezone (dropdown, affects digest delivery + urgency calculations)
- **Connected accounts:**
  - Google: "[email] — Connected" with "Disconnect" option
  - Shows gmail.readonly scope
  - If calendar connected: shows calendar.events scope
- **Sign Out** button
- **Delete Account** (red, at bottom)
  - Confirmation: "This permanently deletes all your Topics, cases, and data. Cannot be undone."
  - Triggers: cascade delete of all CaseSchema + children, User.deletedAt set

---

### Screen 23: Add New Topic (`/settings/topics/new`)

**Who sees this:** From Settings -> Add a Topic.

**Purpose:** Start a new Topic. Two paths depending on whether save-for-later items exist from Screen 08.

**Path A: Quick-add (save-for-later items exist)**
- "We saved some things from your last scan:"
- Pre-populated entity chips from Screen 08 save-for-later
- User can add/remove items
- "Name this Topic:" field
- "Create Topic" -> triggers scan for these entities
- Skips category selection (inherits from original scan context)

**Path B: Full interview (no saved items)**
- Same as Screens 03-05 flow, minus subscribe/connect (already done)
- Category -> Names + People -> Goals -> Scan -> Review
- Headline: "What else do you want to organize?"

---

## OVERLAY / MODAL SCREENS

---

### Screen 24: Delete Topic Confirmation (modal)

- Warning icon
- "Delete [Topic Name]?"
- "This will permanently delete [N] cases, [N] actions, and all associated data. Cannot be undone."
- Buttons: "Cancel" (secondary), "Delete Topic" (destructive red)

### Screen 25: Calendar Add Confirmation (toast)

- "Added to your Google Calendar"
- Event details: "Spring Tournament — Thu Mar 27, 3:30 PM"
- "View in Calendar" link

### Screen 26: Error States (patterns)

**A: Network error**
- "Something went wrong. Check your connection and try again." + Retry

**B: Gmail token expired**
- "We need to reconnect to your Gmail" + Reconnect button -> OAuth

**C: Scan/pipeline error**
- "We hit a snag processing your emails. We'll retry automatically."

**D: Not found (404)**
- "This case doesn't exist or was deleted." + "Back to Feed"

**E: Subscription expired**
- "Your trial has ended. Subscribe to keep using Denim."
- CTA: "Subscribe — $5/month"
- Shows feed in read-only/blurred state behind modal

---

## SPECIAL SCREENS

---

### Screen 27: Daily Digest Email (email client, not app screen)

**Purpose:** Morning summary email with deep links back into the app.

```
Subject: Denim Daily — 3 items need attention

Good morning! Here's your Denim briefing.

FOCUS NOW
---------
[emoji] Spring Tournament Registration
   Thu Mar 27, 3:30 PM at Oak Park Field
   [ ] Register by today (Fri Mar 28)
   [View Case ->]

THIS WEEK
---------
[emoji] 1205 Summit — Lease Renewal
   [ ] Sign and return by Wed Apr 2
   [View Case ->]

[emoji] Work — Q2 Planning Offsite
   Mon Mar 31, 9:00 AM
   [View Case ->]

NEW SINCE YESTERDAY
-------------------
+2 new emails in "Soccer"
+1 new case: "Dance Recital Costumes"

---
Manage notifications: [Settings ->]
```

**Design notes:**
- Must work in Gmail, Apple Mail, Outlook (table-based layout)
- Deep links open directly to case in app
- Scannable in 15 seconds

---

### Screen 28: PWA Install Prompt (banner)

- Custom banner at top of feed (not browser default)
- "Add Denim to your home screen for instant access"
- "Install" button + "Not now" dismiss

---

### Screen 29: Chrome Extension Sidebar

- Identical to mobile feed (Screen 10) at 400px width
- No bottom nav — top nav or hamburger menu instead
- Same cards, filters, interactions
- Tap case -> opens detail in sidebar
- "Open in full app" link for complex actions

---

## SCHEMA POPULATION MATRIX

Every Prisma model must be populated by at least one screen or pipeline stage. This matrix verifies complete coverage.

| Model | Created By | Displayed On | Edited By |
|-------|-----------|-------------|-----------|
| User | Screen 02 (Sign In) / Screen 06 (OAuth) | Screen 22 (Account) | Screen 22 (Account) |
| CaseSchema | Screens 03-08 (Onboarding) | Screen 17 (Topic List) | Screen 18 (Topic Editor) |
| SchemaTag | Screen 03 (AI-generated from domain) | Screen 08 (Review), Screen 18 (Editor) | Screen 08, Screen 18 |
| ExtractedFieldDef | Screen 03 (domain defaults) + Screen 05 (Goals) | Screen 14 (Case Detail key details) | Screen 18 (Topic Editor) |
| Entity | Screen 04 (user input) + Screen 07 (scan discovery) | Screens 08, 10, 14, 18 | Screen 08 (Review), Screen 18 (Editor) |
| EntityGroup | Screen 04 (pairing WHATs + WHOs) | Screen 08 (grouped display) | Screen 08 (merge interaction) |
| Email | Pipeline (Screen 07 scanning) | Screen 14 (Case Detail email list) | Screen 14 (Feedback: exclude) |
| EmailAttachment | Pipeline (extraction) | Screen 14 (future: attachment list) | — |
| Case | Pipeline (clustering + synthesis) | Screens 10, 11, 14 | Screen 14 (Feedback: merge/split) |
| CaseEmail | Pipeline (clustering) | Screen 14 (email list) | Screen 14 (Feedback: move email) |
| CaseAction | Pipeline (synthesis) | Screens 11, 14 | Screen 14 (mark done), Screen 25 (calendar) |
| Cluster | Pipeline (clustering) | — (internal audit trail) | — |
| FeedbackEvent | Screen 14 (thumbs, move, exclude, merge) | Screen 19 (Dashboard activity) | — (append-only) |
| QualitySnapshot | Pipeline (daily cron) | Screen 19 (Dashboard accuracy chart) | — (computed) |
| ExclusionRule | Pipeline (auto from 3+ excludes) | — (future: Topic Editor) | — |
| ScanJob | Screen 07 (onboarding scan) / cron | Screen 07 (progress display) | — |
| ExtractionCost | Pipeline (per API call) | Screen 19 (Dashboard, future cost display) | — (append-only) |
| PipelineIntelligence | Pipeline (AI reasoning) | — (internal debug) | — |
| UserNote (NEW) | Screen 15 (Create Note) | Screen 10 (Feed, as note cards) | Screen 15 (edit), Feed (mark done) |
| NotificationPreference (NEW) | Screen 20 (first save) | Screen 20 | Screen 20 |

---

## SCREEN CHECKLIST

| # | Screen | Route | Priority | Phase |
|---|--------|-------|----------|-------|
| 01 | Landing Page | /welcome | HIGH | 3 |
| 02 | Sign In | /sign-in | MEDIUM | 1 |
| 03 | Onboarding: Category | /onboarding | HIGH | 3 |
| 04 | Onboarding: Names + People | /onboarding | HIGH | 3 |
| 05 | Onboarding: Goals | /onboarding | HIGH | 3 |
| 06 | Onboarding: Subscribe & Connect | /onboarding | HIGH | 3 |
| 07 | Onboarding: Scanning | /onboarding/scanning | HIGH | 3 |
| 08 | Onboarding: Review | /onboarding/review | HIGH | 3 |
| 09 | First Feed (tooltips) | /feed | MEDIUM | 3 |
| 10 | Case Feed | /feed | **CRITICAL** | 2 |
| 11 | Case Card Component | (component) | **CRITICAL** | 2 |
| 12 | Feed Empty States | /feed | MEDIUM | 2 |
| 13 | Feed Loading Skeleton | /feed | MEDIUM | 1 |
| 14 | Case Detail | /feed/[caseId] | **CRITICAL** | 2 |
| 15 | Create Note | /note/new | MEDIUM | 4 |
| 16 | Settings Hub | /settings | MEDIUM | 4 |
| 17 | Topic List | /settings/topics | MEDIUM | 4 |
| 18 | Topic Editor | /settings/topics/[id] | MEDIUM | 4 |
| 19 | Topic Dashboard | /settings/topics/[id]/dashboard | LOW | 4 |
| 20 | Notification Preferences | /settings/notifications | LOW | 4 |
| 21 | Subscription | /settings/subscription | LOW | 4 |
| 22 | Account | /settings/account | MEDIUM | 4 |
| 23 | Add New Topic | /settings/topics/new | MEDIUM | 4 |
| 24 | Delete Confirmation | (modal) | LOW | 4 |
| 25 | Calendar Confirmation | (toast) | LOW | 5 |
| 26 | Error States | (various) | MEDIUM | 2 |
| 27 | Daily Digest Email | (email) | LOW | 5 |
| 28 | PWA Install Prompt | (banner) | LOW | 5 |
| 29 | Chrome Sidebar | (extension) | LOW | 6 |

---

## SUGGESTED DESIGN ORDER

Start with screens that establish the design system, then build outward:

1. **Screen 11: Case Card** — The atomic unit. Colors, typography, spacing, borders all start here.
2. **Screen 10: Case Feed** — Compose cards into the primary screen. Layout, nav, filters.
3. **Screen 14: Case Detail** — Deepest view. Tests typography hierarchy and section spacing.
4. **Screen 13: Loading Skeleton** — Quick win, establishes skeleton pattern.
5. **Screen 01: Landing Page** — Sets marketing tone. Can be designed independently.
6. **Screens 03-09: Onboarding** — Sequential flow, design as connected series.
7. **Screens 16-23: Settings** — Utility screens, straightforward patterns.
8. **Screens 24-29: Overlays & special** — Polish, last priority.

---

## NEW SCHEMA MODELS NEEDED

The following models are referenced in these briefs but not yet in `prisma/schema.prisma`:

**UserNote** (Screen 15):
```
model UserNote {
  id, userId, schemaId?, title, body?, dueDate?, status (OPEN/DONE/DISMISSED),
  calendarEventId?, calendarSynced, createdAt, updatedAt
}
```

**NotificationPreference** (Screen 20):
```
model NotificationPreference {
  id, userId (unique), emailDigest, emailDigestTime, smsUrgent,
  phoneNumber?, pushEnabled, updatedAt
}
```

**User model additions** (Screens 06, 21, 22):
```
stripeCustomerId    String?  @unique
subscriptionStatus  String   @default("trialing")  // trialing, active, canceled, past_due
subscriptionEndDate DateTime?
trialEndDate        DateTime?
```
