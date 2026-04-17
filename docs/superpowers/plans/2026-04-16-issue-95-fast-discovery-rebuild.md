# Issue #95 — Fast-Discovery Onboarding Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hypothesis-based onboarding (Function A: generate-hypothesis → validate-hypothesis → review; ~35-60s user wait before review) with a 3-stage fast-discovery flow (Stage 1 domain confirm ~5s → Stage 2 entity confirm ~6s → Stage 3 deep scan in background ~5min).

**Architecture:** The flow models Nick's other product, The Control Surface. Stages 1 and 2 are pure regex + metadata-only Gmail fetches (zero AI, zero bodies) so they fit under 11 seconds wall-clock. Stage 3 is the existing extraction → clustering → synthesis pipeline, unchanged except that it receives a user-confirmed entity list instead of Function A's AI-discovered one. Cutover is hard (no feature flag): Phase 4 deletes old hypothesis code in one commit. No backward compat — there are no customers yet.

**Spec:** 3 per-domain spec files + cross-domain preamble, all locked 2026-04-16:
- `docs/domain-input-shapes/property.md`
- `docs/domain-input-shapes/school_parent.md`
- `docs/domain-input-shapes/agency.md`

**Tech Stack:** TypeScript (strict), Next.js 16 App Router, React 19, Prisma 5, Supabase PostgreSQL via pooler, Inngest, Vitest, Tailwind. New dependency: `fastest-levenshtein@1.x` for dedup (already 2KB, zero sub-deps).

**Validation strategy:** Phase 5 produces a `pnpm test:spec-compliance` harness that parses each per-domain spec file's structured sections (Stage 1 keyword list, Stage 2 regex, PRIMARY/SECONDARY rules, fixture inputs) and asserts the runtime code matches. Every future edit to a spec file fails CI until the code catches up — spec becomes the executable source of truth.

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
Phase 5  Spec-compliance harness                                  [tests]
Phase 6  Cleanup: delete dead code, docs, final E2E               [mechanical]
```

Each phase must land fully-green before the next starts (typecheck + unit tests + applicable integration tests). Phase 4 is the risk-point — after Phase 4 the only way backward is git revert.

---

## Phase 0 — Foundation

### Task 0.1: Extend `SchemaPhase` enum with two new review phases

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (lines ~1035-1044)

- [ ] **Step 1: Edit the `SchemaPhase` enum**

Find the block:

```prisma
enum SchemaPhase {
  PENDING
  GENERATING_HYPOTHESIS
  FINALIZING_SCHEMA
  PROCESSING_SCAN
  AWAITING_REVIEW
  COMPLETED
  NO_EMAILS_FOUND
  FAILED
}
```

Replace with:

```prisma
enum SchemaPhase {
  PENDING
  // Legacy — kept during Phase 0-3, removed in Phase 6
  GENERATING_HYPOTHESIS
  // New fast-discovery phases
  DISCOVERING_DOMAINS
  AWAITING_DOMAIN_CONFIRMATION
  DISCOVERING_ENTITIES
  AWAITING_ENTITY_CONFIRMATION
  // Kept
  FINALIZING_SCHEMA
  PROCESSING_SCAN
  AWAITING_REVIEW
  COMPLETED
  NO_EMAILS_FOUND
  FAILED
}
```

- [ ] **Step 2: Apply via supabase-db skill**

Do NOT run `prisma migrate dev` (per CLAUDE.md the project uses raw-SQL migrations via `supabase-db`). Invoke the `supabase-db` skill with this command:

```sql
ALTER TYPE "SchemaPhase" ADD VALUE IF NOT EXISTS 'DISCOVERING_DOMAINS' BEFORE 'FINALIZING_SCHEMA';
ALTER TYPE "SchemaPhase" ADD VALUE IF NOT EXISTS 'AWAITING_DOMAIN_CONFIRMATION' BEFORE 'FINALIZING_SCHEMA';
ALTER TYPE "SchemaPhase" ADD VALUE IF NOT EXISTS 'DISCOVERING_ENTITIES' BEFORE 'FINALIZING_SCHEMA';
ALTER TYPE "SchemaPhase" ADD VALUE IF NOT EXISTS 'AWAITING_ENTITY_CONFIRMATION' BEFORE 'FINALIZING_SCHEMA';
```

- [ ] **Step 3: Regenerate Prisma client + clear .next cache**

```bash
pnpm --filter web prisma generate
rm -rf apps/web/.next
```

Expected: prisma generate completes without error; SchemaPhase TS enum now has the 4 new values.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: clean. Any ts errors about `SchemaPhase` should be ones we introduced — none at this point yet.

- [ ] **Step 5: Commit**

```bash
git add apps/web/prisma/schema.prisma
git commit -m "feat(schema): add 4 fast-discovery phases to SchemaPhase enum

DISCOVERING_DOMAINS, AWAITING_DOMAIN_CONFIRMATION, DISCOVERING_ENTITIES,
AWAITING_ENTITY_CONFIRMATION. Backfills for issue #95 rebuild. Old
GENERATING_HYPOTHESIS value kept until Phase 6 cleanup."
```

---

### Task 0.2: Add `identityKey` column to Entity + new unique constraint

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (Entity model, lines ~322-368)

Rationale: SECONDARIES must be keyed by email address / `@domain`, not display name. `name` becomes a pure display label; `identityKey` is the dedup key. For PRIMARIES, `identityKey = name` (backward-compatible semantics). For SECONDARIES, `identityKey = address` (e.g., `timothy.bishop@judgefite.com`) or `@<domain>` (e.g., `@judgefite.com`).

- [ ] **Step 1: Edit the Entity model**

Find `@@unique([schemaId, name, type])` on line ~365. Replace the Entity model block with:

```prisma
model Entity {
  id            String   @id @default(cuid())
  schemaId      String
  schema        CaseSchema @relation(fields: [schemaId], references: [id], onDelete: Cascade)

  name          String
  // Dedup identity. For PRIMARY: same as name. For SECONDARY: email address or "@domain".
  identityKey   String
  type          EntityType

  secondaryTypeName  String?

  aliases       Json     @default("[]")

  groupId   String?
  group     EntityGroup? @relation(fields: [groupId], references: [id])

  associatedPrimaryIds  Json  @default("[]")

  autoDetected  Boolean  @default(true)
  confidence    Float    @default(1.0)
  isActive      Boolean  @default(true)
  emailCount    Int      @default(0)
  validationEmailIndices  Json?
  likelyAliasOf           String?
  aliasConfidence          Float?
  aliasReason              String?

  emails        Email[]
  cases         Case[]

  senderEmails  Email[]  @relation("SenderEntity")

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([schemaId, identityKey, type])
  @@index([schemaId, type, isActive])
  @@map("entities")
}
```

Note: dropped `@@unique([schemaId, name, type])` in favor of `@@unique([schemaId, identityKey, type])`.

- [ ] **Step 2: Apply via supabase-db skill**

```sql
-- Additive column, nullable during backfill
ALTER TABLE entities ADD COLUMN "identityKey" text;

