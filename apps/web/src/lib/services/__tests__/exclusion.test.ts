import { describe, it, expect } from "vitest";
import { matchesExclusionRule } from "../exclusion";

const email = {
  senderEmail: "noreply@schwab.com",
  senderDomain: "schwab.com",
  subject: "Your automatic reply has been received",
  threadId: "thread-abc-123",
};

const rules = [
  { ruleType: "DOMAIN", pattern: "schwab.com", isActive: true },
  { ruleType: "SENDER", pattern: "spam@example.com", isActive: true },
  { ruleType: "KEYWORD", pattern: "automatic reply", isActive: true },
  { ruleType: "THREAD", pattern: "thread-xyz-999", isActive: true },
  { ruleType: "DOMAIN", pattern: "disabled.com", isActive: false },
];

describe("matchesExclusionRule", () => {
  it("matches DOMAIN rule", () => {
    const result = matchesExclusionRule(email, rules);
    expect(result.matched).toBe(true);
    expect(result.rule?.ruleType).toBe("DOMAIN");
    expect(result.rule?.pattern).toBe("schwab.com");
  });

  it("matches SENDER rule", () => {
    const result = matchesExclusionRule(
      { ...email, senderDomain: "other.com", senderEmail: "spam@example.com" },
      rules,
    );
    expect(result.matched).toBe(true);
    expect(result.rule?.ruleType).toBe("SENDER");
  });

  it("matches KEYWORD rule in subject", () => {
    const result = matchesExclusionRule(
      { ...email, senderDomain: "other.com", senderEmail: "user@other.com" },
      rules,
    );
    expect(result.matched).toBe(true);
    expect(result.rule?.ruleType).toBe("KEYWORD");
  });

  it("matches THREAD rule", () => {
    const result = matchesExclusionRule(
      {
        senderEmail: "user@clean.com",
        senderDomain: "clean.com",
        subject: "Normal email",
        threadId: "thread-xyz-999",
      },
      rules,
    );
    expect(result.matched).toBe(true);
    expect(result.rule?.ruleType).toBe("THREAD");
  });

  it("returns no match when nothing applies", () => {
    const result = matchesExclusionRule(
      {
        senderEmail: "user@clean.com",
        senderDomain: "clean.com",
        subject: "Normal email",
        threadId: "thread-clean",
      },
      rules,
    );
    expect(result.matched).toBe(false);
    expect(result.rule).toBeUndefined();
  });

  it("skips inactive rules", () => {
    const result = matchesExclusionRule(
      {
        senderEmail: "user@disabled.com",
        senderDomain: "disabled.com",
        subject: "Should not match",
        threadId: "thread-other",
      },
      rules,
    );
    expect(result.matched).toBe(false);
  });

  it("matches case-insensitively for DOMAIN", () => {
    const result = matchesExclusionRule(
      { ...email, senderDomain: "SCHWAB.COM" },
      rules,
    );
    expect(result.matched).toBe(true);
  });
});
