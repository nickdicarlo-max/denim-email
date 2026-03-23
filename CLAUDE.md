# CLAUDE.md

## Project: Case Engine (codename "denim-email")

A system that transforms unstructured email into organized cases using deterministic
clustering and AI extraction. Users go through a guided interview, connect Gmail,
and see their email organized into actionable cases in a Chrome side panel.

This is not a throwaway prototype. Build for maintainability, security, and scale
from the start. Gmail access means we hold sensitive data and need to earn trust.

## Repository

https://github.com/nickdicarlo-max/denim-email

## Supabase Schema
This project is NOT connected to the MCP Supabase plugin. The MCP will return permission errors.
To run SQL or push schema changes, use the DATABASE_URL/DIRECT_URL from `apps/web/.env.local` directly
(e.g., pass env vars inline to `prisma db push`, or use `psql` with the DIRECT_URL).

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
        api/                    # API routes consumed by extension + web
        (auth)/                 # Auth pages
        admin/                  # Developer dashboard (quality metrics, logs)
      lib/
        services/               # Orchestration layer: wires packages + I/O
          interview.ts          # Calls @denim/ai prompts, writes to Prisma
          extraction.ts         # Calls @denim/ai prompts + Gmail client, writes to Prisma
          cluster.ts            # Calls @denim/engine, writes to Prisma
          synthesis.ts          # Calls @denim/ai prompts, writes to Prisma
          feedback.ts           # Reads events, computes quality, writes snapshots
          calendar.ts           # Google Calendar API integration
        gmail/                  # Gmail API client (I/O, app-specific)
        inngest/                # Background job definitions
        middleware/             # Auth, rate limiting, error handling
        validation/             # Zod schemas for API inputs/outputs
      components/               # React components
      hooks/                    # React hooks
    prisma/
      schema.prisma             # Database schema (source of truth)
      migrations/               # Prisma migrations (NOT db push in production)
    tests/
      unit/                     # Unit tests for services (with mocked I/O)
      integration/              # Integration tests (real DB, mocked external APIs)
      e2e/                      # Playwright end-to-end tests
    playwright.config.ts
    vitest.config.ts
  extension/                    # Chrome extension (Manifest V3)
    manifest.json
    service-worker.js
    sidepanel.html
    sidepanel/                  # React app rendered in Chrome side panel

packages/
  types/                        # @denim/types -- Interfaces only. Zero dependencies.
    schema.ts                   # InterviewInput, SchemaHypothesis, ClusteringConfig
    models.ts                   # Case, Email, Entity, CaseAction (matching Prisma shapes)
    api.ts                      # API request/response types
    errors.ts                   # Typed error classes

  engine/                       # @denim/engine -- Pure business logic. Zero I/O.
    clustering/
      gravity-model.ts          # scoreEmailAgainstCase, findBestCase
      scoring.ts                # threadScore, tagScore, subjectScore, actorScore
      reminder-detection.ts     # isReminder, collapseReminders
    actions/
      dedup.ts                  # generateFingerprint, matchAction
      lifecycle.ts              # isExpired, inferCompletion
    quality/
      accuracy.ts               # computeAccuracy, detectRegression
    entity/
      matching.ts               # jaroWinkler, fuzzyMatch, resolveEntity
    __tests__/                  # Co-located unit tests for engine
      clustering.test.ts
      scoring.test.ts
      entity-matching.test.ts

  ai/                           # @denim/ai -- Prompt templates + response parsers. No API calls.
    prompts/
      interview-hypothesis.ts   # buildHypothesisPrompt(input) -> { system, user }
      extraction.ts             # buildExtractionPrompt(email, schema) -> { system, user }
      synthesis.ts              # buildSynthesisPrompt(emails, schema) -> { system, user }
    parsers/
      hypothesis-parser.ts      # parseHypothesisResponse(json) -> SchemaHypothesis
      extraction-parser.ts      # parseExtractionResponse(json) -> ExtractionResult
      synthesis-parser.ts       # parseSynthesisResponse(json) -> SynthesisResult
    __tests__/                  # Co-located tests for prompts and parsers
      hypothesis-parser.test.ts
      extraction-parser.test.ts

