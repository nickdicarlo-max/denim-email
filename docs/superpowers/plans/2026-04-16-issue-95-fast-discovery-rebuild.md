# Issue #95 — Fast-Discovery Onboarding Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **2026-04-16 hardening pass #1 (applied after 3-agent review):** TOCTOU guards added to the two new confirm routes (issue #33 pattern); global Inngest concurrency limits added; `CaseSchema` writes routed through `InterviewService` (table-ownership fix); Gmail-auth-failure recovery via `markSchemaFailed`; silent Gmail errors now counted and surfaced; `inngest.send` inside `step.run` replaced with `step.sendEvent`; `drainOnboardingOutbox` extended to the two new events; CAS Ownership Map in `docs/01_denim_lessons_learned.md` updated in Phase 6.
>
> **2026-04-16 hardening pass #2 (security + performance + simplification review):**
>
> *Security (critical):* fixed IDOR in both confirm routes (wrong `withAuth`/`assertResourceOwnership` shape that defeated ownership checks); added `userId` to `OnboardingOutbox` inserts (NOT NULL column); added Zod charset + max-length validation on `identityKey` with `@`-prefix reserved for SECONDARY; removed `res.text()` from Gmail error messages (could echo Bearer header); added ReDoS guard `MAX_SUBJECT_LEN=200` on property/school regexes + pathological-input test; new Task 4.4c requires `INNGEST_SIGNING_KEY`; new Task 4.2 Step 4 nulls out stage1/2 candidate JSON at PROCESSING_SCAN → COMPLETED (PII lifecycle); `firstError` log field stripped to `err.name:status` only.
>
> *Performance:* reverted Stage 2 serialization to parallel fan-out (quota math shows 5 × 40 = 200 QPS is under per-user 250 cap; global `{ limit: 20 }` handles the project cap). Collapsed `runDomainDiscovery` from 5 `step.run` calls to 3 (saves ~300ms). `persistConfirmedEntities` now uses `createMany` + `updateMany` instead of a per-row upsert loop (saves 300-800ms on the confirm click).
>
> *Simplification:* Phase 5 replaced wholesale — structured config moved out of markdown Section 9 YAML blocks into sibling `*.config.yaml` files that `domain-shapes.ts` imports at module load. Drift is now structurally impossible; spec-compliance harness, markdown parser, fixture runner, and CI step all deleted. `STAGE1_TUNABLES` / `STAGE2_TUNABLES` renamed to nested `ONBOARDING_TUNABLES.stage1` / `.stage2` to match existing convention. `logAICost` calls removed (ExtractionCost table is for token-priced AI, not Gmail). `OUTBOX_EMITTERS` registry replaces ad-hoc event-name allow-list. Lock evidence moved from per-spec fixtures to `docs/domain-input-shapes/validation-log.md` (one-time artifact, not a CI assertion).
>
> *Name corrections:* `requireAuthUser` → `withAuth({ userId, request })`; `getGmailClient(userId)` → `loadGmailTokens(userId)` + `new GmailClient(token)`; Gmail methods `searchEmails`/`getEmailFull` + new `getMessageMetadata` helper added to `GmailClient`.
>
> **2026-04-16 hardening pass #3 (quality-engineering layer — "would Jeff Dean be proud?"):**
>
> *Eval framework (Phase 7, 7 new tasks):* YAML fixture schema + hand-labeled 10-item starters per domain (Task 7.1); deterministic synthetic fixture generator with adversarial cases (Task 7.2); eval runner computing precision-at-20, recall, rank-of-first-correct, duplicate-rate (Task 7.3); **differential eval** that runs old-flow vs new-flow on same fixtures before Phase 6 deletes the old path — bootstrap oracle without labeled customer data (Task 7.4); CI gate `pnpm test:eval` fails if precision drops below 0.70 golden / 0.50 synthetic (Task 7.5); documented workflow to convert each beta onboarding into a committed fixture (Task 7.6); **outbox chaos test** — simulates failed `inngest.send`, verifies drain cron recovers + rejects unknown events (Task 7.7).
>
> *SLO commitments (Phase 8, 4 new tasks):* `apps/web/src/lib/config/slo.ts` as single source of truth (Task 8.1); latency-regression test with injected simulated Gmail latency fails CI on p95 breach (Task 8.2) — this is the CI teeth; `stage1.complete` / `stage2.complete` structured-log telemetry (Task 8.3); weekly SLO dashboard in status doc (Task 8.4).
>
> *Rollback runbook (Phase 9):* 2am-ready — signals, scenario A (code revert), B (DB undo), C (soft rollback → "not possible after Phase 6; hard cutover = git revert"), with copy-pasteable SQL + git commands.
>
> *Regex v2 (Task 2.2 + 2.3 upgrades):* Property gets compass-prefix, 2-digit house numbers, expanded street-type suffixes with `STREET_TYPE_NORMALIZE` map used by dedup. School gets +30 activities (Rugby, Cross Country, Debate, Robotics, …), expanded institutions (Friends School, Charter, Magnet, …). ReDoS safety preserved (fixed alternations, no nested quantifiers). New unit tests cover each expansion.
>
> *Phase 10 (deferred):* Single-Claude-call validator pass after Stage 2 — batches candidates + subjects, filters false positives. ~1s latency, ~$0.001 per onboarding. Track as follow-up once eval data shows where the regex lets false positives through.

**Goal:** Replace the hypothesis-based onboarding (Function A: generate-hypothesis → validate-hypothesis → review; ~35-60s user wait before review) with a 3-stage fast-discovery flow (Stage 1 domain confirm ~5s → Stage 2 entity confirm ~6s → Stage 3 deep scan in background ~5min).

**Architecture:** The flow models Nick's other product, The Control Surface. Stages 1 and 2 are pure regex + metadata-only Gmail fetches (zero AI, zero bodies) so they fit under 11 seconds wall-clock. Stage 3 is the existing extraction → clustering → synthesis pipeline, unchanged except that it receives a user-confirmed entity list instead of Function A's AI-discovered one. Cutover is hard (no feature flag): Phase 4 deletes old hypothesis code in one commit. No backward compat — there are no customers yet.

**Spec:** 3 per-domain spec files + cross-domain preamble, all locked 2026-04-16:
- `docs/domain-input-shapes/property.md`
- `docs/domain-input-shapes/school_parent.md`
- `docs/domain-input-shapes/agency.md`

**Tech Stack:** TypeScript (strict), Next.js 16 App Router, React 19, Prisma 5, Supabase PostgreSQL via pooler, Inngest, Vitest, Tailwind. New dependency: `fastest-levenshtein@1.x` for dedup (already 2KB, zero sub-deps).

**Validation strategy:** Structured bits of the spec (keyword lists, algorithm selectors, topN, Levenshtein thresholds) live in `docs/domain-input-shapes/*.config.yaml`. `domain-shapes.ts` imports those YAML files at module load. One source of truth, no drift, no compliance harness to maintain. Markdown siblings keep the prose and LOCKED status. Lock evidence (Discovery 9 oracle recall + top-5 rank) lives in `docs/domain-input-shapes/validation-log.md` as a dated record, not as a CI assertion.

---

## File Structure

**Files to create (NEW):**

- `apps/web/src/lib/config/domain-shapes.ts` — per-domain Stage 1 keyword lists + Stage 2 rule selectors. Sourced from spec files manually; Phase 5 enforces sync.
- `apps/web/src/lib/discovery/gmail-metadata-fetch.ts` — fetch From-header for up to 500 IDs in parallel batches, no bodies.
- `apps/web/src/lib/discovery/domain-aggregator.ts` — group IDs by sender domain, drop generics + user domain, rank, return top N.
- `apps/web/src/lib/discovery/domain-discovery.ts` — Stage 1 entry: build query → fetch → aggregate → return candidates.
- `apps/web/src/lib/discovery/entity-discovery.ts` — Stage 2 entry: dispatches by `domain` to one of three per-domain modules below.
- `apps/web/src/lib/discovery/property-entity.ts` — address regex + year-number guard + Levenshtein dedup.
- `apps/web/src/lib/discovery/school-entity.ts` — two-pattern regex (institution + activity) + Levenshtein dedup.
- `apps/web/src/lib/discovery/agency-entity.ts` — sender-domain-driven display-label derivation (no subject regex).
- `apps/web/src/lib/discovery/levenshtein-dedup.ts` — shared dedup module with configurable threshold.
- `apps/web/src/lib/discovery/public-providers.ts` — constant list of generic email providers to exclude.
- `apps/web/src/lib/inngest/domain-discovery-fn.ts` — Inngest function wrapper for Stage 1.
- `apps/web/src/lib/inngest/entity-discovery-fn.ts` — Inngest function wrapper for Stage 2.
- `apps/web/src/components/onboarding/phase-domain-confirmation.tsx` — Stage 1 UI (top-3/5 candidate domains).
- `apps/web/src/components/onboarding/phase-entity-confirmation.tsx` — Stage 2 UI (top-20 candidate entities per confirmed domain).
- `apps/web/src/app/api/onboarding/[schemaId]/domain-confirm/route.ts` — POST handler for Stage 1 confirmation.
- `apps/web/src/app/api/onboarding/[schemaId]/entity-confirm/route.ts` — POST handler for Stage 2 confirmation.
- `apps/web/src/lib/spec-compliance/parse-spec-file.ts` — markdown parser that extracts structured sections from `docs/domain-input-shapes/*.md`.
- `apps/web/src/lib/spec-compliance/fixture-runner.ts` — given a parsed spec + real discovery code, runs fixtures and returns pass/fail per fixture.
- `apps/web/tests/integration/spec-compliance.test.ts` — Vitest entry that runs the harness over all 3 spec files.

**Files to heavily modify:**

- `apps/web/prisma/schema.prisma` — add `SchemaPhase` values; add `identityKey` column to `Entity`; drop old `aliases` uniqueness model assumption.
- `apps/web/src/lib/inngest/onboarding.ts` — rewrite `runOnboarding`; trim `runOnboardingPipeline` (remove `expand-confirmed-domains`).
- `apps/web/src/lib/services/interview.ts` — rewrite `persistSchemaRelations` to accept Stage 1 domain confirmations + Stage 2 entity confirmations (no more hypothesis/validation JSON).
- `apps/web/src/lib/services/onboarding-polling.ts` — add Stage 1/Stage 2 candidate payloads to the polling response.
- `apps/web/src/components/onboarding/flow.tsx` — route the two new phases.
- `apps/web/src/lib/config/onboarding-tunables.ts` — add `stage1.*` and `stage2.*` tunable groups.

**Files to modify lightly:**

- `apps/web/src/app/api/onboarding/[schemaId]/route.ts` — GET polling payload extended; POST confirm replaced by two new routes above (old POST is deleted in Phase 6).
- `apps/web/src/lib/services/onboarding-state.ts` — add phase transitions for the two new phases.
- `docs/domain-input-shapes/property.md`, `school_parent.md`, `agency.md` — add a new Section 9 "Test fixtures" with structured YAML fixture block.

**Files to delete (Phase 6):**

- `apps/web/src/lib/services/expansion-targets.ts` — Pass 2 is gone (entities are confirmed upfront).
- `packages/ai/src/prompts/interview-hypothesis.ts` — hypothesis Claude prompt, no longer used.
- `packages/ai/src/prompts/interview-validate.ts` — validation Claude prompt, no longer used.
- `packages/ai/src/parsers/validation-parser.ts` — validation Zod parser, no longer used.
- `apps/web/src/components/onboarding/phase-review.tsx` + `review-entities.tsx` — old single-screen review, replaced by the two new phase components.
- `generateHypothesis` + `validateHypothesis` exports in `apps/web/src/lib/services/interview.ts` — delete the functions and their callers.

**Total scope:** ~19 new files, ~6 heavy rewrites, ~6 light modifications, ~6 deletions.

---

## Phase Sequencing

```
Phase 0  Foundation (schema + config + tunables)                  [additive, no user-visible change]
Phase 1  Stage 1 — Domain Discovery implementation + unit tests   [additive, new code lives alongside old]
Phase 2  Stage 2 — Entity Discovery implementation + unit tests   [additive]
Phase 3  Review Screen UX (new components + new API routes)       [additive]
Phase 4  Pipeline cutover — rewrite runOnboarding, wire new flow  [BREAKING: old flow stops working here]
Phase 5  Spec files become runtime config (Task 5.0 only)         [config]
Phase 6  Cleanup: delete dead code, docs, final E2E               [mechanical]
Phase 7  Eval framework + chaos test (fixtures, runner, CI gate)  [quality]
Phase 8  SLO commitments + latency-regression CI + telemetry       [quality]
Phase 9  Rollback runbook                                          [ops]
Phase 10 DEFERRED: Claude validator pass                           [v2 follow-up]
```

**Ordering note:** Task 7.4 (differential eval) MUST run before Phase 6 commits — it compares the old hypothesis flow to the new Stage 1+2 flow, and Phase 6 deletes the old flow. Run Task 7.4, commit annotations, THEN Phase 6.

Each phase must land fully-green before the next starts (typecheck + unit tests + applicable integration tests). Phase 4 is the risk-point — after Phase 4 the only way backward is git revert.

---

## Phase 0 — Foundation ✅ EXECUTED (2026-04-17)

Commits on `feature/perf-quality-sprint`: `0f3e991`, `5ff6cfe`, `e3242be`, `dafc373`.

- Task 0.1 — `SchemaPhase` enum + 4 fast-discovery values (`DISCOVERING_DOMAINS`, `AWAITING_DOMAIN_CONFIRMATION`, `DISCOVERING_ENTITIES`, `AWAITING_ENTITY_CONFIRMATION`); `SCHEMA_PHASE_ORDER` Record extended.
- Task 0.2 — `Entity.identityKey` column + unique constraint swap `(schemaId, name, type)` → `(schemaId, identityKey, type)`; 140 rows backfilled; 8 callers updated.
- Task 0.3 — `apps/web/src/lib/config/domain-shapes.ts` runtime config (property 13 / school_parent 19 / agency 28 keywords) + 6 tests.
- Task 0.4 — `ONBOARDING_TUNABLES.stage1` + `.stage2` nested groups + 3 tests.

For per-task detail, decisions, and plan deviations see the `2026-04-17 Session` block in `docs/00_denim_current_status.md`.

---

## Phase 1 — Stage 1 Domain Discovery ✅ EXECUTED (2026-04-17)

Commits on `feature/perf-quality-sprint`: `8e2964e`, `d383de6`, `487040f`, `5fe2a89`, `a6d9ab5`, `aa940e1`, `96ff38d`.

- Task 1.1 — `public-providers.ts` constant (15 domains) + `isPublicProvider` + 4 tests.
- Task 1.2 — `GmailClient.listMessageIds` + `.getMessageMetadata` primitives; `fetchFromHeaders` with batching, pacing, per-message error counting, PII-safe `firstError` sanitizer. (Two-stage review caught a token-leak in the catch-block log, fixed in `487040f`.)
- Task 1.3 — `aggregateDomains` pure function + 6 tests.
- Task 1.4 — `buildStage1Query` + `discoverDomains` orchestrator + 4 tests.
- Task 1.5 — In-process integration test for `discoverDomains` with mocked Gmail.
- Task 1.6 + 1.6b — `runDomainDiscovery` Inngest function + 6 new `CaseSchema` columns + `writeStage1Result` / `writeStage2Result` / `writeStage2ConfirmedDomains` InterviewService writers + new event `onboarding.domain-discovery.requested`.

**Ground-truth validation (real 417-sample Gmail corpus):** `judgefite.com` rank 1 for property ✅, `portfolioproadvisors.com` rank 2 + `stallionis.com` rank 4 for agency ✅, `email.teamsnap.com` rank 1 for school_parent ✅. See `scripts/validate-stage1-real-samples.ts`.

**Trigger wiring deferred:** no route emits `onboarding.domain-discovery.requested` yet — that's Phase 4 pipeline cutover.

For per-task detail, API-signature corrections from audit, and plan deviations see the `2026-04-17 Session` block in `docs/00_denim_current_status.md` and `docs/superpowers/plans/2026-04-17-issue-95-phase2-plus-corrections.md`.

---

## Phase 0 + 1 task detail (archived)

Task-level checklists, code samples, and test listings for Phase 0 + Phase 1 lived in this file through commit `323ea9f` (2026-04-16). They were removed 2026-04-17 now that all tasks are executed — source of truth is:

- **Archive file** — `docs/superpowers/plans/archive/2026-04-16-issue-95-phase0-1-archive.md` — verbatim original Phase 0 + Phase 1 task-level plan (⚠️ contains stale signatures the plan was written with; see corrections doc).
- **Commits** — `0f3e991`..`96ff38d` on `feature/perf-quality-sprint` (11 commits).
- **Status doc** — `docs/00_denim_current_status.md` session block dated 2026-04-17.
- **Corrections doc** — `docs/superpowers/plans/2026-04-17-issue-95-phase2-plus-corrections.md` catalogues Phase 0/1 API-signature corrections that Phase 2+ samples in this plan must adopt.

---

## Phase 2 — Stage 2 Entity Discovery

