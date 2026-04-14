# Perf + Quality Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan issue-by-issue. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land safety-net resilience, then perf speedups, then quality fixes, then test automation — in the order explicitly chosen by Nick on 2026-04-14. Tests are intentionally deferred to the end because the surface area will change substantially before then.

**Architecture:** Phase-based sprint. Each phase closes 1–5 GitHub issues. Between phases there is a mandatory verification gate: manual E2E onboarding run (both `school_parent` and `property` schemas) plus structured-log timing analysis via the `onboarding-timing` skill. No phase advances until its verification passes.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict / Prisma / Supabase / Inngest / Anthropic (Claude Opus + Sonnet) / Gemini 2.5 Flash / Vitest / Playwright / Biome.

**Issue order (locked):** 69, 70, 79, 80, 81, 77, 78, 82, 63, 73, 25, 35, 38, 65, 75, 57, 71, 72, 66.

**Why tests last:** The perf and quality phases will move extraction prompts, Inngest function boundaries, synthesis parallelism, and orphan-mining surfaces. Writing Playwright/integration coverage before those land means rewriting it after each phase. Manual E2E + telemetry is the safety net during the shake-up; automated tests codify the *final* shape.

---

## Execution Progress

**Branch:** `feature/perf-quality-sprint` (off `main`, after `feature/ux-overhaul` merged as PR #83 on 2026-04-14).

**Session 1 — 2026-04-14 (sprint kickoff):**

| Phase / Task | Issue | Commit | Status | Notes |
|---|---|---|---|---|
| 1.1 Idempotency audit + retries 0→2 | #69 | `173f7ab` | ✅ DONE | Found 1 NEEDS GUARD: `create-scan-job` now has findFirst-and-reuse guard. Audit table in commit body. |
| 1.2 validation-parser tests | #70 | `9a658fd` | ✅ DONE | +5 tests in `packages/ai/src/__tests__/validation-parser.test.ts`. Suite 139→144. |
| Phase 1 quick gate | — | — | ✅ PASS | typecheck clean, 144/144 tests. Full E2E pending Nick's run. |
| 2.1 Prompt caching validateHypothesis | #79 | `45cb490` | ✅ DONE (infra) | Static/dynamic split, cache_control wired. **Caveat:** ~500 tokens < Sonnet 4.6's 1024-token minimum — cache won't activate until prefix grows. Zero cost when inactive; lights up automatically later. |
| 2.2 Parallel generate-hypothesis + sampleScan | #80 | `2ddb60c` | ✅ DONE | sampleScan extracted to sibling `gmail-sample-scan` step; both wrapped in `Promise.all`. |
| 2.3 Parallel discovery queries | #81 | `0884cee` | ✅ DONE | `p-limit@7.3.0` added; concurrency=3 with `.slice(0, cap)` trim. |
| Phase 2 quick gate | — | — | ✅ PASS | typecheck clean, 144/144 tests. Full E2E pending. |

**Follow-ups filed this session:**
- **#84** Harden `GmailMessageMeta.date` against Inngest JSON-replay (Date field loses type on retry). Non-blocking; latent-only risk today.

**Next action on resume:**
- Nick runs full E2E on both schemas (school_parent 80 emails + property 200 emails), captures structured logs, invokes `/onboarding-timing` to compare against baseline (Function A ~40s / Function B ~9m). Measurement gates Phase 3 kickoff.
- If E2E clean → dispatch Task 3.1 (#77 Gemini batch extraction).
- If regression → bisect across `45cb490 → 2ddb60c → 0884cee`.

---

## Verification Protocol (runs between every phase)

This is the gate. Do not advance to the next phase until all of the following pass.

### 1. Typecheck + unit tests (cheap, always)

```bash
pnpm typecheck
pnpm -r test
```

Expected: 0 TS errors, all package unit tests green (baseline 133 tests as of 2026-04-14).

### 2. Structured-log E2E run (manual, two schemas)

Start servers:

```bash
pnpm --filter web dev
npx inngest-cli@latest dev
```

Run onboarding twice via the UI:

- **Run A — school_parent schema:** WHATs = `soccer, dance, lanier, st agnes, guitar`. Expect ~80 emails, 4 cases.
- **Run B — property schema:** WHATs = property addresses from the fixture account. Expect ~200 emails, ~16 cases.

Capture Function A structured logs (`service=runOnboarding`) and the `stepDurationMs` fields emitted by `fcc8420` telemetry. Parse with the `onboarding-timing` skill:

```
/onboarding-timing
```

(Paste the JSON log lines when the skill prompts.)

### 3. Perf budget check

Compare Function A and Function B wall-clock against the baseline and the phase target. Record the number in the phase's verification block below.

| Baseline (2026-04-14) | Run A Function A | Run B Function B |
|---|---|---|
| Pre-sprint | ~40s | ~9 min |
| After Phase 2 target | ~25s | ~9 min |
| After Phase 3 target | ~25s | ~3m 40s |

### 4. Eval rubric (6/6 PASS)

Run the existing eval script against both schemas. All 6 criteria must PASS (tag coverage 100%, orphan rate 0 unless orphan-mining phase, exclusion rate sane, case count within expected range, no accounting mismatch, no silent drops).

### 5. Inngest event log review

Open the Inngest dev dashboard. For each run, confirm:
- No failed steps left behind
- Outbox events (`onboarding.session.started`, `onboarding.review.confirmed`) both show `attempts=1` and status EMITTED
- No duplicate Entity, Case, or ScanJob rows (query via the `supabase-db` skill)

### 6. Commit at phase boundary

At the end of each phase, commit with a message that references the issues closed: `feat(perf): phase 2 close #79 #80 #81`.

---

## Phase 1 — Safety foundations (#69, #70)

**Why first:** Before any perf refactor, retries must be safe (Bug 6 in `docs/01_denim_lessons_learned.md` — Inngest step re-execution can silently double-write). And `relatedUserThing` is about to get touched further by #66 at the end of the sprint; locking its parser contract now prevents drift during phases 2–5.

### Task 1.1: #69 — Step-level idempotency audit, then retries 0 → 2

**Files:**
- Audit: `apps/web/src/lib/inngest/onboarding.ts` (all `step.run` blocks in `runOnboarding` and `runOnboardingPipeline`)
- Modify: `apps/web/src/lib/inngest/onboarding.ts` (function configs — `retries: 2`)
- Possibly modify: step bodies where an idempotency guard is missing

- [ ] **Step 1: Enumerate every `step.run` in both functions**

Open `apps/web/src/lib/inngest/onboarding.ts`. For each `step.run("<name>", ...)` block in `runOnboarding` (Function A) and `runOnboardingPipeline` (Function B), write a one-line assessment in a scratch note:

- Step name
- Side effects (DB writes, event emits, external API calls)
- Existing idempotency guard (CAS updateMany, upsert, `skip if already present`, etc.)
- Retry safety verdict: **SAFE** / **NEEDS GUARD** / **NON-IDEMPOTENT-BY-DESIGN (accept repeated cost)**

Known from audit on 2026-04-14 (status doc):
- `validate-hypothesis` — has skip guard (reads `schema.validation`) → SAFE
- `expand-confirmed-domains` — uses `entity.upsert` per #68 fix in 17fcec8 → SAFE
- `create-scan-job` — has `resolve-scan-job` fallback → SAFE
- CAS phase advances (`advance-to-awaiting-review`, `advance-to-completed`, `advance-to-no-emails-found`) → SAFE (updateMany with phase WHERE clause)

- [ ] **Step 2: For any step marked NEEDS GUARD, add a guard first**

Pattern:
```ts
await step.run("step-name", async () => {
  // At top: check if this step already completed for this schemaId
  const existing = await prisma.<table>.findFirst({ where: { schemaId, <signal> } });
  if (existing) return existing;
  // ... work ...
});
```

If no NEEDS GUARD steps were found (expected), skip to Step 3.

- [ ] **Step 3: Flip the retry count on both functions**

In `apps/web/src/lib/inngest/onboarding.ts`:

```ts
export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    retries: 2,  // was: 0. Step-level idempotency audited 2026-04-14, see plan Phase 1.
    // ... rest
  },
  // ...
);

export const runOnboardingPipeline = inngest.createFunction(
  {
    id: "run-onboarding-pipeline",
    retries: 2,  // was: 0. Step-level idempotency audited 2026-04-14, see plan Phase 1.
    // ... rest
  },
  // ...
);
```

- [ ] **Step 4: Force a transient failure and watch recovery**

With Inngest dev server running, temporarily throw in one step body (`throw new Error("test-transient")` wrapped in a condition that only fires once):

```ts
// TEMP: force one failure to validate retry
const attempt = (globalThis as any).__retryTest ??= { count: 0 };
if (attempt.count++ === 0) throw new Error("test-transient");
```

Run onboarding once. Expected in Inngest dashboard: the step shows 1 failure + 1 success on retry. No duplicate DB writes (spot-check via `supabase-db` skill).

Remove the temp throw.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/inngest/onboarding.ts
git commit -m "feat(inngest): bump onboarding retries 0 -> 2 after idempotency audit (closes #69)"
```

### Task 1.2: #70 — validation-parser tests

**Files:**
- Create: `packages/ai/src/__tests__/validation-parser.test.ts`
- Fixture (if needed): `packages/ai/src/__tests__/fixtures/validation-response.json`

- [ ] **Step 1: Write the failing tests**

Create `packages/ai/src/__tests__/validation-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseValidationResponse } from "../parsers/validation-parser";

describe("validation-parser: relatedUserThing", () => {
  const base = {
    confidenceScore: 0.9,
    discoveredEntities: [],
    confirmedEntities: [],
    suggestedTags: [],
    exclusionRules: [],
  };

  it("parses explicit relatedUserThing", () => {
    const input = {
      ...base,
      discoveredEntities: [
        { name: "ZSA U11/12", type: "SECONDARY", confidence: 0.9, relatedUserThing: "soccer" },
      ],
    };
    const parsed = parseValidationResponse(JSON.stringify(input));
    expect(parsed.discoveredEntities[0].relatedUserThing).toBe("soccer");
  });

  it("defaults to null when omitted", () => {
    const input = {
      ...base,
      discoveredEntities: [
        { name: "TeamSnap", type: "SECONDARY", confidence: 0.8 },
      ],
    };
    const parsed = parseValidationResponse(JSON.stringify(input));
    expect(parsed.discoveredEntities[0].relatedUserThing).toBeNull();
  });

  it("accepts explicit null", () => {
    const input = {
      ...base,
      discoveredEntities: [
        { name: "Amy DiCarlo", type: "SECONDARY", confidence: 0.7, relatedUserThing: null },
      ],
    };
    const parsed = parseValidationResponse(JSON.stringify(input));
    expect(parsed.discoveredEntities[0].relatedUserThing).toBeNull();
  });

  it("rejects wrong type", () => {
    const input = {
      ...base,
      discoveredEntities: [
        { name: "X", type: "SECONDARY", confidence: 0.7, relatedUserThing: 123 },
      ],
    };
    expect(() => parseValidationResponse(JSON.stringify(input))).toThrow();
  });

  it("round-trips through parse -> stringify -> parse", () => {
    const input = {
      ...base,
      discoveredEntities: [
        { name: "ZSA", type: "SECONDARY", confidence: 0.9, relatedUserThing: "soccer" },
        { name: "Rental Properties", type: "PRIMARY", confidence: 0.85, relatedUserThing: null },
      ],
    };
    const first = parseValidationResponse(JSON.stringify(input));
    const second = parseValidationResponse(JSON.stringify(first));
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 2: Run and verify failures (if any)**

```bash
pnpm --filter @denim/ai test validation-parser
```

Expected: all 5 pass if the parser already does the right thing (it should per 2026-04-13 work). If any fail, the parser is the bug — fix it per the existing Zod schema at `packages/ai/src/parsers/validation-parser.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/__tests__/validation-parser.test.ts
git commit -m "test(ai): relatedUserThing default-null + round-trip (closes #70)"
```

### Phase 1 verification gate

- [ ] Run the full verification protocol above
- [ ] Record Function A wall-clock in a phase-log table (below)
- [ ] Both schemas pass 6/6 eval
- [ ] No new duplicate rows in Entity/Case/ScanJob tables
- [ ] Commit phase-boundary note if any follow-ups surfaced

Phase 1 log:

| Metric | Run A | Run B |
|---|---|---|
| Function A wall-clock | | |
| Function B wall-clock | | |
| Eval PASS count | | |
| Notes | | |

---

## Phase 2 — Cheap perf wins (#79, #80, #81)

**Why now:** Three independent speedups with low blast radius. Expected combined savings: ~35s off Function A + Function B wall-clock. Each can land in isolation — run the verification gate after each if you want tight feedback, or batch them and run once at phase end.

### Task 2.1: #79 — Anthropic prompt caching on validateHypothesis

**Files:**
- Modify: `apps/web/src/lib/ai/client.ts` (`callClaude` — accept `cacheableSystemPrompt`)
- Modify: `packages/ai/src/prompts/interview-validate.ts` (split static prefix / dynamic suffix)
- Modify: `apps/web/src/lib/services/interview.ts` (pass the option through)
- Modify: `apps/web/src/lib/inngest/onboarding.ts` (validate-hypothesis + expand-confirmed-domains call sites)

**Required sub-skill:** Invoke the `claude-api` skill for current Anthropic SDK `cache_control` usage.

- [ ] **Step 1: Invoke claude-api skill for cache_control guidance**

```
/claude-api
```

Read the prompt-caching section. Confirm the current SDK pattern for marking a system-prompt prefix as `ephemeral`.

- [ ] **Step 2: Split the validate prompt**

In `packages/ai/src/prompts/interview-validate.ts`, return two strings instead of one:

```ts
export function buildValidatePrompt(input: ValidatePromptInput): { systemStatic: string; systemDynamic: string; user: string } {
  const systemStatic = `You are a validator...
<rules about grounding, alias detection, relatedUserThing, noise vs entity, output schema>`;

  const systemDynamic = `User's topics: ${input.userThings.join(", ")}
Existing entities: ${input.entities.map(...).join("\n")}`;

  const user = `Email samples:\n${input.samples.map(...).join("\n\n")}`;

  return { systemStatic, systemDynamic, user };
}
```

- [ ] **Step 3: Extend callClaude to accept a cacheable prefix**

In `apps/web/src/lib/ai/client.ts`:

```ts
export interface CallClaudeOptions {
  // ... existing ...
  cacheableSystemPrompt?: { static: string; dynamic: string };
}

// Inside callClaude:
const system = options.cacheableSystemPrompt
  ? [
      { type: "text" as const, text: options.cacheableSystemPrompt.static, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: options.cacheableSystemPrompt.dynamic },
    ]
  : [{ type: "text" as const, text: options.system ?? "" }];

// ... pass `system` into messages.create ...
```

- [ ] **Step 4: Log cache hit/miss metadata**

Capture `response.usage.cache_read_input_tokens` and `cache_creation_input_tokens`:

```ts
logger.info("claude.call.complete", {
  model, durationMs, inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens,
  cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
  cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
});
```

- [ ] **Step 5: Wire the option at the two call sites**

In `apps/web/src/lib/services/interview.ts::validateHypothesis`, pass `cacheableSystemPrompt: { static, dynamic }` through to `callClaude`. Same in Function B's `expand-confirmed-domains` step.

- [ ] **Step 6: Run twice, measure**

Run onboarding end-to-end, then wipe (via `supabase-db` skill) and run again. Inspect log lines:

- Run 1 validate-hypothesis: expect `cacheCreationInputTokens > 0`, `cacheReadInputTokens = 0`
- Run 2 validate-hypothesis: expect `cacheReadInputTokens > 0`, shorter `durationMs`

Target: validate-hypothesis step drops from ~15–20s to ~8–10s on warm cache.

- [ ] **Step 7: Commit**

```bash
git add apps/web packages/ai
git commit -m "perf(ai): prompt caching on validateHypothesis system prefix (closes #79)"
```

### Task 2.2: #80 — Parallelize generate-hypothesis + gmail.sampleScan

**Files:**
- Modify: `apps/web/src/lib/inngest/onboarding.ts` (Function A step layout)

- [ ] **Step 1: Restructure the two steps to run as sibling step.run calls in Promise.all**

Current shape (serial):

```ts
const hypothesis = await step.run("generate-hypothesis", async () => { ... });
const samples = await step.run("gmail-sample-scan", async () => { ... });
const validation = await step.run("validate-hypothesis", async () => {
  return validateHypothesis(hypothesis, samples, ...);
});
```

New shape (parallel siblings):

```ts
const [hypothesis, samples] = await Promise.all([
  step.run("generate-hypothesis", async () => { ... }),
  step.run("gmail-sample-scan", async () => { ... }),
]);
const validation = await step.run("validate-hypothesis", async () => {
  return validateHypothesis(hypothesis, samples, ...);
});
```

Inngest supports `Promise.all([step.run(...), step.run(...)])` for sibling parallelism with independent retries.

- [ ] **Step 2: Confirm via onboarding-timing skill**

After a run, check the timeline: `generate-hypothesis` and `gmail-sample-scan` should overlap (their `startedAt` should be within a few ms of each other; both finish before `validate-hypothesis` starts).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/inngest/onboarding.ts
git commit -m "perf(onboarding): parallelize generate-hypothesis + gmail.sampleScan (closes #80)"
```

### Task 2.3: #81 — Parallelize discovery query execution

**Files:**
- Modify: `apps/web/src/lib/services/discovery.ts` (parallel query loop with bounded concurrency)

- [ ] **Step 1: Replace serial loop with bounded Promise.all**

Current shape (in `apps/web/src/lib/services/discovery.ts` — the loop that iterates `hypothesis.discoveryQueries`): serial await per query.

Replace with:

```ts
import pLimit from "p-limit";

async function runQueriesParallel(
  queries: DiscoveryQuery[],
  cap: number,
  gmail: GmailClient,
): Promise<EmailMeta[]> {
  const limit = pLimit(3);
  let remaining = cap;
  const results: EmailMeta[] = [];
  await Promise.all(
    queries.map((q) =>
      limit(async () => {
        if (remaining <= 0) return;
        const got = await gmail.searchEmails(q.query, Math.min(q.limit, remaining));
        remaining -= got.length;
        results.push(...got);
      }),
    ),
  );
  return results.slice(0, cap);
}
```

Check if `p-limit` is already a dep — if not, add it to `apps/web/package.json`.

- [ ] **Step 2: Confirm email count still matches the cap**

Run property schema. Assert discovered email count == the existing cap (200). Cases/entities output should be identical shape to pre-change (timing aside).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/services/discovery.ts apps/web/package.json pnpm-lock.yaml
git commit -m "perf(scan): parallelize discovery query execution (closes #81)"
```

### Phase 2 verification gate

- [ ] Run the full verification protocol
- [ ] Function A target: ~25s (was ~40s) — cumulative effect of #79 + #80
- [ ] run-scan target: ~15s (was ~38s) — effect of #81
- [ ] Both schemas 6/6 eval PASS
- [ ] No regressions in tag coverage, orphan rate, case count

Phase 2 log:

| Metric | Baseline | After #79 | After #80 | After #81 |
|---|---|---|---|---|
| Function A wall-clock | ~40s | | | |
| validate-hypothesis step | ~18s | | — | — |
| run-scan step | ~38s | — | — | |
| Eval PASS | 6/6 | | | |

---

## Phase 3 — Big perf (#77, #78, #82)

**Why now:** With cheap wins in, attack the two biggest serial bottlenecks (Gemini extraction, Claude synthesis+splitting) and then wire the live counter UX that piggybacks on #78's per-case hook.

### Task 3.1: #77 — Gemini batch extraction (5–10 emails per call)

**Files:**
- Modify: `apps/web/src/lib/services/extraction.ts` (processEmailBatch main loop)
- Modify: `packages/ai/src/prompts/extraction.ts` (prompt expects multi-email input array)
- Modify: `packages/ai/src/parsers/extraction-parser.ts` (array output schema + length validation)
- Modify: `packages/ai/src/__tests__/extraction-parser.test.ts` (update + batch-array fixtures)

- [ ] **Step 1: Rewrite the extraction prompt to accept an array**

In `packages/ai/src/prompts/extraction.ts`, change the prompt template so the input is:

```
Emails to extract (return a JSON array of results, one per input, same order):

[0] subject: ...
    from: ...
    body: ...

[1] subject: ...
    ...
```

The prompt MUST instruct Gemini to return `[{ index: 0, ...extraction }, { index: 1, ...extraction }, ...]`.

- [ ] **Step 2: Update the parser to accept an array of extraction results**

In `packages/ai/src/parsers/extraction-parser.ts`, add:

```ts
export const BatchExtractionSchema = z.array(SingleExtractionSchema.extend({ index: z.number().int().nonnegative() }));

export function parseBatchExtraction(raw: string, expectedCount: number): ExtractionResult[] {
  const parsed = BatchExtractionSchema.parse(JSON.parse(raw));
  if (parsed.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} extraction results, got ${parsed.length}`);
  }
  // Sort by index to restore original order
  return parsed.sort((a, b) => a.index - b.index).map(({ index, ...rest }) => rest);
}
```

- [ ] **Step 3: Pack emails into batches of 5 in `processEmailBatch`**

In `apps/web/src/lib/services/extraction.ts`, replace the per-email Gemini call with a chunked call:

```ts
const CHUNK_SIZE = 5; // Start at 5. If quality holds after measurement, raise to 10.

for (const chunk of chunksOf(messages, CHUNK_SIZE)) {
  try {
    const prompt = buildBatchExtractionPrompt(chunk, schema);
    const raw = await callGemini(prompt);
    const results = parseBatchExtraction(raw, chunk.length);
    // ... persist results paired by index back to chunk[i] ...
  } catch (err) {
    // Quarantine: fall back to per-email for this chunk
    logger.warn("extraction.batch.fallback", { chunkSize: chunk.length, error: String(err) });
    for (const msg of chunk) { /* existing per-email path */ }
  }
}
```

Implementation note: keep per-email fallback as the quarantine path so one malformed result doesn't kill a chunk.

- [ ] **Step 4: Update tests with batch fixtures**

In `packages/ai/src/__tests__/extraction-parser.test.ts`, add fixtures for:
- 5-email batch success
- 5-email batch with malformed entry (should throw, consumer falls back)
- Array length mismatch (throws with expectedCount error)
- Unordered index array (parser sorts correctly)

- [ ] **Step 5: Measure on property schema**

Target: 200-email extraction drops from ~3m10s to ~60s. Spot-check 10 random extracted emails against the old per-email baseline — summary quality should be indistinguishable. If it degrades, drop CHUNK_SIZE to 3 and remeasure.

- [ ] **Step 6: Commit**

```bash
git add apps packages
git commit -m "perf(extraction): Gemini batch extraction CHUNK_SIZE=5 (closes #77)"
```

### Task 3.2: #78 — Parallelize synthesis + case-splitting (fan-out)

**Files:**
- Modify: `apps/web/src/lib/inngest/functions.ts` (split `run-synthesis` and `run-case-splitting` into fan-out + worker + completion-check)
- Modify: `apps/web/src/lib/services/synthesis.ts` (hoist `synthesizeCase` as the worker)
- Modify: `apps/web/src/lib/services/case-splitting.ts` (same pattern)
- Modify: `packages/types/src/events.ts` (add `synthesis.case.requested`, `synthesis.case.completed`, `splitting.case.requested`, `splitting.case.completed`)

- [ ] **Step 1: Add events to the types package**

In `packages/types/src/events.ts`:

```ts
export interface SynthesisCaseRequested {
  name: "synthesis.case.requested";
  data: { schemaId: string; caseId: string; scanJobId: string };
}
export interface SynthesisCaseCompleted {
  name: "synthesis.case.completed";
  data: { schemaId: string; caseId: string; scanJobId: string; status: "ok" | "failed"; error?: string };
}
// same shape for splitting.case.requested / splitting.case.completed
```

Add these to the Inngest event union / registry wherever the project keeps it.

- [ ] **Step 2: Refactor run-synthesis to fan out**

In `apps/web/src/lib/inngest/functions.ts`, replace the serial loop in `run-synthesis` with:

```ts
// Fan-out: emit one synthesis.case.requested per case
const cases = await prisma.case.findMany({ where: { schemaId, status: "OPEN", synthesizedAt: null } });
await inngest.send(cases.map((c) => ({
  name: "synthesis.case.requested",
  data: { schemaId, caseId: c.id, scanJobId },
})));
// Does NOT await completion — completion-check function below does that.
```

Add a new worker function:

```ts
export const synthesizeCaseWorker = inngest.createFunction(
  {
    id: "synthesize-case-worker",
    retries: 2,
    concurrency: { limit: 4, key: "event.data.schemaId" },
  },
  { event: "synthesis.case.requested" },
  async ({ event, step }) => {
    const { schemaId, caseId, scanJobId } = event.data;
    try {
      await synthesizeCase(caseId, schemaId); // sets synthesizedAt on success
      await step.sendEvent("emit-done", {
        name: "synthesis.case.completed",
        data: { schemaId, caseId, scanJobId, status: "ok" },
      });
    } catch (err) {
      await step.sendEvent("emit-failed", {
        name: "synthesis.case.completed",
        data: { schemaId, caseId, scanJobId, status: "failed", error: String(err) },
      });
      // Do NOT rethrow — we want the worker to succeed so Inngest doesn't retry
      // the whole event. synthesizeCase already persists failure markers (see #65).
    }
  },
);
```

Add a completion-check function that waits for all per-case events and advances the phase:

```ts
export const checkSynthesisComplete = inngest.createFunction(
  { id: "check-synthesis-complete", retries: 2 },
  { event: "synthesis.case.completed" },
  async ({ event, step }) => {
    const { schemaId } = event.data;
    const pending = await prisma.case.count({
      where: { schemaId, status: "OPEN", synthesizedAt: null },
    });
    if (pending > 0) return { pending };
    // All cases synthesized — emit the scan-level completion event
    await step.sendEvent("synthesis-complete", {
      name: "scan.synthesis.completed",
      data: { schemaId, scanJobId: event.data.scanJobId },
    });
  },
);
```

Downstream consumers of the old scan phase transition continue to receive it via the existing `scan.synthesis.completed` or equivalent event — preserve the existing contract.

- [ ] **Step 3: Repeat the same pattern for case-splitting**

Mirror the three-function shape: `runCaseSplitting` → fan-out; `splitCaseWorker` → per-case; `checkSplittingComplete` → advance phase.

- [ ] **Step 4: Measure**

Target: synthesis 2m33s → ~40s; case-splitting 1m32s → ~25s. Check Inngest dashboard — should see 16 `synthesize-case-worker` runs with concurrency=4 observed on Run B.

- [ ] **Step 5: Commit**

```bash
git add apps packages
git commit -m "perf(synthesis): fan-out synthesize-case and split-case workers (closes #78)"
```

### Task 3.3: #82 — Live case count during synthesis

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (add `ScanJob.synthesizedCases` Int default 0 + `totalCasesToSynthesize` Int)
- Migration: via `supabase-db` skill (raw SQL — per CLAUDE.md, don't use `prisma db push`)
- Modify: `apps/web/src/lib/services/synthesis.ts` (increment counter after each case)
- Modify: `apps/web/src/lib/services/onboarding-polling.ts` (surface counters in SYNTHESIZING branch)
- Modify: `apps/web/src/components/onboarding/phase-processing-scan.tsx` (render `7 of 16`)

- [ ] **Step 1: Add columns via supabase-db skill**

```
/supabase-db
```

Apply:

```sql
ALTER TABLE scan_jobs
  ADD COLUMN synthesized_cases integer NOT NULL DEFAULT 0,
  ADD COLUMN total_cases_to_synthesize integer NOT NULL DEFAULT 0;
```

Then update `apps/web/prisma/schema.prisma` to match:

```prisma
model ScanJob {
  // ...
  synthesizedCases         Int @default(0)
  totalCasesToSynthesize   Int @default(0)
  // ...
}
```

Run `pnpm --filter web prisma generate`.

- [ ] **Step 2: Set the denominator when clustering completes**

In the function that transitions CLUSTERING → SYNTHESIZING (likely `runCoarseClustering` in `apps/web/src/lib/inngest/functions.ts`), set `totalCasesToSynthesize` equal to the number of OPEN cases needing synthesis.

- [ ] **Step 3: Increment in the worker**

In `synthesizeCaseWorker` (from #78), after `synthesizeCase` succeeds:

```ts
await prisma.scanJob.update({
  where: { id: scanJobId },
  data: { synthesizedCases: { increment: 1 } },
});
```

- [ ] **Step 4: Surface in the polling response**

In `apps/web/src/lib/services/onboarding-polling.ts`, inside the `SYNTHESIZING` branch of `derivePollingResponse`, add:

```ts
return {
  // ... existing ...
  synthesizedCases: scanJob.synthesizedCases,
  totalCasesToSynthesize: scanJob.totalCasesToSynthesize,
};
```

- [ ] **Step 5: Render "N of M" in the observer**

In `apps/web/src/components/onboarding/phase-processing-scan.tsx`, when phase is SYNTHESIZING and both counters are present, render:

```tsx
Generating case summaries — {synthesizedCases} of {totalCasesToSynthesize}
```

- [ ] **Step 6: Watch a live run**

Run the property schema with the observer page open. Counter should tick 0 → 1 → 2 → ... → 16 → COMPLETED.

- [ ] **Step 7: Commit**

```bash
git add apps packages
git commit -m "feat(observer): live case count during synthesis (closes #82)"
```

### Phase 3 verification gate

- [ ] Run the full verification protocol
- [ ] Function B target: ~3m 40s on Run B (was ~9m)
- [ ] Eval tag coverage still 100%, orphan rate unchanged
- [ ] Live counter visible during Run B synthesis

Phase 3 log:

| Metric | Pre-Phase-3 | After #77 | After #78 | After #82 |
|---|---|---|---|---|
| run-extraction (200 emails) | ~3m10s | | — | — |
| run-synthesis (16 cases) | ~2m33s | — | | — |
| run-case-splitting | ~1m32s | — | | — |
| Total Function B | ~9m | | | |
| Observer UX | spinner | spinner | spinner | live count |

---

## Phase 4 — Perf cleanup + umbrella close (#63, #73, #25)

**Why now:** With Phase 3 done, revisit the deferred DB round-trip work and the review-screen timing — both should be easier to measure once everything upstream is fast. Then close the #25 umbrella.

### Task 4.1: #63 — Batch sequential DB round-trips in persistSchemaRelations

**Files:**
- Modify: `apps/web/src/lib/services/interview.ts` (`persistSchemaRelations` at line ~455)

Refer to the issue for the full round-trip breakdown. Priority levers (from the issue):

- [ ] **Step 1: Merge the two `caseSchema.update` calls into one**
- [ ] **Step 2: Collapse per-secondary `entity.update` (associatedPrimaryIds) into a single grouped `updateMany` per value**
- [ ] **Step 3: Collect all ungrouped primaries, then batch-create their EntityGroups and batch-link**
- [ ] **Step 4: Consider moving shared WHOs + exclusion rules outside the transaction (they don't need atomicity with core schema+entity writes)**
- [ ] **Step 5: Remove the `{ timeout: 15000 }` workaround**
- [ ] **Step 6: Run both schemas; `persistSchemaRelations` should finish well under 5s**
- [ ] **Step 7: Commit**

```bash
git commit -m "perf(interview): batch persistSchemaRelations round-trips (closes #63)"
```

### Task 4.2: #73 — Review screen render time investigation

**Files (read-only, then target):**
- Read: `apps/web/src/lib/inngest/onboarding.ts` (Function A step layout after Phase 2)
- Read: `apps/web/src/lib/config/onboarding-tunables.ts` (pass1.sampleSize, pass1.lookback)
- Read: `packages/ai/src/prompts/interview-validate.ts` (prompt size with `relatedUserThing`)

- [ ] **Step 1: Take a clean run with all Phase 2 + 3 fixes landed**

Use onboarding-timing skill to parse the timeline. Expected steps:
- generate-hypothesis (parallel with sampleScan after #80)
- gmail-sample-scan (parallel after #80)
- validate-hypothesis (cache-warmed after #79)
- advance-to-awaiting-review

- [ ] **Step 2: Compare against targets**

| Step | Plan 1 estimate | Phase-4 target |
|---|---|---|
| hypothesis | 10-15s | ≤12s (cache-warmed) |
| sampleScan | ~5s | overlapping with hypothesis |
| Pass 1 validation | 15s | ≤10s (cache-warmed) |
| overhead | 3s | 3s |
| **Total** | 25-35s | **<30s stretch, <45s realistic** |

- [ ] **Step 3: If one step dominates, attack it**

If validateHypothesis is still >10s after #79, consider:
- Dropping `pass1.sampleSize` from 100 to 75 (tune in `onboarding-tunables.ts`)
- Tightening the validate prompt (remove any verbose examples)
- Merging sampleScan + validate into a single step.run (eliminates one Inngest checkpoint)

- [ ] **Step 4: Commit (if any fix applied)**

```bash
git commit -m "perf(review-screen): <specific fix> (closes #73)"
```

### Task 4.3: #25 — Scanning UX umbrella close

- [ ] **Step 1: Review #25's checklist against shipped work**

The issue asks for:
- Stage indicator ✓ (already done)
- Live email count — partially shipped; confirm it's wired after #82
- Live entity discovery — partially shipped via existing entity grouping UI
- Live case count ✓ (via #82)
- Faster wall-clock ✓ (via #77 #78 #79 #80 #81)

- [ ] **Step 2: If anything meaningful is missing, file a fresh narrow issue for it, then close #25**

```bash
gh issue comment 25 --body "Closing as umbrella. Child issues shipped: #77 #78 #79 #80 #81 #82. Filed #NNN for any remaining UX surface."
gh issue close 25
```

### Phase 4 verification gate

- [ ] Full verification protocol
- [ ] Function A ≤ 45s (stretch ≤ 30s)
- [ ] Function B ≤ 4m on Run B
- [ ] Eval PASS 6/6

---

## Phase 5 — Correctness / quality (#35, #38, #65, #75, #57)

**Why now:** The pipeline is fast; now make sure it includes the right emails and recovers gracefully. Phase order within the phase prioritizes by user-visible impact.

### Task 5.1: #35 — Extraction relevance gate (content + sender affinity)

Refer to issue. Scope:

- [ ] Read `packages/ai/src/prompts/extraction.ts` + `apps/web/src/lib/services/extraction.ts`
- [ ] Add sender-affinity rule to extraction prompt: "if sender is a known SECONDARY entity, boost relevance"
- [ ] Add content-domain match rule to prompt
- [ ] For unknown addresses appearing in emails from known SECONDARY senders, flag as candidate new PRIMARY (tees up #75 orphan mining)
- [ ] Re-run property schema; confirm 205 Freedom Trail emails are now INCLUDED
- [ ] Confirm truly-unrelated emails (random unknown sender + unknown topic) still EXCLUDED
- [ ] Commit: `fix(extraction): sender-affinity + content-domain in relevance gate (closes #35)`

### Task 5.2: #38 — Eval Session 2 remaining items

Checklist in the issue:
- [ ] #35 ✓ (done above — check off in #38)
- [ ] #36 — review screen surfaces discovered entities (already shipped 2026-04-13; verify and check off)
- [ ] #37 — today's soccer practice emails cluster into existing case (verify on Run A)
- [ ] Case detail "Exclude" button UX clarification
- [ ] Close #38 once 3-of-4 child criteria pass and re-eval scores 3+/5 on case quality

### Task 5.3: #65 — Soft quality gate on synthesis failures

**Files:**
- Modify: `apps/web/src/lib/inngest/onboarding.ts` (quality gate ~line 441)
- Modify: `apps/web/src/lib/inngest/functions.ts` (`runSynthesis` error handling ~line 887)

- [ ] **Step 1: Distinguish "never attempted" from "attempted and failed"**

In the synthesis worker (after #78 refactor, this lives in `synthesizeCaseWorker`), on catch: set `case.synthesisFailedAt = now()` (new column) rather than leaving `synthesizedAt = null`.

Raw SQL via `supabase-db`:

```sql
ALTER TABLE cases ADD COLUMN synthesis_failed_at timestamptz;
```

- [ ] **Step 2: Soften the quality gate**

```ts
const unsynthesized = await prisma.case.count({
  where: { schemaId, status: "OPEN", synthesizedAt: null, synthesisFailedAt: null },
});
if (unsynthesized > 0) {
  throw new Error(`${unsynthesized} case(s) never attempted synthesis — pipeline bug`);
}
const failed = await prisma.case.count({ where: { schemaId, synthesisFailedAt: { not: null } } });
if (failed > 0) {
  logger.warn("synthesis.partial-failure", { schemaId, failedCount: failed });
  // Do NOT throw — proceed to AWAITING_REVIEW
}
```

- [ ] **Step 3: Surface failed-synthesis cases visually in the review screen**

Add a small badge or "could not summarize" state on the case card when `synthesisFailedAt` is set. Keep scope minimal — this is mostly so the user can see and skip past it.

- [ ] **Step 4: Test by mocking a synthesis error**

Temporarily throw in one case's `synthesizeCase`. Assert onboarding reaches AWAITING_REVIEW, 15/16 cases visible, 1 case flagged.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(quality-gate): distinguish never-attempted from failed-synthesis (closes #65)"
```

### Task 5.4: #75 — Post-scan orphan mining (short-term only)

**Scope limited to short-term per the issue.** Medium-term (`mineOrphanTopics` Inngest function + `TopicSuggestion` model + feed banner) is deferred.

**Files:**
- Modify: `packages/ai/src/prompts/interview-validate.ts` (add `suggestedPrimaryTopics` output field)
- Modify: `packages/ai/src/parsers/validation-parser.ts` (parse `suggestedPrimaryTopics`)
- Modify: `packages/ai/src/__tests__/validation-parser.test.ts` (cover the new field)
- Modify: `apps/web/src/components/onboarding/review-entities.tsx` (render "Topics we noticed you didn't mention")

- [ ] **Step 1: Update the validate prompt to ALSO return suggestedPrimaryTopics**

Per issue:
```ts
suggestedPrimaryTopics: { name: string; emailCount: number; emailIndices: number[] }[]
```

These are themes Claude sees in the sample that are NOT related to any user WHAT but appear ~3+ times.

- [ ] **Step 2: Parser + test (same file from #70)**
- [ ] **Step 3: Render in review UI under a new section**
- [ ] **Step 4: Verify on Run A — "Martial Arts" from Amy DiCarlo should surface as a suggested topic**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(onboarding): surface suggestedPrimaryTopics on review screen (partial #75)"
```

### Task 5.5: #57 — Raw email cache

**Files:**
- Migration: `apps/web/prisma/schema.prisma` (new `RawEmail` model)
- Modify: `apps/web/src/lib/gmail/client.ts` (`getEmailFull` checks cache)
- Modify: `apps/web/src/lib/services/extraction.ts` (reads cached bodies)

- [ ] **Step 1: Add RawEmail model via supabase-db skill**

```sql
CREATE TABLE raw_emails (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  headers jsonb NOT NULL,
  body_text text,
  body_html text,
  attachments_meta jsonb NOT NULL DEFAULT '[]'::jsonb,
  snippet text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, gmail_message_id)
);
CREATE INDEX raw_emails_user_gmail_id_idx ON raw_emails(user_id, gmail_message_id);
```

Update `schema.prisma` to match; `pnpm --filter web prisma generate`.

- [ ] **Step 2: Cache read/write in GmailClient.getEmailFull**

```ts
async getEmailFull(messageId: string): Promise<GmailMessage> {
  const cached = await prisma.rawEmail.findUnique({
    where: { userId_gmailMessageId: { userId: this.userId, gmailMessageId: messageId } },
  });
  if (cached) return hydrateFromCache(cached);

  const fresh = await this.api.users.messages.get({ ... });
  await prisma.rawEmail.create({
    data: { userId: this.userId, gmailMessageId: messageId, headers: fresh.headers, bodyText: fresh.body.text, /* ... */ },
  });
  return fresh;
}
```

- [ ] **Step 3: Verify with the exact failing scenario**

Create topic A, wait for scan to finish. Create topic B on overlapping data. Confirm via Gmail API call counters (add a per-request log) that topic B hits cache for most body fetches. Wall-clock should drop measurably for topic B's discovery+extraction phase.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(gmail): per-user RawEmail cache for cross-topic reuse (closes #57)"
```

### Phase 5 verification gate

- [ ] Full verification protocol
- [ ] Eval still 6/6
- [ ] 205 Freedom Trail emails now included on property schema
- [ ] "Martial Arts" suggestion appears on review screen for Run A
- [ ] Second topic on same account is visibly faster (cache hits)

---

## Phase 6 — Test codification (#71, #72, #66)

**Why last:** By now the surfaces are stable. Tests added here won't churn.

### Task 6.1: #71 — Audit or delete onboarding-happy-path.test.ts

- [ ] **Step 1: Read `apps/web/tests/integration/onboarding-happy-path.test.ts` top-to-bottom**
- [ ] **Step 2: For each assertion, check whether it still reflects current behavior after Phases 1–5**
- [ ] **Step 3: Delete assertions that are no longer meaningful; rewrite ones that drifted; keep ones that correctly guard the new shape**
- [ ] **Step 4: Run `pnpm --filter web test:integration` and verify**
- [ ] **Step 5: Commit — either `test(onboarding): rewrite happy-path for post-sprint pipeline (closes #71)` or `chore: delete stale onboarding-happy-path (closes #71)`**

### Task 6.2: #72 — CI integration job + Playwright onboarding E2E

**Files:**
- Create: `apps/web/tests/e2e/onboarding.spec.ts`
- Modify: `.github/workflows/ci.yml` (add integration-test job + Playwright job)

- [ ] **Step 1: Write the Playwright spec for the golden onboarding flow**

Cover: start onboarding → enter WHATs → Gmail OAuth mock → review screen renders → confirm → scan completes → feed renders with ≥1 case.

Keep it narrow — this is a smoke test, not a behavior suite.

- [ ] **Step 2: Add the CI job**

New job in `.github/workflows/ci.yml`:

```yaml
integration-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: pnpm install
    - run: pnpm --filter web prisma generate
    - run: pnpm --filter web test:integration
  env:
    DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
    # ... other secrets as needed ...

e2e-tests:
  runs-on: ubuntu-latest
  needs: [integration-tests]
  steps:
    - uses: actions/checkout@v4
    - run: pnpm install
    - run: pnpm --filter web exec playwright install --with-deps
    - run: pnpm --filter web build
    - run: pnpm --filter web test:e2e
```

- [ ] **Step 3: Run the job on a PR and verify green**
- [ ] **Step 4: Commit — `ci: integration + Playwright onboarding E2E (closes #72)`**

### Task 6.3: #66 — relatedUserThing persistence

The issue gives two options (A: JSONB join in GET, B: add column). Recommend Option B (proper fix) since we're now confident the field is load-bearing and will be read by topic-edit UX.

**Files:**
- Migration: add `Entity.relatedUserThing String?`
- Modify: `apps/web/src/lib/services/interview.ts::persistSchemaRelations` (populate column from `schema.validation.discoveredEntities`)
- Modify: `apps/web/src/app/api/schemas/[schemaId]/route.ts` (select the column)
- Modify: `apps/web/src/components/onboarding/phase-review.tsx` (Branch A now reads column)
- Test: extend `apps/web/tests/integration/` with a post-confirm review revisit case

- [ ] **Step 1: Add column via supabase-db skill**

```sql
ALTER TABLE entities ADD COLUMN related_user_thing text;
```

Update `schema.prisma`; `prisma generate`.

- [ ] **Step 2: Populate in persistSchemaRelations**

When creating Entity rows from `validation.discoveredEntities`, copy `relatedUserThing` onto the row.

- [ ] **Step 3: Select in GET route and render in Branch A**

- [ ] **Step 4: Integration test**

Create a schema past AWAITING_REVIEW with entities persisted, then hit the GET route and assert `relatedUserThing` survives. Render review screen against that data; entities group under topics correctly.

- [ ] **Step 5: Commit — `fix(entities): persist relatedUserThing column (closes #66)`**

### Phase 6 verification gate

- [ ] Full verification protocol
- [ ] CI green on a PR (integration + E2E jobs)
- [ ] Post-confirm review screen preserves topic grouping

---

## Sprint-wide exit criteria

Before declaring the sprint done:

- [ ] All 19 issues closed (`69, 70, 79, 80, 81, 77, 78, 82, 63, 73, 25, 35, 38, 65, 75, 57, 71, 72, 66`)
- [ ] Both schemas complete onboarding in ≤4 min wall-clock (Function A ≤30s stretch; Function B ≤4m)
- [ ] Eval PASS 6/6 on both schemas across two consecutive runs
- [ ] CI has integration + Playwright jobs wired and green
- [ ] Update `docs/00_denim_current_status.md` with end-of-sprint numbers and next-up items
- [ ] Merge `feature/ux-overhaul` into `main` (was blocked; this sprint lands before or after that merge — decide at sprint kickoff)

---

## Notes / deferred

- Medium-term part of #75 (`mineOrphanTopics` Inngest function + `TopicSuggestion` model + feed banner) stays deferred; only short-term suggestedPrimaryTopics ships in this sprint.
- Long-term "empty-inbox onboarding" from #75 is roadmap, not sprint.
- #63 may already be non-urgent post-#64 resequencing; re-evaluate at Phase 4 — if `persistSchemaRelations` routinely finishes <3s without the batching, consider marking Phase 4.1 as "closed as won't-fix, status quo acceptable."
