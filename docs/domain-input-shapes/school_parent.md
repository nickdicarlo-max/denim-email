# school_parent — Entity Input Shapes & Discovery Spec

> ## Cross-Domain Preamble
>
> This preamble is reproduced verbatim at the top of every per-domain spec file. If you update it here, update it in `property.md`, `school_parent.md`, and `agency.md` simultaneously. Source-of-truth design: `docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md`.
>
> ### The destination
>
> Onboarding is a 3-stage flow modeled on **The Control Surface** (Nick's other product, NOT this repo):
>
> 1. **Domain confirmation (~5 sec)** — Gmail `format: 'metadata'` query with a per-domain keyword list, parallel `Promise.all` of ~500 From-header fetches, group by sender domain, drop generic providers (`@gmail.com` etc.), top 3. **Zero AI.** Pure regex + counting. User confirms the relevant domain(s).
> 2. **Entity confirmation (~6 sec)** — `from:*@<confirmed-domain>` query in parallel, regex-extract entity shapes from subjects, Levenshtein dedup, top 20. **Zero AI.** User confirms entities.
> 3. **Deep scan (~5 min, background)** — Gemini extraction + Claude clustering + case synthesis on confirmed scope. The user is no longer waiting at the empty progress screen — they're already invested.
>
> The per-domain spec files specify what makes Stages 1, 2, and 3 work for each domain. **Speed is non-negotiable for Stages 1 and 2.**
>
> ### The 6 principles
>
> 1. **Asymmetric axes.** PRIMARY = WHATs (the things being managed); SECONDARY = WHOs (email-addressable interactors). WHO signal is cheap and reliable (headers); WHAT signal is harder (subject regex + content parsing).
> 2. **Time-durability.** A PRIMARY exists without a date; a CASE is always tied to a date/event. Test: *"Can this exist without a date attached?"*
> 3. **SECONDARY = email addresses, not names.** Names are search hints; addresses are identity. Routing for SECONDARIES happens on `From:`/`To:`/`Cc:` only — never on body text. A name appearing in body or signature is NOT a SECONDARY routing signal.
> 4. **Compounding-context inclusion.** No single signal confirms entity membership. Candidates become real entities when multiple signals align (user-seed + content-about-confirmed-PRIMARY + recurrence + sender-reliability).
> 5. **Validation feedback loop.** Seeded-WHO → discovered-PRIMARY → expanded-WHO. The user's typed SECONDARIES validate PRIMARIES; new senders writing about confirmed PRIMARIES become candidate SECONDARIES. This loop IS the architectural reason Stages 1, 2, 3 exist as separate stages.
> 6. **Speed constraint on WHO discovery.** <10 seconds for several hundred emails, achieved via metadata-only Gmail fetches + parallel batches + regex/string-math (no AI). Slow AI work is reserved for the deep scan, after the user has already seen value.
>
> ### Pairing principle
>
> Every per-domain entity rule ships paired with the UI copy the user sees on the matching screen. A locked PRIMARY/SECONDARY rule for a domain is incomplete without the matching Q1 description, WHAT label/placeholder/helper, and WHO label/placeholder/helper. Mismatched copy silently undoes the rules — see the Consulting run failure where the user typed "Asset Management" instead of the company name because the placeholder said `"Acme Corp rebrand"`.

## 1. Mental Model

The user is a parent (or guardian, grandparent, etc.) coordinating one or more children's activities, schools, and providers. Each durable topic in the child's life — a school, a sports team, a music teacher, a therapist, a church group — is a PRIMARY that persists for months or years. Specific events (a recital, a tournament, a parent-teacher conference) are CASES. The user thinks casually (`"soccer"`, `"dance"`, `"Lanier"`) — single words and short phrases dominate input.

## 2. Onboarding UI Copy

| Field | Value |
|---|---|
| Q1 role label | Parent / Family |
| Q1 description | Schools, activities, sports teams |
| Q1 icon | 👨‍👩‍👧‍👦 (`child_care`) |
| WHAT label | The schools, teams, or activities |
| WHAT placeholder | `e.g. "Vail Mountain School"` |
| WHAT helper text | Each one becomes a separate organized group in your feed. |
| WHO label | Teachers, coaches, or key contacts |
| WHO placeholder | `e.g. "Coach Martinez" or "Mrs. Patterson"` |
| WHO helper text | We'll use these to connect emails to the right activity. |
| Reassurance | Just the ones you can think of. We'll discover more from your email. |

**Source-of-truth pointer:** `apps/web/src/components/interview/domain-config.ts` (the `DOMAIN_CONFIGS.school_parent` block). Currently aligned with this spec.

## 3. Stage 1 — Domain Discovery (~5 sec)

> **Status: DRAFT — Nick to review.** Stage 1 keyword list is a Claude-drafted starting point that needs Nick's review against his real inbox before being treated as locked.

Discovers the schools, activity platforms, and care-provider organizations that touch the user's children. In contrast to property (where one or two domains usually dominate), school_parent users typically have 5-15 relevant domains — a school district, multiple activity platforms (TeamSnap, GameChanger, Class Dojo), a religious organization, and a few medical/therapy providers.

**Gmail query (`format: 'metadata'`, last 12 months, exclude promotions):**

```
subject:("practice" OR "game" OR "tournament" OR "schedule" OR "registration"
  OR "tryout" OR "recital" OR "performance" OR "pickup" OR "dropoff"
  OR "permission" OR "field trip" OR "parent" OR "teacher" OR "coach"
  OR "homework" OR "report card" OR "conference" OR "appointment")
  -category:promotions after:{12_months_ago}
```

**Why these keywords (rationale for Nick's review):**
- Sport/activity terms: `practice, game, tournament, tryout, schedule`
- School terms: `permission, field trip, parent, teacher, homework, report card, conference`
- Performance arts: `recital, performance`
- Logistics: `pickup, dropoff, registration`
- Medical/therapy: `appointment` (broad — may need narrowing)

**Fetch shape:** identical to property — up to 500 messages, single `Promise.all` batch, no bodies.

**Aggregation:**
- Group by sender domain
- Drop generic providers from `PUBLIC_PROVIDERS`
- Sort by message count, return top **5** (school_parent has more relevant domains than property — show more candidates)
- Distinguish education-domain hints: `.edu`, `.k12.<state>.us`, `<schoolname>.org` get a "School" badge in the UI
- Activity-platform domain hints: known platforms (`teamsnap.com`, `gamechanger.io`, `classdojo.com`, `signupgenius.com`, `bandapp.com`, `remind.com`, `parentsquare.com`, `leagueapps.com`, `bblearn.com`, `canvaslms.com`, `powerschool.com`, `infinitecampus.com`, `skyward.com`) get an "Activity Platform" badge

**Confirmation UI:**
- Show top 5 candidate domains with email counts and badges
- "This is my child's school / activity platform / etc." per-domain confirmation
- User confirms 0+ domains; expected confirmation count is 3-8

## 4. Stage 2 — Entity Discovery (~6 sec)

> **Status: DRAFT — Nick to review.** Two-pattern entity extraction is structurally novel for this codebase; rules need real-inbox validation.

Given confirmed Stage-1 domains, extract candidate school/activity/team/provider entities from subjects.

**Gmail query (per confirmed Stage-1 domain):**

```
from:*@<confirmed_domain> after:{12_months_ago}
```

**Entity-shape regexes (subjects only — TWO patterns):**

Pattern A — Institution / proper-named entities:

```regex
/\b(St\.?\s+\w+|[A-Z]\w+\s+(?:School|Academy|College|Preschool|Elementary|Middle|High|Prep|Montessori|YMCA|Church|Temple|Synagogue))\b/g
```

Captures: `St Agnes`, `St. Agnes`, `Saint Agnes`, `Lanier Middle`, `Vail Mountain School`, `St Mary's Academy`, `First Baptist Church`.

Pattern B — Activity/team names:

```regex
/\b(?:U\d{1,2}|[A-Z]\w{2,})\s+(?:Soccer|Football|Basketball|Baseball|Lacrosse|Hockey|Volleyball|Swimming|Track|Tennis|Golf|Dance|Ballet|Theater|Choir|Band|Orchestra|Karate|Judo|Gymnastics|Cheer)/g
```

Captures: `U11 Soccer`, `ZSA U12 Girls`, `Pia Ballet`, `Cosmos Soccer`, `Adams Lacrosse`. Sports/arts vocabulary is the anchor; the proper noun before is the team/group name.

**False-positive guards:**
- Marketing/retail subjects (e.g., `"Soccer cleats 50% off!"`) often match Pattern B. Mitigation: exclude domains with `category:promotions` already in the Stage 1 query; deeper guard requires content gate (deep-scan path).
- Generic words like `practice`, `game`, `season` alone are NOT entity names — they're event-type words. Patterns A and B both require at least one capitalized proper-noun token.

**Dedup (Levenshtein):**
- Same algorithm as property — Levenshtein threshold 1 (short ≤6 chars) / 2 (longer)
- Special-case casing/punctuation: `St Agnes` ↔ `st agnes` ↔ `St. Agnes` ↔ `Saint Agnes` all merge to the most-frequent display form
- `Lanier` and `Lanier Middle School` merge — the longer form wins as display

**Result shape:**
- Top 20 deduped candidates per confirmed domain
- Each tagged with which pattern (A or B) matched, for UI affordance
- User confirms; "Add another" free-text fallback
- A user-typed-during-Q2 entity that doesn't appear in Stage 2 results is preserved (the user's typing is authoritative)

**Confirmation UI:**
- Per Stage-1-confirmed domain, show 20 candidate entities
- Group by Pattern A (institutions) vs Pattern B (activities/teams) for visual separation
- Inline edit + merge affordances (school_parent collisions are common — `St Agnes` and `Saint Agnes` should be visibly mergeable)

## 5. PRIMARY (WHAT) Entity Table

| Field | Value |
|---|---|
| Entity kind(s) | **Any durable topic a child participates in over time.** Categories include: activities (sport/art/lesson/team), institutions (schools, camps, religious ed, after-care), health/therapy (orthodontist, speech, OT), and any user-typed label that survives the time-durability test. Not enumerating — too many valid instances. |
| Typical input shape(s) | Casual (`soccer`, `dance`, `guitar`, `Lanier`, `St Agnes`, `Dr Jensen`). Rarely formal. Single word or short phrase. |
| Canonical form rule | Display label = user's typed input. **Matching is case-insensitive and punctuation-tolerant** — `soccer`/`Soccer`/`SOCCER` are the same entity; `St Agnes`/`St. Agnes`/`Saint Agnes` are the same. Don't artificially split casual vs. formal variants. `Lanier` and `Lanier Middle School` are the same PRIMARY. |
| Aliases to GENERATE | Program/team names surfaced from content (`soccer` ↔ `ZSA U11/12 Girls`, `dance` ↔ `Pia's ballet studio`). Punctuation/casing auto-unified. Formal-name expansion when the corpus uses it (`Lanier` ↔ `Lanier Middle School`). |
| Aliases to **NEVER** GENERATE | Generic context words alone (`team`, `practice`, `lesson`, `game`, `tournament`, `season`, `class`, `fall`, `spring`). Any alias whose surface form collides with normal body/subject text. |
| Ambiguous cases (AI decides) | User-typed `Ziad Soccer` + `Cosmos Soccer` → separate PRIMARIES (user-driven split). User-typed just `soccer`, system finds two teams → one PRIMARY, teams surface as SECONDARIES or as case-splitting discriminators. **Drag-drop regrouping UI planned but deferred** — current model stands. |
| Domain shape regex/signal | Activities: short noun, 1–3 tokens. Institutions: proper-named school/camp/religious org (`St\s+\w+`, `\w+\s+(School\|Academy\|College\|Preschool\|Elementary\|Middle\|High\|Prep\|Montessori\|YMCA)`). Programs/events: institution + event noun (`St Agnes Auction`) — **surface as CASES, not PRIMARIES** (time-durability test). |
| Anti-signals for invention (job) | (See Section 7 below.) |
| PRIMARY vs SECONDARY | PRIMARY = the activity/institution itself (durable, no date attached). SECONDARY = email addresses of coaches, teachers, admins, parent-group coordinators, activity-platform role-inboxes, school-district systems, and authoritative school/camp/org domains. Same WHO principle as Property. |

## 6. SECONDARY (WHO) Entity Table

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
| Anti-signals for invention (job) | (See Section 7 below.) |
| PRIMARY vs SECONDARY | Same framework as Property. Validation loop: user-typed WHOs seed PRIMARY confirmation via content correlation. |

## 7. Anti-signals for AI invention (deep-scan deferred path)

This is the prompt content for Gemini's extraction system prompt for `domain: "school_parent"`:

> You're deciding whether this email is about the user's child's activity or school. Keyword matches alone are insufficient — retail ads for soccer gear, FIFA marketing, news articles, generic newsletters are NOT about this kid's activity. Relevance signals: registration, schedules, practice/class times, payments, teacher/coach communications, school announcements, forms, tryouts, performances, medical/therapy visits. Judge by content.

**For SECONDARY invention specifically:**

> You're deciding whether this sender is someone involved in the user's child's activities or schooling. Candidates: coaches, teachers, admins, other parents, medical/therapy providers, activity platforms, school systems. Reject: retail (kids' clothing/gear/toys), mass parenting-newsletter content marketing, social-media notifications, streaming services, shipping, banking/finance unrelated to activity payments. A sender becomes SECONDARY only when content clearly references a confirmed PRIMARY — not from volume alone.

