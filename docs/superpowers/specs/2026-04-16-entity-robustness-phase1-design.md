# Entity Robustness — Phase 1 Strategy: Per-Domain Spec Files + Fast-Discovery Framing

**Date:** 2026-04-16
**Branch:** `feature/perf-quality-sprint`
**Supersedes/extends:** `docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md` (additive — that plan's Phase 2-5 reframed but not deleted)
**Inputs:** `docs/domain-input-shapes/2026-04-15-phase-1-session.md` (yesterday's interview output, now marked supplanted)

## Problem statement

The 2026-04-15 entity-robustness strategy plan called for a per-domain "input shapes" interview followed by prompt rewrites for the slow AI hypothesis path. Yesterday's session locked Property and school_parent tables, left agency partial, and surfaced 6 cross-domain principles plus 7 follow-up threads.

Today's session clarified the destination that made the prior work coherent: onboarding's user-experience target is the **staged fast-discovery flow** modeled on Nick's other product, **The Control Surface for property managers**. In that pattern, the user sees confirmed findings in ~5 seconds (domain confirmation) and ~6 seconds (entity confirmation) before the slow Gemini-driven deep scan even starts. Per Nick: *"this isn't a change in direction, it's a clarification."*

This spec defines the deliverables that complete Phase 1 — per-domain spec files that drive both the new fast-discovery flow AND the existing slow deep-scan prompts — and frames the architectural rebuild work as a separate epic to be planned next.

## Success Criteria

1. Three locked per-domain spec files exist under `docs/domain-input-shapes/`: `property.md`, `school_parent.md`, `agency.md`. Each includes the 8-section structure below.
2. The cross-domain preamble (6 principles + fast-discovery destination + pairing principle) is reproduced verbatim at the top of each spec file AND added as a section in the existing strategy plan.
3. The existing strategy plan (`2026-04-15-entity-robustness-strategy.md`) gets an "Update 2026-04-16" block reframing Phase 2-5 as deep-scan improvements (still valid; no longer the headline UX lever).
4. Yesterday's session log (`docs/domain-input-shapes/2026-04-15-phase-1-session.md`) gets a "Supplanted by" banner at the top pointing to the 3 per-domain files.
5. Five GitHub issues filed: #94 (remaining-domain interviews), #95 (fast-discovery rebuild epic), #96 (domain-shape registry), #97 (home-renovation), #98 (company-internal).
6. No code changes in this Phase 1 — design and documentation only.

## Cross-Domain Preamble

**Reproduced** (not referenced) at the top of each per-domain file AND added as a new section in the strategy plan. Per-domain files are self-contained for future readers/implementers; ~500 words of duplication is not a maintenance burden because these principles are foundational and won't change often. If they do change, the change is significant enough to warrant updating all three files explicitly.

### The destination

Onboarding is a 3-stage flow modeled on The Control Surface:

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

### Pairing principle (added today)

**Every per-domain entity rule ships paired with the UI copy the user sees on the matching screen.** A locked PRIMARY/SECONDARY rule for a domain is incomplete without the matching Q1 description, WHAT label/placeholder/helper, and WHO label/placeholder/helper. Mismatched copy silently undoes the rules — see the Consulting run failure where the user typed "Asset Management" instead of the company name because the placeholder said `"Acme Corp rebrand"`.

## Per-Domain Spec File Structure

Each `docs/domain-input-shapes/<domain>.md` file follows this 8-section structure:

```
# <Domain> — Entity Input Shapes & Discovery Spec

[Preamble link or reproduction]

## 1. Mental Model
One-paragraph statement of what the system assumes about this user.

## 2. Onboarding UI Copy
- Q1 role label + description
- WHAT screen label + placeholder + helper text
- WHO screen label + placeholder + helper text

## 3. Stage 1 — Domain Discovery (~5 sec)
- Gmail keyword query (the `subject:(...)` list)
- Generic-provider exclusion list reference (PUBLIC_PROVIDERS)
- Top-N to surface; confirmation UI behavior

## 4. Stage 2 — Entity Discovery (~6 sec)
- Entity-shape regex(es) and what they extract
- Dedup rule (Levenshtein thresholds; case/punctuation tolerance)
- False-positive guards (e.g., years dropped from address regex)
- Top-N to surface; confirmation UI behavior

## 5. PRIMARY (WHAT) Entity Table
8-field table format from yesterday's locks:
Entity kind(s), Typical input shape(s), Canonical form rule, Aliases to GENERATE,
Aliases to NEVER GENERATE, Ambiguous cases (AI decides), Domain shape regex/signal,
Anti-signals for invention, PRIMARY vs SECONDARY discriminator

## 6. SECONDARY (WHO) Entity Table
Same 8-field format, applied to WHO sub-kinds (individual address, role inbox, domain).

## 7. Anti-signals for AI invention (deep-scan deferred path)
The Gemini-prompt content for this domain — what to reject and why.

## 8. Domain-specific notes
Edge cases, break modes, anything else worth preserving.
```

## Per-Domain Content Source Notes

**property.md** — Stage 1/Stage 2 content is copy-paste from Control Surface code (Nick's other product, NOT this repo — reference values transcribed below):
- Keywords: `invoice OR repair OR leak OR rent OR balance OR statement OR application OR marketing OR lease OR estimate OR inspection OR work order OR renewal`
- Address regex: `/\b(\d{3,5})\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/g`
- Year-dropping guard: numbers 2000-2030 treated as years
- Dedup: Levenshtein threshold 1 (short) / 2 (longer)
- Generic providers from `PUBLIC_PROVIDERS` list

PRIMARY/SECONDARY tables are yesterday's locked content (transferred verbatim).

**school_parent.md** — Stage 1/Stage 2 are NEW. Claude drafts candidate keyword list (e.g., `practice OR game OR tournament OR registration OR tryout OR recital OR pickup OR season OR coach OR teacher`) and entity regex (likely two patterns: school/institution names + activity names) for Nick's review. PRIMARY/SECONDARY tables are yesterday's locked content.

**agency.md** — Stage 2 is structurally different from property/school. The entity is the **company name** (display label), found via the **sender domain** (signal). Stage 2 algorithm:

1. From the Stage-1-confirmed query, extract top non-generic sender domains by message count.
2. For each candidate domain, derive a display label — strip TLD and capitalize (`anthropic.com` → "Anthropic", `tesla.com` → "Tesla"). Where sender display-name patterns are richer, prefer those.
3. The user confirms the company name ("Anthropic"), never the raw domain (`@anthropic.com`).
4. The domain is stored as the entity's authoritative-domain attribute, used as the primary routing signal.
5. AI-suggested coalescence at confirmation when two user-typed names share an authoritative domain (Cell 3 = B), or when high name-similarity suggests acronym/expansion pairs without shared domain (Cell 3 = C helper).

PRIMARY/SECONDARY tables are today's locked content, including all 8 break modes and the 3 unfilled cells (Cell 1 = client-only; Cell 6 = one PRIMARY per client across engagements; Cell 3 = domain-anchored coalescence + AI-suggested merges).

## Plan-Doc Update

The existing strategy plan (`docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md`) gets four additive changes — no rewrites:

1. **"Update 2026-04-16" block** right after the problem statement, summarizing Phase 1 completion + the fast-discovery clarification + reframing of Phase 2-5 as deep-scan improvements + link to the rebuild epic #95.
2. **Phase 1 section gets a status banner** — `Status: COMPLETE 2026-04-16` with links to the three per-domain files.
3. **Phase 2 / 3 / 4 / 5 each get a one-line note** — *"This work improves the deep-scan stage of the fast-discovery flow (background, not user-visible). Still useful; no longer the primary UX lever."*
4. **Add a "Cross-domain preamble" section** at the bottom, reproducing the preamble in full so the plan doc is self-contained.

Acceptance criteria stay as-is. They still measure Phase 2-5's deep-scan improvements correctly.

## Issues to File

Five new GitHub issues:

| # | Title | Origin | Labels |
|---|---|---|---|
| #94 | Complete remaining-domain entity-robustness interviews (construction, legal, general, company-internal) | New today | `entity-robustness`, `interview` |
| #95 | Epic: Staged fast-discovery onboarding rebuild — Control Surface pattern | New today; collapses yesterday's follow-ups #1, #2, #3, #4 into a checklist inside this epic's body | `architecture`, `epic`, `onboarding` |
| #96 | Domain-shape registry — DRY config consumed by hypothesis + extraction + fast-discovery | Yesterday's #7 — separate from #95 because it's a structural refactor that can run in parallel | `refactor`, `architecture` |
| #97 | Home-renovation single-topic schema — design study | Yesterday's #6 — future-to-do | `future`, `design-study` |
| #98 | Company-internal Q1 option — design study (renamed from agency-internal) | Yesterday's #5 — future-to-do | `future`, `design-study` |

Issue #95 body contains a checklist:
- [ ] WHO-first discovery via Gmail header + regex (Stage 1) — yesterday's follow-up #1
- [ ] Entity schema model — address/domain as first-class kinds — yesterday's follow-up #2
- [ ] Review-screen UX — domain confirmation + entity confirmation flows — yesterday's follow-up #3
- [ ] Validation feedback loop pipeline integration — yesterday's follow-up #4

This avoids 4 separate issues that would all block on each other anyway.

## Session Log Hygiene

`docs/domain-input-shapes/2026-04-15-phase-1-session.md` gets a "Supplanted by" banner inserted at the top:

```
> **SUPPLANTED 2026-04-16.** This session log is preserved as the archaeology of how the Phase 1 strategy was developed. The canonical source-of-truth is now the per-domain spec files:
> - `docs/domain-input-shapes/property.md`
> - `docs/domain-input-shapes/school_parent.md`
> - `docs/domain-input-shapes/agency.md`
>
> See also: `docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md` for the design that drove the split.
```

## Out of Scope (this Phase 1)

- Construction, legal, general, company-internal spec files — captured in issue #94, deferred to a separate session
- The fast-discovery rebuild itself — captured in issue #95, deferred to its own plan
- The Entity schema model change (address/domain as first-class kinds) — captured in issue #95's checklist, prerequisite for the rebuild
- Domain-shape registry refactor — captured in issue #96, runs in parallel with the rebuild
- Code changes of any kind — this entire Phase 1 is design + documentation only

## Anti-Scope Reminders

- **Don't widen this Phase 1.** The temptation is to start drafting the construction/legal/general specs while the framework is fresh. Resist — those need their own interview sessions to lock the inputs (Nick's words from yesterday: each domain has different input shapes that warrant explicit confirmation).
- **Don't write code in Phase 1.** The fast-discovery flow has working reference code in The Control Surface; that's the implementation reference for the rebuild epic, not for this design.
- **Don't kill the existing strategy plan.** Phases 2-5 of `2026-04-15-entity-robustness-strategy.md` still produce value. The fast-discovery flow doesn't replace the deep scan — it precedes and frames it.
