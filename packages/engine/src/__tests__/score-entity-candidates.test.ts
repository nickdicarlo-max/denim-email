import { describe, expect, it } from "vitest";
import {
  MIN_ENTITY_SCORE_THRESHOLD,
  type ScoringEntityCandidate,
  scoreEntityCandidates,
} from "../discovery/score-entity-candidates";

function c(displayString: string, frequency = 1, key = ""): ScoringEntityCandidate {
  return { key: key || displayString.toLowerCase().replace(/\s+/g, "-"), displayString, frequency };
}

describe("scoreEntityCandidates", () => {
  it("scores a candidate with hint token match + multiple subjects = 4", () => {
    const [scored] = scoreEntityCandidates({
      candidates: [c("3910 Bucknell Drive", 5)],
      schemaDomain: "property",
      userWhats: ["3910 Bucknell"],
      confirmedWhoEmails: [],
    });
    expect(scored.score).toBe(4);
    expect(scored.signals).toEqual(["hint_token_match", "multiple_subjects"]);
  });

  it("single-subject non-hint candidate scores 0 (below threshold)", () => {
    const [scored] = scoreEntityCandidates({
      candidates: [c("Houston Select", 1)],
      schemaDomain: "school_parent",
      userWhats: ["soccer", "lanier", "st agnes"],
      confirmedWhoEmails: [],
    });
    expect(scored.score).toBe(0);
    expect(scored.score).toBeLessThan(MIN_ENTITY_SCORE_THRESHOLD);
  });

  it("awards +2 when candidate's sender email is a confirmed WHO", () => {
    const [scored] = scoreEntityCandidates({
      candidates: [
        { key: "@timothybishop@judgefite.com", displayString: "Timothy Bishop", frequency: 5 },
      ],
      schemaDomain: "property",
      userWhats: [],
      confirmedWhoEmails: ["timothybishop@judgefite.com"],
    });
    expect(scored.score).toBe(3); // +2 confirmed_who_sender + +1 multiple_subjects
    expect(scored.signals).toContain("confirmed_who_sender");
  });

  it("rejects spec-violating candidates with score −∞", () => {
    const [scored] = scoreEntityCandidates({
      candidates: [c("Bucknell", 10)],
      schemaDomain: "property",
      userWhats: ["Bucknell"], // even with hint-match this should reject
      confirmedWhoEmails: [],
    });
    expect(scored.score).toBe(Number.NEGATIVE_INFINITY);
    expect(scored.specViolation).toBe("single_word_fragment");
    expect(scored.signals).toContain("spec_violation");
  });

  it("rejects engagement/case fragments", () => {
    const [scored] = scoreEntityCandidates({
      candidates: [c("KPI Dashboard Review", 3)],
      schemaDomain: "agency",
      userWhats: ["Portfolio Pro Advisors"],
      confirmedWhoEmails: [],
    });
    expect(scored.score).toBe(Number.NEGATIVE_INFINITY);
    expect(scored.specViolation).toBe("engagement_or_case_fragment");
  });

  it("rejects generic context words for school_parent", () => {
    const [scored] = scoreEntityCandidates({
      candidates: [c("team", 12)],
      schemaDomain: "school_parent",
      userWhats: [],
      confirmedWhoEmails: [],
    });
    expect(scored.score).toBe(Number.NEGATIVE_INFINITY);
  });

  it("rejects ≤3-char single-word agency candidates (Nick, PPA)", () => {
    const r = scoreEntityCandidates({
      candidates: [c("PPA", 8), c("Nic", 3)],
      schemaDomain: "agency",
      userWhats: ["Portfolio Pro Advisors"],
      confirmedWhoEmails: [],
    });
    expect(r[0].score).toBe(Number.NEGATIVE_INFINITY);
    expect(r[1].score).toBe(Number.NEGATIVE_INFINITY);
  });

  it("short-circuit candidates bypass scoring but still honor spec §5", () => {
    const r = scoreEntityCandidates({
      candidates: [
        c("soccer", 0),
        // An edge case: short-circuit could theoretically emit a
        // spec-violating name if the user typed one. The gate still fires.
        c("team", 0),
      ],
      schemaDomain: "school_parent",
      userWhats: [],
      confirmedWhoEmails: [],
      sourceAlgorithm: "pair-short-circuit",
    });
    expect(r[0].score).toBeGreaterThanOrEqual(MIN_ENTITY_SCORE_THRESHOLD);
    expect(r[0].signals).toContain("short_circuit_primary");
    expect(r[1].score).toBe(Number.NEGATIVE_INFINITY);
    expect(r[1].specViolation).toBe("generic_context_word");
  });

  it("agency-domain-derive candidates are retained above threshold", () => {
    const r = scoreEntityCandidates({
      candidates: [c("Portfolio Pro Advisors", 0)],
      schemaDomain: "agency",
      userWhats: ["Portfolio Pro Advisors"],
      confirmedWhoEmails: [],
      sourceAlgorithm: "agency-domain-derive",
    });
    expect(r[0].score).toBeGreaterThanOrEqual(MIN_ENTITY_SCORE_THRESHOLD);
    expect(r[0].signals).toContain("agency_domain_derive");
  });

  it("case-insensitive hint token matching", () => {
    const [scored] = scoreEntityCandidates({
      candidates: [c("ZSA U11 Girls Competitive Rise", 8)],
      schemaDomain: "school_parent",
      userWhats: ["ZSA Soccer"],
      confirmedWhoEmails: [],
    });
    // "ZSA" token appears in both → hint_token_match
    expect(scored.signals).toContain("hint_token_match");
    expect(scored.score).toBeGreaterThanOrEqual(MIN_ENTITY_SCORE_THRESHOLD);
  });
});
