# Pipeline Resequencing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the AWAITING_REVIEW phase before PROCESSING_SCAN so users confirm entities before the pipeline runs.

**Architecture:** Split `runOnboarding` into two Inngest functions: Function A (hypothesis + validation, stops at AWAITING_REVIEW) and Function B (pipeline, triggered by user confirmation). The POST /api/onboarding/:schemaId route becomes the bridge -- it persists confirmed entities and emits the event that starts Function B.

**Tech Stack:** Inngest (workflow orchestration), Prisma (CAS transitions), Next.js App Router (API routes), React (review UI)

**Spec:** `docs/superpowers/specs/2026-04-13-pipeline-resequencing-design.md`

---

### Task 1: Update Phase Ordering in onboarding-state.ts

**Files:**
- Modify: `apps/web/src/lib/services/onboarding-state.ts:33-42`

- [ ] **Step 1: Update SCHEMA_PHASE_ORDER**

Swap AWAITING_REVIEW and PROCESSING_SCAN indices so AWAITING_REVIEW comes before PROCESSING_SCAN in the monotonic ordering:

```ts
const SCHEMA_PHASE_ORDER: Record<SchemaPhase, number> = {
  PENDING: 0,
  GENERATING_HYPOTHESIS: 1,
  FINALIZING_SCHEMA: 2,    // legacy — kept for existing rows
  AWAITING_REVIEW: 3,      // moved before PROCESSING_SCAN
  PROCESSING_SCAN: 4,      // moved after AWAITING_REVIEW
  COMPLETED: 5,
  NO_EMAILS_FOUND: 99,
  FAILED: 99,
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS (no type changes, just index values)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/services/onboarding-state.ts
git commit -m "refactor: reorder schema phases — AWAITING_REVIEW before PROCESSING_SCAN"
```

---

### Task 2: Add onboarding.review.confirmed Event

**Files:**
- Modify: `packages/types/src/events.ts`

- [ ] **Step 1: Add the new event to DenimEvents**

Add after the `onboarding.session.cancelled` entry:

```ts
"onboarding.review.confirmed": {
  /**
   * User confirmed entities on the review screen. Triggers the pipeline
   * via runOnboardingPipeline (Function B). Emitted by POST /api/onboarding/:schemaId
   * after persistSchemaRelations succeeds.
   */
  data: {
    schemaId: string;
    userId: string;
  };
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/events.ts
git commit -m "feat: add onboarding.review.confirmed event type"
```

---

### Task 3: Split onboarding.ts into Two Functions

This is the core change. Replace the single `runOnboarding` function with Function A (stops at AWAITING_REVIEW) and add Function B `runOnboardingPipeline` (triggered by review confirmation).

**Files:**
- Modify: `apps/web/src/lib/inngest/onboarding.ts`
- Modify: `apps/web/src/lib/inngest/functions.ts` (import + functions array)

- [ ] **Step 1: Rewrite onboarding.ts — Function A (runOnboarding)**

Replace the entire file content. Function A keeps steps: generate-hypothesis, validate-hypothesis. Replaces finalize-schema with a simple advance to AWAITING_REVIEW. Removes everything after that (create-scan-job, request-scan, wait-for-scan, quality gate).