docs/                           # Design documents and specs
  build-plan.md
  schema-design-notes.md
  interview-to-schema-mapping.md
  alignment-audit.md

.github/
  workflows/
    ci.yml                      # Lint, type-check, test on every PR
```

### Package Boundary Rule

**Packages have ZERO I/O dependencies.** No Prisma, no fetch, no Gmail API, no file
system, no environment variables. They take typed data in and return typed data out.

- `@denim/types` -- interfaces only, zero runtime code
- `@denim/engine` -- pure functions, testable with plain data, no mocking required
- `@denim/ai` -- builds prompt strings and parses response JSON, never calls an API

All I/O happens in `apps/web/src/lib/services/`. Services read from the database,
call external APIs (Claude, Gemini, Gmail), pass data to packages for processing,
and write results back. This separation means the engine and AI logic can later run
in a different runtime (a standalone pipeline service, a worker, an API product)
without any refactoring.

---

## Testing Strategy

### Three Levels of Testing

**Level 1: Unit Tests (Vitest)**
Packages are pure functions with zero I/O. Unit tests co-located in `__tests__/`.
No mocking needed. Fast. Run on every commit via CI.

What to test:
- Every scoring function in the gravity model
- Time decay calculations, weak tag discount behavior
- Jaro-Winkler entity matching
- Action fingerprint generation and dedup
- Quality accuracy computation
- AI response parsers (valid JSON, malformed JSON, missing fields)
- Prompt builders (output contains expected schema context)

**Level 2: Integration Tests (Vitest + test database)**
Services involve real database writes. Integration tests use a test database
and mock only external API calls (Claude, Gemini, Gmail).

What to test:
- InterviewService creates correct CaseSchema + Entity + SchemaTag rows
- ExtractionService writes Email + EmailAttachment rows with correct metadata
- ClusterService creates Case + CaseEmail rows
- FeedbackService logs events and computes quality snapshots
- ExclusionRule auto-creation after 3 excludes from same domain
- CaseAction dedup across multiple synthesis runs

**Level 3: End-to-End Tests (Playwright)**
Full user flows in the browser against a running Next.js dev server.

What to test:
- Interview flow: role -> names -> connect -> review -> finalize
- Case feed: rendering, scope filters, card fields
- Case detail: summary, actions, thumbs up/down
- Corrections: email move, exclude, case merge

### AI Output Testing
AI responses are non-deterministic. Test parsers (deterministic) separately
from prompt quality (non-deterministic):
- Parsers: standard unit tests with fixture JSON
- Prompts: evaluation runs saved to docs/test-results/, not automated pass/fail

### When to Write Tests
- Phase 0: Set up Vitest and Playwright configs. Write no tests yet.
- Phase 1: Parser unit tests. InterviewService integration test.
- Phase 4: Full unit test suite for gravity model scoring.
- Phase 6: Playwright e2e for interview flow and case feed.

---

## Security

### Threat Model
We read users' email. Every security decision starts from: "What if this gets breached?"

### OAuth Token Handling
- Tokens stored encrypted at rest (env: TOKEN_ENCRYPTION_KEY)
- Never log tokens or include in error messages
- Token refresh server-side only, never exposed to client
- Scopes: gmail.readonly first. calendar.events added progressively. Never gmail.send.

### Row Level Security (RLS)
- Enable Supabase RLS on ALL tables
- Every query scoped by userId (via schema -> user chain)
- Service role key used ONLY in server-side services, never in client code

### API Security
- All routes require authenticated Supabase session
- Rate limiting on AI-heavy endpoints
- Input validation via Zod on every route
- CORS configured for extension origin only in production
- No sensitive data in error responses

### Data Handling
- Email bodies NOT stored (summary + metadata only)
- Attachment bytes NOT stored (metadata + extraction summary only)
- Account deletion cascades all data
- Per-user data isolation enforced at query level

### Future Security (plan for, not MVP)
- SOC 2 Type I readiness
- Google CASA Tier 2 assessment
- CSP headers, SRI for extension scripts

---

## Error Handling

### Typed Errors
Define in `@denim/types/errors.ts`. All services throw typed errors, never raw strings.

- `ValidationError` (400) -- bad input
- `AuthError` (401) -- not authenticated
- `ForbiddenError` (403) -- wrong user
- `NotFoundError` (404) -- resource missing
- `ExternalAPIError` (502) -- Claude/Gemini/Gmail failed
- `RateLimitError` (429) -- too many requests

### AI Call Resilience
- 3 retries with exponential backoff (1s, 3s, 9s)
- On parse failure, retry once with stricter prompt
- After all retries, log raw response and throw ExternalAPIError
- Track error rates in ExtractionCost table

---

## Input Validation (Zod)

Every API route validates input with Zod. Schemas in `apps/web/src/lib/validation/`.
AI response parsers in `@denim/ai/parsers/` also use Zod to validate untrusted AI output.
Use `unknown` instead of `any` for untyped external data, then validate.

---

## Observability

### Structured Logging
Every log includes: timestamp, level, service, schemaId, userId, operation, duration.
Use JSON format. Never log: tokens, email content, PII beyond userId.

### AI Cost Tracking
ExtractionCost table logs every API call: model, operation, tokens, cost, latency.
This is the primary tool for spend optimization.

### Health Check
`/api/health` returns status, timestamp, version, and database connectivity.

---

## Database Practices

- `prisma db push` for local dev only. `prisma migrate dev` once past initial setup.
- Migration files committed to git and run in CI.
- Connection pooling via Supabase pgbouncer (port 6543).
- Always scope queries by schemaId. Use select for needed fields only.
- Transactions for multi-table atomic writes.

---

## CI/CD (GitHub Actions)

### On Every PR
1. `pnpm install --frozen-lockfile`
2. `pnpm biome check .`
3. `pnpm -r tsc --noEmit`
4. `pnpm -r test` (unit tests)
5. `pnpm -r build`

### On Merge to Main
1. All PR checks
2. Integration tests (test database via GitHub secrets)
3. Vercel preview deploy
4. Playwright e2e (Phase 6+)

---

## Architecture Principles

1. **Zero I/O in packages.** Engine and AI logic can run anywhere.
2. **Metadata-first.** Rich email metadata; rarely re-fetch from Gmail.
3. **Pure logic clustering.** Gravity model takes data in, returns decisions out.
4. **Feedback as first-class data.** Every correction teaches the system.
5. **Interview-generated configuration.** Different domains get different configs.
6. **Two-axis entity model.** Primary (boundary) + secondary (signal).
7. **Defense in depth.** RLS, Zod, encrypted tokens, scoped queries, typed errors.

---

## Engineering Practices

### Single Writer Principle

Each database table has ONE service that owns write operations to it. Other services
may READ from any table, but writes go through the owning service. This prevents
conflicting update logic, makes bugs traceable, and ensures denormalized fields
stay consistent.

**Table Ownership Map:**

| Table | Write Owner | Notes |
|---|---|---|
| User | AuthService | Created by Supabase Auth, tokens updated by GmailService |
| CaseSchema | InterviewService | Created during interview, updated by settings |
| SchemaTag | InterviewService | Created during interview, weights updated by QualityService |
| ExtractedFieldDef | InterviewService | Created during interview |
| Entity | InterviewService + ScanService | Interview creates from user input, scan discovers new ones |
| ExclusionRule | FeedbackService | Auto-created from exclude patterns |
| Email | ExtractionService | Created during extraction, isExcluded updated by FeedbackService |
| EmailAttachment | ExtractionService | Created during extraction |
| Case | SynthesisService | Created and updated during synthesis |
| CaseAction | SynthesisService | Created during synthesis, status updated by FeedbackService |
| CaseEmail | ClusterService | Created during clustering, updated by FeedbackService (moves) |
| Cluster | ClusterService | Created during clustering |
| FeedbackEvent | FeedbackService | Append-only, never updated |
| QualitySnapshot | QualityService | Created daily, never updated |
| ScanJob | ScanService | Created and updated during scan lifecycle |
| ExtractionCost | ExtractionService + SynthesisService | Append-only cost log |

**Exceptions that cross boundaries:**
- FeedbackService updates `Email.isExcluded` and `CaseEmail.wasReassigned` because
  these are direct consequences of user corrections. It does NOT re-run synthesis
  or recompute case fields. Instead, it emits an Inngest event that triggers
  SynthesisService to update the affected cases.
- ScanService discovers entities and creates Entity rows, even though InterviewService
  is the primary owner. This is acceptable because scan-discovered entities have
  `autoDetected=true` and are clearly distinguishable from interview-created ones.

### Idempotency

Inngest jobs can retry on failure. Every write operation must be safe to run
multiple times with the same input.

Rules:
- Use upsert (create or update) instead of create where duplicates are possible
- Email processing: check `gmailMessageId` uniqueness before creating Email rows
- Clustering: check if email is already assigned to a case before creating CaseEmail
- Synthesis: update existing Case rows rather than creating duplicates
- FeedbackEvent: always create (append-only log, duplicates are harmless if timestamped)
- ScanJob: use status transitions (PENDING -> RUNNING -> COMPLETED) to prevent re-entry

Pattern for idempotent Inngest functions:
```typescript
// Good: upsert with unique constraint
await prisma.email.upsert({
  where: { schemaId_gmailMessageId: { schemaId, gmailMessageId } },
  create: { ...emailData },
  update: { ...emailData },  // Re-processing updates existing record
});

