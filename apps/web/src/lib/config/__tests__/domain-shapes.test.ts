import { describe, expect, it } from "vitest";
import { DOMAIN_SHAPES, getDomainShape } from "../domain-shapes";

describe("domain-shapes", () => {
  it("knows 3 domains", () => {
    expect(Object.keys(DOMAIN_SHAPES).sort()).toEqual([
      "agency",
      "property",
      "school_parent",
    ]);
  });

  it("each domain has non-empty keywords", () => {
    for (const shape of Object.values(DOMAIN_SHAPES)) {
      expect(shape.stage1Keywords.length).toBeGreaterThan(0);
    }
  });

  it("throws on unknown domain", () => {
    expect(() => getDomainShape("construction")).toThrow(/Unknown domain/);
  });

  it("property has 13 Stage 1 keywords (matches spec)", () => {
    expect(DOMAIN_SHAPES.property.stage1Keywords.length).toBe(13);
  });

  it("agency has 28 Stage 1 keywords (18 formal + 10 working — locked 2026-04-16)", () => {
    expect(DOMAIN_SHAPES.agency.stage1Keywords.length).toBe(28);
  });

  it("school_parent has 19 Stage 1 keywords", () => {
    expect(DOMAIN_SHAPES.school_parent.stage1Keywords.length).toBe(19);
  });
});