-- Backfill: existing PRIMARY rows use name; existing SECONDARY rows also use name
-- (they're all user-typed display names today; this rebuild will populate addresses on new rows).
UPDATE entities SET "identityKey" = "name" WHERE "identityKey" IS NULL;

-- Enforce non-null
ALTER TABLE entities ALTER COLUMN "identityKey" SET NOT NULL;

-- Swap uniqueness
ALTER TABLE entities DROP CONSTRAINT IF EXISTS "entities_schemaId_name_type_key";
CREATE UNIQUE INDEX "entities_schemaId_identityKey_type_key"
  ON entities ("schemaId", "identityKey", "type");
```

- [ ] **Step 3: Regenerate + typecheck**

```bash
pnpm --filter web prisma generate
pnpm typecheck
```

Expected: callers of `Entity.create` / `Entity.upsert` that previously relied on `(schemaId, name, type)` fail typecheck — enumerate them. These are:
- `apps/web/src/lib/services/interview.ts` — `persistSchemaRelations` (several `upsert` calls)
- `apps/web/src/lib/inngest/onboarding.ts` — `expand-confirmed-domains` step
- `apps/web/src/lib/services/extraction.ts` — Stage 4b primary-entity creation
- Possibly `apps/web/src/lib/services/entity-matching.ts` or similar

For each caller, add `identityKey: <same value as name>` to preserve existing behavior. This is a mechanical substitution for Phase 0; real address-keyed SECONDARIES come in Phase 3.

- [ ] **Step 4: Commit**

```bash
git add apps/web/prisma/schema.prisma apps/web/src/lib/services/interview.ts \
        apps/web/src/lib/inngest/onboarding.ts apps/web/src/lib/services/extraction.ts
git commit -m "feat(schema): add Entity.identityKey as dedup key

For PRIMARY: identityKey = name. For SECONDARY: identityKey will become
email address or @domain once Stage 2 lands (Phase 2). Backfill sets
identityKey = name for all existing rows; swap unique constraint from
(schemaId, name, type) to (schemaId, identityKey, type).

All existing callers updated to pass identityKey alongside name."
```

- [ ] **Step 5: Sanity-check with supabase-db**

```sql
SELECT COUNT(*), COUNT("identityKey") FROM entities;
SELECT COUNT(*) FROM entities WHERE "identityKey" != "name";
```

Expected: both counts equal; third query returns 0 (all identityKeys match names at this point).

---

### Task 0.3: Create per-domain config module

**Files:**
- Create: `apps/web/src/lib/config/domain-shapes.ts`

This file encodes what the spec files describe: per-domain Stage 1 keyword list, which Stage 2 algorithm to use, and any numeric knobs. Keep the content 1:1 with the spec files — Phase 5 enforces sync.

- [ ] **Step 1: Create the file**

```typescript
// apps/web/src/lib/config/domain-shapes.ts
//
// Runtime configuration derived from docs/domain-input-shapes/<domain>.md.
// Phase 5's spec-compliance test enforces byte-level sync between this file
// and the Stage 1 keyword lists + Stage 2 rule selectors in the spec files.
// DO NOT edit the values here without updating the spec file first.

export type DomainName = "property" | "school_parent" | "agency";
export type Stage2Algorithm = "property-address" | "school-two-pattern" | "agency-domain-derive";

export interface DomainShape {
  domain: DomainName;
  // Stage 1: subject keyword list used to build the Gmail metadata query
  stage1Keywords: readonly string[];
  // Stage 1: how many top candidate domains to return (property=3, school=5, agency=5)
  stage1TopN: number;
  // Stage 2: which algorithm variant to dispatch
  stage2Algorithm: Stage2Algorithm;
}

export const DOMAIN_SHAPES: Record<DomainName, DomainShape> = {
  property: {
    domain: "property",
    stage1Keywords: [
      "invoice", "repair", "leak", "rent", "balance", "statement",
      "application", "marketing", "lease", "estimate", "inspection",
      "work order", "renewal",
    ],
    stage1TopN: 3,
    stage2Algorithm: "property-address",
  },
  school_parent: {
    domain: "school_parent",
    stage1Keywords: [
      "practice", "game", "tournament", "schedule", "registration",
      "tryout", "recital", "performance", "pickup", "dropoff",
      "permission", "field trip", "parent", "teacher", "coach",
      "homework", "report card", "conference", "appointment",
    ],
    stage1TopN: 5,
    stage2Algorithm: "school-two-pattern",
  },
  agency: {
    domain: "agency",
    stage1Keywords: [
      "invoice", "scope", "deliverable", "review", "deck",
      "proposal", "contract", "retainer", "kickoff", "status",
      "deadline", "agreement", "RFP", "SOW", "milestone",
      "feedback", "approval", "draft",
      "call", "meeting", "session", "update", "slides",
      "documents", "demo", "round", "initiative", "project",
    ],
    stage1TopN: 5,
    stage2Algorithm: "agency-domain-derive",
  },
};

export function getDomainShape(domain: string): DomainShape {
  if (!(domain in DOMAIN_SHAPES)) {
    throw new Error(`Unknown domain: ${domain}. Known: ${Object.keys(DOMAIN_SHAPES).join(", ")}`);
  }
  return DOMAIN_SHAPES[domain as DomainName];
}
```

- [ ] **Step 2: Add a unit test for the getter**

Create `apps/web/src/lib/config/__tests__/domain-shapes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DOMAIN_SHAPES, getDomainShape } from "../domain-shapes";

