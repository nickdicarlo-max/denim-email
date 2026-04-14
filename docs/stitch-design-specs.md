# Denim — Stitch Design Specs

## Product Overview
**Denim** organizes your email into actionable cases. You tell it what you care about (kids activities, properties, work projects), connect Gmail, and it groups related emails into cases with titles, summaries, and action items. Think of it as an automated to-do list that reads your inbox for you.

**Target user:** Busy people whose email is a stream of obligations: parents managing kids' activities, property managers, agency project leads, lawyers. They don't want to read every email. They want to know what needs attention.

**Platform:** Mobile-first web app (375-428px primary). Also used in a Chrome sidebar (400px) and scales to tablet/laptop.

**Terminology:**
- "Topic" = a category the user tracks (e.g., "Kids Activities", "Property Management")
- "Case" = a group of related emails with a title, summary, and action items
- "Note" = a user-created to-do item

---

## Design Direction (Strategic)

**Personality:** Calm, warm, organized. The feeling of opening a clean notebook, not a cluttered dashboard. Even when showing urgent items, the UI should feel in control, not alarming.

**Visual variability:** Minimal. This app has one primary accent color for interactive elements. Urgency/mood is conveyed through a single visual signal per case (a colored left border on cards). The rest of the UI is neutral.

**Hierarchy principle:** Every screen has ONE thing the eye should land on first. On the feed, it's the top case card. On case detail, it's the title. On onboarding screens, it's the headline. Secondary information (metadata, counts, dates) should be clearly subordinate.

**Information density:** Cards should be scannable in 2-3 seconds. Five lines of content maximum per card. If the user has to read carefully to understand a card, it has too much on it.

**Color usage:**
- One accent color for all interactive elements (buttons, links, selected states, chips)
- Urgency communicated through a narrow left border on cards only (4 levels: urgent/red, this-week/amber, upcoming/green, inactive/gray). A fifth state, celebratory/gold, overrides urgency for positive milestones.
- Status and mood should NOT use text badges or labels. Color alone communicates.
- The rest of the UI should be neutral tones.

**Typography:** Two weights (a bold for titles/names and a regular for everything else). Two size scales (larger for titles, smaller for everything else). No more than that. The simpler the type system, the calmer the app feels.

**Navigation:** Bottom nav with 3 items on all authenticated screens (Feed, + Note, Settings). Persistent, simple, always visible.

---

## Bottom Navigation

Three items, evenly spaced, persistent on every authenticated screen:

| Label | Purpose |
|-------|---------|
| Feed | Primary screen. Shows all cases. Highlighted when active. |
| + Note | Create a personal to-do |
| Settings | Topic management, account |

---

# PART 1: ONBOARDING

**Route:** `/onboarding`

**5 steps, then redirect to feed.**

**Progress indicator at top of each screen.** Subtle, showing current step.

**No payment or pricing anywhere in onboarding.** Trial starts silently at Gmail connect.

---

### Screen O1: Pick a Category

**Purpose:** Single most important input. One tap configures the entire AI pipeline.

**Headline:** "What do you want to organize?"

**Subheadline:** "Pick one area. You'll add more topics later."

**Content:** 6 tappable cards, full width, stacked vertically:

| Emoji | Label | Description |
|-------|-------|-------------|
| 👦 | Kids Activities | Sports, school, lessons, clubs |
| 🏠 | Property Management | Rentals, HOA, maintenance |
| 💼 | Work Projects | Clients, deliverables, deadlines |
| 🔨 | Construction / Renovation | Jobs, subs, permits, inspections |
| ⚖️ | Legal | Cases, filings, hearings |
| ✨ | Something Else | I'll describe it |

**Interaction:** Tap to select (card highlights), tap "Continue" to advance.

**"Something Else":** When selected, a text input appears below: "Describe what you track in a sentence."

**Hierarchy:** The category cards are the star. Headline and subheadline are secondary. This should feel like choosing a personality, not filling out a form.

