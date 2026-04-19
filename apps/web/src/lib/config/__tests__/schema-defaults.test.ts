import { describe, expect, it } from "vitest";
import { CLUSTERING_TUNABLES } from "../clustering-tunables";
import {
  buildDefaultClusteringConfig,
  composeFallbackSchemaName,
  defaultSummaryLabels,
} from "../schema-defaults";

const ALL_DOMAINS = [
  "school_parent",
  "property",
  "construction",
  "legal",
  "agency",
  "general",
] as const;

describe("buildDefaultClusteringConfig", () => {
  it.each(ALL_DOMAINS)("%s returns complete ClusteringConfig", (domain) => {
    const c = buildDefaultClusteringConfig(domain);
    expect(typeof c.mergeThreshold).toBe("number");
    expect(typeof c.threadMatchScore).toBe("number");
    expect(typeof c.subjectMatchScore).toBe("number");
    expect(typeof c.actorAffinityScore).toBe("number");
    expect(typeof c.tagMatchScore).toBe("number");
    expect(typeof c.timeDecayDays.fresh).toBe("number");
    expect(typeof c.reminderCollapseEnabled).toBe("boolean");
    expect(typeof c.reminderSubjectSimilarity).toBe("number");
    expect(typeof c.reminderMaxAge).toBe("number");
  });

  it("threads nested timeDecayDays.fresh from tunables", () => {
    const c = buildDefaultClusteringConfig("agency");
    expect(c.timeDecayDays.fresh).toBe(CLUSTERING_TUNABLES.domainDefaults.agency.timeDecayFresh);
  });

  it("uses global weights (not per-domain)", () => {
    const c = buildDefaultClusteringConfig("property");
    expect(c.tagMatchScore).toBe(CLUSTERING_TUNABLES.weights.tagMatchScore);
    expect(c.threadMatchScore).toBe(CLUSTERING_TUNABLES.weights.threadMatchScore);
  });

  it("uses global reminder params (not per-domain)", () => {
    const c = buildDefaultClusteringConfig("legal");
    expect(c.reminderSubjectSimilarity).toBe(CLUSTERING_TUNABLES.reminder.subjectSimilarity);
    expect(c.reminderMaxAge).toBe(CLUSTERING_TUNABLES.reminder.maxAgeDays);
  });

  it("preserves per-domain mergeThreshold (not a global)", () => {
    expect(buildDefaultClusteringConfig("legal").mergeThreshold).toBe(38);
    expect(buildDefaultClusteringConfig("property").mergeThreshold).toBe(30);
    expect(buildDefaultClusteringConfig("school_parent").mergeThreshold).toBe(35);
  });

  it("falls back to 'general' on unknown domain", () => {
    const unknown = buildDefaultClusteringConfig("not-a-real-domain");
    const general = buildDefaultClusteringConfig("general");
    expect(unknown).toEqual(general);
  });

  it("falls back to 'general' on null/undefined", () => {
    const general = buildDefaultClusteringConfig("general");
    expect(buildDefaultClusteringConfig(null)).toEqual(general);
    expect(buildDefaultClusteringConfig(undefined)).toEqual(general);
  });
});

describe("defaultSummaryLabels", () => {
  it.each(ALL_DOMAINS)("%s returns all three labels non-empty", (domain) => {
    const l = defaultSummaryLabels(domain);
    expect(l.beginning.length).toBeGreaterThan(0);
    expect(l.middle.length).toBeGreaterThan(0);
    expect(l.end.length).toBeGreaterThan(0);
  });

  it("returns distinct domain-tailored labels", () => {
    expect(defaultSummaryLabels("legal").beginning).toBe("Matter");
    expect(defaultSummaryLabels("property").beginning).toBe("Issue");
    expect(defaultSummaryLabels("agency").beginning).toBe("Brief");
    expect(defaultSummaryLabels("school_parent").beginning).toBe("What");
  });

  it("falls back to 'general' on unknown domain", () => {
    expect(defaultSummaryLabels("nonsense")).toEqual(defaultSummaryLabels("general"));
    expect(defaultSummaryLabels(null)).toEqual(defaultSummaryLabels("general"));
  });
});

describe("composeFallbackSchemaName", () => {
  it("uses the first PRIMARY entity's displayLabel", () => {
    const name = composeFallbackSchemaName("agency", [
      { displayLabel: "Portfolio Pro Advisors", kind: "PRIMARY" },
      { displayLabel: "Stallion Investments", kind: "PRIMARY" },
      { displayLabel: "Farrukh Malik", kind: "SECONDARY" },
    ]);
    expect(name).toBe("Portfolio Pro Advisors");
  });

  it("skips SECONDARY entities when picking a PRIMARY", () => {
    const name = composeFallbackSchemaName("property", [
      { displayLabel: "Timothy Bishop", kind: "SECONDARY" },
      { displayLabel: "3910 Bucknell", kind: "PRIMARY" },
    ]);
    expect(name).toBe("3910 Bucknell");
  });

  it("falls back to a domain-tailored title when no PRIMARY is confirmed", () => {
    expect(composeFallbackSchemaName("agency", [])).toBe("Client Work");
    expect(composeFallbackSchemaName("property", [])).toBe("Properties");
    expect(composeFallbackSchemaName("school_parent", [])).toBe("Kids Activities");
    expect(composeFallbackSchemaName("legal", [])).toBe("Legal Matters");
    expect(composeFallbackSchemaName("general", [])).toBe("My Topic");
    expect(composeFallbackSchemaName("construction", [])).toBe("Construction");
  });

  it("falls back to domain title when only SECONDARY entities exist", () => {
    const name = composeFallbackSchemaName("agency", [
      { displayLabel: "Farrukh Malik", kind: "SECONDARY" },
    ]);
    expect(name).toBe("Client Work");
  });

  it("trims whitespace on the PRIMARY displayLabel", () => {
    const name = composeFallbackSchemaName("agency", [
      { displayLabel: "   Anthropic   ", kind: "PRIMARY" },
    ]);
    expect(name).toBe("Anthropic");
  });

  it("falls back when the PRIMARY displayLabel is whitespace-only", () => {
    const name = composeFallbackSchemaName("general", [
      { displayLabel: "   ", kind: "PRIMARY" },
    ]);
    expect(name).toBe("My Topic");
  });

  it("truncates absurdly long PRIMARY names to 80 chars with ellipsis", () => {
    const long = "A".repeat(120);
    const name = composeFallbackSchemaName("general", [
      { displayLabel: long, kind: "PRIMARY" },
    ]);
    expect(name.length).toBe(80);
    expect(name.endsWith("...")).toBe(true);
  });

  it("unknown domain falls back to general", () => {
    expect(composeFallbackSchemaName("not-a-real-domain", [])).toBe("My Topic");
    expect(composeFallbackSchemaName(null, [])).toBe("My Topic");
    expect(composeFallbackSchemaName(undefined, [])).toBe("My Topic");
  });
});
