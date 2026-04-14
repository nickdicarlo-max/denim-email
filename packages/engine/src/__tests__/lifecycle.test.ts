import { describe, it, expect } from "vitest";
import { computeNextActionDate, computeCaseDecay } from "../actions/lifecycle";

describe("computeNextActionDate", () => {
  it("returns null when no actions", () => {
    expect(computeNextActionDate([])).toBeNull();
  });

  it("returns null when no PENDING actions", () => {
    const actions = [
      { status: "DONE" as const, dueDate: new Date("2026-04-01"), eventStartTime: null },
      { status: "EXPIRED" as const, dueDate: new Date("2026-03-01"), eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toBeNull();
  });

  it("returns dueDate when no eventStartTime", () => {
    const actions = [
      { status: "PENDING" as const, dueDate: new Date("2026-04-10"), eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-10"));
  });

  it("returns eventStartTime when no dueDate", () => {
    const actions = [
      { status: "PENDING" as const, dueDate: null, eventStartTime: new Date("2026-04-02T17:30:00Z") },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-02T17:30:00Z"));
  });

  it("returns earlier of dueDate and eventStartTime on same action", () => {
    const actions = [
      {
        status: "PENDING" as const,
        dueDate: new Date("2026-04-01"),
        eventStartTime: new Date("2026-06-15"),
      },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-01"));
  });

  it("returns earliest across multiple PENDING actions", () => {
    const actions = [
      { status: "PENDING" as const, dueDate: null, eventStartTime: new Date("2026-04-04") },
      { status: "PENDING" as const, dueDate: null, eventStartTime: new Date("2026-04-02") },
      { status: "PENDING" as const, dueDate: null, eventStartTime: new Date("2026-04-18") },
      { status: "DONE" as const, dueDate: new Date("2026-03-28"), eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-02"));
  });

  it("ignores DISMISSED and SUPERSEDED actions", () => {
    const actions = [
      { status: "DISMISSED" as const, dueDate: new Date("2026-04-01"), eventStartTime: null },
      { status: "SUPERSEDED" as const, dueDate: new Date("2026-04-02"), eventStartTime: null },
      { status: "PENDING" as const, dueDate: new Date("2026-04-10"), eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toEqual(new Date("2026-04-10"));
  });

  it("returns null when PENDING actions have no dates", () => {
    const actions = [
      { status: "PENDING" as const, dueDate: null, eventStartTime: null },
    ];
    expect(computeNextActionDate(actions)).toBeNull();
  });
});

describe("computeCaseDecay", () => {
  const now = new Date("2026-04-01T12:00:00Z");

  it("does nothing for RESOLVED cases", () => {
    const result = computeCaseDecay({
      caseStatus: "RESOLVED",
      caseUrgency: "NO_ACTION",
      actions: [
        { id: "a1", status: "PENDING", dueDate: new Date("2026-03-20"), eventStartTime: null, eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-15"),
    }, now);
    expect(result.changed).toBe(false);
    expect(result.updatedStatus).toBe("RESOLVED");
    expect(result.expiredActionIds).toEqual([]);
  });

  it("expires PENDING actions whose dates have passed", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "IMMINENT",
      actions: [
        { id: "a1", status: "PENDING", dueDate: new Date("2026-03-28"), eventStartTime: null, eventEndTime: null },
        { id: "a2", status: "PENDING", dueDate: null, eventStartTime: new Date("2026-04-05"), eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-25"),
    }, now);
    expect(result.expiredActionIds).toEqual(["a1"]);
    expect(result.updatedUrgency).toBe("THIS_WEEK");
    expect(result.updatedStatus).toBe("OPEN");
    expect(result.changed).toBe(true);
  });

  it("uses eventEndTime to determine if event is past (not eventStartTime)", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "IMMINENT",
      actions: [
        {
          id: "a1", status: "PENDING",
          dueDate: null,
          eventStartTime: new Date("2026-04-01T10:00:00Z"),
          eventEndTime: new Date("2026-04-01T14:00:00Z"),
        },
      ],
      lastEmailDate: new Date("2026-03-30"),
    }, now);
    expect(result.expiredActionIds).toEqual([]);
    expect(result.updatedUrgency).toBe("IMMINENT");
  });

  it("resolves case when all actions are expired or done", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "THIS_WEEK",
      actions: [
        { id: "a1", status: "DONE", dueDate: new Date("2026-03-25"), eventStartTime: null, eventEndTime: null },
        { id: "a2", status: "PENDING", dueDate: new Date("2026-03-20"), eventStartTime: null, eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-18"),
    }, now);
    expect(result.expiredActionIds).toEqual(["a2"]);
    expect(result.updatedStatus).toBe("RESOLVED");
    expect(result.updatedUrgency).toBe("NO_ACTION");
  });

  it("sets IMMINENT for action within 48 hours", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "UPCOMING",
      actions: [
        { id: "a1", status: "PENDING", dueDate: new Date("2026-04-02T10:00:00Z"), eventStartTime: null, eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.updatedUrgency).toBe("IMMINENT");
    expect(result.changed).toBe(true);
  });

  it("sets THIS_WEEK for action within 168 hours", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "UPCOMING",
      actions: [
        { id: "a1", status: "PENDING", dueDate: null, eventStartTime: new Date("2026-04-05T10:00:00Z"), eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.updatedUrgency).toBe("THIS_WEEK");
  });

  it("sets UPCOMING for action beyond 168 hours", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "IMMINENT",
      actions: [
        { id: "a1", status: "PENDING", dueDate: null, eventStartTime: new Date("2026-04-20"), eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.updatedUrgency).toBe("UPCOMING");
    expect(result.changed).toBe(true);
  });

  it("returns changed=false when nothing changes", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "THIS_WEEK",
      actions: [
        { id: "a1", status: "PENDING", dueDate: null, eventStartTime: new Date("2026-04-05T10:00:00Z"), eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.changed).toBe(false);
  });

  it("handles case with no actions -- preserves existing urgency", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "UPCOMING",
      actions: [],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.changed).toBe(false);
    expect(result.updatedUrgency).toBe("UPCOMING");
  });

  it("handles PENDING actions with no dates -- preserves existing urgency", () => {
    const result = computeCaseDecay({
      caseStatus: "OPEN",
      caseUrgency: "UPCOMING",
      actions: [
        { id: "a1", status: "PENDING", dueDate: null, eventStartTime: null, eventEndTime: null },
      ],
      lastEmailDate: new Date("2026-03-28"),
    }, now);
    expect(result.expiredActionIds).toEqual([]);
    expect(result.updatedUrgency).toBe("UPCOMING");
    expect(result.changed).toBe(false);
  });
});