---

### Screen O2: Name Your Things + People

**Purpose:** Collect the specific names the system will search for in email.

**Context badge at top:** Shows selected category with emoji (tappable to go back).

**Headline:** "Name the things you track"

**Subheadline:** Varies by category:
- Kids Activities: "What activities, schools, or clubs fill your inbox?"
- Property: "What properties or addresses do you manage?"
- Work: "What clients or projects generate the most email?"

**Section 1: Things (required)**
- Text input with domain-aware placeholder (e.g., "Soccer, Dance, Vail Mountain School")
- Enter/Return adds as a chip. Each chip has an X to remove.
- Chips should be visually prominent (accent color background)
- Minimum 1 required to proceed

**Section 2: People (optional)**
- Label: "Who emails you about these?"
- Subtext: "Optional. Just a few names to help us find the rest."
- Same text input + chip pattern
- Chips should be visually distinct from Things chips (different tone, still within palette)
- 0 entries is fine

**Bottom:** "Continue" button, disabled until at least 1 Thing added.

**Hierarchy:** The text input and chips are primary. The people section is clearly secondary/optional. No preview animations, no fake content.

---

### Screen O3: Connect Gmail

**Purpose:** OAuth connection. Highest-friction moment. Trust signals are critical.

**Headline:** "Connect your Gmail"

**Subheadline:** "We'll scan for emails matching what you entered. Read-only access only."

**Primary button:** "Connect Gmail" (largest, most prominent element on screen)

**Trust signals below button (3 items, each with icon + one line of text):**
- "Read-only access. We never send, delete, or modify email."
- "Your data is encrypted and never shared."
- "We only look at emails matching your topics."

**Hierarchy:** The button dominates. Trust signals are secondary but must be readable without effort. No pricing, no credit card, no commitment language.

---

### Screen O4: Scanning Your Inbox

**Purpose:** Hold attention for 30-90 seconds while the pipeline runs. Build confidence by showing real discoveries.

**Headline:** "Scanning your inbox"

**Subheadline:** Updates as pipeline progresses ("Finding emails..." > "Reading content..." > "Grouping into cases..." > "Creating summaries...")

**Content, top to bottom:**
- Progress bar (animates from 0 to 100%)
- Counter: "Found [N] relevant emails" (updates live, prominent)
- Discovered senders: names appear one by one with subtle animation ("→ Ziad Allan via TeamSnap", "→ Oak Park Soccer League")
- Subject patterns: chips appearing with common subjects ("Spring Tournament", "Practice Schedule")
- Bottom: "This usually takes about a minute"

**No skip button.** Auto-transitions to next screen when scan completes.

**Hierarchy:** The counter and progress bar are primary. The streaming discoveries are the engagement hook. Everything else is background.

---

### Screen O5: Review What We Found

**Purpose:** Lightweight confirmation, not configuration. AI has pre-grouped aliases. User confirms or corrects.

**Headline:** "Here's what we found"

**Subheadline:** "Confirm what looks right. Tap to change."

**Section 1: Your topics with auto-grouped items**
For each Thing the user entered, a card showing:
- Thing name (bold)
- Auto-detected aliases indented below, each showing:
  - Name + email count (e.g., "ZSA U11/12 Girls — 4 emails")
  - Brief reason in muted text ("Emails from coach Ziad Allan")
  - "Not right? Separate" link
- Things with no detected aliases show: "No additional items found"

Separated items move out of the group visually. "Re-merge" link appears to undo.

**Section 2: New discoveries**
Items found that don't match any existing Thing. Each card shows:
- Name + email count
- Three buttons: "Add" (standalone), "Add to..." (shows picker of existing Things), "Not now" (save for later)
- After selection, shows confirmation text + "undo" link

**Section 3: Topic name**
- Label: "Name this topic:"
- Text input pre-filled with auto-generated name (e.g., "Kids Activities"), editable

