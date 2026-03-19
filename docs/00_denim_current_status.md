# Denim Email — Current Status

Last updated: 2026-03-19 (integration tests 60/60, pre-wipe checkpoint)

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

### Post-Phase 2: Defensive Patterns & Server-Side Token Storage (2026-03-13)
- **Defensive API call patterns** — AbortControllers in all fetch hooks, per-session call counter (max 5 per endpoint), finalize button disabled while loading, elapsed timer with cancel for generating/finalizing overlays
- **Server-side Gmail token storage** — GmailTokenService stores encrypted OAuth tokens (AES-256-GCM) in User.googleTokens. API routes use `getValidGmailToken(userId)` instead of extracting provider_token from Supabase session. Includes token refresh via Google OAuth2 endpoint with retry/backoff and optimistic locking for concurrent safety.
- **OAuth callback token persistence** — Callback route stores tokens after code exchange. Client-side fallback via `/api/auth/store-tokens` endpoint with Google tokeninfo validation.
- **User.id schema fix** — Changed from `@default(cuid())` to plain `@id` to store Supabase UUID directly. Changed `googleTokens` from `Json?` to `String?` (encrypted string, not JSON).
- **Request-level logging** — Auth middleware logs every API request entry/completion with duration, status, userId.

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

## Phase 2 Test Results (2026-03-13)

First successful end-to-end run with demo account (ndsoftwarecasatest@gmail.com):
- Schema `cmmpb334b0001qeg0e152tsh9` created: 9 entities, 10 tags, 3 extracted fields
- Hypothesis generation: ~28s (claude-sonnet-4-6)
- Validate + scan: ~3s
- Finalize: ~2.4s
- No duplicate API calls, no runaway loops (defensive patterns working)

### Verified
- [x] OAuth flow completes, tokens stored encrypted (AES-256-GCM)
- [x] Email metadata parses correctly
- [x] Hypothesis validation produces refined schema
- [x] Full interview flow: Card 1 → Card 2 → Card 3 → Card 4 → schema created
- [x] Tokens encrypted at rest with TOKEN_ENCRYPTION_KEY

### Needs Verification (will test during Phase 3+ when sessions are longer)
- [ ] Token refresh works (code implemented, needs refresh token from `prompt=consent` + natural expiry)
- [ ] Sample scan under 30 seconds for 200 emails (demo account may have <200 emails)
- [ ] Under 3 minutes total Card 1 to schema (compute time ~34s, no clean timed run yet)

### Phase 3: Extraction Pipeline (2026-03-13)
- **@denim/ai extraction prompt + parser**
  - `buildExtractionPrompt(email, schema)` — system/user prompt pair for Gemini with tag taxonomy, entity list, field definitions, exclusion patterns, JSON output format
  - `parseExtractionResponse(raw)` — Zod-validated parser (summary, tags, extractedData, detectedEntities, isInternal, language)
  - Shared `stripCodeFences` utility extracted from hypothesis/validation parsers
  - 9 parser unit tests passing
- **Gemini SDK integration** (`@google/generative-ai`)
  - Real `callGemini` implementation in AI client wrapper (replaces stub)
  - Rate limit detection for Gemini errors (429, RESOURCE_EXHAUSTED) in retry logic
  - Model: `gemini-2.5-flash` (updated from retired preview model)
- **Entity matching in @denim/engine**
  - Jaro-Winkler string similarity (pure functions, zero I/O)
  - `fuzzyMatch` (candidate vs targets with aliases, threshold 0.85)
  - `resolveEntity` (display name first, falls back to email local part)
  - 16 unit tests passing (including known test vector MARTHA/MARHTA ≈ 0.961)
- **Gmail API hardening**
  - `callGmailWithRetry` — retries on 429/403 with exponential backoff
  - `getEmailFullWithPacing(messageId, delayMs)` for batch extraction
  - `extractAttachmentMetadata(payload)` for attachment metadata without downloading
- **ExtractionService** (`apps/web/src/lib/services/extraction.ts`)
  - `extractEmail` — exclusion check → Gemini call → parse → entity resolve → upsert Email row (transaction with SchemaTag/CaseSchema/Entity count increments) → ExtractionCost logging
  - `processEmailBatch` — iterates messages with pacing, logs failures, continues
  - Cost formula: `(inputTokens × 0.00000015) + (outputTokens × 0.0000006)`
