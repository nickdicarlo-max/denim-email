import { describe, it, expect } from "vitest";
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
});