**Bottom CTA:** "Show me my cases!" (large, primary button)

**Hierarchy:** Section 1 (your grouped items) is most important. Section 2 (discoveries) is secondary. Topic name is tertiary. The CTA should feel like a reward after a short review.

**Drag-and-drop also supported:** Users can drag discoveries onto Thing cards to merge. Buttons are the mobile-friendly alternative.

---

# PART 2: RETURNING USER EXPERIENCE

---

### Screen R1: Case Feed (`/feed`)

**Purpose:** THE primary screen. Every returning user lands here. Must be scannable in 3 seconds.

**Route:** `/feed`. Smart redirect from `/` for authenticated users.

**Layout, top to bottom:**

**Header (sticky):**
- Left: "Denim" wordmark
- Right: User avatar/initial (tappable to account)

**Filter bar (horizontally scrollable):**
- "All" chip (default selected, filled/bold)
- Topic chips with emoji: "👦 Kids Activities", "🏠 Property Mgmt"
- When a topic is selected, entity sub-chips appear below: "Soccer (24)", "Dance (12)"
- Selected chip is filled accent color. Unselected is outlined/muted.

**Case cards grouped by urgency tier:**
Each tier has a label + horizontal line + count, then cards below:
1. **"Focus Now"** — urgent color label. Cases needing immediate attention.
2. **"This Week"** — amber-toned label. Cases with actions in the next 7 days.
3. **"Upcoming"** — green-toned label. Actions more than 7 days out.
4. **Past/resolved** — collapsed by default behind "Show past cases" toggle.

Cards within each tier sorted by most recent email date.

**Empty states (3 variants):**
- Scan processing: "Your cases are being prepared..." with loading indicator
- All caught up: "🎉 All caught up! Nothing needs your attention."
- No topics: "Welcome to Denim. Set up your first topic to get started." + CTA button

**Bottom nav.**

**Hierarchy:** Cards are everything. Filter bar and tier labels are navigation aids, not content. The first card in "Focus Now" should be the visual anchor of the entire screen.

---

### Screen R2: Case Card (component)

**The atomic unit of the entire product. Used in the feed. Must be scannable in 2 seconds.**

**Exactly 5 lines of content. No more.**

