import { describe, expect, it } from "vitest";
import { parseCaseSplittingResponse } from "../parsers/case-splitting-parser";

const validCase = (overrides: Record<string, unknown> = {}) => ({
  caseTitle: "Soccer Practices",
  discriminators: ["practice", "training"],
  emailIds: ["e1", "e2"],
  reasoning: "Weekly practice schedule emails grouped together.",
  ...overrides,
});

describe("parseCaseSplittingResponse: happy path", () => {
  it("parses a well-formed response", () => {
    const raw = JSON.stringify({
      cases: [validCase()],
      catchAllEmailIds: ["e9"],
      reasoning: "One case identified.",
    });
    const result = parseCaseSplittingResponse(raw);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].caseTitle).toBe("Soccer Practices");
    expect(result.catchAllEmailIds).toEqual(["e9"]);
  });

  it("strips code fences before parsing", () => {
    const raw = "```json\n" + JSON.stringify({
      cases: [validCase()],
      catchAllEmailIds: [],
      reasoning: "ok",
    }) + "\n```";
    const result = parseCaseSplittingResponse(raw);
    expect(result.cases).toHaveLength(1);
  });
});

describe("parseCaseSplittingResponse: resilient salvage", () => {
  it("drops a case with empty discriminators and salvages its emailIds to catchAll", () => {
    // This is the exact shape Claude returned for schema 01KP6Z08X7QWQE11V1P045D6NG
    // on 2026-04-14 — one bad sub-case previously nuked the entire stage.
    const raw = JSON.stringify({
      cases: [
        validCase({ caseTitle: "Soccer Practices", emailIds: ["e1", "e2"] }),
        validCase({ caseTitle: "Soccer Games", emailIds: ["e3"] }),
        {
          caseTitle: "Mystery Category",
          discriminators: [], // <-- violates min(1)
          emailIds: ["e4", "e5"],
          reasoning: "no discriminators emitted",
        },
        validCase({ caseTitle: "Registration", emailIds: ["e6"] }),
      ],
      catchAllEmailIds: ["e7"],
      reasoning: "split produced 4 cases, one without discriminators",
    });

    const result = parseCaseSplittingResponse(raw);

    expect(result.cases).toHaveLength(3);
    expect(result.cases.map((c) => c.caseTitle)).toEqual([
      "Soccer Practices",
      "Soccer Games",
      "Registration",
    ]);
    expect(result.catchAllEmailIds).toEqual(["e7", "e4", "e5"]);
  });

  it("salvages from a case missing required fields entirely", () => {
    const raw = JSON.stringify({
      cases: [
        validCase(),
        { emailIds: ["orphan-1", "orphan-2"] }, // missing caseTitle/discriminators/reasoning
      ],
      catchAllEmailIds: [],
      reasoning: "partial",
    });

    const result = parseCaseSplittingResponse(raw);
    expect(result.cases).toHaveLength(1);
    expect(result.catchAllEmailIds).toEqual(["orphan-1", "orphan-2"]);
  });

  it("handles a case whose emailIds is not an array (skips salvage safely)", () => {
    const raw = JSON.stringify({
      cases: [
        validCase(),
        { caseTitle: "broken", discriminators: ["x"], emailIds: "not-an-array", reasoning: "x" },
      ],
      catchAllEmailIds: ["existing"],
      reasoning: "",
    });

    const result = parseCaseSplittingResponse(raw);
    expect(result.cases).toHaveLength(1);
    expect(result.catchAllEmailIds).toEqual(["existing"]);
  });

  it("returns an empty-cases result when every case is invalid", () => {
    const raw = JSON.stringify({
      cases: [
        { caseTitle: "bad1", discriminators: [], emailIds: ["a"], reasoning: "x" },
        { caseTitle: "bad2", discriminators: [], emailIds: ["b"], reasoning: "x" },
      ],
      catchAllEmailIds: [],
      reasoning: "all bad",
    });

    const result = parseCaseSplittingResponse(raw);
    expect(result.cases).toEqual([]);
    expect(result.catchAllEmailIds).toEqual(["a", "b"]);
  });
});

describe("parseCaseSplittingResponse: envelope failures still throw", () => {
  it("throws on unparseable JSON", () => {
    expect(() => parseCaseSplittingResponse("not json{")).toThrow(/Failed to parse/);
  });

  it("throws when the outer object lacks a cases array", () => {
    const raw = JSON.stringify({ cases: "nope", catchAllEmailIds: [], reasoning: "" });
    expect(() => parseCaseSplittingResponse(raw)).toThrow(/Invalid case splitting response/);
  });

  it("throws when the response isn't an object", () => {
    expect(() => parseCaseSplittingResponse(JSON.stringify(["a"]))).toThrow(
      /Invalid case splitting response/,
    );
  });
});
