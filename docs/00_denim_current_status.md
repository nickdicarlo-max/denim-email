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
- **Supabase auth (SSR)**
  - @supabase/ssr installed for cookie-based auth in Next.js
  - Server-side: createServerSupabaseClient() (cookie-aware), createServiceClient(), createAuthenticatedClient()
  - Browser-side: createBrowserClient() via @supabase/ssr
  - Auth callback route exchanges code with cookie-aware client (PKCE flow)
- **Gmail OAuth via Supabase Auth**
  - OAuth flow requests gmail.readonly scope via Supabase signInWithOAuth
  - Token encryption/decryption with AES-256-GCM (apps/web/src/lib/gmail/tokens.ts)
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
  - Button (primary/secondary/ghost, fullWidth prop), Input, Tag, EntityChip, ProgressDots, CardShell
  - All use Tailwind classes from design tokens, mobile-first, 44px touch targets
- **Interview Cards 1-4** (apps/web/src/components/interview/)
  - Card 1: Role selection (6 domains) + name entry (whats/whos/goals)
  - Card 2: Gmail OAuth connect with privacy info
  - Card 3: Sample scan with real-time domain discovery + AI validation
  - Card 4: Hypothesis review — toggleable tags, editable entities, clustering summary, finalize
- **Interview flow page** (apps/web/src/app/interview/page.tsx)
  - State machine hook (useInterviewFlow) orchestrating Cards 1-4
  - Flow order: Card 1 (input) → Card 2 (OAuth) → hypothesis generation → Card 3 (scan) → Card 4 (review)
  - sessionStorage persistence for interview input across OAuth redirects
  - Loading overlays, error toasts, completion screen

## Bugs Found & Fixed During First Live Test (2026-03-12)

### Bug: Input tiny / Button huge on Card 1
- **Root cause:** Button component had `w-full` hardcoded; Tailwind couldn't override via className in flex layout
- **Fix:** Added `fullWidth` prop to Button (default true). Inline "Add" buttons use `fullWidth={false}`

### Bug: OAuth redirect → 404
- **Root cause:** Auth callback used bare `createClient` from @supabase/supabase-js which can't exchange PKCE codes (no cookies). Exchange failed → redirect to `/auth/error` which didn't exist → 404
- **Fix:** Installed @supabase/ssr. Auth callback now uses `createServerSupabaseClient()` with cookie access. Error fallback redirects to `/interview?auth_error=true` instead of nonexistent page.

### Bug: Interview flow order wrong (auth before OAuth)
- **Root cause:** Flow went Card 1 → hypothesis API (needs auth token) → Card 2 (OAuth). But auth doesn't exist until Card 2.
- **Fix:** Reordered to Card 1 → Card 2 (OAuth) → hypothesis API → Card 3. Added sessionStorage persistence so Card 1 input survives the OAuth redirect (full page reload).

### Bug: Runaway API loop — 12+ parallel Claude calls, hit rate limit
- **Root cause:** `onGmailConnected` callback fired multiple times due to React effect re-runs (strict mode, effect dependency changes). No guard prevented duplicate API calls.
- **Fix:** Added `generatingRef` guard (useRef boolean) to `onGmailConnected`. First call sets it true; subsequent calls return immediately. Used `inputRef` (useRef) instead of `state.input` dependency to stabilize the callback.
- **Impact:** ~12 hypothesis calls at ~2,500 output tokens each. Hit org rate limit of 8,000 output tokens/minute on claude-sonnet-4-6.

## Defensive Patterns Required Going Forward

These patterns MUST be applied to all AI-calling code and any async operation triggered by React effects:

### 1. Ref-based call guards for any function that calls an external API
```typescript
const callingRef = useRef(false);
const doExpensiveCall = useCallback(async () => {
  if (callingRef.current) return;  // Prevent duplicate
  callingRef.current = true;
  try { ... } catch { callingRef.current = false; }
}, []);
```

### 2. AbortController for in-flight API cancellation
When a component unmounts or the user navigates away, in-flight fetch calls should be aborted. This prevents wasted API spend and stale state updates.

### 3. Client-side rate limiting / debounce
Any UI action that triggers an AI call should be debounced (300ms+) or gated behind a loading state that disables the trigger.

### 4. Visible progress for expensive operations
Never show a static spinner for operations > 5 seconds. Show:
- What step is running (e.g., "Generating schema..." → "Scanning email..." → "Validating...")
- Elapsed time or progress indicator
- A cancel button for operations > 10 seconds

### 5. Cost logging per API call
Every AI call already logs to structured JSON (service, operation, model, inputTokens, outputTokens, durationMs). This is the primary tool for detecting runaway loops — if the same operation appears 3+ times with the same userId in quick succession, something is wrong.

### 6. Max-call-per-session safety net
Add a per-session counter for AI API calls. If a single page session makes > 5 calls to the same endpoint, refuse further calls and surface an error. This is a last-resort defense against loops.

## Not Yet Done

- Integration test (interview-service.test.ts) — needs real DB writes with test data
- Playwright e2e for interview flow — Phase 6 per build plan
- Extraction/synthesis prompts — Phase 3
- AbortController integration for fetch calls in hooks
- Per-session API call counter safety net

## Next Step

**Phase 3: Extraction Pipeline** (see docs/build-plan.md)
- Tasks 3.1–3.5: Extraction prompt in @denim/ai, extraction parser, ExtractionService, Inngest fan-out job
- Gemini Flash 2.5 integration for bulk email extraction + vision/OCR

## Environment

- ANTHROPIC_API_KEY: set in apps/web/.env.local (claude-sonnet-4-6 confirmed working)
- Rate limit: 8,000 output tokens/minute on claude-sonnet-4-6 (org tier)
- Supabase: configured and connected
- Node 22, pnpm workspaces
- googleapis: installed in apps/web
- @supabase/ssr: installed for cookie-based auth
