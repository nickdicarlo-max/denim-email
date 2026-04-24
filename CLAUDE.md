# CLAUDE.md

## Project: Case Engine (codename "denim-email")

A system that transforms unstructured email into organized cases using deterministic
clustering and AI extraction. Users go through a guided interview, connect Gmail,
and see their email organized into actionable cases in a Chrome side panel.

This is not a throwaway prototype. Build for maintainability, security, and scale
from the start. Gmail access means we hold sensitive data and need to earn trust.

On startup, read `ZEFRESH_DENIM/denim-master-plan.md`.

## Repository

https://github.com/nickdicarlo-max/denim-email

## Supabase Database

This project is NOT connected to the MCP Supabase plugin (it returns permission errors).
For ALL DB operations — queries, schema changes, row counts, wipes, debugging — invoke
the **`supabase-db` skill** (user-scope install). Source of truth is committed at
`.claude/skills/supabase-db.md`; one-time install into Claude Code by copying to
`~/.claude/skills/supabase-db/SKILL.md` and restarting. Never use `prisma db push`
(it hangs on this setup).

## Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript (strict mode)
- **Database:** Supabase PostgreSQL via Prisma ORM
- **Auth:** Supabase Auth with Google OAuth (gmail.readonly scope)
- **Background Jobs:** Inngest
- **AI Models:**
  - Claude API (interview hypothesis generation, case synthesis, co-pilot)
  - Gemini Flash 2.5 API (bulk email extraction, vision/OCR for attachments)
- **Chrome Extension:** Manifest V3, Side Panel API
- **Deployment:** Vercel (web app), Chrome Web Store dev channel (extension)
- **Styling:** Tailwind CSS (utility classes only, no compiler in extension)
- **Validation:** Zod (runtime input/output validation)
- **Testing:** Vitest (unit/integration), Playwright (e2e)
- **CI/CD:** GitHub Actions
- **Linting:** Biome (format + lint, replaces ESLint + Prettier)

## Project Structure

```
apps/
  web/                          # Next.js app (API routes, UI, orchestration, I/O)
    src/
      app/                      # App Router pages and API routes
        api/
        (auth)/
        admin/
      lib/
        services/               # Orchestration layer: wires packages + I/O
          interview.ts
          extraction.ts
          cluster.ts
          synthesis.ts
          feedback.ts
          calendar.ts
        gmail/                  # Gmail API client
        inngest/                # Background job definitions + outbox drain
        middleware/             # Auth, rate limiting, error handling
        validation/             # Zod schemas
      components/
      hooks/
    prisma/
      schema.prisma             # Source of truth
      migrations/
    tests/
      unit/
      integration/
      e2e/
  extension/                    # Chrome extension (Manifest V3)
    sidepanel/

packages/
  types/                        # @denim/types -- Interfaces only. Zero dependencies.
  engine/                       # @denim/engine -- Pure business logic. Zero I/O.
    clustering/                 # gravity-model, scoring, reminder-detection
    actions/                    # dedup, lifecycle
    quality/                    # accuracy
    entity/                     # matching (jaroWinkler, fuzzyMatch)
  ai/                           # @denim/ai -- Prompt templates + parsers. No API calls.
    prompts/
    parsers/

docs/                           # Design documents and specs
.github/workflows/ci.yml
```

### Package Boundary Rule

**Packages have ZERO I/O dependencies.** No Prisma, no fetch, no Gmail API, no file
system, no environment variables. They take typed data in and return typed data out.

- `@denim/types` -- interfaces only, zero runtime code
- `@denim/engine` -- pure functions, testable with plain data, no mocking required
- `@denim/ai` -- builds prompt strings and parses response JSON, never calls an API

All I/O happens in `apps/web/src/lib/services/`. Services read from the database,
call external APIs (Claude, Gemini, Gmail), pass data to packages for processing,
and write results back. This separation means engine and AI logic can later run
in a different runtime without refactoring.

---

## Architecture Principles

1. **Zero I/O in packages.** Engine and AI logic can run anywhere.
2. **Metadata-first.** Rich email metadata; rarely re-fetch from Gmail.
3. **Pure logic clustering.** Gravity model takes data in, returns decisions out.
4. **Feedback as first-class data.** Every correction teaches the system.
5. **Interview-generated configuration.** Different domains get different configs.
6. **Two-axis entity model.** Primary (boundary) + secondary (signal).
7. **Defense in depth.** RLS, Zod, encrypted tokens, scoped queries, typed errors.

## Engineering Practices (summary)

Pipeline is **event-driven via Inngest** (scan → extract → cluster → synthesize, chained
by events not direct calls). **Single-writer table ownership** — each table has exactly
one service that writes to it. **Idempotent jobs** (upsert + status guards), **append-only
FeedbackEvents**, **schema-driven config** (no domain-specific if/else in services).
Services in `@denim/engine`/`@denim/ai` must be **pure** — no env, no `Date.now()`, no
console.

**Read `docs/architecture/engineering-practices.md` before writing or modifying any
service** — it has the full table-ownership map, idempotency patterns, and naming rules.

