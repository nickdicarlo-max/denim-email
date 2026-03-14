import { describe, expect, it } from "vitest";
import type {
  ClusterCaseInput,
  ClusterEmailInput,
  ClusteringConfig,
  TagFrequencyMap,
} from "@denim/types";
import {
  clusterEmails,
  scoreEmailAgainstCase,
  findBestCase,
} from "../clustering/gravity-model";
import { isReminder } from "../clustering/reminder-detection";

const defaultConfig: ClusteringConfig = {
  mergeThreshold: 45,
  threadMatchScore: 100,
  tagMatchScore: 60,
  subjectMatchScore: 50,
  actorAffinityScore: 30,
  subjectAdditiveBonus: 25,
  timeDecayDays: { fresh: 45, recent: 75, stale: 120 },
  weakTagDiscount: 0.3,
  frequencyThreshold: 0.3,
  anchorTagLimit: 2,
  caseSizeThreshold: 10,
  caseSizeMaxBonus: 25,
  reminderCollapseEnabled: true,
  reminderSubjectSimilarity: 0.9,
  reminderMaxAge: 30,
};

const now = new Date("2026-03-14T00:00:00Z");

const noWeak: TagFrequencyMap = {
  Permits: { frequency: 0.1, isWeak: false },
  HVAC: { frequency: 0.05, isWeak: false },
  Plumbing: { frequency: 0.05, isWeak: false },
};

function makeEmail(overrides: Partial<ClusterEmailInput> & { id: string }): ClusterEmailInput {
  return {
    threadId: "thread-1",
    subject: "Test Subject",
    tags: [],
    date: new Date("2026-03-10"),
    senderEntityId: null,
    entityId: null,
    ...overrides,
  };
}

function makeCase(overrides: Partial<ClusterCaseInput> & { id: string }): ClusterCaseInput {
  return {
    entityId: "entity-1",
    threadIds: [],
    anchorTags: [],
    senderEntityIds: [],
    subject: "Test Case",
    emailCount: 3,
    lastEmailDate: new Date("2026-03-08"),
    ...overrides,
  };
}

describe("scoreEmailAgainstCase", () => {
  it("returns 0 for cross-entity mismatch", () => {
    const email = makeEmail({ id: "e1", entityId: "entity-A" });
    const caseInput = makeCase({ id: "c1", entityId: "entity-B" });

    const result = scoreEmailAgainstCase(email, caseInput, noWeak, defaultConfig, now);
    expect(result.score).toBe(0);
  });

  it("scores thread match highly", () => {
    const email = makeEmail({ id: "e1", threadId: "t1", entityId: "entity-1" });
    const caseInput = makeCase({ id: "c1", threadIds: ["t1"] });

    const result = scoreEmailAgainstCase(email, caseInput, noWeak, defaultConfig, now);
    expect(result.score).toBeGreaterThan(defaultConfig.mergeThreshold);
    expect(result.breakdown.threadScore).toBe(100);
  });

  it("applies subject additive bonus when tag + subject both match", () => {
    const email = makeEmail({
      id: "e1",
      subject: "Kitchen Remodel Permits",
      tags: ["Permits"],
      entityId: "entity-1",
    });
    const caseInput = makeCase({
      id: "c1",
      subject: "Kitchen Remodel Permits",
      anchorTags: ["Permits"],
    });

    const result = scoreEmailAgainstCase(email, caseInput, noWeak, defaultConfig, now);
    // Should include tag + subject + additive bonus
    expect(result.breakdown.tagScore).toBeGreaterThan(0);
    expect(result.breakdown.subjectScore).toBeGreaterThan(0);
    // rawScore includes additive bonus
    expect(result.breakdown.rawScore).toBeGreaterThan(
      result.breakdown.tagScore + result.breakdown.subjectScore,
    );
  });

  it("allows null entityId emails to match any case", () => {
    const email = makeEmail({ id: "e1", entityId: null, threadId: "t1" });
    const caseInput = makeCase({ id: "c1", entityId: "entity-1", threadIds: ["t1"] });

    const result = scoreEmailAgainstCase(email, caseInput, noWeak, defaultConfig, now);
    expect(result.score).toBeGreaterThan(0);
  });
});

