import type { InterviewInput } from "@denim/types";
import { describe, expect, it } from "vitest";
import { type BuildPerWhatInput, buildPerWhatGroups } from "../build-per-what-groups";

function baseInput(overrides: Partial<BuildPerWhatInput> = {}): BuildPerWhatInput {
  const defaultInputs: InterviewInput = {
    role: "",
    domain: "school_parent",
    whats: [],
    whos: [],
    groups: [],
    goals: [],
  };
  return {
    inputs: overrides.inputs ?? defaultInputs,
    stage1UserThings: overrides.stage1UserThings ?? [],
    stage1UserContacts: overrides.stage1UserContacts ?? [],
    stage1ConfirmedUserContactQueries: overrides.stage1ConfirmedUserContactQueries ?? [],
    stage2Candidates: overrides.stage2Candidates ?? [],
  };
}

describe("buildPerWhatGroups", () => {
  it("returns fallbackDomainGroups when inputs + groups are both empty", () => {
    const r = buildPerWhatGroups(
      baseInput({
        inputs: {
          role: "",
          domain: "school_parent",
          whats: [],
          whos: [],
          groups: [],
          goals: [],
        },
        stage2Candidates: [
          {
            confirmedDomain: "example.com",
            algorithm: "gemini-subject-pass",
            candidates: [],
          },
        ],
      }),
    );
    expect(r.whatSections).toEqual([]);
    expect(r.fallbackDomainGroups).toHaveLength(1);
  });

  it("found-and-anchored: short-circuit synthetic anchors the WHAT section", () => {
    const r = buildPerWhatGroups(
      baseInput({
        inputs: {
          role: "",
          domain: "school_parent",
          whats: ["soccer"],
          whos: ["Ziad Allan"],
          groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
          goals: [],
        },
        stage1UserThings: [
          {
            query: "soccer",
            matchCount: 13,
            topDomain: "email.teamsnap.com",
            topSenders: [],
            errorCount: 0,
          },
        ],
        stage1UserContacts: [
          {
            query: "Ziad Allan",
            matchCount: 13,
            senderEmail: "donotreply@email.teamsnap.com",
            senderDomain: "email.teamsnap.com",
            errorCount: 0,
          },
        ],
        stage1ConfirmedUserContactQueries: ["Ziad Allan"],
        stage2Candidates: [
          {
            confirmedDomain: "email.teamsnap.com",
            algorithm: "pair-short-circuit",
            candidates: [
              {
                key: "soccer",
                displayString: "soccer",
                frequency: 13,
                autoFixed: false,
                meta: { pattern: "short-circuit", relatedWhat: "soccer", kind: "primary" },
              },
            ],
          },
        ],
      }),
    );
    expect(r.whatSections).toHaveLength(1);
    const [section] = r.whatSections;
    expect(section.what).toBe("soccer");
    expect(section.state).toBe("found_anchored");
    expect(section.provenance).toBe("user_input");
    expect(section.anchor?.origin).toBe("short_circuit");
    expect(section.anchor?.frequency).toBe(13);
    expect(section.anchor?.preTicked).toBe(true);
    expect(section.pairedWhos).toHaveLength(1);
    expect(section.pairedWhos[0]).toMatchObject({
      displayLabel: "Ziad Allan",
      matchCount: 13,
      preTicked: true,
    });
  });

  it("folds sibling Gemini candidates into the short-circuit's aliases", () => {
    const r = buildPerWhatGroups(
      baseInput({
        inputs: {
          role: "",
          domain: "school_parent",
          whats: ["soccer"],
          whos: ["Ziad Allan"],
          groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
          goals: [],
        },
        stage1UserThings: [
          {
            query: "soccer",
            matchCount: 13,
            topDomain: "email.teamsnap.com",
            topSenders: [],
            errorCount: 0,
          },
        ],
        stage1UserContacts: [
          {
            query: "Ziad Allan",
            matchCount: 13,
            senderEmail: "donotreply@email.teamsnap.com",
            senderDomain: "email.teamsnap.com",
            errorCount: 0,
          },
        ],
        stage1ConfirmedUserContactQueries: ["Ziad Allan"],
        stage2Candidates: [
          {
            confirmedDomain: "email.teamsnap.com",
            algorithm: "pair-short-circuit",
            candidates: [
              {
                key: "soccer",
                displayString: "soccer",
                frequency: 13,
                autoFixed: false,
                meta: { pattern: "short-circuit", relatedWhat: "soccer", kind: "primary" },
              },
              {
                key: "zsa-u11-12-girls-competitive-rise",
                displayString: "ZSA U11/12 Girls Competitive Rise",
                frequency: 8,
                autoFixed: false,
                meta: { pattern: "gemini", relatedWhat: "soccer", kind: "primary" },
              },
              {
                key: "rise-ecnl",
                displayString: "Rise ECNL",
                frequency: 2,
                autoFixed: false,
                meta: { pattern: "gemini", relatedWhat: "soccer", kind: "primary" },
              },
            ],
          },
        ],
      }),
    );
    const [section] = r.whatSections;
    expect(section.anchor?.aliases.sort()).toEqual([
      "Rise ECNL",
      "ZSA U11/12 Girls Competitive Rise",
    ]);
    // folded into the short-circuit anchor's aliases — no separate
    // "discovered" sections emitted since they were consumed.
    expect(r.whatSections.filter((s) => s.provenance === "discovered")).toEqual([]);
  });

  it("not-found: zero-match WHAT surfaces with a notFoundNote", () => {
    const r = buildPerWhatGroups(
      baseInput({
        inputs: {
          role: "",
          domain: "school_parent",
          whats: ["guitar"],
          whos: [],
          groups: [],
          goals: [],
        },
        stage1UserThings: [
          {
            query: "guitar",
            matchCount: 0,
            topDomain: null,
            topSenders: [],
            errorCount: 0,
          },
        ],
      }),
    );
    const [section] = r.whatSections;
    expect(section.state).toBe("not_found");
    expect(section.anchor).toBeNull();
    expect(section.notFoundNote).toMatch(/Not found in the last 8 weeks/);
  });

  it("found-but-unanchored: WHAT has matches but topDomain was vetoed", () => {
    const r = buildPerWhatGroups(
      baseInput({
        inputs: {
          role: "",
          domain: "school_parent",
          whats: ["lanier"],
          whos: ["Amy DiCarlo"],
          groups: [{ whats: ["lanier"], whos: ["Amy DiCarlo"] }],
          goals: [],
        },
        stage1UserThings: [
          {
            query: "lanier",
            matchCount: 1,
            topDomain: "gmail.com",
            topSenders: ["Amy DiCarlo"],
            errorCount: 0,
            sourcedFromWho: "Amy DiCarlo",
          },
        ],
        // Amy is a confirmed WHO but gmail.com is public-provider-vetoed at
        // Stage 1 → no Stage 2 candidate exists for Lanier at any confirmed
        // domain (confirmed domains set is empty for this WHAT).
        stage1UserContacts: [
          {
            query: "Amy DiCarlo",
            matchCount: 1,
            senderEmail: "amy@gmail.com",
            senderDomain: "gmail.com",
            errorCount: 0,
          },
        ],
        stage1ConfirmedUserContactQueries: ["Amy DiCarlo"],
        stage2Candidates: [],
      }),
    );
    const [section] = r.whatSections;
    expect(section.state).toBe("found_unanchored");
    expect(section.anchor?.origin).toBe("found_unanchored");
    expect(section.anchor?.frequency).toBe(1);
    expect(section.anchor?.preTicked).toBe(false);
    expect(section.unanchoredNote).toMatch(/Found 1 email.*via Amy DiCarlo/);
    // Paired WHO row still surfaces for attribution, pre-ticked.
    expect(section.pairedWhos[0]).toMatchObject({
      displayLabel: "Amy DiCarlo",
      preTicked: true,
    });
  });

  it("also-noticed: Gemini candidates without a relatedWhat-match become adjacent discoveries", () => {
    const r = buildPerWhatGroups(
      baseInput({
        inputs: {
          role: "",
          domain: "property",
          whats: ["3910 Bucknell", "851 Peavy"],
          whos: ["Timothy Bishop"],
          groups: [{ whats: ["3910 Bucknell", "851 Peavy"], whos: ["Timothy Bishop"] }],
          goals: [],
        },
        stage1UserThings: [
          {
            query: "3910 Bucknell",
            matchCount: 7,
            topDomain: "judgefite.com",
            topSenders: [],
            errorCount: 0,
          },
          {
            query: "851 Peavy",
            matchCount: 1,
            topDomain: "judgefite.com",
            topSenders: [],
            errorCount: 0,
          },
        ],
        stage1UserContacts: [
          {
            query: "Timothy Bishop",
            matchCount: 5,
            senderEmail: "timothybishop@judgefite.com",
            senderDomain: "judgefite.com",
            errorCount: 0,
          },
        ],
        stage1ConfirmedUserContactQueries: ["Timothy Bishop"],
        stage2Candidates: [
          {
            confirmedDomain: "judgefite.com",
            algorithm: "gemini-subject-pass",
            candidates: [
              {
                key: "3910-bucknell-drive",
                displayString: "3910 Bucknell Drive",
                frequency: 5,
                autoFixed: false,
                meta: { pattern: "gemini", kind: "primary", discoveryScore: 4 },
              },
              {
                key: "851-peavy-road",
                displayString: "851 Peavy Road",
                frequency: 1,
                autoFixed: false,
                meta: { pattern: "gemini", kind: "primary", discoveryScore: 3 },
              },
              // Adjacent discoveries — not mentioned in user hints.
              {
                key: "205-freedom-trail",
                displayString: "205 Freedom Trail",
                frequency: 5,
                autoFixed: false,
                meta: { pattern: "gemini", kind: "primary", discoveryScore: 1 },
              },
              {
                key: "3305-cardinal",
                displayString: "3305 Cardinal",
                frequency: 1,
                autoFixed: false,
                meta: { pattern: "gemini", kind: "primary", discoveryScore: 0 },
              },
            ],
          },
        ],
      }),
    );
    // Two user-typed sections (3910 Bucknell, 851 Peavy) + two discovered
    // sections (205 Freedom Trail, 3305 Cardinal) rendered as first-class
    // PRIMARIES per Phase 6 Round 1 step 5.
    expect(r.whatSections).toHaveLength(4);
    const bucknell = r.whatSections.find((s) => s.what === "3910 Bucknell");
    expect(bucknell?.state).toBe("found_anchored");
    expect(bucknell?.provenance).toBe("user_input");
    expect(bucknell?.anchor?.displayLabel).toBe("3910 Bucknell Drive");
    // Phase 6 Round 1 step 3 — Gemini anchor for a user-typed WHAT is pre-
    // ticked (it represents the user's typed input with a polished label,
    // not a discovery the user needs to opt into).
    expect(bucknell?.anchor?.preTicked).toBe(true);
    // Peavy's anchor picked up via token overlap fallback (user typed
    // "851 Peavy", Gemini returned "851 Peavy Road").
    const peavy = r.whatSections.find((s) => s.what === "851 Peavy");
    expect(peavy?.anchor?.displayLabel).toBe("851 Peavy Road");
    expect(peavy?.anchor?.preTicked).toBe(true);
    // Adjacent discoveries land as their own first-class "discovered" sections.
    const discovered = r.whatSections.filter((s) => s.provenance === "discovered");
    expect(discovered.map((s) => s.anchor?.displayLabel).sort()).toEqual([
      "205 Freedom Trail",
      "3305 Cardinal",
    ]);
    // Pre-tick policy matches eval gate-sim: score >= 1 pre-ticked,
    // score 0 un-ticked so the user opts in.
    const freedomTrail = discovered.find((s) => s.anchor?.displayLabel === "205 Freedom Trail");
    expect(freedomTrail?.anchor?.preTicked).toBe(true); // score 1
    const cardinal = discovered.find((s) => s.anchor?.displayLabel === "3305 Cardinal");
    expect(cardinal?.anchor?.preTicked).toBe(false); // score 0
    // Discovered sections carry the anchor's source domain for UI attribution.
    expect(freedomTrail?.discoveredOnDomain).toBe("judgefite.com");
  });

  it("agency-domain-derive anchors the WHAT and carries confirmedSenderTotalMatches as frequency", () => {
    const r = buildPerWhatGroups(
      baseInput({
        inputs: {
          role: "",
          domain: "agency",
          whats: ["Portfolio Pro Advisors"],
          whos: ["Margaret Potter", "George Trevino"],
          groups: [
            {
              whats: ["Portfolio Pro Advisors"],
              whos: ["Margaret Potter", "George Trevino"],
            },
          ],
          goals: [],
        },
        stage1UserThings: [
          {
            query: "Portfolio Pro Advisors",
            matchCount: 10,
            topDomain: "portfolioproadvisors.com",
            topSenders: [],
            errorCount: 0,
          },
        ],
        stage1UserContacts: [
          {
            query: "Margaret Potter",
            matchCount: 9,
            senderEmail: "mpotter@portfolioproadvisors.com",
            senderDomain: "portfolioproadvisors.com",
            errorCount: 0,
          },
          {
            query: "George Trevino",
            matchCount: 10,
            senderEmail: "gtrevino@portfolioproadvisors.com",
            senderDomain: "portfolioproadvisors.com",
            errorCount: 0,
          },
        ],
        stage1ConfirmedUserContactQueries: ["Margaret Potter", "George Trevino"],
        stage2Candidates: [
          {
            confirmedDomain: "portfolioproadvisors.com",
            algorithm: "agency-domain-derive",
            candidates: [
              {
                key: "portfolio-pro-advisors",
                displayString: "Portfolio Pro Advisors",
                frequency: 19,
                autoFixed: false,
                meta: {
                  pattern: "agency-domain-derive",
                  kind: "primary",
                  relatedWhat: "Portfolio Pro Advisors",
                  authoritativeDomain: "portfolioproadvisors.com",
                },
              },
            ],
          },
        ],
      }),
    );
    const [section] = r.whatSections;
    expect(section.state).toBe("found_anchored");
    expect(section.anchor?.origin).toBe("agency_domain_derive");
    expect(section.anchor?.frequency).toBe(19);
    expect(section.pairedWhos.map((w) => w.displayLabel).sort()).toEqual([
      "George Trevino",
      "Margaret Potter",
    ]);
  });
});
