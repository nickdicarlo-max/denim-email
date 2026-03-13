/**
 * Interview and schema configuration types.
 * Used by @denim/ai prompts and apps/web services.
 */

export interface InterviewInput {
  role: string;
  domain: string;
  whats: string[];
  whos: string[];
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
  tagMatchScore: number;
  subjectMatchScore: number;
  actorAffinityScore: number;
  subjectAdditiveBonus: number;
  timeDecayDays: { fresh: number; recent: number; stale: number };
  weakTagDiscount: number;
  frequencyThreshold: number;
  anchorTagLimit: number;
  caseSizeThreshold: number;
  caseSizeMaxBonus: number;
  reminderCollapseEnabled: boolean;
  reminderSubjectSimilarity: number;
  reminderMaxAge: number;
}

export interface HypothesisValidation {
  confirmedEntities: string[];
  discoveredEntities: {
    name: string;
    type: "PRIMARY" | "SECONDARY";
    secondaryTypeName: string | null;
    confidence: number;
    source: string;
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