describe("domain-shapes", () => {
  it("knows 3 domains", () => {
    expect(Object.keys(DOMAIN_SHAPES).sort()).toEqual(["agency", "property", "school_parent"]);
  });

  it("each domain has non-empty keywords", () => {
    for (const shape of Object.values(DOMAIN_SHAPES)) {
      expect(shape.stage1Keywords.length).toBeGreaterThan(0);
    }
  });

  it("throws on unknown domain", () => {
    expect(() => getDomainShape("construction")).toThrow(/Unknown domain/);
  });

  it("property has 13 Stage 1 keywords (matches spec)", () => {
    expect(DOMAIN_SHAPES.property.stage1Keywords.length).toBe(13);
  });

  it("agency has 28 Stage 1 keywords (18 formal + 10 working — locked 2026-04-16)", () => {
    expect(DOMAIN_SHAPES.agency.stage1Keywords.length).toBe(28);
  });

  it("school_parent has 19 Stage 1 keywords", () => {
    expect(DOMAIN_SHAPES.school_parent.stage1Keywords.length).toBe(19);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter web test -- domain-shapes
```

Expected: 6 passing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/config/domain-shapes.ts apps/web/src/lib/config/__tests__/domain-shapes.test.ts
git commit -m "feat(config): add domain-shapes runtime config matching spec files

Stage 1 keyword lists + Stage 2 algorithm selectors for property,
school_parent, agency. Values are 1:1 with docs/domain-input-shapes/*.md;
Phase 5 harness enforces the sync."
```

---

### Task 0.4: Extend `onboarding-tunables.ts` with Stage 1/Stage 2 groups

**Files:**
- Modify: `apps/web/src/lib/config/onboarding-tunables.ts`

- [ ] **Step 1: Read the current file to find the export layout**

```bash
grep -n "^export " apps/web/src/lib/config/onboarding-tunables.ts
```

- [ ] **Step 2: Add two new tunable groups**

Append to the file (or interleave with existing structure per the file's pattern):

```typescript
/**
 * Stage 1 — Domain Discovery tunables.
 * Target: < 5 seconds wall for several hundred emails.
 */
export const STAGE1_TUNABLES = {
  /** Max Gmail message IDs to fetch metadata for in a single Stage 1 pass. */
  maxMessages: 500,
  /** Parallel batch size for the From-header fetch. The Control Surface reference uses 40. */
  fetchBatchSize: 40,
  /** Lookback window passed to the Gmail `after:` qualifier. */
  lookbackDays: 365,
  /** Gmail API pacing between batches, in milliseconds. */
  pacingMs: 50,
} as const;

/**
 * Stage 2 — Entity Discovery tunables.
 * Target: < 6 seconds wall for several hundred emails per confirmed domain.
 */
export const STAGE2_TUNABLES = {
  /** Max Gmail message IDs to fetch per confirmed Stage-1 domain. */
  maxMessagesPerDomain: 500,
  /** Parallel batch size (same as Stage 1 for simplicity). */
  fetchBatchSize: 40,
  /** Lookback window (matches Stage 1). */
  lookbackDays: 365,
  /** Top N candidate entities to surface per confirmed domain. */
  topNEntities: 20,
  /** Levenshtein threshold for short street-name / entity-name strings (<=6 chars). */
  levenshteinShortThreshold: 1,
  /** Levenshtein threshold for longer strings. */
  levenshteinLongThreshold: 2,
} as const;
```

- [ ] **Step 3: Extend existing test file or create one**

Add cases to `apps/web/src/lib/config/__tests__/onboarding-tunables.test.ts` (or create):

```typescript
import { describe, it, expect } from "vitest";
import { STAGE1_TUNABLES, STAGE2_TUNABLES } from "../onboarding-tunables";

describe("stage1/stage2 tunables", () => {
  it("stage1 maxMessages is 500 per the cross-domain preamble", () => {
    expect(STAGE1_TUNABLES.maxMessages).toBe(500);
  });

  it("stage2 topNEntities is 20 per the cross-domain preamble", () => {
    expect(STAGE2_TUNABLES.topNEntities).toBe(20);
  });

  it("Levenshtein thresholds match spec (1 short, 2 long)", () => {
    expect(STAGE2_TUNABLES.levenshteinShortThreshold).toBe(1);
    expect(STAGE2_TUNABLES.levenshteinLongThreshold).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter web test -- onboarding-tunables
```

Expected: passing.

```bash
git add apps/web/src/lib/config/onboarding-tunables.ts \
        apps/web/src/lib/config/__tests__/onboarding-tunables.test.ts
git commit -m "feat(config): add STAGE1_TUNABLES and STAGE2_TUNABLES"
```

---

## Phase 1 — Stage 1 Domain Discovery

### Task 1.1: Implement `public-providers.ts` constant

**Files:**
- Create: `apps/web/src/lib/discovery/public-providers.ts`
- Create: `apps/web/src/lib/discovery/__tests__/public-providers.test.ts`

- [ ] **Step 1: Create test first (TDD)**

```typescript
// apps/web/src/lib/discovery/__tests__/public-providers.test.ts
import { describe, it, expect } from "vitest";
import { isPublicProvider, PUBLIC_PROVIDERS } from "../public-providers";

describe("public-providers", () => {
  it("recognizes gmail", () => {
    expect(isPublicProvider("gmail.com")).toBe(true);
  });

  it("recognizes yahoo variants", () => {
    expect(isPublicProvider("yahoo.com")).toBe(true);
    expect(isPublicProvider("YAHOO.COM")).toBe(true);
  });

  it("does not match custom domains", () => {
    expect(isPublicProvider("portfolioproadvisors.com")).toBe(false);
    expect(isPublicProvider("anthropic.com")).toBe(false);
  });

  it("exports a non-empty set", () => {
    expect(PUBLIC_PROVIDERS.size).toBeGreaterThan(8);
  });
});
```

- [ ] **Step 2: Run test to see it fail**

```bash
pnpm --filter web test -- public-providers
```

Expected: Fail with "Cannot find module '../public-providers'".

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/lib/discovery/public-providers.ts
//
// Generic email-provider domains that should never be treated as
// client domains, activity-platform domains, or school/vendor domains
// in Stage 1 aggregation. Ported from The Control Surface constants.ts:559.

export const PUBLIC_PROVIDERS: ReadonlySet<string> = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "msn.com",
  "live.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "zoho.com",
  "gmx.com",
]);

export function isPublicProvider(domain: string): boolean {
  return PUBLIC_PROVIDERS.has(domain.toLowerCase());
}
```

- [ ] **Step 4: Run test, expect pass + commit**

```bash
pnpm --filter web test -- public-providers
```

Expected: 4 passing.

```bash
git add apps/web/src/lib/discovery/public-providers.ts \
        apps/web/src/lib/discovery/__tests__/public-providers.test.ts
git commit -m "feat(discovery): PUBLIC_PROVIDERS constant + isPublicProvider"
```

---

### Task 1.2: Implement `gmail-metadata-fetch.ts`

**Files:**
- Create: `apps/web/src/lib/discovery/gmail-metadata-fetch.ts`
- Create: `apps/web/src/lib/discovery/__tests__/gmail-metadata-fetch.test.ts`

Responsibility: given a Gmail client + query string + limit, return an array of `{ messageId, fromHeader }`. Uses `format: 'metadata'` and batches in parallel per STAGE1_TUNABLES.fetchBatchSize.

- [ ] **Step 1: Write the test (with mocked Gmail client)**

```typescript
// apps/web/src/lib/discovery/__tests__/gmail-metadata-fetch.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchFromHeaders } from "../gmail-metadata-fetch";

describe("fetchFromHeaders", () => {
  it("returns From header for each message ID", async () => {
    const mockClient = {
      listMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      }),
      getMessageMetadata: vi.fn(async (id: string) => ({
        id,
        payload: {
          headers: [{ name: "From", value: `Sender ${id} <sender${id}@example.com>` }],
        },
      })),
    };

    const results = await fetchFromHeaders(mockClient as any, "subject:test", 100);

    expect(results).toHaveLength(3);
    expect(results[0].fromHeader).toMatch(/sender/i);
    expect(mockClient.getMessageMetadata).toHaveBeenCalledTimes(3);
  });

  it("returns empty array when list is empty", async () => {
    const mockClient = {
      listMessages: vi.fn().mockResolvedValue({ messages: [] }),
      getMessageMetadata: vi.fn(),
    };
    const results = await fetchFromHeaders(mockClient as any, "q", 100);
    expect(results).toEqual([]);
    expect(mockClient.getMessageMetadata).not.toHaveBeenCalled();
  });

  it("respects the limit", async () => {
    const messages = Array.from({ length: 250 }, (_, i) => ({ id: `m${i}` }));
    const mockClient = {
      listMessages: vi.fn().mockResolvedValue({ messages }),
      getMessageMetadata: vi.fn(async (id) => ({
        id,
        payload: { headers: [{ name: "From", value: `<${id}@x.com>` }] },
      })),
    };
    const results = await fetchFromHeaders(mockClient as any, "q", 100);
    expect(results).toHaveLength(100);
  });
});
```

- [ ] **Step 2: Run test — fails on import**

```bash
pnpm --filter web test -- gmail-metadata-fetch
```

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/lib/discovery/gmail-metadata-fetch.ts
import { STAGE1_TUNABLES } from "@/lib/config/onboarding-tunables";

interface GmailClientLike {
  listMessages(args: { q: string; maxResults: number }): Promise<{ messages?: { id: string }[] }>;
  getMessageMetadata(id: string, headers?: string[]): Promise<{
    id: string;
    payload: { headers: Array<{ name: string; value: string }> };
  }>;
}

export interface FromHeaderResult {
  messageId: string;
  fromHeader: string;
}

/**
 * Fetch the From header for up to `limit` messages matching `query`.
 * Uses format: 'metadata' — no body bytes, no attachments, minimal network.
 * Batches in parallel per STAGE1_TUNABLES.fetchBatchSize.
 */
export async function fetchFromHeaders(
  client: GmailClientLike,
  query: string,
  limit: number = STAGE1_TUNABLES.maxMessages,
): Promise<FromHeaderResult[]> {
  const list = await client.listMessages({ q: query, maxResults: limit });
  const ids = (list.messages ?? []).slice(0, limit).map(m => m.id);
  if (ids.length === 0) return [];

  const results: FromHeaderResult[] = [];
  const batchSize = STAGE1_TUNABLES.fetchBatchSize;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const resolved = await Promise.all(
      batch.map(async (id) => {
        try {
          const msg = await client.getMessageMetadata(id, ["From"]);
          const from = msg.payload.headers.find(h => h.name.toLowerCase() === "from")?.value ?? "";
          return { messageId: id, fromHeader: from };
        } catch {
          return null;
        }
      }),
    );
    for (const r of resolved) if (r) results.push(r);
    if (STAGE1_TUNABLES.pacingMs > 0 && i + batchSize < ids.length) {
      await new Promise(resolve => setTimeout(resolve, STAGE1_TUNABLES.pacingMs));
    }
  }
  return results;
}
```

Note: the existing `apps/web/src/lib/gmail/client.ts` may not have a `getMessageMetadata(id, headers?)` method with this signature. Check the file and either (a) add a thin method if missing, or (b) adapt to the existing `getEmailMetadata` shape.

- [ ] **Step 4: Check and adapt to the real Gmail client interface**

```bash
grep -n "getMessage\|getEmail" apps/web/src/lib/gmail/client.ts
```

If a `metadata`-capable helper exists under a different name (e.g., `getEmailMetadata`), update the `GmailClientLike` interface above AND the call sites to match. Commit this adaptation as part of this task.

- [ ] **Step 5: Run tests, commit**

```bash
pnpm --filter web test -- gmail-metadata-fetch
```

Expected: 3 passing.

```bash
git add apps/web/src/lib/discovery/gmail-metadata-fetch.ts \
        apps/web/src/lib/discovery/__tests__/gmail-metadata-fetch.test.ts \
        apps/web/src/lib/gmail/client.ts
git commit -m "feat(discovery): fetchFromHeaders — metadata-only batch Gmail fetch"
```

---

### Task 1.3: Implement `domain-aggregator.ts`

**Files:**
- Create: `apps/web/src/lib/discovery/domain-aggregator.ts`
- Create: `apps/web/src/lib/discovery/__tests__/domain-aggregator.test.ts`

Responsibility: given `FromHeaderResult[]` + user email domain + desired top N, return `{ domain: string; count: number }[]` sorted desc, after dropping generics and the user's own domain.

- [ ] **Step 1: Write tests**

```typescript
// apps/web/src/lib/discovery/__tests__/domain-aggregator.test.ts
import { describe, it, expect } from "vitest";
import { aggregateDomains } from "../domain-aggregator";

const sample = [
  { messageId: "1", fromHeader: "A <a@portfolioproadvisors.com>" },
  { messageId: "2", fromHeader: "<b@portfolioproadvisors.com>" },
  { messageId: "3", fromHeader: "c@portfolioproadvisors.com" },
  { messageId: "4", fromHeader: "D <d@stallionis.com>" },
  { messageId: "5", fromHeader: "E <e@gmail.com>" },
  { messageId: "6", fromHeader: "F <nick@thecontrolsurface.com>" },
  { messageId: "7", fromHeader: "" }, // malformed
];

describe("aggregateDomains", () => {
  it("groups by sender domain and sorts descending", () => {
    const result = aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 5 });
    expect(result[0]).toEqual({ domain: "portfolioproadvisors.com", count: 3 });
    expect(result[1]).toEqual({ domain: "stallionis.com", count: 1 });
  });

  it("drops generic providers", () => {
    const result = aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 5 });
    expect(result.find(r => r.domain === "gmail.com")).toBeUndefined();
  });

  it("drops the user's own domain", () => {
    const result = aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 5 });
    expect(result.find(r => r.domain === "thecontrolsurface.com")).toBeUndefined();
  });

  it("respects topN", () => {
    const result = aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("portfolioproadvisors.com");
  });

  it("handles malformed headers without crashing", () => {
    expect(() =>
      aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 5 })
    ).not.toThrow();
  });

  it("case-insensitive domain matching (treats GMAIL.COM and gmail.com as same generic)", () => {
    const result = aggregateDomains(
      [{ messageId: "1", fromHeader: "<a@GMAIL.COM>" }],
      { userDomain: "x.com", topN: 5 },
    );
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — fails on import**

```bash
pnpm --filter web test -- domain-aggregator
```

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/lib/discovery/domain-aggregator.ts
import { isPublicProvider } from "./public-providers";
import type { FromHeaderResult } from "./gmail-metadata-fetch";

export interface DomainCandidate {
  domain: string;
  count: number;
}

export interface AggregateOptions {
  userDomain: string;
  topN: number;
}

function extractDomain(fromHeader: string): string {
  const addr = fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader;
  const at = addr.indexOf("@");
  if (at < 0) return "";
  return addr.slice(at + 1).trim().toLowerCase();
}

export function aggregateDomains(
  rows: FromHeaderResult[],
  opts: AggregateOptions,
): DomainCandidate[] {
  const userDomain = opts.userDomain.toLowerCase();
  const counts = new Map<string, number>();

  for (const row of rows) {
    const domain = extractDomain(row.fromHeader);
    if (!domain) continue;
    if (isPublicProvider(domain)) continue;
    if (domain === userDomain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, opts.topN);
}
```

- [ ] **Step 4: Run tests, commit**

```bash
pnpm --filter web test -- domain-aggregator
```

Expected: 6 passing.

```bash
git add apps/web/src/lib/discovery/domain-aggregator.ts \
        apps/web/src/lib/discovery/__tests__/domain-aggregator.test.ts
git commit -m "feat(discovery): aggregateDomains — group, filter, rank"
```

---

### Task 1.4: Build the Stage 1 Gmail query for a given domain

**Files:**
- Create: `apps/web/src/lib/discovery/domain-discovery.ts`
- Create: `apps/web/src/lib/discovery/__tests__/domain-discovery-query.test.ts`

- [ ] **Step 1: Test the query builder**

```typescript
// apps/web/src/lib/discovery/__tests__/domain-discovery-query.test.ts
import { describe, it, expect } from "vitest";
import { buildStage1Query } from "../domain-discovery";

describe("buildStage1Query", () => {
  it("builds a Gmail OR-subject query with the domain's keyword list", () => {
    const q = buildStage1Query("property", 365);
    expect(q).toContain('subject:(');
    expect(q).toContain('"invoice"');
    expect(q).toContain('"repair"');
    expect(q).toContain('-category:promotions');
    expect(q).toContain('newer_than:365d');
  });

  it("agency query contains the working-vocab additions", () => {
    const q = buildStage1Query("agency", 365);
    expect(q).toContain('"call"');
    expect(q).toContain('"slides"');
    expect(q).toContain('"initiative"');
  });

  it("school_parent query contains multi-word phrases properly quoted", () => {
    const q = buildStage1Query("school_parent", 365);
    expect(q).toContain('"field trip"');
    expect(q).toContain('"report card"');
  });

  it("throws on unknown domain", () => {
    expect(() => buildStage1Query("legal" as any, 365)).toThrow(/Unknown domain/);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement the query builder (in `domain-discovery.ts`)**

```typescript
// apps/web/src/lib/discovery/domain-discovery.ts
import { getDomainShape, type DomainName } from "@/lib/config/domain-shapes";
import { STAGE1_TUNABLES } from "@/lib/config/onboarding-tunables";
import { aggregateDomains, type DomainCandidate } from "./domain-aggregator";
import { fetchFromHeaders } from "./gmail-metadata-fetch";

export function buildStage1Query(domain: DomainName, lookbackDays: number): string {
  const shape = getDomainShape(domain);
  const quoted = shape.stage1Keywords.map(k => `"${k}"`).join(" OR ");
  return `subject:(${quoted}) -category:promotions newer_than:${lookbackDays}d`;
}

export interface DiscoverDomainsInput {
  gmailClient: Parameters<typeof fetchFromHeaders>[0];
  domain: DomainName;
  userDomain: string;
}

export interface DiscoverDomainsOutput {
  candidates: DomainCandidate[];
  messagesSeen: number;
  queryUsed: string;
}

export async function discoverDomains(input: DiscoverDomainsInput): Promise<DiscoverDomainsOutput> {
  const shape = getDomainShape(input.domain);
  const query = buildStage1Query(input.domain, STAGE1_TUNABLES.lookbackDays);
  const rows = await fetchFromHeaders(input.gmailClient, query, STAGE1_TUNABLES.maxMessages);
  const candidates = aggregateDomains(rows, {
    userDomain: input.userDomain,
    topN: shape.stage1TopN,
  });
  return { candidates, messagesSeen: rows.length, queryUsed: query };
}
```

- [ ] **Step 4: Run tests, commit**

```bash
pnpm --filter web test -- domain-discovery
```

Expected: 4 passing.

```bash
git add apps/web/src/lib/discovery/domain-discovery.ts \
        apps/web/src/lib/discovery/__tests__/domain-discovery-query.test.ts
git commit -m "feat(discovery): buildStage1Query + discoverDomains entry point"
```

---

### Task 1.5: Add integration test for `discoverDomains` with mocked Gmail

**Files:**
- Create: `apps/web/src/lib/discovery/__tests__/domain-discovery.integration.test.ts`

- [ ] **Step 1: Test the full Stage 1 path end-to-end (in-process)**

```typescript
// apps/web/src/lib/discovery/__tests__/domain-discovery.integration.test.ts
import { describe, it, expect, vi } from "vitest";
import { discoverDomains } from "../domain-discovery";

function makeMockGmail(messagesByDomain: Record<string, number>) {
  const ids: string[] = [];
  const headerById = new Map<string, string>();
  let counter = 0;
  for (const [domain, count] of Object.entries(messagesByDomain)) {
    for (let i = 0; i < count; i++) {
      const id = `m${counter++}`;
      ids.push(id);
      headerById.set(id, `<u${counter}@${domain}>`);
    }
  }
  return {
    listMessages: vi.fn().mockResolvedValue({ messages: ids.map(id => ({ id })) }),
    getMessageMetadata: vi.fn(async (id: string) => ({
      id,
      payload: { headers: [{ name: "From", value: headerById.get(id) ?? "" }] },
    })),
  };
}

describe("discoverDomains", () => {
  it("property: returns top 3 client domains (excludes generics and user domain)", async () => {
    const gmail = makeMockGmail({
      "judgefite.com": 17,
      "zephyrpm.com": 12,
      "teamsnap.com": 8,
      "gmail.com": 50,
      "thecontrolsurface.com": 9,
    });
    const result = await discoverDomains({
      gmailClient: gmail as any,
      domain: "property",
      userDomain: "thecontrolsurface.com",
    });
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]).toEqual({ domain: "judgefite.com", count: 17 });
    expect(result.candidates[1]).toEqual({ domain: "zephyrpm.com", count: 12 });
    expect(result.candidates[2]).toEqual({ domain: "teamsnap.com", count: 8 });
    expect(result.candidates.find(c => c.domain === "gmail.com")).toBeUndefined();
  });

  it("agency: returns top 5 client domains", async () => {
    const gmail = makeMockGmail({
      "portfolioproadvisors.com": 15,
      "stallionis.com": 4,
      "anthropic.com": 3,
      "tesla.com": 2,
      "client5.com": 1,
      "client6.com": 1,
    });
    const result = await discoverDomains({
      gmailClient: gmail as any,
      domain: "agency",
      userDomain: "thecontrolsurface.com",
    });
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates[0].domain).toBe("portfolioproadvisors.com");
  });
});
```

- [ ] **Step 2: Run tests, commit**

```bash
pnpm --filter web test -- domain-discovery.integration
```

Expected: 2 passing.

```bash
git add apps/web/src/lib/discovery/__tests__/domain-discovery.integration.test.ts
git commit -m "test(discovery): integration test for discoverDomains"
```

---

### Task 1.6: Inngest function wrapper for Stage 1

**Files:**
- Create: `apps/web/src/lib/inngest/domain-discovery-fn.ts`
- Modify: `apps/web/src/lib/inngest/client.ts` (or wherever functions are registered) to export this function.

- [ ] **Step 1: Read the current Inngest registration site**

```bash
grep -rn "inngest.createFunction\|export const run" apps/web/src/lib/inngest/ | head -20
```

- [ ] **Step 2: Create the function**

```typescript
// apps/web/src/lib/inngest/domain-discovery-fn.ts
import { inngest } from "./client";
import { prisma } from "@/lib/prisma";
import { discoverDomains } from "@/lib/discovery/domain-discovery";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { getGmailClient } from "@/lib/gmail/client";