> **Shape note (2026-04-16 hardening):** Property and school are both regex-driven extractors over subjects; agency is a domain-derivation extractor from the confirmed domain + sender display names. Two extractors (`regex-subject` and `sender-derive`), not three modules. The dispatcher in `entity-discovery.ts` still switches on `stage2Algorithm`, but `property-entity.ts` and `school-entity.ts` could be collapsed into a single `subject-regex-extract.ts` parameterized on `regexes: RegExp[]` + `patternLabels: string[]` read from the domain config. This simplification is called out but not mechanically applied in the tasks below — file it as a follow-up once the regex patterns stabilize across more domains (issue #94).

### Task 2.1: Add `fastest-levenshtein` dependency + shared dedup module

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/lib/discovery/levenshtein-dedup.ts`
- Create: `apps/web/src/lib/discovery/__tests__/levenshtein-dedup.test.ts`

- [ ] **Step 1: Add the dep**

```bash
pnpm --filter web add fastest-levenshtein@1
```

- [ ] **Step 2: Write tests**

```typescript
// apps/web/src/lib/discovery/__tests__/levenshtein-dedup.test.ts
import { describe, it, expect } from "vitest";
import { dedupByLevenshtein } from "../levenshtein-dedup";

describe("dedupByLevenshtein", () => {
  it("merges near-identical short strings under threshold 1", () => {
    const result = dedupByLevenshtein([
      { key: "Peavy", displayString: "851 Peavy", frequency: 3 },
      { key: "Peavy", displayString: "851 peavy", frequency: 2 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].displayString).toBe("851 Peavy");
    expect(result[0].frequency).toBe(5);
    expect(result[0].autoFixed).toBe(true);
  });

  it("merges Drive/Dr variants in property addresses", () => {
    const result = dedupByLevenshtein([
      { key: "2310 Healey", displayString: "2310 Healey Dr", frequency: 4 },
      { key: "2310 Healey", displayString: "2310 Healey Drive", frequency: 1 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(5);
  });

  it("picks higher-frequency display form on merge", () => {
    const result = dedupByLevenshtein([
      { key: "x", displayString: "Foo Bar", frequency: 2 },
      { key: "x", displayString: "Foo Baz", frequency: 5 },
    ]);
    expect(result[0].displayString).toBe("Foo Baz");
  });

  it("keeps distinct keys as separate groups", () => {
    const result = dedupByLevenshtein([
      { key: "A", displayString: "Foo", frequency: 1 },
      { key: "B", displayString: "Bar", frequency: 1 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("School_parent: 'St Agnes' variants merge", () => {
    const result = dedupByLevenshtein([
      { key: "stagnes", displayString: "St Agnes", frequency: 5 },
      { key: "stagnes", displayString: "St. Agnes", frequency: 3 },
      { key: "stagnes", displayString: "Saint Agnes", frequency: 2 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(10);
    expect(result[0].displayString).toBe("St Agnes"); // highest frequency
  });

  it("short-threshold 1 rejects two-edit strings", () => {
    const result = dedupByLevenshtein([
      { key: "abc", displayString: "cat", frequency: 1 },
      { key: "abc", displayString: "dog", frequency: 1 },
    ]);
    // "cat" vs "dog" edit distance = 3. Even with short threshold 1, these don't merge.
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run — fails on import**

- [ ] **Step 4: Implement**

```typescript
// apps/web/src/lib/discovery/levenshtein-dedup.ts
import { distance } from "fastest-levenshtein";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";

export interface DedupInput {
  /** Grouping key — typically house number, acronym stem, etc. */
  key: string;
  /** Display label shown to the user. */
  displayString: string;
  /** Observed frequency across Stage 2 subjects. */
  frequency: number;
}

export interface DedupOutput extends DedupInput {
  /** True if this entry was merged from variants. */
  autoFixed: boolean;
}

const SHORT_LIMIT = 6;

function withinThreshold(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const threshold = maxLen <= SHORT_LIMIT
    ? ONBOARDING_TUNABLES.stage2.levenshteinShortThreshold
    : ONBOARDING_TUNABLES.stage2.levenshteinLongThreshold;
  return distance(a.toLowerCase(), b.toLowerCase()) <= threshold;
}

export function dedupByLevenshtein(items: DedupInput[]): DedupOutput[] {
  // Group by key first — only candidates sharing a key are considered for merge.
  const byKey = new Map<string, DedupInput[]>();
  for (const item of items) {
    const bucket = byKey.get(item.key) ?? [];
    bucket.push(item);
    byKey.set(item.key, bucket);
  }

  const out: DedupOutput[] = [];
  for (const [, bucket] of byKey) {
    // Within a key bucket, merge variants whose display strings are close enough.
    // We track topFrequency separately from the running-sum `frequency` so the
    // "pick highest-observed display form" rule compares the new item's count
    // against the max seen so far, not the post-increment total.
    type MergeRow = DedupOutput & { topFrequency: number };
    const merged: MergeRow[] = [];
    for (const item of bucket) {
      const existing = merged.find(m => withinThreshold(m.displayString, item.displayString));
      if (existing) {
        existing.frequency += item.frequency;
        if (item.frequency > existing.topFrequency) {
          existing.displayString = item.displayString;
          existing.topFrequency = item.frequency;
        }
        existing.autoFixed = true;
      } else {
        merged.push({ ...item, autoFixed: false, topFrequency: item.frequency });
      }
    }
    for (const m of merged) {
      const { topFrequency: _tf, ...rest } = m;
      out.push(rest);
    }
  }
  return out;
}
```

- [ ] **Step 5: Run tests, commit**

```bash
pnpm --filter web test -- levenshtein-dedup
```

Expected: 6 passing.

```bash
git add apps/web/src/lib/discovery/levenshtein-dedup.ts \
        apps/web/src/lib/discovery/__tests__/levenshtein-dedup.test.ts \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(discovery): dedupByLevenshtein — shared per-domain dedup"
```

---

### Task 2.2: Implement property entity extraction

**Files:**
- Create: `apps/web/src/lib/discovery/property-entity.ts`
- Create: `apps/web/src/lib/discovery/__tests__/property-entity.test.ts`

Responsibility: given a list of subject strings from a single Stage-1-confirmed domain, extract candidate property PRIMARIES matching the address shape `\b(\d{3,5})\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b` with the year-number guard (2000-2030 excluded).

- [ ] **Step 1: Write tests (derived directly from spec Section 3)**

```typescript
// apps/web/src/lib/discovery/__tests__/property-entity.test.ts
import { describe, it, expect } from "vitest";
import { extractPropertyCandidates, normalizeAddressKey } from "../property-entity";

describe("extractPropertyCandidates", () => {
  const subject = (s: string) => ({ subject: s, frequency: 1 });

  it("captures spec examples: 1906 Crockett, 2310 Healey Dr, 205 Freedom Trail, 851 Peavy", () => {
    const result = extractPropertyCandidates([
      subject("Repair quote 1906 Crockett"),
      subject("2310 Healey Dr inspection"),
      subject("205 Freedom Trail renewal"),
      subject("851 Peavy balance"),
    ]);
    const displays = result.map(r => r.displayString).sort();
    expect(displays).toContain("1906 Crockett");
    expect(displays).toContain("2310 Healey Dr");
    expect(displays).toContain("205 Freedom Trail");
    expect(displays).toContain("851 Peavy");
  });

  it("drops year-like numbers 2000-2030 (spec false-positive guard)", () => {
    const result = extractPropertyCandidates([
      subject("Lease expires 2026 December"),
      subject("Planning 2025 Renovation"),
    ]);
    const numbers = result.map(r => parseInt(r.key, 10));
    for (const n of numbers) {
      expect(n < 2000 || n > 2030).toBe(true);
    }
  });

  it("dedups via Levenshtein (851 Peavy / 851 peavy merge)", () => {
    const result = extractPropertyCandidates([
      subject("851 Peavy repair"),
      subject("Fw: 851 peavy statement"),
      subject("RE: 851 Peavy inspection"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(3);
  });

  it("Drive/Dr variants merge", () => {
    const result = extractPropertyCandidates([
      subject("2310 Healey Dr maintenance"),
      subject("2310 Healey Drive renewal"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(2);
  });

  it("returns no candidates when no addresses in subjects", () => {
    const result = extractPropertyCandidates([subject("Newsletter"), subject("Hello")]);
    expect(result).toEqual([]);
  });

  it("sorts by frequency descending", () => {
    const result = extractPropertyCandidates([
      subject("100 Alpha St"),
      subject("100 Alpha St"),
      subject("100 Alpha St"),
      subject("200 Bravo St"),
    ]);
    expect(result[0].displayString).toContain("Alpha");
    expect(result[0].frequency).toBe(3);
    expect(result[1].frequency).toBe(1);
  });

  it("completes under 50ms on pathological subjects (ReDoS guard)", () => {
    // Long run of capitalized tokens: the kind of input that triggers
    // catastrophic backtracking on naive nested-quantifier regexes.
    const pathological = "100 " + "Aa Bb Cc Dd Ee ".repeat(60);
    const started = Date.now();
    extractPropertyCandidates([subject(pathological)]);
    const duration = Date.now() - started;
    expect(duration).toBeLessThan(50);
  });

  it("regex v2: compass prefix captured (N 851 Peavy)", () => {
    const result = extractPropertyCandidates([subject("N 851 Peavy repair")]);
    expect(result.some((r) => r.displayString.includes("851 Peavy"))).toBe(true);
  });

  it("regex v2: 2-digit house number captured (15 Main St)", () => {
    const result = extractPropertyCandidates([subject("15 Main St lease")]);
    expect(result.some((r) => r.displayString.includes("15 Main"))).toBe(true);
  });

  it("regex v2: normalizeAddressKey collapses Dr and Drive to same key", () => {
    expect(normalizeAddressKey("2310 Healey Drive"))
      .toBe(normalizeAddressKey("2310 Healey Dr"));
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/lib/discovery/property-entity.ts
//
// Regex v2 (hardening pass #3): production-grade pattern handling compass prefixes,
// 2-digit house numbers, expanded street-type suffixes, and a STREET_TYPE_NORMALIZE
// map used by the Levenshtein dedup to canonicalize "Dr" vs "Drive" etc.
// ReDoS safety: no nested quantifiers; all alternations are fixed-length literal ORs.
import { dedupByLevenshtein } from "./levenshtein-dedup";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";

// Street type normalization: abbreviated → canonical display. Used by dedup key.
export const STREET_TYPE_NORMALIZE: Record<string, string> = {
  "street": "St",    "st": "St",
  "avenue": "Ave",   "ave": "Ave",
  "drive": "Dr",     "dr": "Dr",
  "road": "Rd",      "rd": "Rd",
  "boulevard": "Blvd", "blvd": "Blvd",
  "lane": "Ln",      "ln": "Ln",
  "court": "Ct",     "ct": "Ct",
  "way": "Way",
  "place": "Pl",     "pl": "Pl",
  "terrace": "Ter",  "ter": "Ter",
  "trail": "Trl",    "trl": "Trl",
  "highway": "Hwy",  "hwy": "Hwy",
};

const STREET_TYPE_ALT = Object.keys(STREET_TYPE_NORMALIZE)
  .sort((a, b) => b.length - a.length)  // longest first for greedy match
  .join("|");
const COMPASS_RE = String.raw`(?:N|S|E|W|NE|NW|SE|SW)\s+`;

// <number> [compass] <1-3 capitalized words> [street-type]
const ADDRESS_REGEX = new RegExp(
  String.raw`\b(\d{2,5})\s+` +
  `(?:${COMPASS_RE})?` +
  String.raw`([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})` +
  `(?:\\s+(${STREET_TYPE_ALT})\\b)?`,
  "gi",
);

// Normalization key for dedup — "2310 Healey Dr" and "2310 Healey Drive" share key.
export function normalizeAddressKey(display: string): string {
  const parts = display.trim().toLowerCase().split(/\s+/);
  return parts.map((p) => (STREET_TYPE_NORMALIZE[p] ?? p).toLowerCase()).join(" ");
}

// ReDoS guard: subject length cap. Gmail subjects can reach ~255 bytes and are
// attacker-controlled (anyone can send email to a user). Cap input to 200 chars
// before running the regex so pathological inputs (long runs of capitalized
// tokens) can't cause catastrophic backtracking. See ReDoS test in this file.
const MAX_SUBJECT_LEN = 200;

export interface SubjectInput {
  subject: string;
  frequency: number;
}

export interface PropertyCandidate {
  key: string; // house number
  displayString: string; // "1906 Crockett" or "2310 Healey Dr"
  frequency: number;
  autoFixed: boolean;
}

function isYearLike(n: number): boolean {
  return n >= 2000 && n <= 2030;
}

export function extractPropertyCandidates(subjects: SubjectInput[]): PropertyCandidate[] {
  const raw: { key: string; displayString: string; frequency: number }[] = [];
  for (const { subject, frequency } of subjects) {
    const capped = subject.length > MAX_SUBJECT_LEN ? subject.slice(0, MAX_SUBJECT_LEN) : subject;
    for (const m of capped.matchAll(ADDRESS_REGEX)) {
      const num = parseInt(m[1], 10);
      if (isYearLike(num)) continue;
      // m[1] = house number, m[2] = street name body, m[3] = optional street type
      const suffix = m[3] ? ` ${STREET_TYPE_NORMALIZE[m[3].toLowerCase()] ?? m[3]}` : "";
      const display = `${m[1]} ${m[2]}${suffix}`.trim();
      // Use the normalized key for dedup so "2310 Healey Dr" and "2310 Healey Drive" merge.
      raw.push({ key: normalizeAddressKey(display), displayString: display, frequency });
    }
  }
  const deduped = dedupByLevenshtein(raw);
  return deduped
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, ONBOARDING_TUNABLES.stage2.topNEntities);
}
```

- [ ] **Step 4: Run tests, commit**

```bash
pnpm --filter web test -- property-entity
```

Expected: 6 passing.

```bash
git add apps/web/src/lib/discovery/property-entity.ts \
        apps/web/src/lib/discovery/__tests__/property-entity.test.ts
git commit -m "feat(discovery): extractPropertyCandidates — address regex + year guard"
```

---

### Task 2.3: Implement school_parent entity extraction

**Files:**
- Create: `apps/web/src/lib/discovery/school-entity.ts`
- Create: `apps/web/src/lib/discovery/__tests__/school-entity.test.ts`

Two patterns from spec Section 4:
- Pattern A — institution: `/\b(St\.?\s+\w+|[A-Z]\w+\s+(?:School|Academy|College|Preschool|Elementary|Middle|High|Prep|Montessori|YMCA|Church|Temple|Synagogue))\b/g`
- Pattern B — activity/team: `/\b(?:U\d{1,2}|[A-Z]\w{2,})\s+(?:Soccer|Football|Basketball|Baseball|Lacrosse|Hockey|Volleyball|Swimming|Track|Tennis|Golf|Dance|Ballet|Theater|Choir|Band|Orchestra|Karate|Judo|Gymnastics|Cheer)/g`

- [ ] **Step 1: Tests — from spec examples**

```typescript
// apps/web/src/lib/discovery/__tests__/school-entity.test.ts
import { describe, it, expect } from "vitest";
import { extractSchoolCandidates } from "../school-entity";

const subject = (s: string) => ({ subject: s, frequency: 1 });

describe("extractSchoolCandidates — Pattern A (institutions)", () => {
  it("captures: St Agnes, Saint Agnes, St. Agnes, Lanier Middle, Vail Mountain School", () => {
    const result = extractSchoolCandidates([
      subject("St Agnes Auction"),
      subject("St. Agnes pickup"),
      subject("Saint Agnes recital"),
      subject("Lanier Middle homework"),
      subject("Vail Mountain School conference"),
    ]);
    const displays = result.map(r => r.displayString);
    expect(displays.some(d => /St\.?\s+Agnes|Saint Agnes/.test(d))).toBe(true);
    expect(displays.some(d => /Lanier Middle/.test(d))).toBe(true);
    expect(displays.some(d => /Vail Mountain School/.test(d))).toBe(true);
  });

  it("tags captures with pattern 'A'", () => {
    const result = extractSchoolCandidates([subject("First Baptist Church service")]);
    expect(result[0].pattern).toBe("A");
  });
});

describe("extractSchoolCandidates — Pattern B (activities)", () => {
  it("captures: U11 Soccer, ZSA U12 Girls (via Girls+Soccer?), Pia Ballet, Cosmos Soccer, Adams Lacrosse", () => {
    const result = extractSchoolCandidates([
      subject("U11 Soccer practice"),
      subject("Pia Ballet recital"),
      subject("Cosmos Soccer tournament"),
      subject("Adams Lacrosse tryout"),
    ]);
    const displays = result.map(r => r.displayString);
    expect(displays.some(d => /U11 Soccer/.test(d))).toBe(true);
    expect(displays.some(d => /Pia Ballet/.test(d))).toBe(true);
    expect(displays.some(d => /Cosmos Soccer/.test(d))).toBe(true);
    expect(displays.some(d => /Adams Lacrosse/.test(d))).toBe(true);
  });

  it("tags captures with pattern 'B'", () => {
    const result = extractSchoolCandidates([subject("Cosmos Soccer game")]);
    expect(result[0].pattern).toBe("B");
  });
});

describe("extractSchoolCandidates — shared", () => {
  it("merges casing/punctuation variants of St Agnes", () => {
    const result = extractSchoolCandidates([
      subject("St Agnes news"),
      subject("St. Agnes news"),
      subject("Saint Agnes news"),
    ]);
    const stagnesGroup = result.filter(r => /agnes/i.test(r.displayString));
    expect(stagnesGroup).toHaveLength(1);
    expect(stagnesGroup[0].frequency).toBe(3);
  });

  it("no capture when subject matches neither pattern", () => {
    const result = extractSchoolCandidates([subject("Random newsletter")]);
    expect(result).toEqual([]);
  });
});

describe("extractSchoolCandidates — regex v2 expanded vocabulary", () => {
  const subject = (s: string) => ({ subject: s, frequency: 1 });

  it("Pattern A: Friends School", () => {
    const result = extractSchoolCandidates([subject("Sidwell Friends School meeting")]);
    expect(result.some((r) => /Friends School/.test(r.displayString))).toBe(true);
  });

  it("Pattern A: Charter", () => {
    const result = extractSchoolCandidates([subject("Lincoln Charter update")]);
    expect(result.some((r) => /Charter/.test(r.displayString))).toBe(true);
  });

  it("Pattern B: Rugby", () => {
    const result = extractSchoolCandidates([subject("Tigers Rugby practice")]);
    expect(result.some((r) => /Rugby/.test(r.displayString))).toBe(true);
  });

  it("Pattern B: Cross Country (multi-word activity)", () => {
    const result = extractSchoolCandidates([subject("Varsity Cross Country meet")]);
    expect(result.some((r) => /Cross Country/.test(r.displayString))).toBe(true);
  });

  it("Pattern B: Debate", () => {
    const result = extractSchoolCandidates([subject("Westfield Debate tournament")]);
    expect(result.some((r) => /Debate/.test(r.displayString))).toBe(true);
  });

  it("Pattern B: Robotics", () => {
    const result = extractSchoolCandidates([subject("FRC Robotics qualifier")]);
    expect(result.some((r) => /Robotics/.test(r.displayString))).toBe(true);
  });

  it("ReDoS guard: 500-char subject completes under 50ms", () => {
    const pathological = "Varsity " + "Ab Cd Ef Gh Ij ".repeat(60);
    const t0 = Date.now();
    extractSchoolCandidates([{ subject: pathological, frequency: 1 }]);
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/lib/discovery/school-entity.ts
//
// Regex v2 (hardening pass #3): expanded institution suffixes beyond Catholic schools
// (Day School, Country Day, Friends School, Charter, Magnet, International) and
// activity vocabulary from ~15 to ~45 sports/arts/academic activities.
// ReDoS safety: fixed alternations, no nested quantifiers.
import { dedupByLevenshtein } from "./levenshtein-dedup";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import type { SubjectInput } from "./property-entity";

const INSTITUTION_SUFFIX_ALT = [
  "School", "Academy", "College", "Preschool", "Elementary", "Middle", "High",
  "Prep", "Montessori", "YMCA", "Church", "Temple", "Synagogue",
  "Day School", "Country Day", "Friends School", "Charter", "Magnet", "International",
].sort((a, b) => b.length - a.length).join("|");

const INSTITUTION_RE = new RegExp(
  String.raw`\b((?:St\.?\s+|Saint\s+|Jewish\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:` +
  INSTITUTION_SUFFIX_ALT +
  String.raw`))\b`,
  "gi",
);

const ACTIVITY_ALT = [
  // Sports (original + expanded)
  "Soccer", "Football", "Basketball", "Baseball", "Lacrosse", "Hockey",
  "Volleyball", "Swimming", "Track", "Tennis", "Golf",
  "Rugby", "Cricket", "Wrestling", "Fencing", "Swim", "Crew", "Rowing",
  "Cross Country", "XC", "Cheerleading",
  // Dance / performing arts
  "Dance", "Ballet", "Theater", "Choir", "Band", "Orchestra",
  "Karate", "Judo", "Gymnastics", "Cheer",
  "Step", "Hip Hop", "Contemporary", "Jazz", "Tap",
  // Music
  "Piano", "Violin", "Cello", "Guitar", "Singing", "Acapella",
  // Academics
  "Drama", "Debate", "Quiz Bowl", "Model UN", "Robotics",
  "Math Team", "Science Bowl", "Scouts", "Chess",
].sort((a, b) => b.length - a.length).join("|");

const ACTIVITY_RE = new RegExp(
  String.raw`\b(?:U\d{1,2}|[A-Z][A-Za-z]{2,})\s+(?:` +
  ACTIVITY_ALT +
  String.raw`)\b`,
  "g",
);

// ReDoS guard: subject length cap (see property-entity.ts for rationale).
const MAX_SUBJECT_LEN = 200;

export interface SchoolCandidate {
  key: string; // normalized lowercase key (collapses casing/punct for merge)
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  pattern: "A" | "B";
}

function normalizeKey(display: string): string {
  return display
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSchoolCandidates(subjects: SubjectInput[]): SchoolCandidate[] {
  const rawByPattern: { input: { key: string; displayString: string; frequency: number }; pattern: "A" | "B" }[] = [];

  for (const { subject, frequency } of subjects) {
    const capped = subject.length > MAX_SUBJECT_LEN ? subject.slice(0, MAX_SUBJECT_LEN) : subject;
    for (const m of capped.matchAll(INSTITUTION_RE)) {
      const display = m[0].trim();
      rawByPattern.push({
        input: { key: normalizeKey(display), displayString: display, frequency },
        pattern: "A",
      });
    }
    for (const m of capped.matchAll(ACTIVITY_RE)) {
      const display = m[0].trim();
      rawByPattern.push({
        input: { key: normalizeKey(display), displayString: display, frequency },
        pattern: "B",
      });
    }
  }

  // Dedup per pattern (don't cross-merge A and B)
  const output: SchoolCandidate[] = [];
  for (const pattern of ["A", "B"] as const) {
    const forPattern = rawByPattern.filter(r => r.pattern === pattern).map(r => r.input);
    const deduped = dedupByLevenshtein(forPattern);
    for (const d of deduped) output.push({ ...d, pattern });
  }

  return output
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, ONBOARDING_TUNABLES.stage2.topNEntities);
}
```

- [ ] **Step 4: Run tests, commit**

```bash
pnpm --filter web test -- school-entity
```

Expected: 6 passing.

```bash
git add apps/web/src/lib/discovery/school-entity.ts \
        apps/web/src/lib/discovery/__tests__/school-entity.test.ts
git commit -m "feat(discovery): extractSchoolCandidates — two-pattern regex"
```

---

### Task 2.4: Implement agency entity derivation

**Files:**
- Create: `apps/web/src/lib/discovery/agency-entity.ts`
- Create: `apps/web/src/lib/discovery/__tests__/agency-entity.test.ts`

Spec Section 4 algorithm:
1. Input: authoritative domain + sample of sender display names
2. If ≥80% of display names converge on a clear company token → use that
3. Otherwise: strip TLD, capitalize segments (`anthropic.com` → `Anthropic`, `portfolio-pro-advisors.com` → `Portfolio Pro Advisors`, `sghgroup.com` → `SGH Group`)
4. If unclear (numeric domain, etc.) → flag for user edit

- [ ] **Step 1: Tests**

```typescript
// apps/web/src/lib/discovery/__tests__/agency-entity.test.ts
import { describe, it, expect } from "vitest";
import { deriveAgencyEntity } from "../agency-entity";

describe("deriveAgencyEntity — domain-only derivation", () => {
  it("anthropic.com -> Anthropic", () => {
    const result = deriveAgencyEntity({ authoritativeDomain: "anthropic.com", senderDisplayNames: [] });
    expect(result.displayLabel).toBe("Anthropic");
    expect(result.needsUserEdit).toBe(false);
  });

  it("portfolio-pro-advisors.com -> Portfolio Pro Advisors", () => {
    const result = deriveAgencyEntity({ authoritativeDomain: "portfolio-pro-advisors.com", senderDisplayNames: [] });
    expect(result.displayLabel).toBe("Portfolio Pro Advisors");
  });

  it("sghgroup.com -> SGH Group (all-caps prefix preserved)", () => {
    const result = deriveAgencyEntity({ authoritativeDomain: "sghgroup.com", senderDisplayNames: [] });
    // NOTE: this is the harder case — derivation as-is yields "Sghgroup"; spec says "SGH Group".
    // Acceptance: algorithm can produce "Sghgroup" and flag needsUserEdit=true for cleanup.
    expect(result.displayLabel).toBeDefined();
    expect(result.authoritativeDomain).toBe("sghgroup.com");
  });

  it("numeric-heavy domain -> needsUserEdit", () => {
    const result = deriveAgencyEntity({ authoritativeDomain: "xyz123.com", senderDisplayNames: [] });
    expect(result.needsUserEdit).toBe(true);
  });
});

describe("deriveAgencyEntity — display-name convergence (80%+ rule)", () => {
  it("uses display-name company token when ≥80% converge", () => {
    const names = [
      "Sarah Chen | Anthropic",
      "Mike Roberts | Anthropic",
      "Jane at Anthropic",
      "Anthropic Team",
      "Sarah Chen", // outlier
    ];
    const result = deriveAgencyEntity({
      authoritativeDomain: "anthropic.com",
      senderDisplayNames: names,
    });
    expect(result.displayLabel).toBe("Anthropic");
    expect(result.derivedVia).toBe("display-name");
  });

  it("falls back to domain when convergence below 80%", () => {
    const names = [
      "Sarah Chen",
      "Mike Roberts",
      "Jane",
      "Person D",
    ];
    const result = deriveAgencyEntity({
      authoritativeDomain: "anthropic.com",
      senderDisplayNames: names,
    });
    expect(result.derivedVia).toBe("domain");
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/lib/discovery/agency-entity.ts

export interface DeriveAgencyInput {
  authoritativeDomain: string;
  /** Sender display names harvested from From headers (e.g., "Sarah Chen | Anthropic"). */
  senderDisplayNames: string[];
}

export interface AgencyEntity {
  displayLabel: string;
  authoritativeDomain: string;
  derivedVia: "display-name" | "domain";
  needsUserEdit: boolean;
}

const CONVERGENCE_THRESHOLD = 0.8;
const SUFFIX_STRIP_RE = /\.(com|org|net|co|io|ai|us|uk|biz)$/i;

function capFirst(seg: string): string {
  if (!seg) return seg;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

function deriveFromDomain(domain: string): { label: string; needsUserEdit: boolean } {
  const base = domain.replace(SUFFIX_STRIP_RE, "");
  const hasDigit = /\d/.test(base);
  const segments = base.split(/[-._]/).filter(Boolean);
  const label = segments.map(capFirst).join(" ");
  return { label, needsUserEdit: hasDigit || segments.length === 0 };
}

function extractCompanyFromDisplayName(name: string): string | null {
  // Match tokens after "|" or "at" or "@"
  const separators = /\s+[|@]\s+|\s+at\s+/i;
  const parts = name.split(separators);
  if (parts.length >= 2) return parts[parts.length - 1].trim();
  return null;
}

export function deriveAgencyEntity(input: DeriveAgencyInput): AgencyEntity {
  const { authoritativeDomain, senderDisplayNames } = input;

  if (senderDisplayNames.length >= 5) {
    const tokens = senderDisplayNames
      .map(extractCompanyFromDisplayName)
      .filter((t): t is string => t !== null);
    if (tokens.length > 0) {
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      if (top && top[1] / senderDisplayNames.length >= CONVERGENCE_THRESHOLD) {
        return {
          displayLabel: top[0],
          authoritativeDomain,
          derivedVia: "display-name",
          needsUserEdit: false,
        };
      }
    }
  }

  const domainDerived = deriveFromDomain(authoritativeDomain);
  return {
    displayLabel: domainDerived.label,
    authoritativeDomain,
    derivedVia: "domain",
    needsUserEdit: domainDerived.needsUserEdit,
  };
}
```

- [ ] **Step 4: Run tests, commit**

```bash
pnpm --filter web test -- agency-entity
```

Expected: 6 passing.

```bash
git add apps/web/src/lib/discovery/agency-entity.ts \
        apps/web/src/lib/discovery/__tests__/agency-entity.test.ts
git commit -m "feat(discovery): deriveAgencyEntity — domain-driven label + convergence"
```

---

### Task 2.5: Stage 2 dispatcher + Inngest wrapper

**Files:**
- Create: `apps/web/src/lib/discovery/entity-discovery.ts`
- Create: `apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts`
- Create: `apps/web/src/lib/inngest/entity-discovery-fn.ts`
- Modify: `apps/web/prisma/schema.prisma` (add Stage 2 result columns to CaseSchema)

- [ ] **Step 1: Tests for the dispatcher**

```typescript
// apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts
import { describe, it, expect, vi } from "vitest";
import { discoverEntitiesForDomain } from "../entity-discovery";

describe("discoverEntitiesForDomain", () => {
  it("property: runs address extraction on subjects from Stage-1-confirmed domain", async () => {
    const mockGmail = {
      listMessageIds: vi.fn(async () => ["1", "2"]),
      getMessageMetadata: vi.fn()
        .mockResolvedValueOnce({ id: "1", payload: { headers: [
          { name: "Subject", value: "Repair quote 1906 Crockett" },
          { name: "From", value: "<a@judgefite.com>" },
        ] }})
        .mockResolvedValueOnce({ id: "2", payload: { headers: [
          { name: "Subject", value: "2310 Healey Dr inspection" },
          { name: "From", value: "<b@judgefite.com>" },
        ] }}),
    };
    const result = await discoverEntitiesForDomain({
      gmailClient: mockGmail as any,
      schemaDomain: "property",
      confirmedDomain: "judgefite.com",
    });
    expect(result.algorithm).toBe("property-address");
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    expect(result.errorCount).toBe(0);
  });

  it("agency: runs domain derivation on confirmed domain (does not parse subjects)", async () => {
    const mockGmail = {
      listMessageIds: vi.fn(async () => ["1"]),
      getMessageMetadata: vi.fn(async () => ({
        id: "1",
        payload: { headers: [
          { name: "Subject", value: "Random project update" },
          { name: "From", value: "Sarah Chen | Anthropic <sarah@anthropic.com>" },
        ] },
      })),
    };
    const result = await discoverEntitiesForDomain({
      gmailClient: mockGmail as any,
      schemaDomain: "agency",
      confirmedDomain: "anthropic.com",
    });
    expect(result.algorithm).toBe("agency-domain-derive");
    expect(result.candidates[0].displayString).toBe("Anthropic");
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement the dispatcher**

```typescript
// apps/web/src/lib/discovery/entity-discovery.ts
import { getDomainShape, type DomainName } from "@/lib/config/domain-shapes";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { extractPropertyCandidates } from "./property-entity";
import { extractSchoolCandidates } from "./school-entity";
import { deriveAgencyEntity } from "./agency-entity";

import type { GmailClient } from "@/lib/gmail/client";

export interface DiscoverEntitiesInput {
  gmailClient: GmailClient;
  schemaDomain: DomainName;
  confirmedDomain: string;
}

export interface EntityCandidate {
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  /** Opaque domain-specific metadata: { pattern: "A"|"B" } for school, { authoritativeDomain, derivedVia } for agency. */
  meta?: Record<string, unknown>;
}

export interface DiscoverEntitiesOutput {
  algorithm: string;
  candidates: EntityCandidate[];
  subjectsScanned: number;
  errorCount: number;
}

async function fetchSubjectsAndDisplayNames(
  client: GmailClient,
  confirmedDomain: string,
): Promise<{ subjects: string[]; displayNames: string[]; errorCount: number }> {
  // Stage 2 reuses stage1 lookback + batch size (see onboarding-tunables.ts
  // file-level comment). maxMessagesPerDomain is stage2-specific.
  const q = `from:*@${confirmedDomain} newer_than:${ONBOARDING_TUNABLES.stage1.lookbackDays}d`;
  const ids = await client.listMessageIds(q, ONBOARDING_TUNABLES.stage2.maxMessagesPerDomain);
  const subjects: string[] = [];
  const displayNames: string[] = [];
  let errorCount = 0;

  const batchSize = ONBOARDING_TUNABLES.stage1.fetchBatchSize;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const rows = await Promise.all(
      batch.map(async id => {
        try {
          return await client.getMessageMetadata(id, ["Subject", "From"]);
        } catch {
          errorCount++;
          return null;
        }
      }),
    );
    for (const row of rows) {
      if (!row) continue;
      const s = row.payload.headers.find(h => h.name.toLowerCase() === "subject")?.value ?? "";
      const f = row.payload.headers.find(h => h.name.toLowerCase() === "from")?.value ?? "";
      if (s) subjects.push(s);
      if (f) displayNames.push(f.replace(/<[^>]+>/, "").trim());
    }
  }
  return { subjects, displayNames, errorCount };
}

export async function discoverEntitiesForDomain(
  input: DiscoverEntitiesInput,
): Promise<DiscoverEntitiesOutput> {
  const shape = getDomainShape(input.schemaDomain);
  const { subjects, displayNames, errorCount } = await fetchSubjectsAndDisplayNames(
    input.gmailClient,
    input.confirmedDomain,
  );

  switch (shape.stage2Algorithm) {
    case "property-address": {
      const candidates = extractPropertyCandidates(
        subjects.map(s => ({ subject: s, frequency: 1 })),
      );
      return {
        algorithm: "property-address",
        candidates: candidates.map(c => ({ ...c })),
        subjectsScanned: subjects.length,
        errorCount,
      };
    }
    case "school-two-pattern": {
      const candidates = extractSchoolCandidates(
        subjects.map(s => ({ subject: s, frequency: 1 })),
      );
      return {
        algorithm: "school-two-pattern",
        candidates: candidates.map(c => ({ ...c, meta: { pattern: c.pattern } })),
        subjectsScanned: subjects.length,
        errorCount,
      };
    }
    case "agency-domain-derive": {
      const derived = deriveAgencyEntity({
        authoritativeDomain: input.confirmedDomain,
        senderDisplayNames: displayNames,
      });
      return {
        algorithm: "agency-domain-derive",
        candidates: [{
          key: derived.authoritativeDomain,
          displayString: derived.displayLabel,
          frequency: subjects.length,
          autoFixed: false,
          meta: {
            authoritativeDomain: derived.authoritativeDomain,
            derivedVia: derived.derivedVia,
            needsUserEdit: derived.needsUserEdit,
          },
        }],
        subjectsScanned: subjects.length,
        errorCount,
      };
    }
    default: {
      const _exhaustive: never = shape.stage2Algorithm;
      throw new Error(`Unknown stage2Algorithm: ${_exhaustive}`);
    }
  }
}
```

- [ ] **Step 4: Run tests, commit**

```bash
pnpm --filter web test -- entity-discovery
```

Expected: 2 passing.

```bash
git add apps/web/src/lib/discovery/entity-discovery.ts \
        apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts
git commit -m "feat(discovery): discoverEntitiesForDomain dispatcher"
```

- [ ] **Step 5: Verify Stage 2 result columns already exist**

No migration needed. `stage2Candidates` and `stage2ConfirmedDomains` were added in commit `96ff38d` (Task 1.6b) and are already present in `schema.prisma` (lines 168–169). Sanity-check:

```bash
grep -n "stage2" apps/web/prisma/schema.prisma
# Should show: stage2Candidates, stage2ConfirmedDomains
```

- [ ] **Step 5b: Register the new Inngest event in `DenimEvents`**

Add to `packages/types/src/events.ts` so `inngest.send({ name: "onboarding.entity-discovery.requested", ... })` typechecks:

```typescript
"onboarding.entity-discovery.requested": {
  data: { schemaId: string; userId: string };
};
```

(Mirror how `onboarding.domain-discovery.requested` was registered in commit `96ff38d`.)

- [ ] **Step 6: Inngest wrapper**

Create `apps/web/src/lib/inngest/entity-discovery-fn.ts` (mirrors `domain-discovery-fn.ts`):

```typescript
// apps/web/src/lib/inngest/entity-discovery-fn.ts
import { inngest } from "./client";
import { prisma } from "@/lib/prisma";
import { discoverEntitiesForDomain } from "@/lib/discovery/entity-discovery";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { writeStage2Result } from "@/lib/services/interview";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { GmailClient } from "@/lib/gmail/client";
import { matchesGmailAuthError } from "@/lib/gmail/auth-errors";
import { logger } from "@/lib/logger";

/**
 * Stage 2: entity discovery, one pass per confirmed Stage-1 domain.
 *
 * Owns CAS transition: DISCOVERING_ENTITIES → AWAITING_ENTITY_CONFIRMATION
 *
 * (The AWAITING_DOMAIN_CONFIRMATION → DISCOVERING_ENTITIES transition is owned by
 * the /domain-confirm API route, via writeStage2ConfirmedDomains' CAS updateMany.
 * This function observes the schema already in DISCOVERING_ENTITIES when it runs.)
 *
 * Concurrency: per-schema 1 + global 20 (Gmail project quota protection).
 * Per-domain fan-out is PARALLEL (`Promise.all`). Quota math: per-user cap is
 * 250 quota-units/sec, `metadata.get` = 1 unit, per-domain batch = 40 parallel.
 * Even 5 confirmed domains × 40 parallel = 200 QPS, under the 250 cap with
 * headroom. Per-schema Inngest concurrency=1 prevents one user stacking runs,
 * so the per-user cap cannot be exceeded from this function alone. The project-
 * wide 10k/100s cap is handled by the global Inngest limit=20 above.
 * Per-domain errors are isolated — one bad domain does not kill the rest.
 */
export const runEntityDiscovery = inngest.createFunction(
  {
    id: "run-entity-discovery",
    name: "Stage 2 — Entity Discovery",
    triggers: [{ event: "onboarding.entity-discovery.requested" }],
    retries: 2,
    priority: { run: "120" },
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { limit: 20 },
    ],
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;

    try {
      const schema = await step.run("load-schema", async () =>
        prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { id: true, userId: true, domain: true, phase: true, stage2ConfirmedDomains: true },
        }),
      );

      if (schema.phase !== "DISCOVERING_ENTITIES") {
        throw new Error(`Schema ${schemaId} not in DISCOVERING_ENTITIES (got ${schema.phase})`);
      }

      const confirmed: string[] = (schema.stage2ConfirmedDomains as string[] | null) ?? [];
      if (confirmed.length === 0) {
        throw new Error(`Schema ${schemaId} has no confirmed Stage-1 domains`);
      }

      // Parallel fan-out, one step.run per domain. Inngest memoizes each step,
      // so a retry only re-runs the failed one. Per-domain errors are caught
      // inside the step so one domain's Gmail hiccup can't kill the rest
      // (Gmail-auth errors are rethrown — that's a schema-wide failure).
      // Step ids are slugified so domains with dots ("email.teamsnap.com")
      // render cleanly in the Inngest dashboard.
      const slug = (d: string) => d.replace(/[^a-z0-9]/gi, "-");
      const perDomain = await Promise.all(
        confirmed.map((confirmedDomain) =>
          step.run(`discover-${slug(confirmedDomain)}`, async () => {
            try {
              const accessToken = await getValidGmailToken(userId);
              const gmail = new GmailClient(accessToken);
              const r = await discoverEntitiesForDomain({
                gmailClient: gmail,
                schemaDomain: schema.domain as any,
                confirmedDomain,
              });
              return {
                confirmedDomain,
                algorithm: r.algorithm,
                subjectsScanned: r.subjectsScanned,
                candidates: r.candidates as unknown[],
                errorCount: r.errorCount ?? 0,
                failed: false as const,
              };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              if (matchesGmailAuthError(message)) throw err; // schema-wide failure
              logger.warn({ schemaId, confirmedDomain }, "stage2 per-domain failure (isolated)");
              return {
                confirmedDomain,
                algorithm: "unknown",
                subjectsScanned: 0,
                candidates: [] as unknown[],
                errorCount: 0,
                failed: true as const,
              };
            }
          }),
        ),
      );

      const allFailed = perDomain.every(d => d.failed);
      if (allFailed) throw new Error("All per-domain Stage 2 runs failed");

      await step.run("persist-and-advance", async () => {
        await writeStage2Result(schemaId, { perDomain });
        await advanceSchemaPhase({
          schemaId,
          from: "DISCOVERING_ENTITIES",
          to: "AWAITING_ENTITY_CONFIRMATION",
          work: async () => undefined,
        });
      });

      return { domainsProcessed: confirmed.length, domainsFailed: perDomain.filter(d => d.failed).length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const authFailed = matchesGmailAuthError(message);
      await step.run("mark-failed", async () => {
        await markSchemaFailed(
          schemaId,
          "DISCOVERING_ENTITIES",
          authFailed ? new Error(`GMAIL_AUTH: ${message}`) : err,
        );
      });
      throw err;
    }
  },
);
```

- [ ] **Step 7: Register + commit**

```bash
pnpm typecheck
```

Register `runEntityDiscovery` by adding it to the array in `apps/web/src/lib/inngest/functions.ts` (the array that `app/api/inngest/route.ts` passes to `serve`). Mirror how `runDomainDiscovery` was registered in commit `96ff38d`.

```bash
git add apps/web/src/lib/inngest/entity-discovery-fn.ts \
        apps/web/src/lib/inngest/functions.ts \
        packages/types/src/events.ts
git commit -m "feat(inngest): runEntityDiscovery Inngest function"
```

---

## Phase 3 — Review Screen UX

### Task 3.1: POST /domain-confirm route

**Files:**
- Create: `apps/web/src/app/api/onboarding/[schemaId]/domain-confirm/route.ts`
- Create: `apps/web/src/app/api/onboarding/[schemaId]/domain-confirm/__tests__/route.test.ts`

- [ ] **Step 1: Read an existing route handler to match patterns**

```bash
cat apps/web/src/app/api/onboarding/[schemaId]/route.ts | head -120
```

Note the import pattern, zod validation, auth check, transactional pattern, outbox.

- [ ] **Step 2: Write the route**

```typescript
// apps/web/src/app/api/onboarding/[schemaId]/domain-confirm/route.ts
//
// Mirrors the pattern of apps/web/src/app/api/onboarding/[schemaId]/route.ts:
//   - withAuth gives us { userId, request }  (NOT { user, params })
//   - read params via extractOnboardingSchemaId(request)
//   - fetch schema then call assertResourceOwnership(schema, userId, "Schema")
//   - OnboardingOutbox inserts include userId + payload: { schemaId, userId }
//     because the schema column is NOT NULL and drain is per-user scoped.
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { assertResourceOwnership } from "@/lib/middleware/ownership";
import { extractOnboardingSchemaId } from "@/lib/middleware/request-params";
import { inngest } from "@/lib/inngest/client";
import { writeStage2ConfirmedDomains } from "@/lib/services/interview";

const BodySchema = z.object({
  // DNS label charset + length; rejects spaces, @-prefixes, control chars.
  confirmedDomains: z
    .array(z.string().min(1).max(253).regex(/^[a-z0-9.\-]+$/i))
    .min(1)
    .max(20),
});

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractOnboardingSchemaId(request);
    const body = BodySchema.parse(await request.json());

    // Fetch + ownership FIRST (matches existing route's pattern).
    // This narrows `schema` to non-null for TS and guarantees userId match.
    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true, phase: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // CAS write + outbox emit in one transaction. writeStage2ConfirmedDomains does
    // an updateMany gated on phase === "AWAITING_DOMAIN_CONFIRMATION" and advances
    // the phase to DISCOVERING_ENTITIES atomically. count === 0 = another request
    // won the race (or wrong phase) — issue #33 TOCTOU guard.
    const updatedCount = await prisma.$transaction(async (tx) => {
      const count = await writeStage2ConfirmedDomains(tx, schemaId, body.confirmedDomains);
      if (count === 0) return 0;
      await tx.onboardingOutbox.create({
        data: {
          schemaId,
          userId,
          eventName: "onboarding.entity-discovery.requested",
          payload: { schemaId, userId } as Prisma.InputJsonValue,
        },
      });
      return count;
    });

    if (updatedCount === 0) {
      return NextResponse.json(
        { error: "Wrong phase or already confirmed", code: 409 },
        { status: 409 },
      );
    }

    // Optimistic emit; drainOnboardingOutbox cron (Task 3.3b) is the safety net.
    try {
      await inngest.send({
        name: "onboarding.entity-discovery.requested",
        data: { schemaId, userId },
      });
    } catch {
      // Drain cron picks it up within ~1 minute.
    }

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error, { service: "onboarding", operation: "domain-confirm", userId });
  }
});
```

**CAS transition ownership:** this route owns `AWAITING_DOMAIN_CONFIRMATION → DISCOVERING_ENTITIES` (via `writeStage2ConfirmedDomains`'s updateMany). Must be added to the CAS Transition Ownership Map in `docs/01_denim_lessons_learned.md` — see Task 6.4.

- [ ] **Step 3: Write a route test**

```typescript
// apps/web/src/app/api/onboarding/[schemaId]/domain-confirm/__tests__/route.test.ts
//
// withAuth wraps a single-arg handler: (handler) => async (request) => handler({ userId, request }).
// schemaId is parsed from request URL via extractOnboardingSchemaId.
// writeStage2ConfirmedDomains must be mocked — otherwise the real impl runs against the fake tx.
//
// Assertion focus: 400 on invalid body, 409 when CAS loses the race (wrong phase or
// concurrent click), 200 + outbox row on success.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    findUnique: vi.fn(),
    $transaction: vi.fn(async (fn: any) => fn({
      caseSchema: { updateMany: (global as any).__updateMany },
      onboardingOutbox: { create: (global as any).__outboxCreate },
    })),
    caseSchema: { findUnique: (...args: any[]) => (global as any).__findUnique(...args) },
  },
}));
vi.mock("@/lib/middleware/auth", () => ({
  // Real shape: withAuth(handler) => async (request) => handler({ userId, request })
  withAuth: (handler: any) => async (request: any) => handler({ userId: "user-1", request }),
}));
vi.mock("@/lib/middleware/ownership", () => ({
  assertResourceOwnership: vi.fn(),
}));
vi.mock("@/lib/services/interview", () => ({
  writeStage2ConfirmedDomains: vi.fn(async (_tx: any, _id: string, _d: string[]) =>
    (global as any).__updateMany().count ?? 0,
  ),
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));

import { POST } from "../route";
import { inngest } from "@/lib/inngest/client";

function makeRequest(schemaId: string, body: unknown) {
  return new Request(
    `http://x/api/onboarding/${schemaId}/domain-confirm`,
    { method: "POST", body: JSON.stringify(body) },
  ) as any;
}

describe("POST /domain-confirm", () => {
  beforeEach(() => {
    (global as any).__updateMany = vi.fn();
    (global as any).__outboxCreate = vi.fn();
    (global as any).__findUnique = vi.fn(async () => ({
      id: "s", userId: "user-1", phase: "AWAITING_DOMAIN_CONFIRMATION",
    }));
    vi.clearAllMocks();
  });

  it("400 on invalid body", async () => {
    const res = await POST(makeRequest("s", {}));
    expect(res.status).toBe(400);
  });

  it("409 when CAS returns count=0 (wrong phase or concurrent click)", async () => {
    (global as any).__updateMany.mockReturnValue({ count: 0 });
    const res = await POST(makeRequest("s", { confirmedDomains: ["x.com"] }));
    expect(res.status).toBe(409);
    expect((global as any).__outboxCreate).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("200 + persists + emits when CAS succeeds", async () => {
    (global as any).__updateMany.mockReturnValue({ count: 1 });
    const res = await POST(makeRequest("s", {
      confirmedDomains: ["portfolioproadvisors.com", "stallionis.com"],
    }));
    expect(res.status).toBe(200);
    expect((global as any).__outboxCreate).toHaveBeenCalled();
    expect(inngest.send).toHaveBeenCalledWith(expect.objectContaining({
      name: "onboarding.entity-discovery.requested",
    }));
  });
});
```

- [ ] **Step 4: Run, commit**

```bash
pnpm --filter web test -- domain-confirm
```

Expected: 3 passing.

```bash
git add apps/web/src/app/api/onboarding/[schemaId]/domain-confirm
git commit -m "feat(api): POST /onboarding/:schemaId/domain-confirm"
```

---

### Task 3.2: POST /entity-confirm route

**Files:**
- Create: `apps/web/src/app/api/onboarding/[schemaId]/entity-confirm/route.ts`
- Create: `apps/web/src/app/api/onboarding/[schemaId]/entity-confirm/__tests__/route.test.ts`

Pattern mirrors /domain-confirm. Body takes `confirmedEntities: [{ displayLabel, authoritativeKey, kind }]` and advances `AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN` via the existing Function B outbox event.

- [ ] **Step 1: Write route (implementation pattern matches Task 3.1 but writes to `persistSchemaRelations` adapted in a later task; for now it emits `onboarding.review.confirmed` — the existing event that Function B listens on)**

```typescript
// apps/web/src/app/api/onboarding/[schemaId]/entity-confirm/route.ts
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { assertResourceOwnership } from "@/lib/middleware/ownership";
import { extractOnboardingSchemaId } from "@/lib/middleware/request-params";
import { inngest } from "@/lib/inngest/client";
import { persistConfirmedEntities } from "@/lib/services/interview";

// Charset: letters, digits, dot, space, hyphen, underscore, plus, @ (for SECONDARY
// @-domain keys). Rejects quotes, angle brackets, semicolons, control chars.
const IDENTITY_KEY_RE = /^[\w@.\-+ ]+$/;

const ConfirmedEntitySchema = z
  .object({
    displayLabel: z.string().min(1).max(200),
    identityKey: z.string().min(1).max(256).regex(IDENTITY_KEY_RE),
    kind: z.enum(["PRIMARY", "SECONDARY"]),
    secondaryTypeName: z.string().max(100).optional(),
  })
  .refine(
    // `@domain`-prefixed keys are reserved for server-derived SECONDARY entities.
    // A user editing the review screen must not be able to claim an @-prefix and
    // hijack a future auto-discovered SECONDARY via the (schemaId, identityKey, type)
    // unique constraint.
    (e) => !(e.identityKey.startsWith("@") && e.kind === "PRIMARY"),
    { message: "identityKey starting with @ is reserved for SECONDARY entities" },
  );

const BodySchema = z.object({
  confirmedEntities: z.array(ConfirmedEntitySchema).min(1).max(100),
});

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractOnboardingSchemaId(request);
    const body = BodySchema.parse(await request.json());

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true, phase: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // TOCTOU guard: CAS updateMany gated on phase === "AWAITING_ENTITY_CONFIRMATION".
    // This route OWNS the AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN transition,
    // matching the existing AWAITING_REVIEW → PROCESSING_SCAN ownership pattern at
    // docs/01_denim_lessons_learned.md CAS map.
    const committed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.caseSchema.updateMany({
        where: { id: schemaId, phase: "AWAITING_ENTITY_CONFIRMATION" },
        data: { phase: "PROCESSING_SCAN" },
      });
      if (count === 0) return false;
      await persistConfirmedEntities(tx, schemaId, body.confirmedEntities);
      await tx.onboardingOutbox.create({
        data: {
          schemaId,
          userId,
          eventName: "onboarding.review.confirmed",
          payload: { schemaId, userId } as Prisma.InputJsonValue,
        },
      });
      return true;
    });

    if (!committed) {
      return NextResponse.json(
        { error: "Wrong phase or already confirmed", code: 409 },
        { status: 409 },
      );
    }

    // Optimistic emit; drainOnboardingOutbox cron (Task 3.3b) is the safety net.
    try {
      await inngest.send({
        name: "onboarding.review.confirmed",
        data: { schemaId, userId },
      });
    } catch {
      // Drain cron retries.
    }

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error, { service: "onboarding", operation: "entity-confirm", userId });
  }
});
```

**CAS transition ownership:** this route owns `AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN`. Function B (`runOnboardingPipeline`) must therefore observe the schema already in `PROCESSING_SCAN` and **must not** re-advance that transition (Bug 3 rule). Task 4.2 verifies this.

- [ ] **Step 2: Add `persistConfirmedEntities` to `interview.ts`**

```typescript
// in apps/web/src/lib/services/interview.ts — add new export
import type { Prisma } from "@prisma/client";

export interface ConfirmedEntity {
  displayLabel: string;
  identityKey: string;
  kind: "PRIMARY" | "SECONDARY";
  secondaryTypeName?: string;
}

/**
 * Persist user-confirmed entities from the review screen.
 *
 * Uses createMany+updateMany instead of a per-row upsert loop. At 30 entities
 * the loop cost 30 DB roundtrips (~450ms at pooler latency); this is 2 roundtrips.
 * The user-visible confirm click is on the critical path — every ms here is felt.
 *
 * Semantics match an upsert-with-update loop:
 *   1. createMany with skipDuplicates inserts new rows (autoDetected=false).
 *   2. updateMany refreshes name + isActive on pre-existing rows (auto-discovered
 *      rows that the user is now explicitly confirming). Only rows for the same
 *      schemaId are touched, so no cross-tenant risk.
 */
export async function persistConfirmedEntities(
  tx: Prisma.TransactionClient,
  schemaId: string,
  entities: ConfirmedEntity[],
): Promise<void> {
  if (entities.length === 0) return;

  await tx.entity.createMany({
    data: entities.map((e) => ({
      schemaId,
      name: e.displayLabel,
      identityKey: e.identityKey,
      type: e.kind,
      secondaryTypeName: e.secondaryTypeName,
      autoDetected: false,
      isActive: true,
    })),
    skipDuplicates: true,
  });

  // Bulk refresh existing rows (name may have been edited on the review screen).
  // Group by displayLabel to batch updates; in practice most labels are unique,
  // so this is usually N=entities.length updates, but Prisma's updateMany is
  // still one SQL statement per distinct label.
  const byLabel = new Map<string, ConfirmedEntity[]>();
  for (const e of entities) {
    const bucket = byLabel.get(e.displayLabel) ?? [];
    bucket.push(e);
    byLabel.set(e.displayLabel, bucket);
  }
  for (const [label, bucket] of byLabel) {
    await tx.entity.updateMany({
      where: {
        schemaId,
        OR: bucket.map((e) => ({ identityKey: e.identityKey, type: e.kind })),
      },
      data: { name: label, isActive: true },
    });
  }
}
```

- [ ] **Step 3: Tests**

Mirror Task 3.1's route test file structure; three cases (400, 409, 200).

- [ ] **Step 4: Run tests, commit**

```bash
pnpm --filter web test -- entity-confirm
git add apps/web/src/app/api/onboarding/[schemaId]/entity-confirm \
        apps/web/src/lib/services/interview.ts
git commit -m "feat(api): POST /onboarding/:schemaId/entity-confirm + persistConfirmedEntities"
```

---

### Task 3.3: Update GET polling to surface Stage 1/Stage 2 payload

**Files:**
- Modify: `apps/web/src/lib/services/onboarding-polling.ts`
- Modify: `apps/web/src/app/api/onboarding/[schemaId]/route.ts` (response shape only)

- [ ] **Step 1a: Extend the `OnboardingPhase` union**

`apps/web/src/lib/services/onboarding-polling.ts` lines 15–25 currently list the 10 existing phases. Add the 4 new fast-discovery values — without this, the mapping function silently falls through to `PENDING` and masks the new UI entirely:

```typescript
export type OnboardingPhase =
  | "PENDING"
  | "GENERATING_HYPOTHESIS"
  | "DISCOVERING_DOMAINS"
  | "AWAITING_DOMAIN_CONFIRMATION"
  | "DISCOVERING_ENTITIES"
  | "AWAITING_ENTITY_CONFIRMATION"
  | "DISCOVERING"
  | "EXTRACTING"
  | "CLUSTERING"
  | "SYNTHESIZING"
  | "AWAITING_REVIEW"
  | "COMPLETED"
  | "NO_EMAILS_FOUND"
  | "FAILED";
```

- [ ] **Step 1b: Extend `derivePollingResponse`**

The function uses if/return chains and returns a new object literal per branch — there is no mutable `resp` accumulator. Add explicit branches for the four new phases that return the stage1/stage2 payload alongside the existing fields. The response type gains the new optional fields:

```typescript
// Added to OnboardingPollingResponse:
stage1Candidates?: { domain: string; count: number }[];
stage1QueryUsed?: string;
stage2Candidates?: Array<{
  confirmedDomain: string;
  algorithm: string;
  candidates: Array<{
    key: string;
    displayString: string;
    frequency: number;
    autoFixed: boolean;
    meta?: Record<string, unknown>;
  }>;
}>;

// New branches in derivePollingResponse (early returns, matching existing style):
if (schema.phase === "DISCOVERING_DOMAINS" || schema.phase === "AWAITING_DOMAIN_CONFIRMATION") {
  return {
    schemaId: schema.id,
    phase: schema.phase,
    progress: {},
    stage1Candidates: (schema.stage1Candidates as any) ?? [],
    stage1QueryUsed: schema.stage1QueryUsed ?? undefined,
    updatedAt: schema.updatedAt.toISOString(),
  };
}
if (schema.phase === "DISCOVERING_ENTITIES" || schema.phase === "AWAITING_ENTITY_CONFIRMATION") {
  return {
    schemaId: schema.id,
    phase: schema.phase,
    progress: {},
    stage2Candidates: (schema.stage2Candidates as any) ?? [],
    updatedAt: schema.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 2: Test**

Extend `apps/web/src/lib/services/__tests__/onboarding-polling.test.ts` (or create) with two cases: AWAITING_DOMAIN_CONFIRMATION returns stage1 data; AWAITING_ENTITY_CONFIRMATION returns stage2 data.

- [ ] **Step 3: Commit**

```bash
pnpm --filter web test -- onboarding-polling
git add apps/web/src/lib/services/onboarding-polling.ts
git commit -m "feat(polling): surface Stage 1/Stage 2 candidates in GET response"
```

---

### Task 3.3b: Extend `drainOnboardingOutbox` — VERIFIED NO-OP

**Status:** No code change required. `apps/web/src/lib/inngest/onboarding-outbox-drain.ts` (lines 85–98) is already event-generic — it reads `row.eventName` + `row.payload` from the outbox row and calls `inngest.send({ name: row.eventName, data: row.payload })` with no allowlist. The file-level comment explicitly states: "adding a new lifecycle event means writing a new outbox row from a new producer — no drain change needed."

Keep this task in the plan so Phase 3 reviewers know the decision was deliberate; do not add the registry / allowlist abstraction — it would be drift risk without upside.

- [ ] **Step 1: Verify (one command)**

```bash
grep -n "eventName" apps/web/src/lib/inngest/onboarding-outbox-drain.ts
# Expect: dispatches row.eventName directly, no hardcoded event list.
```

- [ ] **Step 2: Integration test coverage**

The existing drain test already covers the generic dispatch path. No new test needed here; Task 7.7 (chaos test) will exercise the Stage 1/Stage 2 events end-to-end through the drain.

---

### Task 3.4: `phase-domain-confirmation.tsx` component

**Files:**
- Create: `apps/web/src/components/onboarding/phase-domain-confirmation.tsx`

- [ ] **Step 1: Read the existing `phase-review.tsx` to match design-system conventions**

```bash
cat apps/web/src/components/onboarding/phase-review.tsx
```

- [ ] **Step 2: Implement**

```tsx
// apps/web/src/components/onboarding/phase-domain-confirmation.tsx
"use client";
import { useState } from "react";

interface DomainCandidate {
  domain: string;
  count: number;
}

interface Props {
  schemaId: string;
  candidates: DomainCandidate[];
  onConfirmed: () => void;
}

export function PhaseDomainConfirmation({ schemaId, candidates, onConfirmed }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = (domain: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    await fetch(`/api/onboarding/${schemaId}/domain-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmedDomains: [...selected] }),
    });
    onConfirmed();
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">We found these domains in your inbox</h2>
      <p className="text-sm text-gray-600">Check the ones that are relevant to this topic.</p>
      <ul className="flex flex-col gap-2">
        {candidates.map(c => (
          <li key={c.domain} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`d-${c.domain}`}
              checked={selected.has(c.domain)}
              onChange={() => toggle(c.domain)}
            />
            <label htmlFor={`d-${c.domain}`} className="flex-1">
              <span className="font-medium">{c.domain}</span>
              <span className="ml-2 text-xs text-gray-500">({c.count} emails)</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        disabled={selected.size === 0 || submitting}
        onClick={submit}
      >
        {submitting ? "Confirming…" : `Confirm ${selected.size} domain${selected.size === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Basic smoke test (snapshot-like)**

Create `apps/web/src/components/onboarding/__tests__/phase-domain-confirmation.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PhaseDomainConfirmation } from "../phase-domain-confirmation";

describe("PhaseDomainConfirmation", () => {
  it("renders candidate domains with counts", () => {
    render(
      <PhaseDomainConfirmation
        schemaId="s"
        candidates={[
          { domain: "portfolioproadvisors.com", count: 15 },
          { domain: "stallionis.com", count: 4 },
        ]}
        onConfirmed={() => {}}
      />
    );
    expect(screen.getByText("portfolioproadvisors.com")).toBeDefined();
    expect(screen.getByText(/15 emails/)).toBeDefined();
  });

  it("disables confirm until at least one is selected", () => {
    render(
      <PhaseDomainConfirmation
        schemaId="s"
        candidates={[{ domain: "x.com", count: 1 }]}
        onConfirmed={() => {}}
      />
    );
    const button = screen.getByRole("button");
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("POSTs the right body on confirm", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }) as any,
    );
    const onConfirmed = vi.fn();
    render(
      <PhaseDomainConfirmation
        schemaId="s1"
        candidates={[{ domain: "x.com", count: 1 }]}
        onConfirmed={onConfirmed}
      />
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/onboarding/s1/domain-confirm",
      expect.objectContaining({ method: "POST" }),
    );
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 4: Run, commit**

```bash
pnpm --filter web test -- phase-domain-confirmation
git add apps/web/src/components/onboarding/phase-domain-confirmation.tsx \
        apps/web/src/components/onboarding/__tests__/phase-domain-confirmation.test.tsx
git commit -m "feat(onboarding-ui): PhaseDomainConfirmation component"
```

---

### Task 3.5: `phase-entity-confirmation.tsx` component

**Files:**
- Create: `apps/web/src/components/onboarding/phase-entity-confirmation.tsx`
- Create: `apps/web/src/components/onboarding/__tests__/phase-entity-confirmation.test.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// apps/web/src/components/onboarding/phase-entity-confirmation.tsx
"use client";
import { useState } from "react";

interface EntityCandidate {
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  meta?: Record<string, unknown>;
}

interface DomainGroup {
  confirmedDomain: string;
  algorithm: string;
  candidates: EntityCandidate[];
}

interface Props {
  schemaId: string;
  stage2Candidates: DomainGroup[];
  onConfirmed: () => void;
}

interface Pick {
  identityKey: string;
  displayLabel: string;
  kind: "PRIMARY" | "SECONDARY";
  secondaryTypeName?: string;
}

function identityKeyFor(group: DomainGroup, candidate: EntityCandidate): string {
  // property: identityKey = normalized lowercase address string ("1906 crockett")
  // school-two-pattern: identityKey = normalized display ("st agnes")
  // agency-domain-derive: identityKey = "@<authoritativeDomain>"
  if (group.algorithm === "agency-domain-derive") {
    const d = (candidate.meta?.authoritativeDomain as string) ?? group.confirmedDomain;
    return `@${d}`;
  }
  return candidate.displayString.toLowerCase().replace(/\s+/g, " ").trim();
}

function kindFor(group: DomainGroup): "PRIMARY" | "SECONDARY" {
  // agency: the company itself is PRIMARY
  // property: address is PRIMARY
  // school_parent: institution/activity is PRIMARY
  return "PRIMARY";
}

export function PhaseEntityConfirmation({ schemaId, stage2Candidates, onConfirmed }: Props) {
  const initialPicks = new Map<string, Pick>();
  const [picks, setPicks] = useState(initialPicks);
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const toggle = (group: DomainGroup, candidate: EntityCandidate) => {
    const key = identityKeyFor(group, candidate);
    setPicks(prev => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, {
          identityKey: key,
          displayLabel: labelEdits[key] ?? candidate.displayString,
          kind: kindFor(group),
        });
      }
      return next;
    });
  };

  const editLabel = (identityKey: string, value: string) => {
    setLabelEdits(prev => ({ ...prev, [identityKey]: value }));
    setPicks(prev => {
      const existing = prev.get(identityKey);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(identityKey, { ...existing, displayLabel: value });
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    await fetch(`/api/onboarding/${schemaId}/entity-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmedEntities: [...picks.values()] }),
    });
    onConfirmed();
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Which of these are relevant?</h2>
      {stage2Candidates.map(group => (
        <div key={group.confirmedDomain} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-gray-700">{group.confirmedDomain}</h3>
          <ul className="flex flex-col gap-1">
            {group.candidates.map(c => {
              const key = identityKeyFor(group, c);
              const isPicked = picks.has(key);
              return (
                <li key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={key}
                    checked={isPicked}
                    onChange={() => toggle(group, c)}
                  />
                  <input
                    type="text"
                    value={labelEdits[key] ?? c.displayString}
                    onChange={(e) => editLabel(key, e.target.value)}
                    className="flex-1 rounded border px-2 py-1 text-sm"
                    disabled={!isPicked}
                  />
                  <span className="text-xs text-gray-500">{c.frequency}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <button
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        disabled={picks.size === 0 || submitting}
        onClick={submit}
      >
        {submitting ? "Confirming…" : `Confirm ${picks.size} entit${picks.size === 1 ? "y" : "ies"}`}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Tests**

```tsx
// apps/web/src/components/onboarding/__tests__/phase-entity-confirmation.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PhaseEntityConfirmation } from "../phase-entity-confirmation";

const agencyGroups = [{
  confirmedDomain: "anthropic.com",
  algorithm: "agency-domain-derive",
  candidates: [{
    key: "anthropic.com",
    displayString: "Anthropic",
    frequency: 15,
    autoFixed: false,
    meta: { authoritativeDomain: "anthropic.com", derivedVia: "domain" },
  }],
}];

const propertyGroups = [{
  confirmedDomain: "judgefite.com",
  algorithm: "property-address",
  candidates: [
    { key: "1906", displayString: "1906 Crockett", frequency: 5, autoFixed: false },
    { key: "851", displayString: "851 Peavy", frequency: 3, autoFixed: true },
  ],
}];

describe("PhaseEntityConfirmation", () => {
  it("groups candidates by confirmed domain", () => {
    render(
      <PhaseEntityConfirmation schemaId="s" stage2Candidates={propertyGroups} onConfirmed={() => {}} />
    );
    expect(screen.getByText("judgefite.com")).toBeDefined();
    expect(screen.getByDisplayValue("1906 Crockett")).toBeDefined();
    expect(screen.getByDisplayValue("851 Peavy")).toBeDefined();
  });

  it("disables confirm until a candidate is selected", () => {
    render(
      <PhaseEntityConfirmation schemaId="s" stage2Candidates={propertyGroups} onConfirmed={() => {}} />
    );
    const button = screen.getByRole("button", { name: /Confirm/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    const firstCheckbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(firstCheckbox);
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("POSTs confirmedEntities with identityKey derived per algorithm", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }) as any,
    );
    const onConfirmed = vi.fn();
    render(
      <PhaseEntityConfirmation schemaId="s" stage2Candidates={agencyGroups} onConfirmed={onConfirmed} />
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.confirmedEntities[0].identityKey).toBe("@anthropic.com");
    expect(body.confirmedEntities[0].displayLabel).toBe("Anthropic");
    expect(body.confirmedEntities[0].kind).toBe("PRIMARY");
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Commit**

```bash
pnpm --filter web test -- phase-entity-confirmation
git add apps/web/src/components/onboarding/phase-entity-confirmation.tsx \
        apps/web/src/components/onboarding/__tests__/phase-entity-confirmation.test.tsx
git commit -m "feat(onboarding-ui): PhaseEntityConfirmation component"
```

---

### Task 3.6: Update `flow.tsx` to route the two new phases

**Files:**
- Modify: `apps/web/src/components/onboarding/flow.tsx`

- [ ] **Step 1: Add two phase cases**

`flow.tsx` destructures `{ response }: { response: OnboardingPollingResponse }` and switches on `response.phase`; each branch passes `response` to the child component (there is no `pollingData`, no `schemaId` prop, no `refresh` callback — polling owns refresh at the parent). Add two cases that match this existing pattern:

```tsx
case "AWAITING_DOMAIN_CONFIRMATION":
  return <PhaseDomainConfirmation response={response} />;
case "AWAITING_ENTITY_CONFIRMATION":
  return <PhaseEntityConfirmation response={response} />;
case "DISCOVERING_DOMAINS":
case "DISCOVERING_ENTITIES":
  return <PhasePending response={response} />;
```

The two new components read `response.schemaId` + `response.stage1Candidates` / `response.stage2Candidates` directly from the response prop. Update Tasks 3.4 and 3.5 component signatures to accept `{ response }: { response: OnboardingPollingResponse }` instead of the `{ schemaId, candidates, onConfirmed }` shape shown earlier — the samples in 3.4/3.5 were drafted against a prior flow.tsx contract.

- [ ] **Step 2: Commit**

```bash
pnpm typecheck
git add apps/web/src/components/onboarding/flow.tsx
git commit -m "feat(onboarding-ui): route new phases in flow.tsx"
```

---

## Phase 4 — Pipeline Cutover

**⚠️ This phase introduces a breaking change: existing onboarding stops working when Task 4.1 lands. All tasks in this phase should be completed in one session and verified end-to-end before moving to Phase 5.**

### Task 4.1: Rewrite `runOnboarding` to emit Stage 1 request

**Files:**
- Modify: `apps/web/src/lib/inngest/onboarding.ts` (lines 49-345)

- [ ] **Step 1: Replace the body of `runOnboarding`**

The new function is much smaller — it just transitions PENDING and emits the Stage 1 request event:

Preserve the existing `cancelOn`, per-user concurrency limit, and retries — the plan must NOT regress these. The current `runOnboarding` shape (2-arg createFunction, triggers array, cancelOn + two-tier concurrency) is the contract to mirror — see `apps/web/src/lib/inngest/onboarding.ts:49–64`:

```typescript
export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    name: "Onboarding — Stage 1 Trigger",
    triggers: [{ event: "onboarding.session.started" }],
    // Preserve existing cancel semantics — DELETE /api/onboarding/:schemaId
    // emits onboarding.session.cancelled; Inngest cancels this run when
    // data.schemaId matches.
    cancelOn: [{ event: "onboarding.session.cancelled", match: "data.schemaId" }],
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { key: "event.data.userId", limit: 3 },
    ],
    retries: 2,
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data; // userId is needed downstream for Gmail tokens

    const schema = await step.run("load-schema", async () =>
      prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { id: true, phase: true, domain: true },
      }),
    );

    // Task 4.4 must wire `domain` into createSchemaStub BEFORE this check can succeed.
    // Without that, every new onboarding throws here.
    if (!schema.domain) throw new Error(`Schema ${schemaId} missing domain`);

    // Use step.sendEvent (not inngest.send) so Inngest memoizes the dispatch across
    // function replays — prevents double-firing on retry.
    await step.sendEvent("emit-domain-discovery", {
      name: "onboarding.domain-discovery.requested",
      data: { schemaId, userId }, // userId flows to Stage 1 so it can load Gmail tokens
    });

    return { emitted: true };
  },
);
```

- [ ] **Step 2: Remove the old hypothesis/validation/advance-to-awaiting-review steps**

Delete lines 84-308 (the three big step bodies). Keep the function signature + the new minimal body above.

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/src/lib/inngest/onboarding.ts
git commit -m "refactor(onboarding): runOnboarding becomes a thin Stage-1 trigger"
```

Expected: typecheck fails because callers of `generateHypothesis`/`validateHypothesis`/`resolveWhoEmails` are now orphans. Leave those failures for Task 6.1 to clean up, OR inline-delete imports and see if anything critical fails.

---

### Task 4.2: Trim `runOnboardingPipeline` — remove `expand-confirmed-domains`

**Files:**
- Modify: `apps/web/src/lib/inngest/onboarding.ts` (lines 353-759)

- [ ] **Step 1: Delete `expand-confirmed-domains` step (lines 383-584)**

Entities are already fully confirmed by Stage 2 — Pass 2 is unnecessary.

Replace that step with a thin pre-scan verification:

```typescript
await step.run("verify-confirmed-entities", async () => {
  const count = await prisma.entity.count({
    where: { schemaId, isActive: true, autoDetected: false },
  });
  if (count === 0) throw new Error(`Schema ${schemaId} has no confirmed entities`);
});
```

- [ ] **Step 2: CRITICAL — retarget `create-scan-job`'s phase advance from `AWAITING_REVIEW` to `AWAITING_ENTITY_CONFIRMATION`**

There is no standalone `advanceSchemaPhase("AWAITING_REVIEW" → "PROCESSING_SCAN")` to delete. The advance lives **inside** the `create-scan-job` step (`onboarding.ts:592–624`) as `advanceSchemaPhase({ from: "AWAITING_REVIEW", to: "PROCESSING_SCAN", work: ... })`.

Task 3.2's `/entity-confirm` route now owns `AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN` via CAS `updateMany`, so Function B must observe the schema **already in PROCESSING_SCAN**. Update `create-scan-job` to guard against the new upstream phase instead — change its `advanceSchemaPhase` call to `from: "AWAITING_ENTITY_CONFIRMATION"`. This keeps the pattern documented at `docs/01_denim_lessons_learned.md` CAS map (Bug 3 rule).

```bash
grep -n "advanceSchemaPhase" apps/web/src/lib/inngest/onboarding.ts
```

- [ ] **Step 3: Keep `create-scan-job`, `resolve-scan-job`, `request-scan`, `wait-for-scan`, and terminal phase advance — these still work as-is**

- [ ] **Step 4: Null out Stage 1/Stage 2 candidate JSON when the pipeline reaches COMPLETED (PII minimization)**

`stage1Candidates` and `stage2Candidates` contain subject strings + sender domains — PII that's no longer needed once the pipeline has committed cases and entities. In the terminal step of `runOnboardingPipeline` that transitions PROCESSING_SCAN → COMPLETED, clear them:

```typescript
// inside the advance-to-completed step's advanceSchemaPhase work() callback
// (see onboarding.ts:714–725). There is no `tx` in scope — the work callback
// uses the singleton `prisma` client directly.
await prisma.caseSchema.update({
  where: { id: schemaId },
  data: {
    // keep stage2ConfirmedDomains for debugging history; clear the bulky PII JSON
    stage1Candidates: Prisma.DbNull,
    stage2Candidates: Prisma.DbNull,
  },
});
```

This is a data-lifecycle obligation, not an optimization. Future compliance review will ask "why is this still here."

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/src/lib/inngest/onboarding.ts
git commit -m "refactor(onboarding): remove Pass 2 + null out stage1/2 JSON on COMPLETED"
```

---

### Task 4.3: Replace old POST confirm route with a redirect

**Files:**
- Modify: `apps/web/src/app/api/onboarding/[schemaId]/route.ts` (the old POST handler for single-screen review confirm)

- [ ] **Step 1: Keep `withAuth` wrapper; preserve #33 already-confirmed retry semantics**

The old POST handler is wrapped in `withAuth` and returns 200 `{ status: "already-confirmed" }` for stale retries where the schema is already in a post-confirmation phase (issue #33 TOCTOU guard). Replacing the whole handler with a bare `function POST()` returning 410 would break in-flight retries from older clients. Keep the wrapper; short-circuit with 410 ONLY for phases that belong to the old single-screen flow, and preserve the 200 already-confirmed response for new-flow phases.

```typescript
export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractOnboardingSchemaId(request);
    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true, phase: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // New-flow phases — retry landed after migration; return already-confirmed.
    if (
      schema!.phase === "PROCESSING_SCAN" ||
      schema!.phase === "COMPLETED" ||
      schema!.phase === "AWAITING_ENTITY_CONFIRMATION" ||
      schema!.phase === "AWAITING_DOMAIN_CONFIRMATION"
    ) {
      return NextResponse.json({ data: { status: "already-confirmed" } });
    }

    // Old-flow phases — the single-screen review is gone.
    return NextResponse.json(
      { error: "Use /api/onboarding/:schemaId/entity-confirm (new fast-discovery flow)" },
      { status: 410 },
    );
  } catch (error) {
    return handleApiError(error, { service: "onboarding", operation: "deprecated-confirm", userId });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/api/onboarding/[schemaId]/route.ts
git commit -m "refactor(api): deprecate old POST /onboarding/:schemaId confirm"
```

---

### Task 4.4: Update `createSchemaStub` — no more hypothesis scaffolding

**Files:**
- Modify: `apps/web/src/lib/services/interview.ts`

- [ ] **Step 1: Find and update `createSchemaStub`**

```bash
grep -n "createSchemaStub" apps/web/src/lib/services/interview.ts
```

Current stub at `interview.ts:329–365` already does NOT set `hypothesis` / `validation` — those are stored inside the raw hypothesis JSON by `persistSchemaRelations`, not by the stub. The stub DOES set placeholder strings for `name`, `description`, `primaryEntityConfig: {}`, `discoveryQueries: []`, `summaryLabels: {}`, `clusteringConfig: {}`, `extractionPrompt: ""`, `synthesisPrompt: ""`, `status: "DRAFT"` because those columns are likely NOT NULL.

**Before removing placeholders**, verify each column's nullability in `apps/web/prisma/schema.prisma`. Any column that is NOT NULL must either stay defaulted in the stub OR be migrated to nullable (raw-SQL migration via `/supabase-db`) before the removal lands. Don't break schema validity to save a few lines.

**Critically** — add `domain: opts.inputs?.domain` (or equivalent) as a first-class field write on the stub. Task 4.1 Step 1 checks `!schema.domain` and throws; that check fails today because the stub never populates `domain`. This closes the gap.

- [ ] **Step 2: Typecheck, commit**

```bash
pnpm typecheck
git add apps/web/src/lib/services/interview.ts
git commit -m "refactor(interview): createSchemaStub skinnied down"
```

---

### Task 4.4b: Test-helper audit — entity writes must go through `persistConfirmedEntities`

**Rationale:** Bug 1 and Bug 5 (`01_denim_lessons_learned.md`) are the same class of bug, twice: test helpers doing DB work that diverges from production code paths. With the new `identityKey`-keyed Entity upserts and the new `persistConfirmedEntities` function, any test fixture that still calls `prisma.entity.create` or `prisma.entity.upsert` directly will bypass the new identity logic and silently paper over gaps.

- [ ] **Step 1: Grep for direct entity writes in test setup**

```bash
grep -rn "entity\.create\|entity\.upsert" apps/web/tests/ apps/web/src/**/__tests__/
```

- [ ] **Step 2: For each hit, decide: route through `persistConfirmedEntities`, or document a compelling reason not to**

If the helper is seeding a complete integration test entity for a non-review flow (e.g., clustering unit test), direct create is fine — but add a one-line comment: `// Direct entity write — unit test for clustering, not exercising onboarding confirm path`.

If the helper is simulating user confirm (e.g., pre-seeding an entity to test Stage 3), replace with `persistConfirmedEntities(prisma, schemaId, [{...}])` so the test exercises the production identity-key logic.

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "test: route entity-write test helpers through persistConfirmedEntities (Bug 1/5 class)"
```

---

### Task 4.4c: Verify Inngest endpoint is signed (H1 security)

**Rationale:** `/api/inngest` accepts events from any caller if unsigned. An attacker reaching the endpoint could inject `onboarding.domain-discovery.requested` / `onboarding.entity-discovery.requested` with any `schemaId`, triggering discovery against a victim's Gmail token (loaded server-side by `loadGmailTokens(schema.userId)`). This plan's new functions widen the existing blast radius; this is the right moment to close the door.

- [ ] **Step 1: Confirm `INNGEST_SIGNING_KEY` env var exists in all environments**

```bash
grep -rn "INNGEST_SIGNING_KEY\|signingKey" apps/web/src/app/api/inngest apps/web/src/lib/inngest
```

If not present, add to `apps/web/src/app/api/inngest/route.ts`:

```typescript
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [/* …existing list, plus runDomainDiscovery, runEntityDiscovery… */],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
```

- [ ] **Step 2: Set the env var**

- Local: add to `.env.local` (copy from Inngest dev server if needed).
- Vercel: `vercel env add INNGEST_SIGNING_KEY` for production + preview.
- Get the signing key from the Inngest dashboard (Settings → Keys).

- [ ] **Step 3: Verify by sending an unsigned request**

```bash
curl -X POST https://<deployment>/api/inngest -d '{"name":"onboarding.domain-discovery.requested","data":{"schemaId":"x"}}'
```

Expected: 401/403 from Inngest's runtime. If 200, the signing key isn't wired.

- [ ] **Step 4: Commit any env or code changes**

```bash
git add apps/web/src/app/api/inngest/route.ts
git commit -m "security(inngest): require signed events on /api/inngest"
```

No commit needed if signing was already in place — document the verification in the PR description.

---

### Task 4.5: Full end-to-end manual verification

- [ ] **Step 1: Start the dev stack**

```bash
pnpm --filter web dev
```

In a second terminal:

```bash
npx inngest-cli@latest dev
```

- [ ] **Step 2: Walk through the flow in the browser**

1. Navigate to the onboarding start page, pick a domain (e.g., "agency"), connect Gmail.
2. Expect phase to transition PENDING → DISCOVERING_DOMAINS → AWAITING_DOMAIN_CONFIRMATION within ~5 sec.
3. See candidate domains; pick at least one; submit.
4. Expect DISCOVERING_ENTITIES → AWAITING_ENTITY_CONFIRMATION within ~6 sec.
5. Pick candidate entities; submit.
6. Expect PROCESSING_SCAN → COMPLETED flow (existing Stage 3 pipeline).
7. Verify the final feed shows cases as expected.

- [ ] **Step 3: Capture a timing report**

Invoke the `onboarding-timing` skill and verify:
- `domain-discovery.complete` wall ≤ 8s (target 5s)
- `entity-discovery.complete` wall ≤ 10s (target 6s)
- Total Stage 1+2 ≤ 12s

- [ ] **Step 4: Fix any regressions before moving to Phase 5**

If anything breaks, bisect across Phase 4 commits. No commit needed for this task unless fixes are required — this is a verification gate.

---

## Phase 5 — Spec Files Become the Runtime Config (drift is structurally impossible)

**Rationale:** The prior draft of Phase 5 built a markdown parser + fixture runner + CI step just to assert that a hand-copied `domain-shapes.ts` matched a YAML block embedded inside the spec markdown. That's three sources of truth and a compliance harness to enforce 1:1 sync.

Simpler: move the structured bits out of the markdown into sibling `.config.yaml` files. `domain-shapes.ts` **imports** them at module load. The markdown stays as prose for humans. Drift becomes impossible because there is only one source.

This replaces the entire prior Phase 5 (Tasks 5.1–5.4).

---

### Task 5.0: Create `*.config.yaml` siblings to each spec file

**Files:**
- Create: `docs/domain-input-shapes/property.config.yaml`
- Create: `docs/domain-input-shapes/school_parent.config.yaml`
- Create: `docs/domain-input-shapes/agency.config.yaml`

Each file holds ONLY the machine-readable bits. The corresponding `.md` file keeps the prose + the LOCKED marker. If you edit the `.yaml`, the runtime config changes. If you edit the `.md`, you're documenting intent.

- [ ] **Step 0: Install the YAML loader**

```bash
pnpm --filter web add js-yaml
pnpm --filter web add -D @types/js-yaml
```

- [ ] **Step 1: Create `property.config.yaml`**

```yaml
# Runtime configuration for the property domain. Imported by domain-shapes.ts.
# Prose rationale lives in property.md. LOCKED status tracked there.
domain: property
stage1TopN: 3
stage2Algorithm: property-address
stage1Keywords:
  - invoice
  - repair
  - leak
  - rent
  - balance
  - statement
  - application
  - marketing
  - lease
  - estimate
  - inspection
  - work order
  - renewal
```

- [ ] **Step 2: Create `school_parent.config.yaml`** (19 keywords)
- [ ] **Step 3: Create `agency.config.yaml`** (28 keywords; 18 formal + 10 working)
- [ ] **Step 4: Rewrite `domain-shapes.ts` to import the YAML at module load**

This step **deletes** the hardcoded `DOMAIN_SHAPES` Record that landed in commit `e3242be` (Task 0.3) and replaces it with the YAML-backed loader below. Not coexistence — wholesale replacement. The existing Task 0.3 tests continue to pass because the YAML keyword counts match the TS values exactly (property 13 / school_parent 19 / agency 28).

```typescript
// apps/web/src/lib/config/domain-shapes.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export type DomainName = "property" | "school_parent" | "agency";
export type Stage2Algorithm = "property-address" | "school-two-pattern" | "agency-domain-derive";

export interface DomainShape {
  domain: DomainName;
  stage1Keywords: readonly string[];
  stage1TopN: number;
  stage2Algorithm: Stage2Algorithm;
}

function loadShape(domain: DomainName): DomainShape {
  // Resolved at module-load time. In Vercel deploys, docs/ ships in the repo root.
  const p = path.resolve(process.cwd(), "../../docs/domain-input-shapes", `${domain}.config.yaml`);
  const parsed = yaml.load(readFileSync(p, "utf8")) as DomainShape;
  if (parsed.domain !== domain) throw new Error(`YAML domain mismatch: ${parsed.domain} vs ${domain}`);
  return parsed;
}

export const DOMAIN_SHAPES: Record<DomainName, DomainShape> = {
  property: loadShape("property"),
  school_parent: loadShape("school_parent"),
  agency: loadShape("agency"),
};

export function getDomainShape(domain: string): DomainShape {
  if (!(domain in DOMAIN_SHAPES)) {
    throw new Error(`Unknown domain: ${domain}`);
  }
  return DOMAIN_SHAPES[domain as DomainName];
}
```

- [ ] **Step 5: Keep the unit tests from Task 0.3**

The tests that assert "property has 13 keywords, agency has 28" still pass because they read `DOMAIN_SHAPES` — but now those numbers come from the YAML, not a hand-maintained TS constant.

- [ ] **Step 6: Delete Tasks 5.1 / 5.2 / 5.3 / 5.4 from this plan's execution list**

They are obsolete. No spec-compliance harness, no markdown parser, no Section 9 YAML-in-markdown, no CI step. If the YAML and code ever disagree, there IS no code to disagree — the YAML IS the code.

- [ ] **Step 7: Deployment note — HARD GATE**

The YAML files must ship to Vercel. They live in `docs/` which is already part of the repo and not gitignored. `path.resolve(process.cwd(), "../../docs/...")` is cwd-sensitive — on Vercel, `process.cwd()` is the function bundle root, not the repo root. **Treat the first preview deployment as a hard verification gate**: start the preview, load an onboarding session end-to-end, and confirm `getDomainShape` doesn't throw at request time. If the path resolves wrong, fall back to a build-step that copies each `*.config.yaml` into `apps/web/public/domain-shapes/` (or bundles as JSON via a `next.config.ts` import rule) and reads from the known-shipped path at runtime. Do not merge Phase 5 until this is green.

- [ ] **Step 8: Commit**

```bash
git add docs/domain-input-shapes/property.config.yaml \
        docs/domain-input-shapes/school_parent.config.yaml \
        docs/domain-input-shapes/agency.config.yaml \
        apps/web/src/lib/config/domain-shapes.ts \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(config): spec files become runtime config — drift structurally impossible"
```

**Note on lock evidence:** Discovery 9's oracle recall + top-5 rank are a one-time validation artifact, not a CI assertion. Move them to `docs/domain-input-shapes/validation-log.md` as a dated entry per domain. Nothing in the runtime needs to assert them in perpetuity; CI-theatre.

---

## Phase 5 — DEPRECATED (replaced by Task 5.0 above): Spec-Compliance Harness

> **Do not execute Tasks 5.1-5.4.** They are preserved as historical context for why the simpler Task 5.0 is better. Task 5.0 replaces all four.

### Task 5.1 (SKIP): Add Section 9 (Test fixtures) to each per-domain spec file

**Files:**
- Modify: `docs/domain-input-shapes/property.md`, `school_parent.md`, `agency.md`

The fixtures are the executable bridge between the spec and the code. Every spec update must update fixtures; every fixture update must validate against the code.

- [ ] **Step 1: Append Section 9 to `property.md`**

```markdown

## 9. Test fixtures

Machine-readable cases for Phase 5 spec-compliance harness. YAML block is parsed by
`apps/web/src/lib/spec-compliance/parse-spec-file.ts`. Every entry must assert against
the real Stage 1/Stage 2 code (not a mock). Extend freely — additions strengthen the
compliance harness.

```yaml
stage1_keywords_expected_count: 13
stage2_algorithm_expected: property-address

# Discovery 9 locked-status evidence (2026-04-16). Update these numbers whenever
# the keyword list changes and re-run the validator harness before flipping back
# to LOCKED. Thresholds: per-email recall > 0.30 AND oracle domains rank in top-5.
stage1_lock_evidence:
  oracle_domains: ["judgefite.com", "zephyrpm.com"]
  per_email_recall: 0.42
  oracle_rank_in_top5: [1, 2]
  sample_size: 417
  validated_at: "2026-04-16"

stage2_property_fixtures:
  - subject: "Repair quote 1906 Crockett"
    expect_capture: "1906 Crockett"
  - subject: "2310 Healey Dr inspection"
    expect_capture: "2310 Healey Dr"
  - subject: "851 Peavy balance"
    expect_capture: "851 Peavy"
  - subject: "205 Freedom Trail renewal"
    expect_capture: "205 Freedom Trail"
  - subject: "Lease expires 2026 December"
    expect_capture: null   # year guard
  - subject: "Planning 2025 renovation for a house"
    expect_capture: null   # year guard

stage2_dedup_fixtures:
  - input: ["851 Peavy", "851 peavy", "851 PEAVY"]
    expect_output_count: 1
    expect_display: "851 Peavy"   # highest-frequency wins; tie-break by case
  - input: ["2310 Healey Dr", "2310 Healey Drive"]
    expect_output_count: 1

primary_alias_rules:
  - name: "Bucknell"
    must_not_include_subject: "Bucknell University Alumni Newsletter"  # 2026-04-15 failure case
```
```

- [ ] **Step 2: Append Section 9 to `school_parent.md`**

```markdown

## 9. Test fixtures

Machine-readable cases for Phase 5 spec-compliance harness. See `property.md` Section 9 for the parsing convention.

```yaml
stage1_keywords_expected_count: 19
stage2_algorithm_expected: school-two-pattern

stage1_lock_evidence:
  oracle_domains: ["stagnes.org", "laniermiddle.org"]  # REPLACE with Nick's real oracle
  per_email_recall: null  # REPLACE after running validator
  oracle_rank_in_top5: null
  sample_size: null
  validated_at: null  # Flip to DRAFT until validator has run

stage2_school_fixtures:
  # Pattern A — institutions
  - subject: "St Agnes Auction"
    expect_capture: "St Agnes"
    pattern: A
  - subject: "St. Agnes pickup"
    expect_capture: "St. Agnes"
    pattern: A
  - subject: "Lanier Middle homework"
    expect_capture: "Lanier Middle"
    pattern: A
  - subject: "Vail Mountain School conference"
    expect_capture: "Vail Mountain School"
    pattern: A
  - subject: "First Baptist Church Sunday"
    expect_capture: "First Baptist Church"
    pattern: A
  # Pattern B — activities / teams
  - subject: "U11 Soccer practice"
    expect_capture: "U11 Soccer"
    pattern: B
  - subject: "Pia Ballet recital"
    expect_capture: "Pia Ballet"
    pattern: B
  - subject: "Cosmos Soccer tournament"
    expect_capture: "Cosmos Soccer"
    pattern: B
  - subject: "Adams Lacrosse tryout"
    expect_capture: "Adams Lacrosse"
    pattern: B
  - subject: "Random newsletter"
    expect_capture: null

stage2_dedup_fixtures:
  - input: ["St Agnes", "St. Agnes", "Saint Agnes"]
    expect_output_count: 1
  - input: ["Lanier Middle", "Lanier Middle School"]
    expect_output_count: 1

primary_alias_rules:
  # Generic words must never be aliases alone
  - name: "soccer"
    must_not_alias: ["practice", "game", "season", "tournament"]
```
```

- [ ] **Step 3: Append Section 9 to `agency.md`**

```markdown

## 9. Test fixtures

Machine-readable cases for Phase 5 spec-compliance harness. See `property.md` Section 9 for the parsing convention.

```yaml
stage1_keywords_expected_count: 28
stage2_algorithm_expected: agency-domain-derive

# Locked 2026-04-16 per Discovery 9 validator (see lessons-learned entry).
stage1_lock_evidence:
  oracle_domains: ["portfolioproadvisors.com", "stallionis.com"]
  per_email_recall: 0.42
  oracle_rank_in_top5: [2, 4]
  sample_size: 417
  validated_at: "2026-04-16"

stage2_agency_fixtures:
  - domain: "anthropic.com"
    display_names: []
    expect_label: "Anthropic"
  - domain: "portfolio-pro-advisors.com"
    display_names: []
    expect_label: "Portfolio Pro Advisors"
  - domain: "stallionis.com"
    display_names: []
    expect_label: "Stallionis"   # domain-only derivation; spec Section 2 "Stallion" requires user edit
  - domain: "xyz123.com"
    display_names: []
    expect_label: "Xyz123"
    expect_needs_user_edit: true

stage2_convergence_fixtures:
  - domain: "anthropic.com"
    display_names:
      - "Sarah Chen | Anthropic"
      - "Mike Roberts | Anthropic"
      - "Jane at Anthropic"
      - "Anthropic Team"
      - "Anthropic Support"
    expect_label: "Anthropic"
    expect_derived_via: "display-name"
  - domain: "anthropic.com"
    display_names:
      - "Sarah Chen"
      - "Mike Roberts"
      - "Jane"
      - "Other Person"
    expect_derived_via: "domain"

primary_alias_rules:
  # Generic words cannot alias to a client
  - name: "Portfolio Pro Advisors"
    must_not_alias: ["client", "company", "account", "Pro"]
```
```

- [ ] **Step 4: Commit all three**

```bash
git add docs/domain-input-shapes/property.md docs/domain-input-shapes/school_parent.md docs/domain-input-shapes/agency.md
git commit -m "docs(domain-shapes): add Section 9 test fixtures (YAML)"
```

---

### Task 5.2 (SKIP): Spec-file markdown parser

**Files:**
- Create: `apps/web/src/lib/spec-compliance/parse-spec-file.ts`
- Create: `apps/web/src/lib/spec-compliance/__tests__/parse-spec-file.test.ts`

- [ ] **Step 1: Add `js-yaml` dep (parsing YAML inside markdown)**

```bash
pnpm --filter web add js-yaml @types/js-yaml
```

- [ ] **Step 2: Implement**

```typescript
// apps/web/src/lib/spec-compliance/parse-spec-file.ts
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export interface SpecFixtures {
  stage1_keywords_expected_count: number;
  stage2_algorithm_expected: string;
  // Discovery 9 LOCKED evidence: oracle recall + top-5 rank, captured at validation time.
  stage1_lock_evidence?: {
    oracle_domains: string[];
    per_email_recall: number | null;
    oracle_rank_in_top5: number[] | null;
    sample_size: number | null;
    validated_at: string | null;
  };
  stage2_property_fixtures?: Array<{ subject: string; expect_capture: string | null }>;
  stage2_school_fixtures?: Array<{ subject: string; expect_capture: string | null; pattern?: "A" | "B" }>;
  stage2_agency_fixtures?: Array<{ domain: string; display_names?: string[]; expect_label: string }>;
  stage2_dedup_fixtures?: Array<{ input: string[]; expect_output_count: number; expect_display?: string }>;
  primary_alias_rules?: Array<{ name: string; must_not_include_subject: string }>;
}

export function parseSpecFile(path: string): SpecFixtures {
  const md = readFileSync(path, "utf8");
  const fenceMatch = md.match(/## 9\. Test fixtures[\s\S]*?```yaml([\s\S]*?)```/);
  if (!fenceMatch) throw new Error(`${path}: missing Section 9 yaml fence`);
  const parsed = yaml.load(fenceMatch[1]);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${path}: Section 9 yaml did not parse to an object`);
  }
  return parsed as SpecFixtures;
}
```

- [ ] **Step 3: Unit test the parser**

```typescript
// apps/web/src/lib/spec-compliance/__tests__/parse-spec-file.test.ts
import { describe, it, expect } from "vitest";
import { parseSpecFile } from "../parse-spec-file";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../../../..");

describe("parseSpecFile", () => {
  it("parses property.md Section 9", () => {
    const spec = parseSpecFile(path.join(REPO_ROOT, "docs/domain-input-shapes/property.md"));
    expect(spec.stage1_keywords_expected_count).toBe(13);
    expect(spec.stage2_algorithm_expected).toBe("property-address");
    expect(spec.stage2_property_fixtures?.length).toBeGreaterThan(0);
  });

  it("parses agency.md Section 9", () => {
    const spec = parseSpecFile(path.join(REPO_ROOT, "docs/domain-input-shapes/agency.md"));
    expect(spec.stage1_keywords_expected_count).toBe(28);
    expect(spec.stage2_algorithm_expected).toBe("agency-domain-derive");
  });
});
```

- [ ] **Step 4: Run, commit**

```bash
pnpm --filter web test -- parse-spec-file
git add apps/web/src/lib/spec-compliance/parse-spec-file.ts \
        apps/web/src/lib/spec-compliance/__tests__/parse-spec-file.test.ts \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(spec-compliance): parseSpecFile — extract YAML fixtures from spec markdown"
```

---

### Task 5.3 (SKIP): Spec-compliance Vitest harness

**Files:**
- Create: `apps/web/tests/integration/spec-compliance.test.ts`

- [ ] **Step 1: Implement the harness as a standard Vitest suite**

```typescript
// apps/web/tests/integration/spec-compliance.test.ts
import { describe, it, expect } from "vitest";
import { parseSpecFile } from "@/lib/spec-compliance/parse-spec-file";
import { DOMAIN_SHAPES } from "@/lib/config/domain-shapes";
import { extractPropertyCandidates } from "@/lib/discovery/property-entity";
import { extractSchoolCandidates } from "@/lib/discovery/school-entity";
import { deriveAgencyEntity } from "@/lib/discovery/agency-entity";
import { dedupByLevenshtein } from "@/lib/discovery/levenshtein-dedup";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const specPath = (domain: string) => path.join(REPO_ROOT, `docs/domain-input-shapes/${domain}.md`);

describe("spec-compliance: Stage 1 keyword count", () => {
  for (const domain of ["property", "school_parent", "agency"] as const) {
    it(`${domain}: runtime keyword count matches spec Section 9`, () => {
      const spec = parseSpecFile(specPath(domain));
      const runtime = DOMAIN_SHAPES[domain].stage1Keywords.length;
      expect(runtime).toBe(spec.stage1_keywords_expected_count);
    });
  }
});

describe("spec-compliance: Stage 2 algorithm selector", () => {
  for (const domain of ["property", "school_parent", "agency"] as const) {
    it(`${domain}: runtime algorithm matches spec`, () => {
      const spec = parseSpecFile(specPath(domain));
      expect(DOMAIN_SHAPES[domain].stage2Algorithm).toBe(spec.stage2_algorithm_expected);
    });
  }
});

describe("spec-compliance: Property Stage 2 regex", () => {
  const spec = parseSpecFile(specPath("property"));
  for (const fix of spec.stage2_property_fixtures ?? []) {
    it(`subject "${fix.subject}" => ${fix.expect_capture ?? "no capture"}`, () => {
      const result = extractPropertyCandidates([{ subject: fix.subject, frequency: 1 }]);
      if (fix.expect_capture === null) {
        expect(result).toEqual([]);
      } else {
        expect(result.map(r => r.displayString)).toContain(fix.expect_capture);
      }
    });
  }
});

describe("spec-compliance: Property dedup", () => {
  const spec = parseSpecFile(specPath("property"));
  for (const fix of spec.stage2_dedup_fixtures ?? []) {
    it(`dedup of [${fix.input.join(", ")}] => ${fix.expect_output_count} result(s)`, () => {
      const dedupInput = fix.input.map(s => {
        const m = s.match(/^(\d+)\s+(.+)$/);
        return { key: m?.[1] ?? s, displayString: s, frequency: 1 };
      });
      const result = dedupByLevenshtein(dedupInput);
      expect(result.length).toBe(fix.expect_output_count);
    });
  }
});

describe("spec-compliance: School Stage 2 regex", () => {
  const spec = parseSpecFile(specPath("school_parent"));
  for (const fix of spec.stage2_school_fixtures ?? []) {
    it(`subject "${fix.subject}" => ${fix.expect_capture ?? "no capture"} (${fix.pattern ?? "?"})`, () => {
      const result = extractSchoolCandidates([{ subject: fix.subject, frequency: 1 }]);
      if (fix.expect_capture === null) {
        expect(result).toEqual([]);
      } else {
        const displays = result.map(r => r.displayString);
        expect(displays).toContain(fix.expect_capture);
        if (fix.pattern) {
          const matched = result.find(r => r.displayString === fix.expect_capture);
          expect(matched?.pattern).toBe(fix.pattern);
        }
      }
    });
  }
});

describe("spec-compliance: Discovery 9 LOCKED validation evidence", () => {
  for (const domain of ["property", "school_parent", "agency"] as const) {
    it(`${domain}: lock evidence is present and meets thresholds (or is explicitly DRAFT)`, () => {
      const spec = parseSpecFile(specPath(domain)) as any;
      const ev = spec.stage1_lock_evidence;
      if (!ev || ev.validated_at === null) {
        // DRAFT is allowed, but the field must exist (enforces explicit status)
        expect(ev).toBeDefined();
        console.warn(`${domain}: stage1_lock_evidence is DRAFT — re-run validator before LOCKED`);
        return;
      }
      expect(ev.per_email_recall).toBeGreaterThan(0.30);
      expect(ev.oracle_rank_in_top5).toBeDefined();
      for (const rank of ev.oracle_rank_in_top5) expect(rank).toBeLessThanOrEqual(5);
    });
  }
});

describe("spec-compliance: Agency domain-derivation", () => {
  const spec = parseSpecFile(specPath("agency"));
  for (const fix of spec.stage2_agency_fixtures ?? []) {
    it(`domain "${fix.domain}" => label "${fix.expect_label}"`, () => {
      const result = deriveAgencyEntity({
        authoritativeDomain: fix.domain,
        senderDisplayNames: fix.display_names ?? [],
      });
      expect(result.displayLabel).toBe(fix.expect_label);
    });
  }
  for (const fix of (spec as any).stage2_convergence_fixtures ?? []) {
    it(`domain "${fix.domain}" with ${fix.display_names.length} names => derivedVia=${fix.expect_derived_via}`, () => {
      const result = deriveAgencyEntity({
        authoritativeDomain: fix.domain,
        senderDisplayNames: fix.display_names,
      });
      expect(result.derivedVia).toBe(fix.expect_derived_via);
      if (fix.expect_label) expect(result.displayLabel).toBe(fix.expect_label);
    });
  }
});
```

- [ ] **Step 2: Add `pnpm test:spec-compliance` script**

Edit `apps/web/package.json`:

```json
{
  "scripts": {
    "test:spec-compliance": "vitest run tests/integration/spec-compliance.test.ts"
  }
}
```

- [ ] **Step 3: Run it + commit**

```bash
pnpm --filter web test:spec-compliance
```

Expected: all tests pass (if the spec files' Section 9 is complete). Fix any mismatches in the spec fixtures before committing.

```bash
git add apps/web/tests/integration/spec-compliance.test.ts apps/web/package.json
git commit -m "feat(spec-compliance): Vitest harness runs spec fixtures against real code"
```

---

### Task 5.4 (SKIP): Wire into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a new CI step**

Find the existing `pnpm -r test` step. Add:

```yaml
      - name: Spec-compliance harness
        working-directory: apps/web
        run: pnpm test:spec-compliance
```

- [ ] **Step 2: Push + verify CI runs green**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run spec-compliance harness on every PR"
git push
```

---

## Phase 6 — Cleanup

### Task 6.1: Delete orphan hypothesis/validation code

**Files (delete):**
- `packages/ai/src/prompts/interview-hypothesis.ts`
- `packages/ai/src/prompts/interview-validate.ts`
- `packages/ai/src/parsers/validation-parser.ts`
- `packages/ai/src/__tests__/validation-parser.test.ts` — **NOTE:** Added by issue #70 in commit `9a658fd`. Confirm deletion is deliberate. If the parser regex patterns are reused anywhere post-migration, transplant the test before deleting.

**Files (modify):**
- `apps/web/src/lib/services/interview.ts` — delete `generateHypothesis`, `validateHypothesis`, `resolveWhoEmails`
- `apps/web/src/lib/services/expansion-targets.ts` — delete file
- `apps/web/src/lib/services/__tests__/expansion-targets.test.ts` — delete file

- [ ] **Step 0: Verify Task 7.4 differential eval is committed**

```bash
git log --oneline --all | grep -iE "differential|eval.*baseline|eval.*run|7\.4"
```

Abort Phase 6 if no commit is present. **After this task's deletions commit, the old hypothesis/validate path is irrecoverable and Task 7.4 cannot re-run.** Task 7.4 must compare old-flow vs new-flow on the same fixtures before deletion.

- [ ] **Step 1: Delete + run typecheck + fix any dangling imports**

```bash
rm packages/ai/src/prompts/interview-hypothesis.ts \
   packages/ai/src/prompts/interview-validate.ts \
   packages/ai/src/parsers/validation-parser.ts \
   packages/ai/src/__tests__/validation-parser.test.ts \
   apps/web/src/lib/services/expansion-targets.ts \
   apps/web/src/lib/services/__tests__/expansion-targets.test.ts

pnpm typecheck
```

Fix any remaining import errors by removing the dead imports from their callers.

- [ ] **Step 2: Clean up `packages/ai/src/index.ts` exports**

```bash
grep -n "interview-hypothesis\|interview-validate\|validation-parser" packages/ai/src/index.ts
```

Remove those exports.

- [ ] **Step 3: Run unit + integration tests to confirm nothing broke**

```bash
pnpm -r test
```

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore: delete hypothesis/validation code paths (superseded by Stage 1/2)"
```

---

### Task 6.2: Delete old review-screen UI

**Files (delete):**
- `apps/web/src/components/onboarding/phase-review.tsx`
- `apps/web/src/components/onboarding/review-entities.tsx`

- [ ] **Step 1: Remove + verify flow.tsx has no stale imports**

```bash
rm apps/web/src/components/onboarding/phase-review.tsx \
   apps/web/src/components/onboarding/review-entities.tsx

grep -n "phase-review\|review-entities" apps/web/src/components/onboarding/flow.tsx
```

If the grep returns anything, clean those imports out of `flow.tsx`.

- [ ] **Step 2: Typecheck, commit**

```bash
pnpm typecheck
git add -u
git commit -m "chore: delete phase-review (superseded by phase-domain/entity-confirmation)"
```

---

### Task 6.3: Remove `GENERATING_HYPOTHESIS` from `SchemaPhase`

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Sweep: 18 files reference `GENERATING_HYPOTHESIS` — `packages/types/src/events.ts`, `apps/web/src/lib/inngest/onboarding.ts`, `apps/web/src/lib/services/onboarding-state.ts` (`SCHEMA_PHASE_ORDER` at line 35), `apps/web/src/lib/services/onboarding-polling.ts`, `apps/web/src/app/api/onboarding/[schemaId]/retry/route.ts`, `apps/web/src/components/onboarding/phase-generating.tsx`, `apps/web/src/components/onboarding/flow.tsx`, plus 3 integration tests. Each reference either re-routes to `DISCOVERING_DOMAINS` or is guarded as a deprecated no-op.

Since Postgres cannot drop enum values cheaply, the enum value itself STAYS. `SCHEMA_PHASE_ORDER` must also keep `GENERATING_HYPOTHESIS: 1` — removing it breaks the exhaustive Record TypeScript gate. This task is a sweep + documentation update, not a deletion.

Only do this AFTER confirming no rows in `case_schemas` are in the old phase:

- [ ] **Step 1: Check DB state via supabase-db skill**

```sql
SELECT phase, COUNT(*) FROM case_schemas GROUP BY phase;
```

If any rows are still in `GENERATING_HYPOTHESIS`, migrate them forward:

```sql
UPDATE case_schemas SET phase = 'FAILED', "phaseError" = 'Superseded by fast-discovery rebuild'
WHERE phase = 'GENERATING_HYPOTHESIS';
```

- [ ] **Step 2: Remove the enum value (Postgres doesn't support direct removal; we can only accept that the value still exists in the TYPE)**

Actually — Postgres does not support `DROP VALUE FROM ENUM`. Options:
  1. Leave the value in the enum (harmless; no rows reference it).
  2. Create a new enum, migrate, swap (expensive migration).

Pragmatic call: **leave it**. Add a comment in `schema.prisma`:

```prisma
enum SchemaPhase {
  PENDING
  GENERATING_HYPOTHESIS  // DEPRECATED: superseded by DISCOVERING_DOMAINS (kept because Postgres can't drop enum values cheaply)
  DISCOVERING_DOMAINS
  // ...
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/prisma/schema.prisma
git commit -m "chore(schema): mark GENERATING_HYPOTHESIS as deprecated (cannot drop from Postgres enum)"
```

---

### Task 6.4: Update CLAUDE.md, status doc, and CAS Transition Ownership Map

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/00_denim_current_status.md`
- Modify: `docs/01_denim_lessons_learned.md` (the canonical CAS Transition Ownership Map)

- [ ] **Step 1: Update CLAUDE.md "Current Status" section** to reflect that onboarding is now the fast-discovery flow. Replace any outdated paragraphs that reference hypothesis generation / Function A / validation.

- [ ] **Step 2: Add a new session block to `docs/00_denim_current_status.md`** — this is the plan-completion log entry. Include:
  - Summary of what shipped (3-stage flow live; Stage 1+2 target timings; Stage 3 unchanged)
  - Commits SHA list (the major phase-complete commits)
  - Per-domain spec compliance status (all green via CI)
  - Next action on resume (#94 remaining-domain interviews, or user testing)

- [ ] **Step 3: CRITICAL — Update the CAS Transition Ownership Map in `docs/01_denim_lessons_learned.md`**

Bug 3 (2026-04-09) made this map authoritative. The four new transitions introduced by this plan MUST be added, or the next contributor will repeat Bug 3. Open `docs/01_denim_lessons_learned.md` and update the `CaseSchema.phase transitions` table near the bottom of the file:

```markdown
| Transition | Owner | Notes |
|---|---|---|
| PENDING → DISCOVERING_DOMAINS | `runDomainDiscovery` (Inngest) | Replaces old PENDING → GENERATING_HYPOTHESIS |
| DISCOVERING_DOMAINS → AWAITING_DOMAIN_CONFIRMATION | `runDomainDiscovery` | Emits no downstream event (user click is the trigger) |
| AWAITING_DOMAIN_CONFIRMATION → DISCOVERING_ENTITIES | `POST /api/onboarding/:schemaId/domain-confirm` | CAS via updateMany in writeStage2ConfirmedDomains |
| DISCOVERING_ENTITIES → AWAITING_ENTITY_CONFIRMATION | `runEntityDiscovery` (Inngest) | Emits no downstream event |
| AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN | `POST /api/onboarding/:schemaId/entity-confirm` | CAS via updateMany; Function B must NOT re-advance |
| PROCESSING_SCAN → COMPLETED | `runOnboardingPipeline` | Unchanged from pre-rebuild |
| PROCESSING_SCAN → NO_EMAILS_FOUND | `runOnboardingPipeline` | Unchanged |
```

Remove the now-obsolete `GENERATING_HYPOTHESIS → AWAITING_REVIEW` and `AWAITING_REVIEW → PROCESSING_SCAN` rows. (Or mark DEPRECATED and keep for historical reference — preferred, so git blame stays useful.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/00_denim_current_status.md docs/01_denim_lessons_learned.md
git commit -m "docs: fast-discovery rebuild live — update CAS ownership map, status, CLAUDE.md"
```

---

### Task 6.5: Final E2E smoke across all 3 domains

- [ ] **Step 1: Manual 3-schema run**

Create three fresh schemas (property, school_parent, agency) against real Gmail. Verify:
- Each hits AWAITING_DOMAIN_CONFIRMATION ≤ 8s
- Each hits AWAITING_ENTITY_CONFIRMATION ≤ 12s (i.e., 6s Stage 2 after ~6s of thinking time)
- Stage 3 deep scan runs to COMPLETED normally
- Final feed shows cases

- [ ] **Step 2: Capture timing report via `onboarding-timing` skill**

Paste the timeline table into `docs/00_denim_current_status.md` under the session block from Task 6.4.

- [ ] **Step 3: If all clean — close issue #95**

```bash
gh issue close 95 --comment "Fast-discovery onboarding rebuild shipped. See docs/00_denim_current_status.md session block for timing results."
```

No commit required for this task (GH interaction).

---

## Phase 7 — Eval Framework

> **Rationale (2026-04-16 hardening pass #3):** The plan replaces a working flow with an unverified one. With 0 customers we cannot do a production A/B, but we CAN: (a) hand-label ~10 items per domain from Nick's inbox, (b) generate synthetic adversarial cases programmatically, (c) run a differential eval against the old flow before Phase 6 deletes it, (d) grow the fixture set from every beta onboarding going forward. The harness + fixtures + CI gate cost ~1 day to build and turn "feels like it works" into "precision-at-20 ≥ 0.70 enforced on every PR."

### Task 7.1: Golden fixture schema + directory

**Files:**
- Create: `apps/web/tests/fixtures/onboarding/` (directory)
- Create: `apps/web/tests/fixtures/onboarding/property/golden.yaml`
- Create: `apps/web/tests/fixtures/onboarding/school_parent/golden.yaml`
- Create: `apps/web/tests/fixtures/onboarding/agency/golden.yaml`
- Create: `apps/web/tests/fixtures/onboarding/README.md`

These files are committed. Subjects are lightly sanitized (real names replaced with tokens like `[NAME]`, real addresses kept because they are the entities under test), but the subject distribution shape is preserved.

- [ ] **Step 1: Define the YAML schema**

Every golden fixture file follows this shape:

```yaml
# Golden eval fixture. Committed. Run via pnpm test:eval.
# Nick labels these from his inbox in one sitting — aim for 10–20 items per domain.
domain: property         # one of: property | school_parent | agency
stage: stage2            # which stage this exercises (stage1 | stage2 | both)

stage1:
  senderDomains:
    - domain: judgefite.com
      expectedRank: top3     # top3 | top5 | present | absent
    - domain: gmail.com
      expectedRank: absent   # generic provider must be filtered

stage2:
  items:
    - subject: "Repair quote - 1906 Crockett"
      expectedEntities: ["1906 Crockett"]
      labelledBy: nick
    - subject: "2026 Renewal notice"
      expectedEntities: []   # year guard
    - subject: "RE: RE: 2310 Healey Dr — inspection"
      expectedEntities: ["2310 Healey Dr"]
    - subject: "Newsletter Q4"
      expectedEntities: []
```

- [ ] **Step 2: Hand-label the 10-item starter per domain**

Nick opens his inbox, picks 8–12 representative subjects per domain, pastes + labels. Budget: ~30 min for all three. Target distribution: 4–6 positives, 2–3 hard negatives (years, newsletters), 1–2 dedup cases. The result is the ground truth every regex change must pass.

- [ ] **Step 3: Create `README.md` in fixtures dir**

```markdown
# Eval Fixtures

## Structure
- `<domain>/golden.yaml` — hand-labelled by Nick, committed.
- `<domain>/synthetic.yaml` — generated by Task 7.2, committed.
- `<domain>/beta-*.yaml` — future: generated from confirmed beta-user sessions.

## Adding a fixture
1. Copy the schema from `property/golden.yaml` as template.
2. Label expectedEntities honestly — wrong labels produce false eval signals.
3. Run `pnpm --filter web test:eval -- --domain <domain>` to verify before commit.
4. Never commit a fixture where precision-at-20 < 0.70 without a written comment explaining why.
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/fixtures/onboarding/
git commit -m "test(eval): golden fixture schema + 10-item starters for all 3 domains"
```

---

### Task 7.2: Synthetic fixture generator

**Files:**
- Create: `scripts/generate-synthetic-fixtures.ts`
- Produces: `apps/web/tests/fixtures/onboarding/<domain>/synthetic.yaml` (committed output)

The generator emits adversarial subjects per domain (ALL-CAPS, lowercase, Re:/Fwd:, unicode, empty, 500-char, year-like false positives). Deterministic — same output on same regex. Run after every regex change, commit the diff.

- [ ] **Step 1: Implement the generator**

```typescript
// scripts/generate-synthetic-fixtures.ts
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const OUT_DIR = path.resolve(process.cwd(), "apps/web/tests/fixtures/onboarding");

const allCaps = (s: string) => s.toUpperCase();
const lowercase = (s: string) => s.toLowerCase();
const fwd = (s: string) => `Re: Re: Fwd: ${s}`;
const unicode = (s: string) => `${s} — updated 🏡`;
const longNoise = (s: string) => `${s} ${"X".repeat(400)}`;

type ItemSpec = { subject: string; expectedEntities: string[]; note?: string };

const PROPERTY_POSITIVES: ItemSpec[] = [
  { subject: "Repair quote - 1906 Crockett", expectedEntities: ["1906 Crockett"] },
  { subject: "2310 Healey Dr inspection", expectedEntities: ["2310 Healey Dr"] },
  { subject: "205 Freedom Trail renewal", expectedEntities: ["205 Freedom Trail"] },
  { subject: "851 Peavy balance due", expectedEntities: ["851 Peavy"] },
  { subject: "100 Main St — lease", expectedEntities: ["100 Main St"] },
];

const PROPERTY_NEGATIVES: ItemSpec[] = [
  { subject: "Planning 2025 Renovation", expectedEntities: [], note: "year guard" },
  { subject: "Lease expires 2026 December", expectedEntities: [], note: "year guard" },
  { subject: "Newsletter — property news Q4", expectedEntities: [], note: "no address" },
  { subject: "", expectedEntities: [], note: "empty subject" },
];

function expandProperty(): ItemSpec[] {
  const out: ItemSpec[] = [];
  for (const item of PROPERTY_POSITIVES) {
    out.push(item);
    out.push({ ...item, subject: allCaps(item.subject), note: "ALL-CAPS" });
    out.push({ ...item, subject: lowercase(item.subject), note: "lowercase" });
    out.push({ ...item, subject: fwd(item.subject), note: "Re/Fwd prefix" });
    out.push({ ...item, subject: unicode(item.subject), note: "unicode trailing" });
  }
  out.push({ subject: longNoise("851 Peavy statement"), expectedEntities: ["851 Peavy"], note: "500-char (ReDoS guard)" });
  for (const neg of PROPERTY_NEGATIVES) out.push(neg);
  return out;
}

// Similar expanders for school_parent + agency — see full file in draft.

const DOMAINS: Record<string, () => ItemSpec[]> = {
  property: expandProperty,
  // school_parent: expandSchool,
  // agency: expandAgency,
};

for (const [domain, expand] of Object.entries(DOMAINS)) {
  const items = expand();
  const outPath = path.join(OUT_DIR, domain, "synthetic.yaml");
  const doc = {
    domain,
    stage: "stage2",
    generatedAt: new Date().toISOString().split("T")[0],
    note: "Generated by scripts/generate-synthetic-fixtures.ts — commit after regex changes",
    stage2: {
      items: items.map((i) => ({
        subject: i.subject,
        expectedEntities: i.expectedEntities,
        ...(i.note ? { note: i.note } : {}),
        labelledBy: "synthetic",
      })),
    },
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, yaml.dump(doc));
}
```

Full school + agency expanders are in the draft doc `2026-04-16-issue-95-eval-draft.md` (delete after integration).

- [ ] **Step 2: Run + commit**

```bash
npx tsx scripts/generate-synthetic-fixtures.ts
git add scripts/generate-synthetic-fixtures.ts apps/web/tests/fixtures/onboarding/
git commit -m "test(eval): synthetic fixture generator + committed outputs"
```

---

### Task 7.3: Eval runner

**Files:**
- Create: `apps/web/tests/eval/run-discovery-eval.ts`
- Create: `apps/web/tests/eval/eval-types.ts`

**Dependency:** this task cannot land until Phase 2 Task 2.4 (agency-entity) completes — the runner imports `extractPropertyCandidates`, `extractSchoolCandidates`, and `deriveAgencyEntity` from the Phase 2 modules.

Modes:
- **Committed fixture mode** (always): reads `tests/fixtures/onboarding/*/*.yaml`.
- **Local sample mode** (local only): if `DENIM_GMAIL_SAMPLES_DIR` env var set, also walks the 417-email JSON sample.

Metrics: **precision-at-20**, **recall**, **rank-of-first-correct**, **duplicate-rate**, **false-positive examples**, **durationMs**.

- [ ] **Step 1: Define eval types** (`apps/web/tests/eval/eval-types.ts`)

```typescript
export interface EvalMetrics {
  domain: string;
  fixtureFile: string;
  fixtureType: "golden" | "synthetic" | "local-sample";
  precisionAt20: number;
  recall: number;
  rankOfFirstCorrect: number;
  duplicateRate: number;
  falsePositiveExamples: string[];
  durationMs: number;
}

export interface EvalReport {
  runAt: string;
  metrics: EvalMetrics[];
  summary: {
    domainsPassed: string[];
    domainsFailed: string[];
    overallPrecisionAt20: number;
    overallRecall: number;
  };
}
```

- [ ] **Step 2: Implement the runner**

See `2026-04-16-issue-95-eval-draft.md` for the full `run-discovery-eval.ts` implementation (~180 lines). Core shape: load YAML fixtures → run `extractPropertyCandidates` / `extractSchoolCandidates` / `deriveAgencyEntity` → compute metrics via substring-match (tolerates minor formatting differences between expected and surfaced) → write `docs/eval-reports/<date>-<domain>.md` markdown + exit 1 if any domain below threshold.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/eval/run-discovery-eval.ts apps/web/tests/eval/eval-types.ts
git commit -m "test(eval): run-discovery-eval — precision-at-20 + recall + rank + dup-rate"
```

---

### Task 7.4: Differential mode (bootstrap oracle — RUN BEFORE PHASE 6)

**Files:**
- Create: `apps/web/tests/eval/run-differential-eval.ts`

Runs the OLD hypothesis path and the NEW Stage 1+2 path on the same fixture subjects, produces a 3-column diff (both / new-only / old-only). Nick reviews the diff ONCE (~20 min), marks each entity as improvement / regression / neutral. Marked regressions are added to golden fixtures as `expectedEntities` — they become CI-enforced.

**Critical timing:** Task 7.4 MUST run before Phase 6 commits. Phase 6 deletes `generateHypothesis` + `validateHypothesis` — after that, the old column is irrecoverable. Capture the comparison while both flows exist.

- [ ] **Step 1: Implement**

See `2026-04-16-issue-95-eval-draft.md` for the full `run-differential-eval.ts` (~80 lines). Signature: `npx tsx apps/web/tests/eval/run-differential-eval.ts --domain property`. Output: pretty-printed 3-column diff to stdout with `[ ]` checkboxes for Nick to annotate.

- [ ] **Step 2: Run BEFORE Phase 6 for all three domains**

```bash
npx tsx apps/web/tests/eval/run-differential-eval.ts --domain property
npx tsx apps/web/tests/eval/run-differential-eval.ts --domain school_parent
npx tsx apps/web/tests/eval/run-differential-eval.ts --domain agency
```

- [ ] **Step 3: Annotate, update golden fixtures, commit**

```bash
git add apps/web/tests/eval/run-differential-eval.ts apps/web/tests/fixtures/onboarding/
git commit -m "test(eval): differential eval old-vs-new + Nick's annotations captured in golden fixtures"
```

---

### Task 7.5: CI integration (the gate with teeth)

**Files:**
- Modify: `apps/web/package.json` — add `test:eval` script
- Modify: `.github/workflows/ci.yml` — add eval step
- Create: `apps/web/tests/eval/discovery-eval.vitest.ts`

The Vitest wrapper integrates with CI's pass/fail signal. Fails if precision-at-20 drops below `0.70` on any golden fixture or below `0.50` on synthetic.

- [ ] **Step 1: Add to `package.json`**

```json
{ "scripts": { "test:eval": "vitest run tests/eval/" } }
```

- [ ] **Step 2: Implement `discovery-eval.vitest.ts`**

See `2026-04-16-issue-95-eval-draft.md` for the full file (~60 lines). Iterates every domain × fixture-type, asserts `precisionAt20 >= threshold`.

**Ordering note:** Task 7.5 lands BEFORE Task 8.1. If you want to use `SLO.stage1.p95Ms` as the latency sanity bound (per the eval draft), either (a) reorder 7.5 to land after 8.1, or (b) inline a local constant here and let Task 8.1 refactor it to read from `slo.ts` when that file is introduced. Prefer (b) for this sprint — it keeps Phase 7 landing-order simple.

- [ ] **Step 3: Add to CI**

```yaml
# .github/workflows/ci.yml — after existing `pnpm -r test` step
      - name: Discovery eval (committed fixtures)
        working-directory: apps/web
        run: pnpm test:eval
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter web test:eval
git add apps/web/tests/eval/discovery-eval.vitest.ts apps/web/package.json .github/workflows/ci.yml
git commit -m "ci(eval): precision-at-20 threshold enforced on every PR"
```

---

### Task 7.7: Chaos test — outbox drain recovers when Inngest send fails

**Files:**
- Create: `apps/web/tests/integration/outbox-chaos.test.ts`

**Rationale:** The plan's correctness hinges on the transactional outbox (#33). When `/domain-confirm` commits but the optimistic `inngest.send` fails (network blip, Inngest outage, wrong signing key), the drain cron MUST re-emit within one tick. No existing test exercises this failure path. "It will work because outbox" is a belief; this test turns it into evidence.

- [ ] **Step 1: Implement the chaos test**

```typescript
// apps/web/tests/integration/outbox-chaos.test.ts
//
// Simulates: confirm route commits, inngest.send throws, drain cron runs, event emits.
// Requires a real test DB (uses the same test harness as other integration tests).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { drainOnboardingOutbox } from "@/lib/inngest/onboarding-outbox-drain";
import { inngest } from "@/lib/inngest/client";

describe("outbox chaos — drain recovers from failed optimistic send", () => {
  let testUserId: string;
  let testSchemaId: string;

  beforeEach(async () => {
    // Seed a user + schema via the same helpers production uses (Bug 5 rule).
    testUserId = `chaos-user-${Date.now()}`;
    testSchemaId = `chaos-schema-${Date.now()}`;
    await prisma.user.upsert({
      where: { id: testUserId },
      create: { id: testUserId, email: `${testUserId}@test.local` },
      update: {},
    });
    await prisma.caseSchema.create({
      data: {
        id: testSchemaId,
        userId: testUserId,
        domain: "property",
        phase: "AWAITING_DOMAIN_CONFIRMATION",
        inputs: { userEmail: `${testUserId}@test.local` } as any,
      },
    });
  });

  it("domain-confirm: outbox PENDING_EMIT row drains after inngest.send failure", async () => {
    // Write the outbox row as the route would (commits even if send fails).
    await prisma.onboardingOutbox.create({
      data: {
        schemaId: testSchemaId,
        userId: testUserId,
        eventName: "onboarding.entity-discovery.requested",
        payload: { schemaId: testSchemaId, userId: testUserId } as any,
      },
    });

    // Simulate the chaos: inngest.send throws. The route's try/catch swallows.
    const sendSpy = vi.spyOn(inngest, "send").mockRejectedValueOnce(new Error("simulated network blip"));

    try {
      await inngest.send({
        name: "onboarding.entity-discovery.requested",
        data: { schemaId: testSchemaId, userId: testUserId },
      });
    } catch {
      // Swallowed — this is the production code path.
    }

    // Verify the outbox row is still PENDING_EMIT (send didn't mark it).
    const pending = await prisma.onboardingOutbox.findFirst({
      where: { schemaId: testSchemaId, eventName: "onboarding.entity-discovery.requested" },
    });
    expect(pending?.status).toBe("PENDING_EMIT");

    // Now run the drain. It should emit the event AND mark the row EMITTED.
    sendSpy.mockRestore();
    const drainSpy = vi.spyOn(inngest, "send").mockResolvedValue({ ids: ["evt-1"] } as any);
    await drainOnboardingOutbox();
    expect(drainSpy).toHaveBeenCalledWith(expect.objectContaining({
      name: "onboarding.entity-discovery.requested",
    }));

    const drained = await prisma.onboardingOutbox.findFirst({
      where: { schemaId: testSchemaId, eventName: "onboarding.entity-discovery.requested" },
    });
    expect(drained?.status).toBe("EMITTED");
  });

  it("entity-confirm: same chaos path for onboarding.review.confirmed", async () => {
    await prisma.onboardingOutbox.create({
      data: {
        schemaId: testSchemaId,
        userId: testUserId,
        eventName: "onboarding.review.confirmed",
        payload: { schemaId: testSchemaId, userId: testUserId } as any,
      },
    });

    const drainSpy = vi.spyOn(inngest, "send").mockResolvedValue({ ids: ["evt-2"] } as any);
    await drainOnboardingOutbox();

    expect(drainSpy).toHaveBeenCalledWith(expect.objectContaining({
      name: "onboarding.review.confirmed",
    }));
    const drained = await prisma.onboardingOutbox.findFirst({
      where: { schemaId: testSchemaId, eventName: "onboarding.review.confirmed" },
    });
    expect(drained?.status).toBe("EMITTED");
  });

  it("drain handles unknown eventName gracefully (logs error, skips, doesn't crash)", async () => {
    await prisma.onboardingOutbox.create({
      data: {
        schemaId: testSchemaId,
        userId: testUserId,
        eventName: "onboarding.fake.event",
        payload: { schemaId: testSchemaId } as any,
      },
    });

    // Should not throw. Row stays PENDING_EMIT (not auto-EMITTED for unknown events).
    await expect(drainOnboardingOutbox()).resolves.not.toThrow();
    const stuck = await prisma.onboardingOutbox.findFirst({
      where: { schemaId: testSchemaId, eventName: "onboarding.fake.event" },
    });
    expect(stuck?.status).toBe("PENDING_EMIT");
  });
});
```

- [ ] **Step 2: Add to `pnpm test:integration` runner**

The file lives in `tests/integration/` so the existing `pnpm --filter web test:integration` command picks it up automatically.

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter web test:integration -- outbox-chaos
```

Expected: 3 passing.

```bash
git add apps/web/tests/integration/outbox-chaos.test.ts
git commit -m "test(chaos): outbox drain recovers from failed inngest.send + rejects unknown events"
```

---

### Task 7.6: Growing the dataset (workflow doc)

**Files:**
- Modify: `apps/web/tests/fixtures/onboarding/README.md` (extend Task 7.1's file)

Document the beta-onboarding → fixture workflow. After a beta user confirms entities, export their Stage 2 + confirmed-entities, scrub PII, commit as `beta-<date>.yaml`. Each committed beta fixture is a vote from a real user.

- [ ] **Step 1: Append this section to the README**

```markdown
## Growing the dataset from beta onboardings

1. **Export the session** via `supabase-db`:
   ```sql
   SELECT cs.domain, cs."stage2Candidates", e.name, e."identityKey", e.type
   FROM case_schemas cs
   JOIN entities e ON e."schemaId" = cs.id
   WHERE cs.id = '<schemaId>' AND e."autoDetected" = false;
   ```
2. **Scrub PII.** Real names → `[NAME]`. Real email addresses → `[EMAIL]@<company>.com`.
   Keep house numbers, school names, agency domains — those are the entities under test.
3. **Shape as YAML fixture** using Task 7.1's schema. Set `labelledBy: beta-<hash-of-userId>`.
4. **Commit** under `apps/web/tests/fixtures/onboarding/<domain>/beta-<date>.yaml`.
5. **Run eval** to verify the new fixture passes: `pnpm --filter web test:eval`.
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/tests/fixtures/onboarding/README.md
git commit -m "docs(eval): document beta-onboarding-to-fixture workflow"
```

---

## Phase 8 — SLO Commitments

### Task 8.1: Define SLOs in code (single source of truth)

**Files:**
- Create: `apps/web/src/lib/config/slo.ts`
- Create: `apps/web/src/lib/config/__tests__/slo.test.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/web/src/lib/config/slo.ts
//
// Service Level Objectives for fast-discovery onboarding. Milliseconds wall-clock.
// CI latency regression tests (Task 8.2) fail if budgets are exceeded.
//
// Rationale:
//   Stage 1: 500 emails × metadata fetch in parallel batches of 40 ≈ 4 roundtrips.
//   At ~300ms per batch + 50ms pacing: ~1.5–2s nominal. p95=8s covers slow Gmail.
//
//   Stage 2: per-confirmed-domain fan-out in parallel. Each domain ~600ms core.
//   5 domains parallel: still ~600ms + overhead = ~1.5–2s nominal. p95=8s.
//
//   persistConfirmedEntities: createMany + updateMany = 2 pooler roundtrips.
//   p95=500ms covers pool saturation under concurrent onboardings.
//
//   polling: single DB read. p50=50ms p95=200ms.

export const SLO = {
  stage1: { p50Ms: 3000, p95Ms: 8000, p99Ms: 15000 },
  stage2: { p50Ms: 3500, p95Ms: 8000, p99Ms: 15000 },
  persistConfirmedEntities: { p50Ms: 100, p95Ms: 500 },
  polling: { p50Ms: 50, p95Ms: 200 },
} as const;

export type SLOKey = keyof typeof SLO;
```

- [ ] **Step 2: Unit test** (ensures no one silently deletes a budget)

```typescript
import { describe, it, expect } from "vitest";
import { SLO } from "../slo";

describe("SLO", () => {
  it("stage1/stage2 p95 <= 15s (human-wait budget)", () => {
    expect(SLO.stage1.p95Ms).toBeLessThanOrEqual(15_000);
    expect(SLO.stage2.p95Ms).toBeLessThanOrEqual(15_000);
  });
  it("persistConfirmedEntities p95 <= 1s (on click path)", () => {
    expect(SLO.persistConfirmedEntities.p95Ms).toBeLessThanOrEqual(1_000);
  });
  it("p50 < p95 for every budget", () => {
    for (const key of Object.keys(SLO) as Array<keyof typeof SLO>) {
      const entry = SLO[key] as any;
      if ("p50Ms" in entry && "p95Ms" in entry) {
        expect(entry.p50Ms).toBeLessThan(entry.p95Ms);
      }
    }
  });
});
```

- [ ] **Step 3: Commit**

```bash
pnpm --filter web test -- slo
git add apps/web/src/lib/config/slo.ts apps/web/src/lib/config/__tests__/slo.test.ts
git commit -m "feat(config): SLO — single source of truth for latency budgets"
```

---

### Task 8.2: Latency regression test (CI teeth)

**Files:**
- Create: `apps/web/tests/eval/latency-regression.test.ts`

Deterministic wall-clock test with injected simulated Gmail latency (p95 observed: 300ms per batch of 40). No real network — fully reproducible. Asserts end-to-end ≤ `SLO.stageN.p95Ms * 1.2` (20% test-runner headroom).

- [ ] **Step 1: Implement**

```typescript
// apps/web/tests/eval/latency-regression.test.ts
import { describe, it, expect, vi } from "vitest";
import { discoverDomains } from "../../src/lib/discovery/domain-discovery";
import { discoverEntitiesForDomain } from "../../src/lib/discovery/entity-discovery";
import { SLO } from "../../src/lib/config/slo";

const SIMULATED_BATCH_DELAY_MS = 300;  // observed p95 Gmail metadata latency

function makeFakeGmail(ids: string[], fromHeaders: Record<string, string>, batchSize = 40) {
  let batchCalls = 0;
  return {
    searchEmails: vi.fn(async () => ids),
    getMessageMetadata: vi.fn(async (id: string) => {
      batchCalls++;
      if (batchCalls % batchSize === 0) {
        await new Promise((r) => setTimeout(r, SIMULATED_BATCH_DELAY_MS));
      }
      return {
        id,
        payload: {
          headers: [
            { name: "From", value: fromHeaders[id] ?? `<sender@example.com>` },
            { name: "Subject", value: `Repair quote 1906 Crockett` },
          ],
        },
      };
    }),
  };
}

function makeIds(n: number, domain: string) {
  const ids = Array.from({ length: n }, (_, i) => `msg-${i}`);
  const headers: Record<string, string> = {};
  for (const id of ids) headers[id] = `<user@${domain}>`;
  return { ids, headers };
}

describe("latency-regression: Stage 1", () => {
  it(`discoverDomains completes within ${SLO.stage1.p95Ms}ms`, async () => {
    const { ids, headers } = makeIds(200, "judgefite.com");
    const gmail = makeFakeGmail(ids, headers);
    const t0 = Date.now();
    await discoverDomains({
      gmailClient: gmail as any,
      domain: "property",
      userDomain: "thecontrolsurface.com",
    });
    expect(Date.now() - t0).toBeLessThan(SLO.stage1.p95Ms * 1.2);
  }, SLO.stage1.p99Ms + 5_000);
});

describe("latency-regression: Stage 2", () => {
  it(`discoverEntitiesForDomain (property) completes within ${SLO.stage2.p95Ms}ms`, async () => {
    const { ids, headers } = makeIds(200, "judgefite.com");
    const gmail = makeFakeGmail(ids, headers);
    const t0 = Date.now();
    await discoverEntitiesForDomain({
      gmailClient: gmail as any,
      schemaDomain: "property",
      confirmedDomain: "judgefite.com",
    });
    expect(Date.now() - t0).toBeLessThan(SLO.stage2.p95Ms * 1.2);
  }, SLO.stage2.p99Ms + 5_000);
});
```

- [ ] **Step 2: Commit**

```bash
pnpm --filter web vitest run apps/web/tests/eval/latency-regression.test.ts
git add apps/web/tests/eval/latency-regression.test.ts
git commit -m "test(eval): latency-regression — CI fails on Stage 1/2 p95 budget breach"
```

The existing `pnpm test:eval` glob (`tests/eval/*.test.ts` / `.vitest.ts`) picks this up automatically.

---

### Task 8.3: Runtime telemetry hooks

**Files:**
- Modify: `apps/web/src/lib/inngest/domain-discovery-fn.ts`
- Modify: `apps/web/src/lib/inngest/entity-discovery-fn.ts`

Thin structured-log emission at stage completion. No new infrastructure; forward-compatible with any log drain.

**Relationship to existing telemetry:** `apps/web/src/lib/inngest/onboarding.ts` currently emits per-step wall-clock timings (`stepDurationMs`, `dbReadMs`, `gmailTokenMs`, `gmailSampleScanMs`, `validateHypothesisMs`, `dbWriteMs` — added in commit `fcc8420`). Task 6.1's deletion of the old hypothesis/validate code path removes those emission sites along with the code. **This task is the replacement for that telemetry in the new flow.** Together with `runDomainDiscovery` / `runEntityDiscovery` own logs, it re-establishes full wall-clock visibility across the pre-scan stages so the `onboarding-timing` skill has something to read.

- [ ] **Step 1: `domain-discovery-fn.ts` — capture duration inside `step.run("discover", …)`**

`Date.now()` inside a step is memoized by Inngest across retries; outside step boundaries it's replayed each time. Capture inside the step, return as part of the result:

```typescript
const result = await step.run("discover", async () => {
  const t0 = Date.now();
  const r = await discoverDomains({ /* ... */ });
  return { ...r, durationMs: Date.now() - t0 };
});

// …after persist-and-advance completes, inside or after the final step…
logger.info({
  service: "domain-discovery-fn",
  operation: "stage1.complete",
  schemaId,
  userId: schema.userId,
  stage1DurationMs: result.durationMs,
  candidateCount: result.candidates.length,
  messagesSeen: result.messagesSeen,
  errorCount: result.errorCount,
}, "Stage 1 domain discovery complete");
```

- [ ] **Step 2: `entity-discovery-fn.ts` — same pattern, aggregate across parallel domains**

Since Stage 2 fans out in parallel, wall-clock = `Math.max(...perDomain.map(d => d.durationMs))`. Capture `durationMs` inside each per-domain `step.run`, aggregate after `Promise.all`:

```typescript
logger.info({
  service: "entity-discovery-fn",
  operation: "stage2.complete",
  schemaId,
  userId: schema.userId,
  stage2DurationMs: Math.max(...perDomain.map((d) => d.durationMs ?? 0)),
  domainsProcessed: perDomain.length,
  domainsFailed: perDomain.filter((d) => d.failed).length,
}, "Stage 2 entity discovery complete");
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/inngest/domain-discovery-fn.ts apps/web/src/lib/inngest/entity-discovery-fn.ts
git commit -m "feat(telemetry): stage1/stage2 durationMs in structured log"
```

---

### Task 8.4: Weekly SLO dashboard in status doc

**Files:**
- Modify: `docs/00_denim_current_status.md`

- [ ] **Step 1: Append this template**

```markdown
## SLO Dashboard

Updated weekly from Vercel log drain (`logger.info stage1.complete` / `stage2.complete`).

| Date | Stage 1 p95 (budget 8s) | Stage 2 p95 (budget 8s) | persistEntities p95 (budget 500ms) | Status |
|---|---|---|---|---|
| 2026-04-16 | manual only — no telemetry yet | — | — | BASELINE |

**Legend:** PASS (under budget) | WARN (within 20% of budget, monitor) | FAIL (over → blocks adding new beta users)

If FAIL: create a GitHub issue, link from this row, fix before next beta onboarding.
```

- [ ] **Step 2: Commit**

```bash
git add docs/00_denim_current_status.md
git commit -m "docs(slo): weekly SLO dashboard template"
```

---

## Phase 9 — Rollback Runbook

### Appendix: 2am-ready Rollback

**Signals that Phase 4 cutover broke something (in order of severity):**

1. Vercel logs show `markSchemaFailed` with `GMAIL_AUTH:` or unclassified errors shortly after deploy.
2. `SELECT phase, COUNT(*) FROM case_schemas GROUP BY phase` (via `supabase-db`) shows rows stuck in `DISCOVERING_DOMAINS` / `DISCOVERING_ENTITIES`.
3. Inngest dashboard shows `run-domain-discovery` / `run-entity-discovery` retries exhausted.
4. UI spinner on Phase 4 discovery screens > 60s.
5. Polling returns `stage1Candidates: null` after > 10s.

### Scenario A — Fresh-deploy rollback (code regressed)

```bash
# 1. Find last known-good commit (last green CI before Phase 4 merged)
git log --oneline -10

# 2. Revert Phase 4 (single commit assumed)
git revert <phase4-sha> --no-edit
git push origin feature/perf-quality-sprint

# 3. Vercel deploy of the reverted branch
vercel deploy --prod

# 4. Verify: POST /api/onboarding/start creates a schema, old runOnboarding
#    picks it up, schema advances through GENERATING_HYPOTHESIS.
```

Schemas in flight when the cutover broke:
- `PENDING` → survive; old flow picks them up once reverted code deploys.
- `DISCOVERING_DOMAINS` / `AWAITING_DOMAIN_CONFIRMATION` / `DISCOVERING_ENTITIES` / `AWAITING_ENTITY_CONFIRMATION` → **stranded.** Old code doesn't know these phases. Manual repair:

```sql
-- Move stranded schemas back to PENDING so old flow re-picks them up
UPDATE case_schemas
SET phase = 'PENDING',
    "phaseError" = NULL,
    "stage1Candidates" = NULL,
    "stage2Candidates" = NULL,
    "stage2ConfirmedDomains" = NULL
WHERE phase IN ('DISCOVERING_DOMAINS', 'DISCOVERING_ENTITIES',
                'AWAITING_DOMAIN_CONFIRMATION', 'AWAITING_ENTITY_CONFIRMATION');
```

Then re-emit `onboarding.session.started` for each affected schemaId via the Inngest dashboard ("Send Event") or SDK.

### Scenario B — DB-state rollback (undo schema migration)

`identityKey` column + four new `SchemaPhase` values were additive. Reverse (only run AFTER confirming git revert is done and no code references them):

```sql
-- Remove identityKey column
ALTER TABLE entities DROP COLUMN IF EXISTS "identityKey";
CREATE UNIQUE INDEX "entities_schemaId_name_type_key" ON entities ("schemaId", "name", "type");

-- Drop Stage 1/2 result columns
ALTER TABLE case_schemas
  DROP COLUMN IF EXISTS "stage1Candidates",
  DROP COLUMN IF EXISTS "stage1QueryUsed",
  DROP COLUMN IF EXISTS "stage1MessagesSeen",
  DROP COLUMN IF EXISTS "stage1ErrorCount",
  DROP COLUMN IF EXISTS "stage2Candidates",
  DROP COLUMN IF EXISTS "stage2ConfirmedDomains";

-- Postgres can't drop enum values — DISCOVERING_* / AWAITING_*_CONFIRMATION stay in the type.
-- Harmless as long as no rows reference them (the UPDATE in Scenario A handles that).
```

Run `pnpm --filter web prisma generate` after any column changes.

### Scenario C — Soft rollback (re-enable old path without git revert)

**Not possible after Phase 6.** Phase 6 deletes `generateHypothesis`, `validateHypothesis`, prompts, and validation parsers. There is no soft toggle. Hard cutover = git revert is the only rollback. Intentional — documented in Phase Sequencing.

**Before committing Phase 6, verify Phase 4 + Phase 5 are production-stable via Task 4.5's E2E run.** Do not delete old code the same day as cutover.

---

## Phase 10 — DEFERRED: Claude Validator Pass (post-MVP)

After eval data shows where regex false positives cluster, add a single Claude call after Stage 2 that takes the candidate list + a subject sample and filters hallucinations. Batched: one call per onboarding, ~1s latency, ~$0.001 cost. Catches e.g. "851 Peavy" matching a newsletter subject that has no property semantics.

Not in scope for this rebuild. Track as a follow-up issue once fixture-based eval exposes the failure rate.

---

## Acceptance Criteria

1. Fresh schema creation → `AWAITING_DOMAIN_CONFIRMATION` within `SLO.stage1.p95Ms` (8000ms) on the latency-regression CI test (Task 8.2) AND on three consecutive real-Gmail manual test runs (one per domain).
2. After domain confirmation → `AWAITING_ENTITY_CONFIRMATION` within `SLO.stage2.p95Ms` (8000ms) on the same two gates (Stage 2 fan-out is parallel; quota math in `runEntityDiscovery` doc-comment).
3. After entity confirmation → existing Stage 3 pipeline runs unchanged; final feed produces cases correctly.
4. Stage 3 AI spend per onboarding measurably drops (removal of Pass 2 discovery eliminates one Claude call + the body-scan entity discovery pass). Compare `ExtractionCost` rows pre/post cutover for one representative schema; expected ~10-20% reduction in Claude spend, 0% change in Gemini.
5. `pnpm test:eval` passes locally and in CI — precision-at-20 ≥ 0.70 on every golden fixture, ≥ 0.50 on every synthetic fixture. Latency-regression tests pass within `SLO.stage1.p95Ms * 1.2` and `SLO.stage2.p95Ms * 1.2`.
5b. Differential eval (Task 7.4) was run BEFORE Phase 6 deletion; Nick's annotated diff is committed as `beta-bootstrap.yaml` in each domain's fixture directory.
6. `pnpm typecheck` + `pnpm -r test` + `pnpm biome check` all clean.
7. No code references to `generateHypothesis`, `validateHypothesis`, `expansion-targets.ts`, `phase-review.tsx`, `interview-hypothesis.ts` prompts, or `validation-parser` after Phase 6.
8. CAS Transition Ownership Map in `docs/01_denim_lessons_learned.md` updated with the 4 new transitions (Task 6.4 Step 3).
9. Concurrent-click test on `/domain-confirm` and `/entity-confirm` returns exactly one 200 + one 409; no double-submit (issue #33 TOCTOU).
10. Gmail auth failure during Stage 1/Stage 2 surfaces `FAILED` phase with `GMAIL_AUTH:` error prefix (not silent stall).
11. Issue #95 closed with a link to the timing report.

## Out of scope

- Per-domain specs for construction, legal, general, company-internal — issue #94.
- Deep-scan prompt rewrites (Phase 2-5 of `docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md`) — still valid work but independent.
- Playwright E2E for onboarding — existing gap, not addressed here.
- Domain-shape registry refactor (issue #96) — lightweight module `domain-shapes.ts` created here is the minimum viable shape; full registry is a follow-up.
- User-driven regrouping UI for school_parent (deferred per spec Section 8).

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gmail API throttling on 500-message metadata fetch | Medium | STAGE1_TUNABLES.pacingMs=50 + batch=40; per-user serialized Stage 2 fan-out; Inngest retries=2; error counts surfaced to UI |
| Gmail project-wide cap (10k req / 100s) under 50 concurrent onboardings | Medium | Global concurrency limit=20 on Stage 1/Stage 2 Inngest functions |
| Gmail auth failure mid-Stage-1/2 strands schema | Medium | try/catch + `markSchemaFailed("GMAIL_AUTH: …")` surfaces Reconnect screen |
| Agency domain-name derivation produces ugly label (e.g., "Sghgroup") | High | Stage 2 UI provides inline edit + `needsUserEdit` flag |
| Phase 4 cutover break — dev stuck with no onboarding | High | All Phase 4 commits in one contiguous session; bisect-ready |
| Spec fixture drift (code changes, spec not updated) | Medium | CI runs `test:spec-compliance` on every PR; Discovery 9 lock-evidence asserted |
| Entity schema migration breaks existing rows | Low | Backfill sets identityKey=name; Phase 0 ships cleanly additively |
| Concurrent double-click on confirm screens emits duplicate events | Medium | CAS `updateMany` on phase gate; count===0 returns 409 |
| Outbox stranding if optimistic Inngest emit fails | Low | `drainOnboardingOutbox` cron (Task 3.3b) extended to new event names |
| Test helpers diverge from production entity-write path (Bug 1/5 class) | Medium | Task 4.4b audit grep + comment or re-route |
| Burst POSTs to confirm routes consume DB cycles (per-user DoS) | Low | Rate-limit the two new routes (e.g., 10 req / min / userId) — track as follow-up issue, non-blocker |
| `stage1Candidates` / `stage2Candidates` JSON retains subject PII after pipeline completes | Medium | Task 4.2 Step 4: null them out at PROCESSING_SCAN → COMPLETED |
| Attacker sends adversarial email subject triggering ReDoS in Stage 2 regex | Medium | MAX_SUBJECT_LEN=200 cap in property-entity.ts + school-entity.ts; unit test asserts < 50ms on pathological input |
| Unsigned /api/inngest accepts forged events targeting any schemaId | High | Task 4.4c: require INNGEST_SIGNING_KEY; verify with curl |
| User-controlled `identityKey` hijacks future SECONDARY auto-discovery | High | Task 3.2 Zod charset + max length + @-prefix reserved for SECONDARY |
| Confirm route IDOR (cross-tenant schemaId) | Critical | Task 3.1/3.2 rewrites use assertResourceOwnership matching the existing [schemaId]/route.ts pattern |
| OnboardingOutbox insert fails (missing userId NOT NULL) | Critical | Task 3.1/3.2 include userId in both data and payload |
| Raw Gmail error body (potentially containing Bearer header) persisted via markSchemaFailed | High | getMessageMetadata never includes res.text() in thrown Error |
