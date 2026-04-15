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
   * Full discovery scan (runs inside `runScan` via
   * `apps/web/src/lib/services/discovery.ts`). These values were the
   * previously-hardcoded `DISCOVERY_LOOKBACK` and `MAX_DISCOVERY_EMAILS`.
   */
  discovery: {
    lookback: "56d",
    maxTotalEmails: 200,
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
  },

  synthesis: {
    /**
     * Per-schema parallel `synthesize-case-worker` Inngest functions.
     * Claude synthesis is 5-15s per case; concurrency caps Claude rate
     * and total wall ≈ (cases / concurrency) × perCaseLatency.
     */
    caseConcurrency: 4,
  },
} as const;
