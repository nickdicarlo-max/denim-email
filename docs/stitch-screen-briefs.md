# Denim — Screen Design Briefs for Stitch

**Purpose:** Complete screen-by-screen design brief for the Denim UX redesign. Each screen is numbered, titled, and described with enough detail to design in Stitch by Google. Work through these sequentially — earlier screens establish patterns reused in later ones.

**Primary target:** Mobile web (375-428px wide). Every screen should also work at 400px (Chrome sidebar) and scale up to tablet (768px) and laptop (1280px).

**Product name:** Denim
**Terminology:** "Topic" (not Schema/Channel), "Case" (a group of related emails), "Note" (user-created to-do)

**Bottom nav (persistent on all authenticated screens):**
```
┌──────────────────────────────────┐
│   Feed        + Note       ⚙️   │
└──────────────────────────────────┘
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
   - Primary CTA button: "Start Free Trial" → `/onboarding`
   - Secondary link: "See how it works" (scrolls to demo section)

2. **Animated demo**
   - Visual showing emails flowing in from the left, being sorted into case cards on the right
   - Example case cards should show realistic data:
     - "⚽ Soccer — Spring Tournament Registration" (IMMINENT, gold celebratory border)
     - "🏠 Rental Property 1205 Summit — Maintenance Request, $250" (THIS_WEEK, amber border)
     - "📋 Work — Q2 Planning Offsite" (UPCOMING, green border)
   - Cards should show the visual hierarchy: emoji + entity, title, date, location, action items

3. **How it works (3 steps)**
   - Step 1: "Tell us what you track" — icon of text input with entity names
   - Step 2: "Connect your Gmail" — icon of Gmail + shield (read-only, secure)
   - Step 3: "See your cases" — icon of organized case cards with action items

4. **Feature highlights (3-4 cards)**
   - "Smart organization" — AI groups your emails into actionable cases
   - "Nothing to miss" — Deadlines, events, and payments surfaced automatically
   - "Gets smarter" — The more you use it, the better it understands your email
   - "Your data is safe" — Read-only Gmail access, no email content stored

5. **Pricing**
   - Single plan: "$5/month"
   - "7-day free trial. Cancel anytime."
   - "Credit card required to start trial. You won't be charged for 7 days."
   - CTA button: "Start Free Trial" → `/onboarding`

6. **Footer**
   - Links: Privacy Policy, Terms, Contact
   - "Made with care in [city]"

**States:**
- Default (unauthenticated visitor)
- Returning visitor (consider "Welcome back" + sign-in prompt if cookie exists)

**Design notes:**
- Mobile: single column, hero fills viewport, scroll to reveal sections
- The animated demo is the most important visual — it should instantly convey what Denim does
- Pricing should be visible without excessive scrolling — don't bury it

---

### Screen 02: Sign In (`/sign-in`)

**Who sees this:** Returning users who aren't authenticated.

**Purpose:** Quick sign-in via Google OAuth (same account as Gmail connection).

**Content:**
- Denim logo
- "Welcome back"
- "Sign in with Google" button (primary, large)
- Small text: "We'll use the same Google account you connected during setup"
- Link: "New here? Start free trial" → `/onboarding`

**Design notes:**
- Minimal — just the sign-in button centered on screen
- No email/password form (Google OAuth only)

---

## ONBOARDING SCREENS

---

### Screen 03: Onboarding Step 1 — What Are You Tracking? (`/onboarding`)

**Who sees this:** New users who clicked "Start Free Trial"

**Purpose:** Collect the primary entities (WHATs) the user wants to organize. This is the most important onboarding input — it defines their first Topic.

**Layout:**
- Progress indicator: Step 1 of 5 (subtle, top of screen)
- Headline: "What do you want to organize?"
- Subheadline: "Name the things you get email about. Activities, properties, projects — whatever fills your inbox."
- **Text input field** — large, prominent, with placeholder: "e.g., Soccer, Dance, 1501 Sylvan Ave"
- Each entry appears as a chip/tag below the input (removable with X)
- "Add another" subtle link below chips

**Animated preview (below input):**
- As the user types, animated fake case cards appear below using their words
- If user types "Soccer": a card appears → "⚽ Soccer — Practice Schedule"
- If user types "1501 Sylvan": a card appears → "🏠 1501 Sylvan — Maintenance Request"
- Cards animate in with a subtle slide-up + fade
- This creates an immediate "aha moment" — they see the output before connecting their inbox

**Bottom:**
- "Continue" button (enabled after at least 1 entity entered)
- "Skip for now" small link (takes them to a generic setup)

**States:**
- Empty: just the input, no preview cards
- 1 entry: one animated card appears
- 2-3 entries: multiple cards, stacked
- Validation: if user enters nothing and hits continue, gentle prompt "Add at least one thing to track"

**Design notes:**
- This screen should feel simple and inviting, not like a form
- The animated cards below are the key engagement hook — they should feel magical
- Input should support Enter key to add (not submit the form)
- Mobile keyboard should be visible and not cover the preview animation

---

### Screen 04: Onboarding Step 2 — Who Sends You These Emails? (`/onboarding`)

**Who sees this:** After completing Step 1.

**Purpose:** Collect secondary entities (WHOs) — people/organizations who send relevant email.

**Layout:**
- Progress indicator: Step 2 of 5
- Headline: "Who sends you email about these?"
- Subheadline: "Name a few people or organizations. You don't need everyone — just a few to help us find the rest automatically."
- Context reminder: chips showing what they entered in Step 1 (e.g., "⚽ Soccer", "🏠 1501 Sylvan")
- **Text input field** — similar to Step 1, with placeholder: "e.g., Coach Williams, Oak Park HOA, Mike the plumber"
- Each entry appears as a chip below
- "Add another" link

**Bottom:**
- "Continue" button
- "I'm not sure, skip this" small link (acceptable — discovery will find senders)

**Design notes:**
- Less critical than Step 1 — make it clear this is optional/helpful, not required
- The subheadline "just a few to help us find the rest" is important — reduces anxiety about completeness
- No animated preview on this screen (the cards from Step 1 established the concept)

---

### Screen 05: Onboarding Step 3 — Subscribe & Connect (`/onboarding`)

**Who sees this:** After Steps 1-2.

**Purpose:** Collect payment (via Stripe) and connect Gmail (via Google OAuth). Two sequential actions on one conceptual step.

**Layout:**
- Progress indicator: Step 3 of 5
- Headline: "Start your free trial"
- Key info block (card-style):
  - "$5/month after 7-day free trial"
  - "Cancel anytime — no commitment"
  - "Credit card required to start"
  - "You won't be charged until [date 7 days from now]"
- Primary CTA: "Start Trial & Connect Gmail" (large button)
- Below button: "What happens next: We'll set up your payment, then connect to your Gmail (read-only access) to start finding your cases."

**Flow after button click:**
1. Redirect to Stripe Checkout (hosted page — we don't design this)
2. Stripe success → redirect to Gmail OAuth consent screen (Google-hosted)
3. Gmail success → redirect to Screen 06 (Scanning)

**Trust signals:**
- Lock icon + "Secure payment via Stripe"
- Shield icon + "Read-only Gmail access — we never send, delete, or modify your email"
- "Your data is encrypted and never shared"

**States:**
- Default: showing pricing and CTA
- Error: if Stripe or Gmail OAuth fails, return here with error message: "Something went wrong. Let's try again." + retry button

**Design notes:**
- This is the highest-friction screen — trust signals are critical
- Make the 7-day trial date concrete (show actual date, not "7 days")
- The two-step nature (Stripe → Gmail) should feel like one smooth action, not two separate tasks

---

### Screen 06: Onboarding Step 4 — Scanning Your Inbox (`/onboarding/scanning`)

**Who sees this:** Immediately after Gmail OAuth completes.

**Purpose:** Show real-time scanning progress. Keep the user engaged while the pipeline runs (30-90 seconds).

**Layout:**
- Progress indicator: Step 4 of 5
- Headline: "Scanning your inbox..."
- Animated scanner visual:
  - Could be a progress bar, a pulsing circle, or an inbox icon with emails flying out
  - Should feel alive and active, not static

**Real-time data feed (updates as scan progresses):**
- "Found 47 relevant emails" (counter increments)
- "Discovered: Coach Williams, Oak Park League, Sports Authority" (names appear as found)
- "Subjects: Spring Tournament, Practice Schedule, Registration Form" (subjects scroll by)
- Each line animates in as the data is discovered

**Bottom:**
- "This usually takes about a minute"
- No "skip" option — they need to wait for the scan

**States:**
- Scanning (animated, data streaming in)
- Complete: auto-transitions to Screen 07 with a brief "Done! Let's review." message

**Design notes:**
- This should feel like a peek behind the curtain — showing real data creates trust
- Don't show email bodies or sensitive content — just sender names and subject lines
- The animation should be engaging enough to hold attention for 30-90 seconds
- Consider showing a count of "emails scanned" vs "relevant emails found" to convey the filtering

---

### Screen 07: Onboarding Step 5 — Review & Configure (`/onboarding/review`)

**Who sees this:** After scanning completes.

**Purpose:** Let the user review what was discovered, merge related items, and save extras for later. This is the most complex onboarding screen — it configures the system.

**Layout:**
- Progress indicator: Step 5 of 5
- Headline: "Here's what we found"
- Subheadline: "Review your setup. Drag items together to merge them, or drag extras to 'Save for Later.'"

**Main area — discovered entities grouped by user input:**
- Section per entity from Step 1, e.g.:
  - **"⚽ Soccer"** (what they entered)
    - Confirmed: "Oak Park Soccer League" (12 emails)
    - Discovered: "Spring Tournament Committee" (4 emails)
    - Discovered: "Referee Association" (2 emails)
  - **"🏠 1501 Sylvan"** (what they entered)
    - Confirmed: "Oak Park HOA" (8 emails)
    - Discovered: "ABC Plumbing" (3 emails)

**Extra discoveries section:**
- Items found that don't clearly match any user input
- "We also found these — drag them to a group above, or save them for later:"
  - "Martial Arts Academy" (5 emails)
  - "School Parent Association" (7 emails)

**Save for Later box:**
- A clearly marked drop zone at the bottom: "Save for Later"
- Subtext: "These will help you set up another Topic when you're ready"
- Items dragged here are visually distinct (grayed out, "saved" badge)

**Merge interaction:**
- Drag an item onto another item or group to merge them
- Visual feedback: target highlights, "drop to merge" tooltip
- Merged items show together with a "merged" indicator

**Tags section (expandable):**
- "Tags we'll use to organize:" followed by tag chips
- User can remove tags (X) or add new ones
- Collapsed by default, "Edit tags" link to expand

**People section (expandable):**
- "People we'll look for:" followed by name chips
- Same add/remove pattern
- Collapsed by default

**Topic name field:**
- "Name this Topic:" with auto-suggested name (e.g., "Kids Activities")
- Editable text input

**Bottom:**
- "Looks good — show me my cases!" (primary CTA)
- "Back" link to make changes

**States:**
- Default: items laid out in groups, ready for drag interaction
- Dragging: item follows finger/cursor, valid drop zones highlight
- After merge: merged items show together with visual indicator
- After save-for-later: item moves to save box with animation
- Empty extra discoveries: this section hidden entirely

**Design notes:**
- This is the most critical onboarding screen for system accuracy
- The language must be extremely clear: users need to understand that merging = "these are the same thing"
- Drag-and-drop must work well on mobile (touch drag, not just desktop mouse)
- Consider tap-to-select then "move to" as an alternative to drag on small screens
- Show email counts next to each item — this conveys credibility ("we actually found things")

---

### Screen 08: First Feed — Newly Onboarded State (`/feed`)

**Who sees this:** Immediately after completing onboarding (first time on the feed).

**Purpose:** Introduce the feed with context. This is the same feed screen (Screen 09) but with first-run overlays.

**Overlay/tooltip elements (shown once, dismissible):**
1. Tooltip on first case card: "These are your cases — each one groups related emails into one view"
2. Tooltip on urgency indicator: "Red means something needs attention soon"
3. Tooltip on bottom nav "+ Note": "Add your own to-dos and reminders here"
4. Tooltip on bottom nav "⚙️": "Manage your Topics, add new ones, and adjust settings"
5. Brief banner at top: "Welcome to Denim! Here are your first cases. As more email arrives, we'll get smarter."

**Design notes:**
- Tooltips should be sequential (show one at a time, "Next" to advance)
- Dismissible with X or tap-outside
- Don't block the entire screen — let users see their real data behind the overlays
- After dismissal, never show again (store in local storage or user preferences)

---

## CORE APP SCREENS

---

### Screen 09: Case Feed — Primary Screen (`/feed`)

**Who sees this:** Every returning user, every time they open the app.

**Purpose:** THE primary screen. Shows all cases across all Topics, sorted by urgency. Must be scannable in 2-3 seconds.

**Layout (top to bottom):**

1. **Header bar**
   - Denim logo (small, left)
   - User avatar (right, links to profile/settings)

2. **Filter bar (horizontally scrollable)**
   - "All" chip (selected by default)
   - Topic chips, color-coded with emoji: "⚽ Kids Activities", "🏠 Property", "📋 Work"
   - When a topic is selected, entity chips appear below: "Soccer", "Dance", "Lanier"
   - Selected state: filled/bold. Unselected: outlined/muted.

3. **Inner Circle section (if applicable)**
   - If 1-3 cases qualify as Inner Circle (highest priority):
   - Section header: "Focus Now" or just a visual glow/prominence
   - These cards are slightly larger or have a distinct glow/highlight
   - Separated from the rest by a subtle divider

4. **Case card list (scrollable)**
   - Cards sorted: Inner Circle → Imminent → This Week → Upcoming
   - Each card shows (see Screen 10 for card detail)
   - Generous vertical spacing between cards
   - Infinite scroll or "Load more" at bottom

5. **Past/Resolved section (collapsed by default)**
   - "Show past cases" toggle/link at the bottom of active cases
   - When expanded: grayed-out cards for resolved/past-due cases
   - Collapsed by default to keep focus on actionable items

6. **Empty state (see Screen 11)**

7. **Bottom nav bar**
   - Feed (highlighted/active), + Note, Settings (gear)

**States:**
- Loading: skeleton cards pulsing (see Screen 12)
- Populated: mixed urgency cases
- Filtered: showing only one Topic or Entity
- All caught up: fewer than 5 cases, encouraging message
- Empty: no cases at all (brand new or all resolved)

**Design notes:**
- This screen must be FAST — skeleton appears instantly, data streams in
- Cards must be scannable — the emoji + entity + date should be readable at a glance
- Urgency should be conveyed by left border color, not text labels (visual, not verbal)
- Mobile: single column, cards full-width minus padding
- Tablet: 2-column grid
- Laptop: 2-3 column grid with side nav instead of bottom nav

---

### Screen 10: Case Card Component (used in feed)

**Not a standalone screen — this is the card component used in Screen 09.**

**Purpose:** Each case in the feed is represented by this card. It must convey the most important information in the smallest space.

**Card anatomy (top to bottom within the card):**

```
┌─ [left border: mood/urgency color] ──────────────────┐
│                                                       │
│  ⚽ Soccer                          🏆  ← mood badge │
│  Spring Tournament Registration              [unread] │
│                                                       │
│  📅 Thu Mar 27, 3:30 PM                              │
│  📍 Oak Park Field                    [maps link →]   │
│                                                       │
│  Registration open. Forms due by Fri Mar 28.          │
│                                                       │
│  ☐ Register by Fri Mar 28                             │
│  ☐ Pay $150 tournament fee                            │
│                                                       │
│  Last updated: Mar 20                                 │
└───────────────────────────────────────────────────────┘
```

**Visual elements:**
- **Left border** (4px): Color indicates mood → urgency
  - Gold: CELEBRATORY
  - Red: IMMINENT or URGENT mood
  - Amber: THIS_WEEK
  - Green: UPCOMING or POSITIVE mood
  - Gray: NO_ACTION, past, or NEUTRAL resolved
- **Topic emoji + Entity name** (top left, bold, largest text): "⚽ Soccer"
- **Mood badge** (top right, only for CELEBRATORY/URGENT):
  - CELEBRATORY: "🏆" or sparkle icon
  - URGENT: "⚠️" or alert icon
- **Unread dot** (small colored dot, only if viewedAt is null)
- **Case title** (second line, medium weight): "Spring Tournament Registration"
- **When** (with calendar icon): "Thu Mar 27, 3:30 PM"
  - If IMMINENT: highlighted/bold, possibly with "Tomorrow!" or time-relative label
  - If past: dimmed, strikethrough or "Past" label
- **Where** (with pin icon): "Oak Park Field" — tappable, opens Google Maps
  - Only shown if location data exists
- **Summary** (1-2 lines, muted text): summary.end content
- **Action items** (checkboxes, up to 2 shown):
  - "☐ Register by Fri Mar 28"
  - "☐ Pay $150 tournament fee"
  - If more than 2: "+3 more actions" link
- **Freshness** (bottom, smallest text, muted): "Last updated: Mar 20"
  - If >7 days old: "⚠️ May be outdated"

**Card variations by mood:**

| Mood | Left border | Extra treatment |
|------|------------|----------------|
| CELEBRATORY | Gold (4px) | Subtle sparkle/shimmer on border, 🏆 badge |
| POSITIVE | Green | Subtle checkmark icon |
| NEUTRAL | Determined by urgency | No extra treatment |
| URGENT | Red | ⚠️ badge, possible subtle pulse |
| NEGATIVE | Orange | Warning icon |

**Card variations by urgency (when mood is NEUTRAL):**

| Urgency | Left border | Date treatment |
|---------|------------|---------------|
| Inner Circle | Red + glow | Bold, "Focus Now" label |
| IMMINENT | Red | Bold, highlighted background on date |
| THIS_WEEK | Amber | Normal weight |
| UPCOMING | Green | Normal weight, muted |
| NO_ACTION | Gray | Dimmed |
| Past/Resolved | Light gray | Strikethrough on date, entire card muted |

**Interaction:**
- Tap anywhere on card → navigate to Screen 13 (Case Detail)
- Tap checkbox → mark action as done (inline, no navigation)
- Tap map link → open Google Maps in new tab
- Long press → future: quick actions menu

---

### Screen 11: Case Feed — Empty States

**Shown when the feed has no (or very few) cases.**

**State A: Zero cases (new user, scan still processing)**
- Illustration of a tidy inbox
- "Your cases are being prepared..."
- "We're still processing your emails. Check back in a minute."
- Subtle loading animation

**State B: Zero active cases (all resolved/past)**
- Illustration of relaxation (hammock, sunset, coffee)
- Random encouraging message from curated list:
  - "All caught up! Go enjoy your day."
  - "Your inbox is working for you now."
  - "Nothing needs your attention. That's a win."
  - "Clear calendar, clear mind."
- "Show past cases" link to reveal resolved items

**State C: Fewer than 5 active cases**
- Normal case cards shown
- Below the last card, in the empty space:
  - Encouraging message (lighter, smaller than State B)
  - "Looking good — only [N] things need attention"

**Design notes:**
- Empty states should feel warm and positive, not broken or lonely
- Illustrations should be simple and on-brand
- Messages should be randomized (don't show the same one every time)

---

### Screen 12: Case Feed — Loading Skeleton

**Shown instantly while data loads (before cases appear).**

**Layout:**
- Same layout as Screen 09 but with pulsing placeholder shapes:
  - Header bar: real (already rendered from layout)
  - Filter bar: real chips or placeholder chips
  - Card skeletons: 3-4 cards with:
    - Pulsing rectangle for emoji + entity name
    - Pulsing rectangle for title
    - Shorter pulsing rectangle for date
    - Two short pulsing lines for summary
  - Left border: neutral gray (no color coding yet)

**Design notes:**
- Skeleton should match the exact dimensions of real cards so there's no layout shift
- Pulsing animation should be subtle (not distracting)
- This appears for <500ms typically — design for brief visibility

---

### Screen 13: Case Detail (`/feed/[caseId]`)

**Who sees this:** User tapped a case card from the feed.

**Purpose:** Full detail view of a single case — all emails, all actions, summary, and correction controls.

**Navigation:** Full page push from feed. Back arrow in top-left returns to feed.

**Layout (top to bottom):**

1. **Header**
   - Back arrow (←) + "Back to Feed"
   - Share icon (future)

2. **Case header**
   - Topic emoji + Entity name: "⚽ Soccer" (large)
   - Case title: "Spring Tournament Registration" (headline size)
   - Mood badge if CELEBRATORY/URGENT
   - Status pill: "Active" / "Resolved" / "Past Due"
   - "Last updated Mar 20" (small, muted)
   - If stale (>7 days): "⚠️ This summary may be outdated" + "Refresh" button

3. **Summary section**
   - Three-part summary with clear labels:
     - **Background:** summary.beginning
     - **What happened:** summary.middle
     - **Current status:** summary.end (with "as of [date]" context)

4. **Key details (if extracted fields exist)**
   - Structured data in a clean grid/list:
     - "Amount: $150"
     - "Deadline: Fri Mar 28"
     - "Location: Oak Park Field" (tappable → Maps)
   - Only shown if extractedData has values

5. **Actions section**
   - Section header: "To Do" or "Action Items"
   - List of all actions (not just top 2 like the card):
     - ☐ "Register by Fri Mar 28" — EVENT
     - ☐ "Pay $150 tournament fee" — PAYMENT
     - ☐ "Send medical form to coach" — TASK
   - Each action shows:
     - Checkbox (tap to mark done)
     - Title with absolute date
     - Type icon (calendar, dollar, clipboard, clock, reply)
     - "Add to Calendar" button for EVENT/DEADLINE types
     - Calendar status: "✓ On your calendar" or "Not on calendar — Add?"
   - Completed/expired actions: shown at bottom, dimmed, strikethrough

6. **Emails section**
   - Section header: "Related Emails ([count])"
   - List of emails in this case, newest first:
     - Sender name + date: "Coach Williams — Mar 18"
     - Subject line
     - 1-line summary excerpt
     - Tags as small chips
   - Tap an email → expand to show full summary (accordion) or navigate to email detail
   - "Show more" if >10 emails

7. **Feedback section**
   - Section header: "Is this case accurate?"
   - Thumbs up / Thumbs down buttons
   - If thumbs down: expand to show correction options:
     - "Move an email to a different case"
     - "This email doesn't belong here"
     - "Merge this case with another"
   - Free text box: "Tell us how to improve this case" (placeholder)

8. **Bottom spacing** (enough to clear the bottom nav)

**States:**
- Default: all sections shown
- Stale (synthesizedAt > 7 days): warning banner + refresh button
- Refreshing: loading spinner on summary section while re-synthesis runs
- After feedback: "Thanks! We'll use this to improve." confirmation

**Design notes:**
- This is a long scrollable page — section headers should be sticky or clearly separated
- Actions with dates should show relative time too: "due in 2 days" alongside "Fri Mar 28"
- Calendar integration buttons should be prominent on EVENT actions
- The feedback section encourages corrections that improve the system over time

---

### Screen 14: Create Note (`/note/new`)

**Who sees this:** User tapped "+ Note" in bottom nav.

**Purpose:** Create a personal to-do or note that appears in the feed alongside cases.

**Layout:**
- Header: "New Note" + close (X) button
- **Title field** (large text input): placeholder "What do you need to do?"
- **Body field** (expandable textarea): placeholder "Add details (optional)"
- **Due date** (optional): date picker, placeholder "When is this due?"
- **Link to Topic** (optional): dropdown showing user's Topics, or "None"
- **Add to Calendar** toggle (shown if due date is set)
- Primary CTA: "Save Note"

**After save:**
- Brief confirmation: "Note saved!"
- Navigate back to feed where the note now appears as a card

**Note card in feed:**
- Visually distinct from case cards:
  - "📝" prefix instead of topic emoji
  - Lighter border or dashed border
  - Title + due date + body preview
  - Checkbox to mark as done (inline)

**States:**
- Empty: just the fields
- Filled: fields populated, CTA enabled
- Saving: brief spinner
- Validation: "Title is required" if empty on submit

**Design notes:**
- This should feel quick and lightweight — like adding a reminder in Apple Reminders
- The note should appear in the feed immediately after creation
- Don't over-design — this is a utility screen, not a showcase

---

## SETTINGS SCREENS

---

### Screen 15: Settings Hub (`/settings`)

**Who sees this:** User tapped gear icon in bottom nav.

**Purpose:** Central navigation to all settings and management screens.

**Layout:**
- Header: "Settings"
- List of menu items (large, tappable rows):

```
┌───────────────────────────────────────┐
│ 📋  My Topics                    →    │
│     Manage what Denim tracks          │
├───────────────────────────────────────┤
│ ➕  Add a Topic                  →    │
│     Set up a new category             │
├───────────────────────────────────────┤
│ 🔔  Notifications                →    │
│     Digest, alerts, preferences       │
├───────────────────────────────────────┤
│ 💳  Subscription                 →    │
│     Plan, billing, trial status       │
├───────────────────────────────────────┤
│ 👤  Account                      →    │
│     Email, sign out, delete account   │
└───────────────────────────────────────┘
```

**Design notes:**
- Simple navigation list — no need for anything fancy
- Each row has icon, title, subtitle, and right-arrow chevron
- Bottom nav still visible (Settings icon highlighted)

---

### Screen 16: Topic List (`/settings/topics`)

**Who sees this:** From Settings → My Topics.

**Purpose:** Overview of all user's Topics with key stats. Entry point to edit or view dashboard.

**Layout:**
- Header: "My Topics" + "Add Topic" button (top right)
- List of topics as cards:

```
┌───────────────────────────────────────┐
│  ⚽ Kids Activities                   │
│                                       │
│  Emails: 142   Cases: 7   Open: 3    │
│                                       │
│  [Edit]              [Dashboard]      │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│  🏠 Property Management              │
│                                       │
│  Emails: 89    Cases: 4   Open: 2    │
│                                       │
│  [Edit]              [Dashboard]      │
└───────────────────────────────────────┘
```

**Per-topic card shows:**
- Topic emoji + name
- Key stats: email count, case count, open action count
- Two buttons: "Edit" → Screen 17, "Dashboard" → Screen 18

**States:**
- No topics: "You haven't set up any Topics yet. Add your first one!" + CTA
- One topic: single card
- Multiple topics: scrollable list

---

### Screen 17: Topic Editor (`/settings/topics/[id]`)

**Who sees this:** From Topic List → Edit.

**Purpose:** Add or remove the data types that configure how a Topic works.

**Layout:**
- Header: "Edit [Topic Name]" + back arrow
- Topic name field (editable)
- Topic emoji (tappable to change)

**Sections (expandable/collapsible):**

1. **Things You Track (Primary Entities)**
   - List of entities as chips: "Soccer", "Dance", "Lanier"
   - "+" button to add new
   - "×" to remove (with confirmation: "Removing Soccer will orphan 3 cases. Continue?")

2. **People & Organizations (Secondary Entities)**
   - List of names as chips: "Coach Williams", "Oak Park League"
   - "+" to add, "×" to remove
   - "Auto-discovered" badge on entities found by the system

3. **Tags**
   - Chip list: "Schedules", "Payments", "Tournaments"
   - "+" to add, "×" to remove

4. **Extracted Fields**
   - List with field name + type: "Cost (number)", "Location (text)", "Deadline (date)"
   - "+" to add (field name + type selector)
   - "×" to remove

5. **Danger Zone**
   - "Delete this Topic" button (red, outline)
   - Tap → confirmation dialog (Screen 25)

**Design notes:**
- Each section starts collapsed with item count: "Things You Track (3)"
- Expand to see and edit items
- Adding an entity or tag should feel instant (no page reload)
- Removing a primary entity has consequences — the confirmation must be clear

---

### Screen 18: Topic Dashboard (`/settings/topics/[id]/dashboard`)

**Who sees this:** From Topic List → Dashboard.

**Purpose:** Show the value Denim provides for this Topic. Stats, trends, and quality metrics.

**Layout:**
- Header: "[Topic Name] Dashboard" + back arrow

**Stat cards (2x2 grid or scrollable row):**

| Stat | Value | Icon |
|------|-------|------|
| Emails Scanned | 142 | 📧 |
| Active Cases | 7 | 📂 |
| Open Actions | 3 | ☐ |
| Corrections Made | 2 | ✏️ |

**Trend section:**
- "Accuracy over time" — simple line chart showing QualitySnapshot accuracy (30-day rolling)
- X-axis: dates, Y-axis: percentage
- Current accuracy displayed prominently: "94% accuracy"

**Activity feed (optional):**
- Recent events: "New case created: Spring Tournament", "Email moved: Invoice → Payments"
- Shows system is actively working

**Feedback section:**
- "How can we improve?"
- Free-text input: "Tell us what's working and what isn't"
- "Submit Feedback" button
- Past feedback shown below (if any)

**Design notes:**
- This screen justifies the subscription — it should convey value
- Stats should be prominent and use large numbers
- The accuracy chart shows improvement over time (the "breaking-in curve")
- Keep it simple — this isn't an analytics dashboard, it's a value display

---

### Screen 19: Notification Preferences (`/settings/notifications`)

**Who sees this:** From Settings → Notifications.

**Purpose:** Configure how and when Denim notifies the user.

**Layout:**
- Header: "Notifications" + back arrow

**Toggle rows:**

```
┌───────────────────────────────────────┐
│  Daily Email Digest            [ON]   │
│  Get a morning summary of your cases  │
│  Time: [8:00 AM ▼]                   │
├───────────────────────────────────────┤
│  Urgent Alerts (SMS)           [OFF]  │
│  Text when something needs attention  │
│  Phone: [                    ]        │
├───────────────────────────────────────┤
│  Push Notifications            [OFF]  │
│  Browser/PWA alerts for new cases     │
└───────────────────────────────────────┘
```

**Digest includes section (shown when digest is ON):**
- Checkboxes:
  - ☑ New cases since yesterday
  - ☑ Upcoming deadlines (next 48 hours)
  - ☑ Action items due today
  - ☐ Weekly summary of corrections

**Design notes:**
- Standard mobile settings pattern with toggle switches
- Phone number field appears only when SMS is toggled on
- Time picker for digest delivery time

---

### Screen 20: Subscription Management (`/settings/subscription`)

**Who sees this:** From Settings → Subscription.

**Purpose:** Show subscription status, manage billing.

**Layout:**
- Header: "Subscription" + back arrow

**Status card:**
```
┌───────────────────────────────────────┐
│  Denim Pro                            │
│  $5/month                             │
│                                       │
│  Status: Active                       │
│  Next billing: Apr 15, 2026           │
│  Payment: Visa ending 4242            │
│                                       │
│  [Manage Billing →]                   │
│  (Opens Stripe Customer Portal)       │
└───────────────────────────────────────┘
```

**Trial variant:**
```
┌───────────────────────────────────────┐
│  Free Trial                           │
│  5 days remaining                     │
│                                       │
│  Your trial ends: Apr 1, 2026         │
│  You'll be charged $5/month after     │
│                                       │
│  [Manage Billing →]                   │
└───────────────────────────────────────┘
```

**Design notes:**
- "Manage Billing" links to Stripe's hosted customer portal (we don't design that)
- Show clear trial countdown if in trial period
- No cancel button directly visible — Stripe portal handles that

---

### Screen 21: Add New Topic (`/settings/topics/new`)

**Who sees this:** From Settings → Add a Topic, or from Topic List → Add Topic.

**Purpose:** Start a new Topic. Two paths: quick-add (if save-for-later items exist) or full interview.

**Path A: Quick-add (save-for-later items exist)**
- Header: "Add a Topic"
- "We saved some things from your last scan:"
- Pre-populated entity chips from the save-for-later box (from Screen 07)
- User can add/remove items
- "Name this Topic:" field
- "Create Topic" button → triggers scan for these entities

**Path B: Full interview (no saved items)**
- Same as Screen 03-04 flow but without the subscription/connect steps (already done)
- Headline: "What else do you want to organize?"
- Steps: What → Who → Scan → Review

**Design notes:**
- Path A should feel like a shortcut — fast, pre-populated, minimal effort
- Show a message: "Remember these from before? Let's set them up."
- Path B is the full interview but streamlined (no payment, no Gmail connect)

---

## OVERLAY / MODAL SCREENS

---

### Screen 22: Delete Topic Confirmation

**Triggered by:** "Delete this Topic" in Topic Editor (Screen 17).

**Type:** Modal overlay / dialog.

**Content:**
- Warning icon
- Headline: "Delete [Topic Name]?"
- Body: "This will permanently delete [N] cases, [N] actions, and all associated data for this Topic. This cannot be undone."
- Buttons: "Cancel" (secondary), "Delete Topic" (destructive red)

---

### Screen 23: Calendar Add Confirmation

**Triggered by:** "Add to Calendar" on an action item (Screen 13).

**Type:** Brief toast or inline confirmation.

**Content:**
- "✓ Added to your Google Calendar"
- Event details: "Spring Tournament — Thu Mar 27, 3:30 PM"
- "View in Calendar" link

---

### Screen 24: Error States

**Generic error patterns used across the app:**

**A: Network error**
- "Something went wrong. Check your connection and try again."
- "Retry" button

**B: Gmail token expired**
- "We need to reconnect to your Gmail"
- "Reconnect" button → OAuth flow

**C: Scan/pipeline error**
- "We hit a snag processing your emails. We'll retry automatically."
- "If this persists, contact support."

**D: Not found (404)**
- "This case doesn't exist or was deleted."
- "Back to Feed" button

---

## SPECIAL SCREENS

---

### Screen 25: Daily Digest Email (rendered in email client)

**Not an app screen — this is the daily email sent to users.**

**Purpose:** Morning summary email with deep links back into the app.

**Layout:**

```
Subject: Denim Daily — 3 items need attention

