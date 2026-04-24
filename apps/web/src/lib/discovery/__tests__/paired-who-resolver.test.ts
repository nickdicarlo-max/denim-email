import { describe, expect, it } from "vitest";
import { type ResolverInput, resolvePairingContext } from "../paired-who-resolver";

const baseInput: ResolverInput = {
  groups: [],
  userContacts: [],
  confirmedContactQueries: [],
  confirmedDomains: [],
};

describe("resolvePairingContext", () => {
  it("returns empty map when nothing is paired", () => {
    const result = resolvePairingContext(baseInput);
    expect(result.size).toBe(0);
  });

  it("builds per-domain sender emails from confirmed user contacts", () => {
    const result = resolvePairingContext({
      ...baseInput,
      userContacts: [
        {
          query: "Amy DiCarlo",
          senderEmail: "amy@gmail.com",
          senderDomain: "gmail.com",
          matchCount: 18,
        },
      ],
      confirmedContactQueries: ["Amy DiCarlo"],
      confirmedDomains: ["gmail.com"],
    });
    const ctx = result.get("gmail.com");
    expect(ctx).toBeDefined();
    expect(ctx?.senderEmails).toEqual(["amy@gmail.com"]);
    expect(ctx?.pairedWhats).toEqual([]);
    expect(ctx?.unambiguousPairedWhat).toBeUndefined();
  });

  it("includes paired WHATs when a confirmed WHO is in a group", () => {
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["lanier", "st agnes"], whos: ["Amy DiCarlo"] }],
      userContacts: [
        {
          query: "Amy DiCarlo",
          senderEmail: "amy@gmail.com",
          senderDomain: "gmail.com",
          matchCount: 18,
        },
      ],
      confirmedContactQueries: ["Amy DiCarlo"],
      confirmedDomains: ["gmail.com"],
    });
    const ctx = result.get("gmail.com");
    expect(ctx?.pairedWhats.sort()).toEqual(["lanier", "st agnes"]);
    // Multi-WHAT → Gemini still runs (with topic filter), no short-circuit.
    expect(ctx?.unambiguousPairedWhat).toBeUndefined();
  });

  it("flags unambiguous paired WHAT when one WHO for one WHAT owns the domain", () => {
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
      userContacts: [
        {
          query: "Ziad Allan",
          senderEmail: "donotreply@email.teamsnap.com",
          senderDomain: "email.teamsnap.com",
          matchCount: 276,
        },
      ],
      confirmedContactQueries: ["Ziad Allan"],
      confirmedDomains: ["email.teamsnap.com"],
    });
    const ctx = result.get("email.teamsnap.com");
    expect(ctx?.unambiguousPairedWhat).toBe("soccer");
    expect(ctx?.pairedWho).toBe("Ziad Allan");
    // Phase 5 — the paired-WHO's matchCount is exposed for the short-circuit
    // synthetic's frequency so the review UI can show the truthful count.
    expect(ctx?.pairedWhoMatchCount).toBe(276);
    expect(ctx?.confirmedSenderTotalMatches).toBe(276);
  });

  it("does not flag short-circuit when one WHO is paired to multiple WHATs", () => {
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["lanier", "st agnes", "guitar"], whos: ["Amy DiCarlo"] }],
      userContacts: [
        {
          query: "Amy DiCarlo",
          senderEmail: "amy@gmail.com",
          senderDomain: "gmail.com",
          matchCount: 18,
        },
      ],
      confirmedContactQueries: ["Amy DiCarlo"],
      confirmedDomains: ["gmail.com"],
    });
    const ctx = result.get("gmail.com");
    expect(ctx?.unambiguousPairedWhat).toBeUndefined();
    expect(ctx?.pairedWhats.sort()).toEqual(["guitar", "lanier", "st agnes"]);
  });

  it("does not flag short-circuit when multiple WHOs share one domain for the same WHAT", () => {
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["PPA"], whos: ["Margaret Potter", "George Trevino"] }],
      userContacts: [
        {
          query: "Margaret Potter",
          senderEmail: "mpotter@portfolioproadvisors.com",
          senderDomain: "portfolioproadvisors.com",
          matchCount: 9,
        },
        {
          query: "George Trevino",
          senderEmail: "gtrevino@portfolioproadvisors.com",
          senderDomain: "portfolioproadvisors.com",
          matchCount: 10,
        },
      ],
      confirmedContactQueries: ["Margaret Potter", "George Trevino"],
      confirmedDomains: ["portfolioproadvisors.com"],
    });
    const ctx = result.get("portfolioproadvisors.com");
    // Two senders at the same domain for the same WHAT — short-circuit is
    // still safe-ish but the resolver reserves short-circuit for the
    // one-sender case; Layer 3 topic filter is sufficient here. Intentional.
    expect(ctx?.unambiguousPairedWhat).toBeUndefined();
    expect(ctx?.pairedWhats).toEqual(["PPA"]);
    expect(ctx?.senderEmails.sort()).toEqual([
      "gtrevino@portfolioproadvisors.com",
      "mpotter@portfolioproadvisors.com",
    ]);
    // Phase 5 — agency-domain-derive uses confirmedSenderTotalMatches as
    // synthetic frequency when multiple WHOs share a domain (Margaret 9 +
    // George 10 = 19 emails behind the "Portfolio Pro Advisors" synthetic).
    expect(ctx?.confirmedSenderTotalMatches).toBe(19);
    expect(ctx?.pairedWhoMatchCount).toBeUndefined();
  });

  it("skips unconfirmed queries and unconfirmed domains", () => {
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
      userContacts: [
        {
          query: "Ziad Allan",
          senderEmail: "donotreply@email.teamsnap.com",
          senderDomain: "email.teamsnap.com",
          matchCount: 276,
        },
      ],
      confirmedContactQueries: [], // Ziad not confirmed by user
      confirmedDomains: ["email.teamsnap.com"],
    });
    const ctx = result.get("email.teamsnap.com");
    expect(ctx).toBeDefined();
    expect(ctx?.senderEmails).toEqual([]);
    expect(ctx?.unambiguousPairedWhat).toBeUndefined();
  });

  it("surfaces every confirmed domain even with no pairings", () => {
    const result = resolvePairingContext({
      ...baseInput,
      confirmedDomains: ["judgefite.com"],
    });
    expect(result.has("judgefite.com")).toBe(true);
    const ctx = result.get("judgefite.com");
    expect(ctx?.senderEmails).toEqual([]);
    expect(ctx?.pairedWhats).toEqual([]);
    expect(ctx?.unambiguousPairedWhat).toBeUndefined();
  });
});