## Scalability (summary)

Designed for concurrent users from day 1. **Inngest is the rate-limit/concurrency
backbone**: every function uses concurrency keys (per `schemaId`) and fan-out batches.
**Every query scoped by `schemaId`** (security + index performance). **Services are
stateless** — no in-memory caches, no module-level state except the Prisma singleton.
Use `callWithRetry` for AI calls until volume justifies Inngest-routed calls.

**See `docs/architecture/scalability.md`** for the bottleneck map, Inngest patterns,
DB connection management, Gmail quota strategy, and the build-now/10-users/100-users
tiering.

## Security (non-negotiables)

- OAuth tokens encrypted at rest (`TOKEN_ENCRYPTION_KEY`); never logged
- Supabase RLS on every table; every query scoped by userId via schemaId
- Email bodies and attachment bytes **NOT stored** (metadata + summary only)
- Zod validation on every API route and on every AI response
- Service role key only on the server, never in client code
- Gmail scopes: `gmail.readonly` first, `calendar.events` later. **Never `gmail.send`.**

**See `docs/security.md`** for the full threat model and data-handling rules.

## Operations (summary)

Typed errors from `@denim/types/errors.ts` (`ValidationError`, `AuthError`,
`ExternalAPIError`, etc.) — never raw strings. Structured JSON logs include
`{timestamp, level, service, schemaId, userId, operation, duration}`. AI cost tracked
in `ExtractionCost`. CI runs biome + tsc + tests + build on every PR.

**See `docs/operations.md`** for error taxonomy, logging rules, AI retry policy,
DB practices, and the full CI/CD flow.

## Testing (summary)

Three levels: **Vitest unit** (packages, no mocks), **Vitest integration** (real DB,
mocked external APIs), **Playwright e2e**. Parsers tested with fixture JSON; prompt
quality evaluated separately into `docs/test-results/` (not pass/fail).

**See `docs/testing-strategy.md`** for the full test matrix and what to test where.

## Design system + Stitch MCP

Design tokens, type system, and color palette live in `docs/design-system.md`. Stitch
MCP (Google AI design tool) is wired in for screen generation — its tool list and
design-to-code workflow are documented in the same file under the "Stitch MCP" section.

---

## Key Domain Concepts

- **CaseSchema:** User-created config for organizing one email category.
- **Entity (Primary):** The "what" axis. Case boundary.
- **Entity (Secondary):** The "who" axis. Affinity scoring signal.
- **Case:** Clustered emails with AI-generated title, summary, tags, actions.
- **CaseAction:** Extracted action item with lifecycle, dedup, calendar sync.
- **Gravity Model:** Deterministic clustering engine. Pure functions, zero I/O.
- **FeedbackEvent:** Immutable correction event. Powers the breaking-in curve.
- **OnboardingOutbox:** Transactional outbox for `onboarding.session.started` event emission (#33). Written atomically with the `CaseSchema` stub; drained by a 1-minute cron. Sole idempotency guard for `POST /api/onboarding/start`.

## Current Status

Phases 0–7 mostly complete. Major dep migration merged (2026-03-30). Pre-UX code
fixes landed (2026-03-31): case urgency sort & decay, AI prompt quality (time-neutral
summaries, mood, body/email caps, calibration bounds). Onboarding state machine
refactor complete (2026-04-08, 18 tasks, #30). Transactional outbox refactor for
`POST /api/onboarding/start` landed (2026-04-09, #33): fixes TOCTOU race + Inngest-
outage stranding with a new `OnboardingOutbox` table and `drainOnboardingOutbox` cron.

**Canonical status doc:** `docs/00_denim_current_status.md` — always read this before
asking "what's done?" or "what's next?".

**Next:** Merge `feature/ux-overhaul` to `main`, schema additions (UserNote, billing
fields), then UX Phase 4 (notes, settings, topic edit).

---

## Commands

```bash
pnpm install                           # Install dependencies
pnpm --filter web dev                  # Dev server
pnpm --filter web prisma generate     # Generate Prisma client
pnpm --filter web prisma migrate dev  # Create migration (production path)
pnpm -r build                         # Build all packages
pnpm -r test                          # Unit tests (all packages)
pnpm --filter web test:integration    # Integration tests (needs test DB)
pnpm --filter web test:e2e            # Playwright e2e (needs running server)
pnpm biome check                       # Lint and format check
pnpm biome check --apply               # Auto-fix lint/format
pnpm typecheck                         # Type check everything
npx inngest-cli@latest dev            # Inngest dev server
```

For DB operations, invoke the `supabase-db` skill. Do NOT use `prisma db push` — it
hangs on this setup. Source at `.claude/skills/supabase-db.md`; install to user scope
at `~/.claude/skills/supabase-db/SKILL.md` if not already registered.

For analyzing onboarding wall-clock timings after a manual E2E run, invoke the
`onboarding-timing` skill. Source at `.claude/skills/onboarding-timing.md`; install
to `~/.claude/skills/onboarding-timing/SKILL.md` if not already registered.
