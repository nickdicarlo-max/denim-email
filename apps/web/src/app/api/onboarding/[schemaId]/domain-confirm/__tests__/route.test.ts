/**
 * POST /domain-confirm — unit tests (issue #95 Task 3.1).
 *
 * withAuth is mocked to pass userId straight through.
 * writeStage2ConfirmedDomains is mocked so we can drive the CAS count
 * outcome (0 = wrong phase / race lost, 1 = success) without touching
 * a real DB.
 *
 * Coverage: 400 on invalid body, 409 on CAS count=0, 200 + outbox + emit
 * on success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock state — vi.mock factories run before top-level `let`s are
// initialized, so shared handles live in globals keyed to `vi.hoisted`.
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  outboxCreate: vi.fn(),
  outboxUpdate: vi.fn(),
  writeStage2ConfirmedDomains: vi.fn(),
  inngestSend: vi.fn(async () => undefined),
}));

vi.mock("@/lib/middleware/auth", () => ({
  withAuth: (handler: any) => async (request: any) =>
    handler({ userId: "user-1", request }),
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
  writeStage2ConfirmedDomains: mocks.writeStage2ConfirmedDomains,
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: mocks.inngestSend },
}));

import { POST } from "../route";

function makeRequest(schemaId: string, body: unknown) {
  return new Request(
    `http://localhost/api/onboarding/${schemaId}/domain-confirm`,
    { method: "POST", body: JSON.stringify(body) },
  ) as any;
}

describe("POST /onboarding/:schemaId/domain-confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: "s1",
      userId: "user-1",
      phase: "AWAITING_DOMAIN_CONFIRMATION",
    });
    mocks.outboxCreate.mockResolvedValue({});
    mocks.outboxUpdate.mockResolvedValue({});
    mocks.inngestSend.mockResolvedValue(undefined);
  });

  it("returns 400 on invalid body", async () => {
    const res = await POST(makeRequest("s1", {}));
    expect(res.status).toBe(400);
    expect(mocks.writeStage2ConfirmedDomains).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("returns 409 when CAS count=0 (wrong phase or concurrent click)", async () => {
    mocks.writeStage2ConfirmedDomains.mockResolvedValueOnce(0);
    const res = await POST(
      makeRequest("s1", { confirmedDomains: ["portfolioproadvisors.com"] }),
    );
    expect(res.status).toBe(409);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("returns 200, writes outbox, and emits on CAS success", async () => {
    mocks.writeStage2ConfirmedDomains.mockResolvedValueOnce(1);
    const res = await POST(
      makeRequest("s1", {
        confirmedDomains: ["portfolioproadvisors.com", "stallionis.com"],
      }),
    );
    expect(res.status).toBe(200);

    expect(mocks.writeStage2ConfirmedDomains).toHaveBeenCalledWith(
      expect.anything(),
      "s1",
      ["portfolioproadvisors.com", "stallionis.com"],
    );
    expect(mocks.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schemaId: "s1",
        userId: "user-1",
        eventName: "onboarding.entity-discovery.requested",
      }),
    });
    expect(mocks.inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onboarding.entity-discovery.requested",
        data: { schemaId: "s1", userId: "user-1" },
      }),
    );
  });
});
