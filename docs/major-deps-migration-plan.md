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
| 5 | React 18→19 + Next.js 14→16 | **Next** | — | Async params/cookies, middleware→proxy.ts |
| 6 | Tailwind 3→4 | Pending | — | CSS-first config, design tokens migration |
| 7 | Inngest 3→4 | Pending | — | Pipeline function registration |

Type errors reduced from 174 (pre-migration) to 8 (all pre-existing withAuth signature issues).

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

## Phase 5: React 18→19 + Next.js 14→16

**Why together:** Next.js 16 requires React 19.

### 5a: Update packages
```bash
pnpm update react@latest react-dom@latest @types/react@latest @types/react-dom@latest next@latest --filter web
```

### 5b: Async request APIs (BREAKING)

**`cookies()` → `await cookies()`:**
- `apps/web/src/lib/supabase/server.ts`

**`params` → `await params` in Server Components (3 files):**
- `apps/web/src/app/dashboard/[schemaId]/page.tsx`
- `apps/web/src/app/dashboard/[schemaId]/cases/page.tsx`
- `apps/web/src/app/dashboard/[schemaId]/cases/[caseId]/page.tsx`

**`params` → `await params` in API Routes (7 files):**
- `apps/web/src/app/api/cases/[id]/route.ts`
- `apps/web/src/app/api/actions/[id]/route.ts`
- `apps/web/src/app/api/schemas/[schemaId]/route.ts`
- `apps/web/src/app/api/schemas/[schemaId]/status/route.ts`
- `apps/web/src/app/api/schemas/[schemaId]/summary/route.ts`
- `apps/web/src/app/api/quality/[schemaId]/route.ts`
- `apps/web/src/app/api/quality/[schemaId]/history/route.ts`

### 5c: Middleware
- `apps/web/src/middleware.ts` — check if rename to `proxy.ts` is needed

### 5d: React 19 component changes (optional, old patterns still work)
- `apps/web/src/components/ui/input.tsx` — simplify `forwardRef`
- 6 files with `useRef` — verify typing

### 5e: next.config
- `apps/web/next.config.js` — check for deprecated keys, consider Turbopack

### 5f: No changes needed
- 28 "use client" components — directive unchanged
- All hooks — API unchanged
- `withAuth()` wrapper — compatible

**Steps:**
1. Update packages
2. Fix all async request APIs (cookies, params)
3. Handle middleware rename if needed
4. Fix type errors
5. `pnpm --filter web dev` — smoke test
6. Run all tests
7. Commit

---

## Phase 6: Tailwind 3→4

**Why sixth:** CSS layer, independent of React/Next.js.

**Files:**
- `apps/web/tailwind.config.ts` — custom design tokens via `tailwindExtend`
- `apps/web/postcss.config.js` — may change for v4
- `apps/web/src/app/globals.css` — `@tailwind` directives → v4 syntax
- `packages/types/design-tokens.ts` — source of `tailwindExtend` (colors, spacing, radii, shadows, fontSize)

**Custom config to preserve:**
- Design tokens: surface/card/overlay colors, accent, success/warning/error
- Entity primary/secondary colors
- Spacing: 4px base unit, semantic names (cardPadding, sectionGap)
- Border radius: xs–full scale
- Custom fontSize: 11px–20px with line heights
- Keyframes: fadeIn animation
- Font families: DM Sans

**Steps:**
1. Read Tailwind v4 migration guide
2. Update tailwindcss, adjust postcss config
3. Migrate config format (JS → CSS or v4 JS)
4. Update `globals.css` directives
5. Verify design tokens apply correctly
6. Visual smoke test — colors, spacing, typography
7. Commit

---

## Phase 7: Inngest 3→4

**Why last:** Most isolated, only affects background jobs.

**Files (7):**
- `apps/web/src/lib/inngest/client.ts` — `new Inngest({ id: "case-engine" })`
- `apps/web/src/lib/inngest/functions.ts` — 7 functions with concurrency configs
- `apps/web/src/lib/services/feedback.ts` — `inngest.send()`
- `apps/web/src/app/api/extraction/trigger/route.ts` — `inngest.send()`
- `apps/web/src/app/api/interview/finalize/route.ts` — `inngest.send()`
- `apps/web/src/app/api/inngest/route.ts` — serve handler
- `apps/web/tests/integration/flows/inngest-pipeline.test.ts`

**Current patterns:** `createFunction`, `step.run()`, `inngest.send()`, concurrency keys on `event.data.schemaId`

**Steps:**
1. Read Inngest v4 migration guide
2. `pnpm update inngest@latest --filter web`
3. Fix client init, function registration, step/send APIs
4. Type-check
5. Test with `npx inngest-cli@latest dev`
6. Commit

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