```ts
/**
 * runOnboarding — Function A of the onboarding state machine.
 * Owns CaseSchema.phase through the pre-review portion:
 *
 *   PENDING → GENERATING_HYPOTHESIS → AWAITING_REVIEW
 *
 * Generates the hypothesis, validates it against real Gmail samples,
 * stores both as JSON on the schema row, then advances to AWAITING_REVIEW
 * where the user confirms entities on Card 4.
 *
 * Function B (runOnboardingPipeline) picks up after the user confirms,
 * triggered by the onboarding.review.confirmed event.
 */
import type { HypothesisValidation, InterviewInput, SchemaHypothesis } from "@denim/types";
import type { Prisma } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import {
  extractTrustedDomains,
  generateHypothesis,
  persistSchemaRelations,
  resolveWhoEmails,
  validateHypothesis,
} from "@/lib/services/interview";
import { advanceSchemaPhase, markSchemaFailed } from "@/lib/services/onboarding-state";
import { inngest } from "./client";

const DOMAIN_EXPANSION_CAP = 50;
const MAX_DOMAINS_TO_EXPAND = 5;
const SCAN_WAIT_TIMEOUT = "20m";

export const runOnboarding = inngest.createFunction(
  {
    id: "run-onboarding",
    triggers: [{ event: "onboarding.session.started" }],
    cancelOn: [{ event: "onboarding.session.cancelled", match: "data.schemaId" }],
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { key: "event.data.userId", limit: 3 },
    ],
    retries: 0,
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;

    try {
      // ---- Step 1: PENDING → GENERATING_HYPOTHESIS ---------------------
      await step.run("generate-hypothesis", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "PENDING",
          to: "GENERATING_HYPOTHESIS",
          work: async () => {
            const schema = await prisma.caseSchema.findUniqueOrThrow({
              where: { id: schemaId },
              select: { inputs: true },
            });
            const inputs = schema.inputs as unknown as InterviewInput | null;
            if (!inputs) {
              throw new NonRetriableError(
                `runOnboarding: CaseSchema ${schemaId} has no inputs column`,
              );
            }
            const hypothesis = await generateHypothesis(inputs, { userId });
            await prisma.caseSchema.update({
              where: { id: schemaId },
              data: { hypothesis: hypothesis as unknown as object },
            });
          },
        });
      });

      // ---- Step 1b: validate hypothesis against real email samples ------
      // Kept exactly as-is from the current implementation.
      await step.run("validate-hypothesis", async () => {
        const schema = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schemaId },
          select: { hypothesis: true, validation: true, inputs: true },
        });

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
        const { messages } = await gmail.sampleScan(200);

        resolveWhoEmails(hypothesis, messages);

        const pass1Samples = messages.map((m) => ({
          subject: m.subject,
          senderDomain: m.senderDomain,
          senderName: m.senderDisplayName || m.senderEmail,
          snippet: m.snippet,
        }));

        const inputs = schema.inputs as unknown as InterviewInput | null;
        const entityGroups = inputs?.groups?.map((g, idx) => ({
          index: idx,
          primaryNames: g.whats,
          secondaryNames: g.whos,
        }));

        const pass1 = await validateHypothesis(hypothesis, pass1Samples, {
          userId,
          entityGroups,
        });

        const trustedDomains = extractTrustedDomains(hypothesis).slice(0, MAX_DOMAINS_TO_EXPAND);
        const domainDiscoveries: HypothesisValidation["discoveredEntities"] = [];

        for (const domain of trustedDomains) {
          try {
            const domainMessages = await gmail.searchEmails(
              `from:${domain} newer_than:56d`,
              DOMAIN_EXPANSION_CAP,
            );
            if (domainMessages.length === 0) continue;

            const domainSamples = domainMessages.map((m) => ({
              subject: m.subject,
              senderDomain: m.senderDomain,
              senderName: m.senderDisplayName || m.senderEmail,
              snippet: m.snippet,
            }));

            const pass2 = await validateHypothesis(hypothesis, domainSamples, {
              userId,
              entityGroups,
            });

            for (const discovered of pass2.discoveredEntities) {
              if (
                !pass1.discoveredEntities.some((e) => e.name === discovered.name) &&
                !domainDiscoveries.some((e) => e.name === discovered.name)
              ) {
                domainDiscoveries.push(discovered);
              }
            }

            logger.info({
              service: "runOnboarding",
              operation: "domain-expansion",
              schemaId,
              domain,
              emailsQueried: domainMessages.length,
              newDiscoveriesFromDomain: pass2.discoveredEntities.length,
            });
          } catch (err) {
            logger.warn({
              service: "runOnboarding",
              operation: "domain-expansion.failed",
              schemaId,
              domain,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const mergedValidation: HypothesisValidation = {
          ...pass1,
          discoveredEntities: [...pass1.discoveredEntities, ...domainDiscoveries],
        };

        await prisma.caseSchema.update({
          where: { id: schemaId },
          data: {
            hypothesis: hypothesis as unknown as Prisma.InputJsonValue,
            validation: mergedValidation as unknown as Prisma.InputJsonValue,
          },
        });

        logger.info({
          service: "runOnboarding",
          operation: "validate-hypothesis.complete",
          schemaId,
          pass1Discovered: pass1.discoveredEntities.length,
          pass2DomainsExpanded: trustedDomains.length,
          pass2AdditionalDiscovered: domainDiscoveries.length,
          totalDiscovered: mergedValidation.discoveredEntities.length,
        });
      });

      // ---- Step 2: GENERATING_HYPOTHESIS → AWAITING_REVIEW ---------------
      // Hypothesis + validation are already stored on the schema row.
      // Advance to AWAITING_REVIEW and exit. The user sees Card 4.
      await step.run("advance-to-awaiting-review", async () => {
        await advanceSchemaPhase({
          schemaId,
          from: "GENERATING_HYPOTHESIS",
          to: "AWAITING_REVIEW",
          work: async () => {
            // No additional work — hypothesis + validation already persisted.
          },
        });
      });

      logger.info({
        service: "runOnboarding",
        operation: "runOnboarding.awaitingReview",
        schemaId,
      });
    } catch (error) {
      if (error instanceof NonRetriableError) {
        const current = await prisma.caseSchema.findUnique({
          where: { id: schemaId },
          select: { phase: true },
        });
        await markSchemaFailed(schemaId, current?.phase ?? "PENDING", error);
        throw error;
      }

      logger.error({
        service: "runOnboarding",
        operation: "runOnboarding.caught",
        schemaId,
        error: error instanceof Error ? error.message : String(error),
      });
      const current = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true },
      });
      await markSchemaFailed(schemaId, current?.phase ?? "PENDING", error);
      throw error;
    }
  },
);

/**
 * runOnboardingPipeline — Function B of the onboarding state machine.
 * Triggered by onboarding.review.confirmed (emitted by the POST confirm route).
 * Owns CaseSchema.phase from AWAITING_REVIEW onward:
 *
 *   AWAITING_REVIEW → PROCESSING_SCAN → COMPLETED
 *                                     → NO_EMAILS_FOUND
 *                                     → FAILED
 */
export const runOnboardingPipeline = inngest.createFunction(
  {
    id: "run-onboarding-pipeline",
    triggers: [{ event: "onboarding.review.confirmed" }],
    cancelOn: [{ event: "onboarding.session.cancelled", match: "data.schemaId" }],
    concurrency: [
      { key: "event.data.schemaId", limit: 1 },
      { key: "event.data.userId", limit: 3 },
    ],
    retries: 0,
  },
  async ({ event, step }) => {
    const { schemaId, userId } = event.data;

    try {
      // ---- Step 1: AWAITING_REVIEW → PROCESSING_SCAN --------------------
      const createdScanId = await step.run("create-scan-job", async () => {
        return advanceSchemaPhase({
          schemaId,
          from: "AWAITING_REVIEW",
          to: "PROCESSING_SCAN",
          work: async () => {
            const scan = await prisma.scanJob.create({
              data: {
                schemaId,
                userId,
                status: "PENDING",
                phase: "PENDING",
                triggeredBy: "ONBOARDING",
                totalEmails: 0,
              },
              select: { id: true },
            });
            return scan.id;
          },
        });
      });

      const scanJobId: string = await step.run("resolve-scan-job", async () => {
        if (createdScanId !== "skipped") return createdScanId;
        const existing = await prisma.scanJob.findFirst({
          where: { schemaId, triggeredBy: "ONBOARDING" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (!existing) {
          throw new NonRetriableError(
            `runOnboardingPipeline: schema ${schemaId} is past AWAITING_REVIEW but has no onboarding ScanJob`,
          );
        }
        return existing.id;
      });

      // ---- Step 2: request scan -----------------------------------------
      await step.run("request-scan", async () => {
        await inngest.send({
          name: "scan.requested",
          data: { scanJobId, schemaId, userId },
        });
      });

      // ---- Step 3: wait for scan.completed ------------------------------
      const completion = await step.waitForEvent("wait-for-scan", {
        event: "scan.completed",
        timeout: SCAN_WAIT_TIMEOUT,
        match: "data.schemaId",
      });

      if (!completion) {
        throw new NonRetriableError(
          `runOnboardingPipeline: scan ${scanJobId} did not complete within ${SCAN_WAIT_TIMEOUT}`,
        );
      }

      // ---- Step 4: advance to terminal state ----------------------------
      const reason = completion.data.reason;

      if (reason === "failed") {
        const scanError = completion.data.errorMessage ?? "Scan failed";
        throw new NonRetriableError(`runOnboardingPipeline: scan failed — ${scanError}`);
      }

      if (reason === "no-emails-found") {
        await step.run("advance-to-no-emails-found", async () => {
          await advanceSchemaPhase({
            schemaId,
            from: "PROCESSING_SCAN",
            to: "NO_EMAILS_FOUND",
            work: async () => {},
          });
        });
        logger.info({
          service: "runOnboardingPipeline",
          operation: "noEmailsFound",
          schemaId,
          scanJobId,
        });
        return;
      }

      // Happy path — advance to COMPLETED and set status=ACTIVE.
      await step.run("advance-to-completed", async () => {
        await advanceSchemaPhase({
          schemaId,
          from: "PROCESSING_SCAN",
          to: "COMPLETED",
          work: async () => {
            await prisma.caseSchema.update({
              where: { id: schemaId },
              data: { status: "ACTIVE" },
            });
          },
        });
      });

      logger.info({
        service: "runOnboardingPipeline",
        operation: "completed",
        schemaId,
        scanJobId,
        synthesizedCount: completion.data.synthesizedCount ?? 0,
        failedCount: completion.data.failedCount ?? 0,
      });
    } catch (error) {
      if (error instanceof NonRetriableError) {
        const current = await prisma.caseSchema.findUnique({
          where: { id: schemaId },
          select: { phase: true },
        });
        await markSchemaFailed(schemaId, current?.phase ?? "AWAITING_REVIEW", error);
        throw error;
      }

      logger.error({
        service: "runOnboardingPipeline",
        operation: "caught",
        schemaId,
        error: error instanceof Error ? error.message : String(error),
      });
      const current = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true },
      });
      await markSchemaFailed(schemaId, current?.phase ?? "AWAITING_REVIEW", error);
      throw error;
    }
  },
);
```

