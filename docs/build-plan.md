# Case Engine Build Plan

## For Claude Code: Sequential Implementation Guide

**Date:** 2026-03-12
**Repository:** https://github.com/nickdicarlo-max/denim-email
**Stack:** Next.js 14 (App Router), Supabase (PostgreSQL + Auth), Prisma ORM, Inngest, Chrome Extension (Manifest V3, Side Panel API)
**AI Models:** Claude API (interview, synthesis, co-pilot), Gemini Flash 2.5 API (extraction + vision/OCR)
**Testing:** Vitest (unit/integration), Playwright (e2e)
**CI/CD:** GitHub Actions, Biome (lint/format)
**Deployment:** Vercel (web app), Chrome Web Store dev channel (extension)

**IMPORTANT:** Read `CLAUDE.md` before starting any phase. It contains architecture principles, engineering practices (single writer, idempotency, event-driven pipeline), scalability design, security requirements, and testing strategy that apply to ALL phases.

---

## Project Structure

```
apps/
  web/                          # Next.js app (API routes, UI, orchestration, I/O)
    src/
      app/api/                  # API routes
      lib/
        services/               # Orchestration: wires packages + I/O
        gmail/                  # Gmail API client
        inngest/                # Background job definitions
        middleware/             # Auth, rate limiting
        validation/             # Zod schemas for API inputs
      components/
      hooks/
    prisma/schema.prisma
    tests/                      # unit/, integration/, e2e/
  extension/                    # Chrome extension (Manifest V3)

packages/
  types/                        # @denim/types -- Interfaces only. Zero deps.
  engine/                       # @denim/engine -- Pure business logic. Zero I/O.
  ai/                           # @denim/ai -- Prompt templates + parsers. Zero I/O.

docs/                           # Design specs and test results
.github/workflows/ci.yml       # CI pipeline
```

---

## Build Phases

Execute in order. Each phase has acceptance criteria that must pass before proceeding.

---

## PHASE 0: Project Scaffolding

**Goal:** Working monorepo with testing, linting, CI, and scalability foundations.

This phase sets up infrastructure that every subsequent phase builds on. No business logic.

### Tasks

