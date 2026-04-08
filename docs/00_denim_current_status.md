# Denim Email — Current Status

Last updated: 2026-04-07 (Eval Session 1 — FAIL — 15 follow-up issues filed against #12)

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
- [x] Case summaries use schema's summaryLabels (beginning/middle/end) — verified 2026-03-22, working but low priority for UI quality
- [ ] Action dedup works: reminder emails don't create duplicate actions
- [ ] Aggregated field data computed correctly per ExtractedFieldDef.aggregation
- [ ] Re-scan skips already-extracted emails (emailCount doesn't inflate)
- [ ] Re-scan skips already-synthesized cases with no new emails (no wasted Claude calls)

### Entity Groups Verification (verified 2026-03-19)
- [x] EntityGroup rows created in DB with correct index ordering — Group 0: Soccer+Ziad Allan, Group 1: St Agnes, Group 2: Dance+Lanier
- [x] Entities have correct `groupId` linking — all 5 primaries + 1 secondary have groupIds
- [x] Ziad Allan's `associatedPrimaryIds` points only to Soccer (group-scoped, not blanket)
- [x] Extraction prompt includes group context — verified via live pipeline
- [x] `relevanceEntity` routing reduces strays vs blanket association — 48/48 emails routed (100%)
- [x] Discovered entities during validation don't get blanket-associated — ZSA Soccer (U11/12 Girls) has groupId=null (ungrouped)
- [x] Discovered entities Card 4 UX — auto-promote to own groups implemented 2026-03-22, drag-and-drop working on desktop

### Bugs / Fixes Needed
- [x] **Skip already-extracted emails on re-scan** — Fixed
- [x] **Synthesis re-runs on already-synthesized cases** — Fixed
- [x] **Actions stat card shows wrong metric** — Fixed
- [x] **DB wipe for clean re-test** — `scripts/wipe-db.ts`
- [x] **Auth token expired at finalize** — Fixed: fresh session token
- [x] **Entity groups not saved** — Fixed: `clearSavedInput` deferred to finalize success
- [x] **"0 cases synthesized" false report** — Inngest step memoization reset outer counter variables. Fixed: collect step.run return values into results array, derive counts after loop

### Integration Test Suite (2026-03-19)
- [x] **60/60 tests passing** (all 9 test files green, including Inngest event chain)
- [x] Interview HTTP tests updated for `groups` field requirement
- [x] Inngest event chain test verified: `extraction.all.completed` → CLUSTERING → SYNTHESIZING → COMPLETED (41s)
- Test files: synthesis-edge-cases (5), real-gmail-pipeline (1), inngest-pipeline (2), case-review-ui (14), entity-groups (17), extraction (5), full-pipeline (5), feedback (6), interview (4)
- Requires: dev server on port 3000/3001 for HTTP tests, Inngest dev server for event chain test

### Ongoing
- [x] Token refresh works — confirmed 2026-03-18
- [x] Extraction quality review — relevance gating filters newsletters, entity routing at 100%, summaries appropriate length
- [x] Cost analysis — full pipeline run (52 emails + clustering + synthesis): ~$0.12 total
- [ ] Playwright e2e for interview flow — Phase 6 per build plan
- [ ] **Production OAuth: remove `prompt: "consent"`** — Currently forces Google consent screen on every sign-in to guarantee a refresh token.

## Live Test Results (2026-03-19, post-wipe clean run)

Schema: "Kids Activities" (school_parent), schemaId: cmmxt6x6l0001qej8m63epuhb
- **54 emails discovered**, 48 extracted (6 excluded by relevance gate), 0 failed
- **12 cases** created, **12 clusters**, **6 actions**
- **Entity routing: 48/48 (100%)** — every email has entityId
- Entity counts: Soccer=42, Ziad Allan=34, Lanier=3, St Agnes=2, Dance=1, ZSA Soccer=0
- Tag counts: Schedule=33, Action Required=26, Practice=24, Game/Match=11, Payment=7, Cancellation=5, Permission/Form=1
- Entity groups saved correctly: Group 0 (Soccer+Ziad Allan), Group 1 (St Agnes), Group 2 (Dance+Lanier)
- ZSA Soccer emails routed to Soccer via Ziad Allan sender match (correct behavior)
- Pipeline: all 10 Inngest runs completed successfully (fan-out → 3 batches → check-complete → clustering → synthesis)

### Noise emails (minor)
- 4 "Claude Skill for Newsletter Overload" emails routed to Soccer via relevance method — false positive from relevance gate

### Known issues
- Dashboard entity/tag counts show (0) until page refresh (Server Component caching)
- "0 cases synthesized" status message — **fixed** in this session (Inngest step counter bug)
- ZSA Soccer (U11/12 Girls) discovered entity not assigned to Group 0 — needs Card 4 UX for group assignment

### Pipeline Quality Fixes (2026-03-19) — 8 Issues from Live Testing

1. **Holistic relevance scoring** — Extraction prompt rewritten from mechanical name-counting to context-aware assessment. Threshold raised from 0.3 to 0.4. Newsletters mentioning entity names now score 0.1 instead of 0.6.
2. **Synthesis urgency field** — New `urgency` on Case: IMMINENT, THIS_WEEK, UPCOMING, NO_ACTION, IRRELEVANT. IRRELEVANT cases auto-resolve. Negative action rule prevents creating actions for deliberately expired/declined items.
3. **Pre-cluster AI intelligence** — Claude reviews all extracted emails before gravity model, suggests intelligent groupings (recurring events → one case), config overrides, and exclude suggestions. Falls back to pure gravity model on failure. Stored in PipelineIntelligence table.
4. **Feed as "What's Next" dashboard** — Cases sorted by urgency tier (IMMINENT > THIS_WEEK > UPCOMING > NO_ACTION). IRRELEVANT filtered out. Next event date shown prominently on cards.
5. **UI fixes** — Date formatting: 7+ days shows actual date ("Feb 15") instead of "1mo ago". Clustering debug enriched with MERGE/CREATE badges, score breakdowns, routing decisions, AI reasoning. Event dates on case cards.
6. **Hybrid discovery** — Broad inbox scan → sender pattern analysis → social graph (co-recipients of known entities) → body sampling for unknown domains → AI-generated Gmail queries. Falls back to hypothesis queries on failure. Stored in PipelineIntelligence.

**New files:**
- `packages/ai/src/prompts/clustering-intelligence.ts` — Pre-cluster AI prompt
- `packages/ai/src/parsers/clustering-intelligence-parser.ts` — Parser + Zod validation
- `packages/ai/src/prompts/discovery-intelligence.ts` — Smart discovery AI prompt

**New DB model:** `PipelineIntelligence` — stores AI reasoning at discovery + clustering stages

**Schema change:** `Case.urgency` column added (String?, default "UPCOMING")

**Status:** Verified via integration test + full UI pipeline run (2026-03-20)

### Pipeline Quality Comparison Test (2026-03-20)

**Integration test:** `tests/integration/flows/pipeline-quality-comparison.test.ts`
- Creates 2nd "Kids Activities" schema with identical config, runs new pipeline, compares with existing schema
- Cost-guarded: 30 email cap for extraction, 10 case cap for synthesis (~$0.12 per run)
- All assertions pass, PipelineIntelligence records verified for discovery + clustering

**Integration test results (30-email cap):**
| Metric | Schema 1 (old) | Schema 2 (test) |
|--------|---------------|-----------------|
| Total emails | 52 | 30 |
| Relevant | 48 | 22 |
| Relevance-gated | 4 | 8 |
| Cases | 12 | 3 |
| Actions | 6 | 7 |

**Full UI pipeline run results (no cap, 52 emails):**
| Metric | Schema 1 (old) | Schema 2 (new) |
|--------|---------------|----------------|
| Total emails | 48 relevant | 52 relevant |
| Cases | 12 | 7 |
| Actions | 6 | 9 |
| Urgency tiers | All UPCOMING | IMMINENT(1), THIS_WEEK(2), UPCOMING(2), NO_ACTION(2) |
| Entity coverage | 4 entities | 4 entities |
| Newsletters | 2 leaked in | 0 (filtered by relevance gate) |
| Duplicate cases | 2 (US Soccer membership) | 0 |

**New pipeline cases (schema 2):**
- THIS_WEEK: ZSA U11/12 Girls Spring 2026 Competitive Practices (33 emails, 2 actions)
- THIS_WEEK: IB Learner Profile Award Ceremony at Lanier (1 email, 1 action)
- UPCOMING: ZSA U11/12 Girls Spring 2026 League Games (12 emails, 4 actions)
- UPCOMING: Pia Spring Dance Show – May 5, 2026 (1 email, 1 action)
- NO_ACTION: Lanier Middle School PTO Donations (2 emails, 0 actions)
- NO_ACTION: St. Agnes Academy Fund Donation (1 email, 0 actions)
- IMMINENT: Dads & Donuts at St. Agnes – Jan 30 (1 email, 1 action) — **bug: past event shown as IMMINENT**

**Quality improvements confirmed:**
1. Newsletters filtered (0 vs 2 leaked in old pipeline)
2. Better clustering (7 coherent cases vs 12 scattered)
3. No duplicate cases (0 vs 2 US Soccer membership dupes)
4. Urgency differentiation (4 tiers vs all UPCOMING)
5. Higher action density (9 from 7 cases vs 6 from 12)
6. 33 soccer practices grouped into one case (vs spread across multiple)
7. AI clustering intelligence creates semantically coherent groupings
8. Smart discovery generated 11 AI queries beyond hypothesis queries

### Synthesis Date-Awareness Fix (2026-03-20)

**Bug:** Past events (e.g., "Dads & Donuts – Jan 30") classified as IMMINENT because synthesis prompt had no reference to today's date.

**Fix:** Added `TODAY'S DATE: YYYY-MM-DD` to synthesis system prompt with instruction: "Events/deadlines that have already passed are NOT imminent — they are NO_ACTION (expired)." The `buildSynthesisPrompt()` function now accepts an optional `today` parameter (defaults to current date). No caller changes needed.

### Content-First Entity Routing (2026-03-21)

**Problem:** Property Management test with 1501 Sylvan, 3305 Cardinal, 851 Peavy + 3 shared managers (Timothy Bishop, Vivek Gupta, Krystin Jernigan) in one group. 1501 Sylvan got 134 emails and 51 cases — most about OTHER properties. Sender-based routing picked `associatedPrimaryIds[0]` as a catch-all.

**Design principle:** WHOs are discovery channels (where to find emails), not routing destinations. The WHAT in the email content determines routing.

**Changes:**
1. **Content-first routing order** (`extraction.ts`): Gemini relevanceEntity → content match (subject/summary scan for known PRIMARY names) → detectedEntities → sender (last resort, only when exactly 1 associated primary)
2. **Ungrouped WHOs** — Card 1 "People who email you" section for shared senders. Become SECONDARY entities with empty `associatedPrimaryIds`. Generate `from:` discovery queries but don't drive routing.
3. **Card 4 drag-and-drop** — discovered entities draggable into group cards via @dnd-kit/core (touch long-press 250ms + mouse). Assigned entities appear inside group with undo button.
4. **Email counts on discovered entities** — validation prompt returns `emailCount` per discovered entity, displayed on Card 4.
5. **Finalize handles sharedWhos** — creates SECONDARY entities with no group, empty associatedPrimaryIds.
6. **Hypothesis prompt** — generates `from:` queries for shared WHOs without compound queries.
7. **Synthesis fix** — `runSynthesis` queries all OPEN cases directly instead of following stale cluster record refs (two-pass clustering deletes coarse cases).

**Files changed:** extraction.ts, card1-input.tsx, card4-review.tsx, use-interview-flow.ts, interview.ts (service), interview.ts (validation), interview-hypothesis.ts, schema.ts (types), cluster.ts (startTime bugfix)

**Integration tests:** 60/60 passed + 1 skipped (Inngest event chain — passes in isolation but Inngest server causes race conditions with parallel test files). Type check clean.

### Property Management Test Results (2026-03-21)

Schema `cmn0i26tx00iaqenwee12mk4z` — pre-fix results showing the catch-all problem:
- 1501 Sylvan: **134 emails, 51 cases** (most about other properties — 205 Freedom Trail, 2310 Healey, 3910 Bucknell, etc.)
- 851 Peavy: 34 emails, 17 cases (correctly scoped)
- 3305 Cardinal: 2 emails

**Root cause:** All 3 managers in one EntityGroup with `associatedPrimaryIds` pointing to all 3 properties. Sender routing picked `[0]` = 1501 Sylvan for every email from any manager.

**Post-fix:** Content-first routing checks email subject/body for property addresses before falling back to sender. Shared WHOs (managers) generate discovery queries but don't determine routing.

### March 22 Fixes & Human Test Results

**Gemini Thinking Token Fix:**
- Gemini 2.5 Flash has "thinking" mode enabled by default, consuming output tokens for internal reasoning
- Added `thinkingConfig: { thinkingBudget: 0 }` to `genAI.getGenerativeModel()` in `client.ts`
- Single change covers all Gemini calls (extraction, discovery intelligence, etc.)
- `@ts-expect-error` needed — SDK types don't include `thinkingConfig` yet

**Auto-Promote Discovered PRIMARY Entities (2026-03-22):**
- Discovered PRIMARY entities from validation scan now auto-promote to their own EntityGroup during finalize
- No manual drag-and-drop required — scan findings automatically generate cases
- Card 4 shows discovered primaries as dashed-border "Discovered" group cards with email counts
- User-added PRIMARY entities from Card 4 also auto-promote if ungrouped
- Backend: `interview.ts` `finalizeSchema()` creates EntityGroup rows for ungrouped primaries after existing group loop
- Frontend: `card4-review.tsx` splits unassigned discovered into PRIMARY (auto-group cards) vs SECONDARY (ungrouped draggable)

**Case Feed UX Fixes (2026-03-22):**
1. **Active filter** — now sends `OPEN,IN_PROGRESS` (was only OPEN, causing "No cases found")
2. **Multi-status API** — `validation/cases.ts` accepts comma-separated statuses, API filters with `{ in: [...] }`
3. **Sort order** — both server page and API sort: active first → urgency tier (IMMINENT > THIS_WEEK > UPCOMING > NO_ACTION) → date. Resolved always last.
4. **Past events** — case cards show past events dimmed with "Past:" label instead of hiding them
5. **Case detail perf** — emails capped at 25 per case detail load, dropped unused fields from select
6. **DB index** — added `@@index([schemaId, status, urgency])` on Case model

**Kids Activities Test (2026-03-22, "Girls Activities Test 2 March 22 Cases"):**
- 160 emails discovered, 56 extracted (104 excluded by relevance gate)
- 37 cases created (55 coarse → 37 after splitting), 45 clusters, 13 actions
- Entity routing: Soccer (48), Lanier (3), St. Agnes (3), Dance (1), Martial Arts/Belt Testing (1)
- Auto-promoted entities working: "TeamSnap / ZSA U11/12 Girls Soccer" dragged into Soccer group, "2109 Meadfoot" auto-promoted as discovered PRIMARY
- Summary labels verified — working but not a high-leverage UI element yet
- Card 4 drag-and-drop tested on desktop (click-drag) — working

**Property Management Test (2026-03-22):**
- Content-first routing working well — properties separated correctly
- Shared managers (Timothy Bishop, Vivek Gupta, Krystin Jernigan) entered as ungrouped WHOs
- Judge Fite correctly left as ungrouped SECONDARY (sender, not property)
- 2109 Meadfoot auto-discovered and auto-promoted to its own group

**Bugs Fixed (2026-03-22, later session):**
- [x] Game sort order — now sorts by nearest future event date ASC within urgency tier (was lastEmailDate DESC)
- [x] Past events urgency — deterministic post-synthesis override: if ALL event actions are in the past, force urgency to NO_ACTION
- [x] Schema ONBOARDING → ACTIVE — auto-transitions after pipeline completes (new Inngest step)
- [x] feedbackRating persistence — THUMBS_UP/DOWN now updates Case.feedbackRating
- [x] MetricBar hardcoded — now wired to real CaseSchema.qualityPhase
- [x] Action toggle — new PATCH /api/actions/[id] route, clickable ○/✓ in action list with optimistic updates
- [x] alternativeCaseId — gravity model now returns second-best match, written to Email records during clustering

### Phase 6A Quick Wins (2026-03-22)
- Schema ONBOARDING → ACTIVE transition after pipeline completes
- Case.feedbackRating updated on thumbs up/down (was only creating FeedbackEvent)
- Action status toggle: PENDING ↔ DONE with optimistic UI
- MetricBar wired to real qualityPhase from schema
- Synthesis passes explicit `today` to prompt builder

### Phase 7: Feedback & Quality System (2026-03-22)

**Completed:**
- **EMAIL_MOVE correction** — FeedbackService reassigns CaseEmail, updates denormalized counts, emits `feedback.case.modified` events for re-synthesis of both source and target cases
- **ExclusionRule auto-creation** — after 3+ EMAIL_EXCLUDE events from same sender domain, auto-creates DOMAIN rule (`source: system_suggested`)
- **QualityService** (`apps/web/src/lib/services/quality.ts`) — `computeSnapshot()` aggregates 30-day rolling window, computes accuracy = `1 - (corrections / casesViewed)`, handles phase transitions
- **Phase transitions** — CALIBRATING → TRACKING (≥5 signals), TRACKING → STABLE (≥95% accuracy for 7 consecutive days)
- **Re-synthesis on feedback** — Inngest `resynthesizeOnFeedback` function listens for `feedback.case.modified`, re-synthesizes affected case
- **Daily quality snapshot** — Inngest cron job (midnight daily) computes snapshots for all ACTIVE schemas
- **Quality API routes** — `GET /api/quality/[schemaId]` (current accuracy + phase), `GET /api/quality/[schemaId]/history` (paginated snapshots)
- **alternativeCaseId population** — gravity model `findTopCases()` returns best + second-best match; clustering writes to Email records

**Not implemented (logged for future):**
- Learning loop: gravity model weight adjustment from user corrections (tag weights, actor weights, entity confidence)
- CASE_MERGE / CASE_SPLIT correction processing (FeedbackEvent types exist, side effects not implemented)

### Needs Verification (updated 2026-03-22)
- [x] Case summaries use summaryLabels — verified working, low priority
- [x] Discovered entities Card 4 UX — auto-promote + drag-and-drop working on desktop
- [x] Property Management content-first routing — verified 2026-03-22
- [ ] Action dedup: reminder emails don't create duplicate actions — not yet verified
- [ ] Aggregated field data computed correctly per ExtractedFieldDef.aggregation — not yet verified
- [ ] Re-scan skips already-extracted emails — not yet verified
- [ ] Re-scan skips already-synthesized cases with no new emails — not yet verified
- [ ] Card 4 drag-and-drop on mobile (long-press) — not yet tested
- [ ] Game sort order fix — needs human re-test (implemented but not verified with live data)
- [ ] Past event urgency override — needs human re-test (implemented but not verified with live data)
- [ ] EMAIL_MOVE end-to-end — UI for email move not yet built (API + service ready)
- [ ] ExclusionRule auto-creation — needs 3 excludes from same domain to trigger
- [ ] Quality snapshot computation — needs feedback events to test (run after rating cases)
- [ ] Phase transition CALIBRATING → TRACKING — needs 5+ feedback signals
- [ ] Re-synthesis on feedback.case.modified — needs EMAIL_MOVE UI to trigger
- [ ] Daily quality cron job — needs ACTIVE schema + Inngest cron support

## Phase Completion Status

| Phase | Status | Notes |
|---|---|---|
| 0: Scaffolding | **Complete** | Monorepo, Prisma, auth, logging, CI |
| 1: Interview Service | **Complete** | Hypothesis generation, validation, finalization |
| 2: Gmail + Interview UI | **Complete** | OAuth, Gmail client, Cards 1-4, entity groups |
| 3: Extraction Pipeline | **Complete** | Gemini extraction, relevance gating, entity routing |
| 4: Clustering Engine | **Complete** | Two-pass gravity model, case splitting, tag scoring |
| 5: Synthesis Service | **Complete** | Claude enrichment, urgency, action dedup, emoji, mood |
| 6A: Case Review UI | **Complete** | Feed, detail, filters, actions, feedback — replaced by UX overhaul Waves 2-3 |
| 6B: Chrome Extension | Deferred | After web quality validated |
| 7: Feedback & Quality | **Mostly complete** | EMAIL_MOVE + ExclusionRule + QualityService + re-synthesis + API. **Remaining:** CASE_MERGE/SPLIT processing, learning loop |
| AI Audit Fixes | **Complete** | All original + remaining issues resolved 2026-03-31 |
| AI Prompt Quality | **Complete** | Time-neutral language, body/email caps, mood, signature noise, calibration bounds (2026-03-31) |
| Case Urgency & Decay | **Complete** | nextActionDate sort, computeCaseDecay, daily cron, read-time freshness (2026-03-31) |
| Major Dep Migration | **Complete** | Merged to main 2026-03-30 (Vitest 4, Biome 2, Prisma 7, Zod 4, React 19, Next.js 16, Tailwind 4, Inngest 4) |
| UX Overhaul | **Complete** | All 3 waves done 2026-04-07. Branch: feature/ux-overhaul. Onboarding flow, cross-topic feed, settings hub, old route cleanup. |
| 7.5: Periodic Scanning | Not started | Automated daily scans at set times |
| 8: Calendar Integration | Not started | Progressive OAuth, CalendarService |
| 9: Delta Processing | Not started | Re-scan for new emails, action lifecycle |

## Major Dependency Migration — MERGED (2026-03-30)

**Branch:** `upgrade/major-deps-2026` → merged to `main` on 2026-03-30.

All 7 phases complete (Vitest 4, Biome 2, Prisma 7, Zod 4, React 19 + Next.js 16, Tailwind 4, Inngest 4). Also included: AI pipeline audit fixes, Case.emoji, Case.mood fields, UX redesign docs.

Key changes:
- Prisma 7 requires `prisma.config.ts` + `@prisma/adapter-pg` driver adapter
- Prisma client generated to `prisma/generated/prisma/client/` (tsconfig path alias)
- Zod 4 requires `z.record(keyType, valueType)` (no single-arg)
- React 19.2.4 + Next.js 16.2.1: async `cookies()`, async `params` in Server Components
- `next.config.js` → `next.config.ts`, `middleware.ts` → `proxy.ts`
- Tailwind 4.2.2: `@tailwindcss/postcss`, class renames (shadow-sm→shadow-xs, outline-none→outline-hidden)
- Inngest 4.0.4: `createFunction` 3-arg→2-arg, removed EventSchemas
- Type errors reduced from 174 → 0

## In Progress: UX Overhaul (2026-03-30)

**Branch:** `feature/ux-overhaul` (created from main)

### Documentation created/updated:
- `docs/stitch-screen-briefs.md` — 29 screens for Stitch design, with schema population mapping per screen
- `docs/screen-schema-flow.md` — Mermaid diagrams + completeness audit confirming all 18 schema models are populated
- `docs/ux-redesign-plan.md` — Phase 0 fixes marked complete, temporal staleness status updated
- `docs/ai-call-audit.md` — 4 original issues marked FIXED, remaining issues documented

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
- 18 unit tests for lifecycle functions

### AI Prompt Quality Fixes (2026-03-31)

**Extraction prompt** (`packages/ai/src/prompts/extraction.ts`):
- Time-neutral summaries: absolute dates enforced ("Tue Apr 1" not "next Tuesday")
- Body capped at 8000 chars (prevents token waste on forwarded chains)
- Attachment section placeholder (ready for OCR, `ExtractionInput.attachments` optional)
- Signature noise rule: ignore signatures/footers for entity detection

**Synthesis prompt** (`packages/ai/src/prompts/synthesis.ts`):
- Mood assessment added (CELEBRATORY/POSITIVE/NEUTRAL/URGENT/NEGATIVE) — wired to parser, type, and `Case.mood` DB write
- Time-neutral summaries: absolute dates enforced in all sections
- `summary.end` now includes "As of [date]:" temporal anchor
- Action titles must include day+date+time ("Practice Tue Apr 1 5:30 PM")
- Event end time guidance for duration extraction
- Email cap at 30 most recent (prevents quality degradation on large cases)

**Calibration prompt** (`packages/ai/src/prompts/clustering-calibration.ts`):
- Parameter bounds in prompt + defense-in-depth clamping in service (mergeThreshold 20-80, etc.)
- Zero-correction first run: returns current params unchanged, builds initial discriminator vocabulary
- Corrections enriched with case titles (not bare IDs)

### Remaining code gaps (pre-UX implementation):
1. ~~**Time-neutral language directives**~~ — FIXED (2026-03-31): extraction + synthesis prompts enforce absolute dates
2. ~~**Post-synthesis expiry scope**~~ — FIXED: `computeCaseDecay` checks all action types
3. ~~**Deterministic status decay**~~ — FIXED: `computeCaseDecay` + daily cron + read-time freshness
4. **Schema additions needed** — UserNote, NotificationPreference models; User.stripeCustomerId/subscriptionStatus/trialEndDate fields

## Eval Session 1 — 2026-04-07 — FAIL

First formal end-to-end eval of the new-user experience after the UX overhaul. Wiped DB, fresh OAuth, single user walkthrough on desktop with screen recording. Tracked in #12. **Result: end-to-end flow does not work; case quality is partially broken.** 15 follow-up issues filed (#14–#28).

### Rubric scores
| # | Criterion                              | Score      |
|---|----------------------------------------|------------|
| 1 | Works end-to-end                       | **0/5**    |
| 2 | New-user UX delivers core value prop   | (deferred — flow broke) |
| 3 | Generates great cases                  | **1/5**    |
| 4 | Information hierarchy actionable       | (partial)  |
| 5 | Performant UI                          | (deferred — needs prod build per #13) |
| 6 | Easy to navigate                       | **2-3/5**  |

### Top findings (full detail in #12)

**Pipeline / orchestration (P0):**
- **Loading screens hang** (#15) — both "Setting up Gmail" and "Setting up topic" hang indefinitely; only escape is browser refresh
- **Refresh creates duplicate schemas** (#14) — the refresh from above re-submits, creating duplicate schemas. Eval session created **6 schemas when 2 were intended**, burning ~6× expected cost ($2.19 actual vs ~$0.40 expected).
- **Scans silently drop 60-85% of emails** (#16) — every scan job marked `status=COMPLETED` while only processing 35-75 of ~200 discovered emails, with no `failed` count to explain the gap. **Highest-impact bug** — case quality cannot be honestly evaluated until this is fixed.
- **No auto-transition from scanning to review/feed** (#17) — pipeline finishes, UI keeps polling, user stuck on the loading screen. **Root cause identified 2026-04-07 (post-eval research):** `/api/schemas/[id]/status` returns `{ schemaStatus, scanJob: { phase, status, totalEmails, processedEmails, ... }, recentDiscoveries }`, but `apps/web/src/components/onboarding/scan-stream.tsx` reads `data.phase`, `data.status`, `data.totalEmails`, `data.processedEmails` off the top level. The fields are nested under `scanJob` so the polling loop never observes `status === "COMPLETED"` and `onComplete()` never fires. The Inngest pipeline (including the `activate-schema` step at `functions.ts:614-619` flipping CaseSchema ONBOARDING→ACTIVE) is working — the bug is purely a client/server contract mismatch in the polling endpoint.
- **Review screen has no schema context** (#18) — visiting `/onboarding/review` directly does not show which schema is being reviewed

**Case quality (P1):**
- **Clustering non-determinism** (#19) — same Gmail account, same interview answers, two parallel runs produced wildly different output (school #1: 6 cases with multi-email clustering; school #2: 18 cases all single-email)
- **User-defined topic anchors not respected as boundaries** (#20) — entered "1501 Sylvan", "3910 Bucknell", "205 Freedom" as separate topics; clustering still combined two of them into one case
- **Time-decay urgency not de-prioritizing aged cases** (#21) — a 32-day-old tax-prep thread surfaced as UPCOMING
- **Topic pills read from wrong column** (#22) — pills show `case_schemas.name` (AI-generated) instead of `discoveryQueries` (what the user typed)
- **scan_jobs denormalized fields broken** (#23) — `casesCreated` double-counts (= cases + clusters); `estimatedCostUsd` rollup never written ($0.00 in scan_jobs vs $2.19 real spend in extraction_costs)

**Scanning UX (P1):**
- **Progress bar does not reflect pipeline progress** (#24) — bar shows the same level for minutes while Inngest runs real work. This is the proximate trigger of the duplicate-schema bug.
- **Scanning UX needs better in-flight info AND faster wall-clock** (#25) — 4-10 minutes for ~70 emails with no live status; needs both per-stage info and parallelization

**Desktop layout (P2):**
- **Feed desktop layout not built to spec** (#26) — single-column "cards crash into each other"; missing the two-column grid, sidebar, search bar, and hero block from the Stitch design
- **Case detail single-column on desktop** (#27) — should be 3-column per design intent
- **Accent color mismatch** (#28) — tokens say caramel, designs use teal/coral as the dominant visual

### Good news
- Property schemas produced **legitimately useful cases** when they worked: titles like "3910 Bucknell - Foundation & Plumbing Repairs" (17 emails, 2 actions), "Commercial Property Insurance Policy Decision" (5 emails, 2 actions). Clustering + synthesis stack works when input is clean.
- Discovery is doing useful work: surfaced **2310 Healey** as a property even though the user did not enter it.
- Eval infrastructure now exists: `apps/web/scripts/eval-snapshot.ts`, `apps/web/scripts/eval-wipe.ts` (with snapshot guard), `apps/web/scripts/eval-diagnose.ts`, snapshot at `docs/test-results/pre-eval-snapshot-2026-04-07.json`, eval writeup at `docs/test-results/eval-session-1-comment.md`. Re-runnable for future eval cycles.
- Visual design system showcase live at `/design-system` (built in this session).

### Suggested fix order (per the index comment on #12)
1. **#15** — fix loading-screen hangs (removes the user's reason to refresh)
2. **#14** — add idempotency as defense in depth
3. **#17 + #18 together** — auto-transition + review-screen schemaId context
4. **#16** — silent early termination (highest case-quality lever)
5. **Clean eval rerun** — validate end-to-end before touching P1s
6. **P1 case-quality:** #19 (non-determinism) and #20 (topic anchors as boundaries) have the biggest case-quality impact
7. **P1 scanning UX:** #24 + #25 should be designed together (shared status payload)
8. **P2 UI:** #28 (accent reconciliation) before #26 (feed layout) so layout uses correct colors

## Next Steps

### Immediate: Eval Session 1 P0 follow-ups (BLOCK SHIP)
Eval Session 1 (#12) failed end-to-end. Five P0 issues block any further progress on UX or features. Fix order:

1. **#15 — Onboarding loading screens hang** (Gmail + topic setup). Removes the user's reason to refresh.
2. **#14 — Topic-creation idempotency.** Defense in depth so any future hang doesn't multiply schemas.
3. **#17 + #18 together — Auto-transition + review-screen schema context.** Same flow, fix as one.
4. **#16 — Scans silently drop 60-85% of emails.** Highest case-quality lever in the entire eval.
5. **Clean eval rerun.** Validate end-to-end before touching P1s.

### After P0s: Eval P1 case-quality fixes
- **#19 — Clustering non-determinism.** Same input produces different output across runs.
- **#20 — Topic anchors not respected as case boundaries.** User's WHATs should partition cases.
- **#21 — Time-decay urgency.** 32-day-old quiet cases should not be UPCOMING.
- **#22 — Topic pills wrong column source.**
- **#23 — `scan_jobs` denormalized fields broken** (`casesCreated` double-count + cost rollup not written).

### After P1 case quality: Scanning UX (designed together, share status payload)
- **#24 — Progress bar doesn't reflect pipeline.**
- **#25 — Better in-flight info AND faster wall-clock time.**

### Then: UX P2 (desktop layout — accent reconciliation first)
- **#28 — Accent color reconciliation** (caramel vs teal/coral). **Land before #26 so layout uses correct colors.**
- **#26 — Feed desktop layout to spec** (two-column grid, sidebar, hero, search, card spacing).
- **#27 — Case detail desktop 3-column layout.**

### After eval bugs are clear: Schema additions still pending
- **Schema additions** — UserNote, NotificationPreference models; User.stripeCustomerId/subscriptionStatus/trialEndDate fields for billing

### Long-deferred (still on the board)
- **Phase 4**: Notes & Settings (UserNote CRUD, topic editor, dashboard, notifications)
- **Phase 5**: Calendar & Polish (calendar integration, PWA, digest email, first-run tooltips)
- **Eval criterion 5 (perf, #13)** — deferred until P0s land and a clean eval can run; needs prod build, not dev

### Needs Scoping (design + plan before building)
- **Learning loop** — gravity model weight adjustment from user corrections
- **Admin dashboard** — per-schema quality metrics

### Minor Fixes (ongoing)
- Context-aware Primary Entity Type description on Card 4
- Production OAuth: remove `prompt: "consent"`

### Future Phases
- Phase 6B: Chrome Extension & Side Panel
- Phase 7.5: Periodic scanning (automated daily scans)
- Phase 8: Calendar Integration
- Phase 9: Scan Automation & Delta Processing

## Pipeline Architecture (updated 2026-03-31)

```
Interview finalize / Dashboard "Scan Emails"
  → ScanJob created (PENDING)
  → Smart Discovery: broad scan → social graph → body sampling → AI queries
  → Shared WHO "from:" queries (ungrouped people)
  → discovery.ts finds Gmail messages (hybrid: hypothesis + AI-generated queries)
  → emits scan.emails.discovered

fanOutExtraction (concurrency: 1/schema)
  → splits into batches of 20
  → emits extraction.batch.process per batch

extractBatch (concurrency: 3/schema, retries: 3)
  → Gemini extracts summary/tags/entities per email (body capped 8000 chars)
  → Time-neutral summaries enforced (absolute dates only)
  → Signature noise filtered from entity detection
  → Holistic relevance scoring (threshold 0.4)
  → Content-first entity routing:
    1. Gemini relevanceEntity → match known PRIMARY
    2. Subject/summary scan → match known PRIMARY names + aliases
    3. Gemini detectedEntities → match known entities
    4. Sender match (last resort, only 1:1 WHO↔WHAT pairings)
  → emits extraction.batch.completed

checkExtractionComplete (concurrency: 1/schema)
  → updates tag frequencies
  → emits extraction.all.completed

runCoarseClustering (concurrency: 1/schema, retries: 2)
  → Pass 1: Gravity model groups by entity + tag + subject + sender affinity
  → Tag scoring: Jaccard similarity of extracted tag sets (tagMatchScore=15)
  → Writes alternativeCaseId (second-best match) to Email records
  → emits coarse.clustering.completed

runCaseSplitting (concurrency: 1/schema, retries: 2)
  → Pass 2: AI or deterministic case splitting by topic
  → Deletes coarse cases, creates split replacements
  → emits clustering.completed

runSynthesis (concurrency: 2/schema, retries: 2)
  → Loads ALL OPEN cases for schema (not from cluster refs)
  → Claude enriches each case: title, summary, tags, actor, actions, urgency, emoji, mood
  → Capped at 30 most recent emails per case
  → Time-neutral summaries + action titles with absolute dates
  → Event end times extracted when duration specified
  → Passes explicit today to synthesis prompt for date-aware urgency
  → Post-synthesis: computeCaseDecay expires past actions, recalculates urgency (all action types)
  → Writes nextActionDate (MIN of PENDING action dates) for feed sorting
  → IRRELEVANT cases auto-resolved
  → action dedup via fingerprinting
  → Schema ONBOARDING → ACTIVE transition
  → ScanJob → COMPLETED
  → emits synthesis.case.completed per case

runClusteringCalibration (concurrency: 1/schema, retries: 1)
  → Reads user corrections (enriched with case titles), adjusts params + vocabulary
  → Only runs in CALIBRATING or TRACKING phases
  → Real frequency tables computed from case emails
  → Parameter bounds enforced (prompt + service clamping)
  → Zero-correction first run: builds vocabulary only, no parameter drift
  → Learning loop active in CALIBRATING/TRACKING phases

resynthesizeOnFeedback (concurrency: 2/schema, retries: 2)
  → Triggered by feedback.case.modified events
  → Re-synthesizes affected case after email move or other corrections

dailyStatusDecay (cron: 6 AM ET daily)
  → Expires past PENDING actions, recalculates urgency tiers
  → Resolves cases with no remaining PENDING actions
  → Updates nextActionDate for feed sorting
  → Zero AI calls — pure deterministic logic via computeCaseDecay

dailyQualitySnapshot (cron: midnight daily)
  → Computes QualitySnapshot for all ACTIVE schemas
  → 30-day rolling accuracy, phase transitions
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

## AI Pipeline Audit Fixes (2026-03-24, commit d844bd6) — ALL RESOLVED

All 4 original HIGH/MEDIUM audit issues from `docs/ai-call-audit.md` are fixed:

1. ✅ **Today's date → Extraction prompt** — Gemini can now assess temporal relevance
2. ✅ **Today's date → Case Splitting prompt** — Claude distinguishes past vs upcoming events
3. ✅ **Zod parser → Discovery Intelligence** — Full Zod validation, no more raw JSON.parse
4. ✅ **Real frequency tables → Calibration** — Word frequencies computed from case emails with case assignment info
5. ✅ **Emoji → Synthesis output** — `Case.emoji` field, AI assigns thematic emoji
6. ✅ **Mood → Synthesis output** — `Case.mood` field (CELEBRATORY/POSITIVE/NEUTRAL/URGENT/NEGATIVE) — prompt+parser+service wired 2026-03-31

All remaining issues from `docs/ai-call-audit.md` resolved on 2026-03-31: time-neutral language (extraction + synthesis), post-synthesis expiry (all action types via computeCaseDecay), status decay (daily cron + read-time freshness), body truncation (8000 chars), email cap (30 per synthesis), signature noise filtering, calibration parameter bounds.

## UX Redesign Plan (2026-03-30)

Full plan documented in `docs/ux-redesign-plan.md`. Screen briefs in `docs/stitch-screen-briefs.md` (29 screens). Data flow analysis in `docs/screen-schema-flow.md`.

Key decisions:
- **Terminology**: "Topic" (not Schema/Channel)
- **Routing**: `/` smart redirects returning users to `/feed` (zero clicks)
- **Unified feed**: All topics in one view, sorted by urgency (Inner Circle → Imminent → This Week → Upcoming)
- **Mobile-first**: Bottom nav (Feed / + Note / Settings), shared components with Chrome extension
- **Deterministic status decay**: Cases auto-update as time passes without AI calls
- **Onboarding**: Category → Names+People → Goals → Subscribe+Connect → Scanning → Review (6 steps)
- **Design collaboration**: Stitch by Google → DESIGN.md + screenshots → Claude Code implements

### Status (updated 2026-04-07)
- **Phase 0**: ✅ Complete (AI audit fixes, emoji, mood, time-neutral directives, expiry scope, computeCaseDecay, daily cron)
- **Pre-Phase 1**: ✅ Complete — all code fixes done except schema additions (UserNote, billing fields)
- **Wave 1 (Onboarding)**: ✅ Complete — 5-step flow under `/onboarding/*`, sessionStorage state
- **Wave 2 (Feed + Detail)**: ✅ Complete (commit `e39bc61`) — cross-topic feed, bottom nav, 5-line cards, case detail
- **Wave 3 (Settings + Cleanup)**: ✅ Complete (commit `6e02ea5`) — settings hub, topic list, -2,381 lines of legacy code
- **Onboarding Connect Fix**: ✅ Complete (commit `8ad1d56`) — three bugs blocking schema creation resolved
- **Phase 4** (Notes, Account, Topic Edit): Pending — needs schema additions first
- **Phase 5** (Calendar, Polish): Pending

## Clustering Intelligence Experiment & Tag Scoring (2026-04-01)

### Problem
The gravity model produced zero MERGE decisions for non-threaded emails (e.g., TeamSnap notifications where each practice creates a new Gmail thread). A schema with 50 soccer emails produced 39 separate cases instead of ~3. The model relied only on threadId, subject Jaro-Winkler similarity, and sender entity — none of which could merge non-threaded emails with different subjects.

### Experiment
Built test scripts to compare three approaches against Claude's ideal groupings:
- **Set A**: Gravity model with default params (baseline)
- **Set B**: Claude reads all emails, suggests ideal groups (gold standard)
- **Set C**: Gravity model with Claude-suggested parameter overrides
- **Set D**: Gravity model with new tag scoring (Jaccard similarity of extracted tag sets)

Tested across 7 schemas (5 school_parent, 2 property), 50-170 emails each.

### Results
- **AI parameter tuning (Set C) adds marginal value** — improved 1 of 7 schemas, hurt 2, no effect on 4. Claude can't meaningfully reason about Jaro-Winkler thresholds.
- **Tag scoring (Set D) helps when gravity model was completely failing** — three schemas went from 39/45/41 cases to 18/21/16 cases (+12.9pp, +4.7pp, +4.1pp agreement with AI)
- **Tag scoring slightly over-merges when model was already working** — two schemas got -8.7pp and -3.3pp from shared generic tags like "Schedule"
- **Property schemas unaffected** — tags too generic ("Financial", "Maintenance") across all properties
- **tagMatchScore=15** (not 25) prevents over-merging while still enabling merges in zero-merge cases

Full analysis: `docs/findings-case-merging.md`

### Changes Made

**Engine — new scoring signal:**
- `tagScore()` in `packages/engine/src/clustering/scoring.ts` — Jaccard similarity of tag sets × `tagMatchScore`
- `tagMatchScore: 15` added to `ClusteringConfig` type
- `tags: string[]` added to `ClusterCaseInput` (cases track their tag set)
- `tagScore` added to `ScoreBreakdown` for audit trail
- Gravity model updated: scoring formula includes tag, cases accumulate tags on merge/create

**Prompt fixes (independent of experiment):**
- `packages/ai/src/prompts/clustering-intelligence.ts` — rewritten with actual gravity model formula, `today` param, correct field names, dropped nonexistent `tagMatchScore` output param
- `packages/ai/src/parsers/clustering-intelligence-parser.ts` — fixed `senderAffinityWeight` → `actorAffinityScore`, added `subjectMatchScore` and `timeDecayFreshDays`
- Calibration prompt/parser updated to include `tagMatchScore` as tunable parameter

**Backward compatibility:**
- Existing schemas in DB without `tagMatchScore` in stored JSON config default to 15
- Hypothesis parser default: 15
- Calibration parser default: 15

**Test scripts (diagnostic tools, not pipeline steps):**
- `scripts/test-clustering-intelligence.ts` — runs A/B/C/D comparison, saves to PipelineIntelligence
- `scripts/analyze-ai-groups.ts` — analyzes what features Claude uses to form groups

**Tests:** 92 engine + 32 AI tests passing, web typecheck clean.

### Decision: NOT wiring clustering intelligence into pipeline
The clustering intelligence prompt is useful as a diagnostic tool but not worth the cost/latency as a pipeline step. AI parameter tuning adds marginal value. The real improvement came from discovering that tag scoring was the missing signal — found by analyzing AI grouping features, not by using AI config overrides.

### Gravity Model Scoring Formula (updated)
```
finalScore = (threadScore + subjectScore + tagScore + actorScore) × timeDecay

threadScore:  100 if shares Gmail threadId, else 0
subjectScore: Jaro-Winkler similarity × 20 (0 if < 0.7)
tagScore:     Jaccard tag similarity × 15 (new)
actorScore:   10 if same sender entity, else 0
timeDecay:    1.0 within 60 days, linear decay to 0.2 at 365 days
mergeThreshold: 35 (school_parent) / 45 (property)
```

## UX Overhaul Complete (2026-04-07)

All 3 waves of the UX overhaul are merged on `feature/ux-overhaul`. The app is now mobile-first with a 5-step onboarding, cross-topic feed, persistent bottom navigation, and settings hub. Old `/interview` and `/dashboard` routes are deleted.

### Wave 1: Onboarding (committed earlier in branch)
5-step guided flow under `/onboarding/*`:
- **O1 Category** (`/onboarding/category`) — pick role/domain from 6 options with Material icons
- **O2 Names** (`/onboarding/names`) — enter "things you track" + "people who email you" with chip input
- **O3 Connect** (`/onboarding/connect`) — Gmail OAuth + auto-trigger schema creation
- **O4 Scanning** (`/onboarding/scanning`) — polling progress with `recentDiscoveries` from schema status
- **O5 Review** (`/onboarding/review`) — confirm entities + topic name, mark schema ACTIVE
- `OnboardingProgress` component (5-dot indicator)
- `onboardingStorage` helper for sessionStorage state across routes

### Wave 2: Feed + Case Detail (commit `e39bc61`)
- **`(authenticated)/layout.tsx`** — wraps protected routes with `BottomNav`
- **`BottomNav`** — fixed bottom nav with Feed / + Note / Settings (Material icons, 44px touch targets)
- **`GET /api/feed`** — cross-topic case query with urgency sorting, `computeCaseDecay` at read time, schema metadata with entity counts
- **Feed page** (`/feed`) — server fetches user avatar, client component handles all filtering
- **Feed components** (`components/feed/`):
  - `FeedHeader` — sticky Denim wordmark + avatar
  - `TopicChips` — scrollable schema chips + entity sub-chips
  - `UrgencySection` — tier label + card group
  - `FeedEmptyState` — 3 variants (processing, caught-up, no-topics)
  - `FeedClient` — main client component with instant client-side filtering by schema/entity
- **Case detail** (`/feed/[caseId]`) — server component, ownership verified via schema → user chain, no schemaId in URL
- **5-line CaseCard rewrite** — emoji + entity name + mood, title, `DomainContextLine`, top action + "+N more", date range
- **`DomainContextLine`** — domain-aware (school events, property payments, fallback dates)

### Wave 3: Settings + Cleanup (commit `6e02ea5`)
- **Settings hub** (`/settings`) — My Topics / Add a Topic / Account links
- **My Topics** (`/settings/topics`) — lists all schemas with entity/case/email counts and ACTIVE/ONBOARDING status badges
- **Old routes deleted**: `/interview/*`, `/dashboard/*` (5 page files)
- **Orphaned components removed**: `MetricBar`, `ClusteringDebug`, `Card3Scan`
- **Unused hooks removed**: `useInterviewFlow`, `useInterviewScan`
- **Dashboard components removed**: `scan-progress`, `scan-trigger`, `schema-card`, `schema-card-list`
- **Net cleanup**: -2,381 lines of legacy UI code

### Onboarding Connect Fix (commit `8ad1d56`)
Three bugs were blocking the simplified onboarding from creating a schema:

1. **Wrong session check** — Connect page checked `session.provider_token` to detect returning OAuth, but `provider_token` is not stored in cookie-based SSR sessions after PKCE code exchange. Switched to `session.user`, which works for both fresh OAuth returns and already-authenticated users adding a topic.

2. **Validation rejected empty arrays** — `InterviewInputSchema` required `groups.min(1)` and `goals.min(1)`. The simplified onboarding doesn't ask for these (groups derived from `whats`, goals derived from domain). Made both optional with `.default([])`. Added `customDescription` field for the "Something else" category.

3. **Hypothesis route only generated JSON** — `/api/interview/hypothesis` previously called `generateHypothesis()` and returned the JSON without persisting a `CaseSchema`. The simplified onboarding has no separate finalize step, so the client had no `schemaId` to navigate to scanning. Restructured the route to also call `finalizeSchema` (with empty validation/confirmations) and trigger the discovery + extraction pipeline (matching the old `/api/interview/finalize` route's behavior). Now returns `{ data: { schemaId } }`.

4. **React Strict Mode aborted in-flight fetch** — Removed the `AbortController` cleanup in the connect page's `useEffect`. Strict Mode double-invokes effects in dev, aborting the in-flight fetch on the first cleanup. The second run then sees `hypothesisCalledRef.current === true` and bails early. The ref guard alone is sufficient to prevent duplicate calls.

### E2E Verification (Playwright + Supabase admin OTP)
Used Supabase admin API to generate OTP and verify session via JS, then drove the full flow with Playwright:

- ✅ Onboarding category → names → connect → scanning (full pipeline triggers)
- ✅ Feed page renders 8 schemas, urgency sections, 5-line cards
- ✅ Topic chip filtering (instant, client-side)
- ✅ Entity sub-chips appear on schema selection
- ✅ Case detail page with summary, actions, emails, "← Feed" back link
- ✅ Bottom nav present on all authenticated pages
- ✅ Settings hub + My Topics page with status badges
- ✅ Old routes return 404: `/interview`, `/dashboard`
- ✅ Typecheck clean, 133 unit tests passing across all packages

Screenshots: `feed-page.png`, `feed-filtered.png`, `case-detail.png`, `settings-hub.png`, `topics-list.png`, `scanning-active.png`

## Core Pipeline Quality Assessment (2026-04-01)

### What's working well
- **Entity routing**: 100% in recent tests — every email gets assigned to the correct entity
- **Threaded email merging**: threadMatchScore=100 always exceeds threshold, same-thread emails always merge
- **Tag scoring**: New tagMatchScore=15 enables merges for non-threaded emails (TeamSnap, school notifications)
- **Two-pass clustering**: Gravity model (coarse) + AI case splitting (refinement) produces coherent cases
- **Urgency & decay**: Cases auto-update urgency tiers, past actions expire, feed sorts by next action date
- **Synthesis quality**: Good titles, 3-part summaries, action extraction with dedup, mood/emoji
- **Feedback system**: EMAIL_MOVE, THUMBS_UP/DOWN, EMAIL_EXCLUDE all working, re-synthesis on corrections
- **Calibration loop**: Infrastructure exists — discriminator vocabulary, parameter tuning, phase transitions

### Known limitations (acceptable for user testing)
- Gravity model produces more coarse clusters than ideal (15-21 vs Claude's 3-9 ideal). Case splitting bridges most of this gap but we haven't measured final post-split counts.
- Property domain: tags too generic to help clustering. Relies on threading + subject similarity + case splitting.
- Tag scoring slightly over-merges when tags are broadly shared (e.g., "Schedule" on 80% of emails). tagMatchScore=15 mitigates but doesn't eliminate.
- Clustering intelligence (AI parameter tuning) proven to be low-value — not worth the cost/latency.

### Assessment
**The core stack is good enough for real user testing.** The remaining clustering gaps are the kind that can only be discovered and fixed with real user feedback — which is exactly what the calibration loop is designed for. Spending more time tuning the gravity model in isolation has diminishing returns (proven by the clustering intelligence experiment). The next quality signal needs to come from users correcting cases.

## In Progress: Onboarding State Machine Refactor (2026-04-07 → ongoing)

Structural response to Eval Session 1 (#12, #14–#18): rebuilds onboarding as a durable, resumable, observable server-side state machine. `CaseSchema.phase` owns onboarding phases, `ScanJob.phase` owns scan phases, CAS-on-phase for every transition, all counters computed on demand, and a flat polling contract between server and client. Replaces the band-aid fixes that were previously listed as P0 follow-ups.

**Working on `feature/ux-overhaul` (refactor is intentionally coupled to the UX work).** As of 2026-04-08, **13 of 18 tasks are landed** (Phases 0–7 through Task 12):

**Done:**
- Phase 0 — Schema migration, `SchemaPhase` / `ScanTrigger` enums, `ScanFailure` table, dropped counters
- Phase 1 — `computeScanMetrics` / `computeSchemaMetrics` helpers, replaced every denormalized-counter read
- Phase 2 — `advanceSchemaPhase` / `advanceScanPhase` CAS helpers with idempotent skip, CAS-loss detection, `markSchemaFailed` / `markScanFailed` terminal writers
- Phase 3 — `derivePollingResponse` merges the two state machines into the client polling shape
- Phase 4 — Split `finalizeSchema` into `createSchemaStub` + `persistSchemaRelations` + delegating wrapper
- Phase 5 — Wired `advanceScanPhase` into every pipeline transition, `ScanFailure` rows on per-email + whole-batch failures, `firstScanJobId` / `lastScanJobId` on Email create paths, `failed` field dropped from result interfaces
- Phase 6 — `runScan` parent Inngest workflow (Task 8) owns `PENDING → DISCOVERING → EXTRACTING`, short-circuits empty scans, hands off via `scan.emails.discovered`
- Phase 7 so far — `runOnboarding` parent workflow (Task 9) drives schema phases end-to-end with CAS; `POST /api/onboarding/start` (Task 10) is the idempotent session-claim entry point; `GET/POST/DELETE /api/onboarding/[schemaId]` (Task 11) handles polling, review confirmation (CAS-flips `AWAITING_REVIEW → COMPLETED` + `status=ACTIVE` — resolves the deferred status-flip debt), and cancellation (emits `onboarding.session.cancelled`, matched by `runOnboarding.cancelOn`, then flips `status=ARCHIVED`); `POST /api/onboarding/[schemaId]/retry` (Task 12) resumes a FAILED run by parsing the failed phase out of `phaseError` and resetting the schema to that phase — so previously-completed pre-failure steps skip via the CAS index check and only the failed step re-runs, avoiding `persistSchemaRelations` duplicates. `SchemaStatus` enum gained `ARCHIVED`.

**Remaining (5 tasks):**
- Phase 7 — Task 13 (scan management routes — likely also the fix for the Task 12 scan-stage retry limitation)
- Phase 8 — Task 14 (single `OnboardingFlow` switch component driven off the polling phase)
- Phase 9 — Task 15 (delete the old multi-page onboarding routes)
- Phase 10 — Task 16 (end-to-end integration tests via real Inngest dev server)
- Phase 11 — Task 17 (cron stub for stale schemas), Task 18 (full verification + flip status to "complete")

**Canonical progress doc + architecture snapshot + file inventory + deferred-debt list + plan deviations:** see the "Execution Progress" header inside `docs/superpowers/plans/2026-04-07-onboarding-state-machine.md`. It has commit SHAs, a status table for all 18 tasks, a file inventory, and verification routine — I update it in the same commit as each task. All three previously-deferred items (`ScanFailure` writes, the transitional `runSynthesis` status flip, and the `status=ACTIVE` flip on review confirmation) are now **resolved**.

**Next:** Phase 7 / Task 13 — scan management routes at `api/schemas/[id]/scans/` (list + trigger-manual rescan). Likely also the fix for the Task 12 scan-stage retry limitation — giving callers a way to re-run a failed ScanJob independently of the onboarding workflow, so a PROCESSING_SCAN failure can actually recover instead of hitting the 20m waitForEvent timeout.

## What's Next (2026-04-07)

### Immediate: Merge UX Overhaul to Main
- All 3 waves committed on `feature/ux-overhaul`
- Typecheck clean, 133 unit tests passing, E2E verified
- Ready for PR + merge to `main`

### After Merge: Schema Additions
- `UserNote` model — for the "+ Note" button in bottom nav
- `NotificationPreference` model — daily digest opt-in
- `User.stripeCustomerId / subscriptionStatus / trialEndDate` — billing fields

### After Schema Additions: Notes & Polish (UX Phase 4)
- Note creation modal from bottom nav
- Note list view
- Account settings page (currently 404 stub)
- Topic edit page (rename, delete, re-scan)
- Notification preferences UI

### User Testing
- Once merged, gather real-user feedback on the new flow
- Observe user corrections → calibration loop tunes clustering automatically
- Learning loop: gravity model weight adjustment from feedback (not yet built)

### Future Phases
- **Phase 4 polish**: notes, account, topic edit, notifications
- **Phase 5 calendar**: progressive OAuth, CalendarService, Add to Calendar buttons
- **Phase 6B**: Chrome extension + side panel
- **Phase 7.5**: Periodic scanning (automated daily scans)
- **Phase 8**: Calendar integration
- **Phase 9**: Scan automation & delta processing
- Playwright e2e tests for onboarding + feed + case detail (manual E2E done, automated suite next)

See `docs/roadmap.md` for the full feature roadmap beyond UX.

## Developer Workflow Skills (2026-04-02)

Built two user-level Claude Code skills for issue-driven development workflow. These are installed at `~/.claude/skills/` (user-level, not project-specific) and work across any repo with `gh` CLI.

### capture-issue skill (`~/.claude/skills/capture-issue/`)

Rapidly captures ideas, bugs, design decisions, and planned work as GitHub Issues from conversation context. Three modes:

1. **Single Issue** -- "log this", "file an issue", "we should track this"
   - Structured body: Context, Problem/Opportunity, Proposed Approach, Affected Areas, Verification, Related Issues
   - Auto-links to existing open issues via `Related to #N` / `Depends on #N`
   - Extracts context from ongoing conversation -- no re-explaining needed

2. **ADR (Architecture Decision Record)** -- "make an ADR", "document this decision"
   - Creates `docs/adr/NNNN-short-title.md` with Context, Decision, Consequences, Alternatives Considered
   - Creates companion GitHub issue linking to the ADR
   - Reminds to add reference from CLAUDE.md

3. **Plan-to-Issues** -- "turn this plan into issues"
   - Creates 3-5 child issues + 1 parent with checklist
   - Cross-links parent/child relationships
   - Groups plan steps sensibly (doesn't create 30 issues from a long plan)

**Design constraints:** Token-efficient (uses conversation context, doesn't explore codebase), ASCII-only in issue bodies (Windows `gh` CLI mangles Unicode), asks when scope is unclear rather than guessing.

### recall-issues skill (`~/.claude/skills/recall-issues/`)

Pulls open GitHub Issues into conversation for sprint planning and progress tracking. Two-step workflow:

1. **Overview** -- `/issues` or "what's open" shows compact table of open issues
2. **Deep-load** -- "pull up #7" loads full body, comments, linked issues, ADR summaries, parent checklist progress

Also supports adding progress comments to issues during implementation (always drafts for user approval before posting).

Triggered manually -- never auto-loads at session start.

### Eval Results (capture-issue)

Tested with 3 realistic prompts (mid-conversation bug capture, ADR creation, plan-to-issues) comparing with-skill vs no-skill baseline:

| Metric | With Skill | No Skill |
|--------|-----------|----------|
| Assertion pass rate | 100% (19/19) | 63.5% (12/19) |
| Avg tokens | 28,944 | 35,460 |
| Avg time | 77.6s | 89.0s |

Key improvements: consistent issue linking (baseline never linked), ADR Alternatives Considered section (baseline skipped it), CLAUDE.md reminder, structured verification criteria.

### Project-level skills (unchanged, in `.claude/skills/`)
- `run-integration-tests.md` -- runs pipeline integration test suite
- `supabase-db.md` -- DB queries, wipes, and schema operations via pooler URL