- [ ] **Step 2: Update functions.ts imports and functions array**

In `apps/web/src/lib/inngest/functions.ts`, change the import:

```ts
// Before:
import { runOnboarding } from "./onboarding";

// After:
import { runOnboarding, runOnboardingPipeline } from "./onboarding";
```

And add `runOnboardingPipeline` to the functions array:

```ts
export const functions = [
  runOnboarding,
  runOnboardingPipeline, // NEW — Function B, triggered by review confirmation
  runScan,
  fanOutExtraction,
  // ... rest stays the same
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/inngest/onboarding.ts apps/web/src/lib/inngest/functions.ts
git commit -m "refactor: split runOnboarding into Function A (pre-review) and Function B (pipeline)"
```

---

### Task 4: Update POST /api/onboarding/:schemaId Route

The confirm route now does the heavy lifting: persists confirmed entities, creates the ScanJob, and emits the pipeline event.

**Files:**
- Modify: `apps/web/src/app/api/onboarding/[schemaId]/route.ts`

- [ ] **Step 1: Rewrite the POST handler**

Replace the POST handler. Key changes:
- CAS flips AWAITING_REVIEW → PROCESSING_SCAN (not COMPLETED)
- Reads hypothesis + validation from schema row
- Builds FinalizeConfirmations from the entity toggle names
- Calls persistSchemaRelations
- Creates ScanJob
- Emits onboarding.review.confirmed

