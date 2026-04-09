# Engineering Practices

Patterns and rules for service code in `apps/web/src/lib/services/`. Read this before adding or modifying a service.

## Single Writer Principle

Each database table has ONE service that owns write operations to it. Other services may READ from any table, but writes go through the owning service. This prevents conflicting update logic, makes bugs traceable, and ensures denormalized fields stay consistent.

### Table Ownership Map

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
| OnboardingOutbox | POST /api/onboarding/start + drainOnboardingOutbox | Created atomically with CaseSchema stub; drained by cron. See #33. |
| ExtractionCost | ExtractionService + SynthesisService | Append-only cost log |

### Exceptions that cross boundaries

- FeedbackService updates `Email.isExcluded` and `CaseEmail.wasReassigned` because these are direct consequences of user corrections. It does NOT re-run synthesis or recompute case fields. Instead, it emits an Inngest event that triggers SynthesisService to update the affected cases.
- ScanService discovers entities and creates Entity rows, even though InterviewService is the primary owner. This is acceptable because scan-discovered entities have `autoDetected=true` and are clearly distinguishable from interview-created ones.

## CAS Transition Ownership

Phase transitions on `CaseSchema.phase` and `ScanJob.phase` use compare-and-swap
helpers (`advanceSchemaPhase`, `advanceScanPhase`). Each `from → to` pair must be
owned by **exactly one Inngest function**. If two functions attempt the same
transition, the CAS becomes a race, not a guard.

Rules:
- **One owner per transition.** See the transition ownership map in
  `docs/01_denim_lessons_learned.md` for the authoritative list.
- **Never emit events inside `work()`.** The `work()` callback runs before the
  CAS `updateMany` commits. If the event triggers a downstream function that
  attempts the same transition, both functions race on the CAS. Emit events
  **after** the `advanceScanPhase` / `advanceSchemaPhase` call returns.
- **Downstream functions must not re-advance.** If `runScan` advances
  DISCOVERING → EXTRACTING and emits `scan.emails.discovered`, the triggered
  function (`fanOutExtraction`) must NOT call `advanceScanPhase` for the same
  transition — the phase is already advanced.

```typescript
// Bad: event emitted inside work(), races with downstream CAS
await advanceScanPhase({
  scanJobId, from: "DISCOVERING", to: "EXTRACTING",
  work: async () => {
    await inngest.send({ name: "scan.emails.discovered", data: { ... } });
  },
});

// Good: emit after CAS commits
await advanceScanPhase({
  scanJobId, from: "DISCOVERING", to: "EXTRACTING",
  work: async () => { /* DB writes only */ },
});
await inngest.send({ name: "scan.emails.discovered", data: { ... } });
```

## Idempotency

Inngest jobs can retry on failure. Every write operation must be safe to run multiple times with the same input.

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

## Event-Driven Pipeline

The processing pipeline (scan -> extract -> cluster -> synthesize) is chained via Inngest events, not by one service calling the next directly. This makes each stage independently retryable, observable, and testable.

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

## Immutable Event Log

FeedbackEvents are append-only. They are never updated or deleted. They are the audit trail for every user correction and the source of truth for quality metrics.

If you need to "undo" a feedback event, create a new event that reverses it (e.g., an EMAIL_MOVE back to the original case), don't delete the original.

QualitySnapshots are computed from the event log and are also never modified once created. If the computation logic changes, create new snapshots going forward.

## Configuration Drives Behavior

The CaseSchema is the runtime configuration for the entire pipeline. No service should have if/else branches per domain type. Instead:

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

The interview generates domain-appropriate configs. The pipeline consumes them generically. This is what makes the system work for any domain without code changes.

The one exception: the interview hypothesis prompt itself, which uses domain knowledge to generate the initial config. That prompt is the only place where domain-specific logic lives.

## Denormalize for Reads, Normalize for Writes

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

## Fail Gracefully, Degrade Visibly

If a non-critical service fails, the user should still see their data:
- If SynthesisService fails: cases exist (from clustering) but have no title/summary. Show email subjects instead.
- If QualityService fails: no accuracy metric, but cases still render. Hide the metric bar.
- If CalendarService fails: action items display normally, "Add to Calendar" button shows error state.
- If ExtractionService fails on one email: skip it, process the rest, flag it for retry. Don't fail the entire scan.

Critical failures (user CANNOT proceed):
- Gmail OAuth token expired and refresh fails: prompt re-auth
- Database unreachable: show error page
- Interview hypothesis generation fails after retries: show error, let user retry

## Auth & Token Lifecycle

Supabase Auth creates users in `auth.users`. The app maintains a parallel `users`
table for FK constraints and app-level fields (tokens, timezone, display name).

Rules:
- **`withAuth` middleware upserts the app-level user row.** Every authenticated
  request ensures the `public.users` row exists. This is the sole production path
  for user creation — no other code should create user rows except test helpers.
- **`provider_token` is ephemeral.** Supabase only returns Google's
  `provider_token` and `provider_refresh_token` in the `exchangeCodeForSession()`
  response. Calling `getSession()` afterward does NOT include them. Always capture
  the exchange response directly.
- **Silent token failures must be errors.** If `provider_token` is missing after
  OAuth, the user's core feature (Gmail access) is broken. Log an error and
  surface the failure to the user — do not log a warning and continue.

## No Side Effects in Pure Functions

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

## Small, Focused Functions

Services orchestrate. Packages compute. Keep functions small:
- Engine functions: single scoring concern, under 30 lines
- Service methods: orchestrate 3-5 steps (validate, fetch, compute, write, emit)
- API routes: validate input, call service, format response (under 20 lines)

If a function needs a comment explaining what a block does, that block should probably be its own function.

## Consistent Naming

- Services: verb-first methods (`generateHypothesis`, `extractEmail`, `clusterNewEmails`)
- Engine functions: descriptive pure names (`scoreEmailAgainstCase`, `computeAccuracy`)
- API routes: RESTful (`POST /api/interview/hypothesis`, `GET /api/cases/:id`)
- Events: past-tense dot notation (`scan.completed`, `feedback.email.moved`)
- Types: noun-based, no "I" prefix (`InterviewInput` not `IInterviewInput`)
