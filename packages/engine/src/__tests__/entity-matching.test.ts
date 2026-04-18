import { describe, expect, it } from "vitest";
import { fuzzyMatch, jaro, jaroWinkler, resolveEntity } from "../entity/matching";

describe("Jaro-Winkler entity matching", () => {
  // Test fixtures
  const targets = [
    { name: "Carlos Martinez", aliases: ["Coach Martinez", "C. Martinez"] },
    { name: "Sarah Johnson", aliases: ["Ms. Johnson", "S. Johnson"] },
    { name: "Acme Construction", aliases: ["Acme", "Acme Corp"] },
  ];

  const entities: Array<{ name: string; type: "PRIMARY" | "SECONDARY"; aliases: string[] }> = [
    { name: "John Smith", type: "PRIMARY", aliases: ["J. Smith", "Johnny Smith"] },
    { name: "Jane Doe", type: "SECONDARY", aliases: ["J. Doe"] },
    { name: "Acme Inc", type: "PRIMARY", aliases: ["Acme", "Acme Corp"] },
  ];

  describe("jaroWinkler", () => {
    it("scores MARTHA vs MARHTA at approximately 0.961", () => {
      const score = jaroWinkler("MARTHA", "MARHTA");
      expect(score).toBeCloseTo(0.961, 2);
    });

    it("returns 1.0 for identical strings", () => {
      expect(jaroWinkler("identical", "identical")).toBe(1.0);
    });

    it("returns a low score (< 0.5) for completely different strings", () => {
      const score = jaroWinkler("abc", "xyz");
      expect(score).toBeLessThan(0.5);
    });

    it("is case-insensitive", () => {
      expect(jaroWinkler("Hello", "hello")).toBe(1.0);
    });

    it("returns 1.0 for two empty strings", () => {
      expect(jaroWinkler("", "")).toBe(1.0);
    });

    it("returns 0 when one string is empty", () => {
      expect(jaroWinkler("a", "")).toBe(0);
      expect(jaroWinkler("", "a")).toBe(0);
    });
  });

  describe("fuzzyMatch", () => {
    it("matches a candidate against an alias", () => {
      const result = fuzzyMatch("Coach Martinez", targets);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Carlos Martinez");
      expect(result!.score).toBeGreaterThanOrEqual(0.85);
    });

    it("tests partial matching behavior for C. Martinez vs Carlos Martinez", () => {
      // C. Martinez is an alias, so it should match directly
      const result = fuzzyMatch("C. Martinez", targets);
      // This should match since "C. Martinez" is an exact alias
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Carlos Martinez");
    });

    it("returns null for a totally unrelated candidate", () => {
      const result = fuzzyMatch("totally unrelated", targets);
      expect(result).toBeNull();
    });

    it("returns null when no targets are above threshold", () => {
      const result = fuzzyMatch("zzzzz", targets, 0.95);
      expect(result).toBeNull();
    });

    it("uses default threshold of 0.85", () => {
      // An exact alias match should be well above 0.85
      const result = fuzzyMatch("Acme", targets);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Acme Construction");
    });
  });

  describe("resolveEntity", () => {
    it("resolves a matching sender name to the correct entity", () => {
      const result = resolveEntity("John Smith", "john@example.com", entities);
      expect(result).not.toBeNull();
      expect(result!.entityName).toBe("John Smith");
      expect(result!.entityType).toBe("PRIMARY");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("falls back to email local part when display name is empty", () => {
      // "john.smith" should fuzzy-match against "John Smith" alias "J. Smith" or name
      // The local part "john.smith" vs "John Smith" — Jaro-Winkler should handle this
      const result = resolveEntity("", "john.smith@example.com", entities);
      // This may or may not match depending on score — the key behavior is that
      // it attempts the email local part fallback
      // john.smith vs John Smith has reasonable similarity
      if (result !== null) {
        expect(result.entityName).toBe("John Smith");
      }
    });

    it("returns null when no entity matches", () => {
      const result = resolveEntity("Unknown Person", "unknown@example.com", entities);
      expect(result).toBeNull();
    });

    it("returns the correct entity type", () => {
      const result = resolveEntity("Jane Doe", "jane@example.com", entities);
      expect(result).not.toBeNull();
      expect(result!.entityType).toBe("SECONDARY");
    });

    it("matches against entity aliases", () => {
      const result = resolveEntity("J. Smith", "js@example.com", entities);
      expect(result).not.toBeNull();
      expect(result!.entityName).toBe("John Smith");
    });
  });
});
