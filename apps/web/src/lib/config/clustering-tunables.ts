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

  /**
   * Global scoring weights rendered into the Claude prompt as defaults.
   * Were hardcoded in `packages/ai/src/prompts/interview-hypothesis.ts`
   * (`tagMatchScore: 15`, `threadMatchScore: 100`). Claude is still free
   * to override in its JSON response, but these set the baseline the
   * user sees and the gravity model expects.
   */
  weights: {
    tagMatchScore: 15,
    threadMatchScore: 100,
  },

  /**
   * Reminder-collapse parameters (used by `reminderDetection` in the
   * gravity model). Were hardcoded in the prompt template.
   */
  reminder: {
    /** Jaccard similarity floor for treating two subjects as the same reminder. */
    subjectSimilarity: 0.85,
    /** Max age in days for a reminder chain to still collapse. */
    maxAgeDays: 7,
  },

  /**
   * Per-domain numeric defaults. The old values at construction/legal/
   * agency/general (45 and 55) were above the reachable ceiling of ~35
   * without a sender-entity match — every one of those domains got
   * clamped to 30 by the validator, erasing per-domain variance.
   *
   * New values preserve differentiation inside the reachable range
   * (30-38) so legal can still tune tighter than property without
   * hitting the validator rail.
   *
   * The associated content (tags, fields, summaryLabels,
   * secondaryEntityTypes, exclusionHints) stays in the prompt file —
   * it's domain copy married to prompt wording, not a tuning knob.
   */
  domainDefaults: {
    school_parent: {
      mergeThreshold: 35,
      timeDecayFresh: 60,
      reminderCollapseEnabled: true,
      subjectMatchScore: 20,
      actorAffinityScore: 10,
    },
    property: {
      mergeThreshold: 30,
      timeDecayFresh: 45,
      reminderCollapseEnabled: false,
      subjectMatchScore: 20,
      actorAffinityScore: 10,
    },
    construction: {
      // was 45 (unreachable without sender match). 35 = high merging within reach.
      mergeThreshold: 35,
      timeDecayFresh: 45,
      reminderCollapseEnabled: false,
      subjectMatchScore: 20,
      actorAffinityScore: 10,
    },
    legal: {
      // was 55 (unreachable). 38 preserves intent that legal is tightest domain;
      // it still requires at least some sender-match contribution but doesn't always.
      mergeThreshold: 38,
      timeDecayFresh: 90,
      reminderCollapseEnabled: false,
      subjectMatchScore: 25,
      actorAffinityScore: 15,
    },
    agency: {
      // was 45 (unreachable). 33 = between property (30) and school_parent (35).
      mergeThreshold: 33,
      timeDecayFresh: 45,
      reminderCollapseEnabled: false,
      subjectMatchScore: 20,
      actorAffinityScore: 10,
    },
    general: {
      // was 45 (unreachable). 32 = middle-of-the-pack.
      mergeThreshold: 32,
      timeDecayFresh: 45,
      reminderCollapseEnabled: false,
      subjectMatchScore: 20,
      actorAffinityScore: 10,
    },
  },
} as const;