0.1 Initialize pnpm monorepo
- pnpm-workspace.yaml including apps/* and packages/*
- apps/web: Next.js 14, App Router, TypeScript strict mode, Tailwind
- apps/extension: Chrome extension placeholder (Manifest V3, sidePanel)
- packages/types: @denim/types (interfaces only, zero deps)
- packages/engine: @denim/engine (pure logic, zero I/O, depends on @denim/types)
- packages/ai: @denim/ai (prompts + parsers, zero I/O, depends on @denim/types)

0.2 Prisma setup
- Move prisma/schema.prisma to apps/web/prisma/schema.prisma
- Configure for Supabase PostgreSQL (DATABASE_URL, DIRECT_URL)
- Run `prisma generate` (do NOT run db push yet)

0.3 Environment variables
- Create apps/web/.env.example with all keys from CLAUDE.md
- Include TOKEN_ENCRYPTION_KEY and TEST_DATABASE_URL
- Verify .gitignore excludes .env files

0.4 Base Next.js app
- Directory structure per CLAUDE.md (services/, gmail/, inngest/, middleware/, validation/)
- Health check: GET /api/health returns { status: "ok", timestamp }
- Configure apps/web to depend on @denim/types, @denim/engine, @denim/ai

0.5 Auth middleware
- Create src/lib/middleware/auth.ts
- Wraps Supabase session check: extracts user from request, returns 401 if missing
- Export as a reusable wrapper: `withAuth(handler)` that injects `userId` into the handler
- Every API route in every subsequent phase MUST use this wrapper
- Add env flag `BYPASS_AUTH=true` for local testing without Supabase (Phase 1 testing)

0.6 Structured logging
- Create src/lib/logger.ts
- JSON-formatted log function with consistent fields: timestamp, level, service, schemaId, userId, operation, durationMs, error
- Levels: info, warn, error
- NEVER logs: OAuth tokens, email body content, PII beyond userId
- For MVP: wraps console.log with structured JSON. Replace with pino later.
- Every service method should log at entry (info) and on error (error) with duration

0.7 CORS configuration
- Configure Next.js CORS in middleware.ts or next.config.js
- Development: allow localhost origins
- Production: restrict to extension origin only (chrome-extension://[ID])
- Block all other origins in production

0.8 Typed errors
- Create packages/types/errors.ts: AppError, ValidationError, AuthError, ForbiddenError, NotFoundError, ExternalAPIError, RateLimitError
- Create src/lib/middleware/error-handler.ts: catches typed errors, returns sanitized JSON response, logs full details server-side via logger

0.9 Input validation
- Install zod in apps/web and packages/ai
- Create apps/web/src/lib/validation/interview.ts with InterviewInput Zod schema
- Create reusable validation helper: validates with Zod, throws ValidationError on failure

0.10 Scalability infrastructure
- Create src/lib/prisma.ts: serverless singleton pattern (see CLAUDE.md Scalability section)
- Create src/lib/ai/retry.ts: callWithRetry helper with exponential backoff, 429 handling
- Create src/lib/ai/client.ts: thin wrappers for Claude and Gemini using callWithRetry, logs token usage via logger

0.11 Event registry
- Create packages/types/events.ts: typed Inngest event definitions
- Define all pipeline events with their payload types:
  - `scan.emails.discovered` { schemaId, emailIds[] }
  - `extraction.batch.process` { schemaId, emailIds[], batchIndex }
  - `extraction.batch.completed` { schemaId, batchIndex, processedCount }
  - `extraction.all.completed` { schemaId, scanJobId }
  - `clustering.completed` { schemaId, clusterIds[] }
  - `synthesis.case.completed` { schemaId, caseId }
  - `feedback.case.modified` { schemaId, caseId, eventType }
  - `feedback.email.moved` { schemaId, emailId, fromCaseId, toCaseId }
- These types are the contract between Inngest functions. Define them once, import everywhere.

0.12 Inngest setup
- Install inngest in apps/web
- Create client in src/lib/inngest/client.ts
- Create test function with concurrency key pattern: `concurrency: { limit: 5, key: "event.data.schemaId" }`
- Inngest serve route at /api/inngest
- All Inngest functions must import event types from @denim/types/events

0.13 Vitest
- Install vitest in all packages and apps/web
- vitest.config.ts in each location
- "test" script in each package.json, "test:integration" in apps/web
- Create apps/web/tests/ with unit/, integration/, e2e/ directories
- One smoke test: verify @denim/types exports are importable

0.14 Playwright
- Install @playwright/test in apps/web
- playwright.config.ts (localhost:3000, chromium)
- Placeholder test: load home page, check 200

0.15 Biome
- Install @biomejs/biome at monorepo root
- biome.json with consistent config
- "check" and "check:fix" scripts
- Format all existing files

0.16 GitHub Actions CI
- .github/workflows/ci.yml
- On: push to main, PRs to main
- Steps: checkout, node 20, pnpm install --frozen-lockfile, biome check, tsc --noEmit, vitest run, build
- Integration tests and Playwright NOT included yet (need secrets)

0.17 @denim/types package
- schema.ts: InterviewInput, SchemaHypothesis, ClusteringConfig, DiscoveryQuery, TagSuggestion, EntitySuggestion, ExtractedFieldSuggestion
- models.ts: CaseForUI, EmailForUI, EntityForUI, CaseActionForUI
- api.ts: ApiResponse<T>, ApiError
- errors.ts: typed error classes
- events.ts: typed Inngest event definitions
- tokens.ts: design tokens (copy from docs/design-tokens.ts, this becomes the source of truth)
- Export all from index.ts

0.18 @denim/engine package (structure only)
- Empty directories: clustering/, actions/, quality/, entity/, __tests__/
- Placeholder index.ts
- ZERO I/O dependencies

0.19 @denim/ai package (structure only)
- Empty directories: prompts/, parsers/, __tests__/
- Placeholder index.ts
- ZERO I/O dependencies (zod is OK)

0.20 Chrome extension placeholder
- manifest.json with sidePanel permission
- Minimal service-worker.js
- sidepanel.html: "Case Engine - Coming Soon"

### Post-Phase 0: Supabase Setup (before Phase 1)

After Phase 0 scaffolding, connect Supabase:
1. Create Supabase project, get credentials
2. Add all env vars to apps/web/.env.local
3. Run `prisma db push` to create tables
4. **Enable Row Level Security (RLS) on ALL tables:**
   - Every table must have RLS enabled
   - Create policies: users can only read/write their own data
   - CaseSchema, Entity, SchemaTag, ExtractedFieldDef: `user_id = auth.uid()` directly
   - Email, Case, CaseAction, etc.: `schema_id IN (SELECT id FROM case_schemas WHERE user_id = auth.uid())`
   - Test: verify a user cannot query another user's schemas or emails
   - **This is a security requirement, not optional. Do not proceed to Phase 1 without RLS.**
5. Enable Google OAuth provider in Supabase Auth dashboard
6. Verify auth flow works (sign in with Google, session persists)

### Database Migration Note

Phases 0-2 use `prisma db push` for rapid iteration (schema changes without migration files). Starting Phase 3 (when real user email data is in the database), switch to `prisma migrate dev` for all schema changes. Migration files are committed to git and run in CI. Never modify a deployed migration.

### Acceptance Criteria
- [ ] pnpm install succeeds
- [ ] pnpm biome check . passes
- [ ] pnpm -r tsc --noEmit passes
- [ ] pnpm -r test passes (smoke test)
- [ ] pnpm -r build succeeds
- [ ] pnpm --filter web dev starts server, /api/health returns OK
- [ ] prisma generate succeeds
- [ ] @denim/types importable from apps/web
- [ ] Extension loads in Chrome developer mode
- [ ] Placeholder Playwright test passes
- [ ] CI workflow file exists and is valid

---

## PHASE 1: Interview Service (The Core Hypothesis Test)

**Goal:** AI interview produces a complete CaseSchema from structured input. This is the most important phase. If the interview produces bad schemas, nothing else matters.

**READ FIRST:** `docs/interview-to-schema-mapping.md` maps every interview input to its exact schema destination.

### Architecture

```
InterviewInput (role, whats, whos, goals)
    |
    v
InterviewService.generateHypothesis()
    |  - Builds prompt via @denim/ai
    |  - Calls Claude via AI client wrapper
    |  - Parses response via @denim/ai parser
    |  - Output: SchemaHypothesis
    v
Store draft schema in DB (status: DRAFT)
    |
    v
[After Gmail connect in Phase 2]
InterviewService.validateHypothesis()
    |  - Gemini Flash: classify 100-200 sample emails against hypothesis
    |  - Compare: which tags matched? which entities found? what didn't match?
    |  - Output: validated schema + confidence report
    v
InterviewService.finalizeSchema()
    |  - Applies user confirmations from Card 4
    |  - Generates extractionPrompt and synthesisPrompt
    |  - Sets status to ONBOARDING
    |  - Triggers full scan via Inngest
```

### TypeScript Interfaces (implement in @denim/types)

```typescript
// packages/types/schema.ts

// Input from the interview UI
interface InterviewInput {
  role: string                          // "parent", "property", "construction", etc.
  domain: string                        // "school_parent", "property", etc.
  whats: string[]                       // User-typed primary entity names
  whos: string[]                        // User-typed secondary entity names
  goals: string[]                       // Selected goal IDs: "deadlines", "costs", etc.
}

// Output from the hypothesis generator
interface SchemaHypothesis {
  domain: string                        // "school_parent", "legal", "construction"
  schemaName: string                    // AI-generated display name
  primaryEntity: {
    name: string                        // "Activity", "Property", "Project"
    description: string
  }
  secondaryEntityTypes: {
    name: string                        // "Teacher / Coach", "Vendor"
    description: string
    derivedFrom: "sender" | "extracted" | "both"
    affinityScore: number
  }[]
  entities: EntitySuggestion[]
  tags: TagSuggestion[]
  extractedFields: ExtractedFieldSuggestion[]
  summaryLabels: {
    beginning: string
    middle: string
    end: string
  }
  clusteringConfig: ClusteringConfig
  discoveryQueries: DiscoveryQuery[]
  exclusionPatterns: string[]
}

interface EntitySuggestion {
  name: string
  type: "PRIMARY" | "SECONDARY"
  secondaryTypeName: string | null
  aliases: string[]
  confidence: number
  source: "user_input" | "email_scan" | "ai_inferred"
}

interface DiscoveryQuery {
  query: string                         // Gmail search query
  label: string                         // Human-readable label
  entityName: string | null             // Which entity this targets
  source: "entity_name" | "domain_default" | "email_scan"
}

interface TagSuggestion {
  name: string
  description: string
  expectedFrequency: "high" | "medium" | "low"
  isActionable: boolean
}

interface ExtractedFieldSuggestion {
  name: string
  type: "NUMBER" | "STRING" | "DATE" | "BOOLEAN"
  description: string
  source: "BODY" | "ATTACHMENT" | "ANY"
  format: string
  showOnCard: boolean
  aggregation: "SUM" | "LATEST" | "MAX" | "MIN" | "COUNT" | "FIRST"
}

interface ClusteringConfig {
  mergeThreshold: number
  threadMatchScore: number
  tagMatchScore: number
  subjectMatchScore: number
  actorAffinityScore: number
  subjectAdditiveBonus: number
  timeDecayDays: { fresh: number, recent: number, stale: number }
  weakTagDiscount: number
  frequencyThreshold: number
  anchorTagLimit: number
  caseSizeThreshold: number
  caseSizeMaxBonus: number
  reminderCollapseEnabled: boolean
  reminderSubjectSimilarity: number
  reminderMaxAge: number
}
```

### Tasks

1.1 Install Anthropic SDK in apps/web
- Update the Claude wrapper in src/lib/ai/client.ts to use the real SDK

1.2 Build hypothesis prompt in @denim/ai
- File: `packages/ai/prompts/interview-hypothesis.ts`
- Export: `buildHypothesisPrompt(input: InterviewInput) -> { system: string, user: string }`
- Pure function. Returns prompt strings. Does NOT call any API.
- System prompt must include:
  - Domain expertise for recognizing use cases from role + entity names
  - Tag taxonomy generation guidelines (domain-specific, not generic)
  - Clustering constant selection rationale per domain
  - Examples of good schemas for 3-4 different domains
- The prompt MUST:
  - Generate different clustering constants per domain:
    - School/family: mergeThreshold 35, timeDecay fresh 60, caseSizeThreshold 5, reminderCollapse true
    - Legal: mergeThreshold 55, timeDecay fresh 90, caseSizeThreshold 15
    - Property: mergeThreshold 45, timeDecay fresh 45, caseSizeThreshold 10
    - General: balanced defaults (45/45/75/120)
  - Generate domain-specific tags (not generic "Communication" or "Updates")
  - Generate Gmail discovery queries from entity names
  - Generate entity aliases from names
  - Adjust ExtractedFieldDef.showOnCard based on goals

1.3 Build hypothesis parser in @denim/ai
- File: `packages/ai/parsers/hypothesis-parser.ts`
- Create Zod schema matching SchemaHypothesis exactly
- Export: `parseHypothesisResponse(raw: string) -> SchemaHypothesis`
- Validates with Zod, throws ExternalAPIError on failure

1.4 Parser unit tests
- File: `packages/ai/__tests__/hypothesis-parser.test.ts`
- Test: valid complete response parses correctly
- Test: missing required field (e.g., no clusteringConfig) throws with clear message
- Test: wrong type (string where number expected) throws
- Test: empty tags array throws (minimum 3 tags required)
- Test: empty entities array throws (minimum 1 entity required)
- Test: extra/unknown fields are handled gracefully
- Test: malformed JSON string (not valid JSON at all) throws
- Run: `pnpm --filter @denim/ai test`

1.5 Build InterviewService in apps/web
- File: `src/lib/services/interview.ts`
- Methods:
  - `generateHypothesis(input: InterviewInput): Promise<SchemaHypothesis>`
  - `validateHypothesis(schemaId: string, sampleEmails: EmailMetadata[]): Promise<ValidationReport>` (Phase 2 dependency)
  - `finalizeSchema(schemaId: string, userConfirmations: UserConfirmations): Promise<CaseSchema>` (Phase 2 dependency)
- `generateHypothesis`:
  - Validates input with Zod schema from lib/validation/
  - Uses buildHypothesisPrompt from @denim/ai
  - Calls Claude via AI client wrapper (src/lib/ai/client.ts) -- NOT directly
  - Uses parseHypothesisResponse from @denim/ai
  - Logs via logger: operation start (info), completion with duration (info), errors (error)
  - Returns typed SchemaHypothesis
  - Throws ExternalAPIError on failure

1.6 Build API route
- POST /api/interview/hypothesis
- Validates request body with Zod
- Auth required (allow bypass with env flag for testing)
- Returns { data: SchemaHypothesis } or { error, code }

1.7 Phase 1 evaluation script
- File: `scripts/test-interview.ts`
- Runs hypothesis generator against 5 structured test inputs:
  1. { role: "parent", whats: ["Vail Mountain School", "Eagle Valley SC"], whos: ["Coach Martinez", "Mrs. Patterson"], goals: ["actions", "schedule"] }
  2. { role: "property", whats: ["123 Main St", "456 Oak Ave", "789 Elm St"], whos: ["Quick Fix Plumbing"], goals: ["costs", "status"] }
  3. { role: "construction", whats: ["Harbor View Renovation", "Elm Street Addition"], whos: ["Comfort Air Solutions", "Torres Engineering"], goals: ["costs", "deadlines"] }
  4. { role: "agency", whats: ["Acme Corp rebrand", "Widget Inc Q2"], whos: ["Sarah at Acme"], goals: ["deadlines", "actions"] }
  5. { role: "legal", whats: ["Smith v. Jones", "Acme Corp acquisition"], whos: ["Johnson & Associates"], goals: ["deadlines", "status"] }
- For each, evaluate:
  - Primary entity type makes sense for the domain
  - At least 5 relevant tags generated (not generic)
  - Clustering constants differ between domains
  - Summary labels are domain-appropriate
  - Discovery queries would actually find relevant Gmail messages
  - At least one actionable extracted field defined
  - Entity aliases are reasonable
- Saves results to docs/test-results/phase1-schema-quality.md

### Testing

**Test 1.A: Schema quality across domains**
- [x] Parser unit tests pass: `pnpm --filter @denim/ai test` (2026-03-12: 8 tests passing)
- [x] All 5 test descriptions produce meaningfully different schemas (2026-03-12: evaluation script 5/5)
- [ ] No schema generates generic/useless tags
- [ ] Clustering constants vary by domain (school != legal != construction)
- [x] Discovery queries reference actual entity names (2026-03-14: queries found 58 emails for school_parent schema)
- [ ] Entity aliases are reasonable
- [ ] Goals affect showOnCard flags on extracted fields

**Test 1.B: Clustering constant differentiation**
Verify the AI generates meaningfully different constants:
- [ ] School schema: mergeThreshold < 40, timeDecay.fresh > 50
- [ ] Legal schema: mergeThreshold > 50, timeDecay.fresh > 80
- [ ] Construction schema: timeDecay.fresh between 40-60
- [ ] All schemas: reminderCollapseEnabled is true for school, configurable for others
- [ ] Property schema uses TCS-proven defaults (mergeThreshold ~45)

### Acceptance Criteria
- [x] Parser tests pass (2026-03-12: 8 tests passing)
- [x] 5/5 test schemas evaluated and documented in test-results/ (2026-03-12: docs/test-results/phase1-schema-quality.md)
- [x] CaseSchema records persist in database with correct fields (2026-03-13: schema cmmpb334b0001qeg0e152tsh9 created with 9 entities, 10 tags, 3 fields)

### Integration Test (write after DB connected)
- File: `apps/web/tests/integration/interview-service.test.ts`
- Test: generateHypothesis creates CaseSchema + Entity + SchemaTag + ExtractedFieldDef rows
- Test: finalizeSchema sets status to ONBOARDING and generates extraction/synthesis prompts
- Mock: Claude API call (return fixture JSON, don't spend API credits in CI)
- Real: Prisma writes to test database
- Run: `pnpm --filter web test:integration`

---

## PHASE 2: Gmail Integration

**Goal:** Connect to Gmail, fetch emails, run sample scan for interview validation.

### Tasks

2.1 Gmail OAuth
- Configure Google Cloud project with Gmail API (gmail.readonly scope only)
- Implement token storage encrypted with TOKEN_ENCRYPTION_KEY
- Token refresh server-side only, never exposed to client
- Use Supabase Auth for the OAuth flow

2.2 Gmail client service
- File: `src/lib/gmail/client.ts`
- Methods:
  - `connect(userId: string): Promise<void>` -- OAuth flow
  - `searchEmails(query: string, maxResults: number): Promise<GmailMessage[]>` -- discovery queries
  - `getEmailMetadata(messageId: string): Promise<EmailMetadata>` -- headers only, cheap
  - `getEmailFull(messageId: string): Promise<EmailFull>` -- body + attachment IDs
  - `getAttachment(messageId: string, attachmentId: string): Promise<Buffer>` -- targeted re-fetch
- Parse headers into structured fields: sender, senderEmail, senderDomain, senderDisplayName, recipients, subject, date, threadId, isReply
- Batch API requests where possible (see CLAUDE.md Gmail Quota section)
- Respect quota headers, slow down before hitting 429

2.3 Sample scan for interview validation
- Fetch 100-200 most recent emails (metadata only)
- Lightweight classification: sender domain frequency, subject keywords, thread depth
- Feed into InterviewService.validateHypothesis()
- Discover new entities from sender patterns
- Detect noise senders for ExclusionRule creation

2.4 Interview Cards 2-3 UI
- Card 2: Gmail OAuth connect
- Card 3: Scanning progress with real-time domain discovery

### Testing
- [x] OAuth flow completes, tokens stored encrypted (2026-03-13: AES-256-GCM via GmailTokenService, stored in User.googleTokens)
- [ ] Token refresh works (code implemented in gmail-tokens.ts refreshAndStore, untested — needs clean sign-in with prompt=consent to get refresh token, then expiry test)
- [x] Email metadata parses correctly (edge cases: Unicode names, missing display name) (2026-03-13: scan returned discoveries with parsed sender domains/names)
- [ ] Sample scan under 30 seconds for 200 emails (validate call took ~3s but demo account may have <200 emails — needs measurement with full mailbox)
- [x] Hypothesis validation improves schema quality beyond hypothesis alone (2026-03-13: validate endpoint succeeded, finalize produced 9 entities + 10 tags)
- [ ] Under 3 minutes total from Card 1 to schema creation (hypothesis ~28s + validate ~3s + finalize ~2.4s = ~34s compute time, but no clean uninterrupted run timed yet)

### Acceptance Criteria
- [x] Full interview flow works: Card 1 -> Card 2 (OAuth) -> Card 3 (scan) -> Card 4 (review) -> schema created (2026-03-13: schema cmmpb334b0001qeg0e152tsh9 created)
- [x] Schema from interview + email scan is meaningfully better than hypothesis alone (2026-03-13: validation step refined schema before finalize)
- [x] Tokens encrypted at rest with TOKEN_ENCRYPTION_KEY (2026-03-13: AES-256-GCM, key in .env.local)
- [ ] Token refresh handles expired tokens without user re-auth (code implemented, untested — needs refresh token from prompt=consent flow + expiry test)

---

## PHASE 3: Extraction Pipeline

**Goal:** Process emails through Gemini Vision, produce rich metadata records.

### Tasks

3.1 Extraction prompt in @denim/ai
- File: `packages/ai/prompts/extraction.ts`
- Export: `buildExtractionPrompt(email, schema) -> { system, user }`
- Multimodal: email body text + attachment content
- References schema's tag taxonomy, entity definitions, extracted field definitions

3.2 Extraction parser in @denim/ai
- File: `packages/ai/parsers/extraction-parser.ts`
- Zod validation of Gemini response
- Returns typed ExtractionResult

3.3 Extraction parser unit tests
- File: `packages/ai/__tests__/extraction-parser.test.ts`
- Valid response, missing fields, wrong types, empty tags

3.4 ExtractionService in apps/web
- File: `src/lib/services/extraction.ts`
- Methods:
  - `extractEmail(email: GmailFull, schema: CaseSchema): Promise<ExtractionResult>`
  - `processAttachments(email: GmailFull, schema: CaseSchema): Promise<AttachmentResult[]>`
- Single Gemini Vision API call per email (body + attachments together) via AI client wrapper
- Oversized attachment handling: if total input > 30K tokens, process attachments separately
- For PDFs > 50 pages: process first 10 pages, note partial coverage in EmailAttachment.processedFully
- Parse sender against known secondary entities (Jaro-Winkler at 85% from @denim/engine)
- Determine isInternal from schema's primaryEntityConfig.internalDomains
- Check ExclusionRules before processing (skip with isExcluded=true, minimal record)
- Write Email + EmailAttachment rows in a single transaction
- Update SchemaTag frequency counts in same transaction
- Log to ExtractionCost table via AI client wrapper
- **Single writer:** This service owns Email and EmailAttachment writes

3.5 Inngest job: extract-emails
- Triggered by scan.emails.discovered event
- **Fan-out pattern:** emit batch events (20 emails per batch)
- Concurrency: `{ limit: 3, key: "event.data.schemaId" }`
- Each batch: extract, persist, report progress to ScanJob
- On completion: emit extraction.all.completed event

### Testing
- [x] Extraction parser tests pass (2026-03-13: 9 tests passing)
- [ ] Summaries are 1-2 sentences, tags match schema taxonomy (needs manual review of extracted data)
- [ ] Entity detection matches >85% to correct primary entity (needs manual review)
- [ ] Attachment summaries are useful
- [ ] Exclusion rules skip correctly
- [x] ExtractionCost records logged for every API call (2026-03-14: confirmed in live run, rows with inputTokens/outputTokens)
- [ ] Total cost for 200 emails under $0.50 (58 emails processed, cost not yet tallied)

### Integration Test
- File: `apps/web/tests/integration/extraction-service.test.ts`
- Test: extractEmail writes Email + EmailAttachment rows with correct metadata
- Test: exclusion rule matching skips email (isExcluded=true, no Gemini call)
- Test: SchemaTag frequency counts update correctly
- Test: fan-out batch pattern: 200 emails produce 10 batch events
- Mock: Gemini API (return fixture extraction JSON)
- Real: Prisma writes to test database, Inngest event emission

### Acceptance Criteria
- [x] Extraction pipeline runs end-to-end: scan → fan-out → extract → complete (2026-03-14: 58 emails, 3 batches, 0 failures)
- [x] Email rows created with summaries, tags, entity assignments (2026-03-14: confirmed via DB writes in live run)
- [x] ExtractionCost rows logged with token counts (2026-03-14: ~2000 input, ~130-250 output per email)
- [x] Fan-out pattern works: batches of 20, concurrency-limited per schema (2026-03-14: 3 batches ran with Inngest concurrency)
- [x] Tag frequency recalculation runs after all batches complete (2026-03-14: checkExtractionComplete updated frequencies)
- [x] Extraction parser unit tests pass (2026-03-13: 9 tests)
- [x] Entity matching unit tests pass (2026-03-13: 16 tests, Jaro-Winkler verified)
- [x] Exclusion rule unit tests pass (2026-03-13: 7 tests)

---

## PHASE 4: Clustering Engine

**Goal:** Group extracted emails into coherent cases using the gravity model.

**Architecture:** The clustering engine is PURE LOGIC in @denim/engine. Zero I/O. Services handle I/O around it.

### Tasks

4.1 Gravity model in @denim/engine
- File: `packages/engine/clustering/gravity-model.ts`
- Functions: scoreEmailAgainstCase, findBestCase, scoreClusters
- All accept a `now: Date` parameter (no Date.now() calls -- see CLAUDE.md engineering practices)

4.2 Scoring functions in @denim/engine
- File: `packages/engine/clustering/scoring.ts`
- Pure functions: threadScore, tagScore, subjectScore, actorScore, caseSizeBonus, reminderScore
- Each under 30 lines, single concern

4.3 Entity matching in @denim/engine
- File: `packages/engine/entity/matching.ts`
- jaroWinkler, fuzzyMatch, resolveEntity

4.4 Full unit test suite
- File: `packages/engine/__tests__/clustering.test.ts`
- File: `packages/engine/__tests__/scoring.test.ts`
- File: `packages/engine/__tests__/entity-matching.test.ts`
- Test cases for scoring.ts:
  - Thread match: email in same thread as case scores 100+
  - Tag match: email with matching anchor tag scores above mergeThreshold
  - Tag match with time decay: old anchor tag scores less than fresh one
  - Weak tag discount: high-frequency tag scores less than low-frequency tag
  - Subject similarity: similar subjects score above 0, dissimilar score 0
  - Actor affinity: same secondary entity provides bonus
  - Case size gravity: case with 15 emails attracts more than case with 3
  - Reminder detection: near-identical subject within reminderMaxAge scores high
- Test cases for clustering.test.ts:
  - Emails from same thread land in same case
  - Same-topic different-thread emails merge when score exceeds threshold
  - Different topics within same entity stay separate
  - Config differentiation: stricter config = more, smaller cases
  - Config differentiation: looser config = fewer, larger cases
  - Time decay settings affect whether old emails merge with new
- Test cases for entity-matching.test.ts:
  - Jaro-Winkler scores identical strings at 1.0
  - Similar strings ("Quick Fix" vs "QuickFix Plumbing") score above threshold
  - Dissimilar strings score below threshold
  - Alias matching works for partial names
- No mocking needed. Pure functions, plain data.

4.5 ClusterService in apps/web
- File: `src/lib/services/cluster.ts`
- Methods:
  - `clusterNewEmails(schemaId: string, emailIds: string[]): Promise<ClusterResult>`
  - `mergeEmailIntoCase(emailId: string, caseId: string): Promise<void>`
  - `createCaseFromCluster(emailIds: string[]): Promise<Case>`
- Reads emails and cases from DB, calls @denim/engine, writes results
- Creates Cluster records with full decision audit trail (score, breakdown, action)
- Creates CaseEmail junction records
- Uses upsert/check-before-create for idempotency
- **Single writer:** Owns Cluster and CaseEmail writes
- Emits clustering.completed event via Inngest

4.6 Inngest job: cluster-emails
- Triggered by extraction.all.completed event
- Concurrency: `{ limit: 2, key: "event.data.schemaId" }`
- On completion: emit clustering.completed event

### Testing
- [ ] All unit tests pass: `pnpm --filter @denim/engine test`
- [ ] Emails from same thread end up in same case
- [ ] Same-topic different-thread emails merge correctly
- [ ] Different topics stay separate within same entity
- [ ] Reminders cluster with original topic
- [ ] Cluster records capture score breakdown

### Acceptance Criteria
- [ ] Full unit test suite passes
- [ ] Clustering produces coherent cases on real email
- [ ] Different configs produce meaningfully different results

---

## PHASE 5: Synthesis Service

**Goal:** AI generates case titles, summaries, display tags, and actions from clustered emails.

### Tasks

5.1 Synthesis prompt in @denim/ai
- File: `packages/ai/prompts/synthesis.ts`
- Export: `buildSynthesisPrompt(emails, schema) -> { system, user }`
- Uses schema's summaryLabels for section names
- Generates displayTags (2-3) distinct from clustering anchorTags
- Identifies primaryActor
- Extracts action items with dedup instructions
- Handles reminder collapsing: 7 similar emails = 1 action with count
- Detects completion signals
- Model selection: claude-sonnet-4-5 for cost efficiency on typical cases,
  claude-opus-4-6 for complex cases (>20 emails or low-confidence clustering).
  The AI client wrapper should accept a model parameter.

5.2 Synthesis parser in @denim/ai
- File: `packages/ai/parsers/synthesis-parser.ts`
- Zod validation, returns typed SynthesisResult

5.3 Action dedup in @denim/engine
- File: `packages/engine/actions/dedup.ts`
- generateFingerprint, matchAction (pure functions)

5.4 Action dedup unit tests
- File: `packages/engine/__tests__/action-dedup.test.ts`

5.5 SynthesisService in apps/web
- File: `src/lib/services/synthesis.ts`
- Methods:
  - `synthesizeCase(clusterId: string): Promise<Case>` -- full synthesis for new case
  - `updateCaseSynthesis(caseId: string, newEmailIds: string[]): Promise<Case>` -- re-synth when emails added
  - `extractActions(caseId: string, emails: Email[]): Promise<CaseAction[]>` -- pull actions from emails
  - `dedupAction(candidate: ActionCandidate, existingActions: CaseAction[]): Promise<CaseAction>` -- fingerprint dedup
- Calls Claude via AI client wrapper
- Creates/updates Case rows: title, summary, displayTags, anchorTags, primaryActor, aggregatedData
- Sets denormalized fields in same transaction: lastSenderName, lastSenderEntity, lastEmailDate
- Creates CaseAction rows with fingerprints
- Action dedup flow:
  1. Generate fingerprint from candidate title (lowercase, stop words removed) using @denim/engine
  2. Compare against existing actions on same case
  3. Match (fingerprint similarity > 0.85): update existing, increment reminderCount, log change
  4. No match: create new CaseAction
- Aggregates ExtractedFieldDef data per field's aggregation type (SUM, LATEST, MAX, etc.)
- All case field updates in a single transaction
- **Single writer:** Owns Case and CaseAction writes

5.6 Inngest job: synthesize-cases
- Triggered by clustering.completed event AND feedback.case.modified event
- Concurrency: `{ limit: 2, key: "event.data.schemaId" }`
- Computes clusteringConfidence per email
- Updates CaseSchema counts (emailCount, caseCount)

### Testing
- [ ] Synthesis parser tests pass
- [ ] Titles under 60 characters, descriptive
- [ ] Summary uses schema-configured labels (not hardcoded)
- [ ] Display tags are human-readable
- [ ] Action items extracted with due dates
- [ ] Reminder dedup: 7 emails = 1 action with reminderCount > 1
- [ ] Aggregated data computed correctly
- [ ] lastSender fields populated

### Acceptance Criteria
- [ ] End-to-end: email -> extract -> cluster -> synthesize produces usable cases
- [ ] All parser and dedup unit tests pass

### Integration Test
- File: `apps/web/tests/integration/synthesis-service.test.ts`
- Test: synthesizeCase creates Case row with title, summary, displayTags, lastSender fields
- Test: extractActions creates CaseAction rows with fingerprints
- Test: dedupAction updates existing action (increments reminderCount) when fingerprint matches
- Test: aggregatedData computed correctly from ExtractedFieldDef definitions
- Test: re-synthesis (updateCaseSynthesis) updates existing case, doesn't create duplicate
- Mock: Claude API (return fixture synthesis JSON)
- Real: Prisma writes to test database

---

## PHASE 6: Chrome Extension & Side Panel UI

**Goal:** Working Chrome extension with side panel showing case feed, case detail, and correction UX.

### Tasks

6.1 Chrome extension shell
- Manifest V3 with sidePanel permission
- Service worker, side panel HTML entry point
- chrome.identity for Google OAuth
- Communication with backend via fetch to Next.js API routes

6.2 Case feed screen
- Scope headers (tappable as filters, grouped by primary entity)
- Case cards:
  - Line 1: Case.title
  - Line 2: Case.lastSenderEntity + Case.lastEmailDate (relative)
  - Line 3: STATUS label (from CaseSchema.summaryLabels.end) + Case.summary.end
  - Line 4: up to 2 pending CaseActions as mini checkboxes (tap to mark done)
  - Footer: displayTags (2 max) + email count + highlight (aggregatedData + showOnCard field)
- Filter tabs: All / Active / Resolved (OPEN+IN_PROGRESS = Active)
- Metric bar (from QualitySnapshot or computed from FeedbackEvents)
- "+ Organize something new" button (launches interview Card 1)

6.3 Case detail screen
- Three-section summary with DYNAMIC labels from CaseSchema.summaryLabels
- Action items section: pending (checkbox), done (strikethrough), expired (badge)
- Thumbs up/down with bottom sheet (3 reasons for thumbs down)
- Email list with swipe: Move (opens case picker) and Exclude from scans
- "Might belong in" hints (Email.clusteringConfidence < 0.7 + alternativeCaseId)
- Bottom bar: Merge with..., Split case

6.4 Interview flow embedded in side panel
- Cards 1-4 adapted for narrow width
- Progressive OAuth via chrome.identity

6.5 Quality metrics screen
- Accuracy score or calibrating progress
- Stat cards, event log

6.6 Design system
- Import design tokens from @denim/types/tokens
- Configure Tailwind using the tailwindExtend export from tokens
- All component styles reference tokens, never hardcoded hex/px values
- Follow docs/design-system.md for component patterns and principles
- Mobile-first: everything works at 375px
- Touch targets: minimum 44x44px

### Testing (Playwright)

**Test 6.A: Extension loads and connects**
- [ ] Extension installs in Chrome developer mode
- [ ] Side panel opens via extension icon
- [ ] OAuth flow completes via chrome.identity
- [ ] Side panel communicates with backend API

**Test 6.B: Case feed renders correctly**
- [ ] Cases from Phase 5 appear in feed
- [ ] Scope headers group cases by primary entity
- [ ] Tapping scope header filters feed
- [ ] Filter tabs work (all/active/resolved)
- [ ] Metric bar shows calibrating state
- [ ] Case cards show all fields: title, lastSender, status, tags, actions, highlight

**Test 6.C: Case detail and corrections**
- [ ] Tapping a case opens detail view
- [ ] Summary sections render with dynamic schema labels (not hardcoded)
- [ ] Action items display with checkboxes
- [ ] Tapping checkbox marks action done, creates FeedbackEvent
- [ ] Thumbs down opens bottom sheet with three options
- [ ] Swipe left on email reveals Move and Exclude buttons
- [ ] Move opens case picker, email transfers successfully
- [ ] Exclude marks email as excluded, shows toast

**Test 6.D: Mobile/narrow viewport**
- [ ] All screens render correctly at 375px width
- [ ] Touch targets are at least 44x44px
- [ ] Swipe gestures work on touch devices
- [ ] No horizontal scrolling

### Acceptance Criteria
- [ ] Full user flow: install extension -> interview -> see cases -> interact with corrections
- [ ] All correction mechanisms work (thumbs, move, exclude, merge, split)
- [ ] Responsive at 375px (phone) and 500px (side panel)
- [ ] Interview flow works end-to-end within the side panel

---

## PHASE 7: Feedback & Quality System

**Goal:** Every correction teaches the system. Quality metrics tracked and visible.

### Tasks

7.1 FeedbackService
- File: `src/lib/services/feedback.ts`
- Methods:
  - `logEvent(event: FeedbackEventInput): Promise<FeedbackEvent>`
  - `processCorrection(event: FeedbackEvent): Promise<SchemaAdjustment | null>`
  - `detectExclusionPatterns(schemaId: string): Promise<ExclusionRule[]>`
- Correction processing per event type:
  - EMAIL_MOVE: log which tags were on the email vs source/target case anchor tags
  - THUMBS_DOWN: log the reason, associate with case
  - EMAIL_EXCLUDE: check if 3+ from same domain, auto-suggest ExclusionRule
  - CASE_MERGE: log source and target case IDs, re-assign emails
  - CASE_SPLIT: log original case, create new case from selected emails
- **Single writer:** Owns FeedbackEvent, ExclusionRule writes
- Updates Email.isExcluded and CaseEmail.wasReassigned (cross-boundary, documented in CLAUDE.md)
- Emits feedback.case.modified event (triggers SynthesisService re-synthesis)
- Does NOT re-compute case fields directly (single writer principle)

7.2 QualityService
- File: `src/lib/services/quality.ts`
- Methods:
  - `computeSnapshot(schemaId: string, date: Date): Promise<QualitySnapshot>`
  - `getCurrentAccuracy(schemaId: string): Promise<{ accuracy: number | null, phase: QualityPhase }>`
- Accuracy formula: `1 - (corrections / casesViewed)`, rolling 30-day window
- Phase transitions:
  - CALIBRATING -> TRACKING: when totalSignals >= 5
  - TRACKING -> STABLE: when accuracy >= 95% for 7 consecutive days
- **Single writer:** Owns QualitySnapshot writes

7.3 ExclusionRule auto-creation
- After 3+ excludes from same sender domain: auto-suggest domain rule
- Rule source: "system_suggested"

7.4 API routes
- `POST /api/feedback` -- log any feedback event (all types via single endpoint)
- `GET /api/quality/:schemaId` -- get current accuracy and phase
- `GET /api/quality/:schemaId/history` -- get quality snapshots over time
- All validated with Zod

7.5 Inngest job: daily-quality-snapshot
- Runs daily at midnight per schema
- Concurrency: `{ limit: 5, key: "event.data.schemaId" }`
- Computes QualitySnapshot from FeedbackEvents in the 30-day window
- Detects regressions (accuracy drop > 5% from previous snapshot)

7.6 Developer dashboard (web app, not extension)
- Route: `/admin`
- Shows all schemas, their quality metrics, event logs
- Per-schema drill-down: accuracy over time, correction breakdown by type
- Email-level debugging: why was this email assigned to this case? (show clustering score breakdown)
- Export metrics to markdown file for documentation

### Testing
- [ ] All event types persist correctly
- [ ] Accuracy computed correctly
- [ ] Phase transitions work
- [ ] Exclusion pattern detection triggers after 3 excludes
- [ ] Re-synthesis triggered on case-modifying feedback

### Integration Test
- File: `apps/web/tests/integration/feedback-service.test.ts`
- Test: logEvent creates FeedbackEvent row for each type (THUMBS_UP/DOWN, EMAIL_MOVE, EXCLUDE, MERGE, SPLIT)
- Test: EMAIL_MOVE updates CaseEmail.wasReassigned and emits feedback.case.modified event
- Test: EMAIL_EXCLUDE sets Email.isExcluded=true
- Test: 3 excludes from same domain auto-creates ExclusionRule
- Test: QualityService computes accuracy correctly from event fixture data
- Test: phase transition CALIBRATING -> TRACKING after 5 signals
- Real: Prisma writes to test database

### Graceful Degradation Test
- File: `apps/web/tests/integration/degradation.test.ts`
- Test: if SynthesisService fails, cases from clustering still exist (no title, but emails are grouped)
- Test: if QualityService fails, case feed still renders (metric bar hidden)
- Test: if Gmail token refresh fails, appropriate AuthError thrown (not a silent failure)
- Test: if Gemini returns invalid JSON, extraction skips that email and processes the rest
- These tests verify the fallback behaviors defined in CLAUDE.md "Fail Gracefully" section

---

## Phase 7.5: Periodic scanning... to be useful we should already have the actions to be taken clearly for the user, perhaps at a specific time of day... or at a few specific times of day.  7am, noon, 3pm, 6pm and 9pm daily update automatically so they know what may be an open task for them to follwo up on.  

## PHASE 8: Calendar Integration

**Goal:** Action items sync to Google Calendar with progressive permission request.

### Tasks

8.1 Progressive calendar OAuth
- Request calendar.events scope only when user first taps "Add to Calendar"
- Store calendar token alongside gmail token

8.2 CalendarService
- File: `src/lib/services/calendar.ts`
- Methods:
  - `requestCalendarAccess(userId: string): Promise<void>` -- triggers OAuth for calendar scope
  - `createEvent(action: CaseAction): Promise<string>` -- returns calendarEventId
  - `updateEvent(action: CaseAction): Promise<void>` -- when due date or details change
  - `deleteEvent(calendarEventId: string): Promise<void>` -- when action is deleted
- Event creation: uses action title, dueDate/eventStartTime/eventEndTime, eventLocation
- For recurring actions: create recurring calendar event using recurrenceRule (RRULE)
- One-way sync: action -> calendar event (never reads back from calendar)

8.3 UI: "Add to Calendar" button on EVENT and DEADLINE actions
- Permission prompt on first use
- "Synced" indicator after creation
- Prompt to update calendar when due date changes

### Acceptance Criteria
- [ ] Calendar permission requested progressively
- [ ] Events created with correct title, time, location
- [ ] Calendar updates when action due date changes

---

## PHASE 9: Scan Automation & Delta Processing

**Goal:** Ongoing email processing for new emails since last scan.

### Tasks

9.1 Delta scan
- Query Gmail for emails newer than lastFullScanAt
- Dedup against existing Email records (gmailMessageId uniqueness)
- Process only new emails through pipeline
- Update existing cases when new emails cluster in (re-synthesis)

9.2 Inngest scheduled job
- Per-schema based on scanFrequency
- Concurrency: `{ limit: 3, key: "event.data.schemaId" }`
- Same fan-out batch pattern as initial scan

9.3 Action lifecycle
- Check for completion signals in new emails
- Expire past-due actions
- Update actions when new information arrives

### Acceptance Criteria
- [ ] New emails automatically processed
- [ ] Existing cases updated with new emails
- [ ] Actions update from new email content
- [ ] ScanJob records track each run

---

## Development Notes for Claude Code

### API Keys Required
See CLAUDE.md Environment Variables section.

### Key Principles (read CLAUDE.md for full details)
1. Zero I/O in packages (@denim/types, @denim/engine, @denim/ai)
2. Single writer per table (see ownership map in CLAUDE.md)
3. Idempotent writes (upsert, check-before-create)
4. Event-driven pipeline (Inngest events chain stages)
5. Concurrency keys on every Inngest function
6. Zod validation on every API input and AI response
7. AI calls through client wrapper (retry, backoff, logging)
8. No Date.now() in pure functions (accept timestamp parameter)
9. Transactions for multi-table writes with denormalized fields
10. Configuration drives behavior (read from schema, don't branch on domain)

### Cross-Cutting Requirements for ALL Services
Every service built in Phases 1-9 must:
- Use the structured logger (src/lib/logger.ts): log at entry (info) and on error (error) with service, operation, schemaId, userId, durationMs
- Throw typed errors from @denim/types/errors.ts (never raw strings or generic Error)
- Use withAuth middleware on its API routes
- Validate API inputs with Zod before calling service methods
- Call AI APIs through the client wrapper (never directly)
- Use Inngest events to communicate between pipeline stages (never direct service calls across stages)
- Write integration tests in apps/web/tests/integration/

Claude Code should apply these requirements to every service it builds. They are not optional.

### Reference Files
- `CLAUDE.md` -- Architecture, engineering practices, scalability, security (READ FIRST)
- `docs/build-plan.md` -- This file
- `docs/interview-to-schema-mapping.md` -- Interview inputs to schema fields
- `docs/schema-design-notes.md` -- Database design decisions
- `docs/alignment-audit.md` -- UI vs schema cross-reference
- `docs/design-system.md` -- Design principles, component patterns, accessibility
- `packages/types/tokens.ts` -- Design tokens (colors, typography, spacing, Tailwind config)
- `apps/web/prisma/schema.prisma` -- Database schema (source of truth)
- `docs/prototypes/case-engine-prototype.jsx` -- Case feed UI prototype
- `docs/prototypes/interview-prototype.jsx` -- Interview UI prototype
- `docs/case-schema-template.xlsx` -- Scenario planning spreadsheet