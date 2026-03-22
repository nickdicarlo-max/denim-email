/**
 * Interview and schema configuration types.
 * Used by @denim/ai prompts and apps/web services.
 */

export interface EntityGroupInput {
  whats: string[];   // PRIMARY entity names in this sub-group
  whos: string[];    // SECONDARY entity names in this sub-group
}

export interface InterviewInput {
  role: string;
  domain: string;
  whats: string[];             // Flattened from groups (backward compat)
  whos: string[];              // Flattened from groups (backward compat)
  groups: EntityGroupInput[];  // The paired structure — source of truth
  sharedWhos?: string[];       // Ungrouped WHOs — discovery senders, not routing targets
  goals: string[];
}

export interface SchemaHypothesis {
  domain: string;
  schemaName: string;
  primaryEntity: {
    name: string;
    description: string;
  };
  secondaryEntityTypes: {
    name: string;
    description: string;
    derivedFrom: "sender" | "extracted" | "both";
    affinityScore: number;
  }[];
  entities: EntitySuggestion[];
  tags: TagSuggestion[];
  extractedFields: ExtractedFieldSuggestion[];
  summaryLabels: {
    beginning: string;
    middle: string;
    end: string;
  };
  clusteringConfig: ClusteringConfig;
  discoveryQueries: DiscoveryQuery[];
  exclusionPatterns: string[];
}

export interface EntitySuggestion {
  name: string;
  type: "PRIMARY" | "SECONDARY";
  secondaryTypeName: string | null;
  aliases: string[];
  confidence: number;
  source: "user_input" | "email_scan" | "ai_inferred";
}

export interface DiscoveryQuery {
  query: string;
  label: string;
  entityName: string | null;
  source: "entity_name" | "domain_default" | "email_scan";
  groupIndex?: number;
}

export interface TagSuggestion {
  name: string;
  description: string;
  expectedFrequency: "high" | "medium" | "low";
  isActionable: boolean;
}

export interface ExtractedFieldSuggestion {
  name: string;
  type: "NUMBER" | "STRING" | "DATE" | "BOOLEAN";
  description: string;
  source: "BODY" | "ATTACHMENT" | "ANY";
  format: string;
  showOnCard: boolean;
  aggregation: "SUM" | "LATEST" | "MAX" | "MIN" | "COUNT" | "FIRST";
}

export interface ClusteringConfig {
  mergeThreshold: number;
  threadMatchScore: number;
  subjectMatchScore: number;
  actorAffinityScore: number;
  timeDecayDays: { fresh: number };
  reminderCollapseEnabled: boolean;
  reminderSubjectSimilarity: number;
  reminderMaxAge: number;
}

export interface ExtractionInput {
  subject: string;
  sender: string;
  senderEmail: string;
  senderDomain: string;
  senderDisplayName: string;
  date: string; // ISO string
  body: string;
  isReply: boolean;
}

export interface ExtractionSchemaContext {
  domain: string;
  tags: { name: string; description: string }[];
  entities: { name: string; type: "PRIMARY" | "SECONDARY"; aliases: string[]; isUserInput: boolean }[];
  extractedFields: { name: string; type: string; description: string; source: string }[];
  exclusionPatterns: string[];
  entityGroups?: EntityGroupInput[];
}

export interface DetectedEntity {
  name: string;
  type: "PRIMARY" | "SECONDARY";
  confidence: number;
}

export interface ExtractionResult {
  summary: string;
  tags: string[];
  extractedData: Record<string, unknown>;
  detectedEntities: DetectedEntity[];
  isInternal: boolean;
  language: string | null;
  relevanceScore: number;
  relevanceEntity: string | null;
}

// =============================================================================
// CLUSTERING ENGINE TYPES
// =============================================================================

/** Email shape for the clustering engine (pure data, no Prisma). */
export interface ClusterEmailInput {
  id: string;
  threadId: string;
  subject: string;
  summary: string;
  tags: string[];
  date: Date;
  senderEntityId: string | null;
  entityId: string | null;
}

/** Existing case shape for scoring (pure data, no Prisma). */
export interface ClusterCaseInput {
  id: string;
  entityId: string;
  threadIds: string[];
  senderEntityIds: string[];
  subject: string;
  emailCount: number;
  lastEmailDate: Date;
}

/** Audit trail for a single email-vs-case scoring. */
export interface ScoreBreakdown {
  threadScore: number;
  subjectScore: number;
  actorScore: number;
  timeDecayMultiplier: number;
  rawScore: number;
  finalScore: number;
}

/** Result of scoring one email against one case. */
export interface ScoringResult {
  caseId: string;
  score: number;
  breakdown: ScoreBreakdown;
}

/** Result of finding best + alternative case match. */
export interface BestCaseResult {
  best: ScoringResult;
  alternative: ScoringResult | null;
}

