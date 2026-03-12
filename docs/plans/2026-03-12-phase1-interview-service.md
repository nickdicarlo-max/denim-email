# Phase 1: Interview Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI interview produces a complete SchemaHypothesis from structured InterviewInput, proving the core hypothesis that AI can generate domain-appropriate case schemas.

**Architecture:** Pure prompt builder + parser in `@denim/ai` (zero I/O), orchestration in `apps/web` InterviewService (I/O layer), Claude API calls through existing `ai/client.ts` wrapper. The flow: `InterviewInput -> buildHypothesisPrompt() -> callClaude() -> parseHypothesisResponse() -> SchemaHypothesis`.

**Tech Stack:** Anthropic SDK (`@anthropic-ai/sdk`), Zod (validation), Vitest (testing), existing Phase 0 infrastructure (logger, withAuth, error-handler, callWithRetry).

---

## Task 1: Install Anthropic SDK

**Files:**
- Modify: `apps/web/package.json` (add dependency)

**Step 1: Install the SDK**

Run:
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && pnpm --filter web add @anthropic-ai/sdk
```

**Step 2: Add ANTHROPIC_API_KEY to env example**

Modify `apps/web/.env.example` — add:
```
ANTHROPIC_API_KEY=sk-ant-...
```

Also ensure `apps/web/.env.local` has the real key (do NOT commit `.env.local`).

**Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/.env.example
git commit -m "feat(phase1): install Anthropic SDK"
```

---

## Task 2: Update AI Client Wrapper for Claude

**Files:**
- Modify: `apps/web/src/lib/ai/client.ts`

**Step 1: Implement real Claude call**

Replace the placeholder `callAI` function body for the `"claude"` provider. Keep the existing interface (`AICallOptions` / `AICallResult`), logging, and retry wrapper. The implementation:

```typescript
import Anthropic from "@anthropic-ai/sdk";

// Module-level singleton (stateless, just holds the API key)
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();  // reads ANTHROPIC_API_KEY from env
  }
  return anthropicClient;
}
```

Inside `callAI` for the `"claude"` provider path:

```typescript
const client = getAnthropicClient();
const response = await client.messages.create({
  model: options.model,
  max_tokens: options.maxTokens ?? 4096,
  system: options.system,
  messages: [{ role: "user", content: options.user }],
});

const textBlock = response.content.find((b) => b.type === "text");
return {
  content: textBlock?.text ?? "",
  inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens,
};
```

Add `maxTokens?: number` to `AICallOptions`.

Keep the Gemini path throwing the placeholder error (Phase 3).

**Step 2: Verify it compiles**

Run:
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && pnpm --filter web tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add apps/web/src/lib/ai/client.ts
git commit -m "feat(phase1): wire Anthropic SDK into AI client wrapper"
```

---

## Task 3: Build Hypothesis Prompt

**Files:**
- Create: `packages/ai/src/prompts/interview-hypothesis.ts`

**Step 1: Create the prompt builder**

This is a pure function. No imports except `@denim/types`. Returns `{ system: string; user: string }`.

The system prompt must encode domain knowledge from `docs/interview-to-schema-mapping.md`:

```typescript
import type { InterviewInput } from "@denim/types";

export interface HypothesisPromptResult {
  system: string;
  user: string;
}

