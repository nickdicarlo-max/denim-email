import { describe, expect, it } from "vitest";
import { generateFingerprint, matchAction } from "../actions/dedup";

describe("generateFingerprint", () => {
  it("lowercases and sorts tokens", () => {
    const result = generateFingerprint("Sign Permission Slip");
    expect(result).toBe("permission sign slip");
  });

  it("strips stop words", () => {
    const result = generateFingerprint("Pay the invoice for the project");
    expect(result).toBe("invoice pay project");
  });

  it("removes punctuation", () => {
    const result = generateFingerprint("Submit form (urgent!) by Friday.");
    expect(result).toBe("form friday submit urgent");
  });

  it("handles empty string", () => {
    const result = generateFingerprint("");
    expect(result).toBe("");
  });

  it("handles string with only stop words", () => {
    const result = generateFingerprint("the and or but");
    expect(result).toBe("");
  });

  it("normalizes whitespace", () => {
    const result = generateFingerprint("  sign   the   form  ");
    expect(result).toBe("form sign");
  });

  it("produces identical fingerprints for semantically same titles", () => {
    const fp1 = generateFingerprint("Sign the permission slip");
    const fp2 = generateFingerprint("Permission Slip — Sign It");
    expect(fp1).toBe(fp2);
  });
});

describe("matchAction", () => {
  const existing = [
    "invoice pay project",
    "form permission sign slip",
    "deadline registration submit",
  ];

  it("returns exact match", () => {
    const result = matchAction("invoice pay project", existing);
    expect(result).toBe("invoice pay project");
  });

  it("returns similar match above threshold", () => {
    // "invoice pay" is similar to "invoice pay project"
    const result = matchAction("invoice pay", existing, 0.75);
    expect(result).toBe("invoice pay project");
  });

  it("returns null when no match above threshold", () => {
    const result = matchAction("completely different task", existing);
    expect(result).toBeNull();
  });

  it("returns null for empty existing list", () => {
    const result = matchAction("invoice pay project", []);
    expect(result).toBeNull();
  });

  it("returns best match when multiple are above threshold", () => {
    const fingerprints = ["pay invoice", "pay invoice project"];
    const result = matchAction("pay invoice project", fingerprints, 0.7);
    expect(result).toBe("pay invoice project");
  });

  it("respects custom threshold", () => {
    // With very high threshold, even close matches should fail
    const result = matchAction("invoice pay", existing, 0.99);
    expect(result).toBeNull();
  });
});