The request body shape changes: `entityToggles` now uses `name` (string) instead of `id` (DB row ID) since Entity rows don't exist yet.

```ts
// POST — confirm review and start pipeline --------------------------------
const ConfirmSchema = z.object({
  topicName: z.string().min(1).max(100),
  entityToggles: z.array(z.object({ name: z.string(), isActive: z.boolean() })).default([]),
});

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractOnboardingSchemaId(request);
    const body = ConfirmSchema.parse(await request.json());

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: {
        id: true,
        userId: true,
        phase: true,
        status: true,
        hypothesis: true,
        validation: true,
        inputs: true,
      },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // CAS: only advance from AWAITING_REVIEW → PROCESSING_SCAN.
    const updated = await prisma.caseSchema.updateMany({
      where: { id: schemaId, phase: "AWAITING_REVIEW" },
      data: {
        phase: "PROCESSING_SCAN",
        name: body.topicName.trim(),
        phaseUpdatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await prisma.caseSchema.findUnique({
        where: { id: schemaId },
        select: { phase: true, status: true },
      });
      if (current?.status === "ACTIVE" || current?.phase === "PROCESSING_SCAN") {
        return NextResponse.json({
          data: { schemaId, status: "already-confirmed" },
        });
      }
      return NextResponse.json(
        {
          error: `Cannot confirm from phase ${current?.phase ?? "unknown"}`,
          code: 409,
          type: "CONFLICT",
        },
        { status: 409 },
      );
    }

    // Build confirmations from entity toggles
    const hypothesis = schema.hypothesis as unknown as import("@denim/types").SchemaHypothesis | null;
    const validation = schema.validation as unknown as import("@denim/types").HypothesisValidation | null;

    if (!hypothesis) {
      return NextResponse.json(
        { error: "Schema has no hypothesis — cannot finalize", code: 500, type: "SERVER_ERROR" },
        { status: 500 },
      );
    }

    // Entity toggles: names the user accepted vs rejected
    const acceptedNames = new Set(
      body.entityToggles.filter((t) => t.isActive).map((t) => t.name),
    );
    const rejectedNames = new Set(
      body.entityToggles.filter((t) => !t.isActive).map((t) => t.name),
    );

    // Build FinalizeConfirmations
    // confirmedEntities = discovered entities the user accepted
    // removedEntities = hypothesis entities + discovered entities the user rejected
    const confirmedEntities = validation?.discoveredEntities
      .filter((e) => acceptedNames.has(e.name))
      .map((e) => e.name) ?? [];

    const removedEntities = [
      ...hypothesis.entities.filter((e) => rejectedNames.has(e.name)).map((e) => e.name),
      ...(validation?.discoveredEntities.filter((e) => rejectedNames.has(e.name)).map((e) => e.name) ?? []),
    ];

    const confirmedTags = validation?.suggestedTags.map((t) => t.name) ?? [];

    const inputs = schema.inputs as unknown as import("@denim/types").InterviewInput | null;

    const { persistSchemaRelations } = await import("@/lib/services/interview");
    await persistSchemaRelations(schemaId, hypothesis, validation ?? undefined, {
      confirmedEntities,
      removedEntities,
      confirmedTags,
      removedTags: [],
      schemaName: body.topicName.trim(),
      groups: inputs?.groups,
      sharedWhos: inputs?.sharedWhos,
    });

    // Emit event to trigger Function B (pipeline)
    await inngest.send({
      name: "onboarding.review.confirmed",
      data: { schemaId, userId },
    });

    logger.info({
      service: "onboarding",
      operation: "confirm",
      userId,
      schemaId,
      acceptedCount: acceptedNames.size,
      rejectedCount: rejectedNames.size,
    });

    return NextResponse.json({
      data: { schemaId, status: "confirmed" },
    });
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "confirm",
      userId,
    });
  }
});
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/onboarding/\[schemaId\]/route.ts
git commit -m "feat: POST confirm route now persists entities and triggers pipeline"
```