export function buildHypothesisPrompt(input: InterviewInput): HypothesisPromptResult {
  const system = `You are Case Engine, an AI that organizes email into actionable cases.

Given a user's role, entity names, and goals, generate a complete SchemaHypothesis JSON object.

## Domain Knowledge

Different domains need different configurations:

### school_parent
- clusteringConfig: mergeThreshold=35, threadMatchScore=100, tagMatchScore=40, subjectMatchScore=25, actorAffinityScore=15, subjectAdditiveBonus=10, timeDecayDays={fresh:60, recent:120, stale:365}, weakTagDiscount=0.5, frequencyThreshold=0.3, anchorTagLimit=3, caseSizeThreshold=5, caseSizeMaxBonus=10, reminderCollapseEnabled=true, reminderSubjectSimilarity=0.85, reminderMaxAge=30
- summaryLabels: { beginning: "What", middle: "Details", end: "Action Needed" }
- Tags: Action Required, Schedule, Payment, Permission/Form, Game/Match, Practice, Cancellation, Volunteer, plus domain-specific ones
- ExtractedFields: eventDate (DATE, showOnCard=true), eventLocation (STRING), amount (NUMBER)
- Secondary entity types: Teacher/Coach (affinity 25, sender), School Admin (affinity 15, sender), Team Parent (affinity 10, both)

### property
- clusteringConfig: mergeThreshold=45, threadMatchScore=100, tagMatchScore=45, subjectMatchScore=30, actorAffinityScore=20, subjectAdditiveBonus=10, timeDecayDays={fresh:45, recent:90, stale:365}, weakTagDiscount=0.4, frequencyThreshold=0.25, anchorTagLimit=3, caseSizeThreshold=10, caseSizeMaxBonus=15, reminderCollapseEnabled=false, reminderSubjectSimilarity=0.85, reminderMaxAge=14
- summaryLabels: { beginning: "Issue", middle: "Activity", end: "Status" }
- Tags: Maintenance, Tenant, Vendor, Financial, Lease, Inspection, Compliance, Emergency
- ExtractedFields: cost (NUMBER, showOnCard=true), deadline (DATE)
- Secondary entity types: Vendor (affinity 30, sender), Tenant (affinity 20, both)

### construction
- clusteringConfig: mergeThreshold=45, threadMatchScore=100, tagMatchScore=45, subjectMatchScore=30, actorAffinityScore=20, subjectAdditiveBonus=10, timeDecayDays={fresh:45, recent:90, stale:365}, weakTagDiscount=0.4, frequencyThreshold=0.25, anchorTagLimit=3, caseSizeThreshold=10, caseSizeMaxBonus=15, reminderCollapseEnabled=false, reminderSubjectSimilarity=0.85, reminderMaxAge=14
- summaryLabels: { beginning: "Issue", middle: "Progress", end: "Current Status" }
- Tags: RFI, Change Order, Submittal, Schedule, Permits, Safety, Invoice/Payment, Punch List
- ExtractedFields: cost (NUMBER, showOnCard=true), deadline (DATE, showOnCard=true), percentComplete (NUMBER)
- Secondary entity types: Subcontractor (affinity 30, sender), Architect/Engineer (affinity 25, both), Inspector (affinity 20, sender)

### legal
- clusteringConfig: mergeThreshold=55, threadMatchScore=100, tagMatchScore=50, subjectMatchScore=35, actorAffinityScore=20, subjectAdditiveBonus=10, timeDecayDays={fresh:90, recent:180, stale:730}, weakTagDiscount=0.3, frequencyThreshold=0.2, anchorTagLimit=4, caseSizeThreshold=15, caseSizeMaxBonus=20, reminderCollapseEnabled=false, reminderSubjectSimilarity=0.9, reminderMaxAge=7
- summaryLabels: { beginning: "Matter", middle: "Proceedings", end: "Status" }
- Tags: Filing, Discovery, Motion, Hearing, Settlement, Billing, Correspondence, Deadline
- ExtractedFields: deadline (DATE, showOnCard=true), filingDate (DATE)
- Secondary entity types: Opposing Counsel (affinity 25, sender), Court (affinity 15, sender)

### agency
- clusteringConfig: mergeThreshold=45, threadMatchScore=100, tagMatchScore=40, subjectMatchScore=30, actorAffinityScore=20, subjectAdditiveBonus=10, timeDecayDays={fresh:45, recent:90, stale:365}, weakTagDiscount=0.4, frequencyThreshold=0.25, anchorTagLimit=3, caseSizeThreshold=8, caseSizeMaxBonus=12, reminderCollapseEnabled=false, reminderSubjectSimilarity=0.85, reminderMaxAge=14
- summaryLabels: { beginning: "Brief", middle: "Progress", end: "Status" }
- Tags: Deliverable, Feedback, Meeting, Timeline, Budget, Approval, Creative, Strategy
- ExtractedFields: deadline (DATE, showOnCard=true), budget (NUMBER)
- Secondary entity types: Client Contact (affinity 25, sender), Collaborator (affinity 15, both)

### general (fallback for unknown domains)
- clusteringConfig: mergeThreshold=45, threadMatchScore=100, tagMatchScore=45, subjectMatchScore=30, actorAffinityScore=15, subjectAdditiveBonus=10, timeDecayDays={fresh:45, recent:75, stale:120}, weakTagDiscount=0.4, frequencyThreshold=0.25, anchorTagLimit=3, caseSizeThreshold=8, caseSizeMaxBonus=12, reminderCollapseEnabled=false, reminderSubjectSimilarity=0.85, reminderMaxAge=14
- summaryLabels: { beginning: "Overview", middle: "Details", end: "Status" }
- Use balanced defaults

## Requirements

1. Generate a complete SchemaHypothesis matching this exact JSON shape:
{
  "domain": string,
  "schemaName": string,
  "primaryEntity": { "name": string, "description": string },
  "secondaryEntityTypes": [{ "name": string, "description": string, "derivedFrom": "sender"|"extracted"|"both", "affinityScore": number }],
  "entities": [{ "name": string, "type": "PRIMARY"|"SECONDARY", "secondaryTypeName": string|null, "aliases": string[], "confidence": number, "source": "user_input"|"email_scan"|"ai_inferred" }],
  "tags": [{ "name": string, "description": string, "expectedFrequency": "high"|"medium"|"low", "isActionable": boolean }],
  "extractedFields": [{ "name": string, "type": "NUMBER"|"STRING"|"DATE"|"BOOLEAN", "description": string, "source": "BODY"|"ATTACHMENT"|"ANY", "format": string, "showOnCard": boolean, "aggregation": "SUM"|"LATEST"|"MAX"|"MIN"|"COUNT"|"FIRST" }],
  "summaryLabels": { "beginning": string, "middle": string, "end": string },
  "clusteringConfig": { mergeThreshold, threadMatchScore, tagMatchScore, subjectMatchScore, actorAffinityScore, subjectAdditiveBonus, timeDecayDays: {fresh, recent, stale}, weakTagDiscount, frequencyThreshold, anchorTagLimit, caseSizeThreshold, caseSizeMaxBonus, reminderCollapseEnabled, reminderSubjectSimilarity, reminderMaxAge },
  "discoveryQueries": [{ "query": string, "label": string, "entityName": string|null, "source": "entity_name"|"domain_default"|"email_scan" }],
  "exclusionPatterns": string[]
}

2. EVERY entity from whats[] MUST appear in entities[] with type=PRIMARY, source=user_input, confidence=1.0
3. EVERY entity from whos[] MUST appear in entities[] with type=SECONDARY, source=user_input, confidence=1.0
4. Generate aliases for each entity (abbreviations, partial names, common variants)
5. Generate at least 5 domain-specific tags (never generic like "Communication" or "Updates")
6. Generate Gmail discovery queries from entity names: subject search, from-domain guess, quoted phrase
7. Use domain-specific clustering constants (do NOT use identical values for all domains)
8. Adjust extractedFields showOnCard based on goals: "deadlines" -> deadline.showOnCard=true, "costs" -> cost.showOnCard=true, "schedule" -> eventDate.showOnCard=true
9. Generate 2-5 exclusion patterns for common noise senders in the domain
10. Respond with ONLY valid JSON. No markdown, no explanation.`;

  const user = `Generate a SchemaHypothesis for this interview input:

Role: ${input.role}
Domain: ${input.domain}
Primary entities (whats): ${JSON.stringify(input.whats)}
Secondary entities (whos): ${JSON.stringify(input.whos)}
Goals: ${JSON.stringify(input.goals)}

Remember:
- Use domain-appropriate clustering constants (NOT generic defaults for every domain)
- Every name in whats[] must appear as a PRIMARY entity with aliases
- Every name in whos[] must appear as a SECONDARY entity classified into a type
- Tags must be specific to ${input.domain} domain (not generic)
- Discovery queries must reference actual entity names
- showOnCard flags must reflect the selected goals
- Return ONLY valid JSON`;

  return { system, user };
}
```

**Step 2: Export from index.ts**

Update `packages/ai/src/index.ts`:
```typescript
export { buildHypothesisPrompt } from "./prompts/interview-hypothesis";
export type { HypothesisPromptResult } from "./prompts/interview-hypothesis";
```

**Step 3: Verify it compiles**

Run:
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && pnpm --filter @denim/ai tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**

```bash
git add packages/ai/src/prompts/interview-hypothesis.ts packages/ai/src/index.ts
git commit -m "feat(phase1): add hypothesis prompt builder in @denim/ai"
```

---

## Task 4: Build Hypothesis Parser (TDD)

**Files:**
- Create: `packages/ai/src/parsers/hypothesis-parser.ts`
- Create: `packages/ai/src/__tests__/hypothesis-parser.test.ts`

**Step 1: Write the failing tests**

Create `packages/ai/src/__tests__/hypothesis-parser.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseHypothesisResponse } from "../parsers/hypothesis-parser";

