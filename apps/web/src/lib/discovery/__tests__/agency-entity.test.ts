import { describe, expect, it } from "vitest";
import { deriveAgencyEntity } from "../agency-entity";

describe("deriveAgencyEntity — domain-only derivation", () => {
  it("anthropic.com -> Anthropic", () => {
    const result = deriveAgencyEntity({
      authoritativeDomain: "anthropic.com",
      senderDisplayNames: [],
    });
    expect(result.displayLabel).toBe("Anthropic");
    expect(result.needsUserEdit).toBe(false);
  });

  it("portfolio-pro-advisors.com -> Portfolio Pro Advisors", () => {
    const result = deriveAgencyEntity({
      authoritativeDomain: "portfolio-pro-advisors.com",
      senderDisplayNames: [],
    });
    expect(result.displayLabel).toBe("Portfolio Pro Advisors");
  });

  it("sghgroup.com -> defined label, correct authoritativeDomain", () => {
    const result = deriveAgencyEntity({
      authoritativeDomain: "sghgroup.com",
      senderDisplayNames: [],
    });
    expect(result.displayLabel).toBeDefined();
    expect(result.authoritativeDomain).toBe("sghgroup.com");
  });

  it("numeric-heavy domain -> needsUserEdit", () => {
    const result = deriveAgencyEntity({
      authoritativeDomain: "xyz123.com",
      senderDisplayNames: [],
    });
    expect(result.needsUserEdit).toBe(true);
  });
});

describe("deriveAgencyEntity — display-name convergence (80%+ rule)", () => {
  it("uses display-name company token when ≥80% converge", () => {
    const names = [
      "Sarah Chen | Anthropic",
      "Mike Roberts | Anthropic",
      "Jane at Anthropic",
      "Anthropic Team",
      "Sarah Chen",
    ];
    const result = deriveAgencyEntity({
      authoritativeDomain: "anthropic.com",
      senderDisplayNames: names,
    });
    expect(result.displayLabel).toBe("Anthropic");
    expect(result.derivedVia).toBe("display-name");
  });

  it("falls back to domain when convergence below 80%", () => {
    const names = ["Sarah Chen", "Mike Roberts", "Jane", "Person D"];
    const result = deriveAgencyEntity({
      authoritativeDomain: "anthropic.com",
      senderDisplayNames: names,
    });
    expect(result.derivedVia).toBe("domain");
  });
});
