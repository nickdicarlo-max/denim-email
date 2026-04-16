# Entity Robustness — Phase 1 Strategy Session Output

> **SUPPLANTED 2026-04-16.** This session log is preserved as the archaeology of how the Phase 1 strategy was developed. The canonical source-of-truth for the locked entity rules + UI copy + Stage 1/2 discovery specs is now the per-domain spec files:
> - `docs/domain-input-shapes/property.md`
> - `docs/domain-input-shapes/school_parent.md`
> - `docs/domain-input-shapes/agency.md`
>
> See also: `docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md` for the design that drove the split, including the cross-domain preamble (6 principles + staged fast-discovery destination).

**Date:** 2026-04-15 (evening)
**Plan:** `docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md`
**Issue:** #93
**Branch:** `feature/perf-quality-sprint`
**Participants:** Nick + Claude

## What this document is

This is the raw capture of Phase 1 of issue #93. The plan calls for per-domain files
(`docs/domain-input-shapes/school_parent.md`, `property.md`, `agency.md`) as the
source-of-truth input for Phase 2's prompt changes. This session produced two
fully-locked tables (Property, school_parent — each with PRIMARY and SECONDARY),
one partially-scoped domain (agency — mental model + break-mode enumeration, tables
deferred pending confirmation of break-mode handling), and a set of cross-domain
principles that materially reshape Phases 2–5 of the plan.

Before splitting into the per-domain files the plan envisioned, tomorrow's session
should (1) confirm the break-mode handling for `agency` and fill its tables, (2)
decide whether the cross-domain principles here warrant updating the plan itself
before Phase 2 code work begins, and (3) take the five principles below as preamble
that lives at the top of each per-domain file.

---

## Cross-domain design principles

These emerged from the session and apply to ALL domains. They should live at the top
of each per-domain file once this doc is split.

### 1. Asymmetric axes — PRIMARY vs SECONDARY

- **PRIMARY = WHATs.** The things being managed — ambiguous, need content parsing
  to identify. Properties, schools, activities, clients, projects. Names live in
  subjects and bodies; routing requires understanding what the email is *about*.
- **SECONDARY = WHOs.** Email-addressable entities interacting about the WHATs —
  reliable, surface from `From:`/`To:`/`Cc:` headers. People, role inboxes,
  organizations, domains.

Design implication: WHO signal is cheap (Gmail search + address extraction). WHAT
signal is expensive (Claude content comprehension). Prioritize WHO-led discovery in
Phases 2–3.

### 2. Time-durability — PRIMARY vs CASE

A PRIMARY has independent existence not tied to any single date:
- A property exists for years; the lease signing is a moment.
- A school exists for years; the prom is an event.
- A client engagement runs months to years; a specific launch meeting is a date.

A CASE is always tied to a date, event, or bounded activity:
- Lease signing. Prom. Q2 Launch. Inspection on March 14. Parent-teacher conference.

**Decision rule:** *"Can this exist without a date attached?"* → yes → PRIMARY;
→ no → CASE (belongs to some PRIMARY).

This fixes a prior-run mistake where `St Agnes Academic Awards` and `Pia spring
dance show` were surfaced as discovered PRIMARIES. Under this rule, they're CASES
belonging to `St Agnes` / `dance`. Phase 3 prompt gets a concrete discriminator.

### 3. SECONDARY = email addresses, not names

Names are search methods to find addresses. Addresses are identity.

- User types `Timothy Bishop` as a *hint*. System discovers `timothy.bishop@judgefite.com`.
  From that point forward, the address is the entity; the name is a label.
- Routing for SECONDARIES happens on `From:`/`To:`/`Cc:` only, **never on body text**.
  A name appearing in a subject, body, or signature is NOT a SECONDARY routing signal.
- Multiple addresses per user-typed name is expected and valid:
  `[timothy.bishop@judgefite.com, tim.bishop@personal.com, notifications@saas.com (sent on behalf of)]`
  — three SECONDARY rows, shared user-facing label.

**SECONDARY sub-kinds:**

| Sub-kind | Example | Notes |
|---|---|---|
| Individual address | `timothy.bishop@judgefite.com` | One person, one address |
| Role inbox | `accounts@zephyr.com`, `noreply@teamsnap.com` | Multiple humans behind it, or system-operated |
| Domain | `@judgefite.com` | Covers all senders from that domain, escalated when the domain is authoritative (≥N emails, not a generic provider) |