## 8. Domain-specific notes

- **Multiple children:** the system organizes per topic, not per child. If the user has two kids both in soccer, the `soccer` PRIMARY covers both — case-splitting separates child A's threads from child B's via subject/body discriminators (children's names appear in subjects when teams are explicitly named).
- **Time-durability test for events:** `St Agnes Auction`, `Pia spring dance show`, `8th grade prom` are CASES, not PRIMARIES — they're tied to a specific date. The PRIMARY is `St Agnes` / `dance` / `8th grade`. This is the principle that fixes prior-run mistakes where the system surfaced events as discovered PRIMARIES.
- **Health/therapy providers** (orthodontist, OT, speech therapy): borderline — they're recurring relationships (PRIMARY-shaped) but emails are usually appointment-bound. Default: PRIMARY when the user explicitly enters them; otherwise the providers surface as SECONDARIES under a `medical` PRIMARY-cluster only if the user creates one.
- **Schools spanning grade transitions:** `Lanier Middle School` and `Lanier High School` are different PRIMARIES (different institutions) even when the same child attends both. Don't auto-merge across grade-level boundaries.
- **Activity platforms with multiple teams:** TeamSnap covering soccer + lacrosse + basketball is ONE SECONDARY (the platform), with `associatedPrimaryIds` linking it to all relevant PRIMARIES. Team-specific content surfaces in case discriminators, not separate SECONDARIES.
- **Drag-drop regrouping UI:** mentioned as planned but deferred. When it lands, it's part of the user-tuning/learning loop (see `feedback_core_product_loop.md` and `project_learning_loop_needed.md`).
