import type { SynthesisResult } from "@denim/types";
import { describe, expect, it } from "vitest";
import { parseSynthesisResponse } from "../parsers/synthesis-parser";

const VALID_FIXTURE: SynthesisResult = {
  title: "Kitchen Remodel Permits",
  summary: {
    beginning: "City planning department initiated permit review for kitchen remodel.",
    middle: "Multiple inspections scheduled. Contractor submitted revised plans.",
    end: "Awaiting final approval from building department.",
  },
  displayTags: ["Permits", "Timeline"],
  primaryActor: {
    name: "City Planning Dept",
    entityType: "Vendor",
  },
  actions: [
    {
      title: "Submit revised floor plan",
      description: "Updated floor plan with electrical layout changes",
      actionType: "TASK",
      dueDate: "2026-03-20",
      eventStartTime: null,
      eventEndTime: null,
      eventLocation: null,
      confidence: 0.9,
      amount: null,
      currency: null,
      sourceEmailId: "email_123",
    },
    {
      title: "Pay permit fee",
      description: null,
      actionType: "PAYMENT",
      dueDate: "2026-03-25",
      eventStartTime: null,
      eventEndTime: null,
      eventLocation: null,
      confidence: 0.85,
      amount: 450,
      currency: "USD",
      sourceEmailId: "email_456",
    },
  ],
  status: "IN_PROGRESS",
  urgency: "UPCOMING",
};

describe("parseSynthesisResponse", () => {
  it("parses a valid complete response correctly", () => {
    const raw = JSON.stringify(VALID_FIXTURE);
    const result = parseSynthesisResponse(raw);

    expect(result.title).toBe("Kitchen Remodel Permits");
    expect(result.summary.beginning).toContain("City planning");
    expect(result.summary.middle).toContain("inspections");
    expect(result.summary.end).toContain("Awaiting");
    expect(result.displayTags).toEqual(["Permits", "Timeline"]);
    expect(result.primaryActor).toEqual({
      name: "City Planning Dept",
      entityType: "Vendor",
    });
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].actionType).toBe("TASK");
    expect(result.actions[1].amount).toBe(450);
    expect(result.status).toBe("IN_PROGRESS");
  });

  it("parses with null primaryActor", () => {
    const fixture = { ...VALID_FIXTURE, primaryActor: null };
    const result = parseSynthesisResponse(JSON.stringify(fixture));

    expect(result.primaryActor).toBeNull();
  });

  it("parses with empty actions array", () => {
    const fixture = { ...VALID_FIXTURE, actions: [] };
    const result = parseSynthesisResponse(JSON.stringify(fixture));

    expect(result.actions).toEqual([]);
  });

  it("parses with empty displayTags", () => {
    const fixture = { ...VALID_FIXTURE, displayTags: [] };
    const result = parseSynthesisResponse(JSON.stringify(fixture));

    expect(result.displayTags).toEqual([]);
  });

  it("throws on missing title", () => {
    const { title: _, ...incomplete } = VALID_FIXTURE;
    expect(() => parseSynthesisResponse(JSON.stringify(incomplete))).toThrow(
      "Invalid synthesis response",
    );
  });

  it("throws when title exceeds 60 characters", () => {
    const fixture = { ...VALID_FIXTURE, title: "A".repeat(61) };
    expect(() => parseSynthesisResponse(JSON.stringify(fixture))).toThrow(
      "Invalid synthesis response",
    );
  });

  it("throws on invalid action type", () => {
    const fixture = {
      ...VALID_FIXTURE,
      actions: [
        { ...VALID_FIXTURE.actions[0], actionType: "INVALID" },
      ],
    };
    expect(() => parseSynthesisResponse(JSON.stringify(fixture))).toThrow(
      "Invalid synthesis response",
    );
  });

  it("throws on invalid status", () => {
    const fixture = { ...VALID_FIXTURE, status: "UNKNOWN" };
    expect(() => parseSynthesisResponse(JSON.stringify(fixture))).toThrow(
      "Invalid synthesis response",
    );
  });

  it("throws on malformed JSON", () => {
    expect(() => parseSynthesisResponse("{ not valid json!!!")).toThrow(
      "Failed to parse synthesis response as JSON",
    );
  });

  it("strips markdown code fences before parsing", () => {
    const raw = `\`\`\`json\n${JSON.stringify(VALID_FIXTURE)}\n\`\`\``;
    const result = parseSynthesisResponse(raw);

    expect(result.title).toBe("Kitchen Remodel Permits");
    expect(result.actions).toHaveLength(2);
  });

  it("strips extra unknown fields gracefully", () => {
    const withExtra = {
      ...VALID_FIXTURE,
      unexpectedField: "should be stripped",
    };
    const result = parseSynthesisResponse(JSON.stringify(withExtra));

    expect(result.title).toBe("Kitchen Remodel Permits");
    expect(
      (result as unknown as Record<string, unknown>).unexpectedField,
    ).toBeUndefined();
  });

  it("validates action confidence range", () => {
    const fixture = {
      ...VALID_FIXTURE,
      actions: [
        { ...VALID_FIXTURE.actions[0], confidence: 1.5 },
      ],
    };
    expect(() => parseSynthesisResponse(JSON.stringify(fixture))).toThrow(
      "Invalid synthesis response",
    );
  });
});