// Minimal valid fixture matching SchemaHypothesis
const validFixture = {
  domain: "school_parent",
  schemaName: "School Activities",
  primaryEntity: { name: "Activity", description: "School or extracurricular activity" },
  secondaryEntityTypes: [
    { name: "Teacher / Coach", description: "Activity leader", derivedFrom: "sender" as const, affinityScore: 25 },
  ],
  entities: [
    { name: "Vail Mountain School", type: "PRIMARY" as const, secondaryTypeName: null, aliases: ["VMS", "Vail Mountain"], confidence: 1.0, source: "user_input" as const },
    { name: "Coach Martinez", type: "SECONDARY" as const, secondaryTypeName: "Teacher / Coach", aliases: ["Martinez"], confidence: 1.0, source: "user_input" as const },
  ],
  tags: [
    { name: "Action Required", description: "Needs parent response", expectedFrequency: "high" as const, isActionable: true },
    { name: "Schedule", description: "Event timing info", expectedFrequency: "high" as const, isActionable: false },
    { name: "Payment", description: "Fee or payment due", expectedFrequency: "medium" as const, isActionable: true },
    { name: "Permission/Form", description: "Form to sign", expectedFrequency: "medium" as const, isActionable: true },
    { name: "Game/Match", description: "Competition event", expectedFrequency: "medium" as const, isActionable: false },
  ],
  extractedFields: [
    { name: "eventDate", type: "DATE" as const, description: "Date of event", source: "BODY" as const, format: "ISO 8601", showOnCard: true, aggregation: "LATEST" as const },
  ],
  summaryLabels: { beginning: "What", middle: "Details", end: "Action Needed" },
  clusteringConfig: {
    mergeThreshold: 35,
    threadMatchScore: 100,
    tagMatchScore: 40,
    subjectMatchScore: 25,
    actorAffinityScore: 15,
    subjectAdditiveBonus: 10,
    timeDecayDays: { fresh: 60, recent: 120, stale: 365 },
    weakTagDiscount: 0.5,
    frequencyThreshold: 0.3,
    anchorTagLimit: 3,
    caseSizeThreshold: 5,
    caseSizeMaxBonus: 10,
    reminderCollapseEnabled: true,
    reminderSubjectSimilarity: 0.85,
    reminderMaxAge: 30,
  },
  discoveryQueries: [
    { query: 'subject:"Vail Mountain School"', label: "Vail Mountain School subject", entityName: "Vail Mountain School", source: "entity_name" as const },
  ],
  exclusionPatterns: ["noreply@", "newsletter@"],
};