// Good: check before creating
const existing = await prisma.caseEmail.findUnique({
  where: { emailId },
});
if (!existing) {
  await prisma.caseEmail.create({ data: { ... } });
}
```

### Event-Driven Pipeline

The processing pipeline (scan -> extract -> cluster -> synthesize) is chained
via Inngest events, not by one service calling the next directly. This makes
each stage independently retryable, observable, and testable.

```
ScanService completes
  -> emits "scan.emails.discovered" event
  -> Inngest triggers ExtractionService

ExtractionService completes batch
  -> emits "extraction.batch.completed" event
  -> Inngest triggers ClusterService

ClusterService completes
  -> emits "clustering.completed" event
  -> Inngest triggers SynthesisService

FeedbackService records email move
  -> emits "feedback.case.modified" event
  -> Inngest triggers SynthesisService to re-synthesize affected case
```

Benefits:
- Each stage can fail and retry independently
- Inngest dashboard shows pipeline progress
- Adding a new stage (e.g., co-pilot evaluation) is a new event listener, not a code change to existing services
- Rate limiting and concurrency control are handled by Inngest, not custom code

### Immutable Event Log

FeedbackEvents are append-only. They are never updated or deleted. They are the
audit trail for every user correction and the source of truth for quality metrics.

If you need to "undo" a feedback event, create a new event that reverses it
(e.g., an EMAIL_MOVE back to the original case), don't delete the original.

QualitySnapshots are computed from the event log and are also never modified
once created. If the computation logic changes, create new snapshots going forward.

### Configuration Drives Behavior

The CaseSchema is the runtime configuration for the entire pipeline. No service
should have if/else branches per domain type. Instead:

```typescript
// Bad: domain-specific code in the service
if (schema.domain === "school_parent") {
  mergeThreshold = 35;
} else if (schema.domain === "construction") {
  mergeThreshold = 45;
}

