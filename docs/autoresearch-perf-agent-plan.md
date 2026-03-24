# Plan: Case Rendering Performance + Autonomous Optimization Agent

## Context

The case feed and case detail pages are slow. Every page load blocks on 3-4 sequential database queries with zero streaming — nothing renders until ALL data is ready. The user wants super-fast performance and an autoresearch-style autonomous agent that can systematically experiment with optimizations.

**Two-phase approach:**
1. **Phase A** — Direct performance fixes (immediate, high-impact)
2. **Phase B** — Autonomous optimization agent (autoresearch pattern)

---

## Phase A: Direct Performance Fixes

These are mechanical transformations with predictable impact. Do them first.

### A1. Parallel data fetching on case feed page

**File:** `apps/web/src/app/dashboard/[schemaId]/cases/page.tsx`

Currently: 3 sequential awaits after auth (schema → cases → statusCounts).
The schema and statusCounts queries are independent of the cases query.

**Change:** Run all three with `Promise.all`:
```ts
const [schema, cases, statusCounts] = await Promise.all([
  prisma.caseSchema.findUnique({ ... }),
  prisma.case.findMany({ ... }),
  prisma.case.groupBy({ ... }),
]);
```

Auth must still run first (need userId for ownership check), but the three data queries can be parallel.

**Expected impact:** TTFB reduced ~30-40% (3 round trips → 1 parallel batch).

### A2. Parallel data fetching on case detail page

**File:** `apps/web/src/app/dashboard/[schemaId]/cases/[caseId]/page.tsx`

Currently: case query → viewedAt update → cluster records (all sequential).
The viewedAt update and cluster records are independent of each other, and the viewedAt update doesn't need to block rendering at all.

**Change:**
- Fetch case + cluster records in parallel via `Promise.all`
- Move `viewedAt` update to fire-and-forget (don't await it — use `after()` from `next/server` or just don't await)

**Expected impact:** TTFB reduced ~20-30%.

### A3. Add `loading.tsx` skeleton files

**New files:**
- `apps/web/src/app/dashboard/[schemaId]/cases/loading.tsx`
- `apps/web/src/app/dashboard/[schemaId]/cases/[caseId]/loading.tsx`
- `apps/web/src/app/dashboard/[schemaId]/loading.tsx`

These enable Next.js streaming — the layout shell (header, nav, back link) renders instantly while data loads. The loading skeleton shows immediately.

**Content:** Minimal skeleton UI matching the page structure (pulsing placeholder cards for feed, placeholder blocks for detail).

**Expected impact:** FCP drops to near-zero (shell streams immediately). Perceived performance dramatically better.

### A4. Suspense boundaries for case detail sections

**File:** `apps/web/src/app/dashboard/[schemaId]/cases/[caseId]/page.tsx`

Split into independently-streaming sections:
- Case header (title, entity, status) — fast, renders first
- Actions list — medium priority
- Email list — can stream in after
- Cluster debug records — lowest priority, stream last

Extract each section into an async Server Component wrapped in `<Suspense>`.

**Expected impact:** LCP improves because the case header appears before emails/actions finish loading.

### A5. Move viewedAt write out of render path

**File:** `apps/web/src/app/dashboard/[schemaId]/cases/[caseId]/page.tsx` (line 70-73)

The `prisma.case.update({ viewedAt })` blocks the response. Use Next.js `after()` to defer it:

```ts
import { after } from 'next/server';
// ... in the component:
after(async () => {
  await prisma.case.update({ where: { id: caseId }, data: { viewedAt: new Date() } });
});
```

**Expected impact:** Removes one blocking query from the render path.

### A6. Eliminate redundant sort logic

**Files:**
- `apps/web/src/app/dashboard/[schemaId]/cases/page.tsx` (lines 104-150)
- `apps/web/src/app/api/cases/route.ts` (duplicate sort function)

The sort logic runs in JS after fetching. This is 50 lines of code running on every page load. Move the primary sort to the Prisma query using `orderBy` with a raw SQL expression for urgency tier mapping, or at minimum extract to a shared utility so it's not duplicated.

**Expected impact:** Small TTFB improvement + code dedup.

---

## Phase B: Autonomous Optimization Agent

