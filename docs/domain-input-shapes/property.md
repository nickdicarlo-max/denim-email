# Property — Entity Input Shapes & Discovery Spec

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

## 3. Stage 1 — Domain Confirmation

**Goal.** Surface the property-management business(es) handling the user's properties. In ~80% of cases one or two professional PM companies (e.g., `@judgefite.com`) dominate the user's inbox traffic for this schema; in the remaining cases the user IS the PM and Stage 1 surfaces tenant/vendor domains via paired-WHO triangulation.

**Signals that should produce candidates (positive):**
- A user-typed WHO whose `from:` search resolves to a non-generic domain (paired WHO → +3, solo WHO → +1).
- A user-typed WHAT whose quoted full-text search converges on a non-generic domain (+2 first hit, +1 each additional convergence).
- Multiple hints landing on the same domain compound the score.

**Signals that must NOT produce candidates (veto):**
- Generic provider domains (`gmail.com`, `yahoo.com`, `outlook.com`, `icloud.com`, etc.) at the domain level — when a confirmed WHO lives at a public provider, Stage 2 scopes to `from:<specific>@provider` instead.
- The user's own domain.
- Platform / SaaS notification domains (GitHub, Twilio, Stripe, FloSports, newsletter relays, SES / Mailchimp / Substack — see the platform denylist in code).
- Any domain whose hint-matched messages volunteer `List-Unsubscribe` headers in majority (treated as newsletter source).

**Threshold.** A candidate must clear `MIN_SCORE_THRESHOLD` (multiple signals must align, per master plan §7 principle #4). User confirmation at the review screen is the terminal gate; non-confirmed candidates are not entities.

**SLA.** < 5 seconds wall-clock. **Zero AI in the hot path** (principle #6).

**Confirmation UI.** Show scored candidate domains; let the user confirm 0+ (zero is valid — the user may be the PM themselves, in which case Stage 2 can run a self-search fallback). Review copy must match §2 Onboarding UI Copy verbatim.

## 4. Stage 2 — Entity Confirmation

**Goal.** For each confirmed Stage-1 domain, produce the candidate PRIMARY entities (properties) the user should track. The user's typed addresses are already PRIMARIES; Stage 2's job is to validate them against the inbox corpus AND surface adjacent properties the user owns but didn't type — per master plan §7 principle #5 (Seeded-WHO → discovered-PRIMARY).

**Three per-domain paths:**

1. **Short-circuit (04-22 Layer 1).** When exactly one sender email is confirmed at the domain AND that sender pairs with exactly one user WHAT, skip semantic extraction entirely and emit one synthetic PRIMARY = the paired WHAT.
2. **Public-provider scoping (04-22 Layer 2).** When the confirmed domain is a generic provider (e.g., the user's realtor emails from `@gmail.com`), Stage 2 queries `from:<specific>@provider` — never `from:*@provider`.
3. **Hint-anchored semantic extraction.** On a confirmed anchor domain (non-generic provider, multiple paired WHOs / WHATs), extract candidate PRIMARIES from the subject corpus. Filter newsletters (`-category:promotions` + `List-Unsubscribe` drop). Score each candidate with compounding signals (hint token match, confirmed-WHO sender, recurrence). Reject any that violate §5 alias-prohibition rules (see the table below — no single-word fragments, bare numbers, generic phrases, street-type-alone, or engagement/case fragments).

**What makes a PRIMARY surface:**
- Addresses the user typed as WHATs (always — even when Gemini expands `"3910 Bucknell"` → `"3910 Bucknell Drive"`, token overlap treats it as `USER_HINT` origin).
- Adjacent addresses in the anchor domain's corpus that pass §5 rules (origin = `STAGE2_GEMINI`). These let the user discover properties they forgot to type.

**SLA.** < 6 seconds wall-clock per confirmed domain (fan-out in parallel).

**Confirmation UI.** Per confirmed domain, show the candidate list with origin attribution (`From your input` vs `Denim found this`) + merge affordances. Inline edit lets the user rename or reject.

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

## 9. Implementation pointers

Procedural detail (exact Gmail queries, keyword lists, regex patterns, Levenshtein thresholds, top-N counts, fetch batch sizes) lives in code — see the files below. When implementation diverges from spec goals, the fix lands in the implementation; when the goals themselves change, this document is the source of truth that gets edited, reviewed, and dated.

| Goal | Implementation |
|---|---|
| Stage 1 orchestration | `apps/web/src/lib/discovery/stage1-orchestrator.ts` |
| Stage 1 compounding-signal scoring | `packages/engine/src/discovery/score-domain-candidates.ts` |
| Stage 1 / 2 public-provider veto | `packages/engine/src/discovery/public-providers.ts` |
| Stage 1 / 2 platform denylist | `packages/engine/src/discovery/platform-denylist.ts` |
| Stage 1 Inngest wiring | `apps/web/src/lib/inngest/domain-discovery-fn.ts` |
| Stage 2 entity discovery | `apps/web/src/lib/discovery/entity-discovery.ts` |
| Stage 2 paired-who resolver | `apps/web/src/lib/discovery/paired-who-resolver.ts` |
| Stage 2 candidate scoring | `packages/engine/src/discovery/score-entity-candidates.ts` |
| §5 alias-prohibition enforcement | `packages/engine/src/discovery/spec-validators.ts` |
| Persistence + last-chance §5 gate | `apps/web/src/lib/services/interview.ts::persistConfirmedEntities` |
| Review-screen component | `apps/web/src/components/onboarding/phase-entity-confirmation.tsx` |
| Feed chip row | `apps/web/src/components/feed/topic-chips.tsx` + `apps/web/src/app/api/feed/route.ts` |
| Tunables (thresholds, batch sizes, SLAs) | `apps/web/src/lib/config/onboarding-tunables.ts` |
| Stage 2 algorithm dispatch | `apps/web/src/lib/config/domain-shapes.ts` (`stage2Algorithm`) |

Eval harness: `apps/web/scripts/eval-onboarding.ts` exercises the full path end-to-end against fixture email data in `denim_samples_individual/`.
