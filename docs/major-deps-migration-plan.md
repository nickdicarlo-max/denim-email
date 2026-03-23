# Major Dependency Migration Plan

**Branch:** `upgrade/major-deps-2026`
**Created:** 2026-03-22
**Last updated:** 2026-03-23

### Progress

| Phase | Package | Status | Commit | Notes |
|-------|---------|--------|--------|-------|
| 0 | @anthropic-ai/sdk, @supabase/supabase-js | **Done** | `549db9e` | Safe patches: 0.78→0.80, 2.49→2.99.3 |
| 1 | Vitest 3→4 | **Done** | `2290d5a` | No API changes needed, 115 tests pass |
| 2 | Biome 1→2 | **Done** | `781cc61` | Updated schema URL, no new violations |
| 3 | Prisma 6→7 | **Done** | `79ab3b2` | New prisma.config.ts, @prisma/adapter-pg, generated client output path |
| 4 | Zod 3→4 | **Done** | `12e4118` | Fixed z.record() single-arg → two-arg |
| 5 | React 18→19 + Next.js 14→16 | **Done** | — | Async cookies/params, fixed 3 broken API routes (URL extraction), next.config.ts |
| 6 | Tailwind 3→4 | **Done** | — | @tailwindcss/postcss, @import+@config pattern, shadow-sm→shadow-xs, outline-none→outline-hidden |
| 7 | Inngest 3→4 | **Done** | — | createFunction 3-arg→2-arg (triggers), removed schemas, fixed missing function exports |

Type errors reduced from 174 (pre-migration) to 0. The 8 pre-existing withAuth signature issues were fixed in Phase 5 (routes converted to URL extraction).

---

## Overview

| Phase | Package | Current | Target | Risk | Files |
|-------|---------|---------|--------|------|-------|
| 1 | Vitest | 3.2 | 4.x | Low | 5 configs, 15+ test files |
| 2 | Biome | 1.9 | 2.x | Low | 1 config |
| 3 | Prisma | 6.19 | 7.x | Medium | schema, singleton, ~10 services |
| 4 | Zod | 3.25 | 4.x | Medium | 14 files (parsers + validation) |
| 5 | React + Next.js | 18.3 + 14.2 | 19.x + 16.x | High | 10+ files, async APIs |
| 6 | Tailwind CSS | 3.4 | 4.x | Medium-high | 3 configs + design tokens |
| 7 | Inngest | 3.52 | 4.x | Medium | 7 files (pipeline) |

Each phase gets its own commit for bisectability.

---

## Phase 1: Vitest 3→4

**Why first:** Independent of all other upgrades. Lowest risk.

**Config files:**
- `apps/web/vitest.config.ts`
- `apps/web/vitest.integration.config.ts`
- `packages/engine/vitest.config.ts`
- `packages/ai/vitest.config.ts`
- `packages/types/vitest.config.ts`

**Steps:**
1. `pnpm update vitest@latest -r`
2. Check for breaking config changes
3. Run `pnpm -r test` — all unit tests must pass
4. Commit

**Notes:** Current tests use standard APIs (describe/it/expect), no deprecated v3 APIs found.

---

## Phase 2: Biome 1→2

**Why second:** Tooling only, no runtime impact.

**Files:**
- `biome.json` (schema URL `1.9.4` → `2.x`, possible config key renames)

**Steps:**
1. `pnpm update @biomejs/biome@latest`
2. Update `biome.json` schema URL
3. `pnpm biome check .` — note new violations
4. `pnpm biome check . --apply` — auto-fix
5. Review formatting diff
6. Commit

**Notes:** May produce large formatting diff if Biome 2 changes defaults.

---

## Phase 3: Prisma 6→7

**Why third:** Database layer, independent of React/Next.js.

**Files:**
- `apps/web/prisma/schema.prisma` (18 models, generator config)
- `apps/web/src/lib/prisma.ts` (singleton)
- All services in `apps/web/src/lib/services/` (~10 files)

**Steps:**
1. `pnpm update prisma@latest @prisma/client@latest --filter web`
2. Check generator/datasource config changes
3. `pnpm --filter web prisma generate`
4. `npx tsc --noEmit -p apps/web/tsconfig.json` — fix type errors
5. Run unit tests
6. Commit

---

## Phase 4: Zod 3→4

**Why fourth:** Touches AI parsers and validation. Must be done before React/Next.js since API routes use Zod.

**Files (14):**
- `packages/ai/src/parsers/` — 7 parser files
- `apps/web/src/lib/validation/` — 4 validation files
- `apps/web/src/lib/services/gmail-tokens.ts`
- `apps/web/src/app/api/actions/[id]/route.ts`
- `apps/web/src/app/api/extraction/trigger/route.ts`

**APIs in use:** `z.object`, `z.array`, `z.string`, `z.enum`, `z.record`, `.safeParse()`, `.parse()`, `z.infer<>`, `.transform()`, `.pipe()`, `.nullable()`, `.optional()`

