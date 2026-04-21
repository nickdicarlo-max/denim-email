/**
 * POST /api/onboarding/start — unit tests (issue #130 additions).
 *
 * Focus: the `abandonSchemaId` contract added by #130. The #33 outbox
 * idempotency flow was already covered by earlier integration tests —
 * these cases target the atomic "create new stub + flip old to ABANDONED"
 * property specifically.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  outboxFindUnique: vi.fn(),
  outboxUpdate: vi.fn(),
  transaction: vi.fn(),
  caseSchemaCreate: vi.fn(),
  caseSchemaUpdateMany: vi.fn(),
  txOutboxCreate: vi.fn(),
  getCredentialRecord: vi.fn(),
  inngestSend: vi.fn(async () => undefined),
}));

vi.mock("@/lib/middleware/auth", () => ({
  withAuth: (handler: any) => async (request: any) => handler({ userId: "user-1", request }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    onboardingOutbox: {
      findUnique: mocks.outboxFindUnique,
      update: mocks.outboxUpdate,
    },
    $transaction: async (fn: any) =>
      mocks.transaction(fn) ??
      fn({
        caseSchema: {
          create: mocks.caseSchemaCreate,
          updateMany: mocks.caseSchemaUpdateMany,
        },
        onboardingOutbox: { create: mocks.txOutboxCreate },
      }),
  },
}));

vi.mock("@/lib/gmail/credentials", () => ({
  getCredentialRecord: mocks.getCredentialRecord,
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: mocks.inngestSend },
}));

import { POST } from "../route";

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/onboarding/start`, {
    method: "POST",
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

const NEW_SCHEMA_ID = "01NEW0000000000000000000000";
const OLD_SCHEMA_ID = "01OLD0000000000000000000000";

describe("POST /api/onboarding/start with abandonSchemaId (#130)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentialRecord.mockResolvedValue({ type: "stored" });
    mocks.outboxFindUnique.mockResolvedValue(null); // slow path
    mocks.caseSchemaCreate.mockResolvedValue({ id: NEW_SCHEMA_ID });
    mocks.caseSchemaUpdateMany.mockResolvedValue({ count: 1 });
    mocks.txOutboxCreate.mockResolvedValue({});
    mocks.outboxUpdate.mockResolvedValue({});
    mocks.inngestSend.mockResolvedValue(undefined);
  });

  it("atomically creates new stub AND flips old schema to ABANDONED", async () => {
    const res = await POST(
      makeRequest({
        schemaId: NEW_SCHEMA_ID,
        inputs: VALID_INPUTS,
        abandonSchemaId: OLD_SCHEMA_ID,
      }),
    );

    expect(res.status).toBe(202);
    expect(mocks.caseSchemaCreate).toHaveBeenCalled();
    expect(mocks.caseSchemaUpdateMany).toHaveBeenCalledWith({
      where: { id: OLD_SCHEMA_ID, userId: "user-1", status: "DRAFT" },
      data: { status: "ABANDONED" },
    });
  });

  it("does not call updateMany when abandonSchemaId is omitted", async () => {
    const res = await POST(
      makeRequest({
        schemaId: NEW_SCHEMA_ID,
        inputs: VALID_INPUTS,
      }),
    );

    expect(res.status).toBe(202);
    expect(mocks.caseSchemaCreate).toHaveBeenCalled();
    expect(mocks.caseSchemaUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects abandonSchemaId shorter than 10 chars with 400", async () => {
    const res = await POST(
      makeRequest({
        schemaId: NEW_SCHEMA_ID,
        inputs: VALID_INPUTS,
        abandonSchemaId: "short",
      }),
    );

    expect(res.status).toBe(400);
    expect(mocks.caseSchemaCreate).not.toHaveBeenCalled();
    expect(mocks.caseSchemaUpdateMany).not.toHaveBeenCalled();
  });
});
