export { generateFingerprint, matchAction } from "./actions/dedup";
export type { ActionDateInput, CaseDecayInput, CaseDecayResult } from "./actions/lifecycle";
export { computeCaseDecay, computeNextActionDate } from "./actions/lifecycle";
export type {
  CoarseClusterInput,
  FrequencyEmailInput,
} from "./clustering/frequency-analysis";
export { analyzeWordFrequencies } from "./clustering/frequency-analysis";
export {
  clusterEmails,
  findBestCase,
  scoreEmailAgainstCase,
} from "./clustering/gravity-model";
export { isReminder } from "./clustering/reminder-detection";
export {
  actorScore,
  normalizeSubject,
  subjectScore,
  threadScore,
  timeDecayMultiplier,
} from "./clustering/scoring";
export { fuzzyMatch, jaro, jaroWinkler, resolveEntity } from "./entity/matching";