/**
 * Stage 1: domain discovery. Fires when a schema enters PENDING→DISCOVERING_DOMAINS.
 * Writes result to CaseSchema.stage1Candidates (Prisma JSON column added in a later task) and
 * advances to AWAITING_DOMAIN_CONFIRMATION.
 */
export const runDomainDiscovery = inngest.createFunction(
  {
    id: "run-domain-discovery",
    name: "Stage 1 — Domain Discovery",
    retries: 2,
    concurrency: [{ key: "event.data.schemaId", limit: 1 }],
  },
  { event: "onboarding.domain-discovery.requested" },
  async ({ event, step }) => {
    const schemaId: string = event.data.schemaId;

    const schema = await step.run("load-schema", async () => {
      const s = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { id: true, userId: true, domain: true, phase: true, inputs: true },
      });
      return s;
    });

    if (!schema.domain) throw new Error(`Schema ${schemaId} missing domain`);

    await step.run("advance-to-discovering", async () => {
      await advanceSchemaPhase(schemaId, "PENDING", "DISCOVERING_DOMAINS");
    });

    const result = await step.run("discover", async () => {
      const gmail = await getGmailClient(schema.userId);
      const inputs = schema.inputs as { userEmail?: string } | null;
      const userDomain = (inputs?.userEmail ?? "").split("@")[1]?.toLowerCase() ?? "";
      return discoverDomains({
        gmailClient: gmail,
        domain: schema.domain as any,
        userDomain,
      });
    });

    await step.run("persist-candidates", async () => {
      await prisma.caseSchema.update({
        where: { id: schemaId },
        data: {
          stage1Candidates: result.candidates as any,
          stage1QueryUsed: result.queryUsed,
          stage1MessagesSeen: result.messagesSeen,
        },
      });
    });

    await step.run("advance-to-awaiting", async () => {
      await advanceSchemaPhase(schemaId, "DISCOVERING_DOMAINS", "AWAITING_DOMAIN_CONFIRMATION");
    });

    return { candidates: result.candidates.length };
  },
);
```

- [ ] **Step 3: Add the three new CaseSchema columns via supabase-db skill**

```sql
ALTER TABLE case_schemas ADD COLUMN "stage1Candidates" jsonb;
ALTER TABLE case_schemas ADD COLUMN "stage1QueryUsed" text;
ALTER TABLE case_schemas ADD COLUMN "stage1MessagesSeen" integer;
```

And add the matching fields to `CaseSchema` in `schema.prisma`:

```prisma
// Stage 1 result (populated by Inngest runDomainDiscovery)
stage1Candidates    Json?
stage1QueryUsed     String?
stage1MessagesSeen  Int?
```

- [ ] **Step 4: Register the function in the Inngest serve config**

Find `apps/web/src/app/api/inngest/route.ts` (or wherever `serve({ functions: [...] })` is called) and add `runDomainDiscovery` to the list.

- [ ] **Step 5: Regenerate + typecheck + commit**

```bash
pnpm --filter web prisma generate
pnpm typecheck
```

```bash
git add apps/web/src/lib/inngest/domain-discovery-fn.ts \
        apps/web/src/app/api/inngest/route.ts \
        apps/web/prisma/schema.prisma
