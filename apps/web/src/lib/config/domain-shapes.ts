// Runtime configuration derived from docs/domain-input-shapes/<domain>.md.
//
// 2026-04-23: Stage 1 no longer consumes `stage1Keywords` as a Gmail query
// driver. The hint-anchored compounding-signal scorer in
// `@denim/engine/discovery/score-domain-candidates` replaced the
// shape-keyword OR-search. These keyword lists and `stage1TopN` are
// retained as Stage 2 prompt decoration and domain-shape metadata (the
// Gemini subject-pass passes `schemaDomain` into the prompt; tests still
// assert the shape is stable). Per the `specs describe goals, not
// procedures` editorial rule, these values will eventually move entirely
// into tunables and the spec files will describe only the WHAT.

export type DomainName = "property" | "school_parent" | "agency";
export type Stage2Algorithm = "property-address" | "school-two-pattern" | "agency-domain-derive";

export interface DomainShape {
  domain: DomainName;
  /**
   * Legacy field — previously drove the Stage 1 subject-keyword OR-search.
   * NOT used by Stage 1 anymore (see the orchestrator in
   * `apps/web/src/lib/discovery/stage1-orchestrator.ts`). Kept as Stage 2
   * prompt-context hints and for domain-metadata tests; will be removed
   * when Phase 3.5 refactors the domain-input-shapes specs.
   */
  stage1Keywords: readonly string[];
  /**
   * Legacy field — previously capped the Stage 1 top-N domain aggregation.
   * NOT used anymore; the new compounding-signal scorer returns every
   * candidate that clears the score threshold.
   */
  stage1TopN: number;
  // Stage 2: which algorithm variant to dispatch
  stage2Algorithm: Stage2Algorithm;
}

export const DOMAIN_SHAPES: Record<DomainName, DomainShape> = {
  property: {
    domain: "property",
    stage1Keywords: [
      "invoice",
      "repair",
      "leak",
      "rent",
      "balance",
      "statement",
      "application",
      "marketing",
      "lease",
      "estimate",
      "inspection",
      "work order",
      "renewal",
    ],
    stage1TopN: 3,
    stage2Algorithm: "property-address",
  },
  school_parent: {
    domain: "school_parent",
    stage1Keywords: [
      "practice",
      "game",
      "tournament",
      "schedule",
      "registration",
      "tryout",
      "recital",
      "performance",
      "pickup",
      "dropoff",
      "permission",
      "field trip",
      "parent",
      "teacher",
      "coach",
      "homework",
      "report card",
      "conference",
      "appointment",
    ],
    stage1TopN: 5,
    stage2Algorithm: "school-two-pattern",
  },
  agency: {
    domain: "agency",
    stage1Keywords: [
      "invoice",
      "scope",
      "deliverable",
      "review",
      "deck",
      "proposal",
      "contract",
      "retainer",
      "kickoff",
      "status",
      "deadline",
      "agreement",
      "RFP",
      "SOW",
      "milestone",
      "feedback",
      "approval",
      "draft",
      "call",
      "meeting",
      "session",
      "update",
      "slides",
      "documents",
      "demo",
      "round",
      "initiative",
      "project",
    ],
    stage1TopN: 5,
    stage2Algorithm: "agency-domain-derive",
  },
};

export function getDomainShape(domain: string): DomainShape {
  if (!(domain in DOMAIN_SHAPES)) {
    throw new Error(`Unknown domain: ${domain}. Known: ${Object.keys(DOMAIN_SHAPES).join(", ")}`);
  }
  return DOMAIN_SHAPES[domain as DomainName];
}