Each is a distinct Entity row. A user-typed name may expand into multiple rows:
one per discovered address + the authoritative domain if present.

### 4. Compounding-context inclusion

No single signal confirms entity membership. A candidate becomes a real entity when
multiple signals align:

- User-seed (did the user type or confirm this?)
- Content-about-confirmed-PRIMARY (does this email discuss something we already know is a PRIMARY?)
- Recurrence (does the sender appear repeatedly in the corpus?)
- Sender-reliability (does the sender send content consistent with the domain?)

Nick's words: *"making context sensitive decisions based on compounding multiple
data points, not just a single data point."* Applies to both PRIMARY and SECONDARY
invention.

### 5. Validation feedback loop

Seeded-SECONDARY → discovered-PRIMARY → expanded-SECONDARY.

Example:
1. User types SECONDARY `Timothy Bishop` during onboarding.
2. Discovery surfaces `timothy.bishop@judgefite.com` + candidate domain `@judgefite.com`.
3. Timothy emails the user about `555 Fake Street`. 10+ emails reference that address.
   → `555 Fake Street` is confirmed as a PRIMARY.
4. A new sender (`code-enforcement@cityofaustin.gov`) emails the user about
   `555 Fake Street`. Content-gated → code-enforcement becomes a candidate SECONDARY.
5. A mortgage lender emails the user about the user's *personal home* (NOT a schema
   PRIMARY). Content-gated → NOT promoted to SECONDARY for this schema.

The user's typed SECONDARIES are the *seed* that validates PRIMARIES. This loop is
not currently in the pipeline — see follow-up issues at the end of this doc.

### 6. Speed constraint on WHO discovery

WHO discovery is cheap — Gmail sender/recipient extraction + domain analysis.
Nick's experience from other projects: <10 seconds for several hundred emails.
WHAT discovery requires Claude content parsing and is an order of magnitude
slower. Phase 2/3 design should lean hard on WHO-led discovery as a speedup lever.

---

## Property — `domain: "property"`

**User-facing Q1 label (from `domain-config.ts`):** "Property Manager — Tenants, vendors, maintenance"
**WHAT prompt label:** "The properties or buildings" (e.g. `123 Main St` or `Oakwood HOA`)
**WHO prompt label:** "Vendors, tenants, or key contacts" (e.g. `Quick Fix Plumbing` or `Sarah Chen`)

### Property — PRIMARY (WHAT) — LOCKED

