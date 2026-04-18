/**
 * Case Splitting prompt builder.
 * Second pass of two-pass clustering: Claude sees frequency tables from word
 * analysis and splits coarse entity clusters into specific cases.
 * Pure function — no I/O, no side effects.
 */

export interface CaseSplittingPromptResult {
  system: string;
  user: string;
}

export interface CaseSplittingInput {
  domain: string;
  today?: string;
  clusters: {
    clusterId: string;
    entityName: string;
    emailCount: number;
    frequencyWords: { word: string; frequency: number; weightedScore: number }[];
    emailSamples: { id: string; subject: string; summary: string }[];
  }[];
  correctionHistory?: {
    type: string;
    details: string;
  }[];
  learnedVocabulary?: Record<string, { words: Record<string, number>; mergedAway: string[] }>;
}

function buildSystemPrompt(input: CaseSplittingInput): string {
  const learnedSection = input.learnedVocabulary
    ? `\nLEARNED VOCABULARY (from previous calibration runs — use as starting point):
${Object.entries(input.learnedVocabulary)
  .map(([entity, vocab]) => {
    const words = Object.entries(vocab.words)
      .map(([w, score]) => `    "${w}" (confidence: ${score})`)
      .join("\n");
    const merged =
      vocab.mergedAway.length > 0
        ? `  Merged away (do NOT use as discriminators): ${vocab.mergedAway.map((w) => `"${w}"`).join(", ")}`
        : "";
    return `  ${entity}:\n${words}${merged ? `\n${merged}` : ""}`;
  })
  .join("\n")}\n`
    : "";

  const correctionSection =
    input.correctionHistory && input.correctionHistory.length > 0
      ? `\nCORRECTION HISTORY (user feedback on previous splits):
${input.correctionHistory.map((c) => `  - ${c.type}: ${c.details}`).join("\n")}

Use these corrections to avoid repeating the same mistakes.\n`
      : "";

  const todayStr = input.today ?? new Date().toISOString().slice(0, 10);

  return `You are a case-splitting engine for a "${input.domain}" case management system.

TODAY'S DATE: ${todayStr}
Use this to distinguish past events from upcoming ones when deciding how to split clusters.
Past events of the same type should still be grouped together (not split into one-offs).

CONTEXT: TWO-PASS CLUSTERING
Emails have already been grouped into COARSE CLUSTERS by primary entity (e.g., all emails
mentioning "Soccer" are in one cluster). Your job is the second pass: split each coarse
cluster into specific CASES based on discriminator words from frequency analysis.

A CASE represents a coherent topic where "what's next?" has one clear answer.
Examples of good splits:
- "Soccer" cluster → "Soccer Practices", "Soccer Games", "Soccer Registration"
- "School" cluster → "Parent-Teacher Conferences", "Fundraiser", "Weekly Newsletter"

WHAT ARE DISCRIMINATOR WORDS?
Each cluster comes with a frequency table showing words that appear across its emails,
along with their frequency (how often they appear) and weighted score (adjusted for
cross-entity noise and source weight). High-weighted-score words that appear in a
SUBSET of emails (not all of them) are good discriminators — they separate one case
from another within the same entity.

Words that appear in nearly ALL emails in a cluster are NOT good discriminators —
they describe the entity itself, not a specific case.
${learnedSection}${correctionSection}
RULES:
1. Return ONLY valid JSON matching the required schema exactly.
2. Every email ID from the samples must appear in exactly one case OR in catchAllEmailIds.
3. Case titles should be user-friendly, under 60 characters.
4. Each case must have at least one discriminator word from the frequency table.
5. Emails that don't clearly match any discriminator set go in catchAllEmailIds.
6. DO NOT OVER-SPLIT. This is the most important rule. Aim for the FEWEST cases where
   each case has a distinct answer to "what's next?". Create as many cases as there
   are genuinely distinct topics — no more, no less. There is no numeric cap; a busy
   entity with many independent threads (practices, games, registration, uniforms,
   travel, tournaments, fundraisers) may legitimately need more than 5 cases.
   - Recurring events of the same type (weekly practices, monthly games) = ONE case.
   - Do NOT create separate cases per individual date, reminder, or update for the
     same recurring activity.
   - "Soccer Practice – Mar 5" and "Soccer Practice – Mar 12" belong in the SAME case.
   - If two candidate cases share the same answer to "what's next?", MERGE them.
7. Provide reasoning for each case explaining why those discriminators were chosen.

Required JSON shape:
{
  "cases": [
    {
      "caseTitle": "string (under 50 chars)",
      "discriminators": ["word1", "word2"],
      "emailIds": ["id1", "id2"],
      "reasoning": "string"
    }
  ],
  "catchAllEmailIds": ["id1"],
  "reasoning": "string"
}`;
}

function buildUserPrompt(input: CaseSplittingInput): string {
  const clusterSections = input.clusters.map((cluster) => {
    const freqLines = cluster.frequencyWords
      .slice(0, 30)
      .map(
        (w) =>
          `    "${w.word}" — frequency: ${w.frequency.toFixed(2)}, weighted: ${w.weightedScore.toFixed(2)}`,
      )
      .join("\n");

    const emailLines = cluster.emailSamples
      .map((e) => `    [${e.id}] Subject: ${e.subject}\n      Summary: ${e.summary}`)
      .join("\n");

    return `CLUSTER: ${cluster.entityName} (${cluster.emailCount} emails, ID: ${cluster.clusterId})
  Frequency table (top words):
${freqLines}

  Email samples (first ${cluster.emailSamples.length}):
${emailLines}`;
  });

  return `Split these ${input.clusters.length} coarse clusters into specific cases:

${clusterSections.join("\n\n")}

Return ONLY the JSON object. No other text.`;
}

/**
 * Builds a prompt pair for Claude to split coarse entity clusters into cases
 * using discriminator words from frequency analysis.
 * Pure function, no I/O.
 */
export function buildCaseSplittingPrompt(input: CaseSplittingInput): CaseSplittingPromptResult {
  return {
    system: buildSystemPrompt(input),
    user: buildUserPrompt(input),
  };
}