---

### Task 5: Update phase-review.tsx to Read from JSON

The review screen currently loads Entity DB rows via `GET /api/schemas/:schemaId`. Since Entity rows don't exist yet at review time, the component needs to build its EntityData array from the hypothesis + validation JSON stored on the schema row.

**Files:**
- Modify: `apps/web/src/components/onboarding/phase-review.tsx`
- Modify: `apps/web/src/app/api/schemas/[schemaId]/route.ts` (or wherever the GET schema endpoint is)

- [ ] **Step 1: Find the GET schema endpoint**

Check what `GET /api/schemas/:schemaId` currently returns and where it lives:

```bash
find apps/web/src/app/api/schemas -name "route.ts"
```

Read it to understand the current response shape.

- [ ] **Step 2: Add hypothesis + validation to the GET schema response**

Add `hypothesis` and `validation` to the select clause and return them in the response. These are JSON columns already on the CaseSchema row. Example addition to the select:

```ts
select: {
  // ... existing fields ...
  hypothesis: true,
  validation: true,
  inputs: true,
}
```

And include them in the response:

```ts
return NextResponse.json({
  data: {
    // ... existing fields ...
    hypothesis: schema.hypothesis,
    validation: schema.validation,
    inputs: schema.inputs,
  },
});
```

- [ ] **Step 3: Update phase-review.tsx to build EntityData from JSON**