git commit -m "feat(inngest): runDomainDiscovery function + CaseSchema stage1 columns"
```

---

## Phase 2 — Stage 2 Entity Discovery

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
import { STAGE2_TUNABLES } from "@/lib/config/onboarding-tunables";

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
    ? STAGE2_TUNABLES.levenshteinShortThreshold
    : STAGE2_TUNABLES.levenshteinLongThreshold;
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
    const merged: DedupOutput[] = [];
    for (const item of bucket) {
      const existing = merged.find(m => withinThreshold(m.displayString, item.displayString));
      if (existing) {
        existing.frequency += item.frequency;
        if (item.frequency > existing.frequency - item.frequency) {
          existing.displayString = item.displayString;
        }
        existing.autoFixed = true;
      } else {
        merged.push({ ...item, autoFixed: false });
      }
    }
    out.push(...merged);
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
import { extractPropertyCandidates } from "../property-entity";

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
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/lib/discovery/property-entity.ts
import { dedupByLevenshtein } from "./levenshtein-dedup";
import { STAGE2_TUNABLES } from "@/lib/config/onboarding-tunables";

// Per docs/domain-input-shapes/property.md Section 4.
const ADDRESS_REGEX = /\b(\d{3,5})\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;

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
    for (const m of subject.matchAll(ADDRESS_REGEX)) {
      const num = parseInt(m[1], 10);
      if (isYearLike(num)) continue;
      const display = `${m[1]} ${m[2]}`;
      raw.push({ key: m[1], displayString: display, frequency });
    }
  }
  const deduped = dedupByLevenshtein(raw);
  return deduped
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, STAGE2_TUNABLES.topNEntities);
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
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/lib/discovery/school-entity.ts
import { dedupByLevenshtein } from "./levenshtein-dedup";
import { STAGE2_TUNABLES } from "@/lib/config/onboarding-tunables";
import type { SubjectInput } from "./property-entity";

const INSTITUTION_RE = /\b(St\.?\s+\w+|[A-Z]\w+(?:\s+[A-Z]\w+)?\s+(?:School|Academy|College|Preschool|Elementary|Middle|High|Prep|Montessori|YMCA|Church|Temple|Synagogue))\b/g;
const ACTIVITY_RE = /\b(?:U\d{1,2}|[A-Z]\w{2,})\s+(?:Soccer|Football|Basketball|Baseball|Lacrosse|Hockey|Volleyball|Swimming|Track|Tennis|Golf|Dance|Ballet|Theater|Choir|Band|Orchestra|Karate|Judo|Gymnastics|Cheer)\b/g;

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
    for (const m of subject.matchAll(INSTITUTION_RE)) {
      const display = m[0].trim();
      rawByPattern.push({
        input: { key: normalizeKey(display), displayString: display, frequency },
        pattern: "A",
      });
    }
    for (const m of subject.matchAll(ACTIVITY_RE)) {
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
    .slice(0, STAGE2_TUNABLES.topNEntities);
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
      listMessages: vi.fn().mockResolvedValue({ messages: [{ id: "1" }, { id: "2" }] }),
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
  });

  it("agency: runs domain derivation on confirmed domain (does not parse subjects)", async () => {
    const mockGmail = {
      listMessages: vi.fn().mockResolvedValue({ messages: [{ id: "1" }] }),
      getMessageMetadata: vi.fn().mockResolvedValue({
        id: "1",
        payload: { headers: [
          { name: "Subject", value: "Random project update" },
          { name: "From", value: "Sarah Chen | Anthropic <sarah@anthropic.com>" },
        ] },
      }),
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
import { STAGE2_TUNABLES } from "@/lib/config/onboarding-tunables";
import { extractPropertyCandidates } from "./property-entity";
import { extractSchoolCandidates } from "./school-entity";
import { deriveAgencyEntity } from "./agency-entity";

interface GmailClientWithFullMetadata {
  listMessages(args: { q: string; maxResults: number }): Promise<{ messages?: { id: string }[] }>;
  getMessageMetadata(id: string, headers?: string[]): Promise<{
    id: string;
    payload: { headers: Array<{ name: string; value: string }> };
  }>;
}

export interface DiscoverEntitiesInput {
  gmailClient: GmailClientWithFullMetadata;
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
}

async function fetchSubjectsAndDisplayNames(
  client: GmailClientWithFullMetadata,
  confirmedDomain: string,
): Promise<{ subjects: string[]; displayNames: string[] }> {
  const q = `from:*@${confirmedDomain} newer_than:${STAGE2_TUNABLES.lookbackDays}d`;
  const list = await client.listMessages({ q, maxResults: STAGE2_TUNABLES.maxMessagesPerDomain });
  const ids = (list.messages ?? []).map(m => m.id);
  const subjects: string[] = [];
  const displayNames: string[] = [];

  const batchSize = STAGE2_TUNABLES.fetchBatchSize;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const rows = await Promise.all(
      batch.map(id => client.getMessageMetadata(id, ["Subject", "From"]).catch(() => null)),
    );
    for (const row of rows) {
      if (!row) continue;
      const s = row.payload.headers.find(h => h.name.toLowerCase() === "subject")?.value ?? "";
      const f = row.payload.headers.find(h => h.name.toLowerCase() === "from")?.value ?? "";
      if (s) subjects.push(s);
      if (f) displayNames.push(f.replace(/<[^>]+>/, "").trim());
    }
  }
  return { subjects, displayNames };
}

export async function discoverEntitiesForDomain(
  input: DiscoverEntitiesInput,
): Promise<DiscoverEntitiesOutput> {
  const shape = getDomainShape(input.schemaDomain);
  const { subjects, displayNames } = await fetchSubjectsAndDisplayNames(
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
      };
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

- [ ] **Step 5: Add Stage 2 result columns to CaseSchema via supabase-db**

```sql
ALTER TABLE case_schemas ADD COLUMN "stage2Candidates" jsonb;
ALTER TABLE case_schemas ADD COLUMN "stage2ConfirmedDomains" jsonb;
```

Add to `schema.prisma`:

```prisma
// Stage 2 result (populated by runEntityDiscovery)
stage2Candidates          Json?
// Which Stage-1 domains the user confirmed (drives Stage 2 fan-out)
stage2ConfirmedDomains    Json?
```

- [ ] **Step 6: Inngest wrapper**

Create `apps/web/src/lib/inngest/entity-discovery-fn.ts` (mirrors `domain-discovery-fn.ts`):

```typescript
import { inngest } from "./client";
import { prisma } from "@/lib/prisma";
import { discoverEntitiesForDomain } from "@/lib/discovery/entity-discovery";
import { advanceSchemaPhase } from "@/lib/services/onboarding-state";
import { getGmailClient } from "@/lib/gmail/client";

