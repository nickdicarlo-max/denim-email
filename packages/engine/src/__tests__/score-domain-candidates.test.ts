import { describe, expect, it } from "vitest";
import {
  MIN_SCORE_THRESHOLD,
  type ScoreDomainCandidatesInput,
  type ScoringWhatResult,
  type ScoringWhoResult,
  scoreDomainCandidates,
} from "../discovery/score-domain-candidates";

function base(): ScoreDomainCandidatesInput {
  return {
    whoResults: [],
    whatResults: [],
    groups: [],
    userDomain: "nick.dicarlo@gmail.com",
  };
}

const zia: ScoringWhoResult = {
  query: "Ziad Allan",
  senderEmail: "donotreply@email.teamsnap.com",
  senderDomain: "email.teamsnap.com",
  matchCount: 276,
};

const amy: ScoringWhoResult = {
  query: "Amy DiCarlo",
  senderEmail: "amy@gmail.com",
  senderDomain: "gmail.com",
  matchCount: 18,
};

describe("scoreDomainCandidates", () => {
  it("returns empty when there are no hints", () => {
    expect(scoreDomainCandidates(base())).toEqual([]);
  });

  it("awards +3 to a paired-WHO's senderDomain", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whoResults: [zia],
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      domain: "email.teamsnap.com",
      score: 3,
      pairedWho: "Ziad Allan",
      hintsMatched: ["soccer"],
    });
    expect(result[0].signals).toContain("paired_who");
  });

  it("awards +1 to a solo (unpaired) WHO — insufficient alone, filtered out", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whoResults: [
        {
          query: "Random Person",
          senderEmail: "rp@acme.com",
          senderDomain: "acme.com",
          matchCount: 12,
        },
      ],
    });
    // solo_who = +1, below MIN_SCORE_THRESHOLD=2 → not returned
    expect(result).toEqual([]);
  });

  it("awards +2 to a WHAT hit's topDomain — insufficient alone, filtered out", () => {
    const what: ScoringWhatResult = {
      query: "dance",
      topDomain: "shopping.us.samsung.com",
      matchCount: 13,
    };
    const result = scoreDomainCandidates({ ...base(), whatResults: [what] });
    // Single WHAT hit = +2, below MIN_SCORE_THRESHOLD=3. This is the exact
    // case that regressed onto the feed — "dance" matching 13 Samsung
    // shopping subjects would otherwise clear a threshold=2 gate.
    expect(result).toEqual([]);
  });

  it("compounds solo WHO + WHAT topDomain into 3 (meets threshold)", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whoResults: [
        {
          query: "Unnamed",
          senderEmail: "x@acme.com",
          senderDomain: "acme.com",
          matchCount: 5,
        },
      ],
      whatResults: [{ query: "widget project", topDomain: "acme.com", matchCount: 20 }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("acme.com");
    // solo_who (+1) + what_top_domain (+2) = 3
    expect(result[0].score).toBe(3);
    expect(result[0].signals).toEqual(expect.arrayContaining(["solo_who", "what_top_domain"]));
  });

  it("credits paired-WHO convergence with matching WHAT as +3 only (no double-count)", () => {
    // Paired group: Ziad → soccer. WHAT "soccer" with topDomain = Ziad's domain
    // (sourced via #117). Should NOT double-count.
    const result = scoreDomainCandidates({
      ...base(),
      whoResults: [zia],
      whatResults: [
        {
          query: "soccer",
          topDomain: "email.teamsnap.com",
          matchCount: 50,
          sourcedFromWho: "Ziad Allan",
        },
      ],
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(3);
    // The WHAT hint "soccer" should appear in hintsMatched from the paired-WHO
    // credit, not a separate +2 credit.
    expect(result[0].hintsMatched).toEqual(["soccer"]);
  });

  it("awards +1 for additional unique WHAT convergence on the same domain", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whatResults: [
        { query: "1621 Sylvan", topDomain: "judgefite.com", matchCount: 30 },
        { query: "3305 Cardinal", topDomain: "judgefite.com", matchCount: 20 },
      ],
    });
    expect(result).toHaveLength(1);
    // first +2, second +1 = 3
    expect(result[0].score).toBe(3);
    expect(result[0].signals).toEqual(
      expect.arrayContaining(["what_top_domain", "extra_hint_hit"]),
    );
    expect(result[0].hintsMatched.sort()).toEqual(["1621 Sylvan", "3305 Cardinal"]);
  });

  it("vetoes public-provider domains even with paired-WHO hits", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whoResults: [amy],
      groups: [{ whats: ["lanier", "st agnes"], whos: ["Amy DiCarlo"] }],
    });
    // Domain is gmail.com — public provider → vetoed
    expect(result).toEqual([]);
  });

  it("vetoes platform-denylist domains (github, flosports, twilio)", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whatResults: [
        { query: "copilot", topDomain: "github.com", matchCount: 40 },
        { query: "soccer", topDomain: "flosports.tv", matchCount: 15 },
        { query: "auth", topDomain: "twilio.com", matchCount: 8 },
      ],
    });
    expect(result).toEqual([]);
  });

  it("vetoes the user's own domain", () => {
    const result = scoreDomainCandidates({
      ...base(),
      userDomain: "thecontrolsurface.com",
      whatResults: [{ query: "internal", topDomain: "thecontrolsurface.com", matchCount: 100 }],
    });
    expect(result).toEqual([]);
  });

  it("vetoes domains with dominant List-Unsubscribe ratio", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whoResults: [zia],
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
      unsubscribeRatios: new Map([["email.teamsnap.com", 0.9]]),
    });
    expect(result).toEqual([]);
  });

  it("keeps domains with low List-Unsubscribe ratio", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whoResults: [zia],
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
      unsubscribeRatios: new Map([["email.teamsnap.com", 0.2]]),
    });
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("email.teamsnap.com");
  });

  it("sorts by score desc, tiebreaks by domain asc", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whoResults: [
        zia,
        {
          query: "Coach Rodriguez",
          senderEmail: "coach@rise-ecnl.com",
          senderDomain: "rise-ecnl.com",
          matchCount: 40,
        },
      ],
      whatResults: [{ query: "soccer", topDomain: "email.teamsnap.com", matchCount: 200 }],
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan", "Coach Rodriguez"] }],
    });
    // Both score 3 (paired-WHO). Tiebreak alphabetical: email.teamsnap.com < rise-ecnl.com
    expect(result.map((r) => r.domain)).toEqual(["email.teamsnap.com", "rise-ecnl.com"]);
  });

  it("drops WHOs/WHATs with zero matchCount", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whoResults: [{ query: "Nobody", senderEmail: null, senderDomain: null, matchCount: 0 }],
      whatResults: [{ query: "nothing", topDomain: null, matchCount: 0 }],
    });
    expect(result).toEqual([]);
  });

  it("honors custom platformDenylist parameter", () => {
    const result = scoreDomainCandidates({
      ...base(),
      whatResults: [
        { query: "client", topDomain: "customdeny.com", matchCount: 40 },
        { query: "another", topDomain: "customdeny.com", matchCount: 10 },
      ],
      platformDenylist: new Set(["customdeny.com"]),
    });
    expect(result).toEqual([]);
  });

  it("threshold is exactly MIN_SCORE_THRESHOLD (3)", () => {
    expect(MIN_SCORE_THRESHOLD).toBe(3);
    // +2 from single WHAT: below threshold → excluded
    const belowThreshold = scoreDomainCandidates({
      ...base(),
      whatResults: [{ query: "just barely", topDomain: "edge.com", matchCount: 5 }],
    });
    expect(belowThreshold).toEqual([]);

    // +3 from paired-WHO: exactly threshold → included
    const atThreshold = scoreDomainCandidates({
      ...base(),
      whoResults: [
        {
          query: "Contact",
          senderEmail: "c@edge.com",
          senderDomain: "edge.com",
          matchCount: 10,
        },
      ],
      groups: [{ whats: ["widget"], whos: ["Contact"] }],
    });
    expect(atThreshold).toHaveLength(1);
    expect(atThreshold[0].score).toBe(3);
  });
});