// Good: read from schema configuration
const { mergeThreshold } = schema.clusteringConfig;
```

The interview generates domain-appropriate configs. The pipeline consumes them
generically. This is what makes the system work for any domain without code changes.

The one exception: the interview hypothesis prompt itself, which uses domain
knowledge to generate the initial config. That prompt is the only place where
domain-specific logic lives.

### Denormalize for Reads, Normalize for Writes

The database schema has intentional denormalization for feed performance:
- `Case.lastSenderName`, `Case.lastSenderEntity`, `Case.lastEmailDate`
- `Email.attachmentCount`, `Email.totalAttachmentBytes`
- `CaseSchema.emailCount`, `CaseSchema.caseCount`
- `SchemaTag.emailCount`, `SchemaTag.frequency`
- `Entity.emailCount`

Rules for denormalized fields:
- Always update in the SAME TRANSACTION as the source data change
- The write-owner service is responsible for keeping them in sync
- Never trust denormalized fields for business logic decisions (use the source data)
- If a denormalized field is wrong, the fix is in the write path, not a batch repair job

### Fail Gracefully, Degrade Visibly

If a non-critical service fails, the user should still see their data:
- If SynthesisService fails: cases exist (from clustering) but have no title/summary. Show email subjects instead.
- If QualityService fails: no accuracy metric, but cases still render. Hide the metric bar.
- If CalendarService fails: action items display normally, "Add to Calendar" button shows error state.
- If ExtractionService fails on one email: skip it, process the rest, flag it for retry. Don't fail the entire scan.

Critical failures (user CANNOT proceed):
- Gmail OAuth token expired and refresh fails: prompt re-auth
- Database unreachable: show error page
- Interview hypothesis generation fails after retries: show error, let user retry

### No Side Effects in Pure Functions

Functions in `@denim/engine` and `@denim/ai` must not:
- Read environment variables
- Write to console.log (pass a logger if needed)
- Depend on Date.now() directly (accept a timestamp parameter for testability)
- Access global state or singletons

```typescript
// Bad: hidden dependency on current time
function scoreTimeDecay(emailDate: Date, config: TimeDecayConfig): number {
  const daysSince = (Date.now() - emailDate.getTime()) / 86400000;
  // ...
}

