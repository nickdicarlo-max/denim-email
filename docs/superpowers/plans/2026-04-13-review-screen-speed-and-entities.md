# Review Screen Speed + Entity Grouping Implementation Plan - FULLY SHIPPED

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut onboarding review screen wait from 72s to under 30s, and show discovered SECONDARY entities grouped under the user's entered topics so they're actually reviewable.

**Architecture:** Three changes working together: (1) Pass 1 validation shrinks to 100 emails bounded to the last 8 weeks. (2) Pass 2 domain expansion moves out of the review-blocking path into Function B (post-confirm), and its expansion targets are smarter — corporate domains expand by domain, generic providers (gmail/yahoo/etc.) expand by full sender address. (3) The validation prompt adds `relatedUserThing` to each discovered entity so the review screen can group them under the right topic.

**Tech Stack:** Next.js 16 (App Router), Inngest 4, Prisma 7, Claude SDK, Gmail API via googleapis, Zod 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-04-13-review-screen-speed-and-entities-design.md`

---

## File Structure

**New files:**
- `apps/web/src/lib/config/onboarding-tunables.ts` — centralized tunables for sample sizes, lookback windows, caps
- `apps/web/src/lib/services/expansion-targets.ts` — `extractExpansionTargets` helper that returns domain-vs-sender expansion rules
- `packages/ai/src/parsers/validation-parser.test.ts` — parser tests (if not already present, add; otherwise extend)

**Modified files:**
- `packages/ai/src/prompts/interview-validate.ts` — add `relatedUserThing` field, add `userThings` parameter
- `packages/ai/src/parsers/validation-parser.ts` — add `relatedUserThing` to Zod schema
- `packages/types/src/schema.ts` — add `relatedUserThing` to `HypothesisValidation.discoveredEntities` item type
- `apps/web/src/lib/services/interview.ts` — pass `userThings` to `buildValidationPrompt`; keep `GENERIC_SENDER_DOMAINS` export
- `apps/web/src/lib/gmail/client.ts` — extend `sampleScan` to accept an optional `newerThan` parameter
- `apps/web/src/lib/inngest/onboarding.ts` — Function A: shrink Pass 1, remove Pass 2 loop. Function B: add `expand-confirmed-domains` step.
- `apps/web/src/lib/services/discovery.ts` — replace hardcoded constants with config imports
- `apps/web/src/components/onboarding/review-entities.tsx` — restructure filtering, rename section, unify Discoveries
- `apps/web/src/components/onboarding/phase-review.tsx` — add `relatedUserThing` to `EntityData` interface; thread through
- `apps/web/scripts/diagnose-hypothesis.ts` — already fixed `name` vs `displayName`; add `confirmedTags`, add note about discovery queries being written at confirm time

---

## Task 1: Centralized Onboarding Tunables Config

**Files:**
- Create: `apps/web/src/lib/config/onboarding-tunables.ts`

- [ ] **Step 1: Create the config file**

```typescript
// apps/web/src/lib/config/onboarding-tunables.ts

/**
 * Centralized tunables for the onboarding pipeline.
 *
 * Edit these values to change sample sizes, lookback windows, and caps
 * without hunting through service/Inngest files. Keep changes here small
 * and intentional — every knob here affects end-user wait time and AI
 * spend.
 */
