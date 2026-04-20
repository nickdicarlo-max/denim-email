# Issues #119 + #121 — Implementation Plan (2026-04-20)

Two scoped robustness fixes landing in the same `feature/perf-quality-sprint` branch.
Ordering: **#121 first** (affects how entities are written to DB), then **#119**
(Stage 2 dedup + UI). Both sit on top of the just-landed #117 + #102 work.

---

## Issue #121 — Populate sender aliases on `persistConfirmedEntities`

**Context:** The relevance-gate sender-bypass in `extraction.ts` looks up sender by
`resolveEntity(senderDisplayName, senderEmail, entities)` which matches `name +
aliases`. Today `aliases` is never populated on confirmed SECONDARY entities, so a
single confirmed contact whose display name varies across sends falls through the
bypass. #102 Pattern C papered over the 2026-04-19 TeamSnap case; #121 fixes the
underlying fragility.

### Key findings from repo reading

- `ConfirmedEntity` lives at `apps/web/src/lib/services/interview.ts:1097`.
- `persistConfirmedEntities` lives at `interview.ts:1121` and uses a
  `createMany(skipDuplicates) + per-label updateMany` pattern optimized for the
  confirm-click critical path (~450ms saved vs a per-row upsert loop).
- `Entity.aliases` is a `Json` column (not a Postgres array) defaulting to `"[]"`
  (`prisma/schema.prisma:362`). So merging requires JSON concat, not `array_cat`.
- The route `apps/web/src/app/api/onboarding/[schemaId]/entity-confirm/route.ts`
  currently `findUnique`s `{id, userId, phase, domain, name}`. To look up sender
  emails per confirmed WHO we need to also select `stage1UserContacts` +
  `stage1ConfirmedUserContactQueries`.
- The `@`-prefixed SECONDARY identityKey convention already encodes the
  `senderEmail` in the key itself (`@<senderEmail>` — see `entity-discovery-fn.ts`
  seed creation). This gives us a zero-DB-query way to derive the alias for
  user-seeded SECONDARY entities: strip the leading `@`. BUT the issue spec says
  "look up each confirmed WHO in `stage1UserContacts`, read its `senderEmail`". We
  use the spec's approach; the `@`-prefix stripping is a fallback but the source
  of truth is `stage1UserContacts`.

### Tasks (in order)

1. **Extend `ConfirmedEntity` interface.** Add optional `aliases?: string[]`
   (default treated as `[]`). File: `apps/web/src/lib/services/interview.ts`.
   Verification: tsc passes.

2. **Update `persistConfirmedEntities` `createMany` payload** to include
   `aliases: e.aliases ?? []`. No behavior change when caller doesn't supply
   aliases. File: `interview.ts`. Verification: tsc passes; existing integration
   test (inserts with no aliases) unchanged.

3. **Split `persistConfirmedEntities` update branch into two.**
   - Entities with no `aliases` (or empty array) → stay on the bulk
     `updateMany` path (unchanged perf).
   - Entities with non-empty `aliases` → run a per-row raw-SQL update that does a
     JSONB merge preserving existing aliases and de-duplicating:
     `aliases = to_jsonb(ARRAY(SELECT DISTINCT jsonb_array_elements_text(aliases || to_jsonb($1::text[]))))`.
     Using `$executeRaw` tagged template so the string array is parameterized.
   - In the 30-entity worst case, only SECONDARY entities with a resolved
     senderEmail take the per-row path — usually a handful at most — so the
     critical-path cost remains bounded.
   - File: `interview.ts`. Verification: tsc passes; new unit/integration test
     verifies alias merge preserves pre-existing aliases.

4. **Extend `/entity-confirm` route `findUnique` select** to include
   `stage1UserContacts` JSON. File: `apps/web/src/app/api/onboarding/[schemaId]/entity-confirm/route.ts`.
   Verification: tsc passes.

5. **Build a `query → senderEmail` Map** from `stage1UserContacts` inside the
   route handler. For each confirmed SECONDARY entity whose `displayLabel` (or
   edited label) doesn't directly resolve (user may have renamed), fall back to
   matching by the `@<senderEmail>` identityKey: if `identityKey.startsWith("@")`,
   use `identityKey.slice(1)` as the senderEmail. Then populate
   `aliases: [senderEmail]` on the outgoing `ConfirmedEntity` payload. PRIMARY
   entities: `aliases: []` (omit — default).
   File: `route.ts`. Verification: tsc passes.

