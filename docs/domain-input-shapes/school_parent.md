# school_parent — Entity Input Shapes & Discovery Spec

> ## Cross-Domain Preamble
>
> This preamble is reproduced verbatim at the top of every per-domain spec file. If you update it here, update it in `property.md`, `school_parent.md`, and `agency.md` simultaneously. Source-of-truth design: `docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md`.
>
> ### The destination
>
> Onboarding is a 3-stage flow modeled on **The Control Surface** (Nick's other product, NOT this repo):
>
> 1. **Domain confirmation (~5 sec)** — Surface candidate sender domains where multiple signals (user hints, paired-WHO triangulation, sender volume in the lookback window) indicate the user actively corresponds about this schema's topic. **Zero AI in this hot path.** User confirms which domains are relevant.
> 2. **Entity confirmation (~6 sec)** — Produce the PRIMARY entities the user should track for each confirmed domain. Short-circuit when the pairing is unambiguous (single paired WHO + single paired WHAT); use semantic entity extraction otherwise. Every candidate must pass the per-domain §5 alias-prohibition rules. User confirms the list.
> 3. **Deep scan (~5 min, background)** — Extract, cluster, and synthesize cases on the confirmed scope. The user is no longer waiting at the empty progress screen — they're already invested.
>
> The per-domain spec files specify the GOALS that make Stages 1, 2, and 3 work for each domain. **Speed is non-negotiable for Stages 1 and 2.** Procedures (exact Gmail queries, keyword lists, regex, thresholds, top-N counts) live in code and tunables — see each file's §9 Implementation pointers.
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

## 3. Stage 1 — Domain Confirmation

**Goal.** Surface the schools, activity platforms, and care-provider organizations that touch the user's children. In contrast to property (where one or two domains dominate), school_parent users typically have 5-15 relevant domains — a school district, multiple activity platforms (TeamSnap, GameChanger, Class Dojo), a religious organization, a few medical/therapy providers.

**Signals that should produce candidates (positive):**
- Paired WHOs (coach, teacher, activity coordinator) whose `from:` search resolves to a non-generic domain → +3.
- Solo user-typed WHOs → +1 (insufficient alone; compounds).
- User-typed WHATs whose quoted full-text search converges on a non-generic domain → +2 first hit, +1 each additional convergence.
- Paired-WHO triangulation — `Ziad Allan` + `soccer` grouped → when Ziad's mail is at `email.teamsnap.com`, that domain earns the full paired-WHO credit for the soccer topic (principle #7 compound signal).

**Signals that must NOT produce candidates (veto):**
- Generic provider domains (`gmail.com`, `yahoo.com`, etc.) at the domain level — when a paired WHO lives at a public provider (Amy at `@gmail.com` paired with `lanier`), Stage 2 scopes to `from:amy@gmail.com` rather than admitting `gmail.com` as a candidate.
- The user's own domain.
- Platform / SaaS notification domains (GitHub, Twilio, Stripe, newsletter relays — see the platform denylist).
- Newsletter-shaped domains whose messages carry `List-Unsubscribe` headers in majority.

**Domain shape hints the review UI should surface:**
- Education domain tells: `.edu`, `.k12.<state>.us`, `<schoolname>.org`.
- Known activity-platform tells: `teamsnap.com`, `gamechanger.io`, `classdojo.com`, `signupgenius.com`, `bandapp.com`, `remind.com`, `parentsquare.com`, `leagueapps.com`, `bblearn.com`, `canvaslms.com`, `powerschool.com`, `infinitecampus.com`, `skyward.com`.

The review UI may badge candidates accordingly ("School", "Activity Platform") to help the user recognize them.

**Threshold.** A candidate must clear `MIN_SCORE_THRESHOLD` (principle #4 compounding signals). User confirmation at the review screen is the terminal gate.

**SLA.** < 5 seconds wall-clock. **Zero AI in the hot path** (principle #6).

**Confirmation UI.** Show scored candidates with badges; expected confirmation count is 3-8 domains. Review copy must match §2 Onboarding UI Copy verbatim.

## 4. Stage 2 — Entity Confirmation

**Goal.** For each confirmed Stage-1 domain, produce the candidate PRIMARY entities (schools, activities, teams, providers) the user should track. Per §8 domain-specific notes, *teams and program names are aliases UNDER the parent topic PRIMARY*, not separate PRIMARIES — a TeamSnap account's `ZSA U11/12 Girls Competitive Rise` is an alias for the user's `soccer` WHAT, not a peer entity.

**Three per-domain paths:**

1. **Short-circuit (04-22 Layer 1, tuned for this domain).** When exactly one sender email is confirmed at the domain AND that sender pairs with exactly one user WHAT — the canonical case (`Ziad Allan` → `email.teamsnap.com` → `soccer`) — skip semantic extraction entirely and emit one synthetic PRIMARY = the user's typed WHAT. Team-specific content (`ZSA U11/12 Girls`, `Rise ECNL`, `Houston Select`) surfaces during case synthesis as case-splitting discriminators, not as Stage 2 entities.
2. **Public-provider scoping (04-22 Layer 2).** When the confirmed domain is a generic provider (Amy DiCarlo at `@gmail.com` paired with `lanier`, `st agnes`, `guitar`), scope the Stage 2 query to `from:amy@gmail.com` only.
3. **Hint-anchored semantic extraction.** On an anchor domain without an unambiguous short-circuit, extract candidate PRIMARIES from subjects. Filter newsletters (`-category:promotions` + `List-Unsubscribe` drop). Score each candidate with compounding signals. Reject §5 violations (no generic context words — `team`, `practice`, `game`, `season`, `fall`, `spring` — no seasonal+year descriptors, no engagement/event fragments).

**What makes a PRIMARY surface:**
- User-typed WHATs (`soccer`, `dance`, `Lanier`, `St Agnes`) — always, via the short-circuit path or token-overlap matching when Gemini expands display forms.
- Adjacent activities / institutions the user didn't type but the corpus reveals (new sport, new school) — subject to §5 rules.

**What does NOT surface as a PRIMARY:**
- Specific team names or season variants under a parent topic (`ZSA U11/12 Girls Competitive Rise` under `soccer`) — these are aliases / case-splitting discriminators.
- Event names like `St Agnes Auction`, `Pia Spring Dance Show`, `8th grade prom` — these are CASES, time-tied.

**SLA.** < 6 seconds wall-clock per confirmed domain (fan-out in parallel).

**Confirmation UI.** Per confirmed domain, show the candidate list with origin attribution. Inline edit + merge affordances are important for this domain (`St Agnes` ↔ `Saint Agnes` ↔ `St. Agnes` should be visibly mergeable). "Add another" free-text fallback covers anything Stage 2 missed.

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

## 9. Implementation pointers

Procedural detail (exact Gmail queries, keyword lists, regex patterns, Levenshtein thresholds, top-N counts, fetch batch sizes) lives in code — see the files below. When implementation diverges from spec goals, the fix lands in the implementation; when the goals themselves change, this document is the source of truth that gets edited, reviewed, and dated.

| Goal | Implementation |
|---|---|
| Stage 1 orchestration | `apps/web/src/lib/discovery/stage1-orchestrator.ts` |
| Stage 1 compounding-signal scoring | `packages/engine/src/discovery/score-domain-candidates.ts` |
| Stage 1 / 2 public-provider veto | `packages/engine/src/discovery/public-providers.ts` |
| Stage 1 / 2 platform denylist | `packages/engine/src/discovery/platform-denylist.ts` |
| Stage 1 Inngest wiring | `apps/web/src/lib/inngest/domain-discovery-fn.ts` |
| Stage 2 entity discovery + short-circuit + public-provider scoping | `apps/web/src/lib/discovery/entity-discovery.ts` |
| Stage 2 paired-who resolver | `apps/web/src/lib/discovery/paired-who-resolver.ts` |
| Stage 2 candidate scoring | `packages/engine/src/discovery/score-entity-candidates.ts` |
| §5 alias-prohibition enforcement | `packages/engine/src/discovery/spec-validators.ts` |
| Persistence + last-chance §5 gate | `apps/web/src/lib/services/interview.ts::persistConfirmedEntities` |
| Review-screen component | `apps/web/src/components/onboarding/phase-entity-confirmation.tsx` |
| Feed chip row | `apps/web/src/components/feed/topic-chips.tsx` + `apps/web/src/app/api/feed/route.ts` |
| Tunables (thresholds, batch sizes, SLAs) | `apps/web/src/lib/config/onboarding-tunables.ts` |
| Stage 2 algorithm dispatch | `apps/web/src/lib/config/domain-shapes.ts` (`stage2Algorithm`) |

Eval harness: `apps/web/scripts/eval-onboarding.ts` exercises the full path end-to-end against fixture email data in `denim_samples_individual/`.