export const ONBOARDING_TUNABLES = {
  /**
   * Pass 1: broad random sample used to generate the review screen.
   * Runs inside Function A (blocks the user on the "Setting up your topic"
   * spinner). Keep small — every email here goes through Claude.
   */
  pass1: {
    /** Random-sample size before the review screen. Was 200. */
    sampleSize: 100,
    /** Gmail `newer_than:` constraint. Was unbounded. */
    lookback: "56d",
  },

  /**
   * Pass 2: targeted expansion after the user confirms entities. Runs
   * inside Function B, so the user is no longer waiting on a spinner.
   * Emails here are pre-filtered by a confirmed entity's domain or
   * sender address, so Gemini sees high-prior-probability content.
   */
  pass2: {
    /** Max number of expansion targets (domains OR specific senders) to query. */
    maxTargetsToExpand: 5,
    /** Max emails to pull per expansion target. */
    emailsPerTarget: 200,
    /** Gmail `newer_than:` constraint. */
    lookback: "56d",
  },

  /**
   * Full discovery scan (runs inside `runScan` via
   * `apps/web/src/lib/services/discovery.ts`). These values were the
   * previously-hardcoded `DISCOVERY_LOOKBACK` and `MAX_DISCOVERY_EMAILS`.
   */
  discovery: {
    lookback: "56d",
    maxTotalEmails: 200,
  },
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/config/onboarding-tunables.ts
git commit -m "feat(onboarding): centralized tunables config for sample sizes and lookback windows"
```

---

## Task 2: Update `HypothesisValidation` type for `relatedUserThing`

**Files:**
- Modify: `packages/types/src/schema.ts:354-367`

- [ ] **Step 1: Add `relatedUserThing` to discoveredEntities item**

Find the existing `HypothesisValidation` interface and add the field:

```typescript
// packages/types/src/schema.ts (around lines 354-367)
export interface HypothesisValidation {
  confirmedEntities: string[];
  discoveredEntities: {
    name: string;
    type: "PRIMARY" | "SECONDARY";
    secondaryTypeName: string | null;
    confidence: number;
    source: string;
    emailCount?: number;
    emailIndices?: number[];
    likelyAliasOf?: string | null;
    aliasConfidence?: number | null;
    aliasReason?: string | null;
    /**
     * Name of the user-entered WHAT this entity most relates to (e.g.,
     * "soccer"), or null if no single clear association. Used by the
     * review screen to group discoveries under the right topic.
     */
    relatedUserThing?: string | null;
  }[];
  confirmedTags: string[];
  suggestedTags: {
    name: string;
    description: string;
    expectedFrequency: string;
    isActionable: boolean;
  }[];
  noisePatterns: string[];
  sampleEmailCount: number;
  scanDurationMs: number;
  confidenceScore: number;
}
```

- [ ] **Step 2: Typecheck types package**

Run: `pnpm --filter @denim/types typecheck`
Expected: PASS (no errors). If the script doesn't exist, run `pnpm --filter @denim/types build`.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/schema.ts
git commit -m "feat(types): add relatedUserThing to HypothesisValidation discoveredEntities"
```

---

## Task 3: Update validation parser to accept `relatedUserThing`

**Files:**
- Modify: `packages/ai/src/parsers/validation-parser.ts:4-15`
- Test: `packages/ai/src/parsers/validation-parser.test.ts` (may exist — check before creating)

- [ ] **Step 1: Check for existing parser test file**

Run: `ls packages/ai/src/parsers/validation-parser.test.ts`

If it does not exist, skip Step 2 and move to Step 3. If it does, look at the existing patterns and add a test in Step 2.

- [ ] **Step 2: Write a failing test for the new field**

If a test file exists, add this test case to it. If it does not, skip this step — the end-to-end onboarding test will cover it.

```typescript
// packages/ai/src/parsers/validation-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseValidationResponse } from "./validation-parser";

describe("parseValidationResponse", () => {
  it("accepts relatedUserThing on discovered entities", () => {
    const raw = JSON.stringify({
      confirmedEntities: ["soccer"],
      discoveredEntities: [
        {
          name: "ZSA U11/12 Girls",
          type: "SECONDARY",
          secondaryTypeName: null,
          confidence: 0.95,
          source: "email_scan",
          emailCount: 7,
          emailIndices: [1, 2, 3, 4, 5, 6, 7],
          likelyAliasOf: null,
          aliasConfidence: null,
          aliasReason: null,
          relatedUserThing: "soccer",
        },
      ],
      confirmedTags: [],
      suggestedTags: [],
      noisePatterns: [],
      confidenceScore: 0.8,
    });

    const parsed = parseValidationResponse(raw);
    expect(parsed.discoveredEntities[0].relatedUserThing).toBe("soccer");
  });

  it("defaults relatedUserThing to null when missing", () => {
    const raw = JSON.stringify({
      confirmedEntities: [],
      discoveredEntities: [
        {
          name: "Rental Properties",
          type: "PRIMARY",
          secondaryTypeName: null,
          confidence: 0.9,
          source: "email_scan",
          emailCount: 11,
          emailIndices: [1, 2, 3],
          likelyAliasOf: null,
          aliasConfidence: null,
          aliasReason: null,
        },
      ],
      confirmedTags: [],
      suggestedTags: [],
      noisePatterns: [],
      confidenceScore: 0.5,
    });

    const parsed = parseValidationResponse(raw);
    expect(parsed.discoveredEntities[0].relatedUserThing).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails (or skip if no test file)**

Run: `pnpm --filter @denim/ai test validation-parser`
Expected if tests added: FAIL with "Unknown argument relatedUserThing" or similar
Expected if no test file: N/A — move to Step 4.

- [ ] **Step 4: Add `relatedUserThing` to `DiscoveredEntitySchema`**

Find the `DiscoveredEntitySchema` at the top of `packages/ai/src/parsers/validation-parser.ts`:

```typescript
// packages/ai/src/parsers/validation-parser.ts
import { z } from "zod";
import { stripCodeFences } from "./utils";

const DiscoveredEntitySchema = z.object({
  name: z.string(),
  type: z.enum(["PRIMARY", "SECONDARY"]),
  secondaryTypeName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
  emailCount: z.number().int().nonnegative().default(0),
  emailIndices: z.array(z.number()).default([]),
  likelyAliasOf: z.string().nullable().default(null),
  aliasConfidence: z.number().nullable().default(null),
  aliasReason: z.string().nullable().default(null),
  relatedUserThing: z.string().nullable().default(null),
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @denim/ai test`
Expected: PASS (all tests including new ones)

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/parsers/validation-parser.ts packages/ai/src/parsers/validation-parser.test.ts
git commit -m "feat(ai): parse relatedUserThing field on discovered entities"
```

---

## Task 4: Update validation prompt to request `relatedUserThing`

**Files:**
- Modify: `packages/ai/src/prompts/interview-validate.ts`

- [ ] **Step 1: Extend `buildValidationPrompt` signature to accept userThings**

Replace the full contents of `packages/ai/src/prompts/interview-validate.ts` with:

```typescript
import type { SchemaHypothesis } from "@denim/types";

export interface ValidationPromptResult {
  system: string;
  user: string;
}

interface EmailSample {
  subject: string;
  senderDomain: string;
  senderName: string;
  snippet: string;
}

export interface EntityGroupContext {
  index: number;
  primaryNames: string[];
  secondaryNames: string[];
}

export function buildValidationPrompt(
  hypothesis: SchemaHypothesis,
  emailSamples: EmailSample[],
  entityGroups?: EntityGroupContext[],
  userThings?: string[],
): ValidationPromptResult {
  const userThingsList = userThings && userThings.length > 0
    ? userThings.map((t) => `"${t}"`).join(", ")
    : "(none provided)";

  const system = `You are an email analysis assistant. You are given a schema hypothesis (an AI-generated plan for organizing a user's email) and a sample of their actual recent emails. Your job is to validate the hypothesis against the real email data.

Analyze the email samples and return a JSON object with these fields:
- confirmedEntities: string[] — entity names from the hypothesis that appear in the email samples
- discoveredEntities: array of {
    name: string,
    type: "PRIMARY" | "SECONDARY",
    secondaryTypeName: string | null,
    confidence: number (0-1),
    source: "email_scan",
    emailCount: number,
    emailIndices: number[],
    likelyAliasOf: string | null,
    aliasConfidence: number | null (0-1, only set if likelyAliasOf is not null),
    aliasReason: string | null (1-sentence explanation, only set if likelyAliasOf is not null),
    relatedUserThing: string | null
  }

GROUNDING RULES FOR DISCOVERED ENTITIES:
- You MUST cite evidence for every discovered entity using emailIndices.
- emailIndices contains the 1-based list numbers of emails from the sample that reference this entity (by sender name, sender domain, subject line, or preview text).
- ONLY report entities that appear in at least 1 email from the sample.
- emailCount MUST equal emailIndices.length.
- Do NOT infer entities from general knowledge or from the domain category. Only report what you can point to in the provided email data.

ALIAS DETECTION:
For each discovered entity, determine whether it is likely an alias, alternate name, sub-group, or team name for any KNOWN entity or entity group. Signals to check:
- The discovered entity name contains a known entity name or person name
- The same sender appears in emails about both the known and discovered entity
- Email subjects reference both in the same threads
- The discovered entity operates in the same domain/activity as a known entity group
If it IS an alias, set likelyAliasOf to the PRIMARY entity name it should be grouped with. Set aliasConfidence (0.5 = probably, 0.8+ = almost certain). Explain reasoning in aliasReason.
If it is NOT an alias, set likelyAliasOf, aliasConfidence, and aliasReason to null.

RELATED USER TOPIC:
The user entered these topics they want to track: ${userThingsList}.
For EACH discovered entity, set relatedUserThing to the SINGLE user topic it most clearly relates to, matched CASE-INSENSITIVELY against the list above. Use this rule:
- If the entity is clearly about one specific topic (e.g., "ZSA U11/12 Girls" is about "soccer"), set relatedUserThing to that exact topic name.
- If the entity spans multiple topics (e.g., a parent who emails about soccer AND dance), set relatedUserThing to null.
- If the entity is unrelated to any user topic (e.g., a rental-property manager when the user's topics are all kids activities), set relatedUserThing to null.
- The value MUST be one of the listed topics verbatim (same spelling, lowercase acceptable) OR null. Never invent a new topic name.

NOISE vs ENTITY CLASSIFICATION:
Newsletter senders, mass email lists, marketing emails, automated notification services, and subscription content are NOISE, not entities. Put them in noisePatterns, not discoveredEntities.
Examples of NOISE (goes in noisePatterns): "US Soccer Insider", "Eventbrite notifications", "Constant Contact", "PTO newsletter blasts", "noreply@" senders.
Examples of ENTITIES (goes in discoveredEntities): "Oak Park Soccer League" (a specific organization the user interacts with), "Mrs. Henderson" (a specific person).
The test: would the user want to track and organize emails from this source into cases? If yes, it is an entity. If no, it is noise.

- confirmedTags: string[] — tag names from the hypothesis that match content in the email samples
- suggestedTags: array of { name, description, expectedFrequency ("high"|"medium"|"low"), isActionable: boolean } — new tags suggested by patterns in the email
- noisePatterns: string[] — sender domains or names that appear to be automated/marketing noise (e.g. noreply@, newsletter@, mass email lists)
- confidenceScore: number 0-1 — how well the hypothesis matches the actual email data

Return ONLY valid JSON, no markdown fences, no explanation.`;

  // Build entity group context section (only if groups provided)
  let groupSection = "";
  if (entityGroups && entityGroups.length > 0) {
    groupSection = "### Entity Groups (user-defined pairings)\n";
    for (const group of entityGroups) {
      const primaries = group.primaryNames.map((n) => `"${n}" (PRIMARY)`).join(" + ");
      const secondaries = group.secondaryNames.map((n) => `"${n}" (SECONDARY)`).join(" + ");
      const parts = [primaries, secondaries].filter(Boolean).join(" + ");
      const label = parts || "(empty group)";
      groupSection += `Group ${group.index + 1}: ${label}\n`;
      groupSection += "  - These were entered together by the user as related\n";
    }
    groupSection += "\n";
  }

  // Build entity list, with group annotations if groups are available
  const entityList = hypothesis.entities
    .map((e: { name: string; type: string }) => {
      if (entityGroups && entityGroups.length > 0) {
        const groupIdx = entityGroups.findIndex(
          (g) => g.primaryNames.includes(e.name) || g.secondaryNames.includes(e.name),
        );
        const groupLabel = groupIdx >= 0 ? `, Group ${groupIdx + 1}` : "";
        return `- ${e.name} (${e.type}${groupLabel})`;
      }
      return `- ${e.name} (${e.type})`;
    })
    .join("\n");

  const tagList = hypothesis.tags
    .map((t: { name: string; description: string }) => `- ${t.name}: ${t.description}`)
    .join("\n");

  const sampleList = emailSamples
    .slice(0, 100)
    .map(
      (e, i) =>
        `${i + 1}. From: ${e.senderName} (${e.senderDomain}) | Subject: ${e.subject} | Preview: ${e.snippet.slice(0, 120)}`,
    )
    .join("\n");

  const entitiesHeader =
    entityGroups && entityGroups.length > 0 ? "### All Known Entities" : "### Known Entities";

  const user = `## Schema Hypothesis

**Domain:** ${hypothesis.domain}
**Schema Name:** ${hypothesis.schemaName}
**Primary Entity Type:** ${hypothesis.primaryEntity.name} — ${hypothesis.primaryEntity.description}

### User's Entered Topics
${userThingsList}

${groupSection}${entitiesHeader}
${entityList}

### Expected Tags
${tagList}

## Email Samples (${emailSamples.length} emails)
${sampleList}

Analyze these emails against the hypothesis. Which entities and tags are confirmed? What new patterns do you see? What sender domains are noise?${entityGroups && entityGroups.length > 0 ? " For discovered entities, check whether they might be aliases or sub-groups of known entities using the entity group context above." : ""} For every discovered entity, set relatedUserThing to the user's topic it most clearly relates to (or null).`;

  return { system, user };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @denim/ai build`
Expected: build completes without type errors.

- [ ] **Step 3: Run AI tests**

Run: `pnpm --filter @denim/ai test`
Expected: PASS (all existing tests still pass).

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/prompts/interview-validate.ts
git commit -m "feat(ai): validation prompt requests relatedUserThing per discovered entity"
```

---

## Task 5: Thread `userThings` through `validateHypothesis` in interview service

**Files:**
- Modify: `apps/web/src/lib/services/interview.ts:89-176`

- [ ] **Step 1: Add userThings to validateHypothesis options**

In `apps/web/src/lib/services/interview.ts`, find the `validateHypothesis` function signature and add `userThings` to the options. Replace the function signature through the `buildValidationPrompt` call:

```typescript
// apps/web/src/lib/services/interview.ts (around line 89)
export async function validateHypothesis(
  hypothesis: SchemaHypothesis,
  emailSamples: EmailSampleForValidation[],
  options?: {
    userId?: string;
    entityGroups?: EntityGroupContext[];
    userThings?: string[];
  },
): Promise<HypothesisValidation> {
  const operation = "validateHypothesis";
  const start = Date.now();
  let filteredHallucinations = 0;

  return withLogging<HypothesisValidation>(
    {
      service: "interview",
      operation,
      context: {
        userId: options?.userId,
        sampleCount: emailSamples.length,
        entityGroupCount: options?.entityGroups?.length ?? 0,
        userThingCount: options?.userThings?.length ?? 0,
      },
    },
    async () => {
      const prompt = buildValidationPrompt(
        hypothesis,
        emailSamples,
        options?.entityGroups,
        options?.userThings,
      );

      // ... rest of the function unchanged
```

Leave everything from the `callClaude` call onwards exactly as it was.

- [ ] **Step 2: Export GENERIC_SENDER_DOMAINS**

In the same file, find the `GENERIC_SENDER_DOMAINS` constant (around line 188). Add the `export` keyword:

```typescript
// apps/web/src/lib/services/interview.ts (around line 188)
export const GENERIC_SENDER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  // ... rest unchanged
]);
```

- [ ] **Step 3: Typecheck web**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/services/interview.ts
git commit -m "feat(interview): thread userThings through validateHypothesis; export GENERIC_SENDER_DOMAINS"
```

---

## Task 6: Extend `GmailClient.sampleScan` to accept a `newerThan` window

**Files:**
- Modify: `apps/web/src/lib/gmail/client.ts:149-201`

- [ ] **Step 1: Update sampleScan signature and query string**

In `apps/web/src/lib/gmail/client.ts`, find `sampleScan` (around line 149) and extend it:

```typescript
// apps/web/src/lib/gmail/client.ts
/**
 * Fetch recent emails and group by sender domain.
 * Returns messages and discovery summary sorted by count descending.
 *
 * @param maxResults - Max emails to fetch (default 200).
 * @param newerThan - Optional Gmail `newer_than:` constraint, e.g. "56d".
 *   When provided, restricts the random sample to recent emails.
 */
async sampleScan(
  maxResults = 200,
  newerThan?: string,
): Promise<{ messages: GmailMessageMeta[]; discoveries: ScanDiscovery[] }> {
  const start = Date.now();
  const operation = "sampleScan";

  logger.info({ service: "gmail", operation, maxResults, newerThan });

  const query = newerThan ? `newer_than:${newerThan}` : "";
  const messages = await this.searchEmails(query, maxResults);

  // ... rest of the function unchanged (domain grouping, discoveries build, return)
```

Keep everything from the `// Group by sender domain` comment through the end of the function unchanged.

- [ ] **Step 2: Typecheck web**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/gmail/client.ts
git commit -m "feat(gmail): sampleScan accepts optional newer_than window"
```

---

## Task 7: Create `extractExpansionTargets` service helper

**Files:**
- Create: `apps/web/src/lib/services/expansion-targets.ts`
- Create: `apps/web/tests/unit/expansion-targets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/expansion-targets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractExpansionTargets } from "@/lib/services/expansion-targets";
import type { SchemaHypothesis } from "@denim/types";

const baseHypothesis = (entities: SchemaHypothesis["entities"]): SchemaHypothesis => ({
  domain: "school_parent",
  schemaName: "Test",
  primaryEntity: { name: "Activity", description: "" },
  secondaryEntityTypes: [],
  entities,
  tags: [],
  summaryLabels: { beginning: "What", middle: "Details", end: "Action Needed" },
  discoveryQueries: [],
  clusteringConfig: {} as SchemaHypothesis["clusteringConfig"],
});

describe("extractExpansionTargets", () => {
  it("emits domain target for corporate senders", () => {
    const hypothesis = baseHypothesis([
      {
        name: "TeamSnap",
        type: "SECONDARY",
        secondaryTypeName: "Organization",
        aliases: ["donotreply@email.teamsnap.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    const targets = extractExpansionTargets(hypothesis);
    expect(targets).toEqual([{ type: "domain", value: "email.teamsnap.com" }]);
  });

  it("emits sender target for generic-provider senders", () => {
    const hypothesis = baseHypothesis([
      {
        name: "Ziad Allan",
        type: "SECONDARY",
        secondaryTypeName: "Coach",
        aliases: ["ziad.allan@gmail.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    const targets = extractExpansionTargets(hypothesis);
    expect(targets).toEqual([{ type: "sender", value: "ziad.allan@gmail.com" }]);
  });

  it("skips PRIMARY entities (only SECONDARY aliases are senders)", () => {
    const hypothesis = baseHypothesis([
      {
        name: "soccer",
        type: "PRIMARY",
        secondaryTypeName: null,
        aliases: ["soccer@example.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    expect(extractExpansionTargets(hypothesis)).toEqual([]);
  });

  it("deduplicates repeated targets", () => {
    const hypothesis = baseHypothesis([
      {
        name: "A",
        type: "SECONDARY",
        secondaryTypeName: null,
        aliases: ["a@acme.com", "b@acme.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    expect(extractExpansionTargets(hypothesis)).toEqual([
      { type: "domain", value: "acme.com" },
    ]);
  });

  it("handles mixed generic and corporate aliases on the same entity", () => {
    const hypothesis = baseHypothesis([
      {
        name: "Parent",
        type: "SECONDARY",
        secondaryTypeName: null,
        aliases: ["jane@gmail.com", "jane@acme.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    const targets = extractExpansionTargets(hypothesis);
    expect(targets).toHaveLength(2);
    expect(targets).toContainEqual({ type: "sender", value: "jane@gmail.com" });
    expect(targets).toContainEqual({ type: "domain", value: "acme.com" });
  });

  it("ignores aliases without an @ (display-name aliases)", () => {
    const hypothesis = baseHypothesis([
      {
        name: "ziad",
        type: "SECONDARY",
        secondaryTypeName: null,
        aliases: ["ziad", "coach ziad"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    expect(extractExpansionTargets(hypothesis)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web vitest run tests/unit/expansion-targets.test.ts`
Expected: FAIL with "Cannot find module '@/lib/services/expansion-targets'"

- [ ] **Step 3: Write the helper**

Create `apps/web/src/lib/services/expansion-targets.ts`:

```typescript
import type { SchemaHypothesis } from "@denim/types";
import { GENERIC_SENDER_DOMAINS } from "./interview";

/**
 * An expansion target tells Pass 2 what Gmail query to run to find more
 * emails tied to a confirmed secondary entity.
 *
 *   - `domain`: expand the whole domain with `from:${value}` — safe for
 *     corporate/org domains like "email.teamsnap.com" where every sender
 *     at that domain is organizationally related.
 *   - `sender`: expand a single address with `from:${value}` — required
 *     for generic-provider senders like `jane@gmail.com`, where expanding
 *     the domain would pull every personal email in the inbox.
 */
export type ExpansionTarget =
  | { type: "domain"; value: string }
  | { type: "sender"; value: string };

/**
 * Extract expansion targets from an enriched hypothesis. For each
 * SECONDARY entity, walk its aliases and emit one target per alias
 * email address:
 *   - If the domain is a generic consumer provider (gmail.com, yahoo.com,
 *     outlook.com, etc. — see GENERIC_SENDER_DOMAINS), emit a sender
 *     target keyed on the full address.
 *   - Otherwise, emit a domain target keyed on the domain part.
 *
 * Aliases without an `@` (plain display-name aliases like "coach ziad")
 * are skipped — they can't be Gmail-queried.
 *
 * Results are deduplicated by (type, value).
 */
export function extractExpansionTargets(hypothesis: SchemaHypothesis): ExpansionTarget[] {
  const seen = new Set<string>();
  const targets: ExpansionTarget[] = [];

  for (const entity of hypothesis.entities) {
    if (entity.type !== "SECONDARY") continue;

    for (const alias of entity.aliases) {
      const atIdx = alias.lastIndexOf("@");
      if (atIdx < 0) continue;

      const email = alias.toLowerCase().trim();
      const domain = email.slice(atIdx + 1);
      if (!domain || domain.includes(" ")) continue;

      if (GENERIC_SENDER_DOMAINS.has(domain)) {
        const key = `sender:${email}`;
        if (!seen.has(key)) {
          seen.add(key);
          targets.push({ type: "sender", value: email });
        }
      } else {
        const key = `domain:${domain}`;
        if (!seen.has(key)) {
          seen.add(key);
          targets.push({ type: "domain", value: domain });
        }
      }
    }
  }

  return targets;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web vitest run tests/unit/expansion-targets.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/services/expansion-targets.ts apps/web/tests/unit/expansion-targets.test.ts
git commit -m "feat(interview): extractExpansionTargets distinguishes corporate domains from generic senders"
```

---

## Task 8: Shrink Pass 1 and remove Pass 2 from Function A

**Files:**
- Modify: `apps/web/src/lib/inngest/onboarding.ts:30-35, 44-51, 136-281`

- [ ] **Step 1: Update imports to drop extractTrustedDomains, add tunables**

In `apps/web/src/lib/inngest/onboarding.ts`, update the import block:

```typescript
// apps/web/src/lib/inngest/onboarding.ts (around lines 23-38)
import type { HypothesisValidation, InterviewInput, SchemaHypothesis } from "@denim/types";
import type { Prisma } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { extractExpansionTargets } from "@/lib/services/expansion-targets";
import {
  generateHypothesis,
  resolveWhoEmails,
  validateHypothesis,
} from "@/lib/services/interview";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";
```

Note: `extractTrustedDomains` is removed from the import list. It is still exported from `interview.ts` (do not delete it — it is a pure function and may be reused later).

- [ ] **Step 2: Remove the module-level DOMAIN_EXPANSION_CAP and MAX_DOMAINS_TO_EXPAND constants**

Delete lines ~39-51 (the two constant declarations and their jsdoc comments) from `apps/web/src/lib/inngest/onboarding.ts`. Keep the `SCAN_WAIT_TIMEOUT` constant.

- [ ] **Step 3: Replace the validate-hypothesis step to run Pass 1 only**

In Function A, find the `step.run("validate-hypothesis", async () => { ... })` block (roughly lines 136-281). Replace the ENTIRE block body with:

```typescript
      // ---- Step 1b: Pass 1 validation (broad random sample) -------------
      //
      // Pre-confirm validation. Reads a small random sample from the last
      // 8 weeks and asks Claude to identify confirmed entities, new
      // discoveries, and noise. Pass 2 (targeted domain expansion) is
      // deferred until after the user confirms — see
      // expand-confirmed-domains in runOnboardingPipeline.
      //
      // Runs OUTSIDE an advanceSchemaPhase CAS — stays within the
      // GENERATING_HYPOTHESIS phase for polling purposes. The phase advance
      // happens in the next step (advance-to-awaiting-review) after
      // validation has written its result back.
      await step.run("validate-hypothesis", async () => {
        const schema = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { hypothesis: true, validation: true, inputs: true },
        });

        // Idempotency guard: on Inngest retry, if validation already ran,
        // skip it rather than spending another Claude call.
        if (schema.validation) {
          logger.info({
            service: "runOnboarding",
            operation: "validate-hypothesis.skip",
            schemaId,
            reason: "already-validated",
          });
          return;
        }

        const hypothesis = schema.hypothesis as unknown as SchemaHypothesis | null;
        if (!hypothesis) {
          throw new NonRetriableError(
            `runOnboarding: CaseSchema ${schemaId} has no hypothesis after GENERATING_HYPOTHESIS`,
          );
        }

        const accessToken = await getValidGmailToken(userId);
        const gmail = new GmailClient(accessToken);
        const { messages } = await gmail.sampleScan(
          ONBOARDING_TUNABLES.pass1.sampleSize,
          ONBOARDING_TUNABLES.pass1.lookback,
        );

        // Enrich hypothesis WHO aliases with resolved sender email
        // addresses (mutates the hypothesis object in place). Pass 2
        // (post-confirm) reads these enriched aliases via
        // extractExpansionTargets.
        resolveWhoEmails(hypothesis, messages);

        const pass1Samples = messages.map((m) => ({
          subject: m.subject,
          senderDomain: m.senderDomain,
          senderName: m.senderDisplayName || m.senderEmail,
          snippet: m.snippet,
        }));

        // entityGroups come from the raw InterviewInput (user's original
        // topic groupings), not from the AI-generated hypothesis. Map to
        // the EntityGroupContext shape validateHypothesis expects.
        const inputs = schema.inputs as unknown as InterviewInput | null;
        const entityGroups = inputs?.groups?.map((g, idx) => ({
          index: idx,
          primaryNames: g.whats,
          secondaryNames: g.whos,
        }));

        // userThings = the user's raw WHATs (e.g., ["soccer","dance",...]).
        // We give these to Claude so it can fill relatedUserThing on each
        // discovered entity. Prefer the flat `whats` if present; fall back
        // to flattening the groups.
        const userThings = inputs?.whats ?? inputs?.groups?.flatMap((g) => g.whats) ?? [];

        const pass1 = await validateHypothesis(hypothesis, pass1Samples, {
          userId,
          entityGroups,
          userThings,
        });

        await prisma.caseSchema.update({
          where: { id: schemaId },
          data: {
            // Write back the (possibly mutated) hypothesis with enriched
            // WHO aliases so Pass 2 and persistSchemaRelations see the
            // resolved email addresses.
            hypothesis: hypothesis as unknown as Prisma.InputJsonValue,
            validation: pass1 as unknown as Prisma.InputJsonValue,
          },
        });

        logger.info({
          service: "runOnboarding",
          operation: "validate-hypothesis.complete",
          schemaId,
          sampleSize: ONBOARDING_TUNABLES.pass1.sampleSize,
          lookback: ONBOARDING_TUNABLES.pass1.lookback,
          discovered: pass1.discoveredEntities.length,
          confidenceScore: pass1.confidenceScore,
        });
      });
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 5: Run existing onboarding integration tests**

Run: `pnpm --filter web vitest run tests/integration/onboarding-routes`
Expected: PASS (any tests that exercise Function A should still pass — Pass 1 output shape is unchanged).

If a test explicitly asserts Pass 2 behavior (domain expansion counts), delete that assertion — Pass 2 has moved. Grep for `pass2DomainsExpanded` or `pass2AdditionalDiscovered` to find them:

Run: `grep -rn "pass2" apps/web/tests`

Remove or update any matching assertions. Expected outcome after updates: full integration suite stays green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/inngest/onboarding.ts apps/web/tests
git commit -m "feat(onboarding): Pass 1 validation uses 100-email, 8-week window; remove Pass 2 from Function A"
```

---

## Task 9: Add Pass 2 (expand-confirmed-domains) step to Function B

**Files:**
- Modify: `apps/web/src/lib/inngest/onboarding.ts` (runOnboardingPipeline function body)

- [ ] **Step 1: Add the expand-confirmed-domains step**

In `apps/web/src/lib/inngest/onboarding.ts`, find `runOnboardingPipeline` (around line 340). Insert a new step BEFORE `Step 1: AWAITING_REVIEW → PROCESSING_SCAN`. Put it inside the `try {` block, immediately after the opening of the try:

```typescript
// apps/web/src/lib/inngest/onboarding.ts (inside runOnboardingPipeline's try block, before create-scan-job)

      // ---- Step 0: Pass 2 — targeted domain expansion ------------------
      //
      // The user has confirmed which entities they care about. Expand
      // Gmail coverage for those entities ONLY: for each confirmed
      // SECONDARY entity's alias addresses, emit an expansion target
      // (domain for corporate senders, full sender address for generic
      // providers like @gmail.com). Query Gmail for each target, run a
      // second validateHypothesis pass on those samples, and write any
      // newly discovered entities as Entity rows so the downstream scan
      // picks them up via normal entity reads.
      //
      // This step is best-effort: failure here should NOT block the
      // pipeline. If Gmail quota or an expansion call fails, log and
      // continue so the user still gets their scan.
      await step.run("expand-confirmed-domains", async () => {
        try {
          const schema = await prisma.caseSchema.findUniqueOrThrow({
            where: { id: schemaId },
            select: { hypothesis: true, inputs: true },
          });
          const hypothesis = schema.hypothesis as unknown as SchemaHypothesis | null;
          if (!hypothesis) {
            logger.warn({
              service: "runOnboardingPipeline",
              operation: "expand-confirmed-domains.skip",
              schemaId,
              reason: "no-hypothesis",
            });
            return;
          }

          // Only expand for entities the user kept (isActive=true). A
          // rejected entity means the user doesn't want its domain
          // crawled.
          const activeEntities = await prisma.entity.findMany({
            where: { schemaId, isActive: true, type: "SECONDARY" },
            select: { name: true, aliases: true },
          });
          if (activeEntities.length === 0) {
            logger.info({
              service: "runOnboardingPipeline",
              operation: "expand-confirmed-domains.skip",
              schemaId,
              reason: "no-active-secondary-entities",
            });
            return;
          }

          // Build a hypothesis-shaped view restricted to active SECONDARY
          // entities with their DB-resolved aliases. extractExpansionTargets
          // walks aliases, so this narrows the inputs correctly without
          // touching the helper.
          const narrowed: SchemaHypothesis = {
            ...hypothesis,
            entities: activeEntities.map((e) => ({
              name: e.name,
              type: "SECONDARY",
              secondaryTypeName: null,
              aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
              confidence: 1,
              source: "confirmed",
            })),
          };

          const targets = extractExpansionTargets(narrowed).slice(
            0,
            ONBOARDING_TUNABLES.pass2.maxTargetsToExpand,
          );
          if (targets.length === 0) {
            logger.info({
              service: "runOnboardingPipeline",
              operation: "expand-confirmed-domains.skip",
              schemaId,
              reason: "no-targets",
            });
            return;
          }

          const accessToken = await getValidGmailToken(userId);
          const gmail = new GmailClient(accessToken);
          const inputs = schema.inputs as unknown as InterviewInput | null;
          const entityGroups = inputs?.groups?.map((g, idx) => ({
            index: idx,
            primaryNames: g.whats,
            secondaryNames: g.whos,
          }));
          const userThings = inputs?.whats ?? inputs?.groups?.flatMap((g) => g.whats) ?? [];

          // Accumulate discoveries across targets, deduped by entity name
          // against existing DB entities AND across targets in this pass.
          const existingNames = new Set(
            activeEntities.map((e) => e.name.toLowerCase()),
          );
          const allPrimaryNames = await prisma.entity.findMany({
            where: { schemaId, type: "PRIMARY" },
            select: { name: true },
          });
          for (const p of allPrimaryNames) existingNames.add(p.name.toLowerCase());

          const newDiscoveries: HypothesisValidation["discoveredEntities"] = [];

          for (const target of targets) {
            try {
              const query =
                `from:${target.value} newer_than:${ONBOARDING_TUNABLES.pass2.lookback}`;
              const targetMessages = await gmail.searchEmails(
                query,
                ONBOARDING_TUNABLES.pass2.emailsPerTarget,
              );
              if (targetMessages.length === 0) continue;

              const samples = targetMessages.map((m) => ({
                subject: m.subject,
                senderDomain: m.senderDomain,
                senderName: m.senderDisplayName || m.senderEmail,
                snippet: m.snippet,
              }));

              const pass2 = await validateHypothesis(hypothesis, samples, {
                userId,
                entityGroups,
                userThings,
              });

              for (const discovered of pass2.discoveredEntities) {
                const key = discovered.name.toLowerCase();
                if (existingNames.has(key)) continue;
                if (newDiscoveries.some((e) => e.name.toLowerCase() === key)) continue;
                newDiscoveries.push(discovered);
                existingNames.add(key);
              }

              logger.info({
                service: "runOnboardingPipeline",
                operation: "expand-confirmed-domains.target",
                schemaId,
                targetType: target.type,
                targetValue: target.value,
                emailsFetched: targetMessages.length,
                newFromTarget: pass2.discoveredEntities.length,
              });
            } catch (err) {
              logger.warn({
                service: "runOnboardingPipeline",
                operation: "expand-confirmed-domains.target.failed",
                schemaId,
                targetType: target.type,
                targetValue: target.value,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (newDiscoveries.length === 0) {
            logger.info({
              service: "runOnboardingPipeline",
              operation: "expand-confirmed-domains.complete",
              schemaId,
              newDiscoveries: 0,
            });
            return;
          }

          // Persist new discoveries as Entity rows so the downstream scan
          // reads them when building discovery queries. These are written
          // as isActive=true with autoDetected=true — the user didn't
          // get to toggle them because they were discovered AFTER confirm.
          // If that turns out to surface too many off-topic entities, we
          // can gate on relatedUserThing !== null in a future pass.
          await prisma.$transaction(
            newDiscoveries.map((d) =>
              prisma.entity.create({
                data: {
                  schemaId,
                  name: d.name,
                  type: d.type,
                  secondaryTypeName: d.secondaryTypeName,
                  aliases: [],
                  autoDetected: true,
                  confidence: d.confidence,
                  isActive: true,
                },
              }),
            ),
          );

          logger.info({
            service: "runOnboardingPipeline",
            operation: "expand-confirmed-domains.complete",
            schemaId,
            targetCount: targets.length,
            newDiscoveries: newDiscoveries.length,
          });
        } catch (err) {
          // Outer catch: swallow so pipeline continues. Domain expansion
          // is best-effort; its value is more discoveries, not
          // correctness.
          logger.warn({
            service: "runOnboardingPipeline",
            operation: "expand-confirmed-domains.failed",
            schemaId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      // ---- Step 1: AWAITING_REVIEW → PROCESSING_SCAN --------------------
      //
      // (unchanged — continue with create-scan-job as before)
```

Make sure the existing `create-scan-job`, `resolve-scan-job`, `request-scan`, `wait-for-scan`, and terminal-advance steps remain unchanged below.

- [ ] **Step 2: Add the new imports if not already present at top of file**

Verify the import block at the top of `apps/web/src/lib/inngest/onboarding.ts` has all of these (Task 8 added most of them):

```typescript
import type { HypothesisValidation, InterviewInput, SchemaHypothesis } from "@denim/types";
import type { Prisma } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { extractExpansionTargets } from "@/lib/services/expansion-targets";
import {
  generateHypothesis,
  resolveWhoEmails,
  validateHypothesis,
} from "@/lib/services/interview";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/inngest/onboarding.ts
git commit -m "feat(onboarding): Pass 2 domain expansion moves to Function B as targeted post-confirm step"
```

---

## Task 10: Migrate discovery.ts to use centralized tunables

**Files:**
- Modify: `apps/web/src/lib/services/discovery.ts:32-35`

- [ ] **Step 1: Replace hardcoded constants with config imports**

Find the constant declarations near the top of `apps/web/src/lib/services/discovery.ts` (around line 32):

```typescript
// BEFORE
const MAX_DISCOVERY_EMAILS = 200;
const DISCOVERY_LOOKBACK = "56d";
const BROAD_SCAN_LIMIT = 200;
const BODY_SAMPLE_COUNT = 3;
```

Replace MAX_DISCOVERY_EMAILS and DISCOVERY_LOOKBACK by adding the import at the top of the file and referencing `ONBOARDING_TUNABLES.discovery` where those constants are used:

```typescript
// apps/web/src/lib/services/discovery.ts
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";

// Keep these two local constants — they're not about onboarding wait time.
const BROAD_SCAN_LIMIT = 200;
const BODY_SAMPLE_COUNT = 3;
```

Then find every reference to `MAX_DISCOVERY_EMAILS` and replace with `ONBOARDING_TUNABLES.discovery.maxTotalEmails`. Find every reference to `DISCOVERY_LOOKBACK` and replace with `ONBOARDING_TUNABLES.discovery.lookback`.

Use a grep to find them all:

Run: `grep -n "MAX_DISCOVERY_EMAILS\|DISCOVERY_LOOKBACK" apps/web/src/lib/services/discovery.ts`

Replace every occurrence.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 3: Run any discovery-specific unit tests**

Run: `pnpm --filter web vitest run discovery`
Expected: PASS (existing tests should pass — values are identical, only the source moved).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/services/discovery.ts
git commit -m "refactor(discovery): source lookback and cap from onboarding-tunables config"
```

---

## Task 11: Review screen — add `relatedUserThing` to EntityData type

**Files:**
- Modify: `apps/web/src/components/onboarding/review-entities.tsx:3-15`
- Modify: `apps/web/src/components/onboarding/phase-review.tsx:35-47, 86-140`

- [ ] **Step 1: Add `relatedUserThing` to EntityData interface**

In `apps/web/src/components/onboarding/review-entities.tsx`, update the EntityData interface:

```typescript
// apps/web/src/components/onboarding/review-entities.tsx (lines 3-15)
export interface EntityData {
  id: string;
  name: string;
  type: "PRIMARY" | "SECONDARY";
  autoDetected: boolean;
  emailCount: number;
  aliases: string[];
  isActive: boolean;
  confidence: number;
  likelyAliasOf: string | null;
  aliasConfidence: number | null;
  aliasReason: string | null;
  relatedUserThing: string | null;
}
```

- [ ] **Step 2: Add relatedUserThing to RawEntity + thread through both branches in phase-review**

In `apps/web/src/components/onboarding/phase-review.tsx`, update the `RawEntity` interface:

```typescript
// apps/web/src/components/onboarding/phase-review.tsx (lines 35-47)
interface RawEntity {
  id: string;
  name: string;
  type: string;
  autoDetected: boolean;
  emailCount: number;
  aliases: unknown;
  isActive: boolean;
  confidence: number;
  likelyAliasOf: string | null;
  aliasConfidence: number | null;
  aliasReason: string | null;
  relatedUserThing: string | null;
}
```

Still in `phase-review.tsx`, find both mapping sites where EntityData is constructed and add `relatedUserThing`:

Branch A — the "entities exist in DB" branch (around line 84):

```typescript
if (json.data.entities && json.data.entities.length > 0) {
  setEntities(
    json.data.entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type as "PRIMARY" | "SECONDARY",
      autoDetected: e.autoDetected,
      emailCount: e.emailCount,
      aliases: parseAliases(e.aliases),
      isActive: e.isActive,
      confidence: e.confidence ?? 1.0,
      likelyAliasOf: e.likelyAliasOf ?? null,
      aliasConfidence: e.aliasConfidence ?? null,
      aliasReason: e.aliasReason ?? null,
      relatedUserThing: e.relatedUserThing ?? null,
    })),
  );
}
```

Branch B — the "pre-confirm: build from hypothesis+validation" branch (around lines 105-140). Find the two `entityList.push(...)` sites and add `relatedUserThing: null` to the hypothesis-entities site and `relatedUserThing: e.relatedUserThing ?? null` to the discovered-entities site:

```typescript
// Hypothesis entities site (around line 107)
entityList.push({
  id: e.name,
  name: e.name,
  type: e.type as "PRIMARY" | "SECONDARY",
  autoDetected: e.source === "email_scan",
  emailCount: 0,
  aliases: e.aliases ?? [],
  isActive: true,
  confidence: e.confidence ?? 1.0,
  likelyAliasOf: null,
  aliasConfidence: null,
  aliasReason: null,
  relatedUserThing: null,
});

// Discovered entities site (around line 126)
entityList.push({
  id: e.name,
  name: e.name,
  type: (e.type as "PRIMARY" | "SECONDARY") ?? "PRIMARY",
  autoDetected: true,
  emailCount: e.emailCount ?? 0,
  aliases: [],
  isActive: true,
  confidence: e.confidence ?? 0.5,
  likelyAliasOf: e.likelyAliasOf ?? null,
  aliasConfidence: e.aliasConfidence ?? null,
  aliasReason: e.aliasReason ?? null,
  relatedUserThing: e.relatedUserThing ?? null,
});
```

- [ ] **Step 3: Update GET /api/schemas/[schemaId] to select likelyAliasOf and relatedUserThing from validation**

The DB `Entity` row does NOT have a `relatedUserThing` column. That field only lives on validation JSON. phase-review.tsx Branch A reads from `json.data.entities` (DB rows) — those will never have `relatedUserThing`. That's OK at AWAITING_REVIEW because Branch B (hypothesis+validation) is what renders. After confirm, entities ARE in the DB but the user is past the review screen.

**No route change needed.** Branch A sets `relatedUserThing: e.relatedUserThing ?? null` — the optional chaining handles the fact that `e.relatedUserThing` will be `undefined` on DB-row responses, which becomes `null`. Good.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/onboarding/review-entities.tsx apps/web/src/components/onboarding/phase-review.tsx
git commit -m "feat(review): thread relatedUserThing through review screen data flow"
```

---

## Task 12: Review screen — restructure into "Your Topics" + "Discoveries"

**Files:**
- Modify: `apps/web/src/components/onboarding/review-entities.tsx`

- [ ] **Step 1: Replace ReviewEntities component body**

Replace the entire `ReviewEntities` function (keep the `EntityData` interface and `ReviewEntitiesProps` interface above it unchanged). Final file:

```typescript
// apps/web/src/components/onboarding/review-entities.tsx
"use client";

export interface EntityData {
  id: string;
  name: string;
  type: "PRIMARY" | "SECONDARY";
  autoDetected: boolean;
  emailCount: number;
  aliases: string[];
  isActive: boolean;
  confidence: number;
  likelyAliasOf: string | null;
  aliasConfidence: number | null;
  aliasReason: string | null;
  relatedUserThing: string | null;
}

interface ReviewEntitiesProps {
  userThings: string[];
  entities: EntityData[];
  onToggleEntity: (entityId: string, active: boolean) => void;
}

/**
 * Two-section entity review for onboarding.
 *
 * Section 1 "Your Topics": each user-entered WHAT as a header, with
 *   discoveries that relate to that topic listed below. A discovery
 *   relates to a topic if it is a PRIMARY whose aliases contain the
 *   topic name (existing alias-based match), OR if it is any entity
 *   whose `relatedUserThing` matches the topic name (new, from
 *   validation).
 *
 * Section 2 "Discoveries": everything else — entities that didn't get
 *   placed under any topic. Includes PRIMARY entities that look like
 *   their own topics (Rental Properties, The Control Surface) and
 *   SECONDARY entities that span topics (like a parent who emails about
 *   both soccer and dance).
 */
export function ReviewEntities({ userThings, entities, onToggleEntity }: ReviewEntitiesProps) {
  const userThingsLower = userThings.map((t) => t.toLowerCase());

  // For each user thing, find the entities that should display under it.
  const thingSections = userThings.map((thingName) => {
    const thingLower = thingName.toLowerCase();
    // Parent-match: PRIMARY entity whose name equals the user thing.
    // We do NOT display this as a row — the header already shows the
    // user thing; the row would be a duplicate. Kept for future use.
    const parentEntity = entities.find(
      (e) => e.type === "PRIMARY" && e.name.toLowerCase() === thingLower,
    );

    // Related entities under this user thing. Two ways to qualify:
    //   1. PRIMARY with an alias matching the user thing (old behavior)
    //   2. Any type with relatedUserThing === thingName (new)
    const relatedEntities = entities.filter((e) => {
      // Skip the parent entity itself (it IS the user thing).
      if (parentEntity && e.id === parentEntity.id) return false;
      const aliasMatch =
        e.type === "PRIMARY" &&
        e.autoDetected &&
        e.aliases.some((a) => a.toLowerCase() === thingLower);
      const relatedMatch =
        e.relatedUserThing != null && e.relatedUserThing.toLowerCase() === thingLower;
      return aliasMatch || relatedMatch;
    });

    return { thingName, parentEntity, relatedEntities };
  });

  // Build a set of entity ids already shown under a user thing, so we
  // don't duplicate them in Discoveries.
  const shownIds = new Set<string>();
  for (const { parentEntity, relatedEntities } of thingSections) {
    if (parentEntity) shownIds.add(parentEntity.id);
    for (const e of relatedEntities) shownIds.add(e.id);
  }

  // Discoveries: everything else (PRIMARY or SECONDARY, auto-detected,
  // not already shown under a topic, and not matching a user thing name
  // via aliases).
  const discoveries = entities
    .filter((e) => {
      if (shownIds.has(e.id)) return false;
      if (!e.autoDetected) return false;
      const nameLower = e.name.toLowerCase();
      if (userThingsLower.includes(nameLower)) return false;
      const isAliasOfUserThing = userThings.some((t) =>
        e.aliases.some((a) => a.toLowerCase() === t.toLowerCase()),
      );
      if (isAliasOfUserThing) return false;
      return true;
    })
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  return (
    <div className="space-y-6">
      {/* Section 1: Your Topics */}
      <div className="rounded-lg bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-secondary mb-4">
          Your Topics
        </h2>

        <div className="space-y-5">
          {thingSections.map(({ thingName, relatedEntities }) => (
            <div key={thingName}>
              <p className="font-semibold text-primary">{thingName}</p>

              {relatedEntities.length > 0 ? (
                <div className="mt-2 ml-4 space-y-2">
                  {relatedEntities.map((entity) => (
                    <div key={entity.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-primary">{entity.name}</span>
                        <span className="text-xs text-muted">
                          {entity.emailCount} {entity.emailCount === 1 ? "email" : "emails"}
                        </span>
                      </div>
                      {entity.isActive ? (
                        <button
                          type="button"
                          onClick={() => onToggleEntity(entity.id, false)}
                          className="cursor-pointer text-xs text-muted hover:text-red-600 transition-colors"
                        >
                          Not now
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onToggleEntity(entity.id, true)}
                          className="cursor-pointer text-xs font-medium text-accent hover:brightness-110 transition-colors"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 ml-4 text-sm text-muted">No additional items found</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Discoveries */}
      {discoveries.length > 0 && (
        <div className="rounded-lg bg-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-secondary mb-4">
            Discoveries
          </h2>

          <div className="space-y-3">
            {discoveries.map((entity) => (
              <div key={entity.id} className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-primary font-medium">{entity.name}</span>
                    <span className="text-xs text-muted">
                      {entity.emailCount} {entity.emailCount === 1 ? "email" : "emails"}
                    </span>
                  </div>
                  {entity.likelyAliasOf && (
                    <span className="text-xs text-muted">
                      May be related to {entity.likelyAliasOf}
                      {entity.aliasConfidence != null &&
                        ` (${Math.round(entity.aliasConfidence * 100)}%)`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {entity.isActive ? (
                    <button
                      type="button"
                      onClick={() => onToggleEntity(entity.id, false)}
                      className="cursor-pointer text-xs text-muted hover:text-red-600 transition-colors"
                    >
                      Not now
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onToggleEntity(entity.id, true)}
                      className="cursor-pointer text-xs font-medium text-accent hover:brightness-110 transition-colors"
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/onboarding/review-entities.tsx
git commit -m "feat(review): group SECONDARY discoveries under user topics via relatedUserThing; rename to Your Topics + unified Discoveries"
```

---

## Task 13: Diagnose script — show confirmedTags + clarify blank discovery queries

**Files:**
- Modify: `apps/web/scripts/diagnose-hypothesis.ts`

- [ ] **Step 1: Add confirmedTags output in section 4**

In `apps/web/scripts/diagnose-hypothesis.ts`, find the section 4 (`"4. Validation Result"`) block. After the `console.log` for `sampleEmailCount` / `scanDurationMs`, add a new subsection before `4a. Confirmed Entities`:

Find this code:

```typescript
  if (schema.validation) {
    const v = schema.validation as any;
    console.log(`  confidenceScore:   ${v.confidenceScore}`);
    console.log(`  sampleEmailCount:  ${v.sampleEmailCount}`);
    console.log(`  scanDurationMs:    ${v.scanDurationMs}`);

    subheader("4a. Confirmed Entities");
```

Replace with:

```typescript
  if (schema.validation) {
    const v = schema.validation as any;
    console.log(`  confidenceScore:   ${v.confidenceScore}`);
    console.log(`  sampleEmailCount:  ${v.sampleEmailCount}`);
    console.log(`  scanDurationMs:    ${v.scanDurationMs}`);

    subheader("4a. Confirmed Entities (string list — type/metadata comes from hypothesis)");
```

Then find the section 4c subheader `"4c. Suggested Tags"` and insert a new confirmedTags subsection BEFORE it:

```typescript
    subheader("4c. Confirmed Tags (from hypothesis that appeared in real emails)");
    if (v.confirmedTags?.length) {
      for (const t of v.confirmedTags) {
        console.log(`    ${t}`);
      }
    } else {
      console.log("    (none — no hypothesis tags matched the sample)");
    }

    subheader("4d. Suggested Tags (new patterns Claude found — may include off-topic inbox noise)");
```

Renumber the following subheaders: old `4d` becomes `4e`. Update the one existing subheader:

```typescript
    subheader("4e. Noise Patterns");
```

- [ ] **Step 2: Add a clarifying note in section 5 about when discovery queries are persisted**

Find section 5:

```typescript
  subheader("5. Persisted Discovery Queries (schema.discoveryQueries)");

  if (schema.discoveryQueries) {
    const dq = schema.discoveryQueries as any[];
    console.log(`  Total queries: ${dq.length}\n`);
    for (const q of dq) {
      console.log(
        `    [group=${q.groupIndex ?? "?"}] ${(q.label ?? "").padEnd(35)} | ${q.query}`,
      );
    }
  } else {
    console.log("  (not yet persisted — schema still in hypothesis stage)");
  }
```

Replace the empty-case branch:

```typescript
  subheader("5. Persisted Discovery Queries (schema.discoveryQueries)");

  const dqRaw = schema.discoveryQueries;
  const dqArr = Array.isArray(dqRaw) ? (dqRaw as any[]) : [];
  if (dqArr.length > 0) {
    console.log(`  Total queries: ${dqArr.length}\n`);
    for (const q of dqArr) {
      console.log(
        `    [group=${q.groupIndex ?? "?"}] ${(q.label ?? "").padEnd(35)} | ${q.query}`,
      );
    }
  } else {
    console.log("  Total queries: 0");
    console.log("  (This is CORRECT at AWAITING_REVIEW. The stub was created with an");
    console.log("   empty discoveryQueries array; persistSchemaRelations writes the real");
    console.log("   list at confirm time. The queries exist in the hypothesis JSON —");
    console.log("   see section 3c.)");
  }
```

- [ ] **Step 3: Run the script to verify it runs without crashing**

Run (replace `<schemaId>` with an existing schema id at AWAITING_REVIEW, or omit to inspect the most recent):

```bash
cd apps/web
npx tsx scripts/diagnose-hypothesis.ts
```

Expected: prints all sections without throwing, including the new confirmedTags section.

- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/diagnose-hypothesis.ts
git commit -m "chore(diagnose): show confirmedTags and clarify empty discoveryQueries is expected"
```

---

## Task 14: End-to-end verification

**Files:** No code changes — this is the manual verification step.

- [ ] **Step 1: Start dev services**

In one terminal:
```bash
pnpm --filter web dev
```

In another terminal:
```bash
npx inngest-cli@latest dev -u http://localhost:3001/api/inngest
```

- [ ] **Step 2: Wipe existing test schemas (optional — clean slate)**

If you want a clean DB for timing, use the supabase-db skill to wipe test rows. Skip if prior schemas don't interfere.

- [ ] **Step 3: Run onboarding end-to-end**

- Open `http://localhost:3001/onboarding/category` in a new browser window.
- Category: school parent
- Names: soccer, dance, lanier, st agnes, guitar | ziad allan
- Connect Gmail (should already be signed in from prior run — if so this is instant)
- **Start a wall-clock timer when the "Setting up your topic" spinner appears.**
- **Stop the timer when the review screen renders (entities visible).**
- Record the time.

Expected: under 45s (stretch: under 30s).

- [ ] **Step 4: Verify review screen grouping**

On the review screen:
- "Your Topics" section header appears (was "Your Things").
- Under "soccer": ZSA U11/12 Girls, TeamSnap (discovered SECONDARY entities Claude tagged with relatedUserThing="soccer") appear.
- Under "dance": Pia spring dance show appears.
- Under other topics: "No additional items found" if nothing related.
- "Discoveries" section shows Amy DiCarlo, Timothy Bishop, Rental Properties, The Control Surface (and similar) — entities Claude couldn't clearly tie to one topic.

- [ ] **Step 5: Run diagnose script to inspect data**

```bash
cd apps/web
npx tsx scripts/diagnose-hypothesis.ts
```

Verify:
- Section 1 timing shows total elapsed matches the wall-clock measurement.
- Section 3c shows discovery queries in the hypothesis.
- Section 4 shows validation sampleEmailCount=100 (not 200).
- Section 4b shows discovered entities with relatedUserThing set where appropriate.
- Section 4c (new) shows confirmed tags.
- Section 5 shows "Total queries: 0" with the clarifying note.

- [ ] **Step 6: Confirm the review and verify Pass 2 runs post-confirm**

Click "Show me my cases!" after toggling entities. Watch the Inngest dashboard for:
- `runOnboardingPipeline` function fires.
- `expand-confirmed-domains` step runs and logs `expand-confirmed-domains.complete` with `newDiscoveries` count.
- Downstream scan proceeds normally.

Also watch the browser: observer page advances from AWAITING_REVIEW → PROCESSING_SCAN → COMPLETED.

- [ ] **Step 7: Run full test suite**

```bash
pnpm -r test
```

Expected: all previously-green tests pass. Note any new failures in test files that asserted Pass 2 ran in Function A — those assertions were updated in Task 8 Step 5.

- [ ] **Step 8: Typecheck everything**

```bash
pnpm --filter web typecheck
pnpm --filter @denim/ai build
pnpm --filter @denim/types build
pnpm --filter @denim/engine build
```

Expected: all clean.

- [ ] **Step 9: Final commit if anything drifted**

If Steps 3-7 surface adjustments:

```bash
git add <modified files>
git commit -m "fix(onboarding): adjustments from e2e verification"
```

---

## Self-Review Checklist (already run by plan author)

- [x] **Spec coverage:** Every spec section (Parts 1-5, Design Clarifications) maps to tasks. Part 1 = Tasks 8, 9. Part 2 = Tasks 2, 3, 4. Part 3 = Tasks 11, 12. Part 4 = Task 13. Part 5 = Tasks 1, 10.
- [x] **Placeholder scan:** No "TBD", no "add appropriate error handling" without showing it, no "similar to Task N" without repeating code.
- [x] **Type consistency:** `relatedUserThing` used consistently in types, Zod schema, prompt, and UI. `EntityData` has the field everywhere it's constructed. `ExpansionTarget` shape used consistently across helper + Function B step.
- [x] **Function B idempotency:** `expand-confirmed-domains` is best-effort; failure doesn't throw. On Inngest retry, the `entity.create` calls could fail with unique constraint if the step re-runs after partial success — acceptable because there is no unique constraint on entity (schemaId, name) today, so retries would create duplicates. If duplicates become a problem, a future task should add `@@unique([schemaId, name])` to the Entity model.
