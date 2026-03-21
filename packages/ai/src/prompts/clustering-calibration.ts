/**
 * Clustering Calibration prompt builder.
 * Claude reviews user corrections and frequency data to tune gravity model
 * parameters and update discriminator vocabulary.
 * Pure function — no I/O, no side effects.
 */

export interface CalibrationPromptResult {
  system: string;
  user: string;
}

export interface CalibrationPromptInput {
  currentConfig: {
    mergeThreshold: number;
    subjectMatchScore: number;
    actorAffinityScore: number;
    timeDecayFreshDays: number;
  };
  coarseClusters: {
    entityName: string;
    emailCount: number;
    casesSplit: number;
  }[];
  frequencyTables: Record<string, { word: string; pct: number; caseAssignment: string }[]>;
  corrections: {
    type: string;
    from?: string;
    to?: string;
    cases?: string[];
    caseId?: string;
  }[];
}

function buildSystemPrompt(input: CalibrationPromptInput): string {
  const clusterSummary = input.coarseClusters
    .map(
      (c) =>
        `  - ${c.entityName}: ${c.emailCount} emails, split into ${c.casesSplit} cases`,
    )
    .join("\n");

  const correctionLines = input.corrections
    .map((c) => {
      switch (c.type) {
        case "EMAIL_MOVED":
          return `  - EMAIL_MOVED: email moved from "${c.from}" to "${c.to}" (a discriminator was wrong)`;
        case "CASES_MERGED":
          return `  - CASES_MERGED: cases [${(c.cases ?? []).join(", ")}] were merged (split was too aggressive)`;
        case "THUMBS_UP":
          return `  - THUMBS_UP: case "${c.caseId}" was confirmed as correct`;
        case "THUMBS_DOWN":
          return `  - THUMBS_DOWN: case "${c.caseId}" was marked as incorrect`;
        default:
          return `  - ${c.type}: ${JSON.stringify(c)}`;
      }
    })
    .join("\n");

  const freqSections = Object.entries(input.frequencyTables)
    .map(([entity, words]) => {
      const wordLines = words
        .slice(0, 20)
        .map((w) => `    "${w.word}" — ${(w.pct * 100).toFixed(0)}% of emails, assigned to: ${w.caseAssignment}`)
        .join("\n");
      return `  ${entity}:\n${wordLines}`;
    })
    .join("\n");

  return `You are a clustering calibration engine for a case management system.

Your job is to review how cases were split, analyze user corrections, and output:
1. Tuned gravity model parameters
2. Updated discriminator vocabulary

CURRENT GRAVITY MODEL PARAMETERS:
- mergeThreshold: ${input.currentConfig.mergeThreshold}
  Controls how aggressively emails merge into cases. Higher = harder to merge (more cases).
  Lower = easier to merge (fewer, larger cases).
- subjectMatchScore: ${input.currentConfig.subjectMatchScore}
  Points awarded when email subjects share significant words. Higher = subject similarity
  matters more for grouping.
- actorAffinityScore: ${input.currentConfig.actorAffinityScore}
  Points awarded when emails share the same sender. Higher = sender identity matters more.
- timeDecayFreshDays: ${input.currentConfig.timeDecayFreshDays}
  Number of days an email is considered "fresh" before time decay reduces its clustering score.

CURRENT CLUSTER STATE:
${clusterSummary}

USER CORRECTIONS:
${correctionLines.length > 0 ? correctionLines : "  (none — first calibration run)"}

HOW TO INTERPRET CORRECTIONS:
- EMAIL_MOVED: The discriminator words assigned this email to the wrong case. Adjust the
  vocabulary so it would land in the correct case next time.
- CASES_MERGED: The system split too aggressively. Some discriminators were creating false
  distinctions. Consider merging those discriminator sets or lowering mergeThreshold.
- THUMBS_UP: The case was correctly formed. Reinforce those discriminators.
- THUMBS_DOWN: The case was poorly formed. Reconsider the discriminator assignments.

CURRENT FREQUENCY DATA:
${freqSections}

RULES:
1. Return ONLY valid JSON matching the required schema exactly.
2. All parameter values must be positive numbers.
3. Discriminator vocabulary confidence scores should be between 0.0 and 1.0.
4. mergedAway should list words that were causing incorrect splits.
5. Provide reasoning explaining what you changed and why.

Required JSON shape:
{
  "tunedConfig": {
    "mergeThreshold": number,
    "subjectMatchScore": number,
    "actorAffinityScore": number,
    "timeDecayFreshDays": number
  },
  "discriminatorVocabulary": {
    "EntityName": {
      "words": { "practice": 0.95, "game": 0.90 },
      "mergedAway": ["admin"]
    }
  },
  "reasoning": "string"
}`;
}

function buildUserPrompt(input: CalibrationPromptInput): string {
  const correctionCount = input.corrections.length;
  const clusterCount = input.coarseClusters.length;

  return `Calibrate the clustering parameters based on ${correctionCount} user correction${correctionCount === 1 ? "" : "s"} across ${clusterCount} entity cluster${clusterCount === 1 ? "" : "s"}.

Return ONLY the JSON object. No other text.`;
}

/**
 * Builds a prompt pair for Claude to calibrate clustering parameters
 * and update discriminator vocabulary based on user corrections.
 * Pure function, no I/O.
 */
export function buildClusteringCalibrationPrompt(
  input: CalibrationPromptInput,
): CalibrationPromptResult {
  return {
    system: buildSystemPrompt(input),
    user: buildUserPrompt(input),
  };
}
