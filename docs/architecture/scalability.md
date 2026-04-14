# Scalability Design

This system processes email through AI APIs for every user. The heaviest moment is onboarding: scan 200 emails, extract each via Gemini Vision, cluster, synthesize via Claude. Multiple users onboarding simultaneously creates compounding pressure on every layer. Design for concurrent users from the start, even though the first pass is validation with a handful of testers.

## Bottleneck Map

| Layer | Bottleneck | Impact | Mitigation |
|---|---|---|---|
| Gemini API | Rate limits (RPM, TPM per project) | Extraction stalls for all users | Per-user queuing, backpressure |
| Claude API | Rate limits (RPM, TPM per project) | Interview + synthesis stalls | Queue with priority, fewer calls |
| Gmail API | Per-user quota (250 quota units/sec) + project quota | Scan slows or fails | Batch requests, respect quota headers |
| Supabase PostgreSQL | Connection limit (default ~60 for starter plans) | Queries fail under load | Connection pooling via pgbouncer |
| Vercel Serverless | 10s default timeout, cold starts | Long extraction jobs timeout | Offload to Inngest (10 min+ timeouts) |
| Inngest | Concurrency limits per function | Jobs queue up, onboarding slows | Concurrency keys per user, priority queues |

## Inngest Job Design for Concurrency

Inngest is the backbone of the pipeline. Design jobs to be user-isolated and concurrency-controlled from the start.

**Concurrency keys:** Every Inngest function that processes user data should set a concurrency key scoped to the user or schema. This prevents one user's heavy scan from consuming all available workers.

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

When a user is actively waiting for their interview hypothesis, that call jumps ahead of background extraction work for other users.

## API Rate Limit Management

Both Claude and Gemini have per-project rate limits. With multiple users, we need to pace calls across the entire system, not just per-user.

**Approach: Inngest as the rate limiter.**
Instead of calling AI APIs directly from services, route every AI call through an Inngest function with a global concurrency limit:

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

This prevents rate limit errors by never exceeding 10 concurrent Gemini calls, regardless of how many users are onboarding simultaneously. If the queue backs up, jobs wait rather than fail.

**For MVP:** Call AI APIs directly from services but wrap in a retry-with-backoff helper that handles 429 (rate limit) responses by waiting and retrying. Move to Inngest-routed calls when you have 10+ concurrent users.

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

## Database Connection Management

Vercel serverless functions open a new database connection per invocation. Inngest workers do the same. Without pooling, 50 concurrent requests exhaust the connection limit.

**Use Supabase's built-in pgbouncer:**
- `DATABASE_URL` points to the pooler endpoint (port 6543, transaction mode)
- `DIRECT_URL` points to the direct connection (port 5432, used for migrations only)
- Set Prisma connection limit: append `?connection_limit=5` to DATABASE_URL (each serverless instance gets 5 connections from the pool)

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

This prevents creating a new PrismaClient on every function invocation in development, which leaks connections.

## Gmail API Quota Management

Google enforces quotas per user (250 quota units/second) and per project (varies by API, typically 10,000 requests/100 seconds for Gmail).

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
Gmail API responses include `X-RateLimit-Remaining` headers. If approaching the limit, slow down rather than hitting 429 errors.

**For the initial scan (200 emails):**
1. Fetch message IDs via search (1 API call)
2. Fetch metadata in batches of 50 (4 API calls, using fields mask for minimal data)
3. Fetch full messages (body + attachments) in batches of 20, with a 100ms delay between batches
4. Total: ~15 API calls instead of 200+

## Schema-Level Isolation

All data is scoped by schemaId. This is both a security feature (users can't see each other's data) and a scalability feature (queries are indexed by schemaId, so database performance doesn't degrade as the total row count grows).

Every query MUST include schemaId in the WHERE clause. If you find yourself querying without schemaId, something is wrong (with the exception of admin dashboard queries that aggregate across schemas).

## Stateless Services

Services in `apps/web/src/lib/services/` must be stateless. No in-memory caches, no singleton state, no module-level variables (except the Prisma client singleton). Every service method receives its context via parameters.

This is critical because:
- Vercel serverless functions may run on different instances per request
- Inngest workers are independent processes
- You cannot rely on shared memory between requests

If you need caching, use Supabase's built-in caching or add Redis later. Do not build in-memory caches in services.

## What to Build Now vs. Later

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