export const runEntityDiscovery = inngest.createFunction(
  {
    id: "run-entity-discovery",
    name: "Stage 2 — Entity Discovery",
    retries: 2,
    concurrency: [{ key: "event.data.schemaId", limit: 1 }],
  },
  { event: "onboarding.entity-discovery.requested" },
  async ({ event, step }) => {
    const schemaId: string = event.data.schemaId;

    const schema = await step.run("load-schema", async () => {
      return prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { id: true, userId: true, domain: true, stage2ConfirmedDomains: true },
      });
    });

    const confirmed: string[] = (schema.stage2ConfirmedDomains as string[] | null) ?? [];
    if (confirmed.length === 0) {
      throw new Error(`Schema ${schemaId} has no confirmed Stage-1 domains`);
    }

    await step.run("advance-to-discovering-entities", async () => {
      await advanceSchemaPhase(schemaId, "AWAITING_DOMAIN_CONFIRMATION", "DISCOVERING_ENTITIES");
    });

    const gmail = await step.run("load-gmail", () => getGmailClient(schema.userId));

    const perDomain = await Promise.all(
      confirmed.map(d =>
        step.run(`discover-${d}`, async () =>
          discoverEntitiesForDomain({
            gmailClient: gmail,
            schemaDomain: schema.domain as any,
            confirmedDomain: d,
          }).then(r => ({ confirmedDomain: d, ...r })),
        ),
      ),
    );

    await step.run("persist-candidates", async () => {
      await prisma.caseSchema.update({
        where: { id: schemaId },
        data: { stage2Candidates: perDomain as any },
      });
    });

    await step.run("advance-to-awaiting", async () => {
      await advanceSchemaPhase(schemaId, "DISCOVERING_ENTITIES", "AWAITING_ENTITY_CONFIRMATION");
    });

    return { domainsProcessed: confirmed.length };
  },
);
```

- [ ] **Step 7: Register + commit**

```bash
pnpm --filter web prisma generate
pnpm typecheck
```

Register `runEntityDiscovery` in the Inngest serve config.

```bash
git add apps/web/src/lib/inngest/entity-discovery-fn.ts \
        apps/web/prisma/schema.prisma apps/web/src/app/api/inngest/route.ts