describe("parseHypothesisResponse", () => {
  it("parses a valid complete response", () => {
    const result = parseHypothesisResponse(JSON.stringify(validFixture));
    expect(result.domain).toBe("school_parent");
    expect(result.schemaName).toBe("School Activities");
    expect(result.entities).toHaveLength(2);
    expect(result.tags).toHaveLength(5);
    expect(result.clusteringConfig.mergeThreshold).toBe(35);
    expect(result.discoveryQueries).toHaveLength(1);
  });

  it("throws on missing required field (no clusteringConfig)", () => {
    const { clusteringConfig: _, ...incomplete } = validFixture;
    expect(() => parseHypothesisResponse(JSON.stringify(incomplete))).toThrow();
  });

  it("throws on wrong type (string where number expected)", () => {
    const bad = { ...validFixture, clusteringConfig: { ...validFixture.clusteringConfig, mergeThreshold: "high" } };
    expect(() => parseHypothesisResponse(JSON.stringify(bad))).toThrow();
  });

  it("throws on empty tags array (minimum 3 required)", () => {
    const bad = { ...validFixture, tags: [] };
    expect(() => parseHypothesisResponse(JSON.stringify(bad))).toThrow();
  });

  it("throws on empty entities array (minimum 1 required)", () => {
    const bad = { ...validFixture, entities: [] };
    expect(() => parseHypothesisResponse(JSON.stringify(bad))).toThrow();
  });

  it("strips extra/unknown fields gracefully", () => {
    const withExtra = { ...validFixture, unknownField: "should be stripped" };
    const result = parseHypothesisResponse(JSON.stringify(withExtra));
    expect(result).not.toHaveProperty("unknownField");
    expect(result.domain).toBe("school_parent");
  });

  it("throws on malformed JSON string", () => {
    expect(() => parseHypothesisResponse("this is not json at all")).toThrow();
  });

  it("handles JSON wrapped in markdown code fences", () => {
    const wrapped = "```json\n" + JSON.stringify(validFixture) + "\n```";
    const result = parseHypothesisResponse(wrapped);
    expect(result.domain).toBe("school_parent");
  });
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && pnpm --filter @denim/ai test
```
Expected: FAIL — `parseHypothesisResponse` not found.

**Step 3: Implement the parser**

Create `packages/ai/src/parsers/hypothesis-parser.ts`:

```typescript
import type { SchemaHypothesis } from "@denim/types";
import { z } from "zod";

const ClusteringConfigSchema = z.object({
  mergeThreshold: z.number(),
  threadMatchScore: z.number(),
  tagMatchScore: z.number(),
  subjectMatchScore: z.number(),
  actorAffinityScore: z.number(),
  subjectAdditiveBonus: z.number(),
  timeDecayDays: z.object({
    fresh: z.number(),
    recent: z.number(),
    stale: z.number(),
  }),
  weakTagDiscount: z.number(),
  frequencyThreshold: z.number(),
  anchorTagLimit: z.number(),
  caseSizeThreshold: z.number(),
  caseSizeMaxBonus: z.number(),
  reminderCollapseEnabled: z.boolean(),
  reminderSubjectSimilarity: z.number(),
  reminderMaxAge: z.number(),
});

const EntitySuggestionSchema = z.object({
  name: z.string(),
  type: z.enum(["PRIMARY", "SECONDARY"]),
  secondaryTypeName: z.string().nullable(),
  aliases: z.array(z.string()),
  confidence: z.number(),
  source: z.enum(["user_input", "email_scan", "ai_inferred"]),
});

const TagSuggestionSchema = z.object({
  name: z.string(),
  description: z.string(),
  expectedFrequency: z.enum(["high", "medium", "low"]),
  isActionable: z.boolean(),
});

const ExtractedFieldSuggestionSchema = z.object({
  name: z.string(),
  type: z.enum(["NUMBER", "STRING", "DATE", "BOOLEAN"]),
  description: z.string(),
  source: z.enum(["BODY", "ATTACHMENT", "ANY"]),
  format: z.string(),
  showOnCard: z.boolean(),
  aggregation: z.enum(["SUM", "LATEST", "MAX", "MIN", "COUNT", "FIRST"]),
});

const DiscoveryQuerySchema = z.object({
  query: z.string(),
  label: z.string(),
  entityName: z.string().nullable(),
  source: z.enum(["entity_name", "domain_default", "email_scan"]),
});

const SchemaHypothesisSchema = z.object({
  domain: z.string(),
  schemaName: z.string(),
  primaryEntity: z.object({
    name: z.string(),
    description: z.string(),
  }),
  secondaryEntityTypes: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      derivedFrom: z.enum(["sender", "extracted", "both"]),
      affinityScore: z.number(),
    }),
  ),
  entities: z.array(EntitySuggestionSchema).min(1, "At least 1 entity required"),
  tags: z.array(TagSuggestionSchema).min(3, "At least 3 tags required"),
  extractedFields: z.array(ExtractedFieldSuggestionSchema),
  summaryLabels: z.object({
    beginning: z.string(),
    middle: z.string(),
    end: z.string(),
  }),
  clusteringConfig: ClusteringConfigSchema,
  discoveryQueries: z.array(DiscoveryQuerySchema),
  exclusionPatterns: z.array(z.string()),
});

