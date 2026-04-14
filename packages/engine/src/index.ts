export { jaro, jaroWinkler, fuzzyMatch, resolveEntity } from "./entity/matching";

export {
  normalizeSubject,
  threadScore,
  subjectScore,
  actorScore,
  timeDecayMultiplier,
} from "./clustering/scoring";

export {
  scoreEmailAgainstCase,
  findBestCase,
  clusterEmails,
} from "./clustering/gravity-model";

export { isReminder } from "./clustering/reminder-detection";

export { generateFingerprint, matchAction } from "./actions/dedup";

export { analyzeWordFrequencies } from "./clustering/frequency-analysis";
export type {
  FrequencyEmailInput,
  CoarseClusterInput,
} from "./clustering/frequency-analysis";

export { computeNextActionDate, computeCaseDecay } from "./actions/lifecycle";
export type { CaseDecayInput, CaseDecayResult, ActionDateInput } from "./actions/lifecycle";
