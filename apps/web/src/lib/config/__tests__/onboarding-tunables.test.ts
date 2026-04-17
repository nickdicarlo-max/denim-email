import { describe, expect, it } from "vitest";
import { ONBOARDING_TUNABLES } from "../onboarding-tunables";

describe("stage1/stage2 tunables", () => {
  it("stage1 maxMessages is 500 per the cross-domain preamble", () => {
    expect(ONBOARDING_TUNABLES.stage1.maxMessages).toBe(500);
  });

  it("stage2 topNEntities is 20 per the cross-domain preamble", () => {
    expect(ONBOARDING_TUNABLES.stage2.topNEntities).toBe(20);
  });

  it("Levenshtein thresholds match spec (1 short, 3 long)", () => {
    expect(ONBOARDING_TUNABLES.stage2.levenshteinShortThreshold).toBe(1);
    // 3 catches abbreviation expansions (Dr↔Drive, St↔Saint) within same-key
    // buckets — validated by dedupByLevenshtein's tests (Task 2.1).
    expect(ONBOARDING_TUNABLES.stage2.levenshteinLongThreshold).toBe(3);
  });
});
