/**
 * Tests for `mineFrequentPhrases` — issue #102.
 *
 * Fixtures embed real subjects copy-pasted from the 433-email gitignored
 * sample corpus (Girls TeamSnap run, 2026-04-19). `@denim/engine` is
 * I/O-free, so these are literal strings — same signal, zero file ops.
 */
import { describe, expect, it } from "vitest";
import { mineFrequentPhrases, SCHOOL_EVENT_STOPWORDS } from "../entity/frequency-mining";

function subjects(list: string[]) {
  return list.map((s) => ({ subject: s }));
}

describe("mineFrequentPhrases — TeamSnap soccer fixture", () => {
  // 8 real-shaped subjects: enough to cross freq ≥ 3 for the team phrase
  // while also exercising all-noise rows and opponent names that sit below
  // threshold (each opponent appears once).
  const teamsnap = subjects([
    "New game: ZSA U11/12 Girls Spring 2026 Competitive Rise )) vs. Rise ECNL",
    "New event: Practice",
    "Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Event",
    "Event Reminder: Practice, March 29, 4:30 PM",
    "Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Game",
    "New game: ZSA U11/12 Girls Spring 2026 Competitive Rise )) vs. Houston Select",
    "Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Practice",
    "Event Reminder: Practice",
  ]);

  it("surfaces the repeating ZSA team phrase with frequency ≥ 3", () => {
    const result = mineFrequentPhrases(teamsnap);
    expect(result.length).toBeGreaterThan(0);
    const top = result[0];
    expect(top.phrase).toMatch(/ZSA\s+U11.*Girls\s+Spring\s+2026\s+Competitive\s+Rise/);
    expect(top.frequency).toBeGreaterThanOrEqual(3);
  });

  it("does not surface event-verb-only phrases like 'Event Reminder Practice'", () => {
    const result = mineFrequentPhrases(teamsnap);
    for (const c of result) {
      // No candidate should be composed entirely of stopwords.
      const tokens = c.phrase.split(/\s+/);
      const allStop = tokens.every((t) => SCHOOL_EVENT_STOPWORDS.has(t.toLowerCase()));
      expect(allStop).toBe(false);
    }
  });

  it("does not surface opponent names (each appears only once)", () => {
    const result = mineFrequentPhrases(teamsnap);
    const phrases = result.map((r) => r.phrase);
    expect(phrases.some((p) => /Rise ECNL/.test(p))).toBe(false);
    expect(phrases.some((p) => /Houston Select/.test(p))).toBe(false);
  });
});

describe("mineFrequentPhrases — edge cases", () => {
  it("returns empty for small corpus below minFrequency", () => {
    const result = mineFrequentPhrases(
      subjects([
        "Updated ZSA U11/12 Girls Spring 2026 Competitive Rise )) Event",
        "New game: ZSA U11/12 Girls Spring 2026 Competitive Rise )) vs. Rise ECNL",
      ]),
    );
    expect(result).toEqual([]);
  });

  it("returns empty for all-noise corpus (stopwords only, 10×)", () => {
    const result = mineFrequentPhrases(
      subjects(Array.from({ length: 10 }, () => "New event: Practice")),
    );
    expect(result).toEqual([]);
  });

  it("stopword filter removes 'New game 2026' — no proper-noun residue", () => {
    const result = mineFrequentPhrases(subjects(["New game 2026"]));
    expect(result).toEqual([]);
  });

  it("returns empty for empty input", () => {
    expect(mineFrequentPhrases([])).toEqual([]);
  });
});

