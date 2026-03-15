---
name: run-integration-tests
description: Run the integration test suite for the email pipeline (clustering + synthesis)
user_invocable: true
---

# Run Integration Tests

Run the full integration test suite that exercises the real pipeline (cluster -> synthesize) against the dev Supabase DB with live Claude API calls.

## Steps

1. Run the integration tests:
   ```bash
   cd apps/web && pnpm test:integration
   ```

2. The test suite includes 5 tests:
   - **clusters emails into 3 cases** — verifies gravity model separates by entity + topic
   - **synthesizes cases with titles and summaries** — live Claude API call (~30-60s per case)
   - **creates action items for permission case** — verifies action extraction + fingerprinting
   - **excluded email not in any case** — verifies exclusion filtering
   - **cases scoped to correct primary entities** — verifies entity boundary enforcement

3. **Expected runtime:** 2-4 minutes total (synthesis tests dominate due to Claude API calls)

4. Parse the output and report:
   - Total tests passed / failed
   - For each failed test: the assertion error and relevant context
   - If synthesis tests fail with timeout: suggest increasing `testTimeout` or checking `ANTHROPIC_API_KEY`
   - If clustering tests fail: check if gravity model scoring changed in `@denim/engine`

5. **If all tests pass:** Report success with a summary of what was verified.

6. **If any test fails:** Provide the failure message, the test name, and suggest concrete next steps for debugging.

## Troubleshooting

- **"Missing SUPABASE_SERVICE_ROLE_KEY"** — Check `.env.local` has both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- **Timeout on synthesis** — Claude API calls take 30-60s per case. Total timeout is 5 min.
- **"Cannot find module"** — Run `pnpm --filter web prisma generate` first
- **Orphaned test data** — If tests crash mid-run, re-run; `beforeAll` cleanup handles stale data via `cleanupTestUser`