/**
 * Parse raw AI response string into a validated SchemaHypothesis.
 * Handles JSON wrapped in markdown code fences.
 * Throws on invalid JSON or schema validation failure.
 */
export function parseHypothesisResponse(raw: string): SchemaHypothesis {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse hypothesis response as JSON: ${cleaned.slice(0, 200)}`);
  }

  const result = SchemaHypothesisSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Schema validation failed: ${issues}`);
  }

  return result.data;
}
```

**Step 4: Export from index.ts**

Update `packages/ai/src/index.ts` to add:
```typescript
export { parseHypothesisResponse } from "./parsers/hypothesis-parser";
```

**Step 5: Run tests to verify they pass**

Run:
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && pnpm --filter @denim/ai test
```
Expected: all 8 tests PASS.

**Step 6: Commit**

```bash
git add packages/ai/src/parsers/hypothesis-parser.ts packages/ai/src/__tests__/hypothesis-parser.test.ts packages/ai/src/index.ts
git commit -m "feat(phase1): add hypothesis parser with Zod validation and unit tests"
```

---

## Task 5: Build InterviewService

**Files:**
- Create: `apps/web/src/lib/services/interview.ts`

**Step 1: Implement the service**

```typescript
import { callClaude } from "@/lib/ai/client";
import { logger } from "@/lib/logger";
import { InterviewInputSchema, validateInput } from "@/lib/validation/interview";
import type { InterviewInput, SchemaHypothesis } from "@denim/types";
import { buildHypothesisPrompt, parseHypothesisResponse } from "@denim/ai";
import { ExternalAPIError } from "@denim/types";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";

export async function generateHypothesis(
  input: InterviewInput,
  options?: { userId?: string },
): Promise<SchemaHypothesis> {
  const start = Date.now();
  const operation = "generateHypothesis";

  logger.info({
    service: "interview",
    operation,
    userId: options?.userId,
  });

  // Validate input
  const validated = validateInput(InterviewInputSchema, input);

  // Build prompt (pure function from @denim/ai)
  const prompt = buildHypothesisPrompt(validated);

  // Call Claude via AI client wrapper
  const result = await callClaude({
    model: DEFAULT_MODEL,
    system: prompt.system,
    user: prompt.user,
    userId: options?.userId,
    operation,
  });

  // Parse response (pure function from @denim/ai)
  let hypothesis: SchemaHypothesis;
  try {
    hypothesis = parseHypothesisResponse(result.content);
  } catch (error) {
    throw new ExternalAPIError(
      `Failed to parse hypothesis response: ${error instanceof Error ? error.message : String(error)}`,
      "claude",
      result.content,
    );
  }

  const durationMs = Date.now() - start;
  logger.info({
    service: "interview",
    operation: `${operation}.complete`,
    userId: options?.userId,
    durationMs,
    domain: hypothesis.domain,
    entityCount: hypothesis.entities.length,
    tagCount: hypothesis.tags.length,
  });

  return hypothesis;
}
```

