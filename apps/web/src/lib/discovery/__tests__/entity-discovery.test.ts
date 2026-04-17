import { describe, it, expect, vi } from "vitest";
import { discoverEntitiesForDomain } from "../entity-discovery";

describe("discoverEntitiesForDomain", () => {
  it("property: runs address extraction on subjects from Stage-1-confirmed domain", async () => {
    const mockGmail = {
      listMessageIds: vi.fn(async () => ["1", "2"]),
      getMessageMetadata: vi
        .fn()
        .mockResolvedValueOnce({
          id: "1",
          payload: {
            headers: [
              { name: "Subject", value: "Repair quote 1906 Crockett" },
              { name: "From", value: "<a@judgefite.com>" },
            ],
          },
        })
        .mockResolvedValueOnce({
          id: "2",
          payload: {
            headers: [
              { name: "Subject", value: "2310 Healey Dr inspection" },
              { name: "From", value: "<b@judgefite.com>" },
            ],
          },
        }),
    };
    const result = await discoverEntitiesForDomain({
      // biome-ignore lint/suspicious/noExplicitAny: shape-compatible test double
      gmailClient: mockGmail as any,
      schemaDomain: "property",
      confirmedDomain: "judgefite.com",
    });
    expect(result.algorithm).toBe("property-address");
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    expect(result.errorCount).toBe(0);
  });

  it("agency: runs domain derivation on confirmed domain (does not parse subjects)", async () => {
    const mockGmail = {
      listMessageIds: vi.fn(async () => ["1"]),
      getMessageMetadata: vi.fn(async () => ({
        id: "1",
        payload: {
          headers: [
            { name: "Subject", value: "Random project update" },
            { name: "From", value: "Sarah Chen | Anthropic <sarah@anthropic.com>" },
          ],
        },
      })),
    };
    const result = await discoverEntitiesForDomain({
      // biome-ignore lint/suspicious/noExplicitAny: shape-compatible test double
      gmailClient: mockGmail as any,
      schemaDomain: "agency",
      confirmedDomain: "anthropic.com",
    });
    expect(result.algorithm).toBe("agency-domain-derive");
    expect(result.candidates[0].displayString).toBe("Anthropic");
  });

  it("school_parent: runs two-pattern regex across fetched subjects", async () => {
    const mockGmail = {
      listMessageIds: vi.fn(async () => ["1", "2"]),
      getMessageMetadata: vi
        .fn()
        .mockResolvedValueOnce({
          id: "1",
          payload: {
            headers: [
              { name: "Subject", value: "St Agnes Auction this Friday" },
              { name: "From", value: "<news@email.teamsnap.com>" },
            ],
          },
        })
        .mockResolvedValueOnce({
          id: "2",
          payload: {
            headers: [
              { name: "Subject", value: "U11 Soccer practice schedule" },
              { name: "From", value: "<news@email.teamsnap.com>" },
            ],
          },
        }),
    };
    const result = await discoverEntitiesForDomain({
      // biome-ignore lint/suspicious/noExplicitAny: shape-compatible test double
      gmailClient: mockGmail as any,
      schemaDomain: "school_parent",
      confirmedDomain: "email.teamsnap.com",
    });
    expect(result.algorithm).toBe("school-two-pattern");
    const displays = result.candidates.map((c) => c.displayString);
    expect(displays.some((d) => /St\.?\s+Agnes/.test(d))).toBe(true);
    expect(displays.some((d) => /U11 Soccer/.test(d))).toBe(true);
  });

  it("counts per-message metadata errors without throwing", async () => {
    let call = 0;
    const mockGmail = {
      listMessageIds: vi.fn(async () => ["1", "2"]),
      getMessageMetadata: vi.fn(async () => {
        call++;
        if (call === 1) throw new Error("per-message network blip");
        return {
          id: "2",
          payload: {
            headers: [
              { name: "Subject", value: "1906 Crockett repair" },
              { name: "From", value: "<a@judgefite.com>" },
            ],
          },
        };
      }),
    };
    const result = await discoverEntitiesForDomain({
      // biome-ignore lint/suspicious/noExplicitAny: shape-compatible test double
      gmailClient: mockGmail as any,
      schemaDomain: "property",
      confirmedDomain: "judgefite.com",
    });
    expect(result.errorCount).toBe(1);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
  });
});