─────────────────────────────────────

Good morning! Here's your Denim briefing.

FOCUS NOW
─────────
⚽ Spring Tournament Registration
   📅 Tomorrow, 3:30 PM at Oak Park Field
   ☐ Register by today (Fri Mar 28)
   [View Case →]

THIS WEEK
─────────
🏠 1501 Sylvan — Lease Renewal
   ☐ Sign and return by Wed Apr 2
   [View Case →]

📋 Work — Q2 Planning Offsite
   📅 Mon Mar 31, 9:00 AM
   [View Case →]

NEW SINCE YESTERDAY
───────────────────
+2 new emails in "Soccer"
+1 new case: "Dance Recital Costumes"

─────────────────────────────────────
Manage notifications: [Settings →]
```

**Design notes:**
- Email must work in all major clients (Gmail, Apple Mail, Outlook)
- Use tables for layout (email HTML constraints)
- Deep links should open directly to the case in the app
- Keep it scannable — this is a 15-second read, not a newsletter

---

### Screen 26: PWA Install Prompt

**Triggered by:** User visits on mobile browser, meets PWA install criteria.

**Type:** Custom banner at top of feed (not the browser's default prompt).

**Content:**
- "Add Denim to your home screen for instant access"
- "Install" button + "Not now" dismiss
- Shows app icon preview

---

### Screen 27: Chrome Extension Sidebar

**Who sees this:** Users who installed the Chrome extension.

**Purpose:** Same feed experience in a Chrome sidebar panel (~400px wide).

**Layout:**
- Identical to mobile feed (Screen 09) at 400px width
- No bottom nav — use top nav or hamburger menu instead (Chrome sidebar can't use bottom nav effectively)
- Same case cards, same filter chips, same interactions
- Tap on case → opens in sidebar (not new tab)

**Design notes:**
- Shares components with the mobile web app
- Key difference: no bottom nav, may need compact header
- Consider "Open in full app" link for complex actions

---

## SCREEN CHECKLIST

| # | Screen | Route | Priority | Phase |
|---|--------|-------|----------|-------|
| 01 | Landing Page | /welcome | HIGH | 3 |
| 02 | Sign In | /sign-in | MEDIUM | 1 |
| 03 | Onboarding: What | /onboarding | HIGH | 3 |
| 04 | Onboarding: Who | /onboarding | HIGH | 3 |
| 05 | Onboarding: Subscribe | /onboarding | HIGH | 3 |
| 06 | Onboarding: Scanning | /onboarding/scanning | HIGH | 3 |
| 07 | Onboarding: Review | /onboarding/review | HIGH | 3 |
| 08 | First Feed (tooltips) | /feed | MEDIUM | 3 |
| 09 | Case Feed | /feed | **CRITICAL** | 2 |
| 10 | Case Card Component | (component) | **CRITICAL** | 2 |
| 11 | Feed Empty States | /feed | MEDIUM | 2 |
| 12 | Feed Loading Skeleton | /feed | MEDIUM | 1 |
| 13 | Case Detail | /feed/[caseId] | **CRITICAL** | 2 |
| 14 | Create Note | /note/new | MEDIUM | 4 |
| 15 | Settings Hub | /settings | MEDIUM | 4 |
| 16 | Topic List | /settings/topics | MEDIUM | 4 |
| 17 | Topic Editor | /settings/topics/[id] | MEDIUM | 4 |
| 18 | Topic Dashboard | /settings/topics/[id]/dashboard | LOW | 4 |
| 19 | Notifications | /settings/notifications | LOW | 4 |
| 20 | Subscription | /settings/subscription | LOW | 4 |
| 21 | Add New Topic | /settings/topics/new | MEDIUM | 4 |
| 22 | Delete Confirmation | (modal) | LOW | 4 |
| 23 | Calendar Confirmation | (toast) | LOW | 5 |
| 24 | Error States | (various) | MEDIUM | 2 |
| 25 | Daily Digest Email | (email) | LOW | 5 |
| 26 | PWA Install Prompt | (banner) | LOW | 5 |
| 27 | Chrome Sidebar | (extension) | LOW | 5 |

---

## SUGGESTED DESIGN ORDER

Start with the screens that establish the design system, then build outward:

1. **Screen 10: Case Card** — This is the atomic unit. Every design decision (colors, typography, spacing, borders) starts here.
2. **Screen 09: Case Feed** — Compose the cards into the primary screen. Establishes layout, nav, filter bar.
3. **Screen 13: Case Detail** — The deepest view. Tests your typography hierarchy and section spacing.
4. **Screen 12: Loading Skeleton** — Quick win, establishes skeleton pattern for reuse.
5. **Screen 01: Landing Page** — Sets the marketing tone. Can be designed independently.
6. **Screens 03-07: Onboarding** — Sequential flow, design as a connected series.
7. **Screens 15-21: Settings** — Utility screens, straightforward patterns.
8. **Screens 22-27: Overlays & special** — Polish, last priority.
