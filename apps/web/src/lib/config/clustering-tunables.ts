/**
 * Centralized tunables for the gravity-model clustering + validator.
 *
 * Per-domain `mergeThreshold` defaults live inside the Claude prompt at
 * `packages/ai/src/prompts/interview-hypothesis.ts` (pure package,
 * cannot import from `apps/web`). This file owns the validator rails
 * that clamp Claude's output before it reaches the DB.
 *
 * ---
 * Scoring math (gravity model, sans sender-entity match):
 *
 *   score = subjectMatchScore (default 20) + tagMatchScore × jaccard (default 15)
 *
 *   Maximum achievable WITHOUT a sender-entity hit: ~35
 *   Maximum achievable WITH a sender-entity hit:     ~45
 *
 * Any `mergeThreshold` > 35 requires sender-entity matches to merge at
 * all. Historically (#59) domains shipped with defaults of 45 / 55, so
 * whole domains produced zero merges. The validator caps
 * AI-generated values above `unreachableCeiling` down to
 * `clampReachableValue` to prevent that.
 *
 * When tuning:
 *   - Lower `unreachableCeiling` → fires the clamp more often (safer).
 *   - Raise `clampReachableValue` closer to 35 → fewer merges (tighter).
 *   - Lower `clampReachableValue` → more merges (looser).
 */
export const CLUSTERING_TUNABLES = {
  validator: {
    /**
     * If `hypothesis.clusteringConfig.mergeThreshold` exceeds this
     * value, clamp it. 40 leaves a small buffer above the no-sender
     * ceiling of ~35 so legitimately-sender-matched schemas can still
     * set higher thresholds intentionally via the Claude prompt.
     */
    unreachableCeiling: 40,
    /**
     * Value to clamp to when `unreachableCeiling` is breached. 30 sits
     * comfortably inside the reachable range (~35 without sender
     * match) while still requiring a strong signal (subject + tags).
     */
    clampReachableValue: 30,
  },
} as const;