// Good: explicit time parameter
function scoreTimeDecay(emailDate: Date, now: Date, config: TimeDecayConfig): number {
  const daysSince = (now.getTime() - emailDate.getTime()) / 86400000;
  // ...
}
```

### Small, Focused Functions

Services orchestrate. Packages compute. Keep functions small:
- Engine functions: single scoring concern, under 30 lines
- Service methods: orchestrate 3-5 steps (validate, fetch, compute, write, emit)
- API routes: validate input, call service, format response (under 20 lines)

If a function needs a comment explaining what a block does, that block should
probably be its own function.

### Consistent Naming

- Services: verb-first methods (`generateHypothesis`, `extractEmail`, `clusterNewEmails`)
- Engine functions: descriptive pure names (`scoreEmailAgainstCase`, `computeAccuracy`)
- API routes: RESTful (`POST /api/interview/hypothesis`, `GET /api/cases/:id`)
- Events: past-tense dot notation (`scan.completed`, `feedback.email.moved`)
- Types: noun-based, no "I" prefix (`InterviewInput` not `IInterviewInput`)

---

## Scalability Design

This system processes email through AI APIs for every user. The heaviest moment
is onboarding: scan 200 emails, extract each via Gemini Vision, cluster, synthesize
via Claude. Multiple users onboarding simultaneously creates compounding pressure
on every layer. Design for concurrent users from the start, even though the first
pass is validation with a handful of testers.

### Bottleneck Map

| Layer | Bottleneck | Impact | Mitigation |
|---|---|---|---|
| Gemini API | Rate limits (RPM, TPM per project) | Extraction stalls for all users | Per-user queuing, backpressure |
| Claude API | Rate limits (RPM, TPM per project) | Interview + synthesis stalls | Queue with priority, fewer calls |
| Gmail API | Per-user quota (250 quota units/sec) + project quota | Scan slows or fails | Batch requests, respect quota headers |
| Supabase PostgreSQL | Connection limit (default ~60 for starter plans) | Queries fail under load | Connection pooling via pgbouncer |
| Vercel Serverless | 10s default timeout, cold starts | Long extraction jobs timeout | Offload to Inngest (10 min+ timeouts) |
| Inngest | Concurrency limits per function | Jobs queue up, onboarding slows | Concurrency keys per user, priority queues |

### Inngest Job Design for Concurrency

Inngest is the backbone of the pipeline. Design jobs to be user-isolated and
concurrency-controlled from the start.

**Concurrency keys:** Every Inngest function that processes user data should set
a concurrency key scoped to the user or schema. This prevents one user's heavy
scan from consuming all available workers.

```typescript
export const extractEmails = inngest.createFunction(
  {
    id: "extract-emails",
    concurrency: {
      limit: 3,                          // Max 3 concurrent runs of this function
      key: "event.data.schemaId",        // Per-schema isolation
    },
    retries: 3,
  },
  { event: "scan.emails.discovered" },
  async ({ event, step }) => {
    // Each user's extraction runs independently
    // Max 3 schemas extracting simultaneously
  }
);
```

**Fan-out pattern for email processing:**
Don't process 200 emails in one giant function. Fan out into batches:

```
scan.emails.discovered (200 emails found)
  -> step.sendEvent: 10 batches of 20 emails each
  -> extraction.batch.process (runs 10 times, concurrency-limited)
  -> each batch emits extraction.batch.completed
  -> after all batches: emit extraction.all.completed
  -> triggers clustering
