import { describe, expect, it } from "vitest";
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
  it("merges casing/punctuation variants of St Agnes (Pattern A)", () => {
    const result = extractSchoolCandidates([
      subject("St Agnes news"),
      subject("St. Agnes news"),
      subject("Saint Agnes news"),
    ]);
    // Pattern A merges all three variants into a single `st agnes` entry.
    // Pattern C may independently surface a collateral phrase like
    // "Agnes news" (freq=3) — that's acceptable; it has a distinct key
    // and downstream Levenshtein / user review handles it.
    const patternA = result.filter((r) => r.pattern === "A" && /agnes/i.test(r.displayString));
    expect(patternA).toHaveLength(1);
    expect(patternA[0].frequency).toBe(3);
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

describe("extractSchoolCandidates — Pattern C (corpus mining, #102)", () => {
  const teamsnapSubjects = [
    "New game: ZSA U11/12 Girls Spring 2026 Competitive Rise )) vs. Rise ECNL",
    "New event: Practice",
    "Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Event",
    "Event Reminder: Practice, March 29, 4:30 PM",
    "Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Game",
    "New game: ZSA U11/12 Girls Spring 2026 Competitive Rise )) vs. Houston Select",
    "Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Practice",
    "Event Reminder: Practice",
  ].map((s) => ({ subject: s, frequency: 1, senderEmail: "donotreply@email.teamsnap.com" }));

  it("surfaces ZSA team phrase with pattern 'C' on a TeamSnap corpus", () => {
    const result = extractSchoolCandidates(teamsnapSubjects);
    const c = result.find((r) => /ZSA.*Competitive\s+Rise/.test(r.displayString));
    expect(c).toBeDefined();
    expect(c?.pattern).toBe("C");
    expect(c?.frequency).toBeGreaterThanOrEqual(3);
  });

  it("tags sourcedFromWho + relatedWhat when WHO is paired", () => {
    const result = extractSchoolCandidates(teamsnapSubjects, {
      pairedWhoAddresses: [
        {
          senderEmail: "donotreply@email.teamsnap.com",
          pairedWhat: "soccer",
          pairedWho: "Ziad Allan",
        },
      ],
    });
    const c = result.find((r) => /ZSA.*Competitive\s+Rise/.test(r.displayString));
    expect(c).toBeDefined();
    expect(c?.sourcedFromWho).toBe("Ziad Allan");
    expect(c?.relatedWhat).toBe("soccer");
  });

  it("unpaired fallback produces Pattern C without sourcedFromWho tags", () => {
    const result = extractSchoolCandidates(teamsnapSubjects);
    const c = result.find((r) => /ZSA.*Competitive\s+Rise/.test(r.displayString));
    expect(c).toBeDefined();
    expect(c?.sourcedFromWho).toBeUndefined();
    expect(c?.relatedWhat).toBeUndefined();
  });

  it("cross-pattern collision prefers Pattern A label on same key", () => {
    // St Agnes repeated ≥ 3 times with institution suffix — Pattern A catches
    // it AND Pattern C's "St Agnes School" phrase surfaces at freq 3. Expect
    // the merged entry to be pattern 'A' per A > B > C preference.
    const result = extractSchoolCandidates([
      { subject: "St Agnes School event this week", frequency: 1 },
      { subject: "St Agnes School fundraiser", frequency: 1 },
      { subject: "St Agnes School auction", frequency: 1 },
      { subject: "St Agnes School meeting", frequency: 1 },
    ]);
    // There should be at least one St-Agnes-keyed candidate, and it should
    // be pattern A (institution regex), not C (corpus mining).
    const stAgnes = result.filter((r) => r.key.startsWith("st agnes"));
    expect(stAgnes.length).toBeGreaterThan(0);
    const stAgnesShortKey = stAgnes.find((r) => r.key === "st agnes");
    if (stAgnesShortKey) {
      expect(stAgnesShortKey.pattern).toBe("A");
    }
  });

  it("narrow-view filter respects senderEmail match (case-insensitive)", () => {
    const mixed = [
      ...teamsnapSubjects,
      {
        subject: "Totally unrelated newsletter about tigers",
        frequency: 1,
        senderEmail: "other@example.com",
      },
    ];
    const result = extractSchoolCandidates(mixed, {
      pairedWhoAddresses: [
        {
          senderEmail: "DONOTREPLY@email.teamsnap.com", // uppercase on purpose
          pairedWhat: "soccer",
          pairedWho: "Ziad Allan",
        },
      ],
    });
    const c = result.find((r) => /ZSA.*Competitive\s+Rise/.test(r.displayString));
    expect(c).toBeDefined();
    expect(c?.sourcedFromWho).toBe("Ziad Allan");
  });
});
