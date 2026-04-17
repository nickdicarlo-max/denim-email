import { describe, it, expect } from "vitest";
import { extractSchoolCandidates } from "../school-entity";

const subject = (s: string) => ({ subject: s, frequency: 1 });

describe("extractSchoolCandidates — Pattern A (institutions)", () => {
  it("captures: St Agnes, Saint Agnes, St. Agnes, Lanier Middle, Vail Mountain School", () => {
    const result = extractSchoolCandidates([
      subject("St Agnes Auction"),
      subject("St. Agnes pickup"),
      subject("Saint Agnes recital"),
      subject("Lanier Middle homework"),
      subject("Vail Mountain School conference"),
    ]);
    const displays = result.map((r) => r.displayString);
    expect(displays.some((d) => /St\.?\s+Agnes|Saint Agnes/.test(d))).toBe(true);
    expect(displays.some((d) => /Lanier Middle/.test(d))).toBe(true);
    expect(displays.some((d) => /Vail Mountain School/.test(d))).toBe(true);
  });

  it("tags captures with pattern 'A'", () => {
    const result = extractSchoolCandidates([subject("First Baptist Church service")]);
    expect(result[0].pattern).toBe("A");
  });
});

describe("extractSchoolCandidates — Pattern B (activities)", () => {
  it("captures: U11 Soccer, Pia Ballet, Cosmos Soccer, Adams Lacrosse", () => {
    const result = extractSchoolCandidates([
      subject("U11 Soccer practice"),
      subject("Pia Ballet recital"),
      subject("Cosmos Soccer tournament"),
      subject("Adams Lacrosse tryout"),
    ]);
    const displays = result.map((r) => r.displayString);
    expect(displays.some((d) => /U11 Soccer/.test(d))).toBe(true);
    expect(displays.some((d) => /Pia Ballet/.test(d))).toBe(true);
    expect(displays.some((d) => /Cosmos Soccer/.test(d))).toBe(true);
    expect(displays.some((d) => /Adams Lacrosse/.test(d))).toBe(true);
  });

  it("tags captures with pattern 'B'", () => {
    const result = extractSchoolCandidates([subject("Cosmos Soccer game")]);
    expect(result[0].pattern).toBe("B");
  });
});

describe("extractSchoolCandidates — shared", () => {
  it("merges casing/punctuation variants of St Agnes", () => {
    const result = extractSchoolCandidates([
      subject("St Agnes news"),
      subject("St. Agnes news"),
      subject("Saint Agnes news"),
    ]);
    const stagnesGroup = result.filter((r) => /agnes/i.test(r.displayString));
    expect(stagnesGroup).toHaveLength(1);
    expect(stagnesGroup[0].frequency).toBe(3);
  });

  it("no capture when subject matches neither pattern", () => {
    const result = extractSchoolCandidates([subject("Random newsletter")]);
    expect(result).toEqual([]);
  });
});

describe("extractSchoolCandidates — regex v2 expanded vocabulary", () => {
  it("Pattern A: Friends School", () => {
    const result = extractSchoolCandidates([subject("Sidwell Friends School meeting")]);
    expect(result.some((r) => /Friends School/.test(r.displayString))).toBe(true);
  });

  it("Pattern A: Charter", () => {
    const result = extractSchoolCandidates([subject("Lincoln Charter update")]);
    expect(result.some((r) => /Charter/.test(r.displayString))).toBe(true);
  });

  it("Pattern B: Rugby", () => {
    const result = extractSchoolCandidates([subject("Tigers Rugby practice")]);
    expect(result.some((r) => /Rugby/.test(r.displayString))).toBe(true);
  });

  it("Pattern B: Cross Country (multi-word activity)", () => {
    const result = extractSchoolCandidates([subject("Varsity Cross Country meet")]);
    expect(result.some((r) => /Cross Country/.test(r.displayString))).toBe(true);
  });

  it("Pattern B: Debate", () => {
    const result = extractSchoolCandidates([subject("Westfield Debate tournament")]);
    expect(result.some((r) => /Debate/.test(r.displayString))).toBe(true);
  });

  it("Pattern B: Robotics", () => {
    const result = extractSchoolCandidates([subject("FRC Robotics qualifier")]);
    expect(result.some((r) => /Robotics/.test(r.displayString))).toBe(true);
  });

  it("ReDoS guard: 500-char subject completes under 50ms", () => {
    const pathological = "Varsity " + "Ab Cd Ef Gh Ij ".repeat(60);
    const t0 = Date.now();
    extractSchoolCandidates([{ subject: pathological, frequency: 1 }]);
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
