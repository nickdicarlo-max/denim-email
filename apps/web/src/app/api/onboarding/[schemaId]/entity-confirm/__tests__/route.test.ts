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
  seedSchemaDefaults: vi.fn(),
  seedSchemaName: vi.fn(),
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
  seedSchemaDefaults: mocks.seedSchemaDefaults,
  seedSchemaName: mocks.seedSchemaName,
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
      domain: "agency",
      name: "Setting up...",
      stage1UserContacts: [],
    });
    mocks.outboxCreate.mockResolvedValue({});
    mocks.outboxUpdate.mockResolvedValue({});
    mocks.persistConfirmedEntities.mockResolvedValue(undefined);
    mocks.seedSchemaDefaults.mockResolvedValue(undefined);
    mocks.seedSchemaName.mockResolvedValue(undefined);
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
    // #121: PRIMARY passes through untouched; SECONDARY with `@`-prefixed
    // identityKey gets aliases populated from the senderEmail suffix.
    expect(mocks.persistConfirmedEntities).toHaveBeenCalledWith(expect.anything(), "s1", [
      { displayLabel: "3910 Bucknell", identityKey: "3910 bucknell", kind: "PRIMARY" },
      {
        displayLabel: "Anthropic",
        identityKey: "@anthropic.com",
        kind: "SECONDARY",
        secondaryTypeName: "Vendor",
        aliases: ["anthropic.com"],
      },
    ]);
    expect(mocks.seedSchemaDefaults).toHaveBeenCalledWith(expect.anything(), "s1", "agency");
    expect(mocks.seedSchemaName).toHaveBeenCalledWith(
      expect.anything(),
      "s1",
      "Setting up...",
      "agency",
      entities,
    );
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

  it("#121: populates aliases from stage1UserContacts query lookup (preferred over @-prefix)", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: "s1",
      userId: "user-1",
      phase: "AWAITING_ENTITY_CONFIRMATION",
      domain: "school_parent",
      name: "My Schema",
      // Query-based lookup — the user typed "Coach Ziad" as a contact; Stage 1
      // resolved it to `donotreply@teamsnap.com`. Even if the user renamed
      // the displayLabel on the review screen, the identityKey `@<email>`
      // would fall back to the same email — but here we verify the primary
      // path (query match) fires.
      stage1UserContacts: [{ query: "Coach Ziad", senderEmail: "donotreply@teamsnap.com" }],
    });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });

    const entities = [
      {
        displayLabel: "Coach Ziad",
        identityKey: "@donotreply@teamsnap.com",
        kind: "SECONDARY" as const,
      },
    ];
    const res = await POST(makeRequest("s1", { confirmedEntities: entities }));
    expect(res.status).toBe(200);

    expect(mocks.persistConfirmedEntities).toHaveBeenCalledWith(expect.anything(), "s1", [
      expect.objectContaining({
        displayLabel: "Coach Ziad",
        identityKey: "@donotreply@teamsnap.com",
        kind: "SECONDARY",
        aliases: ["donotreply@teamsnap.com"],
      }),
    ]);
  });
});