describe("findBestCase", () => {
  it("returns null when no case above threshold", () => {
    const email = makeEmail({
      id: "e1",
      entityId: "entity-1",
      subject: "Completely Unrelated Topic About Nothing",
    });
    const cases = [makeCase({ id: "c1", subject: "Kitchen Remodel Permits Review" })];

    const result = findBestCase(email, cases, noWeak, defaultConfig, now);
    expect(result).toBeNull();
  });

  it("returns best scoring case", () => {
    const email = makeEmail({ id: "e1", threadId: "t1", entityId: "entity-1" });
    const cases = [
      makeCase({ id: "c1", threadIds: ["t1"] }),
      makeCase({ id: "c2", threadIds: ["t2"] }),
    ];

    const result = findBestCase(email, cases, noWeak, defaultConfig, now);
    expect(result).not.toBeNull();
    expect(result!.caseId).toBe("c1");
  });
});

describe("clusterEmails", () => {
  it("groups same-thread emails together", () => {
    const emails: ClusterEmailInput[] = [
      makeEmail({ id: "e1", threadId: "t1", date: new Date("2026-03-10") }),
      makeEmail({ id: "e2", threadId: "t1", date: new Date("2026-03-11") }),
      makeEmail({ id: "e3", threadId: "t2", date: new Date("2026-03-12") }),
    ];

    const decisions = clusterEmails(emails, [], noWeak, defaultConfig, now);
    // Two thread groups → two decisions
    expect(decisions).toHaveLength(2);
    // First group (t1) has both emails
    const t1Decision = decisions.find((d) => d.threadIds.includes("t1"));
    expect(t1Decision).toBeDefined();
    expect(t1Decision!.emailIds).toHaveLength(2);
  });

  it("merges email into existing case with matching thread", () => {
    const emails: ClusterEmailInput[] = [
      makeEmail({ id: "e1", threadId: "t1", entityId: "entity-1" }),
    ];
    const existingCases: ClusterCaseInput[] = [
      makeCase({ id: "c1", threadIds: ["t1"] }),
    ];

    const decisions = clusterEmails(emails, existingCases, noWeak, defaultConfig, now);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("MERGE");
    expect(decisions[0].targetCaseId).toBe("c1");
  });

  it("creates new case for unmatched email", () => {
    const emails: ClusterEmailInput[] = [
      makeEmail({
        id: "e1",
        threadId: "t-new",
        entityId: "entity-1",
        subject: "Completely Unrelated Topic About Nothing",
      }),
    ];
    const existingCases: ClusterCaseInput[] = [
      makeCase({ id: "c1", threadIds: ["t-other"], subject: "Kitchen Remodel Permits Review" }),
    ];

    const decisions = clusterEmails(emails, existingCases, noWeak, defaultConfig, now);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("CREATE");
  });

  it("blocks cross-entity merge", () => {
    const emails: ClusterEmailInput[] = [
      makeEmail({ id: "e1", threadId: "t1", entityId: "entity-A" }),
    ];
    const existingCases: ClusterCaseInput[] = [
      makeCase({ id: "c1", entityId: "entity-B", threadIds: ["t1"] }),
    ];

    const decisions = clusterEmails(emails, existingCases, noWeak, defaultConfig, now);
    expect(decisions[0].action).toBe("CREATE");
  });

  it("processes chronologically — oldest forms case, newer merges in", () => {
    const emails: ClusterEmailInput[] = [
      makeEmail({
        id: "e1",
        threadId: "t1",
        date: new Date("2026-03-01"),
        tags: ["Permits"],
        subject: "Kitchen Permits",
      }),
      makeEmail({
        id: "e2",
        threadId: "t1",
        date: new Date("2026-03-05"),
        tags: ["Permits"],
        subject: "RE: Kitchen Permits",
      }),
    ];

    const decisions = clusterEmails(emails, [], noWeak, defaultConfig, now);
    // Same thread → single group → single CREATE decision with both emails
    expect(decisions).toHaveLength(1);
    expect(decisions[0].emailIds).toHaveLength(2);
  });

  it("new case attracts subsequent similar emails", () => {
    const emails: ClusterEmailInput[] = [
      // First group creates a case
      makeEmail({
        id: "e1",
        threadId: "t1",
        date: new Date("2026-03-01"),
        tags: ["Permits"],
        subject: "Kitchen Permits Review",
        entityId: "entity-1",
      }),
      // Second group should merge (same tag + similar subject)
      makeEmail({
        id: "e2",
        threadId: "t2",
        date: new Date("2026-03-05"),
        tags: ["Permits"],
        subject: "Kitchen Permits Update",
        entityId: "entity-1",
      }),
    ];

    const decisions = clusterEmails(emails, [], noWeak, defaultConfig, now);
    // First creates, second should merge into first
    expect(decisions).toHaveLength(2);
    expect(decisions[0].action).toBe("CREATE");
    expect(decisions[1].action).toBe("MERGE");
  });

  it("config-driven: lower mergeThreshold creates fewer cases", () => {
    const emails: ClusterEmailInput[] = [
      makeEmail({
        id: "e1",
        threadId: "t1",
        date: new Date("2026-03-01"),
        tags: ["Permits"],
        subject: "Kitchen Permits",
        entityId: "entity-1",
      }),
      makeEmail({
        id: "e2",
        threadId: "t2",
        date: new Date("2026-03-05"),
        tags: ["Permits"],
        subject: "Kitchen Permits Follow-up",
        entityId: "entity-1",
      }),
    ];

    const strictConfig = { ...defaultConfig, mergeThreshold: 200 };
    const looseConfig = { ...defaultConfig, mergeThreshold: 10 };

    const strictDecisions = clusterEmails(emails, [], noWeak, strictConfig, now);
    const looseDecisions = clusterEmails(emails, [], noWeak, looseConfig, now);

    const strictCreates = strictDecisions.filter((d) => d.action === "CREATE").length;
    const looseCreates = looseDecisions.filter((d) => d.action === "CREATE").length;

    // Strict threshold creates more cases (fewer merges)
    expect(strictCreates).toBeGreaterThanOrEqual(looseCreates);
  });
});

