import { describe, expect, it } from "vitest";
import { buildStage1Query } from "../domain-discovery";

describe("buildStage1Query", () => {
  it("builds a Gmail OR-subject query with the domain's keyword list", () => {
    const q = buildStage1Query("property", 365);
    expect(q).toContain('subject:(');
    expect(q).toContain('"invoice"');
    expect(q).toContain('"repair"');
    expect(q).toContain('-category:promotions');
    expect(q).toContain('newer_than:365d');
  });

  it("agency query contains the working-vocab additions", () => {
    const q = buildStage1Query("agency", 365);
    expect(q).toContain('"call"');
    expect(q).toContain('"slides"');
    expect(q).toContain('"initiative"');
  });

  it("school_parent query contains multi-word phrases properly quoted", () => {
    const q = buildStage1Query("school_parent", 365);
    expect(q).toContain('"field trip"');
    expect(q).toContain('"report card"');
  });

  it("throws on unknown domain", () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising error path
    expect(() => buildStage1Query("legal" as any, 365)).toThrow(/Unknown domain/);
  });
});
