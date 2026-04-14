import { describe, expect, it } from "vitest";
import { parseValidationResponse } from "../parsers/validation-parser";

const baseEntity = {
  name: "Soccer Team",
  type: "PRIMARY" as const,
  secondaryTypeName: null,
  confidence: 0.9,
  source: "discovered",
};

const baseResponse = {
  confirmedEntities: [],
  discoveredEntities: [],
  confirmedTags: [],
  suggestedTags: [],
  noisePatterns: [],
  confidenceScore: 0.9,
};

describe("parseValidationResponse: relatedUserThing", () => {
  it("parses an explicit string value", () => {
    const raw = JSON.stringify({
      ...baseResponse,
      discoveredEntities: [
        {
          ...baseEntity,
          relatedUserThing: "soccer",
        },
      ],
    });

    const result = parseValidationResponse(raw);

    expect(result.discoveredEntities).toHaveLength(1);
    expect(result.discoveredEntities[0].relatedUserThing).toBe("soccer");
  });

  it("defaults to null when the field is omitted", () => {
    const entityWithoutField = { ...baseEntity };
    const raw = JSON.stringify({
      ...baseResponse,
      discoveredEntities: [entityWithoutField],
    });

    const result = parseValidationResponse(raw);

    expect(result.discoveredEntities).toHaveLength(1);
    expect(result.discoveredEntities[0].relatedUserThing).toBeNull();
  });

  it("parses an explicit null value", () => {
    const raw = JSON.stringify({
      ...baseResponse,
      discoveredEntities: [
        {
          ...baseEntity,
          relatedUserThing: null,
        },
      ],
    });

    const result = parseValidationResponse(raw);

    expect(result.discoveredEntities).toHaveLength(1);
    expect(result.discoveredEntities[0].relatedUserThing).toBeNull();
  });

  it("round-trips parse -> serialize -> parse producing equal objects", () => {
    const raw = JSON.stringify({
      ...baseResponse,
      discoveredEntities: [
        {
          ...baseEntity,
          relatedUserThing: "soccer",
        },
        {
          ...baseEntity,
          name: "Band",
          relatedUserThing: null,
        },
      ],
    });

    const first = parseValidationResponse(raw);
    const serialized = JSON.stringify(first);
    const second = parseValidationResponse(serialized);

    expect(second).toEqual(first);
    expect(second.discoveredEntities[0].relatedUserThing).toBe("soccer");
    expect(second.discoveredEntities[1].relatedUserThing).toBeNull();
  });

  it("throws a Zod validation error when relatedUserThing is not a string or null", () => {
    const raw = JSON.stringify({
      ...baseResponse,
      discoveredEntities: [
        {
          ...baseEntity,
          relatedUserThing: 123,
        },
      ],
    });

    expect(() => parseValidationResponse(raw)).toThrow();
  });
});
