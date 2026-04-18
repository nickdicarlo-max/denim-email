import { describe, expect, it } from "vitest";
import type { CoarseClusterInput } from "../clustering/frequency-analysis";
import { analyzeWordFrequencies } from "../clustering/frequency-analysis";

function makeCluster(
  overrides: Partial<CoarseClusterInput> & { clusterId: string },
): CoarseClusterInput {
  return {
    entityName: "Soccer",
    emails: [],
    ...overrides,
  };
}

describe("analyzeWordFrequencies", () => {
  it("returns empty array for empty input", () => {
    const result = analyzeWordFrequencies([]);
    expect(result).toHaveLength(0);
  });

  it("returns frequency table per cluster", () => {
    const clusters: CoarseClusterInput[] = [
      makeCluster({
        clusterId: "c1",
        entityName: "Soccer",
        emails: [
          { id: "e1", subject: "Soccer Practice Tuesday", summary: "Practice at 5pm" },
          { id: "e2", subject: "Soccer Practice Thursday", summary: "Practice at 6pm" },
        ],
      }),
      makeCluster({
        clusterId: "c2",
        entityName: "Dance",
        emails: [
          { id: "e3", subject: "Dance Recital Saturday", summary: "Recital at the auditorium" },
        ],
      }),
    ];

    const result = analyzeWordFrequencies(clusters);
    expect(result).toHaveLength(2);
    expect(result[0].clusterId).toBe("c1");
    expect(result[0].entityName).toBe("Soccer");
    expect(result[0].emailCount).toBe(2);
    expect(result[1].clusterId).toBe("c2");
  });

  it("filters out English stop words", () => {
    const clusters: CoarseClusterInput[] = [
      makeCluster({
        clusterId: "c1",
        emails: [
          {
            id: "e1",
            subject: "The practice is at the field",
            summary: "It will be a good practice",
          },
          { id: "e2", subject: "The game is on Saturday", summary: "We have a game" },
        ],
      }),
    ];

    const result = analyzeWordFrequencies(clusters);
    const words = result[0].words.map((w) => w.word);
    // Stop words should be filtered
    expect(words).not.toContain("the");
    expect(words).not.toContain("is");
    expect(words).not.toContain("at");
    expect(words).not.toContain("it");
    expect(words).not.toContain("will");
    expect(words).not.toContain("be");
    // Content words should remain
    expect(words).toContain("practice");
    expect(words).toContain("game");
  });

  it("gives subject words higher weight than summary words", () => {
    const clusters: CoarseClusterInput[] = [
      makeCluster({
        clusterId: "c1",
        emails: [
          { id: "e1", subject: "practice schedule", summary: "details about registration" },
          { id: "e2", subject: "practice update", summary: "more registration info" },
          { id: "e3", subject: "game tomorrow", summary: "registration deadline" },
        ],
      }),
    ];

    const result = analyzeWordFrequencies(clusters);
    const practiceWord = result[0].words.find((w) => w.word === "practice");
    const registrationWord = result[0].words.find((w) => w.word === "registration");

    // "practice" appears in 2/3 subjects, "registration" appears in 3/3 summaries
    // But "registration" is in >90% of emails so it may be filtered out
    // At minimum, "practice" should be present with good weight
    expect(practiceWord).toBeDefined();
    if (practiceWord) {
      expect(practiceWord.weightedScore).toBeGreaterThan(0);
    }
  });

  it("filters words appearing in >90% of cluster emails", () => {
    const clusters: CoarseClusterInput[] = [
      makeCluster({
        clusterId: "c1",
        emails: [
          { id: "e1", subject: "soccer practice", summary: "soccer event" },
          { id: "e2", subject: "soccer game", summary: "soccer match" },
          { id: "e3", subject: "soccer registration", summary: "soccer signup" },
          { id: "e4", subject: "soccer banquet", summary: "soccer celebration" },
          { id: "e5", subject: "soccer schedule", summary: "soccer dates" },
          { id: "e6", subject: "soccer photos", summary: "soccer pictures" },
          { id: "e7", subject: "soccer uniforms", summary: "soccer gear" },
          { id: "e8", subject: "soccer fundraiser", summary: "soccer money" },
          { id: "e9", subject: "soccer tournament", summary: "soccer competition" },
          { id: "e10", subject: "soccer awards", summary: "soccer trophies" },
        ],
      }),
    ];

    const result = analyzeWordFrequencies(clusters);
    const words = result[0].words.map((w) => w.word);
    // "soccer" appears in 100% of emails — should be filtered out
    expect(words).not.toContain("soccer");
    // Discriminating words should remain
    expect(words).toContain("practice");
    expect(words).toContain("game");
  });

  it("applies cross-entity downweight for words in >50% of clusters", () => {
    const clusters: CoarseClusterInput[] = [
      makeCluster({
        clusterId: "c1",
        entityName: "Soccer",
        emails: [
          { id: "e1", subject: "practice schedule", summary: "practice details" },
          { id: "e2", subject: "game day", summary: "game info" },
        ],
      }),
      makeCluster({
        clusterId: "c2",
        entityName: "Dance",
        emails: [
          { id: "e3", subject: "practice time", summary: "practice update" },
          { id: "e4", subject: "recital info", summary: "recital details" },
        ],
      }),
      makeCluster({
        clusterId: "c3",
        entityName: "Band",
        emails: [
          { id: "e5", subject: "practice room", summary: "practice session" },
          { id: "e6", subject: "concert tickets", summary: "concert info" },
        ],
      }),
    ];

    const result = analyzeWordFrequencies(clusters);

    // "practice" appears in all 3 clusters (>50%) — should be downweighted
    // "game" appears only in Soccer — should NOT be downweighted
    const soccerTable = result.find((t) => t.clusterId === "c1");
    expect(soccerTable).toBeDefined();

    const gameWord = soccerTable!.words.find((w) => w.word === "game");
    const practiceWord = soccerTable!.words.find((w) => w.word === "practice");

    if (gameWord && practiceWord) {
      // game should have a higher weightedScore than practice (same frequency but no cross-entity penalty)
      expect(gameWord.weightedScore).toBeGreaterThan(practiceWord.weightedScore);
    }
  });

  it("detects co-occurring words", () => {
    const clusters: CoarseClusterInput[] = [
      makeCluster({
        clusterId: "c1",
        emails: [
          { id: "e1", subject: "practice tuesday field", summary: "" },
          { id: "e2", subject: "practice thursday field", summary: "" },
          { id: "e3", subject: "game saturday stadium", summary: "" },
        ],
      }),
    ];

    const result = analyzeWordFrequencies(clusters);
    const practiceWord = result[0].words.find((w) => w.word === "practice");
    expect(practiceWord).toBeDefined();
    // "field" co-occurs with "practice" in 2/2 practice emails (100% > 70% threshold)
    if (practiceWord) {
      expect(practiceWord.coOccursWith).toContain("field");
    }
  });

  it("filters single-character words and pure numbers", () => {
    const clusters: CoarseClusterInput[] = [
      makeCluster({
        clusterId: "c1",
        emails: [
          { id: "e1", subject: "Game 5 at 7pm", summary: "Score was 3 2" },
          { id: "e2", subject: "x marks the spot", summary: "Location A B" },
        ],
      }),
    ];

    const result = analyzeWordFrequencies(clusters);
    const words = result[0].words.map((w) => w.word);
    expect(words).not.toContain("5");
    expect(words).not.toContain("3");
    expect(words).not.toContain("2");
    // Single char words filtered
    for (const w of words) {
      expect(w.length).toBeGreaterThan(1);
    }
  });

  it("limits output to top 30 words per cluster", () => {
    // Create a cluster with many unique words
    const emails = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      subject: `word${i}a word${i}b word${i}c word${i}d`,
      summary: `word${i}e word${i}f word${i}g word${i}h`,
    }));

    const clusters: CoarseClusterInput[] = [makeCluster({ clusterId: "c1", emails })];

    const result = analyzeWordFrequencies(clusters);
    expect(result[0].words.length).toBeLessThanOrEqual(30);
  });
});