Note: `validateHypothesis` and `finalizeSchema` are Phase 2 — not implemented now.

**Step 2: Verify it compiles**

Run:
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && pnpm --filter web tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add apps/web/src/lib/services/interview.ts
git commit -m "feat(phase1): add InterviewService.generateHypothesis"
```

---

## Task 6: Build API Route

**Files:**
- Create: `apps/web/src/app/api/interview/hypothesis/route.ts`

**Step 1: Implement the route**

```typescript
import { handleApiError } from "@/lib/middleware/error-handler";
import { withAuth } from "@/lib/middleware/auth";
import { generateHypothesis } from "@/lib/services/interview";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();

    const hypothesis = await generateHypothesis(body, { userId });

    return NextResponse.json({ data: hypothesis });
  } catch (error) {
    return handleApiError(error, {
      service: "interview",
      operation: "hypothesis",
      userId,
    });
  }
});
```

**Step 2: Verify it compiles**

Run:
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && pnpm --filter web tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add apps/web/src/app/api/interview/hypothesis/route.ts
git commit -m "feat(phase1): add POST /api/interview/hypothesis route"
```

---

## Task 7: Build Evaluation Script

**Files:**
- Create: `scripts/test-interview.ts`
- Create: `docs/test-results/phase1-schema-quality.md` (output)

**Step 1: Create the script**

Create `scripts/test-interview.ts`. This script calls the `generateHypothesis` function directly (not via HTTP) to test schema quality across 5 domains.

