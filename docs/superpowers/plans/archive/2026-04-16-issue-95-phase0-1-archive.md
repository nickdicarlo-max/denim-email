# Issue #95 — Phase 0 + Phase 1 Task-Level Archive

**Archived:** 2026-04-17. Extracted from `docs/superpowers/plans/2026-04-16-issue-95-fast-discovery-rebuild.md` (commit `323ea9f`) after Phase 0 + Phase 1 code landed on `feature/perf-quality-sprint` (11 commits, `0f3e991`..`96ff38d`).

**Why archived:** Phase 0 + Phase 1 are code-complete. Task-level detail was removed from the main plan to keep it ingestable (5,375 → ~4,100 lines). This file is the verbatim original, preserved for archaeology — e.g., if you need to know why a design decision was made, what tests were planned, or what the original commit message was.

**⚠️ Stale-signature warning:** several code samples below use API names the codebase doesn't use (`STAGE1_TUNABLES`, `STAGE2_TUNABLES`, `isGmailAuthError`, positional `advanceSchemaPhase`, 2-arg `markSchemaFailed`). These were *plan* names, not *code* names. Phase 0 + Phase 1 implementation correctly used the existing codebase conventions (`ONBOARDING_TUNABLES.stage1` / `.stage2`, `matchesGmailAuthError`, `advanceSchemaPhase({opts})`, 3-arg `markSchemaFailed`). Do NOT copy these signatures into new code. See `docs/superpowers/plans/2026-04-17-issue-95-phase2-plus-corrections.md` for the full list of name corrections and the canonical signatures.

**What's here:**
- Task 0.1 — Extend `SchemaPhase` enum
- Task 0.2 — Add `identityKey` column to Entity
- Task 0.3 — Create per-domain config module (`domain-shapes.ts`)
- Task 0.4 — Extend `onboarding-tunables.ts` with `stage1` / `stage2` groups
- Task 1.1 — `public-providers.ts` constant
- Task 1.2 — `GmailClient.getMessageMetadata` + `fetchFromHeaders`
- Task 1.3 — `domain-aggregator.ts`
- Task 1.4 — `buildStage1Query` + `discoverDomains` entry
- Task 1.5 — Integration test for `discoverDomains`
- Task 1.6 — Inngest `runDomainDiscovery` wrapper
- Task 1.6b — InterviewService writers (`writeStage1Result`, `writeStage2Result`, `writeStage2ConfirmedDomains`)

**Commit mapping:**
- Task 0.1 → `0f3e991`
- Task 0.2 → `5ff6cfe`
- Task 0.3 → `e3242be`
- Task 0.4 → `dafc373`
- Task 1.1 → `8e2964e`
- Task 1.2 → `d383de6` + `487040f` (token-leak fix)
- Task 1.3 → `5fe2a89`
- Task 1.4 → `a6d9ab5`
- Task 1.5 → `aa940e1`
- Task 1.6 + 1.6b → `96ff38d`

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

- [ ] **Step 2: Add `stage1` and `stage2` groups under `ONBOARDING_TUNABLES`**

Nest under the existing object — do NOT introduce top-level `STAGE1_TUNABLES` / `STAGE2_TUNABLES` exports (which would break the existing pattern of "all onboarding knobs under one object"). Shared values like `fetchBatchSize` and `lookbackDays` are only specified once:

```typescript
// edit apps/web/src/lib/config/onboarding-tunables.ts — add these two groups
// inside the existing ONBOARDING_TUNABLES object.

// Inside ONBOARDING_TUNABLES, after `pass2`:

  /**
   * Fast-discovery Stage 1 — domain detection from From-headers (issue #95).
   * Target: < 5s wall for 500 emails. All metadata-only; no bodies, no AI.
   */
  stage1: {
    /** Max Gmail message IDs to fetch metadata for in a single Stage 1 pass. */
    maxMessages: 500,
    /** Parallel batch size for the metadata fetch. */
    fetchBatchSize: 40,
    /** Lookback window passed to the Gmail `newer_than:` qualifier. */
    lookbackDays: 365,
    /** Gmail API pacing between batches, in milliseconds. */
    pacingMs: 50,
  },

  /**
   * Fast-discovery Stage 2 — entity detection from per-domain subjects (issue #95).
   * Target: < 6s wall per confirmed domain; fan-out runs in parallel.
   */
  stage2: {
    /** Max Gmail message IDs to fetch per confirmed Stage-1 domain. */
    maxMessagesPerDomain: 500,
    /** Top N candidate entities to surface per confirmed domain. */
    topNEntities: 20,
    /** Levenshtein threshold for short strings (≤6 chars). */
    levenshteinShortThreshold: 1,
    /** Levenshtein threshold for longer strings. */
    levenshteinLongThreshold: 2,
    // fetchBatchSize + lookbackDays intentionally omitted — Stage 2 reuses
    // ONBOARDING_TUNABLES.stage1's values. One source of truth, no drift.
  },
```

