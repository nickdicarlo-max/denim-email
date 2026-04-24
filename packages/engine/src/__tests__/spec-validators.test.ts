import { describe, expect, it } from "vitest";
import { validateEntityAgainstSpec } from "../discovery/spec-validators";

describe("validateEntityAgainstSpec", () => {
  describe("property §5", () => {
    it.each([
      "3910 Bucknell Drive",
      "851 Peavy Road",
      "205 Freedom Trail",
      "La Touraine",
      "Empire State Building",
      "North 40 Partners LLC",
    ])("accepts legitimate PRIMARY %s", (name) => {
      expect(validateEntityAgainstSpec({ name, schemaDomain: "property" }).valid).toBe(true);
    });

    it.each([
      ["Bucknell", "single_word_fragment"],
      ["Peavy", "single_word_fragment"],
      ["Sylvan", "single_word_fragment"],
      ["3910", "bare_number"],
      ["851", "bare_number"],
      ["the house", "generic_phrase"],
      ["property", "generic_phrase"],
      ["Bucknell Drive", "street_type_alone"],
      ["Peavy Road", "street_type_alone"],
      ["Drive", "street_type_alone"],
    ])("rejects %s with code %s", (name, code) => {
      const r = validateEntityAgainstSpec({ name, schemaDomain: "property" });
      expect(r.valid).toBe(false);
      expect(r.violationCode).toBe(code);
    });

    it("rejects engagement fragments on property", () => {
      const r = validateEntityAgainstSpec({
        name: "Q2 Quarterly Review",
        schemaDomain: "property",
      });
      expect(r.valid).toBe(false);
      expect(r.violationCode).toBe("engagement_or_case_fragment");
    });
  });

  describe("school_parent §5", () => {
    it.each([
      "soccer",
      "Lanier",
      "St Agnes",
      "Vail Mountain School",
      "Pia Ballet",
      "ZSA U11 Girls Competitive Rise",
    ])("accepts legitimate PRIMARY %s", (name) => {
      expect(validateEntityAgainstSpec({ name, schemaDomain: "school_parent" }).valid).toBe(true);
    });

    it.each([
      ["team", "generic_context_word"],
      ["practice", "generic_context_word"],
      ["game", "generic_context_word"],
      ["fall", "generic_context_word"],
      ["spring", "generic_context_word"],
      ["Fall 2025", "engagement_or_case_fragment"],
      ["Spring 2026", "engagement_or_case_fragment"],
    ])("rejects %s with code %s", (name, code) => {
      const r = validateEntityAgainstSpec({ name, schemaDomain: "school_parent" });
      expect(r.valid).toBe(false);
      expect(r.violationCode).toBe(code);
    });

    it("rejects engagement-shaped names", () => {
      const r = validateEntityAgainstSpec({
        name: "Pia Spring Dance Show",
        schemaDomain: "school_parent",
      });
      // Note: "Pia Spring Dance Show" is acceptable — includes a proper noun.
      // An actual engagement like "Meeting #3" gets caught.
      expect(r.valid).toBe(true);

      const r2 = validateEntityAgainstSpec({
        name: "Meeting #3",
        schemaDomain: "school_parent",
      });
      expect(r2.valid).toBe(false);
    });
  });

  describe("agency §5", () => {
    it.each([
      "Portfolio Pro Advisors",
      "Stallion",
      "Anthropic",
      "Tesla",
      "SGH Group",
    ])("accepts legitimate PRIMARY %s", (name) => {
      expect(validateEntityAgainstSpec({ name, schemaDomain: "agency" }).valid).toBe(true);
    });

    it.each([
      ["client", "generic_context_word"],
      ["company", "generic_context_word"],
      ["project", "generic_context_word"],
      ["PPA", "single_common_word"], // ≤3 chars
      ["Nic", "single_common_word"], // ≤3 chars
    ])("rejects %s with code %s", (name, code) => {
      const r = validateEntityAgainstSpec({ name, schemaDomain: "agency" });
      expect(r.valid).toBe(false);
      expect(r.violationCode).toBe(code);
    });

    it.each([
      "KPI Dashboard Dreamlist",
      "AI Session #2",
      "V7 Update",
      "Rhodes Data Test Sample",
      "Intermediate Round Demo",
      "Q2 Review",
    ])("rejects engagement/case fragment %s", (name) => {
      const r = validateEntityAgainstSpec({ name, schemaDomain: "agency" });
      expect(r.valid).toBe(false);
      expect(r.violationCode).toBe("engagement_or_case_fragment");
    });
  });
});