describe("mineFrequentPhrases — multi-entity corpus", () => {
  // 20 subjects split across two real-shaped team names. Both should
  // surface, ranked by frequency descending.
  const twoTeams = subjects([
    // Team 1 — 6 hits
    "New game: ZSA U11/12 Girls Spring 2026 Competitive Rise",
    "Updated ZSA U11/12 Girls Spring 2026 Competitive Rise",
    "ZSA U11/12 Girls Spring 2026 Competitive Rise update",
    "New event: ZSA U11/12 Girls Spring 2026 Competitive Rise practice",
    "ZSA U11/12 Girls Spring 2026 Competitive Rise game",
    "Reminder: ZSA U11/12 Girls Spring 2026 Competitive Rise",
    // Team 2 — 5 hits
    "New game: Gray Wolves Lacrosse U13 Boys vs. opponent A",
    "Updated Gray Wolves Lacrosse U13 Boys event",
    "Gray Wolves Lacrosse U13 Boys practice",
    "Gray Wolves Lacrosse U13 Boys game",
    "Reminder: Gray Wolves Lacrosse U13 Boys",
    // Noise — below threshold each
    "New event: Practice",
    "Event Reminder",
    "Meeting at the field",
    "Pickup at the school",
    "Snack schedule for this week",
    "Bus assignments",
    "Photo day reminder",
    "Annual dinner",
    "Volunteers needed",
  ]);

  it("surfaces both teams ranked by frequency", () => {
    const result = mineFrequentPhrases(twoTeams);
    const phrases = result.map((r) => r.phrase);
    expect(phrases.some((p) => /ZSA\s+U11.*Competitive\s+Rise/.test(p))).toBe(true);
    expect(phrases.some((p) => /Gray\s+Wolves\s+Lacrosse/.test(p))).toBe(true);
  });

  it("ranks more-frequent team first", () => {
    const result = mineFrequentPhrases(twoTeams);
    const zsaIdx = result.findIndex((r) => /ZSA/.test(r.phrase));
    const wolvesIdx = result.findIndex((r) => /Gray\s+Wolves/.test(r.phrase));
    expect(zsaIdx).toBeGreaterThanOrEqual(0);
    expect(wolvesIdx).toBeGreaterThanOrEqual(0);
    expect(zsaIdx).toBeLessThan(wolvesIdx);
  });
});

describe("mineFrequentPhrases — options", () => {
  it("respects minFrequency override", () => {
    const twoHits = subjects([
      "New game: ZSA U11/12 Girls vs. Rise",
      "Updated ZSA U11/12 Girls event",
    ]);
    expect(mineFrequentPhrases(twoHits)).toEqual([]);
    const resultLow = mineFrequentPhrases(twoHits, { minFrequency: 2 });
    expect(resultLow.length).toBeGreaterThan(0);
  });

  it("respects topK", () => {
    const result = mineFrequentPhrases(
      subjects([
        "Bravo Team news update",
        "Bravo Team news alert",
        "Bravo Team news recap",
        "Charlie Squad news update",
        "Charlie Squad news alert",
        "Charlie Squad news recap",
      ]),
      { topK: 1 },
    );
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it("maximal-prune drops 'ZSA U11' when full phrase has same frequency", () => {
    const result = mineFrequentPhrases(
      subjects([
        "ZSA U11 Girls Spring 2026",
        "ZSA U11 Girls Spring 2026",
        "ZSA U11 Girls Spring 2026",
      ]),
    );
    // Only the longest dominating phrase should survive (maximal).
    for (const c of result) {
      // "ZSA U11" alone should not appear — it's a proper prefix of the full.
      expect(c.phrase).not.toBe("ZSA U11");
    }
  });
});

describe("SCHOOL_EVENT_STOPWORDS", () => {
  it("contains core event verbs", () => {
    for (const w of ["new", "game", "practice", "event", "reminder", "updated", "vs"]) {
      expect(SCHOOL_EVENT_STOPWORDS.has(w)).toBe(true);
    }
  });

  it("does not contain proper-noun candidates", () => {
    for (const w of ["zsa", "girls", "competitive", "rise"]) {
      expect(SCHOOL_EVENT_STOPWORDS.has(w)).toBe(false);
    }
  });
});