Update consumers to read `ONBOARDING_TUNABLES.stage1.maxMessages`, `ONBOARDING_TUNABLES.stage2.topNEntities`, etc. Everywhere this plan references `STAGE1_TUNABLES.X` or `STAGE2_TUNABLES.X`, substitute the nested form. (The code blocks earlier in this plan use the old names — they were placeholder shorthand; the real implementation dereferences `ONBOARDING_TUNABLES.stage1` / `.stage2`.)

- [ ] **Step 3: Extend existing test file or create one**

Add cases to `apps/web/src/lib/config/__tests__/onboarding-tunables.test.ts` (or create):

```typescript
import { describe, it, expect } from "vitest";
import { ONBOARDING_TUNABLES } from "../onboarding-tunables";

describe("stage1/stage2 tunables", () => {
  it("stage1 maxMessages is 500 per the cross-domain preamble", () => {
    expect(ONBOARDING_TUNABLES.stage1.maxMessages).toBe(500);
  });

  it("stage2 topNEntities is 20 per the cross-domain preamble", () => {
    expect(ONBOARDING_TUNABLES.stage2.topNEntities).toBe(20);
  });

  it("Levenshtein thresholds match spec (1 short, 2 long)", () => {
    expect(ONBOARDING_TUNABLES.stage2.levenshteinShortThreshold).toBe(1);
    expect(ONBOARDING_TUNABLES.stage2.levenshteinLongThreshold).toBe(2);
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

### Task 1.2: Extend `GmailClient` with a metadata-only helper + implement `gmail-metadata-fetch.ts`

**Files:**
- Modify: `apps/web/src/lib/gmail/client.ts` — the existing class exposes `searchEmails(query, maxResults)` and `getEmailFull(messageId)` but **no metadata-only fetch**. Add a new method `getMessageMetadata(messageId, headerNames)` that calls the Gmail REST API with `format=metadata&metadataHeaders=From,Subject` so Stage 1 doesn't pull bodies.
- Create: `apps/web/src/lib/discovery/gmail-metadata-fetch.ts`
- Create: `apps/web/src/lib/discovery/__tests__/gmail-metadata-fetch.test.ts`

Responsibility: given a `GmailClient` + query string + limit, return `{ results: FromHeaderResult[]; errorCount: number; firstError?: string }`. Uses `format: 'metadata'` and batches in parallel per STAGE1_TUNABLES.fetchBatchSize. Per-message errors are counted, not swallowed (Bug 2 / 2026-04-09 lesson).

- [ ] **Step 1: Write the test (with mocked Gmail client)**

```typescript
// apps/web/src/lib/discovery/__tests__/gmail-metadata-fetch.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchFromHeaders } from "../gmail-metadata-fetch";

function makeClient(ids: string[], metadata: Record<string, string>, failingIds: Set<string> = new Set()) {
  return {
    searchEmails: vi.fn(async () => ids),
    getMessageMetadata: vi.fn(async (id: string) => {
      if (failingIds.has(id)) throw new Error("429 rate limit");
      return {
        id,
        payload: { headers: [{ name: "From", value: metadata[id] ?? "" }] },
      };
    }),
  };
}

