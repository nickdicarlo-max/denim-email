# Case Urgency Sort & Decay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make case ordering deterministic and time-aware so the feed always shows the most urgent case first, based on the nearest upcoming action deadline or event — not when the last email arrived.

**Architecture:** Add a denormalized `nextActionDate` field to the Case model, computed from the earliest PENDING action's `dueDate` or `eventStartTime`. A pure `computeCaseDecay` function in `@denim/engine` recalculates urgency tiers and expires past actions. A daily Inngest cron persists decay to the DB, and a read-time freshness check ensures the feed is always correct between cron runs. The API sort changes from `lastEmailDate DESC` to `nextActionDate ASC NULLS LAST`.

**Tech Stack:** Prisma (schema migration), `@denim/engine` (pure function), Inngest 4 (cron), Vitest (unit tests), Next.js API route

---

## Sort-Key Definition (Agreed)

```
nextActionDate = MIN(dueDate, eventStartTime)
                 across all CaseActions WHERE status = PENDING
```

This is NOT filtered to future-only dates. Past dates are valid — they indicate overdue items that need attention. The `computeCaseDecay` function handles expiring truly-past actions separately.

**Examples:**
- Permission slip due April 1 (trip June 15) -> nextActionDate = April 1
- Soccer practice April 2, game April 4 -> nextActionDate = April 2
- Game April 18 -> nextActionDate = April 18
- PTO donation (no dates) -> nextActionDate = NULL (sorts last)

**Feed sort order:**
1. Active cases first (OPEN/IN_PROGRESS before RESOLVED)
2. `nextActionDate ASC NULLS LAST` (soonest deadline/event first; no-date cases last)
3. `lastEmailDate DESC` (tiebreaker for cases with same nextActionDate)

Urgency tiers (IMMINENT, THIS_WEEK, etc.) are still computed and stored — they drive visual styling (color, badges) — but they are NOT a sort key. The sort is purely by `nextActionDate`. This avoids the problem where two IMMINENT cases are in the wrong relative order.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/engine/src/actions/lifecycle.ts` | Pure `computeCaseDecay` + `computeNextActionDate` functions |
| Create | `packages/engine/src/__tests__/lifecycle.test.ts` | Unit tests for decay + nextActionDate |
| Modify | `packages/engine/src/index.ts` | Export new functions |
| Modify | `apps/web/prisma/schema.prisma` | Add `nextActionDate` field + index |
| Modify | `apps/web/src/lib/services/synthesis.ts` | Compute + write `nextActionDate` after synthesis |
| Modify | `apps/web/src/app/api/cases/route.ts` | Replace sort logic with DB-level `nextActionDate` sort |
| Create | `apps/web/src/lib/inngest/daily-status-decay.ts` | Daily cron job for urgency decay |
| Modify | `apps/web/src/lib/inngest/functions.ts` | Register new cron function |
| Modify | `docs/ux-redesign-plan.md` | Update sort order documentation to match implementation |
| Modify | `docs/00_denim_current_status.md` | Record this work |

---

### Task 1: Pure engine function — `computeNextActionDate`

**Files:**
- Create: `packages/engine/src/actions/lifecycle.ts`
- Create: `packages/engine/src/__tests__/lifecycle.test.ts`

- [ ] **Step 1: Write the test file with `computeNextActionDate` tests**

```typescript
// packages/engine/src/__tests__/lifecycle.test.ts
import { describe, it, expect } from "vitest";
import { computeNextActionDate } from "../actions/lifecycle";