- **Exclusion rule matching** (`apps/web/src/lib/services/exclusion.ts`)
  - DOMAIN, SENDER, KEYWORD (subject), THREAD rules; case-insensitive; skips inactive
  - 7 unit tests passing
- **Inngest pipeline functions** (`apps/web/src/lib/inngest/functions.ts`)
  - `fanOutExtraction` (scan.emails.discovered → batches of 20, concurrency: 1/schemaId)
  - `extractBatch` (extraction.batch.process, concurrency: 3/schemaId, retries: 3)
  - `checkExtractionComplete` (extraction.batch.completed → tag frequency update → extraction.all.completed)
- **API routes**
  - POST `/api/extraction/trigger` — manual extraction trigger with schema ownership check
  - POST `/api/interview/finalize` — now auto-triggers extraction after schema creation
- **Discovery query safety limits** (`apps/web/src/lib/services/discovery.ts`)
  - Hard 8-week lookback (`newer_than:8w` appended to every query)
  - Hard 200 email cap across all queries combined (stops early once reached)
  - Queries run in order; once cap hit, remaining queries skipped
- **Event types updated** — userId, scanJobId, totalBatches added to pipeline events

### Phase 3 First Live Test (2026-03-13)
- Schema `cmmpi0rio0001qeag9gtjcyzm` created via nick.dicarlo@gmail.com (school_parent domain)
- 10 discovery queries generated (soccer, guitar, dance, St Agnes, Lanier, etc.)
- 513 emails discovered (no time limit or total cap was in place — now fixed)
- Inngest fan-out triggered but failed: Inngest auto-discovered on port 3000 while Next.js was on 3001 → 404 errors on all batch calls
- **Fix applied:** Must start Inngest with `-u http://localhost:3001/api/inngest`
- 0 emails actually processed (all batches failed before Gemini was called)
- **Needs re-test** with corrected Inngest URL and new discovery limits

### Dashboard & Schema Detail Page (2026-03-14)
- **SchemaCard clickable** — cards on `/dashboard` now link to `/dashboard/{schemaId}` via Next.js `Link`. Hover state with shadow/border transition. Delete button stays outside the link.
- **Schema detail page** (`apps/web/src/app/dashboard/[schemaId]/page.tsx`) — NEW
  - Server component, same auth pattern as dashboard (createServerSupabaseClient + user ownership check)
  - Loads schema with relations: tags, entities, extractedFields, exclusionRules, scanJobs (latest 5)
  - Displays: schema name/domain/status, stat cards (emails/cases/entities/tags), primary + secondary entities with counts, tag list (weak tags styled differently), extracted field definitions, exclusion rules with match counts, scan job history with status badges and phase labels
  - Back link to `/dashboard`
- **Scan trigger component** (`apps/web/src/components/dashboard/scan-trigger.tsx`) — NEW
  - Client component with "Scan Emails" button that calls `POST /api/extraction/trigger`
  - Ref guard prevents double-click, shows loading/success/error states
  - On success displays: "Scan started: {emailCount} emails found"
- Type-checks pass (`tsc --noEmit` clean)

### Phase 3 Live Test Results (2026-03-14)

First successful end-to-end extraction pipeline run with nick.dicarlo@gmail.com:
- Schema `cmmpb334b0001qeg0e152tsh9`: 58 emails discovered, 58 processed, 0 excluded, 0 failed
- 3 extraction batches (20 emails each), all completed successfully
- Model: `gemini-2.5-flash` (stable GA)
- ExtractionCost rows logged with token counts (~2000 input, ~130-250 output per email)
- Tag frequencies recalculated, weak tags updated
- `extraction.all.completed` event emitted

### Bugs Found & Fixed During Live Test (2026-03-14)

**Bug: Server Component cookie crash on landing page**
- **Root cause:** `createServerSupabaseClient()` used `cookies()` from `next/headers` which throws when Supabase tries to refresh tokens via `setAll` in Server Components (read-only context)
- **Fix:** Wrapped `setAll` in try/catch to silently no-op in Server Components. Added Next.js middleware with Supabase session refresh (official SSR pattern) that runs on all routes.

**Bug: PKCE code verifier missing on OAuth callback**
- **Root cause:** Auth callback used `createServerSupabaseClient()` with `cookies()` from `next/headers`. The PKCE code_verifier cookie set by the browser client wasn't accessible through this API.
- **Fix:** Rewrote callback to use `request.cookies.getAll()` directly (official Supabase SSR pattern for Route Handlers). Callback now creates its own Supabase client with request/response cookie handlers and copies auth cookies to redirect responses.

