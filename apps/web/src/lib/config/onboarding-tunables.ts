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
} as const;