Replace the entity-loading effect. Instead of mapping DB Entity rows, build EntityData from hypothesis.entities + validation.discoveredEntities:

```tsx
useEffect(() => {
  if (fetchCalledRef.current) return;
  fetchCalledRef.current = true;

  const run = async () => {
    try {
      const res = await authenticatedFetch(`/api/schemas/${response.schemaId}`);
      if (!res.ok) throw new Error(`Failed to load schema (${res.status})`);

      const json = await res.json() as {
        data: {
          name: string;
          entities?: RawEntity[];          // present post-confirm (backward compat)
          hypothesis?: SchemaHypothesis;    // present pre-confirm
          validation?: HypothesisValidation;
        };
      };

      setTopicName(json.data.name);

      // If Entity rows exist (post-confirm or legacy), use them.
      // Otherwise build from hypothesis + validation JSON (pre-confirm).
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
          })),
        );
      } else if (json.data.hypothesis) {
        const hypothesis = json.data.hypothesis;
        const validation = json.data.validation;

        const entityList: EntityData[] = [];

        // Hypothesis entities (user-entered WHATs and WHOs)
        for (const e of hypothesis.entities) {
          entityList.push({
            id: e.name,   // use name as key — no DB id yet
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
          });
        }

        // Discovered entities from validation
        if (validation?.discoveredEntities) {
          for (const e of validation.discoveredEntities) {
            // Skip duplicates (entity already in hypothesis)
            if (entityList.some((existing) => existing.name === e.name)) continue;
            entityList.push({
              id: e.name,
              name: e.name,
              type: (e.type as "PRIMARY" | "SECONDARY") ?? "PRIMARY",
              autoDetected: true,
              emailCount: e.emailCount ?? 0,
              aliases: [],
              isActive: true,  // default on, user can toggle off
              confidence: e.confidence ?? 0.5,
              likelyAliasOf: e.likelyAliasOf ?? null,
              aliasConfidence: e.aliasConfidence ?? null,
              aliasReason: e.aliasReason ?? null,
            });
          }
        }

        setEntities(entityList);
      }

      setStatus("ready");
    } catch (err) {
      fetchCalledRef.current = false;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to load review data");
    }
  };
  void run();
}, [response.schemaId]);
```

- [ ] **Step 4: Update handleFinalize to send name-based toggles**

Change the entityToggles payload from `{ id, isActive }` to `{ name, isActive }`:

```tsx
const handleFinalize = useCallback(async () => {
  setStatus("finalizing");
  setErrorMessage("");
  try {
    const entityToggles = entities.map((e) => ({ name: e.name, isActive: e.isActive }));

    const res = await authenticatedFetch(`/api/onboarding/${response.schemaId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicName: topicName.trim(), entityToggles }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Finalize failed (${res.status})`);
    }

    onboardingStorage.clearAll();
  } catch (err) {
    setStatus("ready");
    setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
  }
}, [entities, response.schemaId, topicName]);
```

- [ ] **Step 5: Add type imports at top of phase-review.tsx**

Add type imports for the hypothesis/validation shapes. These are used for type assertions in the effect:

```tsx
import type { SchemaHypothesis, HypothesisValidation } from "@denim/types";
```

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/onboarding/phase-review.tsx apps/web/src/app/api/schemas/*/route.ts
git commit -m "feat: review screen reads entities from hypothesis JSON instead of DB rows"
```

---

### Task 6: Update onboarding-polling.ts

Map FINALIZING_SCHEMA to GENERATING_HYPOTHESIS for legacy rows. The PROCESSING_SCAN mapping already works correctly since it reads from scan sub-phases.

**Files:**
- Modify: `apps/web/src/lib/services/onboarding-polling.ts:141-143`

- [ ] **Step 1: Map FINALIZING_SCHEMA to GENERATING_HYPOTHESIS**

Change:

```ts
if (schema.phase === "FINALIZING_SCHEMA") {
  return { ...base, phase: "FINALIZING_SCHEMA" };
}
```

To:

```ts
if (schema.phase === "FINALIZING_SCHEMA") {
  // Legacy: FINALIZING_SCHEMA no longer appears in the new flow.
  // Map to GENERATING_HYPOTHESIS so existing rows don't break the UI.
  return { ...base, phase: "GENERATING_HYPOTHESIS" };
}
```

- [ ] **Step 2: Remove FINALIZING_SCHEMA from OnboardingPhase type**

In the same file, remove `"FINALIZING_SCHEMA"` from the `OnboardingPhase` union type (line ~18). Any components rendering on this phase should now be unreachable.

Actually — check if `flow.tsx` or any component references FINALIZING_SCHEMA first. If `flow.tsx` has a case for it, either remove that case or map it to the generating component. Read `flow.tsx` to decide.

Looking at the code from earlier, `flow.tsx` does have:
```tsx
case "FINALIZING_SCHEMA":
  return <PhaseFinalizing response={response} />;
```

Remove this case from the switch. Since we're removing it from the OnboardingPhase type, TypeScript will flag any remaining references.

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS (or compile errors pointing to remaining FINALIZING_SCHEMA references to clean up)

- [ ] **Step 4: Fix any remaining references**

If typecheck finds references to FINALIZING_SCHEMA in other components, remove or remap them. The `phase-finalizing.tsx` component file can stay (dead code cleanup later) but should not be imported in `flow.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/services/onboarding-polling.ts apps/web/src/components/onboarding/flow.tsx
git commit -m "refactor: remove FINALIZING_SCHEMA from polling and flow routing"
```

---

### Task 7: Update CAS Transition Ownership in Docs

**Files:**
- Modify: `docs/01_denim_lessons_learned.md`

- [ ] **Step 1: Update the CAS Transition Ownership Map**

Replace the ScanJob/CaseSchema transition tables at the bottom of the file:

```markdown
### CaseSchema.phase transitions

| Transition | Owner | Notes |
|---|---|---|
| PENDING → GENERATING_HYPOTHESIS | `runOnboarding` (Function A) | |
| GENERATING_HYPOTHESIS → AWAITING_REVIEW | `runOnboarding` (Function A) | Hypothesis + validation stored as JSON |
| AWAITING_REVIEW → PROCESSING_SCAN | `POST /api/onboarding/:schemaId` | API route, CAS via updateMany |
| PROCESSING_SCAN → COMPLETED | `runOnboardingPipeline` (Function B) | Sets status=ACTIVE in work callback |
| PROCESSING_SCAN → NO_EMAILS_FOUND | `runOnboardingPipeline` (Function B) | |
```

- [ ] **Step 2: Commit**

```bash
git add docs/01_denim_lessons_learned.md
git commit -m "docs: update CAS ownership map for resequenced pipeline"
```

---

### Task 8: Manual End-to-End Test

**Files:** None (testing only)

- [ ] **Step 1: Wipe test data**

Delete the failed schema from today's test and all its related data (cases, emails, entities, scan jobs). Use the supabase-db skill or a cleanup script.

- [ ] **Step 2: Start dev server + Inngest**

```bash
pnpm --filter web dev
npx inngest-cli@latest dev
```

- [ ] **Step 3: Run onboarding with school_parent schema**

Enter: soccer, guitar, lanier, st agnes, dance.

**Verify:**
- Review screen appears within ~30-60 seconds (not 18 minutes)
- "Your Things" section shows: soccer, lanier, guitar, dance, st agnes
- "New Discoveries" section shows auto-detected entities (may include JudgeFite PM, Twilio, etc.)
- Clicking "Not now" on irrelevant discoveries toggles them off

- [ ] **Step 4: Confirm with only kids activities**

Toggle off any non-kids-activity discoveries. Click "Show me my cases!"

**Verify:**
- Phase advances to PROCESSING_SCAN
- Observer page shows DISCOVERING → EXTRACTING → CLUSTERING → SYNTHESIZING progress
- Pipeline completes with < 15 cases
- Feed page shows relevant kids activity cases only

- [ ] **Step 5: Commit any fixes needed**

If the test reveals issues, fix them and commit before marking complete.
