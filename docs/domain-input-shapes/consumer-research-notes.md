# Consumer Research — Email Pain Categories

**Captured:** 2026-04-15
**Priority:** **LAST** — park until after current domain work is complete.
**Why it's captured here:** both chunks below informed the "candidate new schemas"
list in `2026-04-15-phase-1-session.md`. Kept in full so the research doesn't get
lost when we eventually prioritize new schemas.

**Nick's framing:** *"Seeking to capture a solution that really matters for people."*

---

## Priority tier 1 — work through current list first

The items in the `2026-04-15-phase-1-session.md` doc (locked tables for property,
school_parent, agency; construction/legal/general still to address; 7 follow-up
issues; 2 candidate new schemas from Nick + 12 from Claude) are the active work.

**Do not start on the research below until tier 1 is closed.**

---

## Tier 2A — Commercial / "inbox fatigue" categories

High-volume automated messages that overwhelm manual organization.

### 1. E-Commerce & Retail Promotions

Largest source of clutter for most consumers.

- Flash Sales & Daily Deals — frequent "limited time" offers that trigger FOMO
- Cart Abandonment — automated "You left something behind" nudges
- Loyalty Programs — updates on points, rewards, tiered status

### 2. SaaS & Project Management Notifications

For professionals / prosumers — buries human-to-human communication.

- System Alerts — Jira, GitHub, Trello, Linear (ticket updates, comments)
- Activity Digests — weekly/daily platform-usage summaries
- Security & Login Alerts — verification codes, "new login detected"

### 3. Financial & Administrative Documentation

Critical but often lacks a central home outside the inbox.

- Recurring Invoices — monthly bills from utilities, streaming, subscriptions
- Investment & Banking Statements — trade confirmations, balance updates
- Tax Documentation — annual or quarterly filings lost in the sea

### 4. Property & Logistics Management (commercial flavor)

Time-sensitive, reference-heavy.

- Shipping & Delivery — tracking numbers, "out for delivery," delivery confirmations
- Property/HOA Communications — rental receipts, maintenance updates, community
  announcements
- Travel Itineraries — flight confirmations, hotel bookings, rental car agreements

### 5. Content & Community "Bloat"

- Newsletter Subscriptions — Substack, Medium, industry news (wanted but unread)
- Social Networking — LinkedIn "who's viewed your profile," Slack/Discord digests
  (duplicates in-app info)

### Tier 2A pain hierarchy

Highest reported frustration: emails with **low immediate utility but high long-term
importance** — tax docs, property records, insurance. Manual filing effort required
to make them useful later.

### Open question from research source

*"Are you focusing your research on a specific user demographic, such as small
business owners or general consumers?"*

We don't have an answer yet. Worth deciding before this tier becomes active work.

---

## Tier 2B — Life admin categories

Higher-stress than tier 2A because non-optional and high-stakes. Often fragmented
across multiple senders and platforms.

### 1. Education & Schooling

Greatest source of notification fatigue for parents.

- **The "Portal" Problem** — notifications that you have a new message in a proprietary
  portal (PowerSchool, Canvas, Infinite Campus, Skyward, Blackboard) rather than
  the info being in the email itself. **Worth calling out separately — the portal
  bounce is a distinct pain shape.**
- PTA & Extracurriculars — bake sales, fundraisers, spirit days
- Administrative Paperwork — digital permission slips, health forms, lunch balance

### 2. Youth Sports & Activities

Seasonal, extremely time-sensitive.

- Scheduling Shifts — last-minute practice changes, rainouts, venue updates
- Logistics Coordination — snack sign-ups, carpooling threads, uniform deadlines
- Team Management Apps — TeamSnap, GameChanger (reminders duplicated in SMS)

### 3. Healthcare & Wellness

Volume increased with patient-record digitization.

- Appointment Lifecycle — Confirmation → Reminder → "Please check in online" →
  "Your summary is ready"
- Insurance & Billing — Explanations of Benefits (EOBs), premium notices, HSA
  "action required"
- Pharmacy Alerts — refill reminders, "ready for pickup"

### 4. Household & Property Management (consumer flavor)

- Home Services — quotes, invoices, service reports (HVAC, landscaping, pest
  control)
- HOA & Neighborhood — community newsletters, meeting minutes, annual dues
- Utility Monitoring — usage reports, "unusual activity" from smart-home devices
  (Nest, Ring, etc.)

### 5. Social & Community Coordination

- Invitations — Evite, Paperless Post (with nudge sequences for non-RSVP)
- Group Travel — family reunion or group-trip threads; flight/AirBnB links buried
- Volunteer Obligations — church groups, non-profits, neighborhood watch

### Tier 2B mental-load insight

> *The primary reason people want to organize these better isn't just the count of
> emails, but the actionability. A retail email can be deleted; a school email
> about an early dismissal requires a calendar update, a text to a spouse, and a
> change in work schedule.*

This is important for case/action design: **life admin cases often have downstream
effects (calendar, chat, schedule change) that a denim case should make easy to
propagate.** Today's CaseAction model handles calendar; the "text a spouse" and
"change work schedule" are not yet supported.

### Open question from research source

*"Do you see this research leading toward a solution for a specific 'life admin'
niche, or a more general inbox organizer?"*

