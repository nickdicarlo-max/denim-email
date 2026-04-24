import { describe, expect, it } from "vitest";
import { DOMAIN_SHAPES, getDomainShape } from "../domain-shapes";

describe("domain-shapes", () => {
  it("knows 3 domains", () => {
    expect(Object.keys(DOMAIN_SHAPES).sort()).toEqual(["agency", "property", "school_parent"]);
  });

  it("each domain has non-empty keywords (legacy — kept for Stage 2 prompt metadata)", () => {
    // 2026-04-23: Stage 1 no longer consumes these keywords (rewritten to
    // hint-anchored compounding-signal scoring). They remain as Stage 2
    // prompt context. Tests that asserted specific keyword counts tied to
    // the old spec procedures are removed — the spec now describes goals,
    // not keyword lists (see `docs/domain-input-shapes/*.md` Phase 3.5
    // refactor).
    for (const shape of Object.values(DOMAIN_SHAPES)) {
      expect(shape.stage1Keywords.length).toBeGreaterThan(0);
    }
  });

  it("throws on unknown domain", () => {
    expect(() => getDomainShape("construction")).toThrow(/Unknown domain/);
  });
});