**Steps:**
1. Read Zod v4 migration guide
2. `pnpm update zod@latest -r`
3. Fix type errors and API changes
4. Run `pnpm -r test` — parser tests are the canary
5. Commit

**Watch out for:** `.transform().pipe()` pattern in `cases.ts`, `.safeParse()` return shape changes.

---

## Phase 5: React 18→19 + Next.js 14→16 ✅

**Why together:** Next.js 16 requires React 19.
**Result:** React 19.2.4, Next.js 16.2.1. Zero type errors, 115/115 tests pass, build clean.

### What changed (12 files):

1. **Package bumps** — react, react-dom, next, @types/react, @types/react-dom
2. **Async `cookies()`** — `createServerSupabaseClient()` made async in `lib/supabase/server.ts`, 5 callers updated to `await`
3. **Async `params`** — 3 Server Components updated: `params: Promise<{...}>` + `const { schemaId } = await params`
   - `dashboard/[schemaId]/page.tsx`
   - `dashboard/[schemaId]/cases/page.tsx`
   - `dashboard/[schemaId]/cases/[caseId]/page.tsx`
4. **Fixed 3 broken API routes** — `withAuth` wrapper never forwarded the second `context` arg from Next.js, so routes declaring `{ params }` as a second arg always got `undefined`. Converted to URL extraction (same pattern used by 4 other working routes):
   - `api/actions/[id]/route.ts` — `params.id` → `new URL(request.url).pathname.split("/").pop()`
   - `api/quality/[schemaId]/route.ts` — same pattern
   - `api/quality/[schemaId]/history/route.ts` — `segments[segments.length - 2]`
5. **Config** — `next.config.js` → `next.config.ts` with typed `NextConfig` export

### What didn't need changes:
- `middleware.ts` — uses `request.cookies` directly, not `cookies()` from next/headers. Kept as `middleware.ts` (still supported in Next.js 16).
- 25 client components — `"use client"` unaffected
- `forwardRef` in `input.tsx` — deprecated but functional, deferred
- `withAuth` wrapper signature — unchanged (single-arg handler stays)
- All `packages/*` — zero React/Next.js imports

---

## Phase 6: Tailwind 3→4 ✅

**Result:** Tailwind 4.2.2 + @tailwindcss/postcss. Build clean, 115/115 tests pass.

### What changed (8 files):

1. **Packages** — installed `@tailwindcss/postcss` 4.2.2, updated `tailwindcss` 4.2.2, removed `autoprefixer` (built into v4)
2. **`postcss.config.js`** — plugin changed from `tailwindcss` + `autoprefixer` to `@tailwindcss/postcss`
3. **`globals.css`** — `@tailwind base/components/utilities` → `@import "tailwindcss"` + `@config "../../tailwind.config.ts"`
4. **`tailwind.config.ts`** — removed unused `/pages/` content path. Kept JS config with `tailwindExtend` spread (design tokens live in TypeScript for reuse)
5. **Class renames** (v4 shifted shadow/outline scale):
   - `shadow-sm` → `shadow-xs` (4 occurrences in `scan-progress.tsx`, `[schemaId]/page.tsx`)
   - `outline-none` → `outline-hidden` (3 occurrences in `input.tsx`, `card4-review.tsx`)

### Design decisions:
- Kept JS/TS config file with `@config` directive rather than migrating to CSS `@theme` — tokens are shared TypeScript exports
- `design-tokens.ts` unchanged — `tailwindExtend` still spreads into config
- `middleware.ts` unaffected (no Tailwind involvement)

---

## Phase 7: Inngest 3→4 ✅

**Result:** Inngest 4.0.4. Build clean, 115/115 tests pass.

### What changed (2 files + 1 config fix):

1. **`client.ts`** — removed `schemas: new Map() as never` (EventSchemas removed in v4)
2. **`functions.ts`** — converted all 9 `createFunction` calls from 3-arg to 2-arg (trigger merged into config as `triggers: [{ event: "..." }]`). Fixed pre-existing bug: `resynthesizeOnFeedback` and `dailyQualitySnapshot` were defined but missing from the exported `functions` array.
3. **`biome.json`** — fixed Biome 2 config: `organizeImports` → `assist`, `files.ignore` → `files.includes` with negation (pre-existing issue from Phase 2)

### What didn't change:
- `serve({ client, functions })` pattern — unchanged in v4
- `inngest.send({ name, data })` pattern — unchanged in v4
- `step.run()` / `step.sendEvent()` — unchanged in v4
- Event type definitions (`DenimEvents`) — plain Record type still works
- Integration test — `inngest.send()` call unchanged

---

## Final Verification

After all phases:
1. `npx tsc --noEmit -p apps/web/tsconfig.json` — zero type errors
2. `pnpm -r test` — all unit tests pass
3. `pnpm --filter web dev` — app starts and renders
4. `pnpm biome check .` — no lint violations
5. Manual smoke test: interview flow, case feed, dashboard
6. `npx inngest-cli@latest dev` — pipeline functions register
7. Merge to main or create PR for review