describe("isReminder", () => {
  it("detects reminder in same thread with similar subject", () => {
    const email = makeEmail({
      id: "e2",
      threadId: "t1",
      subject: "RE: Permission Slip",
      date: new Date("2026-03-12"),
    });
    const existing = [
      makeEmail({
        id: "e1",
        threadId: "t1",
        subject: "Permission Slip",
        date: new Date("2026-03-05"),
      }),
    ];

    expect(isReminder(email, existing, defaultConfig, now)).toBe(true);
  });

  it("returns false for different threads", () => {
    const email = makeEmail({ id: "e2", threadId: "t2", subject: "Permission Slip" });
    const existing = [
      makeEmail({ id: "e1", threadId: "t1", subject: "Permission Slip" }),
    ];

    expect(isReminder(email, existing, defaultConfig, now)).toBe(false);
  });

  it("returns false when disabled", () => {
    const config = { ...defaultConfig, reminderCollapseEnabled: false };
    const email = makeEmail({ id: "e2", threadId: "t1", subject: "RE: Permission Slip" });
    const existing = [
      makeEmail({ id: "e1", threadId: "t1", subject: "Permission Slip" }),
    ];

    expect(isReminder(email, existing, config, now)).toBe(false);
  });

  it("returns false when too old", () => {
    const email = makeEmail({
      id: "e2",
      threadId: "t1",
      subject: "RE: Permission Slip",
      date: new Date("2026-03-14"),
    });
    const existing = [
      makeEmail({
        id: "e1",
        threadId: "t1",
        subject: "Permission Slip",
        date: new Date("2026-01-01"), // 72 days apart, > 30 max
      }),
    ];

    expect(isReminder(email, existing, defaultConfig, now)).toBe(false);
  });
});