```

This gives you:
- Retry granularity: one failed batch retries 20 emails, not 200
- Concurrency control: Inngest limits how many batches run at once
- Progress visibility: each batch updates ScanJob.processedEmails
- User isolation: concurrency key on schemaId prevents one user from starving others

**Priority queues for interactive vs. background work:**

```typescript
// High priority: user is waiting (interview hypothesis)
export const generateHypothesis = inngest.createFunction(
  { id: "generate-hypothesis", priority: { run: "event.data.isInteractive ? 100 : 0" } },
  { event: "interview.hypothesis.requested" },
  async ({ event, step }) => { ... }
);

// Normal priority: background processing (extraction, clustering)
export const extractBatch = inngest.createFunction(
  { id: "extract-batch", priority: { run: "0" } },
  { event: "extraction.batch.process" },
  async ({ event, step }) => { ... }
);
```

When a user is actively waiting for their interview hypothesis, that call jumps
ahead of background extraction work for other users.

### API Rate Limit Management

Both Claude and Gemini have per-project rate limits. With multiple users, we need
to pace calls across the entire system, not just per-user.

**Approach: Inngest as the rate limiter.**
Instead of calling AI APIs directly from services, route every AI call through
an Inngest function with a global concurrency limit:

```typescript
// Global rate limiter for Gemini calls
export const callGemini = inngest.createFunction(
  {
    id: "call-gemini",
    concurrency: {
      limit: 10,                         // Max 10 concurrent Gemini calls across all users
      // No key = global limit
    },
    retries: 3,
    backoff: "exponential",
  },
  { event: "ai.gemini.request" },
  async ({ event, step }) => {
    // Make the actual API call
    // Return result via step.sendEvent or store in DB
  }
);
```

This prevents rate limit errors by never exceeding 10 concurrent Gemini calls,
regardless of how many users are onboarding simultaneously. If the queue backs
up, jobs wait rather than fail.

**For MVP:** Call AI APIs directly from services but wrap in a retry-with-backoff
helper that handles 429 (rate limit) responses by waiting and retrying. Move to
Inngest-routed calls when you have 10+ concurrent users.

```typescript
// MVP: retry helper for AI calls
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const isRateLimit = error?.status === 429;
      const delay = isRateLimit
        ? parseInt(error?.headers?.["retry-after"] || "5") * 1000
        : baseDelayMs * Math.pow(3, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}
```

### Database Connection Management

Vercel serverless functions open a new database connection per invocation.
Inngest workers do the same. Without pooling, 50 concurrent requests exhaust
the connection limit.

**Use Supabase's built-in pgbouncer:**
- `DATABASE_URL` points to the pooler endpoint (port 6543, transaction mode)
- `DIRECT_URL` points to the direct connection (port 5432, used for migrations only)
- Set Prisma connection limit: append `?connection_limit=5` to DATABASE_URL
  (each serverless instance gets 5 connections from the pool)

**Prisma best practices for serverless:**
```typescript
// lib/prisma.ts -- singleton pattern for serverless
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

This prevents creating a new PrismaClient on every function invocation in development,
which leaks connections.

### Gmail API Quota Management

