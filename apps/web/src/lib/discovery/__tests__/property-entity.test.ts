import { describe, expect, it } from "vitest";
import { extractPropertyCandidates, normalizeAddressKey } from "../property-entity";

describe("extractPropertyCandidates", () => {
  const subject = (s: string) => ({ subject: s, frequency: 1 });

  it("captures spec examples: 1906 Crockett, 2310 Healey Dr, 205 Freedom Trail, 851 Peavy", () => {
    const result = extractPropertyCandidates([
      subject("Repair quote 1906 Crockett"),
      subject("2310 Healey Dr inspection"),
      subject("205 Freedom Trail renewal"),
      subject("851 Peavy balance"),
    ]);
    const displays = result.map((r) => r.displayString);
    expect(displays).toContain("1906 Crockett");
    expect(displays).toContain("2310 Healey Dr");
    expect(displays).toContain("205 Freedom Trail");
    expect(displays).toContain("851 Peavy");
  });

  it("drops year-like numbers 2000-2030 (spec false-positive guard)", () => {
    const result = extractPropertyCandidates([
      subject("Lease expires 2026 December"),
      subject("Planning 2025 Renovation"),
    ]);
    const numbers = result.map((r) => parseInt(r.key, 10));
    for (const n of numbers) {
      expect(n < 2000 || n > 2030).toBe(true);
    }
  });

  it("dedups via Levenshtein (851 Peavy / 851 peavy merge)", () => {
    const result = extractPropertyCandidates([
      subject("851 Peavy repair"),
      subject("Fw: 851 peavy statement"),
      subject("RE: 851 Peavy inspection"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(3);
  });

  it("Drive/Dr variants merge", () => {
    const result = extractPropertyCandidates([
      subject("2310 Healey Dr maintenance"),
      subject("2310 Healey Drive renewal"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(2);
  });

  it("returns no candidates when no addresses in subjects", () => {
    const result = extractPropertyCandidates([subject("Newsletter"), subject("Hello")]);
    expect(result).toEqual([]);
  });

  it("sorts by frequency descending", () => {
    const result = extractPropertyCandidates([
      subject("100 Alpha St"),
      subject("100 Alpha St"),
      subject("100 Alpha St"),
      subject("200 Bravo St"),
    ]);
    expect(result[0].displayString).toContain("Alpha");
    expect(result[0].frequency).toBe(3);
    expect(result[1].frequency).toBe(1);
  });

  it("completes under 50ms on pathological subjects (ReDoS guard)", () => {
    const pathological = "100 " + "Aa Bb Cc Dd Ee ".repeat(60);
    const started = Date.now();
    extractPropertyCandidates([subject(pathological)]);
    const duration = Date.now() - started;
    expect(duration).toBeLessThan(50);
  });

  it("regex v2: compass prefix captured (N 851 Peavy)", () => {
    const result = extractPropertyCandidates([subject("N 851 Peavy repair")]);
    expect(result.some((r) => r.displayString.includes("851 Peavy"))).toBe(true);
  });

  it("regex v2: 2-digit house number captured (15 Main St)", () => {
    const result = extractPropertyCandidates([subject("15 Main St lease")]);
    expect(result.some((r) => r.displayString.includes("15 Main"))).toBe(true);
  });

  it("regex v2: normalizeAddressKey collapses Dr and Drive to same key", () => {
    expect(normalizeAddressKey("2310 Healey Drive")).toBe(normalizeAddressKey("2310 Healey Dr"));
  });

  // #119: short/long suffix pair dedup. Before the fix these produced two
  // candidates each because "851 Peavy" and "851 Peavy Road" generated
  // different normalized keys.
  describe("#119 short/long suffix pair dedup", () => {
    it("851 Peavy + 851 Peavy Road → one candidate (longest form wins)", () => {
      const result = extractPropertyCandidates([
        subject("851 Peavy balance"),
        subject("851 Peavy Road maintenance"),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].displayString).toBe("851 Peavy Road");
      expect(result[0].frequency).toBe(2);
    });

    it("collapses all 8 short/long pairs from the 2026-04-19 property run", () => {
      const result = extractPropertyCandidates([
        subject("Fw: 851 Peavy repair"),
        subject("851 Peavy Road inspection"),
        subject("1501 Sylvan statement"),
        subject("1501 Sylvan Drive maintenance"),
        subject("1906 Crockett repair"),
        subject("1906 Crockett Street closing"),
        subject("205 Freedom renewal"),
        subject("205 Freedom Trail payment"),
        subject("2109 Meadfoot lease"),
        subject("2109 Meadfoot Road invoice"),
        subject("2310 Healey balance"),
        subject("2310 Healey Drive receipt"),
        subject("3910 Bucknell inspection"),
        subject("3910 Bucknell Drive maintenance"),
        subject("1206 Fairmont statement"),
        subject("1206 Fairmont Street balance"),
      ]);
      // Each of the 8 pairs collapses to 1 entry.
      expect(result).toHaveLength(8);
      const displays = new Set(result.map((r) => r.displayString));
      // Verbose form wins on each merge.
      expect(displays).toContain("851 Peavy Road");
      expect(displays).toContain("1501 Sylvan Drive");
      expect(displays).toContain("1906 Crockett Street");
      expect(displays).toContain("205 Freedom Trail");
      expect(displays).toContain("2109 Meadfoot Road");
      expect(displays).toContain("2310 Healey Drive");
      expect(displays).toContain("3910 Bucknell Drive");
      expect(displays).toContain("1206 Fairmont Street");
    });
  });
});
