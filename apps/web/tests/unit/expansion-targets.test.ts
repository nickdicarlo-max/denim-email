import type { SchemaHypothesis } from "@denim/types";
import { describe, expect, it } from "vitest";
import { extractExpansionTargets } from "@/lib/services/expansion-targets";

const baseHypothesis = (entities: SchemaHypothesis["entities"]): SchemaHypothesis => ({
  domain: "school_parent",
  schemaName: "Test",
  primaryEntity: { name: "Activity", description: "" },
  secondaryEntityTypes: [],
  entities,
  tags: [],
  extractedFields: [],
  exclusionPatterns: [],
  summaryLabels: { beginning: "What", middle: "Details", end: "Action Needed" },
  discoveryQueries: [],
  clusteringConfig: {} as SchemaHypothesis["clusteringConfig"],
});

describe("extractExpansionTargets", () => {
  it("emits domain target for corporate senders", () => {
    const hypothesis = baseHypothesis([
      {
        name: "TeamSnap",
        type: "SECONDARY",
        secondaryTypeName: "Organization",
        aliases: ["donotreply@email.teamsnap.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    const targets = extractExpansionTargets(hypothesis);
    expect(targets).toEqual([{ type: "domain", value: "email.teamsnap.com" }]);
  });

  it("emits sender target for generic-provider senders", () => {
    const hypothesis = baseHypothesis([
      {
        name: "Ziad Allan",
        type: "SECONDARY",
        secondaryTypeName: "Coach",
        aliases: ["ziad.allan@gmail.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    const targets = extractExpansionTargets(hypothesis);
    expect(targets).toEqual([{ type: "sender", value: "ziad.allan@gmail.com" }]);
  });

  it("skips PRIMARY entities (only SECONDARY aliases are senders)", () => {
    const hypothesis = baseHypothesis([
      {
        name: "soccer",
        type: "PRIMARY",
        secondaryTypeName: null,
        aliases: ["soccer@example.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    expect(extractExpansionTargets(hypothesis)).toEqual([]);
  });

  it("deduplicates repeated targets", () => {
    const hypothesis = baseHypothesis([
      {
        name: "A",
        type: "SECONDARY",
        secondaryTypeName: null,
        aliases: ["a@acme.com", "b@acme.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    expect(extractExpansionTargets(hypothesis)).toEqual([{ type: "domain", value: "acme.com" }]);
  });

  it("handles mixed generic and corporate aliases on the same entity", () => {
    const hypothesis = baseHypothesis([
      {
        name: "Parent",
        type: "SECONDARY",
        secondaryTypeName: null,
        aliases: ["jane@gmail.com", "jane@acme.com"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    const targets = extractExpansionTargets(hypothesis);
    expect(targets).toHaveLength(2);
    expect(targets).toContainEqual({ type: "sender", value: "jane@gmail.com" });
    expect(targets).toContainEqual({ type: "domain", value: "acme.com" });
  });

  it("ignores aliases without an @ (display-name aliases)", () => {
    const hypothesis = baseHypothesis([
      {
        name: "ziad",
        type: "SECONDARY",
        secondaryTypeName: null,
        aliases: ["ziad", "coach ziad"],
        confidence: 1,
        source: "user_input",
      },
    ]);

    expect(extractExpansionTargets(hypothesis)).toEqual([]);
  });
});