Google enforces quotas per user (250 quota units/second) and per project
(varies by API, typically 10,000 requests/100 seconds for Gmail).

**Batch API requests where possible:**
```typescript
// Bad: one request per email (200 requests for 200 emails)
for (const id of emailIds) {
  await gmail.getMessage(id);
}

// Good: batch request (1 request for up to 100 emails)
const batch = emailIds.map(id => gmail.getMessage(id));
// Use Gmail batch endpoint or Promise.allSettled with concurrency limit
```

**Respect quota headers:**
Gmail API responses include `X-RateLimit-Remaining` headers. If approaching the
limit, slow down rather than hitting 429 errors.

**For the initial scan (200 emails):**
1. Fetch message IDs via search (1 API call)
2. Fetch metadata in batches of 50 (4 API calls, using fields mask for minimal data)
3. Fetch full messages (body + attachments) in batches of 20, with a 100ms delay between batches
4. Total: ~15 API calls instead of 200+

### Schema-Level Isolation

All data is scoped by schemaId. This is both a security feature (users can't see
each other's data) and a scalability feature (queries are indexed by schemaId,
so database performance doesn't degrade as the total row count grows).

Every query MUST include schemaId in the WHERE clause. If you find yourself
querying without schemaId, something is wrong (with the exception of admin
dashboard queries that aggregate across schemas).

### Stateless Services

Services in `apps/web/src/lib/services/` must be stateless. No in-memory caches,
no singleton state, no module-level variables (except the Prisma client singleton).
Every service method receives its context via parameters.

This is critical because:
- Vercel serverless functions may run on different instances per request
- Inngest workers are independent processes
- You cannot rely on shared memory between requests

If you need caching, use Supabase's built-in caching or add Redis later.
Do not build in-memory caches in services.

### What to Build Now vs. Later

**Build now (Phase 0):**
- Prisma singleton pattern for connection management
- callWithRetry helper for AI API calls
- Fan-out batch pattern in Inngest job structure (even if only one user)
- Concurrency keys on Inngest functions (even if limit is high)
- schemaId in every query

**Build when you have 10+ users:**
- Inngest-routed AI calls with global concurrency limits
- Gmail batch API requests
- Redis caching for frequently-read schema configs
- Separate Inngest function groups with different concurrency profiles

**Build when you have 100+ users:**
- Dedicated workers for extraction (separate from Vercel)
- Database read replicas for feed queries
- AI call cost budgets per user (prevent one user from consuming all quota)
- Queue prioritization based on subscription tier

## Key Domain Concepts

- **CaseSchema:** User-created config for organizing one email category.
- **Entity (Primary):** The "what" axis. Case boundary.
- **Entity (Secondary):** The "who" axis. Affinity scoring signal.
- **Case:** Clustered emails with AI-generated title, summary, tags, actions.
- **CaseAction:** Extracted action item with lifecycle, dedup, calendar sync.
- **Gravity Model:** Deterministic clustering engine. Pure functions, zero I/O.
- **FeedbackEvent:** Immutable correction event. Powers the breaking-in curve.

## Current Status

Phases 0–5 complete. Phase 6A (Case Review UI) complete. Pipeline quality fixes
verified (2026-03-20). See docs/00_denim_current_status.md for full details.

**Next:** Card 4 UX improvements, Phase 6 (Chrome Extension), schema ACTIVE transition.

## Commands

```bash
pnpm install                           # Install dependencies
pnpm --filter web dev                  # Dev server
pnpm --filter web prisma generate     # Generate Prisma client
pnpm --filter web prisma db push      # Push schema (local dev only)
pnpm --filter web prisma migrate dev  # Create migration (production path)
pnpm -r build                         # Build all packages
pnpm -r test                          # Unit tests (all packages)
pnpm --filter web test:integration    # Integration tests (needs test DB)
pnpm --filter web test:e2e            # Playwright e2e (needs running server)
pnpm biome check                       # Lint and format check
pnpm biome check --apply               # Auto-fix lint/format
pnpm -r tsc --noEmit                  # Type check everything
npx inngest-cli@latest dev            # Inngest dev server
```