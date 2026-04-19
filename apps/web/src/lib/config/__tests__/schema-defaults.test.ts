import { describe, expect, it } from "vitest";
import { CLUSTERING_TUNABLES } from "../clustering-tunables";
import { buildDefaultClusteringConfig, defaultSummaryLabels } from "../schema-defaults";

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
