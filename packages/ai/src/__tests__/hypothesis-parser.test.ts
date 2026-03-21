import type { SchemaHypothesis } from "@denim/types";
import { describe, expect, it } from "vitest";
import { parseHypothesisResponse } from "../parsers/hypothesis-parser";

const VALID_FIXTURE: SchemaHypothesis = {
  domain: "school_parent",
  schemaName: "School Activities",
  primaryEntity: {
    name: "Activity",
    description: "A school activity, sport, or program your child participates in",
  },
  secondaryEntityTypes: [
    {
      name: "Coach",
      description: "Athletic coaches and team leaders",
      derivedFrom: "sender",
      affinityScore: 0.8,
    },
    {
      name: "Teacher",
      description: "Classroom teachers and instructors",
      derivedFrom: "sender",
      affinityScore: 0.7,
    },
  ],
  entities: [
    {
      name: "Soccer Team",
      type: "PRIMARY",
      secondaryTypeName: null,
      aliases: ["Soccer", "Boys Soccer", "JV Soccer"],
      confidence: 1.0,
      source: "user_input",
    },
    {
      name: "Band",
      type: "PRIMARY",
      secondaryTypeName: null,
      aliases: ["Concert Band", "Marching Band"],
      confidence: 1.0,
      source: "user_input",
    },
    {
      name: "Coach Smith",
      type: "SECONDARY",
      secondaryTypeName: "Coach",
      aliases: ["J. Smith", "Coach S"],
      confidence: 1.0,
      source: "user_input",
    },
  ],
  tags: [
    {
      name: "Action Required",
      description: "Requires parent action",
      expectedFrequency: "high",
      isActionable: true,
    },
    {
      name: "Schedule",
      description: "Schedule changes",
      expectedFrequency: "high",
      isActionable: false,
    },
    {
      name: "Payment",
      description: "Fees or dues",
      expectedFrequency: "medium",
      isActionable: true,
    },
    {
      name: "Permission/Form",
      description: "Forms needing signature",
      expectedFrequency: "medium",
      isActionable: true,
    },
    {
      name: "Game/Match",
      description: "Game schedules",
      expectedFrequency: "medium",
      isActionable: false,
    },
  ],
  extractedFields: [
    {
      name: "eventDate",
      type: "DATE",
      description: "Date of the event or activity",
      source: "BODY",
      format: "ISO 8601",
      showOnCard: true,
      aggregation: "LATEST",
    },
    {
      name: "eventLocation",
      type: "STRING",
      description: "Location of the event",
      source: "BODY",
      format: "",
      showOnCard: false,
      aggregation: "LATEST",
    },
    {
      name: "amount",
      type: "NUMBER",
      description: "Dollar amount for fees or dues",
      source: "BODY",
      format: "USD",
      showOnCard: false,
      aggregation: "SUM",
    },
  ],
  summaryLabels: {
    beginning: "What",
    middle: "Details",
    end: "Action Needed",
  },
  clusteringConfig: {
    mergeThreshold: 35,
    threadMatchScore: 100,
    subjectMatchScore: 20,
    actorAffinityScore: 10,
    timeDecayDays: { fresh: 60 },
    reminderCollapseEnabled: true,
    reminderSubjectSimilarity: 0.85,
    reminderMaxAge: 7,
  },
  discoveryQueries: [
    {
      query: "subject:soccer",
      label: "Soccer emails",
      entityName: "Soccer Team",
      source: "entity_name",
    },
    {
      query: "subject:band",
      label: "Band emails",
      entityName: "Band",
      source: "entity_name",
    },
  ],
  exclusionPatterns: ["noreply@", "newsletter@", "marketing@"],
};

describe("parseHypothesisResponse", () => {
  it("parses a valid complete response correctly", () => {
    const raw = JSON.stringify(VALID_FIXTURE);
    const result = parseHypothesisResponse(raw);

    expect(result.domain).toBe("school_parent");
    expect(result.schemaName).toBe("School Activities");
    expect(result.entities).toHaveLength(3);
    expect(result.tags).toHaveLength(5);
    expect(result.clusteringConfig.mergeThreshold).toBe(35);
    expect(result.summaryLabels.beginning).toBe("What");
    expect(result.discoveryQueries).toHaveLength(2);
    expect(result.exclusionPatterns).toHaveLength(3);
  });

  it("throws on missing required field (no clusteringConfig)", () => {
    const { clusteringConfig: _, ...incomplete } = VALID_FIXTURE;
    const raw = JSON.stringify(incomplete);

    expect(() => parseHypothesisResponse(raw)).toThrow();
  });

  it("throws on wrong type (string where number expected)", () => {
    const bad = {
      ...VALID_FIXTURE,
      clusteringConfig: {
        ...VALID_FIXTURE.clusteringConfig,
        mergeThreshold: "not a number",
      },
    };
    const raw = JSON.stringify(bad);

    expect(() => parseHypothesisResponse(raw)).toThrow();
  });

  it("throws on empty tags array (minimum 3 required)", () => {
    const bad = { ...VALID_FIXTURE, tags: [] };
    const raw = JSON.stringify(bad);

    expect(() => parseHypothesisResponse(raw)).toThrow();
  });

  it("throws on empty entities array (minimum 1 required)", () => {
    const bad = { ...VALID_FIXTURE, entities: [] };
    const raw = JSON.stringify(bad);

    expect(() => parseHypothesisResponse(raw)).toThrow();
  });

  it("strips extra/unknown fields gracefully", () => {
    const withExtra = {
      ...VALID_FIXTURE,
      unexpectedField: "should be stripped",
      anotherExtra: 42,
    };
    const raw = JSON.stringify(withExtra);
    const result = parseHypothesisResponse(raw);

    expect(result.domain).toBe("school_parent");
    expect((result as unknown as Record<string, unknown>).unexpectedField).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).anotherExtra).toBeUndefined();
  });

  it("throws on malformed JSON string", () => {
    const raw = "{ this is not valid json !!!";

    expect(() => parseHypothesisResponse(raw)).toThrow();
  });

  it("handles JSON wrapped in markdown code fences", () => {
    const raw = `\`\`\`json\n${JSON.stringify(VALID_FIXTURE)}\n\`\`\``;
    const result = parseHypothesisResponse(raw);

    expect(result.domain).toBe("school_parent");
    expect(result.entities).toHaveLength(3);
    expect(result.tags).toHaveLength(5);
  });
});
