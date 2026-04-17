/**
 * In-process integration test for Stage 1 `discoverDomains` orchestrator.
 *
 * Exercises the full chain (buildStage1Query -> fetchFromHeaders ->
 * aggregateDomains) against a faked GmailClient that returns `From` headers
 * for a controlled set of message IDs. Verifies:
 *   - rank-ordering of candidate domains by count
 *   - drop of public providers (gmail.com) and the user's own domain
 *   - per-domain topN enforcement (property=3, agency=5)
 *   - queryUsed carries the Gmail subject / newer_than markers
 *   - errorCount is 0 for a clean run
 *   - both GmailClient primitives are actually invoked by the chain
 *
 * NOTE: the real `fetchFromHeaders` calls `client.listMessageIds(query, limit)`,
 * not `searchEmails`. The mock below matches the real API surface.
 */

import { describe, expect, it, vi } from "vitest";
import { discoverDomains } from "../domain-discovery";

function makeMockGmail(messagesByDomain: Record<string, number>) {
  const ids: string[] = [];
  const headerById = new Map<string, string>();
  let counter = 0;
  for (const [domain, count] of Object.entries(messagesByDomain)) {
    for (let i = 0; i < count; i++) {
      const id = `m${counter++}`;
      ids.push(id);
      headerById.set(id, `<u${counter}@${domain}>`);
    }
  }
  return {
    listMessageIds: vi.fn(async () => ids),
    getMessageMetadata: vi.fn(async (id: string) => ({
      id,
      payload: { headers: [{ name: "From", value: headerById.get(id) ?? "" }] },
    })),
  };
}

describe("discoverDomains (integration)", () => {
  it("property: returns top 3 client domains (excludes generics and user domain)", async () => {
    const messagesByDomain = {
      "judgefite.com": 17,
      "zephyrpm.com": 12,
      "teamsnap.com": 8,
      "gmail.com": 50,
      "thecontrolsurface.com": 9,
    };
    const totalMessages = Object.values(messagesByDomain).reduce((a, b) => a + b, 0);
    const gmail = makeMockGmail(messagesByDomain);

    const result = await discoverDomains({
      // biome-ignore lint/suspicious/noExplicitAny: partial GmailClient mock for test
      gmailClient: gmail as any,
      domain: "property",
      userDomain: "thecontrolsurface.com",
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]).toEqual({ domain: "judgefite.com", count: 17 });
    expect(result.candidates[1]).toEqual({ domain: "zephyrpm.com", count: 12 });
    expect(result.candidates[2]).toEqual({ domain: "teamsnap.com", count: 8 });
    expect(result.candidates.find((c) => c.domain === "gmail.com")).toBeUndefined();
    expect(
      result.candidates.find((c) => c.domain === "thecontrolsurface.com"),
    ).toBeUndefined();

    // Chain wiring: both primitives got called, metadata fetched for every ID.
    expect(gmail.listMessageIds).toHaveBeenCalledOnce();
    expect(gmail.getMessageMetadata).toHaveBeenCalledTimes(totalMessages);

    // Query shape: subject disjunction + lookback window.
    expect(result.queryUsed).toContain("subject:(");
    expect(result.queryUsed).toContain("newer_than:");

    expect(result.errorCount).toBe(0);
  });

  it("agency: returns top 5 client domains", async () => {
    const messagesByDomain = {
      "portfolioproadvisors.com": 15,
      "stallionis.com": 4,
      "anthropic.com": 3,
      "tesla.com": 2,
      "client5.com": 1,
      "client6.com": 1,
    };
    const gmail = makeMockGmail(messagesByDomain);

    const result = await discoverDomains({
      // biome-ignore lint/suspicious/noExplicitAny: partial GmailClient mock for test
      gmailClient: gmail as any,
      domain: "agency",
      userDomain: "thecontrolsurface.com",
    });

    expect(result.candidates).toHaveLength(5);
    expect(result.candidates[0].domain).toBe("portfolioproadvisors.com");
    expect(result.candidates[0].count).toBe(15);
    expect(result.candidates[1].domain).toBe("stallionis.com");
    expect(result.candidates[4].count).toBe(1);

    expect(result.queryUsed).toContain("subject:(");
    expect(result.queryUsed).toContain("newer_than:");
    expect(result.errorCount).toBe(0);
  });
});
