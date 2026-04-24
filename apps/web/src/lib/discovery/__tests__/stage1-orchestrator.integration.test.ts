/**
 * Integration test for the hint-anchored Stage 1 orchestrator (2026-04-23
 * rewrite). Exercises the full chain (user-hints-discovery +
 * scoreDomainCandidates) against a faked GmailClient. Verifies:
 *   - WHO hints score their senderDomain
 *   - Paired-WHO triangulation (#117) attributes WHAT topDomain → paired WHO senderDomain
 *   - Compounding-signal threshold (≥2) excludes single-signal candidates
 *   - Public-provider and platform-denylist vetoes
 *   - Zero-match hints still surface via `userThings` / `userContacts`
 */

import { describe, expect, it, vi } from "vitest";
import { discoverStage1Candidates } from "../stage1-orchestrator";

/**
 * Minimal GmailClient stub that answers both:
 *   - `searchEmails(query, limit)` — the legacy path that
 *     `discoverUserNamedThings` / `discoverUserNamedContacts` exercises via
 *     its internal `fetchFromHeaders` wrapper.
 *   - `listMessageIds(query, limit)` + `getMessageMetadata(id, headers)` —
 *     the raw primitives `fetchFromHeaders` actually calls.
 *
 * Takes a `matchMap`: a map from Gmail query to the list of `From:` headers
 * to return. The keys don't need to be exact — we match by substring so
 * each hint's quoted-phrase query lands in the right bucket.
 */
function makeFakeGmail(matchMap: Array<{ match: string; fromHeaders: string[] }>) {
  const listCalls: string[] = [];
  const getCalls: string[] = [];
  // Assign stable IDs per header so the metadata fetch can echo them back.
  const idByQueryIndex = new Map<string, string[]>();
  const headerById = new Map<string, string>();
  let counter = 0;
  for (const entry of matchMap) {
    const ids: string[] = [];
    for (const h of entry.fromHeaders) {
      const id = `m${counter++}`;
      ids.push(id);
      headerById.set(id, h);
    }
    idByQueryIndex.set(entry.match, ids);
  }

  const findIds = (query: string): string[] => {
    for (const [match, ids] of idByQueryIndex.entries()) {
      if (query.includes(match)) return ids;
    }
    return [];
  };

  return {
    client: {
      listMessageIds: vi.fn(async (query: string, _limit: number) => {
        listCalls.push(query);
        return findIds(query);
      }),
      getMessageMetadata: vi.fn(async (id: string, _headers: string[]) => {
        getCalls.push(id);
        return {
          id,
          payload: {
            headers: [{ name: "From", value: headerById.get(id) ?? "" }],
          },
        };
      }),
      searchEmails: vi.fn(),
    },
    listCalls,
    getCalls,
  };
}

