/**
 * Centralized tunables for the onboarding pipeline.
 *
 * Edit these values to change sample sizes, lookback windows, and caps
 * without hunting through service/Inngest files. Keep changes here small
 * and intentional — every knob here affects end-user wait time and AI
 * spend.
 */
export const ONBOARDING_TUNABLES = {
  /**
   * Pass 1: broad random sample used to generate the review screen.
   * Runs inside Function A (blocks the user on the "Setting up your topic"
   * spinner). Keep small — every email here goes through Claude.
   */
  pass1: {
    /** Random-sample size before the review screen. Was 200. */
    sampleSize: 100,
    /** Gmail `newer_than:` constraint. Was unbounded. */
    lookback: "56d",
  },

  /**
   * Pass 2: targeted expansion after the user confirms entities. Runs
   * inside Function B, so the user is no longer waiting on a spinner.
   * Emails here are pre-filtered by a confirmed entity's domain or
   * sender address, so Gemini sees high-prior-probability content.
   */
  pass2: {
    /** Max number of expansion targets (domains OR specific senders) to query. */
    maxTargetsToExpand: 5,
    /** Max emails to pull per expansion target. */
    emailsPerTarget: 200,
    /** Gmail `newer_than:` constraint. */
    lookback: "56d",
  },

  /**
   * Fast-discovery Stage 1 — domain detection from From-headers (issue #95).
   * Target: < 5s wall for 500 emails. All metadata-only; no bodies, no AI.
   */
  stage1: {
    /** Max Gmail message IDs to fetch metadata for in a single Stage 1 pass. */
    maxMessages: 500,
    /** Parallel batch size for the metadata fetch. */
    fetchBatchSize: 40,
    /** Lookback window passed to the Gmail `newer_than:` qualifier. */
    lookbackDays: 365,
    /** Gmail API pacing between batches, in milliseconds. */
    pacingMs: 50,
  },

  /**
   * Fast-discovery Stage 2 — entity detection from per-domain subjects (issue #95).
   * Target: < 6s wall per confirmed domain; fan-out runs in parallel.
   */
  stage2: {
    /** Max Gmail message IDs to fetch per confirmed Stage-1 domain. */
    maxMessagesPerDomain: 500,
    /** Top N candidate entities to surface per confirmed domain. */
    topNEntities: 20,
    /** Levenshtein threshold for short strings (≤6 chars). */
    levenshteinShortThreshold: 1,
    /** Levenshtein threshold for longer strings. */
    levenshteinLongThreshold: 2,
    // fetchBatchSize + lookbackDays intentionally omitted — Stage 2 reuses
    // ONBOARDING_TUNABLES.stage1's values. One source of truth, no drift.
  },

  /**
   * Full discovery scan (runs inside `runScan` via
   * `apps/web/src/lib/services/discovery.ts`). These values were the
   * previously-hardcoded `DISCOVERY_LOOKBACK` and `MAX_DISCOVERY_EMAILS`.
   */
  discovery: {
    lookback: "56d",
    /** Cap on total unique message IDs collected across all targeted queries (Phase E). */
    maxTotalEmails: 200,
    /** Parallel Gmail search queries during discovery (#81). Was `pLimit(3)`. */
    queryConcurrency: 3,
    /**
     * Phase A — broad inbox metadata scan used to identify sender
     * patterns and social clusters BEFORE targeted queries. Distinct
     * from `maxTotalEmails` (Phase E). Was `BROAD_SCAN_LIMIT = 200`.
     */
    broadScanLimit: 200,
    /**
     * Phase C — how many emails per unclassified domain to fetch body
     * previews from for AI pattern detection. Was `BODY_SAMPLE_COUNT = 3`.
     */
    bodySampleCount: 3,
  },

  /**
   * Pipeline fan-out knobs. Bottleneck tuning lives here so we can
   * raise/lower one number and re-measure without hunting through
   * Inngest function definitions.
   *
   * Measured 2026-04-15 on Property run (200 emails, schema
   * 01KP8MRJQJXF302KP19NB5RAVR): extraction wall was 169.5s. Per-batch
   * Gemini latency ~6s (median), 40 batches, concurrency=3 ⇒ ~80s
   * Gemini floor. Bumping to 8 drops the floor to ~30s. Gemini Flash
   * 2.5 has 2000+ RPM and DB write pressure is well within pooler
   * headroom at this level.
   */
  extraction: {
    /** Emails per Gemini batch call. Higher = fewer calls but longer per-call latency. */
    chunkSize: 5,
    /**
     * Per-schema parallel `extractBatch` Inngest functions. Dominates
     * extraction wall clock — each worker runs one Gemini call at a
     * time, so total wall ≈ (batches / concurrency) × perBatchLatency.
     */
    batchConcurrency: 8,
    /**
     * Emails per fan-out Inngest event (was `BATCH_SIZE=20` in
     * functions.ts). 200 emails ÷ 20 = 10 events; each event is one
     * extractBatch invocation that chunks into Gemini calls of
     * `chunkSize`.
     */
    fanOutBatchSize: 20,
    /**
     * Gmail per-fetch pacing inside `getEmailFullWithPacing` (ms). 215
     * fetches × 100ms = 21.5s serial delay on a 200-email run. Lower
     * this cautiously — Gmail throttles aggressively on burst.
     */
    gmailPacingMs: 100,
    /**
     * Gemini-produced relevance score threshold for the known-entity
     * bypass gate. Below this, emails from known entities are still
     * kept (logged as `relevanceGateBypass`). Raise to be stricter.
     */
    relevanceThreshold: 0.4,
  },

  synthesis: {
    /**
     * Per-schema parallel `synthesize-case-worker` Inngest functions.
     * Claude synthesis is 5-15s per case; concurrency caps Claude rate
     * and total wall ≈ (cases / concurrency) × perCaseLatency.
     */
    caseConcurrency: 4,
    /**
     * Claude output token budget per case. 4096 hit its ceiling on a
     * 22-email maintenance thread and returned truncated JSON (#87).
     * 6144 gives ~50% headroom; Sonnet 4.6 supports up to 8192.
     */
    maxTokens: 6144,
  },

  /**
   * Pipeline-level timeouts that gate how long one stage can take
   * before the orchestrator treats it as stuck.
   */
  pipeline: {
    /**
     * Function B's `waitForEvent("scan.completed")` timeout. If the
     * scan pipeline doesn't emit `scan.completed` within this window,
     * onboarding fails open. Inngest duration string format.
     */
    scanWaitTimeout: "20m",
  },

  /**
   * Client-side polling cadence for the onboarding scan-progress page.
   * Paired with the live case-count counter (#82).
   */
  ui: {
    pollIntervalMs: 2000,
  },
} as const;