**Line 1: Entity + indicators**
- Left: emoji + entity name (bold, largest text on card)
- Property domain only: append unit number in muted text if available (e.g., "1205 Summit · 2B")
- Right: mood indicator (trophy emoji for celebrations, exclamation for urgent) + unread dot (small accent circle if case hasn't been opened)

**Line 2: Case title**
- Second-largest text. One line, truncated if needed.

**Line 3: Context line (domain-aware, one line, muted text)**
- This line changes based on the topic category:
  - Property cases: vendor name + cost + deadline (e.g., "Comfort Air · $2.8k · Thu Apr 3")
  - Kids/School cases: event date + time range + location (e.g., "Sat Apr 5 10 AM - 12 PM · Oak Park Field 3")
  - If no event: due date + cost if present (e.g., "Due Fri Apr 4 · $150")
  - Only show fields that have values. Skip nulls gracefully.

**Line 4: Top action item**
- Checkbox + action text
- If 2+ reminder emails sent about this action, show a count indicator (e.g., "· 3x")
- If more than 1 pending action total, show "+[N] more" link below

**Line 5: Date range (right-aligned, smallest text)**
- Start date + days active (e.g., "Mar 15 – 16d active")

**Left border:** 4px colored border on left edge. Color indicates:
1. Gold = celebratory mood (overrides urgency)
2. Red = urgent mood or imminent urgency
3. Amber = this week
4. Green = upcoming
5. Gray = no action / resolved

**Interaction:** Tap card body > case detail. Tap checkbox > mark action done.

---

### Screen R3: Case Detail (`/feed/[caseId]`)

**Purpose:** Full depth view. All information about one case.

**Navigation:** Full page push. Sticky "← Back" header returns to feed.

**Sections, top to bottom:**

**1. Case header**
- Emoji + Entity name (+ unit for property). Bold, large.
- Case title. Headline size.
- Mood indicator if celebratory or urgent
- Status pill: "Active", "In Progress", or "Needs Attention" (color matches urgency)
- Attribution: "via [primary counterparty name]" if available
- Date range: "Mar 15 – Mar 28 · Updated Mar 28"
- Staleness warning if summary is 7+ days old: "⚠️ May be outdated · Refresh"

**2. Three-part summary**
- Card with three labeled sections. Labels vary by topic category:
  - Kids Activities: "What" / "Details" / "Action Needed"
  - Property: "Issue" / "Activity" / "Status"
  - Legal: "Matter" / "Proceedings" / "Status"
- Each section: label in small uppercase, content in regular body text. 1-3 sentences each.

**3. Key details (dynamic, varies by topic category)**
- Grid of 2-3 data points, shown only when values exist:
  - Property: Amount, Unit, Vendor, Deadline
  - Kids Activities: Event Date, Amount
  - Legal: Deadline, Filing Date
  - Construction: Amount, Deadline, Percent Complete
- Each: small uppercase label + large bold value
- Skip entirely if no values populated

**4. Tags**
- 2-3 small pills in accent color

**5. Action items (full list)**
- Each action: checkbox + title + optional description below
- Action type indicated by small icon (calendar for events, dollar for payments, checkbox for tasks, clock for deadlines, reply arrow for responses)
- Low-confidence actions (AI less sure) should be visually muted or marked with "?"
- Recurring actions show a repeat icon
- Location shown as tappable link
- Calendar status: "On your calendar ✓" or "Add to calendar" link
- Reminder count if 2+: "3 reminders sent"
- Completed/expired actions at bottom, visually dimmed with strikethrough

**6. Related emails**
- List of emails newest first. Each row:
  - Reply indicator (↩️) if it's a reply
  - Sender name (bold) + date (right-aligned)
  - Attachment indicator (📎 with count) if attachments exist
  - Subject line (muted)
  - Tappable to expand: shows AI summary + tag chips

**7. Feedback**
- "Is this case accurate?"
- If previously rated: shows the previous rating with date
- If not rated: two buttons (thumbs up, thumbs down)
- Thumbs down expands: correction options ("Move an email", "Email doesn't belong", "Merge with another case") + free text area
- If the system detected a likely alternative case: "💡 Some emails might belong in: [other case title]"

**Hierarchy:** Title and summary are primary. Key details and actions are secondary. Emails and feedback are tertiary (below the fold for most users).

---

### Screen R4: Loading Skeleton

**Shown instantly while feed data loads.**
- Real header (already rendered)
- Placeholder filter chips (pulsing/shimmer)
- 3-4 card-shaped skeletons matching exact card dimensions
- Neutral left border on skeletons

---

# PART 3: MINIMAL SETTINGS

Utility screens. Functional, not polished. Needed so testers can add a second topic and manage existing ones.

---

### Screen S1: Settings Hub (`/settings`)

**List of tappable rows:**

| Icon | Title | Subtitle |
|------|-------|----------|
| 📋 | My Topics | Manage what Denim tracks |
| ➕ | Add a Topic | Set up a new category |
| 👤 | Account | Email, sign out |

Simple menu list. Each row navigates to its destination.

---

### Screen S2: Topic List (`/settings/topics`)

**List of topic cards, one per topic the user has set up:**

Each card shows:
- Topic emoji + name
- Stats line: "[N] entities · [N] cases · [N] emails"
- "Active since [date]"
- Edit button + Delete button

**Saved-for-later prompt:** If discoveries were deferred during onboarding (user tapped "Not now"), show a prompt card at the top:
- "💡 We found some things during your last scan that might deserve their own topic: [names]"
- "Set up a new topic" button