describe("fetchFromHeaders", () => {
  it("returns From header for each message ID", async () => {
    const client = makeClient(
      ["m1", "m2", "m3"],
      { m1: "Sender 1 <s1@example.com>", m2: "<s2@example.com>", m3: "<s3@example.com>" },
    );
    const out = await fetchFromHeaders(client as any, "subject:test", 100);
    expect(out.results).toHaveLength(3);
    expect(out.errorCount).toBe(0);
    expect(out.messagesRequested).toBe(3);
    expect(client.getMessageMetadata).toHaveBeenCalledTimes(3);
  });

  it("returns empty when search finds nothing", async () => {
    const client = makeClient([], {});
    const out = await fetchFromHeaders(client as any, "q", 100);
    expect(out.results).toEqual([]);
    expect(out.messagesRequested).toBe(0);
    expect(client.getMessageMetadata).not.toHaveBeenCalled();
  });

  it("counts per-message failures instead of swallowing them", async () => {
    const client = makeClient(
      ["m1", "m2", "m3"],
      { m1: "<a@x.com>", m2: "<b@x.com>", m3: "<c@x.com>" },
      new Set(["m2"]),
    );
    const out = await fetchFromHeaders(client as any, "q", 100);
    expect(out.results).toHaveLength(2);
    expect(out.errorCount).toBe(1);
    expect(out.firstError).toMatch(/rate limit/);
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
import type { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";

export interface FromHeaderResult {
  messageId: string;
  fromHeader: string;
}

export interface FetchFromHeadersResult {
  results: FromHeaderResult[];
  errorCount: number;
  firstError?: string;
  messagesRequested: number;
}

/**
 * Fetch the From header for up to `limit` messages matching `query`.
 * Uses format: 'metadata' — no body bytes, no attachments, minimal network.
 * Batches in parallel per STAGE1_TUNABLES.fetchBatchSize.
 * Per-message errors are counted and returned, not swallowed (Bug 2, 2026-04-09).
 */
export async function fetchFromHeaders(
  client: GmailClient,
  query: string,
  limit: number = STAGE1_TUNABLES.maxMessages,
): Promise<FetchFromHeadersResult> {
  const ids = await client.searchEmails(query, limit);
  if (ids.length === 0) {
    return { results: [], errorCount: 0, messagesRequested: 0 };
  }

  const results: FromHeaderResult[] = [];
  let errorCount = 0;
  let firstError: string | undefined;
  const batchSize = STAGE1_TUNABLES.fetchBatchSize;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const resolved = await Promise.all(
      batch.map(async (id) => {
        try {
          const msg = await client.getMessageMetadata(id, ["From"]);
          const from = msg.payload.headers.find(h => h.name.toLowerCase() === "from")?.value ?? "";
          return { messageId: id, fromHeader: from };
        } catch (err) {
          errorCount++;
          if (!firstError) {
            // Strip PII before persisting to logs — Gmail error messages may
            // include message IDs, address fragments, or token snippets.
            // Keep only error name + HTTP status code if present.
            const name = err instanceof Error ? err.name : "Error";
            const status = err instanceof Error ? (err.message.match(/\b[45]\d\d\b/)?.[0] ?? "") : "";
            firstError = status ? `${name}:${status}` : name;
          }
          return null;
        }
      }),
    );
    for (const r of resolved) if (r) results.push(r);
    if (STAGE1_TUNABLES.pacingMs > 0 && i + batchSize < ids.length) {
      await new Promise(resolve => setTimeout(resolve, STAGE1_TUNABLES.pacingMs));
    }
  }

  if (errorCount > 0) {
    const rate = errorCount / ids.length;
    const level = rate > 0.1 ? "error" : "warn";
    logger[level]({
      service: "gmail-metadata-fetch",
      operation: "fetchFromHeaders",
      errorCount,
      messagesRequested: ids.length,
      errorRate: rate,
      firstError,
    }, "Gmail metadata fetch had errors");
  }

  return { results, errorCount, firstError, messagesRequested: ids.length };
}
```

- [ ] **Step 4: Add `getMessageMetadata` method to `GmailClient`**

The existing `GmailClient` class (`apps/web/src/lib/gmail/client.ts`) exposes `searchEmails(query, maxResults)` and `getEmailFull(messageId)` but has no metadata-only fetch. Add this method (patterned on `getEmailFull` but calling `format=metadata`):

```typescript
// in GmailClient class
//
// Requires only gmail.readonly scope (format=metadata does not pull bodies or
// attachments). DO NOT change to format=full — it elevates to reading bodies.
async getMessageMetadata(
  messageId: string,
  headerNames: string[] = ["From", "Subject"],
): Promise<{ id: string; payload: { headers: Array<{ name: string; value: string }> } }> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`);
  url.searchParams.set("format", "metadata");
  for (const h of headerNames) url.searchParams.append("metadataHeaders", h);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${this.accessToken}` },
  });
  if (!res.ok) {
    // Intentionally do NOT include res.text() here: 401/403 responses from
    // Gmail can echo the request (including the Authorization header on some
    // proxies), and this Error message lands in logs and is persisted via
    // markSchemaFailed. Log the status only; the response body is discarded.
    throw new Error(`Gmail metadata fetch failed: ${res.status}`);
  }
  return res.json();
}
```

Update the test in Step 1 to use a `GmailClient` mock that exposes `searchEmails` + `getMessageMetadata`, and assert the new return shape `{ results, errorCount, messagesRequested }`.

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

export async function discoverDomains(input: DiscoverDomainsInput): Promise<DiscoverDomainsOutput & { errorCount: number }> {
  const shape = getDomainShape(input.domain);
  const query = buildStage1Query(input.domain, STAGE1_TUNABLES.lookbackDays);
  const fetched = await fetchFromHeaders(input.gmailClient, query, STAGE1_TUNABLES.maxMessages);
  const candidates = aggregateDomains(fetched.results, {
    userDomain: input.userDomain,
    topN: shape.stage1TopN,
  });
  return {
    candidates,
    messagesSeen: fetched.results.length,
    queryUsed: query,
    errorCount: fetched.errorCount,
  };
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
    searchEmails: vi.fn(async () => ids),
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
import { writeStage1Result } from "@/lib/services/interview";
import { loadGmailTokens } from "@/lib/services/gmail-tokens";
import { GmailClient } from "@/lib/gmail/client";
import { isGmailAuthError } from "@/lib/gmail/auth-errors";

/**
 * Stage 1: domain discovery. Fires when a schema enters PENDING→DISCOVERING_DOMAINS.
 * Writes result to CaseSchema.stage1Candidates via InterviewService (single-writer rule:
 * CaseSchema is owned by InterviewService per engineering-practices.md).
 *
 * Owns CAS transitions:
 *   PENDING → DISCOVERING_DOMAINS
 *   DISCOVERING_DOMAINS → AWAITING_DOMAIN_CONFIRMATION
 *
 * Concurrency: per-schema limit 1 + global limit 20 to protect the project-wide Gmail
 * 10,000 req / 100 sec cap (scalability.md "Gmail API Quota Management").
 * Priority: 120 (interactive — user watching spinner; beats background Stage 3
 * extraction for other users, which is priority 0 by default).
 */
export const runDomainDiscovery = inngest.createFunction(
  {
    id: "run-domain-discovery",
    name: "Stage 1 — Domain Discovery",
    retries: 2,
    priority: { run: "120" },
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { limit: 20 },
    ],
  },
  { event: "onboarding.domain-discovery.requested" },
  async ({ event, step }) => {
    const schemaId: string = event.data.schemaId;

    try {
      // Load schema + advance to DISCOVERING_DOMAINS in one step — each step.run
      // is a roundtrip to Inngest storage (~50-150ms). Advance is a single UPDATE
      // and doesn't need to be independently memoized.
      const schema = await step.run("load-and-start", async () => {
        const s = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { id: true, userId: true, domain: true, phase: true, inputs: true },
        });
        if (!s.domain) throw new Error(`Schema ${schemaId} missing domain`);
        await advanceSchemaPhase(schemaId, "PENDING", "DISCOVERING_DOMAINS");
        return s;
      });

      const result = await step.run("discover", async () => {
        const tokens = await loadGmailTokens(schema.userId);
        const gmail = new GmailClient(tokens.accessToken);
        const inputs = schema.inputs as { userEmail?: string } | null;
        const userDomain = (inputs?.userEmail ?? "").split("@")[1]?.toLowerCase() ?? "";
        return discoverDomains({
          gmailClient: gmail,
          domain: schema.domain as any,
          userDomain,
        });
      });

      // Persist + advance in one step for the same reason.
      await step.run("persist-and-advance", async () => {
        await writeStage1Result(schemaId, {
          candidates: result.candidates,
          queryUsed: result.queryUsed,
          messagesSeen: result.messagesSeen,
          errorCount: result.errorCount,
        });
        await advanceSchemaPhase(schemaId, "DISCOVERING_DOMAINS", "AWAITING_DOMAIN_CONFIRMATION");
      });

      return { candidates: result.candidates.length, errorCount: result.errorCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const authFailed = isGmailAuthError(message);
      await step.run("mark-failed", async () => {
        await markSchemaFailed(schemaId, authFailed ? `GMAIL_AUTH: ${message}` : message);
      });
      throw err;
    }
  },
);
```

