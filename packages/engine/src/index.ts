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
export type { AggregateOptions, DomainCandidate } from "./discovery/domain-aggregator";
export { aggregateDomains } from "./discovery/domain-aggregator";
export { isPlatformDomain, PLATFORM_DENYLIST } from "./discovery/platform-denylist";
export { isPublicProvider, PUBLIC_PROVIDERS } from "./discovery/public-providers";
export type {
  CandidateSignal,
  ScoreDomainCandidatesInput,
  ScoredDomainCandidate,
  ScoringEntityGroup,
  ScoringWhatResult,
  ScoringWhoResult,
} from "./discovery/score-domain-candidates";
export {
  MIN_SCORE_THRESHOLD,
  scoreDomainCandidates,
  UNSUBSCRIBE_VETO_THRESHOLD,
} from "./discovery/score-domain-candidates";
export type {
  EntitySignal,
  ScoredEntityCandidate,
  ScoreEntityCandidatesInput,
  ScoringEntityCandidate,
} from "./discovery/score-entity-candidates";
export {
  MIN_ENTITY_SCORE_THRESHOLD,
  scoreEntityCandidates,
} from "./discovery/score-entity-candidates";
export type {
  SchemaDomainName,
  SpecViolationCode,
  ValidationResult,
} from "./discovery/spec-validators";
export { validateEntityAgainstSpec } from "./discovery/spec-validators";
export type { FromHeaderResult } from "./discovery/types";
export { fuzzyMatch, jaro, jaroWinkler, resolveEntity } from "./entity/matching";