/** Output decision for a thread group. */
export interface ClusterDecision {
  action: "MERGE" | "CREATE";
  targetCaseId: string | null;
  alternativeCaseId: string | null;
  emailIds: string[];
  threadIds: string[];
  score: number;
  breakdown: ScoreBreakdown | null;
  primaryTag: string | null;
  entityId: string | null;
}

/** Tag frequency data for weak tag discount (legacy, kept for compatibility). */
export interface TagFrequencyMap {
  [tagName: string]: { frequency: number; isWeak: boolean };
}

// =============================================================================
// FREQUENCY ANALYSIS TYPES (Two-Pass Clustering)
// =============================================================================

/** Word frequency entry for a single cluster. */
export interface FrequencyWord {
  word: string;
  frequency: number;       // 0.0-1.0 within cluster
  weightedScore: number;   // frequency adjusted by source weight + cross-entity penalty
  emailIds: string[];      // which emails contain this word
  coOccursWith: string[];  // words that frequently appear alongside this one
}

/** Frequency table for one coarse cluster. */
export interface FrequencyTable {
  clusterId: string;
  entityName: string;
  emailCount: number;
  words: FrequencyWord[];
}

/** A case definition output from AI case splitting. */
export interface CaseSplitDefinition {
  caseTitle: string;
  discriminators: string[];   // words that identify this case
  emailIds: string[];         // emails assigned to this case
  reasoning: string;
}

/** Result of case splitting (AI or deterministic). */
export interface CaseSplitResult {
  cases: CaseSplitDefinition[];
  catchAllEmailIds: string[];   // emails with no discriminator match
  reasoning: string;
}

/** Input for the clustering calibration AI call. */
export interface CalibrationInput {
  currentConfig: ClusteringConfig;
  coarseClusters: {
    entityName: string;
    emailCount: number;
    casesSplit: number;
  }[];
  frequencyTables: Record<string, { word: string; pct: number; caseAssignment: string }[]>;
  corrections: {
    type: "EMAIL_MOVED" | "CASES_MERGED" | "THUMBS_UP" | "THUMBS_DOWN";
    from?: string;
    to?: string;
    cases?: string[];
    caseId?: string;
  }[];
}

/** Result of the clustering calibration AI call. */
export interface CalibrationResult {
  tunedConfig: {
    mergeThreshold: number;
    subjectMatchScore: number;
    actorAffinityScore: number;
    timeDecayFreshDays: number;
  };
  discriminatorVocabulary: Record<string, {
    words: Record<string, number>;   // word → confidence score
    mergedAway: string[];            // words that should NOT discriminate
  }>;
  reasoning: string;
}

/** Quality phase for learning loop. */
export type QualityPhaseType = "CALIBRATING" | "TRACKING" | "STABLE";

// =============================================================================
// SYNTHESIS TYPES
// =============================================================================

export interface SynthesisEmailInput {
  id: string;
  subject: string;
  senderDisplayName: string;
  senderEmail: string;
  date: string;
  summary: string;
  tags: string[];
  isReply: boolean;
}

export interface SynthesisSchemaContext {
  domain: string;
  summaryLabels: { beginning: string; middle: string; end: string };
  tags: { name: string; description: string }[];
  entities: { name: string; type: string }[];
  extractedFields: { name: string; type: string; description: string }[];
}

export type UrgencyLevel = "IMMINENT" | "THIS_WEEK" | "UPCOMING" | "NO_ACTION" | "IRRELEVANT";

export interface SynthesisResult {
  title: string;
  summary: {
    beginning: string;
    middle: string;
    end: string;
  };
  displayTags: string[];
  primaryActor: {
    name: string;
    entityType: string;
  } | null;
  actions: SynthesisAction[];
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  urgency: UrgencyLevel;
}

export interface SynthesisAction {
  title: string;
  description: string | null;
  actionType: "TASK" | "EVENT" | "PAYMENT" | "DEADLINE" | "RESPONSE";
  dueDate: string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  eventLocation: string | null;
  confidence: number;
  amount: number | null;
  currency: string | null;
  sourceEmailId: string | null;
}

// =============================================================================
// CLUSTERING INTELLIGENCE TYPES
// =============================================================================

export interface ClusteringIntelligenceEmail {
  id: string;
  subject: string;
  senderDisplayName: string;
  senderDomain: string;
  date: string;
  summary: string;
  tags: string[];
  entityName: string | null;
}

export interface HypothesisValidation {
  confirmedEntities: string[];
  discoveredEntities: {
    name: string;
    type: "PRIMARY" | "SECONDARY";
    secondaryTypeName: string | null;
    confidence: number;
    source: string;
    emailCount?: number;
  }[];
  confirmedTags: string[];
  suggestedTags: {
    name: string;
    description: string;
    expectedFrequency: string;
    isActionable: boolean;
  }[];
  noisePatterns: string[];
  sampleEmailCount: number;
  scanDurationMs: number;
  confidenceScore: number;
}
