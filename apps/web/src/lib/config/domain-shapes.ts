// Runtime configuration derived from docs/domain-input-shapes/<domain>.md.
// Phase 5's spec-compliance test enforces byte-level sync between this file
// and the Stage 1 keyword lists + Stage 2 rule selectors in the spec files.
// DO NOT edit the values here without updating the spec file first.

export type DomainName = "property" | "school_parent" | "agency";
export type Stage2Algorithm =
  | "property-address"
  | "school-two-pattern"
  | "agency-domain-derive";

export interface DomainShape {
  domain: DomainName;
  // Stage 1: subject keyword list used to build the Gmail metadata query
  stage1Keywords: readonly string[];
  // Stage 1: how many top candidate domains to return (property=3, school=5, agency=5)
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
    throw new Error(
      `Unknown domain: ${domain}. Known: ${Object.keys(DOMAIN_SHAPES).join(", ")}`,
    );
  }
  return DOMAIN_SHAPES[domain as DomainName];
}