describe("computeNextActionDate", () => {
  it("returns null when no actions", () => {
    expect(computeNextActionDate([])).toBeNull();
  });

  it("returns null when no PENDING actions", () => {
    const actions = [
      { status: "DONE" as const, dueDate: new Date("2026-04-01"), eventStartTime: null },
      { status: "EXPIRED" as const, dueDate: new Date("2026-03-01"), eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toBeNull();
  });

  it("returns dueDate when no eventStartTime", () => {
    const actions = [
      { status: "PENDING" as const, dueDate: new Date("2026-04-10"), eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-10"));
  });

  it("returns eventStartTime when no dueDate", () => {
    const actions = [
      { status: "PENDING" as const, dueDate: null, eventStartTime: new Date("2026-04-02T17:30:00Z") },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-02T17:30:00Z"));
  });

  it("returns earlier of dueDate and eventStartTime on same action", () => {
    const actions = [
      {
        status: "PENDING" as const,
        dueDate: new Date("2026-04-01"),           // permission slip due
        eventStartTime: new Date("2026-06-15"),     // field trip
      },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-01"));
  });

  it("returns earliest across multiple PENDING actions", () => {
    const actions = [
      { status: "PENDING" as const, dueDate: null, eventStartTime: new Date("2026-04-04") },
      { status: "PENDING" as const, dueDate: null, eventStartTime: new Date("2026-04-02") },
      { status: "PENDING" as const, dueDate: null, eventStartTime: new Date("2026-04-18") },
      { status: "DONE" as const, dueDate: new Date("2026-03-28"), eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-02"));
  });

  it("ignores DISMISSED and SUPERSEDED actions", () => {
    const actions = [
      { status: "DISMISSED" as const, dueDate: new Date("2026-04-01"), eventStartTime: null },
      { status: "SUPERSEDED" as const, dueDate: new Date("2026-04-02"), eventStartTime: null },
      { status: "PENDING" as const, dueDate: new Date("2026-04-10"), eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-10"));
  });

  it("returns null when PENDING actions have no dates", () => {
    const actions = [
      { status: "PENDING" as const, dueDate: null, eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && npx vitest run src/__tests__/lifecycle.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/engine/src/actions/lifecycle.ts
/**
 * Case lifecycle: urgency decay and next-action-date computation.
 * Pure functions -- zero I/O, no Date.now(), no console.log.
 */

type ActionStatusInput = "PENDING" | "DONE" | "EXPIRED" | "SUPERSEDED" | "DISMISSED";

export interface ActionDateInput {
  status: ActionStatusInput;
  dueDate: Date | null;
  eventStartTime: Date | null;
}

/**
 * Compute the earliest actionable date across all PENDING actions.
 * For each PENDING action, takes MIN(dueDate, eventStartTime).
 * Returns the earliest such date, or null if no PENDING actions have dates.
 */
export function computeNextActionDate(actions: ActionDateInput[]): Date | null {
  let earliest: Date | null = null;

  for (const action of actions) {
    if (action.status !== "PENDING") continue;

    const candidates: Date[] = [];
    if (action.dueDate) candidates.push(action.dueDate);
    if (action.eventStartTime) candidates.push(action.eventStartTime);

    for (const date of candidates) {
      if (earliest === null || date < earliest) {
        earliest = date;
      }
    }
  }

  return earliest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/engine && npx vitest run src/__tests__/lifecycle.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```
feat(engine): add computeNextActionDate pure function

Computes the earliest actionable date across PENDING actions
for deterministic feed sorting by nearest deadline/event.
```

---

### Task 2: Pure engine function — `computeCaseDecay`

**Files:**
- Modify: `packages/engine/src/actions/lifecycle.ts`
- Modify: `packages/engine/src/__tests__/lifecycle.test.ts`

- [ ] **Step 1: Write `computeCaseDecay` tests**

Append to `packages/engine/src/__tests__/lifecycle.test.ts`:

```typescript
import { computeCaseDecay } from "../actions/lifecycle";
// (add to existing import line alongside computeNextActionDate)

describe("computeCaseDecay", () => {
  const now = new Date("2026-04-01T12:00:00Z"); // Tuesday noon

  it("does nothing for RESOLVED cases", () => {
    const result = computeCaseDecay({
      caseStatus: "RESOLVED",
      caseUrgency: "NO_ACTION",
      actions: [
        { id: "a1", status: "PENDING", dueDate: new Date("2026-03-20"), eventStartTime: null, eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-15"),
    }, now);
    expect(result.changed).toBe(false);
    expect(result.updatedStatus).toBe("RESOLVED");
    expect(result.expiredActionIds).toEqual([]);
  });

  it("expires PENDING actions whose dates have passed", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "IMMINENT",
      actions: [
        { id: "a1", status: "PENDING", dueDate: new Date("2026-03-28"), eventStartTime: null, eventEndTime: null },
        { id: "a2", status: "PENDING", dueDate: null, eventStartTime: new Date("2026-04-05"), eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-25"),
    }, now);
    expect(result.expiredActionIds).toEqual(["a1"]);
    expect(result.updatedUrgency).toBe("THIS_WEEK"); // a2 is April 5 = 4 days away
    expect(result.updatedStatus).toBe("OPEN");
    expect(result.changed).toBe(true);
  });

  it("uses eventEndTime to determine if event is past (not eventStartTime)", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "IMMINENT",
      actions: [
        {
          id: "a1", status: "PENDING",
          dueDate: null,
          eventStartTime: new Date("2026-04-01T10:00:00Z"),  // started 2 hours ago
          eventEndTime: new Date("2026-04-01T14:00:00Z"),     // ends in 2 hours
        },
      ],
      lastEmailDate: new Date("2026-03-30"),
    }, now);
    expect(result.expiredActionIds).toEqual([]);
    expect(result.updatedUrgency).toBe("IMMINENT");
  });

  it("resolves case when all actions are expired or done", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "THIS_WEEK",
      actions: [
        { id: "a1", status: "DONE", dueDate: new Date("2026-03-25"), eventStartTime: null, eventEndTime: null },
        { id: "a2", status: "PENDING", dueDate: new Date("2026-03-20"), eventStartTime: null, eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-18"),
    }, now);
    expect(result.expiredActionIds).toEqual(["a2"]);
    expect(result.updatedStatus).toBe("RESOLVED");
    expect(result.updatedUrgency).toBe("NO_ACTION");
  });

  it("sets IMMINENT for action within 48 hours", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "UPCOMING",
      actions: [
        { id: "a1", status: "PENDING", dueDate: new Date("2026-04-02T10:00:00Z"), eventStartTime: null, eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.updatedUrgency).toBe("IMMINENT"); // 22 hours away
    expect(result.changed).toBe(true);
  });

  it("sets THIS_WEEK for action within 168 hours", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "UPCOMING",
      actions: [
        { id: "a1", status: "PENDING", dueDate: null, eventStartTime: new Date("2026-04-05T10:00:00Z"), eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.updatedUrgency).toBe("THIS_WEEK"); // ~94 hours away
  });

  it("sets UPCOMING for action beyond 168 hours", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "IMMINENT",
      actions: [
        { id: "a1", status: "PENDING", dueDate: null, eventStartTime: new Date("2026-04-20"), eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.updatedUrgency).toBe("UPCOMING"); // ~19 days away
    expect(result.changed).toBe(true);
  });

  it("returns changed=false when nothing changes", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "THIS_WEEK",
      actions: [
        { id: "a1", status: "PENDING", dueDate: null, eventStartTime: new Date("2026-04-05T10:00:00Z"), eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.changed).toBe(false);
  });

  it("handles case with no actions -- preserves existing urgency", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "UPCOMING",
      actions: [],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.changed).toBe(false);
    expect(result.updatedUrgency).toBe("UPCOMING");
  });

  it("handles PENDING actions with no dates -- preserves existing urgency", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "UPCOMING",
      actions: [
        { id: "a1", status: "PENDING", dueDate: null, eventStartTime: null, eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.expiredActionIds).toEqual([]);
    expect(result.updatedUrgency).toBe("UPCOMING");
    expect(result.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && npx vitest run src/__tests__/lifecycle.test.ts`
Expected: FAIL (`computeCaseDecay` is not exported)

- [ ] **Step 3: Add `computeCaseDecay` to lifecycle.ts**

Append to `packages/engine/src/actions/lifecycle.ts`:

```typescript
export interface CaseDecayActionInput {
  id: string;
  status: ActionStatusInput;
  dueDate: Date | null;
  eventStartTime: Date | null;
  eventEndTime: Date | null;
}

export interface CaseDecayInput {
  caseStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  caseUrgency: string;
  actions: CaseDecayActionInput[];
  lastEmailDate: Date;
}

export interface CaseDecayResult {
  updatedUrgency: string;
  updatedStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  expiredActionIds: string[];
  nextActionDate: Date | null;
  changed: boolean;
}

/**
 * Compute urgency decay for a case based on its actions and the current time.
 * Expires PENDING actions whose dates have passed, recalculates urgency tier
 * from the nearest upcoming action, and resolves cases with no remaining actions.
 *
 * Pure function -- no I/O, no Date.now(). Takes `now` as explicit parameter.
 */
export function computeCaseDecay(input: CaseDecayInput, now: Date): CaseDecayResult {
  // Resolved cases are terminal -- don't touch them
  if (input.caseStatus === "RESOLVED") {
    return {
      updatedUrgency: input.caseUrgency,
      updatedStatus: "RESOLVED",
      expiredActionIds: [],
      nextActionDate: null,
      changed: false,
    };
  }

  const expiredActionIds: string[] = [];

  // Step 1: Find PENDING actions whose dates have fully passed
  for (const action of input.actions) {
    if (action.status !== "PENDING") continue;
    // Use eventEndTime if available (event isn't over until it ends)
    const actionDate = action.eventEndTime ?? action.eventStartTime ?? action.dueDate;
    if (actionDate && actionDate < now) {
      expiredActionIds.push(action.id);
    }
  }

  // Step 2: Identify remaining live actions (PENDING and not being expired)
  const stillPending = input.actions.filter(
    (a) => a.status === "PENDING" && !expiredActionIds.includes(a.id),
  );

  // Step 3: Find nearest future date from remaining pending actions
  const futureDates: Date[] = [];
  for (const action of stillPending) {
    if (action.dueDate && action.dueDate >= now) futureDates.push(action.dueDate);
    if (action.eventStartTime && action.eventStartTime >= now) futureDates.push(action.eventStartTime);
  }
  futureDates.sort((a, b) => a.getTime() - b.getTime());
  const nearest = futureDates[0] ?? null;

  // Step 4: Derive urgency from nearest future action
  let updatedUrgency = input.caseUrgency;
  let updatedStatus = input.caseStatus;

  if (stillPending.length === 0) {
    // No remaining pending actions -- everything is done or expired
    updatedUrgency = "NO_ACTION";
    updatedStatus = "RESOLVED";
  } else if (nearest) {
    const hoursUntil = (nearest.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntil <= 48) updatedUrgency = "IMMINENT";
    else if (hoursUntil <= 168) updatedUrgency = "THIS_WEEK";
    else updatedUrgency = "UPCOMING";
  }
  // else: pending actions exist but have no dates -- preserve current urgency

  // Step 5: Compute nextActionDate from all remaining pending actions
  const nextActionDate = computeNextActionDate(
    stillPending.map((a) => ({
      status: a.status,
      dueDate: a.dueDate,
      eventStartTime: a.eventStartTime,
    })),
  );

  const changed =
    updatedUrgency !== input.caseUrgency ||
    updatedStatus !== input.caseStatus ||
    expiredActionIds.length > 0;

  return { updatedUrgency, updatedStatus, expiredActionIds, nextActionDate, changed };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd packages/engine && npx vitest run src/__tests__/lifecycle.test.ts`
Expected: All 17 tests PASS (8 from Task 1 + 9 new)

- [ ] **Step 5: Commit**

```
feat(engine): add computeCaseDecay pure function

Expires past PENDING actions, recalculates urgency tiers from
nearest upcoming action date, resolves cases with no remaining
actions. Uses eventEndTime before eventStartTime for events.
```

---

### Task 3: Export new functions from `@denim/engine`

**Files:**
- Modify: `packages/engine/src/index.ts`

- [ ] **Step 1: Add exports to index.ts**

Add to the end of `packages/engine/src/index.ts`:

```typescript
export { computeNextActionDate, computeCaseDecay } from "./actions/lifecycle";
export type { CaseDecayInput, CaseDecayResult, ActionDateInput } from "./actions/lifecycle";
```

- [ ] **Step 2: Verify package builds**

Run: `cd packages/engine && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```
feat(engine): export lifecycle functions from package index
```

---

### Task 4: Add `nextActionDate` to Prisma schema

**Files:**
- Modify: `apps/web/prisma/schema.prisma`

- [ ] **Step 1: Add `nextActionDate` field to Case model**

In `apps/web/prisma/schema.prisma`, in the Case model after the `lastEmailDate` field (line 539), add:

```prisma
  nextActionDate    DateTime?           // MIN(dueDate, eventStartTime) across PENDING actions
```

- [ ] **Step 2: Replace urgency index with nextActionDate index**

Replace `@@index([schemaId, status, urgency])` (line 559) with:

```prisma
  @@index([schemaId, status, nextActionDate])
```

- [ ] **Step 3: Push schema to Supabase**

Per project memory, `prisma db push` may hang. Use the workaround if needed. Generate client after push.

Run: `cd apps/web && npx prisma db push && npx prisma generate`
Expected: Schema pushed, `nextActionDate` column added, Prisma Client regenerated.

- [ ] **Step 4: Verify type check**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```
schema: add Case.nextActionDate for deterministic feed sorting

Denormalized MIN(dueDate, eventStartTime) across PENDING actions.
Replaces urgency-tier index with nextActionDate index for feed queries.
```

---

### Task 5: Compute `nextActionDate` in synthesis service

**Files:**
- Modify: `apps/web/src/lib/services/synthesis.ts`

- [ ] **Step 1: Import new functions**

Update the `@denim/engine` import (line 24):

```typescript
import { generateFingerprint, matchAction, computeNextActionDate, computeCaseDecay } from "@denim/engine";
```

- [ ] **Step 2: Compute and write `nextActionDate` inside the transaction**

After the CaseAction creation/update loop (inside the transaction, after line 382), add:

```typescript
    // Compute nextActionDate from all PENDING actions for this case
    const allPendingActions = await tx.caseAction.findMany({
      where: { caseId, status: "PENDING" },
      select: { dueDate: true, eventStartTime: true, status: true },
    });
    const nextActionDate = computeNextActionDate(
      allPendingActions.map((a) => ({
        status: a.status as "PENDING",
        dueDate: a.dueDate,
        eventStartTime: a.eventStartTime,
      })),
    );
    await tx.case.update({
      where: { id: caseId },
      data: { nextActionDate },
    });
```

- [ ] **Step 3: Replace the post-synthesis urgency override (lines 385-399)**

Delete the old block that only checks EVENT actions. Replace with:

```typescript
  // 10. Deterministic urgency + decay via computeCaseDecay
  const nowForDecay = new Date();
  const currentCase = await prisma.case.findUnique({
    where: { id: caseId },
    select: { status: true, urgency: true, lastEmailDate: true },
  });
  if (currentCase) {
    const freshActions = await prisma.caseAction.findMany({
      where: { caseId },
      select: { id: true, status: true, dueDate: true, eventStartTime: true, eventEndTime: true },
    });
    const decay = computeCaseDecay(
      {
        caseStatus: currentCase.status,
        caseUrgency: currentCase.urgency ?? "UPCOMING",
        actions: freshActions.map((a) => ({
          id: a.id,
          status: a.status as "PENDING" | "DONE" | "EXPIRED" | "SUPERSEDED" | "DISMISSED",
          dueDate: a.dueDate,
          eventStartTime: a.eventStartTime,
          eventEndTime: a.eventEndTime,
        })),
        lastEmailDate: currentCase.lastEmailDate ?? nowForDecay,
      },
      nowForDecay,
    );
    if (decay.changed) {
      if (decay.expiredActionIds.length > 0) {
        await prisma.caseAction.updateMany({
          where: { id: { in: decay.expiredActionIds } },
          data: { status: "EXPIRED" },
        });
      }
      await prisma.case.update({
        where: { id: caseId },
        data: {
          urgency: decay.updatedUrgency,
          status: decay.updatedStatus,
          nextActionDate: decay.nextActionDate,
        },
      });
    }
  }
```

- [ ] **Step 4: Verify type check**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```
feat: compute nextActionDate + decay in synthesis service

Replaces hardcoded EVENT-only urgency override with full computeCaseDecay.
Now considers all action types (TASK, PAYMENT, DEADLINE, RESPONSE, EVENT)
and writes nextActionDate for deterministic feed sorting.
```

---

### Task 6: Fix API sort order

**Files:**
- Modify: `apps/web/src/app/api/cases/route.ts`

- [ ] **Step 1: Remove the in-memory sort infrastructure**

Delete lines 8-65 entirely: the `URGENCY_ORDER`, `STATUS_ORDER`, `getNextEventTime`, and `sortCases` function. These are replaced by DB-level sorting.

- [ ] **Step 2: Add import for `computeCaseDecay`**

Add at top of file:

```typescript
import { computeCaseDecay } from "@denim/engine";
```

- [ ] **Step 3: Change the Prisma `orderBy`**

Replace line 102:

```typescript
// Old:
orderBy: { lastEmailDate: "desc" },

// New:
orderBy: [
  { nextActionDate: { sort: "asc", nulls: "last" } },
  { lastEmailDate: "desc" },
],
```

- [ ] **Step 4: Add `eventEndTime` to the actions select**

Update the `actions` select block to include `eventEndTime`:

```typescript
actions: {
  where: { status: "PENDING" },
  take: 3,
  orderBy: { dueDate: "asc" },
  select: {
    id: true,
    title: true,
    actionType: true,
    dueDate: true,
    eventStartTime: true,
    eventEndTime: true,
    status: true,
  },
},
```

- [ ] **Step 5: Replace `sortCases` call with read-time freshness**

Replace the `const sorted = sortCases(formatted)` line and the return with:

```typescript
    // Apply read-time freshness -- recalculate urgency without persisting
    const now = new Date();
    const fresh = formatted.map((c) => {
      const decay = computeCaseDecay(
        {
          caseStatus: c.status as "OPEN" | "IN_PROGRESS" | "RESOLVED",
          caseUrgency: c.urgency ?? "UPCOMING",
          actions: c.actions.map((a) => ({
            id: a.id,
            status: a.status as "PENDING" | "DONE" | "EXPIRED" | "SUPERSEDED" | "DISMISSED",
            dueDate: a.dueDate ? new Date(a.dueDate) : null,
            eventStartTime: a.eventStartTime ? new Date(a.eventStartTime) : null,
            eventEndTime: a.eventEndTime ? new Date(a.eventEndTime) : null,
          })),
          lastEmailDate: c.lastEmailDate ? new Date(c.lastEmailDate) : now,
        },
        now,
      );
      return {
        ...c,
        urgency: decay.updatedUrgency,
        status: decay.updatedStatus,
      };
    });

    return NextResponse.json({ data: { cases: fresh, nextCursor } });
```

- [ ] **Step 6: Verify type check**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 7: Commit**

```
fix: sort case feed by nextActionDate instead of lastEmailDate

Replaces in-memory urgency-tier sorting with DB-level nextActionDate ASC.
Adds read-time freshness check via computeCaseDecay so urgency is
always current between daily cron runs.
```

---

### Task 7: Daily status decay Inngest cron job

**Files:**
- Create: `apps/web/src/lib/inngest/daily-status-decay.ts`
- Modify: `apps/web/src/lib/inngest/functions.ts`

- [ ] **Step 1: Create the cron function**

```typescript
// apps/web/src/lib/inngest/daily-status-decay.ts
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { inngest } from "./client";
import { computeCaseDecay } from "@denim/engine";

/**
 * Daily status decay: expires past actions, recalculates urgency tiers,
 * resolves cases with no remaining actions, and updates nextActionDate.
 * Runs at 6 AM ET daily for all non-terminal cases.
 */
export const dailyStatusDecay = inngest.createFunction(
  {
    id: "daily-status-decay",
    triggers: [{ cron: "TZ=America/New_York 0 6 * * *" }],
    concurrency: { limit: 1 },
    retries: 1,
  },
  async ({ step }) => {
    const now = new Date();

    const cases = await step.run("load-cases", async () => {
      return prisma.case.findMany({
        where: {
          status: { not: "RESOLVED" },
          urgency: { not: "IRRELEVANT" },
        },
        select: {
          id: true,
          status: true,
          urgency: true,
          lastEmailDate: true,
          actions: {
            where: { status: "PENDING" },
            select: {
              id: true,
              status: true,
              dueDate: true,
              eventStartTime: true,
              eventEndTime: true,
            },
          },
        },
      });
    });

    let updatedCount = 0;

    for (const c of cases) {
      const decay = computeCaseDecay(
        {
          caseStatus: c.status as "OPEN" | "IN_PROGRESS" | "RESOLVED",
          caseUrgency: c.urgency ?? "UPCOMING",
          actions: c.actions.map((a) => ({
            id: a.id,
            status: a.status as "PENDING",
            dueDate: a.dueDate,
            eventStartTime: a.eventStartTime,
            eventEndTime: a.eventEndTime,
          })),
          lastEmailDate: c.lastEmailDate ?? now,
        },
        now,
      );

      if (!decay.changed) continue;

      await step.run(`decay-${c.id}`, async () => {
        if (decay.expiredActionIds.length > 0) {
          await prisma.caseAction.updateMany({
            where: { id: { in: decay.expiredActionIds } },
            data: { status: "EXPIRED" },
          });
        }

        await prisma.case.update({
          where: { id: c.id },
          data: {
            urgency: decay.updatedUrgency,
            status: decay.updatedStatus,
            nextActionDate: decay.nextActionDate,
          },
        });

        updatedCount++;
      });
    }

    logger.info({
      service: "inngest",
      operation: "dailyStatusDecay",
      totalCases: cases.length,
      updatedCount,
    });
  },
);
```

- [ ] **Step 2: Register in the functions array**

In `apps/web/src/lib/inngest/functions.ts`, add import:

```typescript
import { dailyStatusDecay } from "./daily-status-decay";
```

Update the export on line 642:

```typescript
export const functions = [fanOutExtraction, extractBatch, checkExtractionComplete, runCoarseClustering, runCaseSplitting, runSynthesis, runClusteringCalibration, resynthesizeOnFeedback, dailyQualitySnapshot, dailyStatusDecay];
```

- [ ] **Step 3: Verify type check**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```
feat: add daily status decay cron job (6 AM ET)

Expires past PENDING actions, recalculates urgency tiers, resolves
fully-expired cases, and updates nextActionDate. Ensures case feed
stays fresh without any AI calls.
```

---

### Task 8: Backfill `nextActionDate` for existing cases

**Files:**
- Create: `scripts/backfill-next-action-date.ts`

- [ ] **Step 1: Create backfill script**

```typescript
// scripts/backfill-next-action-date.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeNextActionDate } from "@denim/engine";

const prisma = new PrismaClient();

async function main() {
  const cases = await prisma.case.findMany({
    where: { status: { not: "RESOLVED" } },
    select: {
      id: true,
      actions: {
        where: { status: "PENDING" },
        select: { dueDate: true, eventStartTime: true, status: true },
      },
    },
  });

  let updated = 0;
  for (const c of cases) {
    const nextActionDate = computeNextActionDate(
      c.actions.map((a) => ({
        status: a.status as "PENDING",
        dueDate: a.dueDate,
        eventStartTime: a.eventStartTime,
      })),
    );

    if (nextActionDate !== null) {
      await prisma.case.update({
        where: { id: c.id },
        data: { nextActionDate },
      });
      updated++;
    }
  }

  console.error(`Backfilled nextActionDate for ${updated}/${cases.length} cases`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run backfill**

Run: `cd apps/web && npx tsx ../../scripts/backfill-next-action-date.ts`
Expected: Output showing count of backfilled cases

- [ ] **Step 3: Commit**

```
chore: add one-time backfill script for Case.nextActionDate
```

---

### Task 9: Update documentation

**Files:**
- Modify: `docs/ux-redesign-plan.md`
- Modify: `docs/00_denim_current_status.md`

- [ ] **Step 1: Update UX redesign plan sort order**

In `docs/ux-redesign-plan.md`, find the proposed `/api/feed` route orderBy and update to:

```typescript
orderBy: [
  { nextActionDate: { sort: 'asc', nulls: 'last' } },
  { lastEmailDate: 'desc' },
],
```

Add implementation status note to the "Deterministic Status Decay" section:

```markdown
**Status: IMPLEMENTED (2026-03-31)**
- `computeNextActionDate` + `computeCaseDecay` in `packages/engine/src/actions/lifecycle.ts`
- Daily cron: `apps/web/src/lib/inngest/daily-status-decay.ts` (6 AM ET)
- Read-time freshness: applied in `/api/cases` route
- Feed sort: `nextActionDate ASC NULLS LAST, lastEmailDate DESC`
- Post-synthesis urgency override now uses full computeCaseDecay (all action types)
```

- [ ] **Step 2: Update current status doc**

Add section to `docs/00_denim_current_status.md`:

```markdown
### Case Urgency Sort & Decay (2026-03-31)

**Problem:** Case feed sorted by `lastEmailDate DESC` -- recent emails first regardless of urgency. Urgency tiers frozen at synthesis time, never updated. Post-synthesis override only checked EVENT actions, missing TASK/PAYMENT/DEADLINE/RESPONSE.

**Fix:**
- New `Case.nextActionDate` field: `MIN(dueDate, eventStartTime)` across PENDING actions
- `computeCaseDecay` pure function in `@denim/engine`: expires past actions, recalculates urgency tiers
- `computeNextActionDate` pure function: computes denormalized sort key
- Daily Inngest cron (6 AM ET): persists decay to DB
- Read-time freshness: API applies `computeCaseDecay` at read time between cron runs
- Feed sort: `nextActionDate ASC NULLS LAST, lastEmailDate DESC` (DB-level, no in-memory re-sort)
- Post-synthesis urgency override replaced with full `computeCaseDecay` (covers all action types)
```

- [ ] **Step 3: Commit**

```
docs: update sort order and decay status in planning docs
```

---

### Task 10: Run full test suite

- [ ] **Step 1: Run engine unit tests**

Run: `cd packages/engine && npx vitest run`
Expected: All tests pass (existing + 17 new lifecycle tests)

- [ ] **Step 2: Run full type check**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 3: Run web build**

Run: `pnpm --filter web build`
Expected: Build succeeds

- [ ] **Step 4: Run integration tests if dev server available**

Run: `cd apps/web && pnpm test:integration`
Expected: Existing integration tests pass. Synthesis tests may need minor updates if they assert on the old urgency override behavior.
