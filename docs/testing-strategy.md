# Testing Strategy

## Three Levels of Testing

### Level 1: Unit Tests (Vitest)
Packages are pure functions with zero I/O. Unit tests co-located in `__tests__/`. No mocking needed. Fast. Run on every commit via CI.

What to test:
- Every scoring function in the gravity model
- Time decay calculations, weak tag discount behavior
- Jaro-Winkler entity matching
- Action fingerprint generation and dedup
- Quality accuracy computation
- AI response parsers (valid JSON, malformed JSON, missing fields)
- Prompt builders (output contains expected schema context)

### Level 2: Integration Tests (Vitest + test database)
Services involve real database writes. Integration tests use a test database and mock only external API calls (Claude, Gemini, Gmail).

What to test:
- InterviewService creates correct CaseSchema + Entity + SchemaTag rows
- ExtractionService writes Email + EmailAttachment rows with correct metadata
- ClusterService creates Case + CaseEmail rows
- FeedbackService logs events and computes quality snapshots
- ExclusionRule auto-creation after 3 excludes from same domain
- CaseAction dedup across multiple synthesis runs

### Level 3: End-to-End Tests (Playwright)
Full user flows in the browser against a running Next.js dev server.

What to test:
- Interview flow: role -> names -> connect -> review -> finalize
- Case feed: rendering, scope filters, card fields
- Case detail: summary, actions, thumbs up/down
- Corrections: email move, exclude, case merge

## AI Output Testing

AI responses are non-deterministic. Test parsers (deterministic) separately from prompt quality (non-deterministic):
- Parsers: standard unit tests with fixture JSON
- Prompts: evaluation runs saved to `docs/test-results/`, not automated pass/fail

## When to Write Tests

- Phase 0: Set up Vitest and Playwright configs. Write no tests yet.
- Phase 1: Parser unit tests. InterviewService integration test.
- Phase 4: Full unit test suite for gravity model scoring.
- Phase 6: Playwright e2e for interview flow and case feed.