| Field | Value |
|---|---|
| Entity kind(s) | Street-addressed properties; proper-named buildings/complexes (`La Touraine`, `Empire State Building`, `Texas Tower`); holding-company names (`North 40 Partners LLC`) |
| Typical input shape(s) | `<number> <street>` minimal (`3910 Bucknell`, `851 Peavy`), `<number> <street> <street-type>` fuller (`205 Freedom Trail`), proper-name (any capitalized building/complex), corporate (`<name> LLC/LP/Inc`) |
| Canonical form rule | **User's typed input verbatim.** Never normalize. Matching is case-insensitive and punctuation-tolerant. Stage 4b only invents a new PRIMARY when the detected shape does NOT fuzzy-match any existing name or alias. |
| Aliases to GENERATE | Street-type variants (`Dr`/`Drive`/`Rd`/`Road`/`St`/etc.); casing/spacing variants; city-suffix if the city is locally obvious; common abbreviations for proper-named buildings (AI decides) |
| Aliases to **NEVER** GENERATE | Single-word fragments (`Bucknell`, `Peavy`, `Sylvan`). Bare numbers (`3910`, `851`). Generic phrases (`the house`, `the place`, `Bucknell property`). Street-type alone without number (`Bucknell Drive`). For proper-named buildings: common-word fragments (`Texas` alone, `Tower` alone, `Empire` alone). |
| Ambiguous cases (AI decides) | Punctuation variants; common-abbreviation detection (`ESB` for Empire State Building); user-typed casing normalization. Multi-unit: **units are intra-PRIMARY discriminators (case-splitting's job), never separate PRIMARIES** — applies uniformly to proper-named buildings (common, unit-keyed cases) and street addresses (rare duplex). |
| Domain shape regex/signal | Addresses: `\d+\s+[A-Z]\w+(\s+[A-Z]\w+)?(\s+(Dr\|Drive\|Rd\|Road\|St\|Street\|Ln\|Lane\|Ave\|Avenue\|Blvd\|Way\|Point\|Trail\|Ct\|Court\|Pkwy))?`. Proper-named: >1 capitalized token NOT matching address regex, repeatedly referenced in subjects. Corporate: `... (LLC\|LP\|Inc\|Co\.?)$`. |
| Anti-signals for invention (delegated to Gemini as a job, not enumerated) | > You're deciding whether this email is actually about property management for this specific property. A surface-level name match is NOT sufficient. Judge by content — property-management emails are about repairs, tenants, rent, invoices, inspections, leases, HOA, utilities, showings. If the content is clearly about a university / product / person's unrelated surname / generic newsletter that just happens to share a word with the property name, reject it. Use your judgment. |
| PRIMARY vs SECONDARY | PRIMARY = the property itself. SECONDARY = tenants, vendors, property managers, HOAs, contractors, legal counsel. Test: *"can emails about this exist without a property?"* → yes → SECONDARY; → no → PRIMARY. Units are intra-PRIMARY discriminators, never separate PRIMARIES. |

### Property — SECONDARY (WHO) — LOCKED

| Field | Value |
|---|---|
| Entity kind(s) | **Three sub-kinds:** (a) individual address (`timothy.bishop@judgefite.com`); (b) role inbox (`accounts@zephyr.com`); (c) domain (`@judgefite.com`) — escalated when non-generic AND has ≥N emails. |
| Typical input shape(s) | User types a name (`Timothy Bishop`, `Zephyr Property Management`) as a *search hint*. System discovers matching email addresses + candidate authoritative domains — those are the entities. |
| Canonical form rule | Address = exact string. Domain = `@<domain>` lowercased. User-typed name is the display label; identity is the address or domain string. |
| Aliases to GENERATE | The discovered email addresses for a typed name; the domain if non-generic and authoritative. **Never** name-variants. |
| Aliases to **NEVER** GENERATE | Any name-variant intended to match against email BODIES, SUBJECTS, or SIGNATURES. Body-text matching is forbidden for SECONDARIES. Only `From:`/`To:`/`Cc:` address match routes WHOs. |
| Ambiguous cases (AI decides) | Generic providers (`@gmail.com`, `@yahoo.com`, `@outlook.com`, `@icloud.com`) are NEVER promoted to domain-SECONDARY — always individual-address granularity. Same display name across multiple addresses: both valid IFF both email about confirmed PRIMARIES. One address emails about property, other emails about car purchase → only the property-email address is a SECONDARY. |
| Domain shape regex/signal | Routing signal: sender/recipient address match on `From:`/`To:`/`Cc:`. Confidence signal: address appears in threads referencing confirmed PRIMARIES. Anti-signal: address never co-occurs with any PRIMARY content → probably not a SECONDARY. |
| Anti-signals for invention (job) | > A new sender/recipient becomes a SECONDARY candidate only when their content is clearly about a confirmed PRIMARY. Mortgage lender emailing about `555 Fake Street` (a schema PRIMARY) → candidate SECONDARY. Same lender emailing about user's personal home (NOT a schema PRIMARY) → NOT a SECONDARY. Newsletters, retail, SaaS-alerts unrelated to PRIMARIES → NOT SECONDARY. |
| PRIMARY vs SECONDARY | PRIMARIES = things (properties). SECONDARIES = email addresses of people/orgs interacting about them. Validation loop: user-typed SECONDARIES are the seed that validates PRIMARIES. |

### Review-screen UX implication (Property)

Surface discovered addresses AND candidate domains inline when the user types a
SECONDARY name. User confirms each. Target: <10s per WHO. Discovery is a cheap
parallel Gmail search + domain extraction, not a Claude call.

---

## school_parent — `domain: "school_parent"`

**User-facing Q1 label:** "Parent / Family — Schools, activities, sports teams"
**WHAT prompt label:** "The schools, teams, or activities" (e.g. `Vail Mountain School`)
**WHO prompt label:** "Teachers, coaches, or key contacts" (e.g. `Coach Martinez` or `Mrs. Patterson`)

### school_parent — PRIMARY (WHAT) — LOCKED

| Field | Value |
|---|---|
| Entity kind(s) | **Any durable topic a child participates in over time.** Categories include: activities (sport/art/lesson/team), institutions (schools, camps, religious ed, after-care), health/therapy (orthodontist, speech, OT), and any user-typed label that survives the time-durability test. Not enumerating — too many valid instances. |
| Typical input shape(s) | Casual (`soccer`, `dance`, `guitar`, `Lanier`, `St Agnes`, `Dr Jensen`). Rarely formal. Single word or short phrase. |
| Canonical form rule | Display label = user's typed input. **Matching is case-insensitive and punctuation-tolerant** — `soccer`/`Soccer`/`SOCCER` are the same entity; `St Agnes`/`St. Agnes`/`Saint Agnes` are the same. Don't artificially split casual vs. formal variants. `Lanier` and `Lanier Middle School` are the same PRIMARY. |
| Aliases to GENERATE | Program/team names surfaced from content (`soccer` ↔ `ZSA U11/12 Girls`, `dance` ↔ `Pia's ballet studio`). Punctuation/casing auto-unified. Formal-name expansion when the corpus uses it (`Lanier` ↔ `Lanier Middle School`). |
| Aliases to **NEVER** GENERATE | Generic context words alone (`team`, `practice`, `lesson`, `game`, `tournament`, `season`, `class`, `fall`, `spring`). Any alias whose surface form collides with normal body/subject text. |
| Ambiguous cases (AI decides) | User-typed `Ziad Soccer` + `Cosmos Soccer` → separate PRIMARIES (user-driven split). User-typed just `soccer`, system finds two teams → one PRIMARY, teams surface as SECONDARIES or as case-splitting discriminators. **Drag-drop regrouping UI planned but deferred** — current model stands. |
| Domain shape regex/signal | Activities: short noun, 1–3 tokens. Institutions: proper-named school/camp/religious org (`St\s+\w+`, `\w+\s+(School\|Academy\|College\|Preschool\|Elementary\|Middle\|High\|Prep\|Montessori\|YMCA)`). Programs/events: institution + event noun (`St Agnes Auction`) — **surface as CASES, not PRIMARIES** (time-durability test). |
| Anti-signals for invention (job) | > You're deciding whether this email is about the user's child's activity or school. Keyword matches alone are insufficient — retail ads for soccer gear, FIFA marketing, news articles, generic newsletters are NOT about this kid's activity. Relevance signals: registration, schedules, practice/class times, payments, teacher/coach communications, school announcements, forms, tryouts, performances, medical/therapy visits. Judge by content. |
| PRIMARY vs SECONDARY | PRIMARY = the activity/institution itself (durable, no date attached). SECONDARY = email addresses of coaches, teachers, admins, parent-group coordinators, activity-platform role-inboxes, school-district systems, and authoritative school/camp/org domains. Same WHO principle as Property. |

### school_parent — SECONDARY (WHO) — LOCKED

Same three sub-kinds as Property (individual address | role inbox | domain).

| Field | Value |
|---|---|
| Entity kind(s) | Individual addresses: coaches, teachers, tutors, therapists, other parents, school admins, activity coordinators. Role inboxes: activity platforms (`noreply@teamsnap.com`, `SignUp Genius`, `GameChanger`, `LeagueApps`, `Band app`, `Class Dojo`, `Remind`, `ParentSquare`), school district systems (`Blackboard`, `Canvas`, `PowerSchool`, `Infinite Campus`, `Skyward`). Domains: `@stagnes.edu`, `@lanierisd.org`, `@<district>.k12.<state>.us`, camp/program domains. |
| Typical input shape(s) | User types a name (`Coach Mike`, `Ms. Jensen`, `Dr. Patel`). System discovers email addresses + candidate authoritative domains via sample scan. |
| Canonical form rule | Address = exact string. Domain = `@<domain>` lowercased. User-typed label is display; identity is the address or domain. |
| Aliases to GENERATE | Discovered addresses for the typed name. Domain escalation if non-generic and has ≥N emails (same rule as Property). |
| Aliases to **NEVER** GENERATE | Body-text name matching. Generic titles (`Coach`, `Dr.`, `Ms.`, `Mr.`) alone. First names alone when collision-prone. |
| Ambiguous cases (AI decides) | Generic providers (`@gmail.com`, etc.) NEVER promoted to domain-SECONDARY. Same coach across multiple activities — one SECONDARY across PRIMARIES via `associatedPrimaryIds`. Activity platform covering multiple teams (`TeamSnap`) is one SECONDARY; team-specific content surfaces in case discriminators, not separate SECONDARIES. |
| Domain shape regex/signal | Strongest signal: sender/recipient address on `From:`/`To:`/`Cc:`. School/camp domains: `.edu`, `.k12.`, `.org` with school-like subdomain. Activity platforms: recognizable no-reply patterns, platform names in display-name or sender-domain. |
| Anti-signals for invention (job) | > You're deciding whether this sender is someone involved in the user's child's activities or schooling. Candidates: coaches, teachers, admins, other parents, medical/therapy providers, activity platforms, school systems. Reject: retail (kids' clothing/gear/toys), mass parenting-newsletter content marketing, social-media notifications, streaming services, shipping, banking/finance unrelated to activity payments. A sender becomes SECONDARY only when content clearly references a confirmed PRIMARY — not from volume alone. |
| PRIMARY vs SECONDARY | Same framework as Property. Validation loop: user-typed WHOs seed PRIMARY confirmation via content correlation. |

