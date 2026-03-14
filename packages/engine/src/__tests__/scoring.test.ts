import { describe, expect, it } from "vitest";
import type { ClusteringConfig, TagFrequencyMap } from "@denim/types";
import {
  threadScore,
  tagScore,
  subjectScore,
  actorScore,
  caseSizeBonus,
  timeDecayMultiplier,
  normalizeSubject,
} from "../clustering/scoring";

const defaultConfig: ClusteringConfig = {
  mergeThreshold: 45,
  threadMatchScore: 100,
  tagMatchScore: 60,
  subjectMatchScore: 50,
  actorAffinityScore: 30,
  subjectAdditiveBonus: 25,
  timeDecayDays: { fresh: 45, recent: 75, stale: 120 },
  weakTagDiscount: 0.3,
  frequencyThreshold: 0.3,
  anchorTagLimit: 2,
  caseSizeThreshold: 10,
  caseSizeMaxBonus: 25,
  reminderCollapseEnabled: true,
  reminderSubjectSimilarity: 0.9,
  reminderMaxAge: 30,
};

describe("normalizeSubject", () => {
  it("strips RE: and FW: prefixes", () => {
    expect(normalizeSubject("RE: Hello")).toBe("hello");
    expect(normalizeSubject("Fw: FWD: RE: Test")).toBe("test");
  });

  it("lowercases", () => {
    expect(normalizeSubject("HELLO WORLD")).toBe("hello world");
  });
});

describe("threadScore", () => {
  it("returns config score on match", () => {
    expect(threadScore("t1", ["t1", "t2"], defaultConfig)).toBe(100);
  });

  it("returns 0 on no match", () => {
    expect(threadScore("t3", ["t1", "t2"], defaultConfig)).toBe(0);
  });
});

describe("tagScore", () => {
  const noWeak: TagFrequencyMap = {
    Permits: { frequency: 0.1, isWeak: false },
    HVAC: { frequency: 0.05, isWeak: false },
  };

  const withWeak: TagFrequencyMap = {
    Permits: { frequency: 0.5, isWeak: true },
    HVAC: { frequency: 0.05, isWeak: false },
  };

  it("scores single tag overlap", () => {
    const score = tagScore(["Permits"], ["Permits", "HVAC"], noWeak, defaultConfig);
    expect(score).toBe(30); // 60 / 2 anchorTagLimit
  });

  it("scores multiple tag overlaps", () => {
    const score = tagScore(["Permits", "HVAC"], ["Permits", "HVAC"], noWeak, defaultConfig);
    expect(score).toBe(60); // capped at tagMatchScore
  });

  it("applies weak tag discount", () => {
    const score = tagScore(["Permits"], ["Permits"], withWeak, defaultConfig);
    expect(score).toBe(30 * 0.3); // perTag * weakDiscount
  });

  it("returns 0 for no overlap", () => {
    expect(tagScore(["Plumbing"], ["Permits"], noWeak, defaultConfig)).toBe(0);
  });

  it("returns 0 for empty arrays", () => {
    expect(tagScore([], ["Permits"], noWeak, defaultConfig)).toBe(0);
    expect(tagScore(["Permits"], [], noWeak, defaultConfig)).toBe(0);
  });
});

describe("subjectScore", () => {
  it("scores identical subjects at full config value", () => {
    const score = subjectScore("Kitchen Remodel", "Kitchen Remodel", defaultConfig);
    expect(score).toBe(50); // similarity = 1.0
  });

  it("scores similar subjects with RE: stripped", () => {
    const score = subjectScore("RE: Kitchen Remodel", "Kitchen Remodel", defaultConfig);
    expect(score).toBe(50); // RE: stripped, identical
  });

  it("returns 0 for different subjects", () => {
    const score = subjectScore("Kitchen Remodel", "Bathroom Tile", defaultConfig);
    expect(score).toBe(0); // below 0.7 threshold
  });

  it("returns 0 for empty subjects", () => {
    expect(subjectScore("", "Kitchen Remodel", defaultConfig)).toBe(0);
    expect(subjectScore("Kitchen Remodel", "", defaultConfig)).toBe(0);
  });
});

describe("actorScore", () => {
  it("returns config score on match", () => {
    expect(actorScore("e1", ["e1", "e2"], defaultConfig)).toBe(30);
  });

  it("returns 0 on no match", () => {
    expect(actorScore("e3", ["e1", "e2"], defaultConfig)).toBe(0);
  });

  it("returns 0 for null sender", () => {
    expect(actorScore(null, ["e1"], defaultConfig)).toBe(0);
  });
});

describe("caseSizeBonus", () => {
  it("returns 0 for single email", () => {
    expect(caseSizeBonus(1, defaultConfig)).toBe(0);
  });

  it("scales linearly up to threshold", () => {
    const bonus = caseSizeBonus(5, defaultConfig);
    expect(bonus).toBe(25 * (5 / 10)); // 12.5
  });

  it("caps at maxBonus", () => {
    expect(caseSizeBonus(20, defaultConfig)).toBe(25);
  });
});

describe("timeDecayMultiplier", () => {
  const now = new Date("2026-03-14");

  it("returns 1.0 for fresh emails", () => {
    const date = new Date("2026-03-01"); // 13 days ago
    expect(timeDecayMultiplier(date, now, defaultConfig)).toBe(1.0);
  });

  it("returns 0.7 for recent emails", () => {
    const date = new Date("2026-01-15"); // ~58 days ago
    expect(timeDecayMultiplier(date, now, defaultConfig)).toBe(0.7);
  });

  it("returns 0.4 for stale emails", () => {
    const date = new Date("2025-12-01"); // ~103 days ago
    expect(timeDecayMultiplier(date, now, defaultConfig)).toBe(0.4);
  });

  it("returns 0.2 for ancient emails", () => {
    const date = new Date("2025-06-01"); // >120 days ago
    expect(timeDecayMultiplier(date, now, defaultConfig)).toBe(0.2);
  });
});
