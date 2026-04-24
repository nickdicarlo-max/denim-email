# agency — Entity Input Shapes & Discovery Spec

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

## 3. Stage 1 — Domain Confirmation

**Goal.** Surface the **client domains** the user actively corresponds with. In the agency mental model, every client = its own non-user, non-generic email domain. Stage 1 separates noise (newsletters, internal threads, generic providers) from signal (`@<client>.com` domains the user emails frequently).

**Signals that should produce candidates (positive):**
- User-typed client names as WHATs (`Portfolio Pro Advisors`, `Stallion`) whose quoted full-text search converges on a single non-generic domain → +2 first hit, +1 each additional convergence.
- User-typed client-contact names as WHOs (`Margaret Potter`, `George Trevino`, `Farrukh Malik`) whose `from:` search resolves to a paired WHAT's domain → +3 per confirmed pair.
- Multiple paired WHOs at the same domain compound the score and flag it as strongly anchored.

**Signals that must NOT produce candidates (veto):**
- Generic provider domains (`gmail.com`, etc.) — handled by Stage 2 public-provider scoping when a paired WHO lives there (see break mode #1).
- **The user's own domain** (agency-specific — `nick@thecontrolsurface.com` → drop `@thecontrolsurface.com`). Internal company traffic is out of scope for `agency` (see break mode #8).
- Platform / SaaS notification domains (newsletter relays, GitHub, Twilio, etc. — see the platform denylist).
- Domains whose messages carry `List-Unsubscribe` headers in majority.

**Threshold.** A candidate must clear `MIN_SCORE_THRESHOLD` (principle #4 compounding signals).

**SLA.** < 5 seconds wall-clock. **Zero AI in the hot path** (principle #6).

**Confirmation UI.** Show scored candidate domains with the display label *derived from the domain* (see §4 below — `anthropic.com` → `Anthropic`). Expected confirmation count: 3-8 clients. Review copy must match §2 Onboarding UI Copy verbatim.

## 4. Stage 2 — Entity Confirmation

**Agency Stage 2 is structurally different from property and school.** The entity IS the client company; it's *found* via the sender domain. There is NO subject-content extraction — the domain itself uniquely identifies the client. One confirmed Stage-1 domain → ONE PRIMARY entity.

**Display-label derivation priority:**
1. **User's typed WHAT (preferred when available).** When exactly one user WHAT paired with this domain (e.g., the user typed `Portfolio Pro Advisors` and all confirmed Q4 contacts at `portfolioproadvisors.com` are paired with that WHAT), use the user-typed label verbatim. This honors spec §5 "canonical form = user's typed input."
2. **Domain-derived.** Strip TLD, split on hyphens, title-case segments. `anthropic.com` → `Anthropic`; `portfolio-pro-advisors.com` → `Portfolio Pro Advisors`; `sghgroup.com` → `Sghgroup` (user edits at confirmation when the derivation is unclear).
3. **User edit at confirmation.** When the derived label looks wrong (no hyphens + ambiguous domain), the review screen offers inline rename. Break mode #2 (client domain ≠ brand name — `Stallion` brand at `@sghgroup.com`) is also handled here.

**Short-circuit path.** When exactly one sender is confirmed at the domain AND they're paired with exactly one user WHAT, Stage 2 emits one synthetic PRIMARY = the user's typed WHAT with zero AI calls. This is the common `Farrukh Malik` → `stallionis.com` → `Stallion` shape.

**Coalescence at confirmation:**
- **Domain-anchored merge (auto-suggest).** If two user-typed WHATs (`PPA`, `Portfolio Pro Advisors`) both resolve to the same authoritative domain, propose a merge with the merge pre-checked.
- **Name-similarity merge (auto-suggest, no shared domain).** Acronym/expansion pair with high string similarity → propose a merge *un*-checked (riskier match, user opts in).
- **Never auto-merge.** Always require user confirmation.

**§5 rejection path.** Engagements (`Rhodes Data Test Sample`, `KPI Dashboard Review`, `AI Session #2`, `V7 Update`) are NOT PRIMARIES — they are CASES that emerge during synthesis. Stage 2 never emits them. Similarly, single-word fragments (`Nick`, `PPA` alone), generic nouns (`client`, `project`), and short acronyms (≤3 chars without paired-WHO anchor) are rejected.

**SLA.** < 6 seconds wall-clock per confirmed domain. For the unambiguous + short-circuit paths, Stage 2 makes zero Gemini calls.

**Result shape.** One Entity row per confirmed client. Each row carries display label (the canonical company name), authoritative domain (`@<domain>`), and provenance (USER_HINT / STAGE2_SHORT_CIRCUIT / STAGE2_AGENCY_DOMAIN).

**Confirmation UI.** Show derived company-name labels with email counts. Inline edit + merge affordances per the coalescence rules above. "Add another client" free-text fallback for clients the user didn't type and Stage 1 didn't surface.

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

## 9. Implementation pointers

Procedural detail (exact Gmail queries, keyword lists, regex patterns, Levenshtein thresholds, top-N counts, fetch batch sizes) lives in code — see the files below. When implementation diverges from spec goals, the fix lands in the implementation; when the goals themselves change, this document is the source of truth that gets edited, reviewed, and dated.

| Goal | Implementation |
|---|---|
| Stage 1 orchestration | `apps/web/src/lib/discovery/stage1-orchestrator.ts` |
| Stage 1 compounding-signal scoring | `packages/engine/src/discovery/score-domain-candidates.ts` |
| Stage 1 / 2 public-provider veto | `packages/engine/src/discovery/public-providers.ts` |
| Stage 1 / 2 platform denylist | `packages/engine/src/discovery/platform-denylist.ts` |
| Stage 1 Inngest wiring | `apps/web/src/lib/inngest/domain-discovery-fn.ts` |
| Stage 2 entity discovery (includes agency-domain-derive + short-circuit) | `apps/web/src/lib/discovery/entity-discovery.ts` |
| Stage 2 paired-who resolver | `apps/web/src/lib/discovery/paired-who-resolver.ts` |
| Stage 2 candidate scoring | `packages/engine/src/discovery/score-entity-candidates.ts` |
| §5 alias-prohibition enforcement | `packages/engine/src/discovery/spec-validators.ts` |
| Persistence + last-chance §5 gate | `apps/web/src/lib/services/interview.ts::persistConfirmedEntities` |
| Review-screen component | `apps/web/src/components/onboarding/phase-entity-confirmation.tsx` |
| Feed chip row | `apps/web/src/components/feed/topic-chips.tsx` + `apps/web/src/app/api/feed/route.ts` |
| Tunables (thresholds, batch sizes, SLAs) | `apps/web/src/lib/config/onboarding-tunables.ts` |
| Stage 2 algorithm dispatch | `apps/web/src/lib/config/domain-shapes.ts` (`stage2Algorithm`) |

Eval harness: `apps/web/scripts/eval-onboarding.ts` exercises the full path end-to-end against fixture email data in `denim_samples_individual/`.
