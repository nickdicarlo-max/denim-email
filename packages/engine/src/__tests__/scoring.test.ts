import { describe, expect, it } from "vitest";
import type { ClusteringConfig } from "@denim/types";
import {
  threadScore,
  subjectScore,
  actorScore,
  timeDecayMultiplier,
  normalizeSubject,
} from "../clustering/scoring";

const defaultConfig: ClusteringConfig = {
  mergeThreshold: 45,
  threadMatchScore: 100,
  subjectMatchScore: 50,
  actorAffinityScore: 30,
  timeDecayDays: { fresh: 45 },
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

describe("timeDecayMultiplier", () => {
  const now = new Date("2026-03-14");

  it("returns 1.0 for fresh emails (within fresh days)", () => {
    const date = new Date("2026-03-01"); // 13 days ago, within 45-day fresh window
    expect(timeDecayMultiplier(date, now, defaultConfig)).toBe(1.0);
  });

  it("returns 1.0 at exactly the fresh boundary", () => {
    // 45 days before now
    const date = new Date("2026-01-28");
    expect(timeDecayMultiplier(date, now, defaultConfig)).toBe(1.0);
  });

  it("decays linearly beyond fresh days", () => {
    // 100 days ago — beyond 45-day fresh window
    const date = new Date("2025-12-04");
    const result = timeDecayMultiplier(date, now, defaultConfig);
    // Should be between 0.2 and 1.0
    expect(result).toBeGreaterThan(0.2);
    expect(result).toBeLessThan(1.0);
  });

  it("returns approximately 0.6 at halfway between fresh and 365", () => {
    // Halfway point: 45 + (365-45)/2 = 45 + 160 = 205 days
    const date = new Date(now.getTime() - 205 * 86_400_000);
    const result = timeDecayMultiplier(date, now, defaultConfig);
    // Expected: 1.0 - 0.8 * (205-45)/(365-45) = 1.0 - 0.8 * 0.5 = 0.6
    expect(result).toBeCloseTo(0.6, 1);
  });

  it("returns 0.2 for very old emails (365+ days)", () => {
    const date = new Date("2025-01-01"); // ~437 days ago
    expect(timeDecayMultiplier(date, now, defaultConfig)).toBe(0.2);
  });

  it("never goes below 0.2", () => {
    const date = new Date("2023-01-01"); // ~1168 days ago
    expect(timeDecayMultiplier(date, now, defaultConfig)).toBe(0.2);
  });
});