describe("discoverStage1Candidates", () => {
  it("paired-WHO triangulation surfaces teamsnap.com for soccer", async () => {
    const { client } = makeFakeGmail([
      // Ziad Allan's `from:"Ziad Allan"` search returns teamsnap
      {
        match: 'from:"Ziad Allan"',
        fromHeaders: Array(10).fill("Ziad Allan <donotreply@email.teamsnap.com>"),
      },
      // "soccer" full-text search also hits teamsnap (supports triangulation)
      {
        match: '"soccer"',
        fromHeaders: Array(8).fill("TeamSnap <donotreply@email.teamsnap.com>"),
      },
    ]);

    const result = await discoverStage1Candidates({
      // biome-ignore lint/suspicious/noExplicitAny: partial mock
      gmailClient: client as any,
      userDomain: "thecontrolsurface.com",
      whats: ["soccer"],
      whos: ["Ziad Allan"],
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].domain).toBe("email.teamsnap.com");
    // Paired-WHO hit = +3. WHAT topDomain already credited to paired-WHO path,
    // no double-count → score = 3.
    expect(result.candidates[0].score).toBe(3);
    expect(result.candidates[0].signals).toContain("paired_who");
    expect(result.candidates[0].pairedWho).toBe("Ziad Allan");
    expect(result.candidates[0].hintsMatched).toEqual(["soccer"]);
  });

  it("filters public-provider hits even when paired", async () => {
    const { client } = makeFakeGmail([
      {
        match: 'from:"Amy DiCarlo"',
        fromHeaders: Array(18).fill("Amy DiCarlo <amy@gmail.com>"),
      },
    ]);

    const result = await discoverStage1Candidates({
      // biome-ignore lint/suspicious/noExplicitAny: partial mock
      gmailClient: client as any,
      userDomain: "thecontrolsurface.com",
      whats: [],
      whos: ["Amy DiCarlo"],
      groups: [{ whats: ["lanier", "st agnes"], whos: ["Amy DiCarlo"] }],
    });

    // gmail.com vetoed by public-provider rule → no candidate surfaced.
    expect(result.candidates).toEqual([]);
    // But the WHO search still surfaces in userContacts for the review screen.
    expect(result.userContacts[0].matchCount).toBe(18);
  });

  it("filters platform-denylist hits (github, flosports)", async () => {
    const { client } = makeFakeGmail([
      {
        match: '"copilot"',
        fromHeaders: Array(40).fill("GitHub <noreply@github.com>"),
      },
      {
        match: '"tournament"',
        fromHeaders: Array(15).fill("FloSports <mail@flosports.tv>"),
      },
    ]);

    const result = await discoverStage1Candidates({
      // biome-ignore lint/suspicious/noExplicitAny: partial mock
      gmailClient: client as any,
      userDomain: "thecontrolsurface.com",
      whats: ["copilot", "tournament"],
      whos: [],
      groups: [],
    });

    expect(result.candidates).toEqual([]);
  });

  it("preserves zero-match hint contract (find it or tell me)", async () => {
    const { client } = makeFakeGmail([]);

    const result = await discoverStage1Candidates({
      // biome-ignore lint/suspicious/noExplicitAny: partial mock
      gmailClient: client as any,
      userDomain: "thecontrolsurface.com",
      whats: ["Portfolio Pro Advisors"],
      whos: ["Mike Patel"],
      groups: [],
    });

    // No candidates because no matches.
    expect(result.candidates).toEqual([]);
    // But the hints surface with matchCount=0 so the review UI can say "not found".
    expect(result.userThings).toHaveLength(1);
    expect(result.userThings[0]).toMatchObject({
      query: "Portfolio Pro Advisors",
      matchCount: 0,
    });
    expect(result.userContacts).toHaveLength(1);
    expect(result.userContacts[0]).toMatchObject({
      query: "Mike Patel",
      matchCount: 0,
    });
  });

  it("property: addresses converge on judgefite.com via unpaired WHATs", async () => {
    const { client } = makeFakeGmail([
      {
        match: '"1621 Sylvan"',
        fromHeaders: Array(30).fill("Timothy Bishop <tb@judgefite.com>"),
      },
      {
        match: '"3305 Cardinal"',
        fromHeaders: Array(22).fill("Timothy Bishop <tb@judgefite.com>"),
      },
      {
        match: '"3910 Bucknell"',
        fromHeaders: Array(14).fill("Timothy Bishop <tb@judgefite.com>"),
      },
    ]);

    const result = await discoverStage1Candidates({
      // biome-ignore lint/suspicious/noExplicitAny: partial mock
      gmailClient: client as any,
      userDomain: "thecontrolsurface.com",
      whats: ["1621 Sylvan", "3305 Cardinal", "3910 Bucknell"],
      whos: [],
      groups: [],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].domain).toBe("judgefite.com");
    // First WHAT +2, two additional +1 each = 4.
    expect(result.candidates[0].score).toBe(4);
    expect(result.candidates[0].hintsMatched.sort()).toEqual([
      "1621 Sylvan",
      "3305 Cardinal",
      "3910 Bucknell",
    ]);
  });
});