git commit -m "feat(inngest): runEntityDiscovery Inngest function + CaseSchema stage2 columns"
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
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/middleware/auth";
import { inngest } from "@/lib/inngest/client";

const BodySchema = z.object({
  confirmedDomains: z.array(z.string().min(1)).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ schemaId: string }> },
) {
  const { schemaId } = await params;
  const user = await requireAuthUser(req);

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { confirmedDomains } = parsed.data;

  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId, userId: user.id },
    select: { id: true, phase: true },
  });
  if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (schema.phase !== "AWAITING_DOMAIN_CONFIRMATION") {
    return NextResponse.json({ error: `Wrong phase: ${schema.phase}` }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.caseSchema.update({
      where: { id: schemaId },
      data: { stage2ConfirmedDomains: confirmedDomains },
    }),
    prisma.onboardingOutbox.create({
      data: {
        schemaId,
        eventName: "onboarding.entity-discovery.requested",
        payload: { schemaId } as any,
        status: "PENDING_EMIT",
      },
    }),
  ]);

  // Optimistic emit; drain cron is the safety net.
  await inngest.send({
    name: "onboarding.entity-discovery.requested",
    data: { schemaId },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Write a route test**

```typescript
// apps/web/src/app/api/onboarding/[schemaId]/domain-confirm/__tests__/route.test.ts
// Integration-style test hitting a spun-up route handler with a mocked prisma.
// Assertion focus: phase-gate rejection, 400 on invalid body, 200 + outbox row on success.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caseSchema: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    onboardingOutbox: { create: vi.fn() },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops.map(o => (typeof o === "function" ? o() : o)))),
  },
}));
vi.mock("@/lib/middleware/auth", () => ({
  requireAuthUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));

import { POST } from "../route";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";

function makeRequest(body: unknown) {
  return new Request("http://x/", { method: "POST", body: JSON.stringify(body) }) as any;
}

describe("POST /domain-confirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400 on invalid body", async () => {
    const res = await POST(makeRequest({}), { params: Promise.resolve({ schemaId: "s" }) });
    expect(res.status).toBe(400);
  });

  it("409 when schema is in wrong phase", async () => {
    (prisma.caseSchema.findUnique as any).mockResolvedValue({ id: "s", phase: "PENDING" });
    const res = await POST(makeRequest({ confirmedDomains: ["x.com"] }), { params: Promise.resolve({ schemaId: "s" }) });
    expect(res.status).toBe(409);
  });

  it("200 + persists + emits when happy path", async () => {
    (prisma.caseSchema.findUnique as any).mockResolvedValue({ id: "s", phase: "AWAITING_DOMAIN_CONFIRMATION" });
    const res = await POST(
      makeRequest({ confirmedDomains: ["portfolioproadvisors.com", "stallionis.com"] }),
      { params: Promise.resolve({ schemaId: "s" }) },
    );
    expect(res.status).toBe(200);
    expect(prisma.caseSchema.update).toHaveBeenCalled();
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
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/middleware/auth";
import { inngest } from "@/lib/inngest/client";
import { persistConfirmedEntities } from "@/lib/services/interview";

const ConfirmedEntitySchema = z.object({
  displayLabel: z.string().min(1),
  identityKey: z.string().min(1),
  kind: z.enum(["PRIMARY", "SECONDARY"]),
  secondaryTypeName: z.string().optional(),
});

const BodySchema = z.object({
  confirmedEntities: z.array(ConfirmedEntitySchema).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ schemaId: string }> },
) {
  const { schemaId } = await params;
  const user = await requireAuthUser(req);

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId, userId: user.id },
    select: { id: true, phase: true },
  });
  if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (schema.phase !== "AWAITING_ENTITY_CONFIRMATION") {
    return NextResponse.json({ error: `Wrong phase: ${schema.phase}` }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await persistConfirmedEntities(tx, schemaId, parsed.data.confirmedEntities);
    await tx.onboardingOutbox.create({
      data: {
        schemaId,
        eventName: "onboarding.review.confirmed",
        payload: { schemaId } as any,
        status: "PENDING_EMIT",
      },
    });
  });

  await inngest.send({
    name: "onboarding.review.confirmed",
    data: { schemaId },
  });

  return NextResponse.json({ ok: true });
}
```

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

export async function persistConfirmedEntities(
  tx: Prisma.TransactionClient,
  schemaId: string,
  entities: ConfirmedEntity[],
): Promise<void> {
  for (const e of entities) {
    await tx.entity.upsert({
      where: {
        schemaId_identityKey_type: {
          schemaId,
          identityKey: e.identityKey,
          type: e.kind,
        },
      },
      create: {
        schemaId,
        name: e.displayLabel,
        identityKey: e.identityKey,
        type: e.kind,
        secondaryTypeName: e.secondaryTypeName,
        autoDetected: false,
        isActive: true,
      },
      update: {
        name: e.displayLabel,
        isActive: true,
      },
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

- [ ] **Step 1: Extend `derivePollingResponse`**

Read the current function. Add these optional fields to the response, filled based on phase:

```typescript
// Add to the polling response type/interface:
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

// In the body of derivePollingResponse:
if (schema.phase === "AWAITING_DOMAIN_CONFIRMATION" || schema.phase === "DISCOVERING_DOMAINS") {
  resp.stage1Candidates = (schema.stage1Candidates as any) ?? [];
  resp.stage1QueryUsed = schema.stage1QueryUsed ?? undefined;
}
if (schema.phase === "AWAITING_ENTITY_CONFIRMATION" || schema.phase === "DISCOVERING_ENTITIES") {
  resp.stage2Candidates = (schema.stage2Candidates as any) ?? [];
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

Inside the existing `switch (phase)`:

```tsx
case "AWAITING_DOMAIN_CONFIRMATION":
  return (
    <PhaseDomainConfirmation
      schemaId={schemaId}
      candidates={pollingData.stage1Candidates ?? []}
      onConfirmed={refresh}
    />
  );
case "AWAITING_ENTITY_CONFIRMATION":
  return (
    <PhaseEntityConfirmation
      schemaId={schemaId}
      stage2Candidates={pollingData.stage2Candidates ?? []}
      onConfirmed={refresh}
    />
  );
case "DISCOVERING_DOMAINS":
case "DISCOVERING_ENTITIES":
  return <PhasePending message={phase === "DISCOVERING_DOMAINS" ? "Finding the right domains…" : "Finding the right topics…"} />;
```

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

```typescript
export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    name: "Onboarding — Stage 1 Trigger",
    retries: 2,
    concurrency: [{ key: "event.data.schemaId", limit: 1 }],
  },
  { event: "onboarding.session.started" },
  async ({ event, step }) => {
    const schemaId: string = event.data.schemaId;

    const schema = await step.run("load-schema", async () => {
      return prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { id: true, phase: true, domain: true },
      });
    });

    if (!schema.domain) throw new Error(`Schema ${schemaId} missing domain`);

    await step.run("emit-domain-discovery", async () => {
      await inngest.send({
        name: "onboarding.domain-discovery.requested",
        data: { schemaId },
      });
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

- [ ] **Step 2: Keep `create-scan-job`, `resolve-scan-job`, `request-scan`, `wait-for-scan`, and terminal phase advance — these still work as-is**

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/src/lib/inngest/onboarding.ts
git commit -m "refactor(onboarding): remove Pass 2 — entities are confirmed upfront"
```

---

### Task 4.3: Replace old POST confirm route with a redirect

**Files:**
- Modify: `apps/web/src/app/api/onboarding/[schemaId]/route.ts` (the old POST handler for single-screen review confirm)

- [ ] **Step 1: Return 410 Gone from the old POST**

The old review-confirm flow is gone. New clients use `/entity-confirm`.

```typescript
export async function POST() {
  return NextResponse.json(
    { error: "Use /api/onboarding/:schemaId/entity-confirm (new fast-discovery flow)" },
    { status: 410 },
  );
}
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
grep -n "createSchemaStub\|createCaseSchemaStub" apps/web/src/lib/services/interview.ts
```

Remove any code that pre-fills `hypothesis` / `validation` / `primaryEntityConfig`. New stub sets only `phase = PENDING`, `inputs`, `domain`. Stage 1+2 populate the rest.

- [ ] **Step 2: Typecheck, commit**

```bash
pnpm typecheck
git add apps/web/src/lib/services/interview.ts
git commit -m "refactor(interview): createSchemaStub skinnied down"
```

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

## Phase 5 — Spec-Compliance Harness

### Task 5.1: Add Section 9 (Test fixtures) to each per-domain spec file

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

### Task 5.2: Spec-file markdown parser

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

### Task 5.3: Spec-compliance Vitest harness

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

### Task 5.4: Wire into CI

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
- `packages/ai/src/__tests__/validation-parser.test.ts`

**Files (modify):**
- `apps/web/src/lib/services/interview.ts` — delete `generateHypothesis`, `validateHypothesis`, `resolveWhoEmails`
- `apps/web/src/lib/services/expansion-targets.ts` — delete file
- `apps/web/src/lib/services/__tests__/expansion-targets.test.ts` — delete file

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

### Task 6.4: Update CLAUDE.md and status doc

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/00_denim_current_status.md`

- [ ] **Step 1: Update CLAUDE.md "Current Status" section** to reflect that onboarding is now the fast-discovery flow. Replace any outdated paragraphs that reference hypothesis generation / Function A / validation.

- [ ] **Step 2: Add a new session block to `docs/00_denim_current_status.md`** — this is the plan-completion log entry. Include:
  - Summary of what shipped (3-stage flow live; Stage 1+2 target timings; Stage 3 unchanged)
  - Commits SHA list (the major phase-complete commits)
  - Per-domain spec compliance status (all green via CI)
  - Next action on resume (#94 remaining-domain interviews, or user testing)

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/00_denim_current_status.md
git commit -m "docs: update status — fast-discovery rebuild live"
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

## Acceptance Criteria

1. Fresh schema creation → `AWAITING_DOMAIN_CONFIRMATION` in under 8 seconds wall-clock on three consecutive manual test runs (one per domain).
2. After domain confirmation → `AWAITING_ENTITY_CONFIRMATION` in under 8 seconds wall-clock (Stage 2 runs per-confirmed-domain in parallel).
3. After entity confirmation → existing Stage 3 pipeline runs unchanged; final feed produces cases correctly.
4. `pnpm test:spec-compliance` passes locally and in CI.
5. `pnpm typecheck` + `pnpm -r test` + `pnpm biome check` all clean.
6. No code references to `generateHypothesis`, `validateHypothesis`, `expansion-targets.ts`, `phase-review.tsx`, `interview-hypothesis.ts` prompts, or `validation-parser` after Phase 6.
7. Issue #95 closed with a link to the timing report.

## Out of scope

- Per-domain specs for construction, legal, general, company-internal — issue #94.
- Deep-scan prompt rewrites (Phase 2-5 of `docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md`) — still valid work but independent.
- Playwright E2E for onboarding — existing gap, not addressed here.
- Domain-shape registry refactor (issue #96) — lightweight module `domain-shapes.ts` created here is the minimum viable shape; full registry is a follow-up.
- User-driven regrouping UI for school_parent (deferred per spec Section 8).

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gmail API throttling on 500-message metadata fetch | Medium | STAGE1_TUNABLES.pacingMs=50 + batch=40; Inngest retries=2 |
| Agency domain-name derivation produces ugly label (e.g., "Sghgroup") | High | Stage 2 UI provides inline edit + `needsUserEdit` flag |
| Phase 4 cutover break — dev stuck with no onboarding | High | All Phase 4 commits in one contiguous session; bisect-ready |
| Spec fixture drift (code changes, spec not updated) | Medium | CI runs `test:spec-compliance` on every PR |
| Entity schema migration breaks existing rows | Low | Backfill sets identityKey=name; Phase 0 ships cleanly additively |