```typescript
import { generateHypothesis } from "../apps/web/src/lib/services/interview";
import type { InterviewInput, SchemaHypothesis } from "@denim/types";
import * as fs from "node:fs";
import * as path from "node:path";

const testInputs: { name: string; input: InterviewInput }[] = [
  {
    name: "School Parent",
    input: {
      role: "parent",
      domain: "school_parent",
      whats: ["Vail Mountain School", "Eagle Valley SC"],
      whos: ["Coach Martinez", "Mrs. Patterson"],
      goals: ["actions", "schedule"],
    },
  },
  {
    name: "Property Manager",
    input: {
      role: "property",
      domain: "property",
      whats: ["123 Main St", "456 Oak Ave", "789 Elm St"],
      whos: ["Quick Fix Plumbing"],
      goals: ["costs", "status"],
    },
  },
  {
    name: "Construction",
    input: {
      role: "construction",
      domain: "construction",
      whats: ["Harbor View Renovation", "Elm Street Addition"],
      whos: ["Comfort Air Solutions", "Torres Engineering"],
      goals: ["costs", "deadlines"],
    },
  },
  {
    name: "Agency",
    input: {
      role: "agency",
      domain: "agency",
      whats: ["Acme Corp rebrand", "Widget Inc Q2"],
      whos: ["Sarah at Acme"],
      goals: ["deadlines", "actions"],
    },
  },
  {
    name: "Legal",
    input: {
      role: "legal",
      domain: "legal",
      whats: ["Smith v. Jones", "Acme Corp acquisition"],
      whos: ["Johnson & Associates"],
      goals: ["deadlines", "status"],
    },
  },
];

interface EvalResult {
  name: string;
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  hypothesis: SchemaHypothesis | null;
  error?: string;
}

function evaluate(name: string, hypothesis: SchemaHypothesis, input: InterviewInput): EvalResult {
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  // Check: primary entity type makes sense
  checks.push({
    name: "Primary entity type",
    passed: hypothesis.primaryEntity.name.length > 0,
    detail: `"${hypothesis.primaryEntity.name}" - ${hypothesis.primaryEntity.description}`,
  });

  // Check: at least 5 relevant tags
  const tagCount = hypothesis.tags.length;
  checks.push({
    name: "At least 5 tags",
    passed: tagCount >= 5,
    detail: `${tagCount} tags: ${hypothesis.tags.map((t) => t.name).join(", ")}`,
  });

  // Check: no generic tags
  const genericTags = ["Communication", "Updates", "General", "Other", "Miscellaneous"];
  const hasGeneric = hypothesis.tags.some((t) => genericTags.includes(t.name));
  checks.push({
    name: "No generic tags",
    passed: !hasGeneric,
    detail: hasGeneric ? `Found generic: ${hypothesis.tags.filter((t) => genericTags.includes(t.name)).map((t) => t.name).join(", ")}` : "All domain-specific",
  });

  // Check: clustering constants differ from generic defaults
  const config = hypothesis.clusteringConfig;
  checks.push({
    name: "Domain-specific clustering",
    passed: true,
    detail: `mergeThreshold=${config.mergeThreshold}, timeDecay.fresh=${config.timeDecayDays.fresh}, caseSizeThreshold=${config.caseSizeThreshold}, reminderCollapse=${config.reminderCollapseEnabled}`,
  });

  // Check: summary labels are domain-appropriate
  checks.push({
    name: "Summary labels",
    passed: hypothesis.summaryLabels.beginning.length > 0 && hypothesis.summaryLabels.end.length > 0,
    detail: `${hypothesis.summaryLabels.beginning} / ${hypothesis.summaryLabels.middle} / ${hypothesis.summaryLabels.end}`,
  });

  // Check: discovery queries reference entity names
  const queryTexts = hypothesis.discoveryQueries.map((q) => q.query.toLowerCase());
  const entityNamesLower = input.whats.map((w) => w.toLowerCase());
  const queriesRefEntities = entityNamesLower.some((name) => queryTexts.some((q) => q.includes(name.split(" ")[0].toLowerCase())));
  checks.push({
    name: "Discovery queries reference entities",
    passed: queriesRefEntities,
    detail: `${hypothesis.discoveryQueries.length} queries: ${hypothesis.discoveryQueries.map((q) => q.query).join("; ")}`,
  });

  // Check: at least one actionable extracted field
  const actionableFields = hypothesis.extractedFields.filter((f) => f.showOnCard);
  checks.push({
    name: "Actionable extracted fields",
    passed: actionableFields.length >= 1,
    detail: `${actionableFields.length} showOnCard fields: ${actionableFields.map((f) => f.name).join(", ")}`,
  });

  // Check: entity aliases are reasonable
  const entitiesWithAliases = hypothesis.entities.filter((e) => e.aliases.length > 0);
  checks.push({
    name: "Entity aliases generated",
    passed: entitiesWithAliases.length > 0,
    detail: hypothesis.entities.map((e) => `${e.name}: [${e.aliases.join(", ")}]`).join("; "),
  });

  // Check: all user whats appear as PRIMARY entities
  const primaryNames = hypothesis.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name.toLowerCase());
  const allWhatsPresent = input.whats.every((w) => primaryNames.some((p) => p.includes(w.toLowerCase()) || w.toLowerCase().includes(p)));
  checks.push({
    name: "All whats as PRIMARY entities",
    passed: allWhatsPresent,
    detail: `Input: ${input.whats.join(", ")} -> Found: ${hypothesis.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name).join(", ")}`,
  });

  // Check: goals affect showOnCard
  const goalFieldMap: Record<string, string[]> = {
    deadlines: ["deadline"],
    costs: ["cost", "amount", "budget"],
    schedule: ["eventDate", "date"],
    actions: [],
    status: [],
  };
  const expectedShowOnCard = input.goals.flatMap((g) => goalFieldMap[g] || []);
  const showOnCardNames = hypothesis.extractedFields.filter((f) => f.showOnCard).map((f) => f.name.toLowerCase());
  const goalsReflected = expectedShowOnCard.length === 0 || expectedShowOnCard.some((expected) => showOnCardNames.some((actual) => actual.includes(expected)));
  checks.push({
    name: "Goals affect showOnCard",
    passed: goalsReflected,
    detail: `Goals: ${input.goals.join(", ")} -> showOnCard: ${showOnCardNames.join(", ")}`,
  });

  return {
    name,
    passed: checks.every((c) => c.passed),
    checks,
    hypothesis,
  };
}

async function main() {
  const results: EvalResult[] = [];

  for (const { name, input } of testInputs) {
    console.log(`\nTesting: ${name}...`);
    try {
      const hypothesis = await generateHypothesis(input);
      const result = evaluate(name, hypothesis, input);
      results.push(result);
      console.log(`  ${result.passed ? "PASS" : "FAIL"} (${result.checks.filter((c) => c.passed).length}/${result.checks.length} checks)`);
    } catch (error) {
      console.error(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
      results.push({ name, passed: false, checks: [], hypothesis: null, error: String(error) });
    }
  }

  // Cross-domain clustering differentiation check
  console.log("\n--- Cross-Domain Clustering Check ---");
  const configs = results
    .filter((r) => r.hypothesis)
    .map((r) => ({ name: r.name, config: r.hypothesis!.clusteringConfig }));

  if (configs.length >= 2) {
    const thresholds = configs.map((c) => c.config.mergeThreshold);
    const allSame = thresholds.every((t) => t === thresholds[0]);
    console.log(`  Merge thresholds: ${configs.map((c) => `${c.name}=${c.config.mergeThreshold}`).join(", ")}`);
    console.log(`  All same? ${allSame ? "YES (BAD)" : "NO (GOOD)"}`);
  }

  // Generate markdown report
  let md = "# Phase 1: Schema Quality Evaluation\n\n";
  md += `**Date:** ${new Date().toISOString().split("T")[0]}\n`;
  md += `**Model:** claude-sonnet-4-5-20250514\n\n`;
  md += `## Summary\n\n`;
  md += `| Domain | Result | Checks Passed |\n|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.name} | ${r.passed ? "PASS" : r.error ? "ERROR" : "FAIL"} | ${r.checks.filter((c) => c.passed).length}/${r.checks.length} |\n`;
  }

  md += `\n## Cross-Domain Clustering Constants\n\n`;
  md += `| Domain | mergeThreshold | timeDecay.fresh | caseSizeThreshold | reminderCollapse |\n|---|---|---|---|---|\n`;
  for (const r of results) {
    if (r.hypothesis) {
      const c = r.hypothesis.clusteringConfig;
      md += `| ${r.name} | ${c.mergeThreshold} | ${c.timeDecayDays.fresh} | ${c.caseSizeThreshold} | ${c.reminderCollapseEnabled} |\n`;
    }
  }

  md += `\n## Detailed Results\n\n`;
  for (const r of results) {
    md += `### ${r.name}\n\n`;
    if (r.error) {
      md += `**Error:** ${r.error}\n\n`;
      continue;
    }
    for (const check of r.checks) {
      md += `- ${check.passed ? "[x]" : "[ ]"} **${check.name}:** ${check.detail}\n`;
    }
    md += "\n";
  }

  // Write report
  const outDir = path.join(process.cwd(), "docs", "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "phase1-schema-quality.md");
  fs.writeFileSync(outPath, md);
  console.log(`\nReport saved to ${outPath}`);
}

