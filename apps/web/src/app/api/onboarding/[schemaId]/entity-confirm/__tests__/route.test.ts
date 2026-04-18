/**
 * POST /entity-confirm — unit tests (issue #95 Task 3.2).
 *
 * Mirrors the /domain-confirm test pattern (D3.1-2): vi.hoisted mocks for
 * prisma, ownership, interview service, and inngest.
 *
 * Coverage:
 *   - 400 on invalid body (missing confirmedEntities).
 *   - 400 when identityKey starts with `@` but kind is PRIMARY.
 *   - 409 when CAS updateMany count=0 (wrong phase / concurrent click).
 *   - 200 + persistConfirmedEntities + outbox + emit on success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  outboxCreate: vi.fn(),
  outboxUpdate: vi.fn(),
  persistConfirmedEntities: vi.fn(),
  inngestSend: vi.fn(async () => undefined),
}));

vi.mock("@/lib/middleware/auth", () => ({
  withAuth: (handler: any) => async (request: any) => handler({ userId: "user-1", request }),
}));

vi.mock("@/lib/middleware/ownership", () => ({
  assertResourceOwnership: (resource: any) => {
    if (!resource) throw Object.assign(new Error("not found"), { code: 404 });
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caseSchema: { findUnique: mocks.findUnique },
    $transaction: async (fn: any) =>
      fn({
        caseSchema: { updateMany: mocks.updateMany },
        onboardingOutbox: { create: mocks.outboxCreate },
      }),
    onboardingOutbox: { update: mocks.outboxUpdate },
  },
}));

vi.mock("@/lib/services/interview", () => ({
  persistConfirmedEntities: mocks.persistConfirmedEntities,
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: mocks.inngestSend },
}));

import { POST } from "../route";

function makeRequest(schemaId: string, body: unknown) {
  return new Request(`http://localhost/api/onboarding/${schemaId}/entity-confirm`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /onboarding/:schemaId/entity-confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: "s1",
      userId: "user-1",
      phase: "AWAITING_ENTITY_CONFIRMATION",
    });
    mocks.outboxCreate.mockResolvedValue({});
    mocks.outboxUpdate.mockResolvedValue({});
    mocks.persistConfirmedEntities.mockResolvedValue(undefined);
    mocks.inngestSend.mockResolvedValue(undefined);
  });

  it("returns 400 on missing confirmedEntities", async () => {
    const res = await POST(makeRequest("s1", {}));
    expect(res.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.persistConfirmedEntities).not.toHaveBeenCalled();
  });

  it("returns 400 when identityKey starts with @ but kind is PRIMARY", async () => {
    const res = await POST(
      makeRequest("s1", {
        confirmedEntities: [
          {
            displayLabel: "Anthropic",
            identityKey: "@anthropic.com",
            kind: "PRIMARY",
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns 409 when CAS updateMany count=0", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await POST(
      makeRequest("s1", {
        confirmedEntities: [
          { displayLabel: "3910 Bucknell", identityKey: "3910 bucknell", kind: "PRIMARY" },
        ],
      }),
    );
    expect(res.status).toBe(409);
    expect(mocks.persistConfirmedEntities).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("returns 200, persists entities, writes outbox, and emits on success", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    const entities = [
      { displayLabel: "3910 Bucknell", identityKey: "3910 bucknell", kind: "PRIMARY" as const },
      {
        displayLabel: "Anthropic",
        identityKey: "@anthropic.com",
        kind: "SECONDARY" as const,
        secondaryTypeName: "Vendor",
      },
    ];
    const res = await POST(makeRequest("s1", { confirmedEntities: entities }));
    expect(res.status).toBe(200);

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", phase: "AWAITING_ENTITY_CONFIRMATION" },
      data: expect.objectContaining({ phase: "PROCESSING_SCAN" }),
    });
    expect(mocks.persistConfirmedEntities).toHaveBeenCalledWith(expect.anything(), "s1", entities);
    expect(mocks.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schemaId: "s1",
        userId: "user-1",
        eventName: "onboarding.review.confirmed",
      }),
    });
    expect(mocks.inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onboarding.review.confirmed",
        data: { schemaId: "s1", userId: "user-1" },
      }),
    );
  });
});
