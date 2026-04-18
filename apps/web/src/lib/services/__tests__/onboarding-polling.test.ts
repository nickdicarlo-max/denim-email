/**
 * Unit tests for derivePollingResponse — covers the Issue #95 fast-discovery
 * branches (Stage 1 + Stage 2) and the legacy mapping for
 * FINALIZING_SCHEMA / unknown-phase fallthrough.
 *
 * PROCESSING_SCAN branch is deliberately excluded — it hits computeScanMetrics
 * and is already exercised by integration tests. Here we only cover the
 * schema-phase-driven early-return branches.
 */
import type { CaseSchema } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { derivePollingResponse } from "../onboarding-polling";

function baseSchema(overrides: Partial<CaseSchema>): CaseSchema {
  return {
    id: "s1",
    userId: "u1",
    name: "Test",
    status: "DRAFT",
    phase: null,
    phaseUpdatedAt: new Date("2026-04-17T10:00:00Z"),
    phaseError: null,
    updatedAt: new Date("2026-04-17T10:00:00Z"),
    createdAt: new Date("2026-04-17T10:00:00Z"),
    // Unused fields — cast satisfies the CaseSchema shape in tests.
    ...overrides,
  } as unknown as CaseSchema;
}

describe("derivePollingResponse — Stage 1 (issue #95)", () => {
  const stage1 = [
    { domain: "judgefite.com", count: 42 },
    { domain: "portfolioproadvisors.com", count: 12 },
  ];

  it("surfaces stage1Candidates + query during DISCOVERING_DOMAINS", async () => {
    const schema = baseSchema({
      phase: "DISCOVERING_DOMAINS",
      stage1Candidates: stage1 as unknown as CaseSchema["stage1Candidates"],
      stage1QueryUsed: "subject:(invoice OR repair)",
    });

    const res = await derivePollingResponse(schema, null);

    expect(res.phase).toBe("DISCOVERING_DOMAINS");
    expect(res.stage1Candidates).toEqual(stage1);
    expect(res.stage1QueryUsed).toBe("subject:(invoice OR repair)");
    expect(res.stage2Candidates).toBeUndefined();
  });

  it("surfaces stage1Candidates during AWAITING_DOMAIN_CONFIRMATION", async () => {
    const schema = baseSchema({
      phase: "AWAITING_DOMAIN_CONFIRMATION",
      stage1Candidates: stage1 as unknown as CaseSchema["stage1Candidates"],
      stage1QueryUsed: "subject:(invoice)",
    });

    const res = await derivePollingResponse(schema, null);

    expect(res.phase).toBe("AWAITING_DOMAIN_CONFIRMATION");
    expect(res.stage1Candidates).toHaveLength(2);
  });

  it("returns empty stage1Candidates when the column is null", async () => {
    const schema = baseSchema({
      phase: "DISCOVERING_DOMAINS",
      stage1Candidates: null,
      stage1QueryUsed: null,
    });

    const res = await derivePollingResponse(schema, null);

    expect(res.stage1Candidates).toEqual([]);
    expect(res.stage1QueryUsed).toBeUndefined();
  });
});

describe("derivePollingResponse — Stage 2 (issue #95)", () => {
  const stage2 = [
    {
      confirmedDomain: "judgefite.com",
      algorithm: "subject-regex:address",
      candidates: [
        {
          key: "3910 bucknell dr",
          displayString: "3910 Bucknell Drive",
          frequency: 5,
          autoFixed: true,
        },
      ],
    },
  ];

  it("surfaces stage2Candidates during DISCOVERING_ENTITIES", async () => {
    const schema = baseSchema({
      phase: "DISCOVERING_ENTITIES",
      stage2Candidates: stage2 as unknown as CaseSchema["stage2Candidates"],
    });

    const res = await derivePollingResponse(schema, null);

    expect(res.phase).toBe("DISCOVERING_ENTITIES");
    expect(res.stage2Candidates).toEqual(stage2);
    expect(res.stage1Candidates).toBeUndefined();
  });

  it("surfaces stage2Candidates during AWAITING_ENTITY_CONFIRMATION", async () => {
    const schema = baseSchema({
      phase: "AWAITING_ENTITY_CONFIRMATION",
      stage2Candidates: stage2 as unknown as CaseSchema["stage2Candidates"],
    });

    const res = await derivePollingResponse(schema, null);

    expect(res.phase).toBe("AWAITING_ENTITY_CONFIRMATION");
    expect(res.stage2Candidates?.[0]?.candidates?.[0]?.autoFixed).toBe(true);
  });

  it("returns empty stage2Candidates when the column is null", async () => {
    const schema = baseSchema({
      phase: "AWAITING_ENTITY_CONFIRMATION",
      stage2Candidates: null,
    });

    const res = await derivePollingResponse(schema, null);

    expect(res.stage2Candidates).toEqual([]);
  });
});

describe("derivePollingResponse — regression guards", () => {
  it("does NOT leak stage fields onto PENDING", async () => {
    const schema = baseSchema({
      phase: "PENDING",
      stage1Candidates: [
        { domain: "example.com", count: 1 },
      ] as unknown as CaseSchema["stage1Candidates"],
    });

    const res = await derivePollingResponse(schema, null);

    expect(res.phase).toBe("PENDING");
    expect(res.stage1Candidates).toBeUndefined();
    expect(res.stage2Candidates).toBeUndefined();
  });
});