---

## agency — `domain: "agency"` — partial (tables deferred)

**User-facing Q1 label:** "Agency / Consulting — Client projects, deliverables"
**WHAT prompt label:** "Your clients or projects" (e.g. `Acme Corp rebrand`)
**WHO prompt label:** "Client contacts or collaborators" (e.g. `Sarah at Acme`)

### Mental model (the assumption we're making for the user)

*"I work at an agency or consulting firm that serves clients whose email domain
differs from mine."*

Under that assumption:

- **PRIMARY = client company.** User enters `PPA`, `Stallion` — each is a client.
  The company IS the topic; nothing below that level is durable enough to be a PRIMARY.
- **SECONDARY = people at that client**, identified primarily by the client's **email
  domain**. `@portfolioproadvisors.com` → everyone on that domain is a PPA-SECONDARY
  by default. Individual addresses layer on top.
- **CASES = specific engagements.** `PPA lunch & learn`, `PPA asset-management prototype`,
  `Stallion brand audit`. Time-bounded inside the client relationship.

The WHO-reliability principle gets much stronger here than in property or school:
**a client's email domain is a near-perfect SECONDARY signal.** Discovery for PPA is
basically "grep senders for non-user-domain addresses that co-occur with PPA content,
bucket by their domains, show user the candidate domains to confirm."

