# Denim Email — Current Status

Last updated: 2026-03-12

## Completed

### Phase 0: Project Scaffolding
- Monorepo structure (pnpm workspaces, apps/web, packages/types, engine, ai)
- Prisma schema at apps/web/prisma/schema.prisma (full schema, all models/enums)
- Auth middleware (withAuth), structured logger, CORS, error handler
- Typed errors (@denim/types/errors.ts)
- Inngest client + event registry (@denim/types/events.ts)
- Vitest, Playwright, Biome, GitHub Actions CI configured
- Prisma singleton, callWithRetry helper, AI client wrapper stubs
- Chrome extension placeholder
- Design system (docs/design-system.md, packages/types/design-tokens.ts)

### Post-Phase 0: Supabase Setup
- Supabase project created, credentials in apps/web/.env.local
- Tables created via prisma db push
- RLS enabled on all tables
- Google OAuth provider configured

### Phase 1: Interview Service (Tasks 1.1–1.7)
- Anthropic SDK installed in apps/web (@anthropic-ai/sdk)
- AI client wrapper wired with real Claude SDK (apps/web/src/lib/ai/client.ts)
- Hypothesis prompt builder (packages/ai/src/prompts/interview-hypothesis.ts)
  - 6 domain configs: school_parent, property, construction, legal, agency, general
  - Domain-specific clustering constants, tags, extracted fields, secondary entity types
- Hypothesis parser with Zod validation (packages/ai/src/parsers/hypothesis-parser.ts)
- 8 parser unit tests, all passing
- InterviewService.generateHypothesis (apps/web/src/lib/services/interview.ts)
- POST /api/interview/hypothesis route with withAuth
- Evaluation script (scripts/test-interview.ts): 5/5 domains pass all 10 checks
- Results at docs/test-results/phase1-schema-quality.md
- Model: claude-sonnet-4-6

## Not Yet Done in Phase 1

Phase 1 core tasks (1.1–1.7) are complete. The following are deferred per the build plan:
- InterviewService.validateHypothesis — depends on Gmail (Phase 2)
- InterviewService.finalizeSchema — depends on Gmail (Phase 2)
- Integration test (interview-service.test.ts) — needs real DB writes, build after DB connected
- CaseSchema persistence to database — happens when finalizeSchema is built

## Next Step

**Phase 2: Gmail Integration** (see docs/build-plan.md)
- Tasks 2.1–2.4: Gmail OAuth, Gmail client service, sample scan, Interview Cards 2-3 UI
- Follow the Phase 2 prompt in getting_started.md section 7

## Environment

- ANTHROPIC_API_KEY: set in apps/web/.env.local (claude-sonnet-4-6 confirmed working)
- Supabase: configured and connected
- Node 22, pnpm workspaces