Same flavor of demographic/scope question as 2A. Worth deciding.

---

## Cross-reference to Phase 1 candidate schemas

Many of these research categories map onto the candidate-schemas table in
`2026-04-15-phase-1-session.md` §Candidate new schemas. Rough mapping:

| Research category | Phase 1 candidate schema (if any) | Notes |
|---|---|---|
| Education & Schooling | ✅ `school_parent` (already shipped) | Matches cleanly. Portal-bounce pattern is a sub-problem worth separate design. |
| Youth Sports & Activities | ✅ `school_parent` (already shipped) | Covered. |
| Healthcare & Wellness | Medical/caregiver (Claude-proposed) | Whole-family healthcare navigation is a big candidate. |
| Household & Property Management | ✅ `property` (existing, consumer-focused variant) | Owner-occupier use case slightly different from property-manager. |
| HOA & Neighborhood | Sub-case of `property` | Could be first-class. |
| Shipping & Delivery | **Not yet proposed** | Near-zero durable PRIMARIES (each package is a CASE with a 1-week lifetime); maybe better as a case-type than a schema. |
| Travel Itineraries | **Not yet proposed** | "Trip" as PRIMARY, bookings as CASES. Time-bounded schema. Good candidate. |
| Recurring Invoices / Subscriptions | Subscription/membership (Claude-proposed) | Strong candidate. |
| Tax Documentation | **Not yet proposed** | Annual rhythm, low-frequency, high-importance. Tax year as PRIMARY, forms as CASES. Possibly niche. |
| Investment & Banking Statements | **Not yet proposed** | Account as PRIMARY, quarterly cycle as CASES. Sensitive data. |
| Social Coordination / Invitations | **Not yet proposed** | Each event as CASE under an "Events I'm invited to" PRIMARY? Or each as its own short-lived schema? Open. |
| E-commerce promos / retail | **Deliberately NOT a candidate** | Mostly noise. Better handled by aggressive filtering/exclusion rules, not schemas. |
| SaaS system alerts | **Deliberately NOT a candidate** | Same as above. Filter, don't organize. |
| Content / newsletters | **Deliberately NOT a candidate** | Read-later tool, not a case-engine target. |

### New candidates surfaced purely from this research

Adding these to the follow-on candidate pool (not yet in Phase 1 doc):

1. **Travel** — Trip-based PRIMARY, time-bounded, bookings/itinerary/confirmations
   as CASES. SECONDARIES: airlines, hotels, rental agencies, AirBnB hosts.
2. **Tax-year management** — Annual PRIMARY ("Tax Year 2026"), CASES per form or
   institution (W-2 from employer, 1099 from bank, HSA statement). Deadline-driven.
3. **Household services** (if separated from `property`) — Recurring home-services
   relationships (landscaper, HVAC tech, cleaner). Could be a specialized sub-domain
   of consumer-household-`property` with different prompt rules.
4. **Healthcare / caregiver-for-family** — Already in Phase 1 candidates; research
   strongly supports its priority.
5. **Shipping/delivery tracker** — Lightweight, possibly a feature not a schema.
   Each package a time-bounded CASE; no persistent PRIMARIES. Might be better as
   a case-type or excluded entirely (carriers already provide tracking).

---

## Design thoughts to revisit when this becomes active work

1. **Demographic question (both source chunks).** Before building any of these, we
   need a call on: general consumer vs. prosumer vs. specific niche (parents, small
   business owners, etc.). This determines which schemas to prioritize.

2. **The "portal bounce" anti-pattern.** Email that only tells you to go somewhere
   else is high-friction and adds no value on its own. denim should probably
   detect portal-bounce emails and flag them specially (action: "Check portal" with
   a deep link if possible), not bury them in normal case flow.

3. **"Mental load" factor → downstream actions.** The research framing suggests
   denim's value isn't just organizing; it's *reducing the friction of acting on
   what you organize.* This argues for richer action types: "propagate to calendar,"
   "text someone," "add to home chat," "update spouse's calendar." Today only
   calendar is supported. Worth considering as a long-term direction.

4. **Filter vs. organize decision.** Retail promos, SaaS alerts, and newsletters
   are deliberately excluded from candidate schemas above — they're noise, not
   signal. But a meaningful feature might be *aggressive default exclusion* of
   these categories with user override, so the user's denim feed only contains
   things worth organizing. This is a parallel line of work to schema expansion.

5. **"Seeking a solution that really matters for people."** Nick's closing
   framing. The research strongly suggests the highest-impact categories are:
   - School/activities (already have `school_parent`)
   - Healthcare/caregiver (not yet built, high priority based on both mental-load
     and frequency)
   - Household (owner-occupier variant of `property`, not yet fully scoped)
   - Life-admin paperwork (tax, insurance, financial records — high long-term
     importance, currently painful)

---

## Cleanup / hygiene notes

- This doc is deliberately parked. It should not influence Phase 1 completion
  (property/school_parent/agency/construction/legal/general).
- When it becomes active work, extract the "new candidates" section into a
  prioritized backlog and turn individual candidates into GitHub issues.
- The research source's two questions (demographic focus, life-admin niche vs.
  general) need an explicit answer before any of this becomes active.