### Break modes (enumerated, so assumptions are explicit)

| # | Break mode | Handling |
|---|---|---|
| 1 | Client on a generic provider (`@gmail.com` only) | No authoritative domain — fall back to individual-address SECONDARIES; flag for user. |
| 2 | Client domain ≠ brand name (`Stallion` brand, `@sghgroup.com` emails) | User confirms domain-to-brand mapping in review screen. |
| 3 | Subcontractors at other domains working on client project | PRIMARY supports *multiple* associated domains/addresses — not just one. |
| 4 | Freelancer serving two clients (`@jane-freelance.com`, both PPA and Stallion) | Existing `associatedPrimaryIds` already handles this. |
| 5 | Sole-proprietor client | Label = user's typed string (`Jane Smith` or `Jane Smith Consulting`). Single-address SECONDARY. Works. |
| 6 | Marketing blast from client domain (`marketing@ppa.com`) | Content-gate rejects (principle #4, compounding context). |
| 7 | Shared-tenant domains (small businesses on shared Workspace) | AI judgment from content coherence; may need user flag. |
| 8 | Internal initiatives (`The Control Surface`-type products the agency owns) | **Out of scope for this domain.** Filed as separate thread — see follow-ups. |

### The big one — colleague management

Your agency colleagues share your email domain. Everything about the `agency`
model assumes *client domain ≠ user domain*. Colleagues invert that — the core
signal doesn't work for them.

**Decision for this session:** colleague-management is OUT OF SCOPE for the `agency`
domain. Deferred to a future design thread. Options when we revisit:

- (a) Separate sibling domain `agency-internal` with different prompts and routing.
- (b) Colleague-flag on Entity within `agency` (`isInternalTeam: true` routes
  differently).
- (c) Keep out of product scope until external-client case is validated.

### Tables — DEFERRED

The PRIMARY and SECONDARY tables for `agency` need one more round with Nick to
confirm break-mode handling before they can be locked. In particular:

- Cell 3 canonical form: the Portfolio Pro Advisors ≡ PPA ≡ Portfolio Pro Advisors
  (PPA) unification case needs a concrete rule.
- Cell 6 ambiguity: multi-year/multi-engagement handling — does a returning client
  stay one PRIMARY or split per engagement?
- Cell 1 internal initiatives: deferred or first-class?

Tomorrow's session fills these.

---

## Onboarding Q1 today — current state

From `apps/web/src/components/interview/domain-config.ts`:

| Role ID | Label | Domain | Description |
|---|---|---|---|
| `parent` | Parent / Family | `school_parent` | Schools, activities, sports teams |
| `property` | Property Manager | `property` | Tenants, vendors, maintenance |
| `construction` | Construction / Contractor | `construction` | Job sites, subs, permits |
| `legal` | Attorney / Legal | `legal` | Clients, matters, filings |
| `agency` | Agency / Consulting | `agency` | Client projects, deliverables |
| `other` | Something else | `general` | Any topic you track by email |

### Per-domain input labels (WHAT / WHO)

| Domain | WHAT label + placeholder | WHO label + placeholder |
|---|---|---|
| `school_parent` | "The schools, teams, or activities" / `"Vail Mountain School"` | "Teachers, coaches, or key contacts" / `"Coach Martinez"`, `"Mrs. Patterson"` |
| `property` | "The properties or buildings" / `"123 Main St"`, `"Oakwood HOA"` | "Vendors, tenants, or key contacts" / `"Quick Fix Plumbing"`, `"Sarah Chen"` |
| `construction` | "The projects or job sites" / `"Harbor View Renovation"` | "Subcontractors, architects, or key contacts" / `"Comfort Air Solutions"`, `"Torres Engineering"` |
| `legal` | "Your clients or matters" / `"Smith v. Jones"`, `"Acme Corp"` | "Opposing counsel, courts, or key contacts" / `"Johnson & Associates"` |
| `agency` | "Your clients or projects" / `"Acme Corp rebrand"` | "Client contacts or collaborators" / `"Sarah at Acme"` |
| `general` | "The topics or projects" / `"Kitchen renovation"`, `"Book club"` | "Key people involved" / `"Contractor Mike"` |

### Open question for tomorrow

**Does each existing domain warrant unique PRIMARY/SECONDARY handling, or do some
collapse onto shared rules?** Quick thoughts per domain (to confirm):

- `school_parent` — ✅ locked this session, unique handling clear.
- `property` — ✅ locked this session, unique handling clear.
- `construction` — similar to property but project-centric (job sites replace
  addresses, phases replace unit-discriminators, subs replace tenants). Likely a
  near-clone of property with a few renamed kinds. Worth a short dedicated table.
- `legal` — PRIMARY = matter-or-client (often `<Plaintiff> v. <Defendant>` format).
  Unique shape (docket-style matter names, opposing counsel and courts as
  SECONDARIES). Distinct enough to warrant its own table.
- `agency` — partial this session. Tomorrow finish tables.
- `general` — deliberately generic. Might be the "no prompt rules, fall back to
  AI-inference" domain. Worth a call: do we give it minimal rules, or zero rules?

### Current prompt-bloat guardrail

Per the plan: **≤300 added tokens per domain block** in the hypothesis prompt.
The rules above are rich; careful phrasing required in Phase 2 to stay under budget.
A shared preamble (the six principles above) lives once at the top and is not
per-domain — that helps.

---

## Candidate new schemas / domains

These are candidate domains NOT in the current Q1 list that came up or seem worth
considering. Each would be a new entry in `domain-config.ts` with its own WHAT/WHO
copy and (if it materially differs) its own prompt rules.

### Nick-proposed

**1. Organizing work projects inside your own organization** ("colleagues" domain)
- PRIMARY = internal projects/initiatives/products
- SECONDARY = colleagues at same domain as user
- Key inversion from `agency`: user's domain == SECONDARY's domain
- Out of scope for `agency` today; may land as sibling `agency-internal` or as its
  own top-level Q1 option. Open design.

**2. Managing a home renovation** — a single-topic schema
- PRIMARY = the renovation itself (one PRIMARY, the whole project)
- CASES = phases/trades/milestones (electrical, plumbing, permits, inspection,
  cabinetry order, walkthrough, punch list, final)
- SECONDARY = contractors, architect, permit office, suppliers, inspector, lender
- Conceptually close to `construction` but user-facing copy and scope differ
  (one project, not many job sites; homeowner not contractor). Good testbed for
  "single-topic" schemas.

### Additional candidates I propose

These are domains I think match denim's value prop (durable WHATs + email-addressable
WHOs + CASES over time) and fit the template cleanly:

| Candidate | PRIMARY | CASES | SECONDARY characteristics | Notes |
|---|---|---|---|---|
| **Job search** | Companies you're applying to | Interviews, recruiter rounds, offers, thank-you notes | Recruiters, hiring managers, HR-bot role-inboxes (Greenhouse, Lever, Workday) | Time-bounded schema (most people wrap up in weeks-months); PRIMARY list churns fast |
| **Buying a home / real-estate shopping** | Candidate properties (addresses or MLS IDs) | Showings, offers, inspections, financing | Realtors, lenders, inspectors, attorneys | Very close to `property` but inverted (user is buying, not managing) — different WHO roles |
| **Wedding / event planning** | Vendors (venue, caterer, florist, DJ) + guest list as grouped SECONDARY | Contracts, deposits, RSVPs, final headcount, load-in | Vendor contacts, wedding planner, family coordinators | Time-bounded; heavy vendor-centric WHAT |
| **Medical / caregiver for a family member** | Conditions, providers, procedures | Appointments, procedures, billing cycles, prescription refills | Doctors, specialists, pharmacy role-inboxes, insurance, patient portals | Privacy-sensitive; HIPAA surface worth noting |
| **Board / advisory roles** | Boards or advisory positions you serve on | Quarterly meetings, votes, committee work | Fellow board members, CEO, secretary, counsel | Mix of individual addresses + role inboxes |
| **Academic / research sabbatical** | Research topics, grants, papers-in-flight | Submission deadlines, reviews, conferences | Co-authors, reviewers, editors, funding org role-inboxes | Proper-named projects; heavy `.edu` domain signal |
| **Philanthropy / volunteer / nonprofit engagement** | Organizations you support | Galas, appeals, board mtgs, matching-gift cycles | Development officers, nonprofit role-inboxes, donor CRM platforms | Recurring annual rhythm |
| **Small-business operations** | Suppliers + recurring customers + regulators | Orders, invoices, audits, license renewals | Supplier reps, customer contacts, accountant, city/county role-inboxes | Close to `property` pattern but inverted role (user is the business) |
| **Estate / executor / probate** | Decedent's accounts + assets | Filings, notifications, beneficiary communications | Executor attorney, financial institutions, beneficiaries, court | One-time, high-stakes, sensitive |
| **Subscription / membership / account management** | Accounts or services the user actively manages | Renewals, billing disputes, cancellations, support tickets | Each provider's support role-inbox | Extreme domain-SECONDARY prevalence |
| **Graduate school applications** | Programs you're applying to | App submission, interviews, decisions | Admissions, faculty references, program coordinators | Time-bounded (one cycle) |
| **Podcast / creator production** | Episodes, series, collaborations | Guest recordings, edits, releases, sponsor cycles | Guests, sponsors, editors, platform role-inboxes | PRIMARY shape: "episode" or "series" — novel |

