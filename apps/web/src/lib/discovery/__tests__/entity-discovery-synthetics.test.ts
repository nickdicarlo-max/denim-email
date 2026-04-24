/**
 * Stage 2 synthetic-candidate frequency tests (Phase 5 Part A).
 *
 * The short-circuit and agency-domain-derive paths both emit synthetic
 * EntityCandidate rows. Previously both set `frequency: 0`, which the
 * review UI rendered as "0 emails" on legitimate entities (e.g., `soccer`
 * or `Portfolio Pro Advisors`). Phase 5 threads the paired-WHO match
 * count (short-circuit) and the sum of confirmed-WHO match counts
 * (agency-derive) so the synthetic's frequency reflects reality.
 *
 * These tests exercise `discoverEntitiesForDomain` directly with the
 * short-circuit / agency-derive input shapes and assert the emitted
 * frequency and `meta.relatedWhat` normalisation (Part B — agency-derive
 * previously wrote `sourcedFromWhat`).
 */

import { describe, expect, it, vi } from "vitest";
import { discoverEntitiesForDomain } from "../entity-discovery";

function makeStubClient() {
  return {
    listMessageIds: vi.fn(async () => []),
    getMessageMetadata: vi.fn(),
    searchEmails: vi.fn(),
  };
}

describe("discoverEntitiesForDomain — synthetic frequency (Phase 5 Part A)", () => {
  it("short-circuit uses paired-WHO matchCount as synthetic frequency", async () => {
    const { client } = { client: makeStubClient() };
    const result = await discoverEntitiesForDomain({
      // biome-ignore lint/suspicious/noExplicitAny: partial mock
      gmailClient: client as any,
      schemaDomain: "school_parent",
      confirmedDomain: "email.teamsnap.com",
      confirmedSenderEmails: ["donotreply@email.teamsnap.com"],
      unambiguousPairedWhat: "soccer",
      pairedWho: "Ziad Allan",
      pairedWhoMatchCount: 276,
    });
    expect(result.algorithm).toBe("pair-short-circuit");
    expect(result.candidates).toHaveLength(1);
    const [c] = result.candidates;
    expect(c.displayString).toBe("soccer");
    expect(c.frequency).toBe(276);
    expect(c.meta?.pattern).toBe("short-circuit");
    expect(c.meta?.relatedWhat).toBe("soccer");
    expect(c.meta?.sourcedFromWho).toBe("Ziad Allan");
  });

  it("short-circuit falls back to 0 when pairedWhoMatchCount is not threaded", async () => {
    // Defensive fallback — UI renders this as "· just confirmed" copy.
    const { client } = { client: makeStubClient() };
    const result = await discoverEntitiesForDomain({
      // biome-ignore lint/suspicious/noExplicitAny: partial mock
      gmailClient: client as any,
      schemaDomain: "school_parent",
      confirmedDomain: "email.teamsnap.com",
      confirmedSenderEmails: ["donotreply@email.teamsnap.com"],
      unambiguousPairedWhat: "soccer",
      pairedWho: "Ziad Allan",
      // pairedWhoMatchCount omitted
    });
    expect(result.candidates[0].frequency).toBe(0);
  });

  it("agency-domain-derive uses confirmedSenderTotalMatches (multi-WHO case)", async () => {
    // Margaret 9 + George 10 at portfolioproadvisors.com = 19.
    const { client } = { client: makeStubClient() };
    const result = await discoverEntitiesForDomain({
      // biome-ignore lint/suspicious/noExplicitAny: partial mock
      gmailClient: client as any,
      schemaDomain: "agency",
      confirmedDomain: "portfolioproadvisors.com",
      topicKeywords: ["Portfolio Pro Advisors"],
      confirmedSenderTotalMatches: 19,
    });
    expect(result.algorithm).toBe("agency-domain-derive");
    expect(result.candidates).toHaveLength(1);
    const [c] = result.candidates;
    expect(c.displayString).toBe("Portfolio Pro Advisors");
    expect(c.frequency).toBe(19);
    expect(c.meta?.pattern).toBe("agency-domain-derive");
    // Phase 5 Part B — unified on `relatedWhat` (was `sourcedFromWhat`).
    expect(c.meta?.relatedWhat).toBe("Portfolio Pro Advisors");
    expect(c.meta?.authoritativeDomain).toBe("portfolioproadvisors.com");
  });

  it("agency-domain-derive without paired WHAT falls back to domain-derived label", async () => {
    // No topicKeywords → display label derived from domain segments.
    const { client } = { client: makeStubClient() };
    const result = await discoverEntitiesForDomain({
      // biome-ignore lint/suspicious/noExplicitAny: partial mock
      gmailClient: client as any,
      schemaDomain: "agency",
      confirmedDomain: "anthropic.com",
      confirmedSenderTotalMatches: 5,
    });
    expect(result.candidates[0].displayString).toBe("Anthropic");
    expect(result.candidates[0].frequency).toBe(5);
    // No paired WHAT → relatedWhat not set on meta.
    expect(result.candidates[0].meta?.relatedWhat).toBeUndefined();
  });
});