6. **Update unit tests in
   `apps/web/src/app/api/onboarding/[schemaId]/entity-confirm/__tests__/route.test.ts`.**
   - Add `stage1UserContacts` to the `findUnique` mock return value.
   - Update the "returns 200" assertion to allow the route's augmented payload
     (entities with aliases populated on SECONDARY, empty on PRIMARY).
   - New case: a SECONDARY entity with `@sender@example.com` key results in
     `aliases: ["sender@example.com"]` being passed to `persistConfirmedEntities`.
   Verification: `pnpm --filter web test` green.

7. **Add an integration-style unit test for the alias-merge update path**
   (new file or addition to existing interview tests). Uses mocked Prisma
   transaction client to verify that an entity with pre-existing aliases
   receives a raw SQL execute call with the right shape. Verification:
   `pnpm --filter web test` green.

8. **Biome clean on touched files.** `pnpm biome check --apply` on the two
   files + touched tests.

9. **Commit:** `feat(interview): #121 populate sender aliases on persistConfirmedEntities`

### Non-goals

- No DB migration. `aliases` column already exists.
- No changes to `resolveEntity` (`extraction.ts`) — the consumer side. Its
  existing `name + aliases` matching logic is what benefits.
- PRIMARY entity aliases stay empty (they already derive from `name` via
  `resolveEntity` matching).

---

## Issue #119 — Property address dedup on street-suffix variants + Stage 2 React key collision

**Context:** 2026-04-19 property run produced 21 entities including 8 short/long
pairs that should have collapsed (e.g. `851 Peavy` vs `851 Peavy Road`). Two root
causes, same underlying bug:

1. `property-entity.ts::normalizeAddressKey` maps `Drive` → `Dr` but leaves short
   form (`851 Peavy`) and long form (`851 Peavy Road`) with different keys. They
   land in different `dedupByLevenshtein` buckets so they never get compared.
2. When two variants DO land in the same bucket (e.g. `1906 Crockett St` and
   `1906 Crockett Street`, both key → `1906 crockett st`), their Levenshtein
   distance is ≥ 4, well above the long-string threshold (2), so they stay
   unmerged. Two candidates with the same `key` → React duplicate-key warning
   at `phase-entity-confirmation.tsx:253`.

### Key findings from repo reading

- `dedupByLevenshtein` lives at `apps/web/src/lib/discovery/levenshtein-dedup.ts`
  (NOT `packages/engine/src/entity/matching.ts` as the issue spec speculates —
  the function `matching.ts` in the engine has different concerns). Spec also
  says "wherever it lives" so the existing path is fine.
- `extractPropertyCandidates` uses this dedup after normalizing keys with
  `STREET_TYPE_NORMALIZE`. School/agency/Pattern C all also consume
  `dedupByLevenshtein` — we must NOT change their behavior.
- The fix should be property-local: add a suffix-strip step at the property
  extractor (before calling `dedupByLevenshtein`) that makes the bucket key
  suffix-invariant. Then let Levenshtein operate on the display strings to
  decide which variant wins. School/agency/Pattern C pass no suffix list and
  get exactly today's behavior.

### Design decision (a vs b)

Issue spec offers two options:
  - (a) Pass suffix list as option to `dedupByLevenshtein`
  - (b) Add a `dedupPropertyAddresses` wrapper

Picking **(a)**. Cleaner — no duplicate function to keep in sync, and the
"strip suffix before grouping + compare" is a general enough pattern that other
domains might want it later (e.g. legal-entity "Inc.", medical-provider "MD").
The option is defaulted to undefined so school/agency behavior is identical.

### Tasks (in order)

1. **Extend `dedupByLevenshtein` signature** with an optional second arg
   `options?: { stripTrailingSuffixes?: string[] }`. When `stripTrailingSuffixes`
   is non-empty, build a case-insensitive regex that matches any of the listed
   tokens + optional trailing period at the end of the string (anchored `$`).
   Strip the suffix from BOTH:
     - the grouping `key` (so `"851 peavy"` and `"851 peavy rd"` share a bucket)
     - the comparison string for Levenshtein (so short/long forms compare
       identically).
   Keep the original `displayString` in each `DedupOutput` entry — after merge,
   pick the **longest original displayString** observed in the merged group as
   the final display (verbose wins). File:
   `apps/web/src/lib/discovery/levenshtein-dedup.ts`. Verification: tsc passes.