### Notes on candidate-schema prioritization

Common patterns that cluster across candidates:

- **"Like Property but inverted"** cluster: home-buying, small-business ops.
  User's role flips but the mental model is similar.
- **"Time-bounded campaigns"** cluster: job search, wedding planning, grad school,
  estate. Schema has a lifecycle with a clear end.
- **"Durable recurring"** cluster: board, academic, nonprofit, medical caregiver.
  Runs indefinitely; CASES surface on a rhythm.
- **"Platform-centric"** cluster: subscription/accounts, podcast production.
  Heavy role-inbox SECONDARIES; PRIMARY is often a platform-hosted thing.

None of these need to land before `agency` completion. Filing them here so they're
not lost.

---

## Follow-up issues to file

These are threads that emerged this session, not Phase 1 deliverables. They
need their own GitHub issues so they don't get lost.

1. **WHO-first discovery speedup.** Per-WHO fast Gmail-search flow surfacing
   candidate addresses + domains, user confirms inline. Target <10s per WHO.
   Acts as a sibling or replacement path to the current Claude-heavy discovery.
   Relates to #57 (raw email cache) and the general scan-speed umbrella (#25).

2. **Entity schema model — address/domain as first-class kinds.** Today the
   `Entity` row is likely keyed by display name. The new model:
   - SECONDARY Entity row keyed by email address, with a display-label grouping
     multiple rows under one user-facing name.
   - Separate Entity row for domain-SECONDARIES keyed by `@<domain>`.
   - Same schema constraint `@@unique([schemaId, name, type])` needs revisiting —
     likely needs an `addressOrDomain` column with a separate unique constraint.
   - Migration implications non-trivial. Investigate before Phase 2 code work.

