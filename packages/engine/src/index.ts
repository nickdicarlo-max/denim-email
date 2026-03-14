export { jaro, jaroWinkler, fuzzyMatch, resolveEntity } from "./entity/matching";

export {
  normalizeSubject,
  threadScore,
  tagScore,
  subjectScore,
  actorScore,
  caseSizeBonus,
  timeDecayMultiplier,
} from "./clustering/scoring";

export {
  scoreEmailAgainstCase,
  findBestCase,
  clusterEmails,
  computeAnchorTags,
} from "./clustering/gravity-model";

export { isReminder } from "./clustering/reminder-detection";

export { generateFingerprint, matchAction } from "./actions/dedup";
