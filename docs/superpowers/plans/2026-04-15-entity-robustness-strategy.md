# Entity Robustness Strategy — Domain-Aware Input + Detection Rules

**Status:** Plan, not started
**Owner:** Nick + Claude
**Branch:** `feature/perf-quality-sprint`
**Related issues:** #75 (post-scan orphan mining), #38 (eval session 2 — relevance filtering)
**Canonical run data:** schema `01KP98PM2BNXE7D8PR7ZM1R39H` (2026-04-15 afternoon Property run)

## Problem statement

Two linked failures surfaced on the 2026-04-15 afternoon Property run, both traceable to the system's lack of **domain-aware understanding of what users enter and what entities look like in their inbox**:

### Problem A — entity-coverage collapse (Stage 4b silent)

- User entered 2 properties (`3910 Bucknell`, `851 Peavy`) — same input pattern as prior morning run (which entered `851 Peavy`, `2310 Healey`).
- Validation (Pass 1) found 1 new PRIMARY in both runs.
- Prior run: extraction's Stage 4b mid-scan PRIMARY creation spawned **7 additional properties** (1501 Sylvan, 3910 Bucknell, 205 Freedom Trail, 1906 Crockett, 2919 Sunset Point, 3305 Cardinal, 2109 Meadfoot, North 40 Partners LLC). Final schema had 10 PRIMARIES, 35 cases.
- Current run: Stage 4b spawned **zero**. Final schema had 3 PRIMARIES, 9 cases, **40 orphan emails** (included in scope but with `entityId = null`).

**Verified mechanism:** the Gemini extraction prompt at `packages/ai/src/prompts/extraction.ts:119` says *"DetectedEntities must reference entities from the known entities list. Do not invent entities."* Gemini's compliance is stochastic — prior run it invented new property addresses anyway; current run it obeyed. Stage 4b depends on Gemini returning a new PRIMARY-shaped detected entity with `type: "PRIMARY"`, which requires rule-violation to happen.

**Confirmed by same-email comparison across runs:** for gmailMessageId `19d8388ff0a2393d` (subject "1501 Sylvan - Balance"), Gemini returned `1501 Sylvan` in prior run's `detectedEntities` (because it was in the known list) but omitted it entirely from current run's output.

### Problem B — over-inclusion via generic single-word aliases

- Claude's hypothesis prompt generated `3910 Bucknell`'s aliases as `["Bucknell", "3910 Bucknell Dr", "Bucknell property", "3910"]`.
- Bucknell University / alumni / athletics emails contain the word "Bucknell" in subject or summary.
- The new subject-bypass (commit `bb23fe7`) and Stage 1 subject-match routing both key off aliases. 8 Bucknell University emails got routed to `entityId = 3910 Bucknell`. 7 landed in a case titled "Bucknell University Alumni Communications" attached to the 3910 Bucknell PRIMARY.
- The alias `"Bucknell"` alone is too broad. The alias `"3910"` alone would be even worse.

### The unifying insight

Both problems are symptoms of **Claude generating alias lists without domain-aware canonicalization rules**. Property addresses need specific alias shapes (full address + street-type variations, NOT single words). Kids' activities need different shapes (singleton name + capitalization variants). Work projects need yet others.

Right now the hypothesis prompt relies on Claude's general instincts to produce alias lists, and on Gemini's stochastic rule-following to surface new primaries. Both layers are under-specified. **Domain-aware rules at both layers fix both problems simultaneously.**

## Proposed approach — phased

### Phase 1 — Strategy session (documentation, no code)

**Scope:** start with 3 domains where Nick has strong intuition + live data. The other 3 can be filled in later (`construction`, `legal`, `general`).

- **school_parent** — Nick has kids' activities live data
- **property** (user-facing: "investment property") — Nick has live run data already
- **agency** — Nick knows this domain well

For each domain, fill in a structured table per role (PRIMARY "WHAT" and SECONDARY "WHO"). The table is designed to let blanks remain — the AI is good at pattern inference and we shouldn't try to enumerate every case manually. The *known patterns* and *known anti-patterns* anchor the domain; everything else is guidance for the AI to figure out.

**Table template** (one per domain, per role):

```
Domain: <domain>
Role: PRIMARY (WHAT) | SECONDARY (WHO)
Entity kind(s): <e.g., property address, activity name, organization, person>

| Field | Value |
|---|---|
| Typical input shape(s) | e.g., "3910 Bucknell", "851 Peavy Rd", "1501 Sylvan Drive" |
| Canonical form rule | e.g., prefer "<number> <street-name>" — do NOT require street-type |
| Alias patterns to GENERATE | e.g., "<number> <street-name> Dr", "<number> <street-name> Drive", "<number> <street-name> Road" |
| Alias patterns to NEVER GENERATE | e.g., single tokens: "Bucknell", "3910", "Peavy" |
| Ambiguous cases (AI decides) | e.g., "St Agnes" vs "Saint Agnes" vs "St. Agnes" — let AI normalize |
| Domain shape regex/signal (for mid-scan invention) | e.g., `\d+\s+[A-Z][a-z]+(\s+(Dr|Drive|Rd|Road|St|Street|Ln|Lane|Ave|Avenue))?` |
| Anti-signals for invention | e.g., subject contains "University" + street-name → likely NOT a property |
| How PRIMARY differs from SECONDARY in this domain | e.g., PRIMARY is the thing; SECONDARY is the person or org that touches the thing |
```

**Guideline — blanks are OK.** A field marked "AI decides with this hint: ..." is valid. We're not trying to write a parser; we're trying to give Claude/Gemini enough domain intuition to do the right thing. The fields in BOLD (known patterns, known anti-patterns, domain-shape signal) are the ones that must be filled — those translate directly to prompt rules.

