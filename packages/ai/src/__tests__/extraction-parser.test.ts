import type { ExtractionResult } from "@denim/types";
import { describe, expect, it } from "vitest";
import { parseExtractionResponse } from "../parsers/extraction-parser";

const VALID_FIXTURE: ExtractionResult = {
  summary:
    "Coach Smith confirmed the soccer practice schedule change to Thursday at 4pm due to field maintenance.",
  tags: ["Schedule", "Practice"],
  extractedData: {
    eventDate: "2026-03-15T16:00:00Z",
    eventLocation: "North Field",
  },
  detectedEntities: [
    { name: "Soccer Team", type: "PRIMARY", confidence: 1.0 },
    { name: "Coach Smith", type: "SECONDARY", confidence: 0.9 },
  ],
  isInternal: false,
  language: "en",
  relevanceScore: 1.0,
  relevanceEntity: "Soccer Team",
};

describe("parseExtractionResponse", () => {
  it("parses a valid complete response correctly", () => {
    const raw = JSON.stringify(VALID_FIXTURE);
    const result = parseExtractionResponse(raw);

    expect(result.summary).toBe(VALID_FIXTURE.summary);
    expect(result.tags).toEqual(["Schedule", "Practice"]);
    expect(result.extractedData).toEqual({
      eventDate: "2026-03-15T16:00:00Z",
      eventLocation: "North Field",
    });
    expect(result.detectedEntities).toHaveLength(2);
    expect(result.detectedEntities[0].name).toBe("Soccer Team");
    expect(result.isInternal).toBe(false);
    expect(result.language).toBe("en");
  });

  it("parses with empty tags array", () => {
    const fixture = { ...VALID_FIXTURE, tags: [] };
    const result = parseExtractionResponse(JSON.stringify(fixture));

    expect(result.tags).toEqual([]);
  });

  it("parses with empty detectedEntities array", () => {
    const fixture = { ...VALID_FIXTURE, detectedEntities: [] };
    const result = parseExtractionResponse(JSON.stringify(fixture));

    expect(result.detectedEntities).toEqual([]);
  });

  it("throws on missing summary field", () => {
    const { summary: _, ...incomplete } = VALID_FIXTURE;
    const raw = JSON.stringify(incomplete);

    expect(() => parseExtractionResponse(raw)).toThrow("Invalid extraction response");
  });

  it("throws when tags is a string instead of array", () => {
    const bad = { ...VALID_FIXTURE, tags: "Schedule" };
    const raw = JSON.stringify(bad);

    expect(() => parseExtractionResponse(raw)).toThrow("Invalid extraction response");
  });

  it("throws when detectedEntities has invalid enum type", () => {
    const bad = {
      ...VALID_FIXTURE,
      detectedEntities: [
        { name: "Soccer Team", type: "TERTIARY", confidence: 0.8 },
      ],
    };
    const raw = JSON.stringify(bad);

    expect(() => parseExtractionResponse(raw)).toThrow("Invalid extraction response");
  });

  it("throws on malformed JSON", () => {
    const raw = "{ this is not valid json !!!";

    expect(() => parseExtractionResponse(raw)).toThrow(
      "Failed to parse extraction response as JSON",
    );
  });

  it("strips markdown code fences before parsing", () => {
    const raw = `\`\`\`json\n${JSON.stringify(VALID_FIXTURE)}\n\`\`\``;
    const result = parseExtractionResponse(raw);

    expect(result.summary).toBe(VALID_FIXTURE.summary);
    expect(result.tags).toEqual(["Schedule", "Practice"]);
    expect(result.detectedEntities).toHaveLength(2);
  });

  it("parses relevanceScore and relevanceEntity", () => {
    const result = parseExtractionResponse(JSON.stringify(VALID_FIXTURE));

    expect(result.relevanceScore).toBe(1.0);
    expect(result.relevanceEntity).toBe("Soccer Team");
  });

  it("defaults relevanceScore to 1.0 when missing (backward compat)", () => {
    const { relevanceScore: _, relevanceEntity: __, ...withoutRelevance } = VALID_FIXTURE;
    const result = parseExtractionResponse(JSON.stringify(withoutRelevance));

    expect(result.relevanceScore).toBe(1.0);
    expect(result.relevanceEntity).toBeNull();
  });

  it("accepts low relevanceScore of 0.0", () => {
    const fixture = { ...VALID_FIXTURE, relevanceScore: 0.0, relevanceEntity: null };
    const result = parseExtractionResponse(JSON.stringify(fixture));

    expect(result.relevanceScore).toBe(0.0);
    expect(result.relevanceEntity).toBeNull();
  });

  it("strips extra unknown fields gracefully", () => {
    const withExtra = {
      ...VALID_FIXTURE,
      unexpectedField: "should be stripped",
      anotherExtra: 42,
    };
    const raw = JSON.stringify(withExtra);
    const result = parseExtractionResponse(raw);

    expect(result.summary).toBe(VALID_FIXTURE.summary);
    expect(
      (result as unknown as Record<string, unknown>).unexpectedField,
    ).toBeUndefined();
    expect(
      (result as unknown as Record<string, unknown>).anotherExtra,
    ).toBeUndefined();
  });
});