**Bug: Discovery queries returning 0 emails (newer_than:8w)**
- **Root cause:** Gmail search API does not support `w` (weeks) as a time unit for `newer_than`. Valid units are `d` (days), `m` (months), `y` (years). Gmail silently returns 0 results instead of erroring on invalid syntax.
- **Fix:** Changed `DISCOVERY_LOOKBACK` from `"8w"` to `"56d"` in discovery.ts.

**Bug: Gemini model 404 (preview model retired)**
- **Root cause:** `gemini-2.5-flash-preview-05-20` was a dated preview model that has been retired from the API.
- **Fix:** Updated to `gemini-2.5-flash` (stable GA) in extraction.ts.

**Bug: Scan button double-fire**
- **Root cause:** Scan trigger button's ref guard reset in `finally` block, allowing a second click after the first request completed.
- **Fix:** Only reset ref on error (so user can retry). Button stays disabled after successful scan trigger.

**Bug: Auth callback redirected to /interview on error instead of /dashboard**
- **Root cause:** All error paths in the auth callback redirected to `/interview?auth_error=true`, even for returning users with existing schemas.
- **Fix:** Changed error redirects to `/` which has server-side auth check logic to route users to `/dashboard` or `/interview` based on schema count.

### Phase 4: Clustering (2026-03-14)
- **Gravity model scoring in @denim/engine** (`packages/engine/src/clustering/`)
  - `scoring.ts` — `threadScore`, `tagScore`, `subjectScore`, `actorScore`, `caseSizeBonus`, `timeDecayMultiplier` (pure functions, explicit `now` param)
  - `gravity-model.ts` — `scoreEmailAgainstCase`, `findBestCase`, `clusterEmails`, `computeAnchorTags`
  - `reminder-detection.ts` — `isReminder` (subject similarity + time window)
  - 23 scoring tests + 17 clustering tests passing
- **ClusterService** (`apps/web/src/lib/services/cluster.ts`)
  - `clusterNewEmails(schemaId, scanJobId)` — loads unclustered emails, existing cases, runs gravity model, writes Case shells + CaseEmail + Cluster records in transaction
  - Case shells created with subject-based titles, anchorTags, allTags, denormalized sender/date fields
  - Updates CaseSchema.caseCount
- **Inngest `runClustering`** — triggered by `extraction.all.completed`, concurrency: 1/schemaId, retries: 2
  - Updates ScanJob phase to CLUSTERING, emits `clustering.completed` with clusterIds

### Phase 5: Synthesis Service (2026-03-14)
- **SynthesisResult types** (`packages/types/src/schema.ts`)
  - `SynthesisResult`, `SynthesisAction`, `SynthesisEmailInput`, `SynthesisSchemaContext`
- **Synthesis prompt builder** (`packages/ai/src/prompts/synthesis.ts`)
  - `buildSynthesisPrompt(emails, schema)` — system/user prompt pair for Claude
  - System prompt includes summaryLabels, tag taxonomy, entity list, action extraction instructions, dedup guidance, completion detection
  - User prompt lists emails chronologically with id, subject, sender, date, summary, tags
- **Synthesis parser** (`packages/ai/src/parsers/synthesis-parser.ts`)
  - Zod-validated: title (max 60 chars), 3-part summary, displayTags, primaryActor, actions (typed), status
  - 12 parser unit tests passing
- **Action dedup in @denim/engine** (`packages/engine/src/actions/dedup.ts`)
  - `generateFingerprint(title)` — lowercase, strip stop words, sort tokens alphabetically
  - `matchAction(fingerprint, existing[], threshold)` — Jaro-Winkler match above 0.85
  - 13 unit tests passing
- **SynthesisService** (`apps/web/src/lib/services/synthesis.ts`)
  - `synthesizeCase(caseId, schemaId, scanJobId?)` — skip guard checks `synthesizedAt` + new CaseEmail count to avoid re-synthesizing unchanged cases. Loads case with emails, builds prompt, calls Claude (claude-sonnet-4-5-20250514), parses response, dedup actions via fingerprinting, aggregates extracted field data per ExtractedFieldDef.aggregation, writes all in transaction (including `synthesizedAt`)
  - Creates/updates CaseAction rows with fingerprints, reminderCount increment for dedup matches
  - Aggregation functions: SUM, LATEST, MAX, MIN, COUNT, FIRST
  - Logs ExtractionCost row per synthesis call
  - Updates Case: title, summary, displayTags, primaryActor, status, aggregatedData, lastSenderName, lastSenderEntity