Modeled on [karpathy/autoresearch](https://github.com/karpathy/autoresearch). An AI agent autonomously experiments with rendering optimizations, measures impact, and keeps what works.

### Architecture

```
perf/
  benchmark.ts          # FIXED — Playwright performance measurement harness
  playbook.md           # FIXED — Ordered optimization patterns + constraints
  run-agent.sh          # FIXED — Outer loop invoking Claude Code per iteration
  results.jsonl         # APPEND-ONLY — One JSON line per iteration
  seed-data.ts          # FIXED — Prisma seed for deterministic test data
  snapshots/            # Git patches for rollback
```

### B1. Performance benchmark harness (`perf/benchmark.ts`)

The `prepare.py` equivalent. Uses Playwright (already a project dependency) to measure:

| Metric | Method |
|--------|--------|
| TTFB | `PerformanceObserver` responseStart |
| FCP | `PerformanceObserver` first-contentful-paint |
| LCP | `PerformanceObserver` largest-contentful-paint |
| CLS | `PerformanceObserver` layout-shift |
| JS bundle size | `performance.getEntriesByType('resource')` |

**Target pages:** Case feed, case detail, schema detail.
**Methodology:** 5 runs per page, discard first (cold start), report median.
**Auth:** Use BYPASS_AUTH=true (already supported in dev) or Supabase test session.

### B2. Deterministic seed data (`perf/seed-data.ts`)

Creates consistent test data so metrics are comparable across iterations:
- 1 test user
- 1 CaseSchema with realistic config
- 50 cases with mixed statuses/urgency tiers
- 200 emails distributed across cases
- 30 actions with varying types/dates

Uses Prisma (type-safe, matches schema). Idempotent via delete-then-create.

### B3. Optimization playbook (`perf/playbook.md`)

Human-written guidance for the agent. Ordered from least to most invasive:

1. Parallel data fetching (Promise.all for independent queries)
2. loading.tsx skeleton files (instant shell rendering)
3. Suspense boundaries (independent streaming sections)
4. Selective field queries (replace `include` with `select`)
5. Database-level sorting (move JS sort to Prisma orderBy)
6. `'use cache'` for stable data (schema config, entities, tags)
7. Server/client component boundary optimization
8. Deduplicate sort logic between page and API route

**Constraints (encoded in playbook):**
- Never modify `packages/` (pure logic, zero I/O)
- Never modify `prisma/schema.prisma`
- Never remove functionality
- Never add npm dependencies without approval
- Must pass `pnpm --filter web build` + typecheck

### B4. Agent loop (`perf/run-agent.sh`)

```
for iteration in 1..MAX_ITERATIONS:
  1. SNAPSHOT — git stash
  2. BASELINE — run benchmark.ts, record "before" metrics
  3. AGENT — invoke Claude Code with prompt:
     "Read playbook.md and results.jsonl. Pick ONE untried optimization.
      Apply it to the target files. Make one change only."
  4. VALIDATE — typecheck + build + tests
     If fail → rollback, log "FAILED", continue
  5. MEASURE — run benchmark.ts, record "after" metrics
  6. EVALUATE —
     If LCP improved >5% AND no metric regressed >10%:
       ACCEPT → git commit with iteration metadata
     Else:
       REJECT → git checkout (revert)
  7. LOG — append to results.jsonl
```

**Guardrails:**
- 5-minute timeout per iteration (kill agent if stuck)
- Max 10 iterations per run
- Stop after 3 consecutive rejections
- File allowlist: only `apps/web/src/app/dashboard/**`, `apps/web/src/components/cases/**`, `apps/web/src/app/api/cases/**`, `apps/web/next.config.ts`

### B5. Results tracking

Each line in `results.jsonl`:
```json
{
  "iteration": 1,
  "optimization": "parallel-queries-case-feed",
  "status": "accepted",
  "before": { "ttfb": 420, "fcp": 520, "lcp": 890 },
  "after": { "ttfb": 280, "fcp": 350, "lcp": 620 },
  "files_modified": ["apps/web/src/app/dashboard/[schemaId]/cases/page.tsx"],
  "timestamp": "2026-03-23T..."
}
```

---

## Implementation Order

1. **A1** — Parallel queries on case feed page
2. **A2** — Parallel queries on case detail page
3. **A3** — loading.tsx skeletons (3 files)
4. **A5** — Move viewedAt to `after()`
5. **A4** — Suspense boundaries on case detail
6. **A6** — Deduplicate sort logic
7. **B1** — Benchmark harness
8. **B2** — Seed data script
9. **B3** — Optimization playbook
10. **B4** — Agent loop script
11. **B5** — Run first autonomous session, review results

## Key Files

| File | Action |
|------|--------|
| `apps/web/src/app/dashboard/[schemaId]/cases/page.tsx` | Modify — parallel queries, extract sort |
| `apps/web/src/app/dashboard/[schemaId]/cases/[caseId]/page.tsx` | Modify — parallel queries, Suspense, after() |
| `apps/web/src/app/dashboard/[schemaId]/cases/loading.tsx` | Create — skeleton |
| `apps/web/src/app/dashboard/[schemaId]/cases/[caseId]/loading.tsx` | Create — skeleton |
| `apps/web/src/app/dashboard/[schemaId]/loading.tsx` | Create — skeleton |
| `apps/web/next.config.ts` | Modify — if enabling dynamicIO for cache components |
| `perf/benchmark.ts` | Create — Playwright perf harness |
| `perf/seed-data.ts` | Create — deterministic test data |
| `perf/playbook.md` | Create — agent optimization guide |
| `perf/run-agent.sh` | Create — outer iteration loop |
| `perf/results.jsonl` | Create — empty, append-only log |

## Verification

- **Phase A:** Run dev server, navigate to case feed and detail pages. Measure with browser DevTools Network tab (TTFB) and Performance tab (FCP/LCP). Compare before/after.
- **Phase B:** Run `perf/run-agent.sh`, review `perf/results.jsonl` for accepted optimizations and metric improvements. Verify no functionality regression by running existing tests.
