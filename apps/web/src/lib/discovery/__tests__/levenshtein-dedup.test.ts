import { describe, expect, it } from "vitest";
import { dedupByLevenshtein } from "../levenshtein-dedup";

describe("dedupByLevenshtein", () => {
  it("merges near-identical short strings under threshold 1", () => {
    const result = dedupByLevenshtein([
      { key: "Peavy", displayString: "851 Peavy", frequency: 3 },
      { key: "Peavy", displayString: "851 peavy", frequency: 2 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].displayString).toBe("851 Peavy");
    expect(result[0].frequency).toBe(5);
    expect(result[0].autoFixed).toBe(true);
  });

  it("merges Drive/Dr variants in property addresses", () => {
    const result = dedupByLevenshtein([
      { key: "2310 Healey", displayString: "2310 Healey Dr", frequency: 4 },
      { key: "2310 Healey", displayString: "2310 Healey Drive", frequency: 1 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(5);
  });

  it("picks higher-frequency display form on merge", () => {
    const result = dedupByLevenshtein([
      { key: "x", displayString: "Foo Bar", frequency: 2 },
      { key: "x", displayString: "Foo Baz", frequency: 5 },
    ]);
    expect(result[0].displayString).toBe("Foo Baz");
  });

  it("keeps distinct keys as separate groups", () => {
    const result = dedupByLevenshtein([
      { key: "A", displayString: "Foo", frequency: 1 },
      { key: "B", displayString: "Bar", frequency: 1 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("School_parent: 'St Agnes' variants merge", () => {
    const result = dedupByLevenshtein([
      { key: "stagnes", displayString: "St Agnes", frequency: 5 },
      { key: "stagnes", displayString: "St. Agnes", frequency: 3 },
      { key: "stagnes", displayString: "Saint Agnes", frequency: 2 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(10);
    expect(result[0].displayString).toBe("St Agnes");
  });

  it("short-threshold 1 rejects two-edit strings", () => {
    const result = dedupByLevenshtein([
      { key: "abc", displayString: "cat", frequency: 1 },
      { key: "abc", displayString: "dog", frequency: 1 },
    ]);
    expect(result).toHaveLength(2);
  });

  // #119: suffix-aware dedup for property addresses ------------------------
  describe("#119 stripTrailingSuffixes option", () => {
    const STREET = [
      "Drive",
      "Dr",
      "Road",
      "Rd",
      "Street",
      "St",
      "Trail",
      "Tr",
      "Trl",
      "Avenue",
      "Ave",
      "Lane",
      "Ln",
      "Court",
      "Ct",
      "Place",
      "Pl",
      "Way",
      "Blvd",
      "Boulevard",
    ];

    it("collapses short/long suffix pairs into a single candidate (longest wins)", () => {
      const result = dedupByLevenshtein(
        [
          { key: "851 peavy", displayString: "851 Peavy", frequency: 3 },
          { key: "851 peavy rd", displayString: "851 Peavy Road", frequency: 5 },
        ],
        { stripTrailingSuffixes: STREET },
      );
      expect(result).toHaveLength(1);
      // Verbose form wins per #119 spec — "the longest observed variant".
      expect(result[0].displayString).toBe("851 Peavy Road");
      expect(result[0].frequency).toBe(8);
      expect(result[0].autoFixed).toBe(true);
    });

    it("collapses all 8 short/long pairs from 2026-04-19 property run", () => {
      // Fixture mirrors today's live run. With the suffix stripper each
      // pair collapses to one entry.
      const input = [
        { key: "851 peavy", displayString: "851 Peavy", frequency: 1 },
        { key: "851 peavy rd", displayString: "851 Peavy Road", frequency: 1 },
        { key: "1501 sylvan", displayString: "1501 Sylvan", frequency: 1 },
        { key: "1501 sylvan dr", displayString: "1501 Sylvan Drive", frequency: 1 },
        { key: "1906 crockett", displayString: "1906 Crockett", frequency: 1 },
        { key: "1906 crockett st", displayString: "1906 Crockett Street", frequency: 1 },
        { key: "205 freedom", displayString: "205 Freedom", frequency: 1 },
        { key: "205 freedom trl", displayString: "205 Freedom Trail", frequency: 1 },
        { key: "2109 meadfoot", displayString: "2109 Meadfoot", frequency: 1 },
        { key: "2109 meadfoot rd", displayString: "2109 Meadfoot Road", frequency: 1 },
        { key: "2310 healey", displayString: "2310 Healey", frequency: 1 },
        { key: "2310 healey dr", displayString: "2310 Healey Drive", frequency: 1 },
        { key: "3910 bucknell", displayString: "3910 Bucknell", frequency: 1 },
        { key: "3910 bucknell dr", displayString: "3910 Bucknell Drive", frequency: 1 },
        { key: "1206 fairmont", displayString: "1206 Fairmont", frequency: 1 },
        { key: "1206 fairmont st", displayString: "1206 Fairmont Street", frequency: 1 },
      ];
      const result = dedupByLevenshtein(input, { stripTrailingSuffixes: STREET });
      expect(result).toHaveLength(8);
      const displays = new Set(result.map((r) => r.displayString));
      expect(displays).toContain("851 Peavy Road");
      expect(displays).toContain("1501 Sylvan Drive");
      expect(displays).toContain("1906 Crockett Street");
      expect(displays).toContain("205 Freedom Trail");
      expect(displays).toContain("2109 Meadfoot Road");
      expect(displays).toContain("2310 Healey Drive");
      expect(displays).toContain("3910 Bucknell Drive");
      expect(displays).toContain("1206 Fairmont Street");
    });

    it("no-op when option is undefined — legacy bucket/Levenshtein path", () => {
      // Regression guard for school / agency / Pattern C callers.
      const result = dedupByLevenshtein([
        { key: "851 peavy", displayString: "851 Peavy", frequency: 3 },
        { key: "851 peavy rd", displayString: "851 Peavy Road", frequency: 5 },
      ]);
      // Different keys → two outputs, unchanged from pre-#119 behavior.
      expect(result).toHaveLength(2);
    });

    it("no-op when suffix list is empty", () => {
      const result = dedupByLevenshtein(
        [
          { key: "851 peavy", displayString: "851 Peavy", frequency: 3 },
          { key: "851 peavy rd", displayString: "851 Peavy Road", frequency: 5 },
        ],
        { stripTrailingSuffixes: [] },
      );
      expect(result).toHaveLength(2);
    });

    it("does NOT strip suffix tokens in the middle of a string", () => {
      // "Drive Through Dr" — the middle "Drive" must survive; only the
      // trailing "Dr" strips. Two entries like "... Drive Through" and
      // "... Drive Through Dr" should collapse, but a single entry's middle
      // "Drive" token must not be stripped away.
      const result = dedupByLevenshtein(
        [
          { key: "Drive Through", displayString: "Drive Through", frequency: 1 },
          { key: "Elm Drive", displayString: "Elm Drive", frequency: 1 },
        ],
        { stripTrailingSuffixes: ["Drive"] },
      );
      // Two distinct buckets — "Drive Through" (middle token preserved)
      // and "Elm" (from "Elm Drive" stripped) — so two candidates.
      expect(result).toHaveLength(2);
      const displays = new Set(result.map((r) => r.displayString));
      expect(displays).toContain("Drive Through");
      expect(displays).toContain("Elm Drive");
    });
  });
});
