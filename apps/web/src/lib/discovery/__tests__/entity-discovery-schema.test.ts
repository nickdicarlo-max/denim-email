import { describe, expect, it } from "vitest";
import { GeminiResponseSchema } from "../entity-discovery";

// Issue #131 — Gemini's `sourced_from_who` / `related_what` fields drift
// across runs. Live judgefite.com run on 2026-04-24 returned them as a
// `string[]`; the fixture eval (2026-04-22) saw them as `null`; happy path
// is `string`. The schema must coerce all three to a `string | null` so the
// whole per-domain response isn't dropped on a parser miss.
describe("GeminiResponseSchema — sourced_from_who / related_what shape coercion (#131)", () => {
  const base = {
    name: "Some Property",
    kind: "property" as const,
    approximate_count: 3,
    aliases: [],
  };

  it("accepts a single string", () => {
    const r = GeminiResponseSchema.parse({
      entities: [{ ...base, sourced_from_who: "Tim", related_what: "Bucknell" }],
    });
    expect(r.entities[0].sourced_from_who).toBe("Tim");
    expect(r.entities[0].related_what).toBe("Bucknell");
  });

  it("accepts null and normalises to null", () => {
    const r = GeminiResponseSchema.parse({
      entities: [{ ...base, sourced_from_who: null, related_what: null }],
    });
    expect(r.entities[0].sourced_from_who).toBeNull();
    expect(r.entities[0].related_what).toBeNull();
  });

  it("accepts the field omitted entirely", () => {
    const r = GeminiResponseSchema.parse({ entities: [{ ...base }] });
    expect(r.entities[0].sourced_from_who).toBeNull();
    expect(r.entities[0].related_what).toBeNull();
  });

  it("accepts a string[] and takes the first element", () => {
    const r = GeminiResponseSchema.parse({
      entities: [
        {
          ...base,
          sourced_from_who: ["Tim", "Krystin"],
          related_what: ["Bucknell", "Healey"],
        },
      ],
    });
    expect(r.entities[0].sourced_from_who).toBe("Tim");
    expect(r.entities[0].related_what).toBe("Bucknell");
  });

  it("accepts an empty string[] and normalises to null", () => {
    const r = GeminiResponseSchema.parse({
      entities: [{ ...base, sourced_from_who: [], related_what: [] }],
    });
    expect(r.entities[0].sourced_from_who).toBeNull();
    expect(r.entities[0].related_what).toBeNull();
  });

  it("rejects unrelated bad shapes (number, object) — fail-loud at the boundary", () => {
    expect(() =>
      GeminiResponseSchema.parse({
        entities: [{ ...base, sourced_from_who: 42 }],
      }),
    ).toThrow();
    expect(() =>
      GeminiResponseSchema.parse({
        entities: [{ ...base, sourced_from_who: { name: "Tim" } }],
      }),
    ).toThrow();
  });
});
