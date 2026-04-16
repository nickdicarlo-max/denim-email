# agency — Entity Input Shapes & Discovery Spec

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

## 3. Stage 1 — Domain Discovery (~5 sec)

> **Status: LOCKED 2026-04-16.** Keyword list extended after validation against a local inbox sample (19 emails from 3 known-agency senders across two client domains). Original formal-consulting vocabulary produced 0/19 subject-match recall; the working-vocabulary additions (`call, meeting, session, update, slides, documents, demo, round, initiative, project`) raised per-email recall to 42% AND, more importantly, both client domains now land in the Stage 1 top-5 aggregation (ranks 2 and 4 of 10 candidate domains in the sample).

Discovers the **client domains** the user actively corresponds with. In the agency mental model, every client = its own non-user, non-generic email domain. Stage 1 separates noise (newsletters, internal threads, generic providers) from signal (`@<client>.com` domains the user emails frequently).

**Gmail query (`format: 'metadata'`, last 12 months, exclude promotions):**

```
subject:("invoice" OR "scope" OR "deliverable" OR "review" OR "deck"
  OR "proposal" OR "contract" OR "retainer" OR "kickoff" OR "status"
  OR "deadline" OR "agreement" OR "RFP" OR "SOW" OR "milestone"
  OR "feedback" OR "approval" OR "draft"
  OR "call" OR "meeting" OR "session" OR "update" OR "slides"
  OR "documents" OR "demo" OR "round" OR "initiative" OR "project")
  -category:promotions after:{12_months_ago}
```

**Why these keywords:**
- Commercial/contract: `invoice, scope, deliverable, contract, retainer, agreement, RFP, SOW`
- Project lifecycle: `kickoff, milestone, deadline, status`
- Deliverable language: `deck, draft, review, proposal, feedback, approval`
- Working vocabulary (added 2026-04-16 post-validation against Nick's sample inbox — the formal list alone had 0/19 recall on known-agency senders): `call, meeting, session, update, slides, documents, demo, round, initiative, project`

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
