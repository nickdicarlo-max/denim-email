import { describe, expect, it } from "vitest";
import { aggregateDomains } from "../discovery/domain-aggregator";

const sample = [
  { messageId: "1", fromHeader: "A <a@portfolioproadvisors.com>" },
  { messageId: "2", fromHeader: "<b@portfolioproadvisors.com>" },
  { messageId: "3", fromHeader: "c@portfolioproadvisors.com" },
  { messageId: "4", fromHeader: "D <d@stallionis.com>" },
  { messageId: "5", fromHeader: "E <e@gmail.com>" },
  { messageId: "6", fromHeader: "F <nick@thecontrolsurface.com>" },
  { messageId: "7", fromHeader: "" }, // malformed
];

describe("aggregateDomains", () => {
  it("groups by sender domain and sorts descending", () => {
    const result = aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 5 });
    expect(result[0]).toEqual({ domain: "portfolioproadvisors.com", count: 3 });
    expect(result[1]).toEqual({ domain: "stallionis.com", count: 1 });
  });

  it("drops generic providers", () => {
    const result = aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 5 });
    expect(result.find((r) => r.domain === "gmail.com")).toBeUndefined();
  });

  it("drops the user's own domain", () => {
    const result = aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 5 });
    expect(result.find((r) => r.domain === "thecontrolsurface.com")).toBeUndefined();
  });

  it("respects topN", () => {
    const result = aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("portfolioproadvisors.com");
  });

  it("handles malformed headers without crashing", () => {
    expect(() =>
      aggregateDomains(sample, { userDomain: "thecontrolsurface.com", topN: 5 }),
    ).not.toThrow();
  });

  it("case-insensitive domain matching (treats GMAIL.COM and gmail.com as same generic)", () => {
    const result = aggregateDomains([{ messageId: "1", fromHeader: "<a@GMAIL.COM>" }], {
      userDomain: "x.com",
      topN: 5,
    });
    expect(result).toHaveLength(0);
  });
});