**Note on `writeStage1Result`:** this new InterviewService method is the sole writer to `CaseSchema.stage1Candidates` / `stage1QueryUsed` / `stage1MessagesSeen` / `stage1ErrorCount`. See Task 1.6b below. Gmail call volume is observed via structured logs (the `fetchFromHeaders` warn/error logs); it is NOT routed through `ExtractionCost` because that table is for token-priced AI calls, not flat-rate Gmail API usage.

- [ ] **Step 3: Add the four new CaseSchema columns via supabase-db skill**

```sql
ALTER TABLE case_schemas ADD COLUMN "stage1Candidates" jsonb;
ALTER TABLE case_schemas ADD COLUMN "stage1QueryUsed" text;
ALTER TABLE case_schemas ADD COLUMN "stage1MessagesSeen" integer;
ALTER TABLE case_schemas ADD COLUMN "stage1ErrorCount" integer;
```

And add the matching fields to `CaseSchema` in `schema.prisma`:

```prisma
// Stage 1 result (populated by Inngest runDomainDiscovery via InterviewService)
stage1Candidates    Json?
stage1QueryUsed     String?
stage1MessagesSeen  Int?
stage1ErrorCount    Int?
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

### Task 1.6b: InterviewService writers for Stage 1/Stage 2 (single-writer rule)

**Files:**
- Modify: `apps/web/src/lib/services/interview.ts`

engineering-practices.md line 14 assigns `CaseSchema` ownership to InterviewService. Inngest functions must not write `CaseSchema` columns directly. Add these exports:

```typescript
// apps/web/src/lib/services/interview.ts

