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

### Phase 2: Gmail Integration & Interview UI
- **Design system integration**
  - Design tokens wired into Tailwind config (tailwindExtend from @denim/types/design-tokens)
  - DM Sans + JetBrains Mono fonts via Google Fonts
  - Surface background (#F7F6F3), custom font sizes, border radii, shadows
- **Supabase client utilities**
  - Server-side: createServiceClient(), createAuthenticatedClient() (apps/web/src/lib/supabase/server.ts)
  - Browser-side: createBrowserClient() (apps/web/src/lib/supabase/client.ts)
- **Gmail OAuth via Supabase Auth**
  - Auth callback route (apps/web/src/app/auth/callback/route.ts)
  - Token encryption/decryption with AES-256-GCM (apps/web/src/lib/gmail/tokens.ts)
  - OAuth flow requests gmail.readonly scope via Supabase signInWithOAuth
- **Gmail client service** (apps/web/src/lib/gmail/client.ts)
  - GmailClient class: searchEmails, getEmailFull, sampleScan
  - Header parsing, body extraction, attachment ID extraction
  - Batch metadata fetching (50 per batch)
  - googleapis package installed
- **InterviewService.validateHypothesis**
  - Validation prompt builder (packages/ai/src/prompts/interview-validate.ts)
  - Validation parser with Zod (packages/ai/src/parsers/validation-parser.ts)
  - HypothesisValidation type added to @denim/types
  - Compares hypothesis against real email samples via Claude
- **InterviewService.finalizeSchema**
  - Merges hypothesis + validation + user confirmations
  - Creates CaseSchema, Entity, SchemaTag, ExtractedFieldDef rows in Prisma transaction
  - Sets schema status to ONBOARDING
- **API routes**
  - POST /api/interview/validate (scan + validate in one call)
  - POST /api/interview/finalize (persist schema to DB)
  - POST /api/gmail/scan (standalone scan endpoint)
- **Shared UI components** (apps/web/src/components/ui/)
  - Button (primary/secondary/ghost), Input, Tag, EntityChip, ProgressDots, CardShell
  - All use Tailwind classes from design tokens, mobile-first, 44px touch targets
- **Interview Cards 1-4** (apps/web/src/components/interview/)
  - Card 1: Role selection (6 domains) + name entry (whats/whos/goals)
  - Card 2: Gmail OAuth connect with privacy info
  - Card 3: Sample scan with real-time domain discovery + AI validation
  - Card 4: Hypothesis review — toggleable tags, editable entities, clustering summary, finalize
- **Interview flow page** (apps/web/src/app/interview/page.tsx)
  - State machine hook (useInterviewFlow) orchestrating Cards 1-4
  - States: input → generating → gmail_connect → scanning → review → finalizing → complete
  - Loading overlays, error toasts, completion screen

## Not Yet Done

- Integration test (interview-service.test.ts) — needs real DB writes with test data
- Playwright e2e for interview flow — Phase 6 per build plan
- Extraction/synthesis prompts — Phase 3

## Next Step

**Phase 3: Extraction Pipeline** (see docs/build-plan.md)
- Tasks 3.1–3.5: Extraction prompt in @denim/ai, extraction parser, ExtractionService, Inngest fan-out job
- Gemini Flash 2.5 integration for bulk email extraction + vision/OCR

## Environment

- ANTHROPIC_API_KEY: set in apps/web/.env.local (claude-sonnet-4-6 confirmed working)
- Supabase: configured and connected
- Node 22, pnpm workspaces
- googleapis: installed in apps/web
