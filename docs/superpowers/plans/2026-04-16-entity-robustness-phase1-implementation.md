# Entity Robustness Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce 3 locked per-domain spec files (`property.md`, `school_parent.md`, `agency.md`) that serve as canonical source-of-truth for the entity-robustness work, and apply an additive update to the existing strategy plan that reframes its Phase 2-5 in light of the staged fast-discovery destination.

**Architecture:** Documentation-only deliverable. No code changes. Each per-domain file follows the 8-section structure defined in the design spec, with a verbatim cross-domain preamble at the top. The existing strategy plan gets 4 surgical additive edits — no rewrites.

**Tech Stack:** Markdown only. Final commit on `feature/perf-quality-sprint`.

**Spec:** `docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md`

---

## File Structure

**Files to create:**
- `docs/domain-input-shapes/property.md` — Property domain spec (8 sections, preamble + property-specific content)
- `docs/domain-input-shapes/school_parent.md` — school_parent domain spec (8 sections, preamble + school_parent-specific content; Stage 1/Stage 2 are NEW Claude drafts for Nick's review)
- `docs/domain-input-shapes/agency.md` — agency domain spec (8 sections, preamble + agency-specific content; Stage 2 is structurally different — domain → company-name)

**Files to modify:**
- `docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md` — 4 additive edits (status banner, update block, per-phase notes, preamble appendix)

**Total scope:** 3 new files (~600-900 lines each), 1 modified file (~70 lines added).

---

## Reference: Cross-Domain Preamble (verbatim, used in all 3 spec files)

Tasks 1, 2, 3 each begin by writing this preamble at the top of their file. **It must be byte-identical across all three files** — implementer should copy from this reference block. Any change to the preamble after Task 1 ships requires updating Tasks 2 and 3 to match.

````markdown
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
````

End of preamble. ~500 words.

---

## Task 1: Write `property.md`

**Files:**
- Create: `docs/domain-input-shapes/property.md`

This is the highest-confidence file because Stage 1/Stage 2 content is copy-paste from Nick's Control Surface code, and PRIMARY/SECONDARY tables transfer verbatim from yesterday's session log lines 126-163.

- [ ] **Step 1: Create `docs/domain-input-shapes/property.md` with the cross-domain preamble at the top**

Write the file starting with `# Property — Entity Input Shapes & Discovery Spec` followed by the verbatim preamble from the Reference block above. Save the file.

- [ ] **Step 2: Append Section 1 (Mental Model) and Section 2 (Onboarding UI Copy)**

Append exactly:

````markdown

## 1. Mental Model

The user manages multiple physical properties — properties they own, manage, or have ongoing operational responsibility for. Each property has a stable address (street + number, or proper-named building, or holding-company name) that anchors emails about repairs, tenants, rent, leases, vendors, inspections, HOA, utilities, and showings. Properties exist for years; specific events (a lease signing, an inspection) are CASES under them.

## 2. Onboarding UI Copy

| Field | Value |
|---|---|
| Q1 role label | Property Manager |
| Q1 description | Tenants, vendors, maintenance |
| Q1 icon | 🏠 (`home_work`) |
| WHAT label | The properties or buildings |
| WHAT placeholder | `e.g. "123 Main St" or "Oakwood HOA"` |
| WHAT helper text | Each one becomes a separate organized group in your feed. |
| WHO label | Vendors, tenants, or key contacts |
| WHO placeholder | `e.g. "Quick Fix Plumbing" or "Sarah Chen"` |
| WHO helper text | Helps us connect emails to the right property. |
| Reassurance | A few is plenty. We'll find the rest from your email. |

**Source-of-truth pointer:** `apps/web/src/components/interview/domain-config.ts` (the `DOMAIN_CONFIGS.property` block). Copy is currently aligned with this spec; future copy edits there should round-trip back to this file.
````

- [ ] **Step 3: Append Section 3 (Stage 1 — Domain Discovery)**

Append exactly:

````markdown

## 3. Stage 1 — Domain Discovery (~5 sec)

Discovers the property-management business that handles the user's properties. In ~80% of cases the user receives mail from one or two professional property-management companies (e.g., `@judgefite.com`); in the remaining cases the user IS the property manager and the WHO discovery surfaces tenant/vendor domains.

**Gmail query (`format: 'metadata'`, last 12 months, exclude promotions):**

```
subject:("invoice" OR "repair" OR "leak" OR "rent" OR "balance" OR "statement"
  OR "application" OR "marketing" OR "lease" OR "estimate" OR "inspection"
  OR "work order" OR "renewal") -category:promotions after:{12_months_ago}
```

Source: ported verbatim from `GMAIL_CONFIG.MARKETING_KEYWORDS` in The Control Surface (`constants.ts:447`).

**Fetch shape:**
- Up to 500 messages, single `Promise.all` batch of `From`-header fetches
- No body reads, no AI calls
- Total wall: target <5 sec for 500 messages on a normal connection

**Aggregation:**
- Group by sender domain (after `@`)
- Drop generic providers from the `PUBLIC_PROVIDERS` list (`@gmail.com`, `@yahoo.com`, `@outlook.com`, `@icloud.com`, etc. — see Control Surface `constants.ts:559`)
- Sort by message count, return top 3
- Cross-check against the `PropertyManager` table for "verified by N owners" social proof if it ever lands in this codebase (currently doesn't exist; Control Surface convention)

**Confirmation UI:**
- Show top 3 candidate domains with email counts
- "This is my property manager" / "I am the property manager" toggle per domain
- User confirms 0+ domains (zero is valid — they go straight to Stage 2 with a `from:me@<userdomain>` self-search instead)

## 4. Stage 2 — Entity Discovery (~6 sec)

Given the confirmed Stage-1 domain (or self-search fallback), extract candidate property entities from subjects.

**Gmail query (`format: 'metadata'`, last 12 months):**

```
from:*@<confirmed_domain> after:{12_months_ago}
```

Or for public-provider Stage 1 results:

```
from:<specific_email_address> after:{12_months_ago}
```

**Fetch shape:**
- Up to 500 messages, batched 40 at a time in parallel (`MARKETING_BATCH_SIZE`)
- Headers only, no bodies
- Wall: target <6 sec for 500 messages

**Entity-shape regex (subjects only):**

```regex
/\b(\d{3,5})\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/g
```

Captures address-shaped tokens like `1906 Crockett`, `2310 Healey Dr`, `205 Freedom Trail`, `851 Peavy`.

**False-positive guards:**
- Numbers in `2000-2030` are treated as years and dropped (calendar/lease references, NOT addresses)

**Dedup (Levenshtein):**
- Group candidates that share a house number
- Within each group, compare display string with Levenshtein distance
- Threshold 1 for short street names (≤6 chars), threshold 2 for longer
- "2310 healey" merges into "2310 Healey Dr" (the higher-frequency or fuller spelling wins)

**Result shape:**
- Top 20 deduped candidates by frequency
- Each carries an `autoFixed` flag if Levenshtein-merged, so UI can show what was unified
- User checks/unchecks; result is the locked entity set for the deep scan

**Confirmation UI:**
- Per Stage-1-confirmed domain, show 20 candidate addresses with email counts
- Inline edit (rename) and merge affordances
- "Add another property" free-text fallback for missed entities
````

- [ ] **Step 4: Append Section 5 (PRIMARY table)**

Append exactly the table from yesterday's session log lines 132-143. Provide it verbatim:

````markdown

## 5. PRIMARY (WHAT) Entity Table

| Field | Value |
|---|---|
| Entity kind(s) | Street-addressed properties; proper-named buildings/complexes (`La Touraine`, `Empire State Building`, `Texas Tower`); holding-company names (`North 40 Partners LLC`) |
| Typical input shape(s) | `<number> <street>` minimal (`3910 Bucknell`, `851 Peavy`), `<number> <street> <street-type>` fuller (`205 Freedom Trail`), proper-name (any capitalized building/complex), corporate (`<name> LLC/LP/Inc`) |
| Canonical form rule | **User's typed input verbatim.** Never normalize. Matching is case-insensitive and punctuation-tolerant. Stage 4b only invents a new PRIMARY when the detected shape does NOT fuzzy-match any existing name or alias. |
| Aliases to GENERATE | Street-type variants (`Dr`/`Drive`/`Rd`/`Road`/`St`/etc.); casing/spacing variants; city-suffix if the city is locally obvious; common abbreviations for proper-named buildings (AI decides) |
| Aliases to **NEVER** GENERATE | Single-word fragments (`Bucknell`, `Peavy`, `Sylvan`). Bare numbers (`3910`, `851`). Generic phrases (`the house`, `the place`, `Bucknell property`). Street-type alone without number (`Bucknell Drive`). For proper-named buildings: common-word fragments (`Texas` alone, `Tower` alone, `Empire` alone). |
| Ambiguous cases (AI decides) | Punctuation variants; common-abbreviation detection (`ESB` for Empire State Building); user-typed casing normalization. Multi-unit: **units are intra-PRIMARY discriminators (case-splitting's job), never separate PRIMARIES** — applies uniformly to proper-named buildings (common, unit-keyed cases) and street addresses (rare duplex). |
| Domain shape regex/signal | Addresses: `\d+\s+[A-Z]\w+(\s+[A-Z]\w+)?(\s+(Dr\|Drive\|Rd\|Road\|St\|Street\|Ln\|Lane\|Ave\|Avenue\|Blvd\|Way\|Point\|Trail\|Ct\|Court\|Pkwy))?`. Proper-named: >1 capitalized token NOT matching address regex, repeatedly referenced in subjects. Corporate: `... (LLC\|LP\|Inc\|Co\.?)$`. |
| PRIMARY vs SECONDARY | PRIMARY = the property itself. SECONDARY = tenants, vendors, property managers, HOAs, contractors, legal counsel. Test: *"can emails about this exist without a property?"* → yes → SECONDARY; → no → PRIMARY. Units are intra-PRIMARY discriminators, never separate PRIMARIES. |
````

- [ ] **Step 5: Append Section 6 (SECONDARY table)**

Append exactly the table from yesterday's session log lines 147-157:

````markdown

## 6. SECONDARY (WHO) Entity Table

| Field | Value |
|---|---|
| Entity kind(s) | **Three sub-kinds:** (a) individual address (`timothy.bishop@judgefite.com`); (b) role inbox (`accounts@zephyr.com`); (c) domain (`@judgefite.com`) — escalated when non-generic AND has ≥N emails. |
| Typical input shape(s) | User types a name (`Timothy Bishop`, `Zephyr Property Management`) as a *search hint*. System discovers matching email addresses + candidate authoritative domains — those are the entities. |
| Canonical form rule | Address = exact string. Domain = `@<domain>` lowercased. User-typed name is the display label; identity is the address or domain string. |
| Aliases to GENERATE | The discovered email addresses for a typed name; the domain if non-generic and authoritative. **Never** name-variants. |
| Aliases to **NEVER** GENERATE | Any name-variant intended to match against email BODIES, SUBJECTS, or SIGNATURES. Body-text matching is forbidden for SECONDARIES. Only `From:`/`To:`/`Cc:` address match routes WHOs. |
| Ambiguous cases (AI decides) | Generic providers (`@gmail.com`, `@yahoo.com`, `@outlook.com`, `@icloud.com`) are NEVER promoted to domain-SECONDARY — always individual-address granularity. Same display name across multiple addresses: both valid IFF both email about confirmed PRIMARIES. One address emails about property, other emails about car purchase → only the property-email address is a SECONDARY. |
| Domain shape regex/signal | Routing signal: sender/recipient address match on `From:`/`To:`/`Cc:`. Confidence signal: address appears in threads referencing confirmed PRIMARIES. Anti-signal: address never co-occurs with any PRIMARY content → probably not a SECONDARY. |
| Anti-signals for invention (job) | A new sender/recipient becomes a SECONDARY candidate only when their content is clearly about a confirmed PRIMARY. Mortgage lender emailing about `555 Fake Street` (a schema PRIMARY) → candidate SECONDARY. Same lender emailing about user's personal home (NOT a schema PRIMARY) → NOT a SECONDARY. Newsletters, retail, SaaS-alerts unrelated to PRIMARIES → NOT SECONDARY. |
| PRIMARY vs SECONDARY | PRIMARIES = things (properties). SECONDARIES = email addresses of people/orgs interacting about them. Validation loop: user-typed SECONDARIES are the seed that validates PRIMARIES. |
````

- [ ] **Step 6: Append Section 7 (Anti-signals for AI invention) and Section 8 (Domain notes)**

Append exactly:

````markdown

## 7. Anti-signals for AI invention (deep-scan deferred path)

This is the prompt content that ships into Gemini's extraction system prompt for `domain: "property"`:

> You're deciding whether this email is actually about property management for this specific property. A surface-level name match is NOT sufficient. Judge by content — property-management emails are about repairs, tenants, rent, invoices, inspections, leases, HOA, utilities, showings. If the content is clearly about a university / product / person's unrelated surname / generic newsletter that just happens to share a word with the property name, reject it. Use your judgment.

**Concrete failure case to guard against:** the 2026-04-15 PM Property run ingested 8 Bucknell University alumni-communication emails because the alias `"Bucknell"` matched the subject. The fix lives in the alias-generation rules (Section 5: never single-word fragments) AND in this anti-signals prompt (reject content about universities). Both layers must hold.

## 8. Domain-specific notes

- **Multi-unit buildings:** units are intra-PRIMARY discriminators (case-splitting's job), never separate PRIMARIES. A unit-`102` repair belongs to the parent building's PRIMARY; case-splitting separates the unit-`102` thread from the unit-`204` thread within that PRIMARY's case set.
- **Holding companies:** corporate names (`North 40 Partners LLC`) are PRIMARIES when the user's mental model groups several properties under that umbrella for billing/legal purposes. The umbrella PRIMARY co-exists with individual property PRIMARIES — the user toggles which level they want the system to track.
- **Owner-occupied properties:** if the user lives in a property they also manage, mortgage and homeowner-insurance email about that property is in-scope (it's a managed property). Mortgage email about a separate non-schema home is out-of-scope.
- **Vacant/under-renovation properties:** still PRIMARIES even if the inbox traffic is contractor-only. The CASE timeline reflects the renovation; the PRIMARY persists.
- **Past properties (sold/divested):** PRIMARY remains for historical reference but no new emails should arrive. Future UX may add an `archived` flag — out of scope for Phase 1.
````

- [ ] **Step 7: Verify the file**

Read the file back. Confirm:
- File starts with `# Property — Entity Input Shapes & Discovery Spec` heading
- Cross-domain preamble appears verbatim (compare against the Reference block at the top of this plan — should be byte-identical)
- All 8 sections present in order: Mental Model, Onboarding UI Copy, Stage 1, Stage 2, PRIMARY table, SECONDARY table, Anti-signals, Domain notes
- No `TODO` / `TBD` / `[placeholder]` strings anywhere
- Section 5 + Section 6 tables have all 8 rows each
- Section 3 Gmail query is on one logical line (line wrapping in the markdown is OK; the query content is intact)

Run:

```bash
grep -n "^## " docs/domain-input-shapes/property.md
```

Expected output (8 numbered headings — note Cross-Domain Preamble is also `## ` but inside a blockquote, so it appears as `> ## ` and won't match this regex):
```
## 1. Mental Model
## 2. Onboarding UI Copy
## 3. Stage 1 — Domain Discovery (~5 sec)
## 4. Stage 2 — Entity Discovery (~6 sec)
## 5. PRIMARY (WHAT) Entity Table
## 6. SECONDARY (WHO) Entity Table
## 7. Anti-signals for AI invention (deep-scan deferred path)
## 8. Domain-specific notes
```

If 8 lines aren't returned, fix the missing/broken section before proceeding.

- [ ] **Step 8: Stage but DO NOT commit yet**

```bash
git add docs/domain-input-shapes/property.md
```

We commit all 4 files together at the end of Task 5 to keep the Phase 1 deliverable atomic.

---

## Task 2: Write `school_parent.md`

**Files:**
- Create: `docs/domain-input-shapes/school_parent.md`

PRIMARY/SECONDARY tables transfer verbatim from yesterday's session log lines 174-201. Stage 1/Stage 2 are NEW Claude drafts that Nick will review post-merge — call this out explicitly in the file's Section 3/4 prose so future readers know these are draft candidates not locked rules.

- [ ] **Step 1: Create `docs/domain-input-shapes/school_parent.md` with the cross-domain preamble at the top**

Write the file starting with `# school_parent — Entity Input Shapes & Discovery Spec` followed by the verbatim preamble from the Reference block at the top of this plan.

- [ ] **Step 2: Append Section 1 (Mental Model) and Section 2 (Onboarding UI Copy)**

Append exactly:

````markdown

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
````

- [ ] **Step 3: Append Section 3 (Stage 1 — Domain Discovery) — NEW DRAFT for Nick's review**

Append exactly:

````markdown

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
````

- [ ] **Step 4: Append Section 5 (PRIMARY table)**

Append exactly the table from yesterday's session log lines 174-185:

````markdown

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
````

- [ ] **Step 5: Append Section 6 (SECONDARY table)**

Append exactly the table from yesterday's session log lines 191-201:

````markdown

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
````

- [ ] **Step 6: Append Section 7 (Anti-signals for AI invention) and Section 8 (Domain notes)**

Append exactly:

````markdown

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
````

- [ ] **Step 7: Verify the file**

```bash
grep -n "^## " docs/domain-input-shapes/school_parent.md
```

Expected: 8 numbered headings (Mental Model through Domain-specific notes). Sections 3 and 4 should be visibly marked as `Status: DRAFT — Nick to review.`

- [ ] **Step 8: Stage but DO NOT commit yet**

```bash
git add docs/domain-input-shapes/school_parent.md
```

---

## Task 3: Write `agency.md`

**Files:**
- Create: `docs/domain-input-shapes/agency.md`

PRIMARY/SECONDARY tables and break-mode handling reflect today's locked decisions (Cell 1 = client-only; Cell 6 = one PRIMARY per client across engagements; Cell 3 = domain-anchored coalescence + AI-suggested merges). Stage 1 is a Claude draft for Nick's review; Stage 2 is structurally different from property/school (entity = company name, found via sender domain).

- [ ] **Step 1: Create `docs/domain-input-shapes/agency.md` with the cross-domain preamble at the top**

Write the file starting with `# agency — Entity Input Shapes & Discovery Spec` followed by the verbatim preamble from the Reference block at the top of this plan.

- [ ] **Step 2: Append Section 1 (Mental Model) and Section 2 (Onboarding UI Copy)**

Append exactly:

````markdown

## 1. Mental Model

The user works at an agency or consulting firm that serves external client companies whose email domains differ from the user's. Each client company is a PRIMARY — durable across engagements, identified primarily by the client's email domain (`@portfolioproadvisors.com`, `@anthropic.com`, `@tesla.com`). Specific engagements (a rebrand, a Q2 launch, a lunch & learn) are CASES under that client. **Internal initiatives** (the user's own products, IP, team work) are NOT in scope for this domain — those belong to the future `company-internal` domain (issue #98).

## 2. Onboarding UI Copy

| Field | Value |
|---|---|
| Q1 role label | Agency / Consulting |
| Q1 description | Your external clients — companies you serve |
| Q1 icon | 📊 (`business_center`) |
| WHAT label | Your external client companies |
| WHAT placeholder | `e.g. "Anthropic" or "Portfolio Pro Advisors"` |
| WHAT helper text | Enter the company names of your external clients. Each becomes its own organized group with all the engagements you do for them. |
| WHO label | Client contacts you email frequently |
| WHO placeholder | `e.g. "Sarah Chen at Anthropic" or "Mike Patel"` |
| WHO helper text | A few names of people you email at your client companies, so we can find associated emails. |
| Reassurance | A few names gets us started. We'll find the rest from your inbox. |

**Source-of-truth pointer:** `apps/web/src/components/interview/domain-config.ts` (the `DOMAIN_CONFIGS.agency` block + `ROLE_OPTIONS[id="agency"]`). **Note: the current code's WHAT placeholder is `"Acme Corp rebrand"` (an engagement, not a company) — this misled at least one real test user (the 2026-04-15 Consulting run). Update the code to match this spec when the next code-touching task in this domain lands.**
````

- [ ] **Step 3: Append Section 3 (Stage 1 — Domain Discovery) — NEW DRAFT for Nick's review**

Append exactly:

````markdown

## 3. Stage 1 — Domain Discovery (~5 sec)

> **Status: DRAFT — Nick to review.** Stage 1 keyword list is a Claude-drafted starting point that needs Nick's review against his real inbox before being treated as locked.

Discovers the **client domains** the user actively corresponds with. In the agency mental model, every client = its own non-user, non-generic email domain. Stage 1 separates noise (newsletters, internal threads, generic providers) from signal (`@<client>.com` domains the user emails frequently).

**Gmail query (`format: 'metadata'`, last 12 months, exclude promotions):**

```
subject:("invoice" OR "scope" OR "deliverable" OR "review" OR "deck"
  OR "proposal" OR "contract" OR "retainer" OR "kickoff" OR "status"
  OR "deadline" OR "agreement" OR "RFP" OR "SOW" OR "milestone"
  OR "feedback" OR "approval" OR "draft")
  -category:promotions after:{12_months_ago}
```

**Why these keywords (rationale for Nick's review):**
- Commercial/contract: `invoice, scope, deliverable, contract, retainer, agreement, RFP, SOW`
- Project lifecycle: `kickoff, milestone, deadline, status`
- Deliverable language: `deck, draft, review, proposal, feedback, approval`

**Fetch shape:** identical to property/school — up to 500 messages, single `Promise.all` batch, no bodies.

**Aggregation:**
- Group by sender domain
- **Drop the user's own domain** (e.g., if user is `nick@thecontrolsurface.com`, drop `@thecontrolsurface.com`) — this is the agency-specific filter that property/school don't need
- Drop generic providers from `PUBLIC_PROVIDERS`
- Sort by message count, return top **5** (agency users typically have 3-10 active clients)

**Confirmation UI:**
- Show top 5 candidate domains with email counts
- Display label derived from domain (see Stage 2 for derivation rule) — show `"Anthropic"` not `@anthropic.com`
- "This is one of my clients" toggle per domain
- User confirms 0+ domains; expected 3-8

## 4. Stage 2 — Entity Discovery (~6 sec)

**Stage 2 is structurally different from property and school.** The entity IS the company name (display label); it's *found* via the sender domain (signal). There's no subject-content regex to extract an entity from — the domain itself uniquely identifies the client.

**Algorithm:**

1. From each Stage-1-confirmed domain, run:
   ```
   from:*@<confirmed_domain> after:{12_months_ago}
   ```
   to verify volume and gather sender-display-name samples (top 50 messages is enough).
2. Derive the company-name display label using this priority order:
   - **(a)** If sender display names converge on a clear company name (e.g., 80%+ of messages have display-name pattern `<person> | Anthropic` or `<person> at Anthropic`), use that company name.
   - **(b)** Otherwise, derive from the domain: strip TLD, capitalize first letter of each segment. `anthropic.com` → `Anthropic`; `portfolio-pro-advisors.com` → `Portfolio Pro Advisors`; `sghgroup.com` → `SGH Group`.
   - **(c)** If the derived name is unclear (e.g., `xyz123.com` → `Xyz123`), flag for user editing in the confirmation UI.
3. The user confirms or edits the display label. The domain is stored as the entity's authoritative-domain attribute.

**No subject-content regex.** Property's address regex and school_parent's institution/activity regexes don't have an analog here — agency entity discovery is fully sender-domain-driven.

**Coalescence at confirmation (Cell 3 = B + C helper):**

- **Domain-anchored merge (auto-suggest):** if two user-typed names from Q2 (`PPA`, `Portfolio Pro Advisors`) both map to the same Stage-1-confirmed authoritative domain, propose a merge at the confirmation screen with the merge pre-checked. User confirms (or rejects).
- **Name-similarity merge (auto-suggest, no shared domain):** if two user-typed names with no domain overlap show high name similarity (acronym/expansion pair, e.g., `PPA` ↔ `Portfolio Pro Advisors`; or string-similarity above some threshold), propose a merge with the merge **un-checked** (user must opt in — riskier match).
- **Never auto-merge.** Always require user confirmation.

**Confirmation UI:**
- Show derived company-name display labels with email counts
- Inline edit affordance for the display label
- Inline merge affordance for any pair flagged by the coalescence rules above
- "Add another client" free-text fallback for clients not surfaced by Stage 1

**Result shape:**
- One Entity row per confirmed client
- Each Entity row carries: display label (the canonical company name), authoritative domain (`@<domain>`), source (Stage-1-discovered or user-typed-and-then-confirmed)
````

- [ ] **Step 4: Append Section 5 (PRIMARY table) — locked today**

Append exactly:

````markdown

## 5. PRIMARY (WHAT) Entity Table

| Field | Value |
|---|---|
| Entity kind(s) | **Client companies only.** External companies the user serves (Cell 1 locked 2026-04-16). Internal initiatives, the user's own products/IP, and colleague-facing work are explicitly OUT of scope — they belong to the future `company-internal` domain (issue #98). |
| Typical input shape(s) | Company name as the user thinks of it: `PPA`, `Portfolio Pro Advisors`, `Anthropic`, `Tesla`, `Stallion`. Sometimes acronym, sometimes full, sometimes both. |
| Canonical form rule | Display label = user's typed input, OR system-derived from authoritative domain when discovered without user input. **Domain-anchored coalescence** (Cell 3 = B): when two user-typed names share the same discovered authoritative domain, propose merge at confirmation. **AI-suggested name-similarity coalescence** (Cell 3 = C helper): when no shared domain but high name similarity, propose un-checked merge. Never auto-merge. |
| Aliases to GENERATE | The discovered authoritative domain. Common acronym/expansion pairs detected at confirmation (`PPA` ↔ `Portfolio Pro Advisors`). Casing/spacing variants. |
| Aliases to **NEVER** GENERATE | Generic words (`client`, `company`, `account`). Single common-word fragments of company names (e.g., `Pro` from `Portfolio Pro Advisors`). Marketing/product names from the client's brand portfolio (those are CASES, not PRIMARIES). |
| Ambiguous cases (AI decides) | Multi-year/multi-engagement clients: **one PRIMARY per client across all engagements** (Cell 6 = A locked). Engagements (`PPA rebrand`, `PPA asset-management prototype`) are CASES, not separate PRIMARIES. Future user-driven splitting via the tuning/learning UI is part of the discovery-confirm-include feedback loop, not Phase 1. |
| Domain shape regex/signal | Sender-domain-driven (no subject regex). Authoritative domain is the strongest signal: non-generic, non-user-domain, ≥N emails over the lookback window. |
| Anti-signals for invention | A subject mentioning a company name without sender-domain corroboration (e.g., user emails about Tesla in a personal context, but no `@tesla.com` traffic) → NOT a PRIMARY. Subcontractor-domain emails about a client project (`@subcontractor.com` on a PPA project) → SUBCONTRACTOR is a SECONDARY linked to PPA via `associatedPrimaryIds`, not a separate PRIMARY (break-mode #3). |
| PRIMARY vs SECONDARY | PRIMARY = the client company itself. SECONDARY = email addresses (individual / role inbox / domain) of people interacting about that client. Same WHO/WHAT framework as Property; the inversion is that for agency the WHO domain often IS the client domain (since most people emailing about Anthropic work at Anthropic). |
````

- [ ] **Step 5: Append Section 6 (SECONDARY table) — locked today**

Append exactly:

````markdown

## 6. SECONDARY (WHO) Entity Table

Three sub-kinds (same as Property/school): individual address | role inbox | domain.

| Field | Value |
|---|---|
| Entity kind(s) | Individual addresses: client contacts (`sarah.chen@anthropic.com`), subcontractor freelancers (`jane@jane-freelance.com`), the user's collaborators at the client. Role inboxes: client-side function inboxes (`accounts@anthropic.com`, `legal@tesla.com`, `marketing@portfolioproadvisors.com`). Domains: the client's authoritative domain (`@anthropic.com`) — escalated by default for agency since the client domain IS the strongest signal. |
| Typical input shape(s) | User types a person name (`Sarah Chen`, `Mike Patel`) as a search hint. System discovers matching addresses + the client's authoritative domain (already known from Stage 1) — those are the entities. |
| Canonical form rule | Address = exact string. Domain = `@<domain>` lowercased. User-typed person name is display label; identity is address (or domain for the all-of-client SECONDARY). |
| Aliases to GENERATE | Discovered addresses for the typed name. The client's authoritative domain is added as a SECONDARY automatically when the user confirms the corresponding PRIMARY at Stage 1 (every confirmed client gets a domain-SECONDARY for the all-of-client routing path). |
| Aliases to **NEVER** GENERATE | Body-text name matching (Principle #3 — same as all domains). First names alone when collision-prone. Display-name-only matches (those don't survive the address-as-identity rule). |
| Ambiguous cases (AI decides) | Generic providers (`@gmail.com`, etc.) NEVER promoted to domain-SECONDARY (break-mode #1: client on generic-provider falls back to individual-address SECONDARIES with a flag for user). Subcontractor at non-client domain working on client project: SECONDARY linked to client PRIMARY via `associatedPrimaryIds` (break-mode #3). Freelancer serving two clients: existing `associatedPrimaryIds` already handles (break-mode #4). |
| Domain shape regex/signal | Routing signal: sender/recipient address match on `From:`/`To:`/`Cc:`. Confidence signal: address shares the client's authoritative domain. Anti-signal: address never co-occurs with any client-PRIMARY content → not a SECONDARY for this schema. |
| Anti-signals for invention (job) | Marketing blasts from the client domain (`marketing@ppa.com` sending newsletters) → content-gate rejects (break-mode #6, Principle #4 compounding context). Shared-tenant domains (small businesses on the same `@somedomain.com`) → AI judgment from content coherence + user flag if confidence is low (break-mode #7). |
| PRIMARY vs SECONDARY | PRIMARIES = client companies. SECONDARIES = email addresses of people/orgs interacting about them. Validation loop: user-typed person SECONDARIES seed PRIMARY confirmation by surfacing the client domain they email from. |
````

- [ ] **Step 6: Append Section 7 (Anti-signals for AI invention) and Section 8 (Domain notes)**

Append exactly:

````markdown

## 7. Anti-signals for AI invention (deep-scan deferred path)

This is the prompt content for Gemini's extraction system prompt for `domain: "agency"`:

> You're deciding whether this email is about a client engagement for the user's agency. Relevance signals: project work (decks, proposals, reviews, drafts, deliverables), commercial/contract (invoices, scopes, retainers, SOWs), project lifecycle (kickoffs, status, milestones, deadlines), feedback and approvals. Reject: marketing blasts even from client domains (newsletters, product launches), purely internal threads from the user's own domain, social/personal exchanges with client contacts that aren't about the engagement, retail/SaaS-alerts unrelated to the engagement.

**For SECONDARY invention specifically:**

> A new sender becomes a SECONDARY candidate only when their content is clearly about a confirmed client PRIMARY. A vendor reaching out to the user's agency domain about an unrelated business pitch → NOT a SECONDARY. A subcontractor at a third-party domain working on a confirmed client's project → candidate SECONDARY linked to that client PRIMARY. A client-domain marketing inbox → NOT a SECONDARY (break-mode #6). When in doubt, prefer flagging for user confirmation over auto-promoting.

## 8. Domain-specific notes — Break Modes

The 8 break modes locked today (2026-04-16):

1. **Client on generic provider only** (`@gmail.com`) — no authoritative domain → fall back to individual-address SECONDARIES; flag for user. (Cell 3 fallback.)
2. **Client domain ≠ brand name** (`Stallion` brand, `@sghgroup.com` emails) — user confirms domain-to-brand mapping at the confirmation screen. (Stage 2 step 2(c) covers this.)
3. **Subcontractors at other domains working on client project** — PRIMARY supports multiple associated SECONDARY domains/addresses via existing `associatedPrimaryIds` pattern. No new schema needed.
4. **Freelancer serving two clients** — existing `associatedPrimaryIds` handles. No change.
5. **Sole-proprietor client** — label = user's typed string; single-address SECONDARY. Works.
6. **Marketing blast from client domain** (`marketing@ppa.com`) — content-gate rejects per Principle #4 (compounding context).
7. **Shared-tenant domains** (small businesses on shared `@somedomain.com`) — AI judgment from content coherence; may need user flag at confirmation. (Most uncertain mode; left to AI judgment per today's lock.)
8. **Internal initiatives** (`The Control Surface`-type products) — out of scope for `agency` (Cell 1 = client-only). Belongs to future `company-internal` domain (issue #98).

**Other notes:**

- **Multi-year/multi-engagement clients:** one PRIMARY per client. Engagements are CASES. Future user-driven splitting (when a single client gets noisy enough to warrant splitting into engagement-PRIMARIES) is part of the tuning/learning loop — not Phase 1. (Cell 6 = A locked.)
- **Past clients (engagement ended):** PRIMARY remains. The CASE timeline shows the engagement; new emails after the engagement ends are usually a `relationship` thread (referrals, year-end check-ins) and stay routed to that client.
- **The Consulting-run "Asset Management" failure** is the canonical input-error case: the user typed `Asset Management` (a service category) instead of the company name. The new WHAT placeholder + helper text in Section 2 directly addresses this. Round-trip the copy into `domain-config.ts` when the code-touching task lands.
````

- [ ] **Step 7: Verify the file**

```bash
grep -n "^## " docs/domain-input-shapes/agency.md
```

Expected: 8 numbered headings.

Read the file back and verify:
- Cross-domain preamble byte-identical to the property and school_parent files (manually diff if uncertain)
- All 8 break modes appear in Section 8
- Stage 2 algorithm steps 1-3 appear in Section 4
- The Consulting-run "Asset Management" failure is referenced in Section 2 and Section 8

- [ ] **Step 8: Stage but DO NOT commit yet**

```bash
git add docs/domain-input-shapes/agency.md
```

---

## Task 4: Apply additive update to existing strategy plan

**Files:**
- Modify: `docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md`

Four surgical additions. Do NOT rewrite existing sections — every Phase 2-5 paragraph stays exactly as written. Only inserts and one-line annotations.

- [ ] **Step 1: Insert "Update 2026-04-16" block right after the problem statement**

Find the line `## Proposed approach — phased` in the plan doc. Insert this block immediately BEFORE that heading:

````markdown
## Update 2026-04-16

Phase 1 strategy session completed. The work clarified that the destination of this entity-robustness effort is the **staged fast-discovery onboarding flow** (Control Surface pattern). The 6 cross-domain principles surfaced during Phase 1 — particularly Principle 5 (validation feedback loop) and Principle 6 (WHO-discovery speed constraint) — are the design DNA of that rebuild.

This plan's Phase 2-5 (prompt rewrites for hypothesis + extraction + Stage 4b trust gate + eval) remain valid but are **reframed**: they now improve the **deep-scan stage** of the new flow (~5 min, background, scanned after the user has already seen value at confirmation screens). They are no longer the primary user-experience lever.

The headline architectural work is tracked in **issue #95** (Epic: Staged fast-discovery onboarding rebuild).

**Per-domain spec files** (the locked entity rules + UI copy + Stage 1 keyword lists + Stage 2 entity-shape regex + dedup rules):
- `docs/domain-input-shapes/property.md`
- `docs/domain-input-shapes/school_parent.md`
- `docs/domain-input-shapes/agency.md`

The cross-domain preamble (6 principles + fast-discovery destination + pairing principle) is reproduced verbatim at the top of each per-domain file AND below as a new section in this plan.

See also: design spec at `docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md`.

---

````

(Note: keep the trailing `---` and blank line — they separate this update block visually from the existing `## Proposed approach — phased` heading.)

- [ ] **Step 2: Add status banner to the Phase 1 heading**

Find the existing line `### Phase 1 — Strategy session (documentation, no code)`. Replace with:

````markdown
### Phase 1 — Strategy session (documentation, no code)

> **Status: COMPLETE 2026-04-16.** Locked deliverables: `docs/domain-input-shapes/property.md`, `docs/domain-input-shapes/school_parent.md`, `docs/domain-input-shapes/agency.md`. Construction, legal, general, and company-internal domains tracked under issue #94 (remaining-domain interviews).
````

- [ ] **Step 3: Add one-line reframing notes to Phase 2, Phase 3, Phase 4, Phase 5**

For each of these existing headings, insert a single italic-blockquote line immediately after the heading (and before the existing prose):

For `### Phase 2 — Revised hypothesis prompt (alias generation)`, insert after the heading:

````markdown

> *Reframed 2026-04-16: this work improves the deep-scan stage of the fast-discovery flow (background, not user-visible). Still useful; no longer the primary UX lever. See update block above.*

````

For `### Phase 3 — Revised extraction prompt (detection rules)`, insert after the heading:

````markdown

> *Reframed 2026-04-16: same as Phase 2 — deep-scan improvement, not primary UX lever.*

````

For `### Phase 4 — Tighten Stage 4b trust gate`, insert after the heading:

````markdown

> *Reframed 2026-04-16: same as Phase 2 — deep-scan improvement, not primary UX lever.*

````

For `### Phase 5 — Eval pass + re-run Property`, insert after the heading:

````markdown

> *Reframed 2026-04-16: still measures deep-scan improvements correctly. Time-to-first-finding (Stages 1+2 = ~11 sec target) becomes the primary user-visible metric, tracked under issue #95.*

````

- [ ] **Step 4: Append the cross-domain preamble as a new section at the bottom of the plan doc**

Find the end of the file (after `## Anti-scope reminders (per Nick's feedback this session)` and its bullet list). Append:

````markdown

---

## Cross-Domain Preamble (added 2026-04-16)

The following preamble is the foundation that the per-domain spec files build on. It is reproduced verbatim here AND at the top of each `docs/domain-input-shapes/<domain>.md` file. Source-of-truth design: `docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md`.

### The destination

Onboarding is a 3-stage flow modeled on **The Control Surface** (Nick's other product, NOT this repo):

1. **Domain confirmation (~5 sec)** — Gmail `format: 'metadata'` query with a per-domain keyword list, parallel `Promise.all` of ~500 From-header fetches, group by sender domain, drop generic providers (`@gmail.com` etc.), top 3. **Zero AI.** Pure regex + counting. User confirms the relevant domain(s).
2. **Entity confirmation (~6 sec)** — `from:*@<confirmed-domain>` query in parallel, regex-extract entity shapes from subjects, Levenshtein dedup, top 20. **Zero AI.** User confirms entities.
3. **Deep scan (~5 min, background)** — Gemini extraction + Claude clustering + case synthesis on confirmed scope. The user is no longer waiting at the empty progress screen — they're already invested.

The per-domain spec files specify what makes Stages 1, 2, and 3 work for each domain. **Speed is non-negotiable for Stages 1 and 2.**

### The 6 principles

1. **Asymmetric axes.** PRIMARY = WHATs (the things being managed); SECONDARY = WHOs (email-addressable interactors). WHO signal is cheap and reliable (headers); WHAT signal is harder (subject regex + content parsing).
2. **Time-durability.** A PRIMARY exists without a date; a CASE is always tied to a date/event. Test: *"Can this exist without a date attached?"*
3. **SECONDARY = email addresses, not names.** Names are search hints; addresses are identity. Routing for SECONDARIES happens on `From:`/`To:`/`Cc:` only — never on body text. A name appearing in body or signature is NOT a SECONDARY routing signal.
4. **Compounding-context inclusion.** No single signal confirms entity membership. Candidates become real entities when multiple signals align (user-seed + content-about-confirmed-PRIMARY + recurrence + sender-reliability).
5. **Validation feedback loop.** Seeded-WHO → discovered-PRIMARY → expanded-WHO. The user's typed SECONDARIES validate PRIMARIES; new senders writing about confirmed PRIMARIES become candidate SECONDARIES. This loop IS the architectural reason Stages 1, 2, 3 exist as separate stages.
6. **Speed constraint on WHO discovery.** <10 seconds for several hundred emails, achieved via metadata-only Gmail fetches + parallel batches + regex/string-math (no AI). Slow AI work is reserved for the deep scan, after the user has already seen value.

### Pairing principle

Every per-domain entity rule ships paired with the UI copy the user sees on the matching screen. A locked PRIMARY/SECONDARY rule for a domain is incomplete without the matching Q1 description, WHAT label/placeholder/helper, and WHO label/placeholder/helper. Mismatched copy silently undoes the rules — see the Consulting run failure where the user typed "Asset Management" instead of the company name because the placeholder said `"Acme Corp rebrand"`.
````

- [ ] **Step 5: Verify the modified plan doc**

Run:

```bash
grep -n "^## \|^### \|^> \*Reframed" docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md
```

Expected output (in this order):
- `## Problem statement`
- `### Problem A — entity-coverage collapse (Stage 4b silent)`
- `### Problem B — over-inclusion via generic single-word aliases`
- `### The unifying insight`
- `## Update 2026-04-16` (NEW — inserted by Step 1)
- `## Proposed approach — phased`
- `### Phase 1 — Strategy session (documentation, no code)`
- `### Phase 2 — Revised hypothesis prompt (alias generation)`
- `> *Reframed 2026-04-16: this work improves the deep-scan stage...` (NEW — inserted by Step 3)
- `### Phase 3 — Revised extraction prompt (detection rules)`
- `> *Reframed 2026-04-16: same as Phase 2...` (NEW — inserted by Step 3)
- `### Phase 4 — Tighten Stage 4b trust gate`
- `> *Reframed 2026-04-16: same as Phase 2...` (NEW — inserted by Step 3)
- `### Phase 5 — Eval pass + re-run Property`
- `> *Reframed 2026-04-16: still measures deep-scan...` (NEW — inserted by Step 3)
- `## Acceptance criteria`
- `## Out of scope`
- `## Anti-scope reminders (per Nick's feedback this session)`
- `## Cross-Domain Preamble (added 2026-04-16)` (NEW — appended by Step 4)

If any expected line is missing, fix the missing edit before proceeding.

- [ ] **Step 6: Stage the modified plan doc**

```bash
git add docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md
```

---

## Task 5: Final verification + atomic commit

**Files:** all 4 staged from Tasks 1-4.

- [ ] **Step 1: Confirm all 4 files are staged and nothing else**

```bash
git status --short
```

Expected (order may vary):
```
A  docs/domain-input-shapes/agency.md
A  docs/domain-input-shapes/property.md
A  docs/domain-input-shapes/school_parent.md
M  docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md
```

Plus possibly unrelated unstaged files (`.claude/settings.local.json`, `consumer-research-notes.md`, etc.) — those should NOT be in the staged set. If any of those are staged, run `git reset HEAD <file>` to unstage.

- [ ] **Step 2: Verify the cross-domain preamble is byte-identical across all 3 spec files**

The preamble starts at `> ## Cross-Domain Preamble` (a blockquote line) and ends at the line `> see the Consulting run failure where the user typed "Asset Management" instead of the company name because the placeholder said \`"Acme Corp rebrand"\`.` immediately followed by a blank non-blockquote line.

Extract the preamble from each file and diff:

```bash
awk '/^> ## Cross-Domain Preamble/,/Acme Corp rebrand`\.$/' docs/domain-input-shapes/property.md > /tmp/preamble_property.txt
awk '/^> ## Cross-Domain Preamble/,/Acme Corp rebrand`\.$/' docs/domain-input-shapes/school_parent.md > /tmp/preamble_school.txt
awk '/^> ## Cross-Domain Preamble/,/Acme Corp rebrand`\.$/' docs/domain-input-shapes/agency.md > /tmp/preamble_agency.txt
diff /tmp/preamble_property.txt /tmp/preamble_school.txt
diff /tmp/preamble_property.txt /tmp/preamble_agency.txt
```

Both diffs MUST produce zero output (byte-identical). If either produces differences, fix the divergent file to match `property.md` (the reference).

- [ ] **Step 3: Verify each spec file has all 8 sections**

```bash
for f in docs/domain-input-shapes/property.md docs/domain-input-shapes/school_parent.md docs/domain-input-shapes/agency.md; do
  echo "=== $f ==="
  grep -c "^## [1-8]\." "$f"
done
```

Expected: each file reports `8`. If any reports a different number, the missing sections need to be added.

- [ ] **Step 4: Verify no placeholder strings remain**

```bash
grep -nE "TBD|TODO|\[placeholder\]|XXX|FIXME" docs/domain-input-shapes/*.md docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md
```

Expected: no output. If any matches appear, replace each placeholder with concrete content.

(Note: the Stage 1/Stage 2 sections of `school_parent.md` and `agency.md` are explicitly marked `Status: DRAFT — Nick to review.` That's not a placeholder — it's a known-status annotation. The grep above doesn't match `DRAFT` so it's fine.)

- [ ] **Step 5: Verify all internal links in the spec files resolve to existing paths**

```bash
grep -hoE "docs/[a-zA-Z0-9_/-]+\.md|apps/[a-zA-Z0-9_/.-]+\.ts" docs/domain-input-shapes/*.md docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md | sort -u | while read p; do
  if [ -f "$p" ]; then
    echo "OK $p"
  else
    echo "MISSING $p"
  fi
done | grep MISSING || echo "All links resolve."
```

Expected: `All links resolve.` If any `MISSING` lines appear, either the file path is wrong (fix the link) or the file legitimately doesn't exist yet (in which case verify the link is intentionally aspirational — e.g., a future-issue reference — and keep it).

- [ ] **Step 6: Atomic commit**

```bash
git commit -m "$(cat <<'EOF'
docs(domain-shapes): Phase 1 per-domain spec files + plan doc reframe

Adds 3 locked per-domain spec files (property, school_parent, agency) under
docs/domain-input-shapes/, each containing the cross-domain preamble (6
principles + staged fast-discovery destination + pairing principle) plus
the 8-section per-domain content (mental model, UI copy, Stage 1 keyword
list, Stage 2 entity-shape rules, PRIMARY table, SECONDARY table, AI
anti-signals, domain notes).

property.md - Stage 1/Stage 2 ported verbatim from Nick's Control Surface
code (keywords, address regex, Levenshtein dedup, year-number guard).
PRIMARY/SECONDARY tables transferred from 2026-04-15 session log.

school_parent.md - PRIMARY/SECONDARY tables transferred from 2026-04-15
session log. Stage 1 keyword list and Stage 2 entity-shape regexes (two
patterns: institutions + activities/teams) are Claude drafts marked
"Status: DRAFT - Nick to review" for inbox-validation post-merge.

agency.md - PRIMARY/SECONDARY tables reflect 2026-04-16 lock decisions
(Cell 1 = client-only, Cell 6 = one PRIMARY per client across engagements,
Cell 3 = domain-anchored coalescence + AI-suggested name-similarity
merges). Stage 2 is structurally different from property/school: entity is
the company name, found via sender domain (anthropic.com -> "Anthropic").
All 8 break modes from yesterday's session locked.

Also applies additive update to docs/superpowers/plans/2026-04-15-entity-
robustness-strategy.md: status banner on Phase 1 (COMPLETE), reframing
notes on Phase 2-5 (now deep-scan improvements, not primary UX lever),
"Update 2026-04-16" block summarizing the staged fast-discovery
clarification, and cross-domain preamble appendix.

Phase 1 deliverables now complete. Issues #94-#98 filed for remaining-
domain interviews and follow-on architecture work.

Refs: docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Confirm commit landed**

```bash
git log -1 --stat
```

Expected: HEAD commit shows the 4 files (3 created + 1 modified) with the commit message above.

- [ ] **Step 8: Update `docs/00_denim_current_status.md` with a one-paragraph entry under the next session block**

Read the current status doc to find the appropriate insertion point (likely under or after the "2026-04-15 Late-Afternoon Session" block).

Append a new section:

```markdown
## 2026-04-16 Session — Entity Robustness Phase 1 Complete

Phase 1 of the entity-robustness work shipped: 3 locked per-domain spec files (property, school_parent, agency) under `docs/domain-input-shapes/`, with cross-domain preamble (6 principles + staged fast-discovery destination from the Control Surface pattern) reproduced verbatim across all three. Strategy plan `docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md` got an additive update — Phase 1 stamped COMPLETE, Phases 2-5 reframed as deep-scan improvements (no longer the primary UX lever). Yesterday's session log marked SUPPLANTED.

The session's substantive shift: the destination of all entity-robustness work is now explicitly the **staged fast-discovery onboarding flow** modeled on Nick's Control Surface product (~5s domain confirm + ~6s entity confirm + background deep scan). Per Nick: *"this isn't a change in direction, it's a clarification."*

Issues filed: **#94** (complete remaining-domain interviews — construction, legal, general, company-internal), **#95** (Epic: staged fast-discovery onboarding rebuild — collapses 4 yesterday-follow-ups into a single epic), **#96** (domain-shape registry refactor), **#97** (home-renovation single-topic schema, future), **#98** (company-internal Q1 option, future).

Spec: `docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md`. Implementation plan: `docs/superpowers/plans/2026-04-16-entity-robustness-phase1-implementation.md`. Two commits on `feature/perf-quality-sprint`: `1a2e71d` (spec + supplanted stamp) and the implementation commit landing as part of this session.

### Next action on resume

1. Nick reviews the Stage 1 keyword lists in `school_parent.md` and `agency.md` against his real inbox; flips the `Status: DRAFT — Nick to review` markers to locked once validated.
2. With Phase 1 closed, dispatch issue #95 to the writing-plans skill for the staged fast-discovery rebuild — the larger architectural effort.
3. Or, if Nick wants to finish per-domain coverage first: dispatch issue #94 (remaining-domain interviews) using the same brainstorming flow that produced today's locked files.
```

Then commit this status update separately:

```bash
git add docs/00_denim_current_status.md
git commit -m "$(cat <<'EOF'
docs(status): log 2026-04-16 entity-robustness Phase 1 completion

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Final state check**

```bash
git log --oneline -5
```

Expected: top of log shows three new commits today —
1. The status doc update (most recent)
2. The Phase 1 deliverables (3 spec files + plan doc reframe)
3. The spec doc + supplanted stamp (already committed earlier this session as `1a2e71d`)

Phase 1 implementation complete.
