/**
 * PATCH /inputs — unit tests (issue #127).
 *
 * Mirrors the shape of /domain-confirm's route tests. Exercises the three
 * route-level branches: Zod reject on invalid body, 409 on phase-gate miss,
 * 200 on successful rewind + outbox upsert + optimistic emit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  outboxUpsert: vi.fn(),
  outboxUpdate: vi.fn(),
  rewindSchemaInputs: vi.fn(),
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
        onboardingOutbox: { upsert: mocks.outboxUpsert },
      }),
    onboardingOutbox: { update: mocks.outboxUpdate },
  },
}));

vi.mock("@/lib/services/interview", () => ({
  rewindSchemaInputs: mocks.rewindSchemaInputs,
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: mocks.inngestSend },
}));

import { PATCH } from "../route";

function makeRequest(schemaId: string, body: unknown) {
  return new Request(`http://localhost/api/onboarding/${schemaId}/inputs`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as any;
}

const VALID_INPUTS = {
  role: "parent",
  domain: "school_parent",
  whats: ["soccer", "dance"],
  whos: ["ziad allan"],
  goals: [],
  groups: [{ whats: ["soccer"], whos: ["ziad allan"] }],
  name: "Girls Activities",
};

describe("PATCH /onboarding/:schemaId/inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: "s1",
      userId: "user-1",
      phase: "AWAITING_DOMAIN_CONFIRMATION",
    });
    mocks.outboxUpsert.mockResolvedValue({});
    mocks.outboxUpdate.mockResolvedValue({});
    mocks.inngestSend.mockResolvedValue(undefined);
  });

  it("returns 400 on invalid body (missing required fields)", async () => {
    const res = await PATCH(makeRequest("s1", { whats: ["soccer"] })); // missing role + domain + whos
    expect(res.status).toBe(400);
    expect(mocks.rewindSchemaInputs).not.toHaveBeenCalled();
    expect(mocks.outboxUpsert).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("returns 409 when rewindSchemaInputs count=0 (phase past AWAITING_DOMAIN_CONFIRMATION)", async () => {
    mocks.rewindSchemaInputs.mockResolvedValueOnce(0);
    const res = await PATCH(makeRequest("s1", VALID_INPUTS));
    expect(res.status).toBe(409);
    expect(mocks.outboxUpsert).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("returns 200, upserts outbox, and emits on CAS success", async () => {
    mocks.rewindSchemaInputs.mockResolvedValueOnce(1);
    const res = await PATCH(makeRequest("s1", VALID_INPUTS));
    expect(res.status).toBe(200);

    expect(mocks.rewindSchemaInputs).toHaveBeenCalledWith(
      expect.anything(),
      "s1",
      expect.objectContaining({
        role: "parent",
        domain: "school_parent",
        whats: ["soccer", "dance"],
        whos: ["ziad allan"],
        groups: [{ whats: ["soccer"], whos: ["ziad allan"] }],
        name: "Girls Activities",
      }),
    );

    // Upsert is the #127-specific contract — same composite PK may already
    // carry a row from a previous rewind or Stage 1 run.
    expect(mocks.outboxUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          schemaId_eventName: {
            schemaId: "s1",
            eventName: "onboarding.domain-discovery.requested",
          },
        },
        create: expect.objectContaining({
          schemaId: "s1",
          userId: "user-1",
          eventName: "onboarding.domain-discovery.requested",
        }),
        update: expect.objectContaining({
          status: "PENDING_EMIT",
        }),
      }),
    );

    expect(mocks.inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onboarding.domain-discovery.requested",
        data: { schemaId: "s1", userId: "user-1" },
      }),
    );
  });

  it("still invokes the CAS guard when groups is omitted (older clients)", async () => {
    mocks.rewindSchemaInputs.mockResolvedValueOnce(1);
    const { groups: _g, ...rest } = VALID_INPUTS;
    void _g;
    const res = await PATCH(makeRequest("s1", rest));
    expect(res.status).toBe(200);
    // Zod's default-[] fires on missing `groups` — rewind sees an empty array.
    expect(mocks.rewindSchemaInputs).toHaveBeenCalledWith(
      expect.anything(),
      "s1",
      expect.objectContaining({ groups: [] }),
    );
  });
});