**Context-sensitivity.** Anti-patterns depend on whether the entity is PRIMARY or SECONDARY AND what else is in the schema. A single token "Bucknell" is a bad PRIMARY alias but might be a fine alias for a SECONDARY person "Sam Bucknell." The table should note: *"this anti-pattern applies when the entity is PRIMARY in a property domain"* — not a blanket rule.

**Output locations:**
- `docs/domain-input-shapes/school_parent.md`
- `docs/domain-input-shapes/property.md`
- `docs/domain-input-shapes/agency.md`

Each file is the filled table plus short preamble about the domain's email inbox. These files are the **source of truth** — the hypothesis prompt reads structured data that mirrors these tables (see Phase 2 note on prompt bloat).

**Prompt-bloat guardrail for Phase 2.** The interview-hypothesis prompt is already substantial. The per-domain rules should be injected only for the detected domain, not all 3 at once. Budget: ≤300 added tokens per domain block.

### Phase 2 — Revised hypothesis prompt (alias generation)

Update `packages/ai/src/prompts/interview-hypothesis.ts` to:

- Take domain as a strong signal, not just a tag.
- Emit per-domain alias-generation rules into the system prompt. For `property`, rules like:
  > For property addresses (e.g., "3910 Bucknell", "851 Peavy Rd"):
  > - Always keep the FULL address as the canonical name.
  > - Aliases MAY include street-type variations: "3910 Bucknell Dr", "3910 Bucknell Drive", "3910 Bucknell Road".
  > - Aliases MAY include casing/spacing variants: "3910 Bucknell Drive" and "3910-Bucknell-Drive".
  > - Aliases MUST NOT include single-word fragments: never "Bucknell" alone, never "3910" alone, never "Peavy" alone.
  > - Aliases MUST NOT include generic phrases: "Bucknell property", "the Bucknell place" are noise.
- Similar blocks per domain (school_parent, construction, legal, agency, general).

Measurable success: the generated hypothesis's alias list for `3910 Bucknell` in the next Property run contains NO single-word entries.

### Phase 3 — Revised extraction prompt (detection rules)

Update `packages/ai/src/prompts/extraction.ts` to:

- Replace rule #4 with a **domain-aware** two-part rule:
  > DetectedEntities should prioritize references to entities from the known entities list below. Additionally, if you see a new entity that matches the shape of a domain PRIMARY (for this domain: `<domain-shape-description>`) AND is clearly named in the subject or body, include it in detectedEntities with type "PRIMARY" and a confidence score. Do NOT invent generic noun entities like "invoice", "meeting", or single-word fragments. Do NOT invent entities from signature blocks.
- The `<domain-shape-description>` is injected from the per-domain config — for `property` it says "property addresses (number + street + optional street-type)".
- Keep the signature-block exclusion from rule #7.

This lets Stage 4b fire reliably — Gemini is INSTRUCTED to invent new-primary candidates that match the domain shape, not prohibited from it.

### Phase 4 — Tighten Stage 4b trust gate

Currently (`apps/web/src/lib/services/extraction.ts:539`), Stage 4b fires if ANY of three signals are present:
- Sender is an ambiguous SECONDARY (≥2 associated primaries)
- Subject literally contains the detected entity name
- Gemini confidence ≥ 0.7

With the revised prompt, Gemini will return more new-primary candidates. The trust gate may need narrowing:
- Require subject-contains-name (drop the confidence-only branch), OR
- Apply a domain-specific regex confirmation (property addresses MUST match `\d+\s+[A-Z]\w+`) before creating the entity.

Decide empirically after Phase 3 measurement.

### Phase 5 — Eval pass + re-run Property

Expected outcomes vs current run baseline:
- Alias list for `3910 Bucknell` has 3-4 entries, all compound, no single words → Bucknell University emails go back to being excluded as `relevance:low`. **Target: ≤1 Bucknell University email attached to any 3910 Bucknell case (vs current 8).**
- Stage 4b fires ≥5 times on new property addresses → final schema has 8-10 PRIMARIES. **Target: ≤10 orphan emails (vs current 40).**
- Case count rebounds to 20+ (vs current 9). **Target: 25-35.**

## Acceptance criteria

For this plan to be called "done":
- [ ] All 5 domains have strategy docs checked in under `docs/domain-input-shapes/`.
- [ ] Hypothesis prompt renders domain-specific alias-generation rules.
- [ ] Extraction prompt replaces rule #4 with domain-aware detection guidance.
- [ ] Live Property E2E on same input shows: Bucknell University orphaned, not absorbed; ≥8 property PRIMARIES surfaced; case count 25+.
- [ ] No regression on other domains (re-run school_parent if time permits).

## Out of scope

- Post-split cross-entity email leak (Problem C from the 2026-04-15 PM analysis) — tracked separately, smaller fix in `cluster.ts` write phase.
- Post-scan orphan mining (#75) — complementary but separate.
- Prompt-caching optimization — the domain rules will grow the static prefix, which may ACCIDENTALLY help #79 (cache needs ≥1024 tokens).

## Anti-scope reminders (per Nick's feedback this session)

- Don't propose solutions without evidence from the database. Every claim in this plan is backed by a DB forensic query against `01KP98PM2BNXE7D8PR7ZM1R39H` or `01KP8MRJQJXF302KP19NB5RAVR`.
- Don't optimize prematurely. Rule #4's current wording exists for a reason (hallucination guard). Replace it with something more specific, not with nothing.
- Don't pretend the system is learning. It's not. Every schema starts fresh from hypothesis + validation. Domain-aware rules in the prompts are the closest thing to "memory" we have.