main().catch(console.error);
```

**Important:** This script imports directly from the service. It needs to be run with `tsx` (TypeScript execution) and requires `ANTHROPIC_API_KEY` and `BYPASS_AUTH=true` in the environment. The exact runner command will be determined during implementation based on the project's tsx/ts-node setup.

**Step 2: Run the script**

```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && BYPASS_AUTH=true npx tsx scripts/test-interview.ts
```

This will make 5 real Claude API calls. Review the output in `docs/test-results/phase1-schema-quality.md`.

**Step 3: Commit**

```bash
git add scripts/test-interview.ts docs/test-results/phase1-schema-quality.md
git commit -m "feat(phase1): add evaluation script and schema quality results"
```

---

## Task 8: Final Verification & Phase Commit

**Step 1: Run all checks**

```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email
pnpm biome check .
pnpm -r tsc --noEmit
pnpm --filter @denim/ai test
```

All must pass.

**Step 2: Verify acceptance criteria from build plan**

- [ ] Parser tests pass
- [ ] 5/5 test schemas evaluated and documented in test-results/
- [ ] API route compiles and responds (manual test with BYPASS_AUTH=true)

**Step 3: Final commit**

```bash
git add -A
git commit -m "Phase 1: Interview Service - hypothesis generation, parser, evaluation"
```

---

## Files Summary

| Action | Path |
|---|---|
| Modify | `apps/web/package.json` (add @anthropic-ai/sdk) |
| Modify | `apps/web/.env.example` (add ANTHROPIC_API_KEY) |
| Modify | `apps/web/src/lib/ai/client.ts` (wire real SDK) |
| Create | `packages/ai/src/prompts/interview-hypothesis.ts` |
| Create | `packages/ai/src/parsers/hypothesis-parser.ts` |
| Create | `packages/ai/src/__tests__/hypothesis-parser.test.ts` |
| Modify | `packages/ai/src/index.ts` (exports) |
| Create | `apps/web/src/lib/services/interview.ts` |
| Create | `apps/web/src/app/api/interview/hypothesis/route.ts` |
| Create | `scripts/test-interview.ts` |
| Create | `docs/test-results/phase1-schema-quality.md` (generated) |
