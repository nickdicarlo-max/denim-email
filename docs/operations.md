# Operations

How we run, validate, observe, and ship the system.

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
- After all retries, log raw response and throw `ExternalAPIError`
- Track error rates in `ExtractionCost` table

## Input Validation (Zod)

Every API route validates input with Zod. Schemas in `apps/web/src/lib/validation/`. AI response parsers in `@denim/ai/parsers/` also use Zod to validate untrusted AI output. Use `unknown` instead of `any` for untyped external data, then validate.

## Observability

### Structured Logging
Every log includes: timestamp, level, service, schemaId, userId, operation, duration. Use JSON format. Never log: tokens, email content, PII beyond userId.

### AI Cost Tracking
`ExtractionCost` table logs every API call: model, operation, tokens, cost, latency. This is the primary tool for spend optimization.

### Health Check
`/api/health` returns status, timestamp, version, and database connectivity.

## Database Practices

- `prisma db push` is forbidden on this setup (hangs). Use the `supabase-db` skill for ad-hoc SQL and the `prisma migrate dev` workflow for schema changes.
- Migration files committed to git and run in CI.
- Connection pooling via Supabase pgbouncer (port 6543).
- Always scope queries by `schemaId`. Use `select` for needed fields only.
- Transactions for multi-table atomic writes.

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
