# Property — Entity Input Shapes & Discovery Spec

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