- **Inngest `runSynthesis`** (`apps/web/src/lib/inngest/functions.ts`)
  - Triggered by `clustering.completed`, concurrency: 2/schemaId, retries: 2
  - Loads cases from cluster records, synthesizes each sequentially
  - Updates ScanJob phase: SYNTHESIZING → COMPLETED, status → COMPLETED
  - Emits `synthesis.case.completed` for each case
  - Graceful per-case error handling (one failure doesn't stop pipeline)
- **Full pipeline chain:** scan → extract → cluster → **synthesize** → COMPLETED
- **Test results:** 105 total tests passing (69 engine, 29 AI, 7 web). `pnpm --filter web build` clean.

### Phase 6A: Case Review UI (2026-03-15)
- Case feed page, entity routing pipeline fixes, first real-data test stats
- See project memory for details

### Entity-Scoped Relevance Gating (2026-03-18)

**Problem:** Pipeline scanned 112 emails and created 76 cases for a user who entered soccer, Lanier, St Agnes, dance, guitar, and Ziad Allan. Expected ~10-15 cases. Root cause: domain-default discovery queries pulled in unrelated emails (payments, newsletters, Supabase signups, Mavericks tickets).

**Discovery test results** (`docs/test-results/discovery-test.md`):
- Mode 1 (existing schema): 58 entity-derived emails + **80 domain-default noise emails** = 126 total
- Domain-default noise: generic queries like `subject:(practice OR game OR match OR schedule)` matched Dallas Mavericks emails, `subject:(payment OR fee)` matched Google/Hartford/AE Texas payments
- Mode 2 (after fix): **0 domain-default queries** in both test scenarios — prompt fix working

**Changes implemented (all verified: 0 type errors, 102/102 unit tests pass):**

1. **Hypothesis prompt** — removed domain-default query generation from both system prompt and user prompt
2. **Extraction prompt** — entities annotated `[USER-INPUT]` vs `[DISCOVERED]`; added relevance assessment step (0.0-1.0 score); "tags alone do NOT make an email relevant"
3. **ExtractionResult type** — added `relevanceScore: number` and `relevanceEntity: string | null`
4. **Extraction parser** — `relevanceScore` defaults to 1.0, `relevanceEntity` defaults to null (backward compat)
5. **ExtractionService** — relevance gate at threshold 0.3; low-relevance emails upserted as excluded with `excludeReason: "relevance:low"`
6. **ClusterService** — removed fallback entity assignment; pre-filters emails with null entityId
7. **Gravity model** — defense-in-depth: skips CREATE when groupEntityId is null
8. **Prisma schema** — added `rawHypothesis Json?` to CaseSchema (pushed to Supabase)
9. **InterviewService** — `finalizeSchema()` stores `rawHypothesis` for debugging
10. **Discovery test script** — `scripts/test-discovery.ts` with token refresh, inline Gmail search, Mode 1/Mode 2

**Token refresh verified:** Script successfully refreshed expired OAuth access token using stored refresh token.

### Entity Groups — Paired WHAT+WHO Relationships (2026-03-18)

**Problem:** WHOs (like Ziad Allan) were blanket-associated with ALL primary entities, not just the specific WHAT they belong to. The interview captured flat lists, not pairings.

**Solution:** Entity groups capture natural pairings from the interview (Soccer↔Ziad Allan, Dance alone, Lanier alone, St Agnes alone).

**Changes implemented (all verified: 0 type errors, full build passes, integration test passes):**

1. **Types** (`packages/types/src/schema.ts`) — Added `EntityGroupInput` interface, `groups: EntityGroupInput[]` to `InterviewInput`, `entityGroups` to `ExtractionSchemaContext`, `groupIndex` to `DiscoveryQuery`
2. **Prisma schema** — New `EntityGroup` model (id, schemaId, index), `Entity.groupId` FK. Pushed to Supabase.
3. **Extraction prompt** (`packages/ai/src/prompts/extraction.ts`) — `buildEntityGroups()` renders group pairings + scoring guide for Gemini (3+ names same group → 1.0, 2 → 0.8, 1 → 0.6, none → 0.0)
4. **Extraction service** — `buildSchemaContext()` queries and maps `entityGroups` from DB; added `relevanceEntity` routing between sender resolution and detectedEntities fallback
5. **Inngest functions** — Updated schema query to include `entityGroups` with entities, passes to schema context
6. **Validation scan** (`/api/interview/validate`) — `resolveWhoEmails()` fuzzy-matches WHO names against sender display names in sampled emails, enriches hypothesis entity aliases with resolved email addresses
7. **Hypothesis prompt** — Group-aware discovery query generation: WHAT full-text + WHO `from:` + compound WHAT+WHO queries per group
8. **Finalize service** — Creates `EntityGroup` rows, links entities via `groupId`, sets **group-scoped** `associatedPrimaryIds` (not blanket). Falls back to blanket only when no groups provided.
9. **Interview UI** (`card1-input.tsx`) — Group-based input with per-group WHAT/WHO cards, "Add another group" button
10. **Interview hook** — Updated `InterviewInput` type with `groups`, passes through to finalize. Fixed: gets fresh Supabase token for finalize call.
11. **Zod validation** — Added `EntityGroupSchema`, `groups` required in `InterviewInputSchema`
12. **Hydration fix** — Added `mounted` gate to interview page to prevent sessionStorage hydration mismatch
13. **Session persistence fix** — Stopped clearing `savedInput` from sessionStorage after hypothesis success; groups must survive until finalize

**First live test results (2026-03-18, "Kids Activities" schema):**
- 54 emails discovered, 28 passed extraction (26 excluded by relevance gate), 0 failed
- 15 cases created, 17 actions extracted
- 0/28 emails had NULL entityId — every email got routed (major improvement)
- Entity groups NOT saved (bug: `clearSavedInput()` wiped groups before finalize) — fixed
- Strays in soccer group: "Claude AI Skill for Newsletter Summarization", "Houston Innovation & Tech Events" — expected without group context in prompt
- ZSA Soccer discovered as standalone entity but not merged into Soccer group — Card 4 UX gap

**Bugs found:**
- [x] **Auth token expired at finalize** — Hook used stale `authTokenRef` from Gmail connect. Fixed: finalize now gets fresh session from `createBrowserClient().auth.getSession()`
- [x] **Entity groups not saved** — `clearSavedInput()` in `onGmailConnected` wiped groups from sessionStorage before finalize ran. Fixed: input stays in sessionStorage until finalize succeeds.
- [x] **Hydration mismatch** — sessionStorage-based state differs server vs client. Fixed: `mounted` gate renders empty shell on server.

**Known UX gaps (not blocking, improve later):**
- [ ] Card 4 Review doesn't visualize group pairings (shows flat entity list)
- [ ] Discovered entities (e.g., "ZSA Soccer") can't be assigned to existing groups on Card 4
- [ ] Primary Entity Type description is generic AI boilerplate — should be context-aware using user's groups
- [ ] Creating 4 groups for 1 WHO + 3 standalone WHATs is clunky — consider flat-first + optional grouping

## Needs Verification

### Phase 4+5 Live Test
- [x] Full pipeline: scan → extract → cluster → synthesize → COMPLETED (end-to-end via Inngest) — verified 2026-03-18
- [x] Case rows have AI-generated titles — verified (e.g., "ZSA U11/12 Girls vs. ACDMY FC – Feb 28 Game")
- [x] CaseAction rows created — 17 actions across 15 cases
- [x] ScanJob shows COMPLETED phase after synthesis finishes — verified via Inngest dashboard
- [x] Actions stat card shows real CaseAction count — verified (17)
- [ ] Case summaries use schema's summaryLabels (beginning/middle/end)
- [ ] Action dedup works: reminder emails don't create duplicate actions
- [ ] Aggregated field data computed correctly per ExtractedFieldDef.aggregation
- [ ] Re-scan skips already-extracted emails (emailCount doesn't inflate)
- [ ] Re-scan skips already-synthesized cases with no new emails (no wasted Claude calls)

### Entity Groups Verification (needs re-run after wipe)
- [ ] EntityGroup rows created in DB with correct index ordering
- [ ] Entities have correct `groupId` linking
- [ ] Ziad Allan's `associatedPrimaryIds` points only to Soccer (not all primaries)
- [ ] Extraction prompt includes group context (verified in unit test, needs live verification)
- [ ] `relevanceEntity` routing reduces strays vs blanket association
- [ ] Discovered entities during validation don't get blanket-associated

### Bugs / Fixes Needed
- [x] **Skip already-extracted emails on re-scan** — Fixed
- [x] **Synthesis re-runs on already-synthesized cases** — Fixed
- [x] **Actions stat card shows wrong metric** — Fixed
- [x] **DB wipe for clean re-test** — `scripts/wipe-db.ts`
- [x] **Auth token expired at finalize** — Fixed: fresh session token
- [x] **Entity groups not saved** — Fixed: `clearSavedInput` deferred to finalize success

### Integration Test Suite (2026-03-19)
- [x] **60/60 tests passing** (all 9 test files green, including Inngest event chain)
- [x] Interview HTTP tests updated for `groups` field requirement
- [x] Inngest event chain test verified: `extraction.all.completed` → CLUSTERING → SYNTHESIZING → COMPLETED (41s)
- Test files: synthesis-edge-cases (5), real-gmail-pipeline (1), inngest-pipeline (2), case-review-ui (14), entity-groups (17), extraction (5), full-pipeline (5), feedback (6), interview (4)
- Requires: dev server on port 3000/3001 for HTTP tests, Inngest dev server for event chain test

### Ongoing
- [x] Token refresh works — confirmed 2026-03-18
- [ ] Extraction quality review — verify summaries are 1-2 sentences, tags match schema taxonomy, entity detection accuracy >85%
- [ ] Cost analysis — verify total extraction cost for 58 emails is under $0.50
- [ ] Playwright e2e for interview flow — Phase 6 per build plan
- [ ] **Production OAuth: remove `prompt: "consent"`** — Currently forces Google consent screen on every sign-in to guarantee a refresh token.

## Next Steps

### Immediate: Wipe + Re-run with Entity Groups
1. **Wipe test schema data** — `npx tsx scripts/wipe-db.ts`
2. **Re-run interview** with group-based input (Soccer + Ziad Allan, Dance, Lanier, St Agnes)
3. **Verify entity groups saved** — EntityGroup rows, groupId links, group-scoped associatedPrimaryIds
4. **Verify extraction quality** — fewer strays in soccer group with group context in prompt
5. **Verify relevanceEntity routing** — Ziad Allan emails route to Soccer specifically

### Then: Card 4 UX Improvements
- Show group pairings on review screen
- Allow assigning discovered entities to existing groups
- Context-aware Primary Entity Type description

### Then: Resume Phase 6
- Chrome Extension & Case Feed UI
- Case feed rendering, Chrome side panel, Playwright e2e tests

## Pipeline Architecture (complete as of Phase 5)

```
Interview finalize / Dashboard "Scan Emails"
  → ScanJob created (PENDING)
  → discovery.ts finds Gmail messages
  → emits scan.emails.discovered

fanOutExtraction (concurrency: 1/schema)
  → splits into batches of 20
  → emits extraction.batch.process per batch

extractBatch (concurrency: 3/schema, retries: 3)
  → Gemini extracts summary/tags/entities per email
  → emits extraction.batch.completed

checkExtractionComplete (concurrency: 1/schema)
  → updates tag frequencies
  → emits extraction.all.completed

runClustering (concurrency: 1/schema, retries: 2)
  → gravity model: pure scoring → Case shells + CaseEmail
  → emits clustering.completed

runSynthesis (concurrency: 2/schema, retries: 2)
  → Claude enriches each case: title, summary, tags, actor, actions
  → action dedup via fingerprinting
  → ScanJob → COMPLETED
  → emits synthesis.case.completed per case
```

## Environment

- ANTHROPIC_API_KEY: set in apps/web/.env.local (claude-sonnet-4-6 confirmed working)
- GOOGLE_AI_API_KEY: set in apps/web/.env.local (Gemini Flash 2.5)
- GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET: set in apps/web/.env.local (needed for token refresh)
- TOKEN_ENCRYPTION_KEY: set in apps/web/.env.local (AES-256-GCM for OAuth token storage)
- Rate limit: 8,000 output tokens/minute on claude-sonnet-4-6 (org tier)
- Supabase: configured and connected
- Node 22, pnpm workspaces
- googleapis: installed in apps/web
- @supabase/ssr: installed for cookie-based auth
- @google/generative-ai: installed in apps/web