export interface Stage1Result {
  candidates: Array<{ domain: string; count: number }>;
  queryUsed: string;
  messagesSeen: number;
  errorCount: number;
}

export async function writeStage1Result(schemaId: string, result: Stage1Result): Promise<void> {
  await prisma.caseSchema.update({
    where: { id: schemaId },
    data: {
      stage1Candidates: result.candidates as any,
      stage1QueryUsed: result.queryUsed,
      stage1MessagesSeen: result.messagesSeen,
      stage1ErrorCount: result.errorCount,
    },
  });
}

export interface Stage2Result {
  perDomain: Array<{
    confirmedDomain: string;
    algorithm: string;
    subjectsScanned: number;
    candidates: unknown[];
    errorCount: number;
  }>;
}

export async function writeStage2Result(schemaId: string, result: Stage2Result): Promise<void> {
  await prisma.caseSchema.update({
    where: { id: schemaId },
    data: { stage2Candidates: result.perDomain as any },
  });
}

export async function writeStage2ConfirmedDomains(
  tx: Prisma.TransactionClient,
  schemaId: string,
  confirmedDomains: string[],
): Promise<number> {
  // Returns the number of rows updated (0 = phase-gate failed).
  const { count } = await tx.caseSchema.updateMany({
    where: { id: schemaId, phase: "AWAITING_DOMAIN_CONFIRMATION" },
    data: { stage2ConfirmedDomains: confirmedDomains as any, phase: "DISCOVERING_ENTITIES" },
  });
  return count;
}
```

- [ ] **Step 1: Add the three exports, run tests**

```bash
pnpm --filter web test -- interview
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/services/interview.ts
git commit -m "feat(interview): writeStage1Result / writeStage2Result / writeStage2ConfirmedDomains"
```

Note: `writeStage2ConfirmedDomains` does a **CAS-style `updateMany`** and returns a count — the `/domain-confirm` route uses that count to detect TOCTOU (issue #33 pattern). The same function also **advances the phase** in the same row update, so the route does not need a separate `advanceSchemaPhase` call.