3. **Review-screen UX — discovered addresses + domains inline.** When the user
   types a SECONDARY, the review screen shows (a) candidate addresses found and
   (b) candidate authoritative domains. User confirms each. Mirrors today's
   confirm-discovery-flow but with address/domain granularity.
   - Includes: generic-provider exclusion list so we never accidentally promote
     `@gmail.com` / `@yahoo.com` / `@outlook.com` / `@icloud.com` to domain-SECONDARY.

4. **Validation feedback loop.** The seeded-SECONDARY → discovered-PRIMARY →
   expanded-SECONDARY chain is not in the current pipeline. This is a material
   new pipeline stage; needs its own design. Close to #75 (orphan mining) but
   different — this is a validation loop, not a mining pass.

5. **`agency-internal` (or colleague-flag) design.** Managing email from colleagues
   at the same domain as user. Options (a), (b), (c) in the `agency` break-mode
   section above. Needs design session.

6. **Home-renovation single-topic schema.** Whether to add as a new Q1 option or
   subsume under `general` with better defaults. Separate prompt rules if it's its
   own domain.

7. **Domain-shape registry.** If most of the domain-specific rules live in the
   hypothesis and extraction prompts, consider extracting to a structured
   `domain-shapes.ts` config that both prompts read from — same source of truth,
   DRY across two prompt files. Should be decided before Phase 2 starts.

---

## What tomorrow's session needs to do

Before Phase 2 prompt work begins:

1. **Lock agency PRIMARY + SECONDARY tables.** Confirm break-mode handling,
   fill cells.
2. **Decide whether the six cross-domain principles warrant plan-doc update.**
   If yes, update `docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md`
   Phase 2 and Phase 3 sections to reflect the new model (WHO-first discovery,
   addresses-not-names SECONDARY, time-durability PRIMARY/CASE rule).
3. **Draft shorter versions of locked tables** for `docs/domain-input-shapes/property.md`,
   `school_parent.md`, `agency.md` per the plan's original split.
4. **File the 7 follow-up issues above.** Decide which block Phase 2 and which
   are parallel.
5. **Decide construction/legal/general.** Either table them too (if they materially
   differ) or confirm they collapse onto existing domain rules.

---

## Session-specific quotes worth preserving

From Nick, verbatim — these anchor principles that might get diluted in prompt
rewrites:

- On body-text-matching for SECONDARIES: *"it would be an enormous mistake to
  look for variants of names in email bodies... we only care about senders or
  receipients who have email addresses as a way to parse out a unique person."*

- On compounding context: *"we are making context sensitive decisions based on
  compounding multiple data points, not just a single data point."*

- On the validation feedback loop: *"So Timothy Bishop emails me about a random
  Address 555 Fake Street, AND there are 10 emails about 555 Fake Street, then
  we can be sure 555 Fake Street is a primary entity that matters. So then when
  I get 1 email from code enforcement or a mortgage company about 555 Fake Street,
  then that sender IS a secondary entity."*

- On WHO-reliability: *"WHO appear inbox reliably (people email people). WHAT
  can be more ambiguous, as we have seen."*

- On time-durability: *"St Agnes is a school, a school lasts at least a year, but
  often 3 to 7 years of the same school. That school will have dozens of
  activities... St Agnes Auction, St Agnes Prom, St Agnes Homecoming. They are
  under the 'st agnes' topic, but each gets its own case, as it is connected to
  events and times and dates. St Agnes is not connected to times and dates, it
  just is."*

- On Gemini's actual job: *"what is the point of AI than to read an email and
  know whether this email is about property management or a university? it
  seems like Gemini could do this trivially easy... but the prompt is missing
  the guidance that you are reading and rejecting these to be associated with
  the topic of Property Management"*

- On discovery speed: *"In my other software projects, this method of discovery
  is VERY fast, like 10 seconds for several hundred emails."*
