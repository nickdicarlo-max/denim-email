# New-Schema-On-Edit Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/inputs` PATCH rewind primitive added by #127 with a "create new schema, abandon old" primitive that respects the codebase's single-writer-per-CAS-transition rule. This unblocks the Back-to-edit-topics UX path that silently fails today after the first rewind.

**Architecture:** Clicking Back from Stage 1 review navigates the user to `/onboarding/names?from=<oldSchemaId>`, pre-filled from the existing polling DTO. Saving POSTs `/api/onboarding/start` (the happy path already used for new onboarding), with an optional `abandonSchemaId` body field. The `start` route's existing `$transaction` gains one additional `updateMany` that flips the old schema's `status` from `DRAFT` → `ABANDONED`. All list queries exclude `ABANDONED`. In-flight Inngest runs on the old schema finish into a dead row — no cancellation needed.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (driver-adapter), Supabase Postgres, Inngest. Biome for lint/format. Vitest for unit tests.

---

## Files Touched

**Create:**
- none (no new files — we're shrinking the surface area, not growing it)

**Delete:**
- `apps/web/src/app/api/onboarding/[schemaId]/inputs/route.ts`
- `apps/web/src/app/api/onboarding/[schemaId]/inputs/__tests__/route.test.ts`
- `apps/web/src/app/api/onboarding/[schemaId]/inputs/` (the empty directory itself after the two files are gone)

**Modify:**
- `apps/web/prisma/schema.prisma` — add `ABANDONED` to the `SchemaStatus` enum.
- `apps/web/src/lib/services/interview.ts` — remove `rewindSchemaInputs` export; extend `createSchemaStub` signature with optional `abandonSchemaId`.
- `apps/web/src/app/api/onboarding/start/route.ts` — extend `StartBodySchema` with optional `abandonSchemaId`; inside the existing `$transaction`, atomically flip the old schema's `status` when present.
- `apps/web/src/app/onboarding/names/page.tsx` — rewrite edit-mode branch to read `?from=<oldSchemaId>` (not `?schemaId=`), load inputs via the existing polling GET, and POST /start with `abandonSchemaId` on Save. Redirect to the new schemaId.
- `apps/web/src/components/onboarding/phase-domain-confirmation.tsx:229` — change Back button URL from `/onboarding/names?schemaId=${id}` to `/onboarding/names?from=${id}`. Leave button label unchanged ("Back — edit topics & contacts").
- `apps/web/src/lib/services/onboarding-polling.ts` — add `ABANDONED` to the `OnboardingPhase` union AND to `derivePollingResponse` terminal-state branches. Return `{ phase: "ABANDONED" }` when the row has `status = "ABANDONED"` so the client can navigate away rather than poll forever.
- `apps/web/src/app/api/onboarding/[schemaId]/route.ts` — POST handler: add `status === "ABANDONED"` → 410 Gone branch. DELETE handler: treat ABANDONED like ARCHIVED (no-op idempotent response).
- `apps/web/src/app/(authenticated)/settings/topics/page.tsx:14` — add `status: { not: "ABANDONED" }` to the `findMany` where clause.
- `apps/web/src/app/page.tsx:62` — add `status: { not: "ABANDONED" }` to the landing-page destination query.
- `apps/web/src/app/auth/callback/route.ts:176` — same filter on the schemaCount query.
- `apps/web/src/app/api/feed/route.ts:13` — no change needed (already filters to `status: { in: ["ACTIVE", "ONBOARDING"] }`, which excludes ABANDONED implicitly).
- `docs/01_denim_lessons_learned.md` — new section describing this as the third CAS-second-writer class bug, plus a preventive rule ("any new feature that transitions a phase must go through the CAS helper, not direct SET; better still: create a new row rather than moving backwards").

**Consult (read-only, don't modify):**
- `apps/web/src/lib/inngest/domain-discovery-fn.ts` — the CAS owner for `PENDING → DISCOVERING_DOMAINS`. After this plan lands, its guard continues to be the single authoritative writer for that transition. No changes needed.
- `apps/web/src/lib/inngest/onboarding.ts` — `runOnboarding` reads the stub and emits `onboarding.domain-discovery.requested`. No changes needed.
- `apps/web/src/lib/inngest/onboarding-outbox-drain.ts` — the drain cron. Re-emits events for rows with `status = PENDING_EMIT`. No interaction with ABANDONED schemas because abandoning doesn't touch the outbox.

---

## Task 0: Pre-flight verification

**Files (read only):**
- `apps/web/prisma/schema.prisma:209-215` — confirm `SchemaStatus` values.
- `apps/web/src/lib/services/interview.ts:1079-1111` — confirm `rewindSchemaInputs` exists and is the only caller-visible rewind symbol.

- [ ] **Step 1: Confirm current enum values**

Read `apps/web/prisma/schema.prisma:209-215`. Expected values: `DRAFT`, `ONBOARDING`, `ACTIVE`, `PAUSED`, `ARCHIVED`. If the file differs, halt and update this plan before proceeding.

- [ ] **Step 2: Confirm rewindSchemaInputs is only referenced by the inputs route**

Run:
```bash
grep -rn "rewindSchemaInputs" apps/web/src/
```

Expected: exactly two file references — the definition in `apps/web/src/lib/services/interview.ts` and the import in `apps/web/src/app/api/onboarding/[schemaId]/inputs/route.ts`. If there are other callers, halt and document them here before proceeding.

- [ ] **Step 3: Confirm dev server + Inngest dev are running**

Run:
```bash
netstat -ano | grep -E "LISTENING.*:(3000|8288)"
```

Expected: both 3000 and 8288 listening. If not, tell the user to start them — this plan's verification steps rely on a live dev server.

- [ ] **Step 4: Commit nothing, no-op task**

No code changes in this task. Purely verification.

---

## Task 1: Add `ABANDONED` enum value (DB + Prisma)

**Files:**
- Modify: `apps/web/prisma/schema.prisma:209-215`

- [ ] **Step 1: Add the enum value to Prisma schema**

Change `apps/web/prisma/schema.prisma:209-215` from:

```prisma
enum SchemaStatus {
  DRAFT         // Interview in progress
  ONBOARDING    // Initial scan running
  ACTIVE        // Normal operation
  PAUSED        // User paused scanning
  ARCHIVED      // Cancelled onboarding or user-archived — excluded from active lists
}
```

To:

```prisma
enum SchemaStatus {
  DRAFT         // Interview in progress
  ONBOARDING    // Initial scan running
  ACTIVE        // Normal operation
  PAUSED        // User paused scanning
  ARCHIVED      // Cancelled onboarding or user-archived — excluded from active lists
  ABANDONED     // User clicked Back → edit, replaced this row with a new schema (#130)
}
```

- [ ] **Step 2: Apply the DB migration via supabase-db skill**

Never use `prisma db push` (it hangs on this setup — see `CLAUDE.md`). Instead invoke the `supabase-db` skill and run:

```bash
cd apps/web && npx tsx <<'SCRIPT' 2>&1
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
await p.$executeRawUnsafe(`ALTER TYPE "SchemaStatus" ADD VALUE IF NOT EXISTS 'ABANDONED'`);
process.stderr.write('ABANDONED added to SchemaStatus enum\n');
await p.$disconnect();
SCRIPT
```

Expected stderr: `ABANDONED added to SchemaStatus enum`. If it errors, read the error and stop.

- [ ] **Step 3: Regenerate Prisma client**

Run:
```bash
pnpm --filter web prisma generate
```

Expected: "Generated Prisma Client (v7.x.x) … in XXXms". No errors.

- [ ] **Step 4: Verify with a typecheck round-trip**

Run:
```bash
pnpm typecheck
```

Expected: clean. The `ABANDONED` literal must now be a valid value in the generated `SchemaStatus` TypeScript type.

- [ ] **Step 5: Commit**

```bash
git add apps/web/prisma/schema.prisma
git commit -m "feat(schema): #130 add ABANDONED SchemaStatus for new-schema-on-edit"
```

Do NOT stage any other files — the DB migration is already applied via raw SQL (not via `prisma migrate dev`) and Prisma's generated client is ignored.

---

## Task 2: Extend `createSchemaStub` + `StartBodySchema` with `abandonSchemaId`

**Files:**
- Modify: `apps/web/src/lib/services/interview.ts:334-380`
- Modify: `apps/web/src/app/api/onboarding/start/route.ts:70-76` (Zod body schema) and `:157-168` (the `$transaction` body)

**Design rule:** `abandonSchemaId` is optional. When present, the same transaction that creates the new schema stub flips the old row from `DRAFT` → `ABANDONED`. The flip is CAS-gated by `{ id: abandonSchemaId, userId, status: "DRAFT" }` so cross-user or post-scan schemas cannot be abandoned. A 0-row update is silent (no error) — the new schema still commits, the old one just wasn't in an abandonable state.

- [ ] **Step 1: Write the failing test — start route atomically abandons the old schema**

Add a new test case to `apps/web/src/app/api/onboarding/start/__tests__/route.test.ts` (file may not exist — create if missing; check first with `ls`). If the file doesn't exist, create it with a minimal scaffold matching the shape of `apps/web/src/app/api/onboarding/[schemaId]/inputs/__tests__/route.test.ts` (still present at this point — delete happens in Task 7).

Test case (add to the existing describe block, or wrap in a new one if the file is new):

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
// Assume existing imports + withAuth mock. If file is new, mirror the
// setup in apps/web/src/app/api/onboarding/[schemaId]/inputs/__tests__/route.test.ts
// (mock withAuth to pass through, mock prisma, mock inngest.send, etc.).

describe("POST /api/onboarding/start with abandonSchemaId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomically creates the new stub AND flips the old schema to ABANDONED", async () => {
    const userId = "user-1";
    const oldSchemaId = "01OLD0000000000000000000000";
    const newSchemaId = "01NEW0000000000000000000000";

    // Mock: no existing outbox row for newSchemaId → slow path engages.
    vi.mocked(prisma.onboardingOutbox.findUnique).mockResolvedValue(null);

    // Capture the transaction's tx-side calls.
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({ id: newSchemaId });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      return fn({
        caseSchema: { create, updateMany },
        onboardingOutbox: { create: vi.fn().mockResolvedValue({}) },
      });
    });

    const body = { schemaId: newSchemaId, inputs: validInputsFixture, abandonSchemaId: oldSchemaId };
    const res = await POST(makeRequest(body), { params: Promise.resolve({}) });

    expect(res.status).toBe(202);
    expect(create).toHaveBeenCalled(); // new stub created
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: oldSchemaId, userId, status: "DRAFT" },
      data: { status: "ABANDONED" },
    }));
  });

  it("does not flip when abandonSchemaId is omitted", async () => {
    vi.mocked(prisma.onboardingOutbox.findUnique).mockResolvedValue(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const create = vi.fn().mockResolvedValue({ id: "01NEW0000000000000000000000" });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      return fn({
        caseSchema: { create, updateMany },
        onboardingOutbox: { create: vi.fn().mockResolvedValue({}) },
      });
    });

    await POST(
      makeRequest({ schemaId: "01NEW0000000000000000000000", inputs: validInputsFixture }),
      { params: Promise.resolve({}) },
    );

    expect(create).toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm --filter web test src/app/api/onboarding/start/__tests__/route.test.ts
```

Expected: FAIL. The new cases fail because (a) `StartBodySchema` rejects `abandonSchemaId` as an unknown key, or (b) `updateMany` is never called.

- [ ] **Step 3: Extend `StartBodySchema`**

In `apps/web/src/app/api/onboarding/start/route.ts`, change the schema definition at lines 70–76 from:

```ts
const StartBodySchema = z.object({
  schemaId: z.string().min(10),
  inputs: InterviewInputSchema,
});
```

To:

```ts
const StartBodySchema = z.object({
  schemaId: z.string().min(10),
  inputs: InterviewInputSchema,
  /**
   * #130: when the user clicks Back → edit topics & contacts on an
   * existing DRAFT schema, the names page POSTs /start with a fresh
   * `schemaId` AND carries the old id here. The start transaction
   * atomically flips the old row to `status = "ABANDONED"` in the same
   * commit as the new stub creation. CAS-gated on userId + status =
   * DRAFT so cross-user or post-scan rows cannot be abandoned.
   */
  abandonSchemaId: z.string().min(10).optional(),
});
```

- [ ] **Step 4: Pass `abandonSchemaId` into the transaction**

In the same file, modify the `$transaction` block (currently at lines 157–168). Change:

```ts
try {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await createSchemaStub({ tx, schemaId, userId, inputs });
    await tx.onboardingOutbox.create({
      data: {
        schemaId,
        userId,
        eventName: "onboarding.session.started",
        payload: { schemaId, userId } as Prisma.InputJsonValue,
      },
    });
  });
} catch (createError) {
```

To:

```ts
const { abandonSchemaId } = body;

try {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await createSchemaStub({ tx, schemaId, userId, inputs });
    await tx.onboardingOutbox.create({
      data: {
        schemaId,
        userId,
        eventName: "onboarding.session.started",
        payload: { schemaId, userId } as Prisma.InputJsonValue,
      },
    });
    // #130: Abandon the old schema atomically with the new stub creation.
    // CAS-gated — only flips rows the user owns that are still DRAFT. A
    // 0-row update is silent (e.g. the client's `abandonSchemaId` was
    // already past DRAFT, or belongs to another user). The caller doesn't
    // need the count — best-effort abandonment is correct semantics here.
    if (abandonSchemaId) {
      await tx.caseSchema.updateMany({
        where: { id: abandonSchemaId, userId, status: "DRAFT" },
        data: { status: "ABANDONED" },
      });
    }
  });
} catch (createError) {
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
pnpm --filter web test src/app/api/onboarding/start/__tests__/route.test.ts
```

Expected: PASS (all cases, including pre-existing ones).

- [ ] **Step 6: Run full web test suite to catch regressions**

Run:
```bash
pnpm --filter web test
```

Expected: same pass count as before + the new cases. No failures.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/onboarding/start/route.ts apps/web/src/app/api/onboarding/start/__tests__/route.test.ts
git commit -m "feat(onboarding): #130 atomically abandon old schema on edit-restart"
```

---

## Task 3: Update the Back button URL on the domain-confirmation screen

**Files:**
- Modify: `apps/web/src/components/onboarding/phase-domain-confirmation.tsx:229`

This is a single-line change but it's the UI contract that the `from` query param (not `schemaId`) is now the "edit this one" signal. Separating it into its own commit makes git-blame clean.

- [ ] **Step 1: Change the Back button route**

In `apps/web/src/components/onboarding/phase-domain-confirmation.tsx`, change line 229 from:

```tsx
onClick={() => router.push(`/onboarding/names?schemaId=${response.schemaId}`)}
```

To:

```tsx
onClick={() => router.push(`/onboarding/names?from=${response.schemaId}`)}
```

Also update the comment block above (lines 223–226) so it no longer says "rewind":

```tsx
{/* #130: back-edit escape hatch. Routes the user to the names page
    pre-filled with the old schema's inputs (loaded server-side via
    the existing polling endpoint). Saving creates a fresh schema and
    abandons this one — no in-place rewind, no CAS-ownership risk. */}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/onboarding/phase-domain-confirmation.tsx
git commit -m "feat(ui): #130 Back-edit routes to /names?from=<id>"
```

---

## Task 4: Rewrite `/onboarding/names` edit-mode to read `?from=` and POST /start

**Files:**
- Modify: `apps/web/src/app/onboarding/names/page.tsx` (the `editingSchemaId` branch — currently handles `?schemaId=`; after this task it reads `?from=` and branches POST /start with `abandonSchemaId`)

**Design notes:**
- Replace every reference to `editingSchemaId` / `schemaId` in the edit branch with `fromSchemaId`. The server-side polling GET still works as-is (it serves any schema the user owns); no route change.
- On Save, generate a fresh ULID (client-side — match the style already used by the new-session flow in `onboarding/connect/page.tsx`) as the new `schemaId`, and pass `abandonSchemaId: fromSchemaId` alongside.
- Redirect target on success stays `/onboarding/${newSchemaId}` so polling picks up the fresh row.
- Error handling: on non-ok from POST /start, render the existing `submitError` copy. No special case.

- [ ] **Step 1: Read the current file to find the exact line ranges**

Before editing, read `apps/web/src/app/onboarding/names/page.tsx` from line 30 through line 250 so you can stage an accurate diff. The edit-mode logic lives mostly in:
- Lines 30–36 (declares `editingSchemaId` via `searchParams.get("schemaId")`)
- Lines 65–108 (edit-mode load effect using `editingSchemaId`)
- Lines 204–238 (handleContinue's edit-mode branch — the PATCH call)
- Lines 250–272 (loading / error states gated on `editingSchemaId`)
- Lines 262 (error-state button text "Back to topic" — routes to `/onboarding/${editingSchemaId}`)
- Lines 282–298 (back-arrow chip — `editingSchemaId ? ... : "/onboarding/category"`)
- Lines 449–457 (Continue button label branches on `editingSchemaId`)

- [ ] **Step 2: Rename the query-param read + state variable**

Change line 36 from:

```tsx
const editingSchemaId = searchParams.get("schemaId");
```

To:

```tsx
const fromSchemaId = searchParams.get("from");
```

Then do a find-replace across the file (only within this file) of `editingSchemaId` → `fromSchemaId`. Expected: ~10 occurrences. Verify after the replace that every reference is inside this same file — no cross-file shared type/import uses that name.

- [ ] **Step 3: Update the edit-load effect comments (cosmetic, matches new semantics)**

Lines 33–35 currently read:

```tsx
// #127: when present, edit mode — load inputs from the existing schema
// (via the polling endpoint) instead of the sessionStorage draft, and
// submit via PATCH /inputs instead of POST /start.
```

Replace with:

```tsx
// #130: when `?from=<oldSchemaId>` is present, edit mode — load inputs
// from the existing schema (via the polling endpoint) instead of the
// sessionStorage draft. On Save, POST /start with a fresh schemaId AND
// `abandonSchemaId: fromSchemaId` so the old row is atomically flipped
// to ABANDONED while the new one starts fresh. No in-place rewind.
```

- [ ] **Step 4: Rewrite the Save handler (edit-mode branch)**

Find the block in `handleContinue` that starts with `if (editingSchemaId)` (now `if (fromSchemaId)` after Step 2 rename). It currently does a PATCH to `/api/onboarding/${fromSchemaId}/inputs`. Replace the entire branch with:

```tsx
if (fromSchemaId) {
  if (!domain) return; // ready-state gate, should be unreachable

  // Generate a fresh ULID for the new schema. We use the same pattern
  // as the new-session flow — client-side generation so the id is
  // stable across retries and the server's /start route can use it
  // as the outbox PK.
  const newSchemaId = ulid();

  setSubmitting(true);
  setSubmitError(null);
  try {
    const res = await authenticatedFetch(`/api/onboarding/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaId: newSchemaId,
        abandonSchemaId: fromSchemaId,
        inputs: {
          role: ROLE_OPTIONS.find((r) => r.label === roleLabel)?.id ?? "",
          domain,
          whats,
          whos,
          goals: [],
          groups,
          ...(trimmedName ? { name: trimmedName } : {}),
        },
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Save failed (${res.status})`);
    }
    router.push(`/onboarding/${newSchemaId}`);
  } catch (err) {
    setSubmitError(err instanceof Error ? err.message : "Save failed");
    setSubmitting(false);
  }
  return;
}
```

Make sure to add the `ulid` import at the top of the file if it's not already present. Check `apps/web/src/app/onboarding/connect/page.tsx` for the existing import — use the same source (`import { ulid } from "ulid"` or `"@/lib/ulid"` — whichever is used there).

- [ ] **Step 5: Typecheck**

Run:
```bash
pnpm typecheck
```

Expected: clean. If `ulid` import isn't resolving, grep the repo for existing usage:
```bash
grep -rn "import.*ulid" apps/web/src | head -5
```

- [ ] **Step 6: Biome format**

Run:
```bash
pnpm biome check --apply apps/web/src/app/onboarding/names/page.tsx apps/web/src/components/onboarding/phase-domain-confirmation.tsx
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/onboarding/names/page.tsx
git commit -m "feat(onboarding): #130 /names edit-mode POSTs /start with abandonSchemaId"
```

---

## Task 5: Add `ABANDONED` to `OnboardingPhase` + polling terminal branch

**Files:**
- Modify: `apps/web/src/lib/services/onboarding-polling.ts` — type union + `derivePollingResponse` terminal branch.
- Modify: `apps/web/src/app/api/onboarding/[schemaId]/route.ts` — POST handler returns 410 for ABANDONED; DELETE handler treats ABANDONED like ARCHIVED.

**Why:** After Save, the old schema gets flipped to ABANDONED. Any in-flight browser tab still polling the old schemaId would otherwise poll forever (the observer's timeout is 20m). Returning a typed terminal phase lets the client navigate away gracefully.

- [ ] **Step 1: Write the failing test — polling an ABANDONED schema returns terminal phase**

Add to `apps/web/src/lib/services/__tests__/onboarding-polling.test.ts` (create the file if it doesn't exist — match shape of the nearest existing polling test). Minimal test:

```ts
import { describe, expect, it } from "vitest";
import { derivePollingResponse } from "../onboarding-polling";

describe("derivePollingResponse ABANDONED branch", () => {
  it("returns phase=ABANDONED when schema.status is ABANDONED", async () => {
    const schema = {
      id: "01OLD0000000000000000000000",
      status: "ABANDONED",
      phase: "DISCOVERING_DOMAINS",
      phaseUpdatedAt: new Date(),
      phaseError: null,
      phaseCredentialFailure: null,
    } as any;
    const response = await derivePollingResponse(schema, null);
    expect(response.phase).toBe("ABANDONED");
    expect(response.schemaId).toBe("01OLD0000000000000000000000");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm --filter web test src/lib/services/__tests__/onboarding-polling.test.ts
```

Expected: FAIL. Either the file didn't exist (create it above), or `phase === "ABANDONED"` isn't yet a returnable value.

- [ ] **Step 3: Add `ABANDONED` to the `OnboardingPhase` type union**

In `apps/web/src/lib/services/onboarding-polling.ts`, change the union at lines 16–32. Add `| "ABANDONED"` as a new entry after `"FAILED"`:

```ts
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
  | "FAILED"
  | "ABANDONED"; // #130: user clicked Back → edit, replaced this row
```

- [ ] **Step 4: Add the ABANDONED terminal branch in derivePollingResponse**

In the same file, at the top of `derivePollingResponse` (right after the `base` object is constructed around line 165), add the new branch BEFORE the existing `schema.status === "ACTIVE"` check:

```ts
  // #130 Terminal: schema was replaced by a new schema on edit. Tells the
  // observer page to stop polling; client-side effect can navigate the user
  // to whichever new schema is relevant (polling API is generic — the
  // replacement schemaId is not carried here; the client already has it
  // in the URL bar from the router.push after Save).
  if (schema.status === "ABANDONED") {
    return { ...base, phase: "ABANDONED" };
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
pnpm --filter web test src/lib/services/__tests__/onboarding-polling.test.ts
```

Expected: PASS.

- [ ] **Step 6: Update POST /api/onboarding/[schemaId] to handle ABANDONED**

In `apps/web/src/app/api/onboarding/[schemaId]/route.ts`, the POST handler currently routes new-flow phases to "already-confirmed" (lines 83–99) and old-flow phases to 410 Gone (lines 101–111). Add an ABANDONED-first branch BEFORE the new-flow check (insert between line 79 and line 83):

```ts
    // #130 — schema was replaced by Back → edit. Return 410 with a typed
    // reason so the observer knows the row is terminal and the user has
    // moved on. Differs from the #95-era 410 below in the `type` field so
    // clients can distinguish.
    if (schema.phase === null && schema.status === "ABANDONED") {
      // Note: assertResourceOwnership has already fired above using a
      // selection that includes `phase`. Extend the select.
      // (The select at line 75-78 must be updated — see Step 7.)
    }
```

Actually — the simpler approach: extend the select to include `status`, then add the branch. Rewrite lines 75–110 as:

```ts
    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true, phase: true, status: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // #130 — schema replaced by Back → edit restart. Caller has moved to
    // a new schemaId; tell them in a typed way.
    if (schema.status === "ABANDONED") {
      logger.info({
        service: "onboarding",
        operation: "deprecated-confirm.abandoned",
        userId,
        schemaId,
      });
      return NextResponse.json(
        {
          error: "This schema was replaced by a fresh edit. Poll the new schemaId instead.",
          code: 410,
          type: "SCHEMA_ABANDONED",
        },
        { status: 410 },
      );
    }

    // New-flow phases OR downstream terminal states — stale client retry
    // lands here; treat as already-confirmed so the UI stops submitting.
    if (
      schema.phase === "AWAITING_DOMAIN_CONFIRMATION" ||
      schema.phase === "DISCOVERING_ENTITIES" ||
      schema.phase === "AWAITING_ENTITY_CONFIRMATION" ||
      schema.phase === "PROCESSING_SCAN" ||
      schema.phase === "COMPLETED" ||
      schema.phase === "NO_EMAILS_FOUND"
    ) {
      logger.info({
        service: "onboarding",
        operation: "deprecated-confirm.idempotent",
        userId,
        schemaId,
        phase: schema.phase,
      });
      return NextResponse.json({ data: { schemaId, status: "already-confirmed" } });
    }

    // Remaining phases — the caller is trying to drive the old flow that no
    // longer exists. 410 Gone is the honest answer; point them at the new
    // route.
    return NextResponse.json(
      {
        error: "This endpoint was removed by issue #95. Use /api/onboarding/:schemaId/entity-confirm.",
        code: 410,
        type: "GONE",
      },
      { status: 410 },
    );
```

- [ ] **Step 7: Update DELETE handler to treat ABANDONED like ARCHIVED**

In the same file, change the DELETE's idempotency check (currently at line 134) from:

```ts
if (schema.status === "ARCHIVED") {
```

To:

```ts
if (schema.status === "ARCHIVED" || schema.status === "ABANDONED") {
```

- [ ] **Step 8: Run full web test suite**

Run:
```bash
pnpm --filter web test
```

Expected: all tests pass including the new ABANDONED-polling test.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/services/onboarding-polling.ts apps/web/src/lib/services/__tests__/onboarding-polling.test.ts apps/web/src/app/api/onboarding/[schemaId]/route.ts
git commit -m "feat(onboarding): #130 ABANDONED terminal phase + 410 on polling"
```

---

## Task 6: Exclude ABANDONED from schema-list queries

**Files:**
- Modify: `apps/web/src/app/(authenticated)/settings/topics/page.tsx:14`
- Modify: `apps/web/src/app/page.tsx:62`
- Modify: `apps/web/src/app/auth/callback/route.ts:176`

**Scope check:** The landing-redirect logic uses `schemaCount > 0 ? "/feed" : "/onboarding/category"`. If a user has ONLY abandoned schemas, they should land on `/onboarding/category` (fresh start), not `/feed`. Same for the auth callback.

Feed route at `apps/web/src/app/api/feed/route.ts:13` already filters to `status: { in: ["ACTIVE", "ONBOARDING"] }`, so ABANDONED is implicitly excluded — no change needed there.

- [ ] **Step 1: Update settings/topics**

Change `apps/web/src/app/(authenticated)/settings/topics/page.tsx` line 14–25 from:

```tsx
  const schemas = await prisma.caseSchema.findMany({
    where: { userId: user.id },
    select: {
```

To:

```tsx
  const schemas = await prisma.caseSchema.findMany({
    where: { userId: user.id, status: { not: "ABANDONED" } },
    select: {
```

- [ ] **Step 2: Update landing redirect count**

Change `apps/web/src/app/page.tsx` line 62–64 from:

```tsx
      const schemaCount = await prisma.caseSchema.count({
        where: { userId: user.id },
      });
```

To:

```tsx
      const schemaCount = await prisma.caseSchema.count({
        where: { userId: user.id, status: { not: "ABANDONED" } },
      });
```

- [ ] **Step 3: Update auth callback count**

Change `apps/web/src/app/auth/callback/route.ts` line 176 from:

```ts
      const schemaCount = await prisma.caseSchema.count({ where: { userId: user.id } });
```

To:

```ts
      const schemaCount = await prisma.caseSchema.count({
        where: { userId: user.id, status: { not: "ABANDONED" } },
      });
```

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/settings/topics/page.tsx apps/web/src/app/page.tsx apps/web/src/app/auth/callback/route.ts
git commit -m "fix(queries): #130 exclude ABANDONED schemas from list/count queries"
```

---

## Task 7: Delete the `/inputs` route and `rewindSchemaInputs`

**Files:**
- Delete: `apps/web/src/app/api/onboarding/[schemaId]/inputs/route.ts`
- Delete: `apps/web/src/app/api/onboarding/[schemaId]/inputs/__tests__/route.test.ts`
- Delete: the empty directory `apps/web/src/app/api/onboarding/[schemaId]/inputs/` (and its `__tests__/` subdir)
- Modify: `apps/web/src/lib/services/interview.ts` — remove the `rewindSchemaInputs` export at lines ~1064–1111 (confirm exact range by reading the file first; the docblock starts around line 1064 and the function ends at line 1111).

- [ ] **Step 1: Confirm no external callers of `rewindSchemaInputs`**

Run:
```bash
grep -rn "rewindSchemaInputs" apps/web/src/
```

Expected after Task 4 landed: only the definition in `apps/web/src/lib/services/interview.ts` and the import in `apps/web/src/app/api/onboarding/[schemaId]/inputs/route.ts`. If anything else references it, halt — that caller must be updated first or this plan is incomplete.

- [ ] **Step 2: Delete the /inputs route files**

```bash
rm apps/web/src/app/api/onboarding/[schemaId]/inputs/route.ts
rm apps/web/src/app/api/onboarding/[schemaId]/inputs/__tests__/route.test.ts
rmdir apps/web/src/app/api/onboarding/[schemaId]/inputs/__tests__
rmdir apps/web/src/app/api/onboarding/[schemaId]/inputs
```

(On bash-for-Windows, `rmdir` only succeeds if the dir is empty. If it fails, verify no stray files remain with `ls -la` before re-trying.)

- [ ] **Step 3: Remove `rewindSchemaInputs` from interview.ts**

In `apps/web/src/lib/services/interview.ts`, delete the entire `rewindSchemaInputs` function — docblock + signature + body. The docblock starts around line ~1064 (re-read the file to confirm exact lines, which may have shifted). Remove from the `/**` line through the closing `}` of the function, inclusive.

- [ ] **Step 4: Nuke `.next/dev` cache so Turbopack forgets the deleted route**

Required because Turbopack's dev cache remembers compiled routes. A lingering compiled artifact can serve a 500 for a deleted file. See `feedback_turbopack_new_route_miss.md` memory.

```bash
# user must stop dev server first
rm -rf apps/web/.next
```

User restarts `pnpm --filter web dev` after this task completes.

- [ ] **Step 5: Typecheck**

Run:
```bash
pnpm typecheck
```

Expected: clean. Any dangling import of `rewindSchemaInputs` would have been caught in Step 1, but typecheck confirms.

- [ ] **Step 6: Run full web test suite**

Run:
```bash
pnpm --filter web test
```

Expected: the /inputs route test file is gone (already deleted), so test count drops by 4 (the four cases that lived there). All other tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/app/api/onboarding/\[schemaId\]/inputs apps/web/src/lib/services/interview.ts
git commit -m "refactor(onboarding): #130 delete /inputs PATCH + rewindSchemaInputs"
```

The `-A` is needed to stage the deletions. Verify with `git status` before committing that only `deleted: ` entries appear for the inputs route — no unexpected files.

---

## Task 8: Append lessons-learned entry

**Files:**
- Modify: `docs/01_denim_lessons_learned.md` — append a new dated section AND a new entry in the "Patterns to watch for" list.

- [ ] **Step 1: Read the current lessons-learned tail**

Read `docs/01_denim_lessons_learned.md`. Find the final section before "Patterns to watch for" (the current last entry is the 2026-04-19 evening compound). Append after it.

- [ ] **Step 2: Append the new entry**

Add the following section after the 2026-04-19 entries and before the "Patterns to watch for" header:

```markdown
## 2026-04-21: Third CAS-second-writer bug — rewind primitive was wrong

**Context:** Issue #127 (2026-04-20) added `PATCH /api/onboarding/:schemaId/inputs` so a user could Back-button from the Stage 1 review screen, fix a WHAT typo, and Save without a full wipe + OAuth round-trip. The PATCH called `rewindSchemaInputs` which set `CaseSchema.phase = "DISCOVERING_DOMAINS"` directly (not through `advanceSchemaPhase`) and re-emitted `onboarding.domain-discovery.requested`. It worked exactly once — then broke.

### Bug: `runDomainDiscovery` silently skips after a rewind

**Symptom:** During live E2E on 2026-04-21, the user started schema `01KPR8Z0…`, walked to Stage 1 review, clicked Back → edit → Save. Inngest logs showed the first `runDomainDiscovery` run completed in 9 seconds (correct). The second run, triggered by the PATCH's re-emit, finished in 0.5 seconds with an empty output and no DB writes. The observer page polled `DISCOVERING_DOMAINS` for 15+ minutes with no error anywhere.

**Root cause:** `runDomainDiscovery` (`apps/web/src/lib/inngest/domain-discovery-fn.ts:54`) guards on `advanceSchemaPhase({ from: "PENDING", to: "DISCOVERING_DOMAINS" })`. After `rewindSchemaInputs` set phase to `DISCOVERING_DOMAINS` directly, the CAS `from` guard rejected (`from=PENDING` no longer matched `phase=DISCOVERING_DOMAINS`), `advanceSchemaPhase` returned `"skipped"`, and the function returned `{ skipped: true }` without running any Gmail work.

**Rule re-affirmed (third data point, after Bug 3 2026-04-09 and the near-miss idempotency patterns #6/#11):** **Each `from → to` CAS transition must have exactly one writer, and it must be the CAS helper — not a direct `updateMany` that sets `phase`.** `rewindSchemaInputs` was a second writer for `→ DISCOVERING_DOMAINS`. Patching the CAS `from` to accept both `PENDING` and `DISCOVERING_DOMAINS` would have masked the issue for this pair while leaving the class of bug wide open for the next rewind.

**Fix (shipped as issue #130):** Remove the rewind primitive. The Back-edit button now routes to `/onboarding/names?from=<oldSchemaId>`. Saving POSTs `/api/onboarding/start` with a fresh schemaId AND `abandonSchemaId: <oldSchemaId>`. The start route's existing `$transaction` gains one `updateMany` that flips the old row from `DRAFT` → `ABANDONED`. New enum value; zero migration risk. All list/count queries exclude ABANDONED.

**Why this is structural, not a patch:** After #130, schema phases only move forward. There is no rewind primitive; there is no second-writer path. Every CAS `from → to` pair retains a single writer. New features that would otherwise "roll back" a schema must instead create a new schema — the `abandonSchemaId` pattern is the template.

**Meta:** This was caught by running the live E2E (mid-test, the Stage 1 reload hung). A unit test couldn't have caught it because the unit-tested `rewindSchemaInputs` does exactly what it claims (flips phase + nulls stage1). The interaction bug is only visible once Inngest dispatches the downstream function and the CAS owner silently skips. Integration coverage via the live-E2E shakedown remains the only defense for this class until we add a cross-function CAS-ownership test harness.
```

- [ ] **Step 3: Add entry to the "Patterns to watch for" list**

Inside `docs/01_denim_lessons_learned.md`, in the "Patterns to watch for" section, append a new subsection. Find the existing "### 11. "Persisted record duplicates a column already on the row"" entry and add the following directly AFTER it:

```markdown
### 12. "Direct `updateMany` on a CAS-owned column"

If a route or service sets `phase`, `status`, or any column whose transitions are guarded by a CAS helper (`advanceSchemaPhase`, `advanceScanPhase`) via a plain `updateMany`/`update`, it is a second writer by definition — even if it's "only a reset." The downstream CAS owner will silently skip when its `from` guard no longer matches. All three instances of this class (Bug 3 2026-04-09, Bug 7/Discovery 10 2026-04-19 shape cousin, and #130 2026-04-21) shipped past tests and were caught in live E2E.

**Check:** For every column that has a CAS helper, grep for direct writes:
```
grep -rn "updateMany.*phase:\|update.*phase:" apps/web/src/
```
Every hit should be inside the CAS helper OR have a comment explaining why the caller is bypassing it (e.g. DELETE route explicitly nulls phase on cancellation). **"Rewind" is never a valid reason — create a new row instead.**
```

- [ ] **Step 4: Commit**

```bash
git add docs/01_denim_lessons_learned.md
git commit -m "docs(lessons): #130 third CAS-second-writer bug + preventive rule"
```

---

## Task 9: Final verification

**Files:** none modified.

- [ ] **Step 1: Typecheck all workspaces**

Run:
```bash
pnpm typecheck
```

Expected: clean across `web`, `types`, `engine`, `ai`.

- [ ] **Step 2: Run all unit tests**

Run:
```bash
pnpm -r test
```

Expected: all tests pass. Web test count is approximately (previous count − 4 inputs tests + new start route tests + new polling test). Paste the per-workspace counts in the commit message for #130 wrap-up.

- [ ] **Step 3: Biome check**

Run:
```bash
pnpm biome check
```

Expected: clean on all files touched by this plan.

- [ ] **Step 4: Live E2E smoke test**

User drives through:
1. Start fresh — new schema via `/onboarding/category` → `/names` → `/connect` → Stage 1 review.
2. On the Stage 1 review page, click **Back — edit topics & contacts**.
3. Edit a WHAT (add one, remove one, or fix a typo).
4. Click **Save changes & re-run discovery**.
5. Expect: browser redirects to `/onboarding/<newSchemaId>`. Polling shows DISCOVERING_DOMAINS → AWAITING_DOMAIN_CONFIRMATION within ~30 seconds. Stage 1 review renders with the updated inputs.
6. Verify the old schema row in DB: `status = "ABANDONED"`, inputs preserved (forensic trail).
7. Verify the settings → topics page: old abandoned schema does NOT appear in the list; new schema does (under the current phase).

- [ ] **Step 5: No commit**

No code changes. If any verification step fails, file a follow-up issue with a concrete repro and stop.

---

## Self-review checklist

- [x] **Spec coverage** — every bullet from the original context (root cause, replacement primitive, files to delete, files to modify, lessons entry, constraints/invariants) maps to at least one task above. Cron cleanup is out of scope as stated in the context.
- [x] **No placeholders** — every step has exact code / commands / file:line references. No "TBD", "similar to", or "handle appropriately".
- [x] **Type consistency** — `abandonSchemaId` used consistently (route body, createSchemaStub extension, names page handler). `fromSchemaId` used consistently in names/page.tsx. `SchemaStatus.ABANDONED` consistent with Prisma enum. `OnboardingPhase.ABANDONED` added to the union used by polling.
- [x] **Deletion safety** — Task 7's Step 1 explicitly verifies no external callers remain before deleting.
- [x] **Cache poisoning** — Task 7's Step 4 requires a `.next/dev` nuke + dev server restart after deletion, matching the memory entry about Turbopack's stale-route trap.
- [x] **FK/referential safety** — no orphan risk. ABANDONED rows keep all their FK children (stage1 JSON, outbox rows, any accidental scan jobs); they just become invisible to list queries. Cron picks only ACTIVE so no scans fire on abandoned rows.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-new-schema-on-edit.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