2. **Add suffix-allowlist constant** at top of `levenshtein-dedup.ts` or inside
   the extractor — value: `["Drive","Dr","Road","Rd","Street","St","Trail","Tr","Trl","Avenue","Ave","Lane","Ln","Court","Ct","Place","Pl","Way","Blvd","Boulevard","Terrace","Ter","Highway","Hwy"]`.
   Only stripped when at end-of-string (anchored), not mid-string.

3. **Wire into property-entity extractor.** In
   `apps/web/src/lib/discovery/property-entity.ts::extractPropertyCandidates`,
   pass `{ stripTrailingSuffixes: STREET_SUFFIXES }` to `dedupByLevenshtein`.
   Also simplify: since the dedup fn now handles suffix-invariance, we no longer
   need to pre-normalize `key` via `normalizeAddressKey` before dedup — but keep
   `normalizeAddressKey` as it's used by the test assertion and still provides
   the canonical post-dedup key. We can either (a) keep the pre-normalization
   AND pass suffixes — belt-and-suspenders, no harm — or (b) strip the
   pre-normalization. Picking (a) for minimal change. Verification: tsc passes;
   new unit test below passes.

4. **Update `dedupByLevenshtein` unit tests**
   (`apps/web/src/lib/discovery/__tests__/levenshtein-dedup.test.ts`):
   - New case: with `stripTrailingSuffixes: ["Drive","Road","Street","Trail"]`,
     the 8 short/long pairs from 2026-04-19 collapse to 8 outputs.
   - Edge: empty/undefined suffix list → behavior identical to today (regression
     guard for school/agency/Pattern C).
   - Edge: suffix in middle of string is NOT stripped.
   Verification: `pnpm --filter web test`.

5. **Update `property-entity` unit tests**
   (`apps/web/src/lib/discovery/__tests__/property-entity.test.ts`):
   - New case: `["851 Peavy", "851 Peavy Road"]` → 1 candidate,
     `displayString` is `"851 Peavy Road"` (longest form wins).
   - New case: 8-pair fixture from today's run collapses to 8.
   Verification: `pnpm --filter web test`.

6. **Fix React duplicate-key collision in
   `apps/web/src/components/onboarding/phase-entity-confirmation.tsx:253`.** The
   post-fix-1 dedup should already collapse the colliding candidates to one — so
   the duplicate-key warning disappears as a side effect. But defensively prefix
   the React key with the domain identifier so future within-domain duplicates
   can't blow up the UI: `key={`${group.confirmedDomain}-${candidate.key}`}`.
   This is a belt-and-suspenders UI fix that doesn't touch the dedup semantics.
   Verification: tsc passes; manual reasoning confirms no `picks.set`/`.get`
   semantics changed (those still use `candidate.key`).

7. **Biome clean on touched files.**

8. **Commits:**
   - `feat(discovery): #119 suffix-aware dedup in levenshtein-dedup`
   - `feat(discovery): #119 wire suffix-aware dedup into property-entity`
   - `fix(ui): #119 unique React key on Stage 2 entity candidates`

### Non-goals

- No DB migration.
- No typo-tolerance changes (the `1206 Farimont St` vs `1206 Fairmont St` case is
  best-effort — if Levenshtein absorbs it, great; if not, don't force it.)
- No changes to school/agency/Pattern C dedup behavior — their call to
  `dedupByLevenshtein` passes no options and runs through the legacy path.
- No changes to `docs/domain-input-shapes/property.md` beyond what fits in the
  commit message; that doc update is a follow-up if needed.

---

## Phase 3 — verification gates (MANDATORY)

After both tickets land:

- `pnpm typecheck` clean across all 4 workspaces.
- `pnpm -r test` clean — paste counts per workspace.
- `pnpm biome check` clean on touched files.
- New unit tests for both tickets pass.
- Skip integration tests (dev server required) + Playwright (per spec).
- Verify recent commits from earlier today (#117, #102) still green.

---

## Ordering rationale

#121 first: it only touches the write-side of confirmed entities + the
entity-confirm route, and is orthogonal to the Stage 2 discovery pipeline. No
risk of bleed into #119. After it lands, #119 touches the read-side (Stage 2
candidate shape fed into the review UI) + the UI itself. Clean separation.
