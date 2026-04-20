/**
 * Unit tests for the credentials service. Prisma and global fetch are
 * mocked so these run in the node environment with no DB and no network.
 */
import { GmailCredentialError } from "@denim/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptTokens } from "@/lib/gmail/tokens";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
    },
    $executeRaw: mocks.executeRaw,
  },
}));

// Use a stable dev-only encryption key so encrypt/decrypt round-trip works.
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64); // 32 bytes of zero in hex
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  delete process.env.BYPASS_AUTH;
  delete process.env.DEV_GMAIL_TOKEN;
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

const VALID_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function storedBlob(overrides: Partial<Record<string, unknown>> = {}) {
  return encryptTokens({
    access_token: "ya29.fresh",
    refresh_token: "1//rt",
    expiry_date: Date.now() + 60 * 60 * 1000,
    scope: VALID_SCOPE,
    ...overrides,
  });
}

describe("getCredentialRecord", () => {
  it("returns { type: 'absent' } when no row exists", async () => {
    const { getCredentialRecord } = await import("../service");
    mocks.findUnique.mockResolvedValueOnce(null);
    const r = await getCredentialRecord("u1");
    expect(r).toEqual({ type: "absent" });
  });

  it("returns { type: 'absent' } when googleTokens is null", async () => {
    const { getCredentialRecord } = await import("../service");
    mocks.findUnique.mockResolvedValueOnce({ googleTokens: null });
    const r = await getCredentialRecord("u1");
    expect(r).toEqual({ type: "absent" });
  });

  it("returns { type: 'present' } with derived fields when blob is valid", async () => {
    const { getCredentialRecord } = await import("../service");
    mocks.findUnique.mockResolvedValueOnce({ googleTokens: storedBlob() });
    const r = await getCredentialRecord("u1");
    expect(r.type).toBe("present");
    if (r.type === "present") {
      expect(r.hasRefreshToken).toBe(true);
      expect(r.grantedScopes).toContain(VALID_SCOPE);
      expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("returns { type: 'absent' } for a malformed blob (pre-flight must not throw)", async () => {
    const { getCredentialRecord } = await import("../service");
    mocks.findUnique.mockResolvedValueOnce({ googleTokens: "not-valid-encrypted" });
    const r = await getCredentialRecord("u1");
    expect(r).toEqual({ type: "absent" });
  });
});

describe("getAccessToken", () => {
  it("returns the stored access_token when fresh", async () => {
    const { getAccessToken } = await import("../service");
    mocks.findUnique.mockResolvedValueOnce({ googleTokens: storedBlob() });
    const t = await getAccessToken("u1");
    expect(t).toBe("ya29.fresh");
  });

  it("throws GmailCredentialError { absent } when no row", async () => {
    const { getAccessToken } = await import("../service");
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(getAccessToken("u1")).rejects.toMatchObject({
      name: "GmailCredentialError",
      credentialFailure: { reason: "absent", remedy: "reconnect" },
    });
  });

  it("throws GmailCredentialError { decrypt_failed } when blob is malformed", async () => {
    const { getAccessToken } = await import("../service");
    mocks.findUnique.mockResolvedValueOnce({ googleTokens: "garbage-blob-data" });
    await expect(getAccessToken("u1")).rejects.toMatchObject({
      name: "GmailCredentialError",
      credentialFailure: { reason: "decrypt_failed", remedy: "reconnect" },
    });
  });

  it("throws GmailCredentialError { revoked } when refresh returns invalid_grant", async () => {
    const expiredBlob = encryptTokens({
      access_token: "ya29.stale",
      refresh_token: "1//dead",
      expiry_date: Date.now() - 60_000, // already expired
      scope: VALID_SCOPE,
    });
    mocks.findUnique.mockResolvedValueOnce({ googleTokens: expiredBlob });
    mocks.executeRaw.mockResolvedValueOnce(0);
    mocks.update.mockResolvedValueOnce({});

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );

    const { getAccessToken } = await import("../service");
    await expect(getAccessToken("u1")).rejects.toMatchObject({
      name: "GmailCredentialError",
      credentialFailure: { reason: "revoked", remedy: "reconnect" },
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { googleTokens: null } }),
    );
  });

  it("returns the DEV_GMAIL_TOKEN when BYPASS_AUTH is true", async () => {
    process.env.BYPASS_AUTH = "true";
    process.env.DEV_GMAIL_TOKEN = "dev-token-value";
    const { getAccessToken } = await import("../service");
    const t = await getAccessToken("u1");
    expect(t).toBe("dev-token-value");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});

describe("storeCredentials", () => {
  it("persists a well-formed input (happy path)", async () => {
    mocks.upsert.mockResolvedValueOnce({});
    const { storeCredentials } = await import("../service");
    await storeCredentials({
      userId: "u1",
      email: "a@b.com",
      accessToken: "ya29.new",
      refreshToken: "1//rt",
      expiresInSeconds: 3600,
      grantedScopes: VALID_SCOPE,
      verificationSource: "supabase_exchange",
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("accepts grantedScopes as an array and joins it with spaces", async () => {
    mocks.upsert.mockResolvedValueOnce({});
    const { storeCredentials } = await import("../service");
    await storeCredentials({
      userId: "u1",
      email: "a@b.com",
      accessToken: "ya29.new",
      refreshToken: "",
      expiresInSeconds: 3600,
      grantedScopes: [VALID_SCOPE, "https://www.googleapis.com/auth/userinfo.email"],
      verificationSource: "supabase_exchange",
    });
    expect(mocks.upsert).toHaveBeenCalled();
  });

  it("throws ZodError (pre-persist) when the input shape is wrong — catches tonight's TypeError class", async () => {
    const { storeCredentials } = await import("../service");
    // Simulating what a Client Reference wrapped value looks like: an object, not a string.
    await expect(
      storeCredentials({
        userId: "u1",
        email: "a@b.com",
        accessToken: "ya29.new",
        refreshToken: "",
        expiresInSeconds: 3600,
        // @ts-expect-error — deliberately wrong shape to simulate the Client Reference bug
        grantedScopes: { $$typeof: Symbol.for("react.client.reference") },
        verificationSource: "supabase_exchange",
      }),
    ).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("throws GmailCredentialError { scope_insufficient } when gmail.readonly is missing", async () => {
    const { storeCredentials } = await import("../service");
    await expect(
      storeCredentials({
        userId: "u1",
        email: "a@b.com",
        accessToken: "ya29.new",
        refreshToken: "",
        expiresInSeconds: 3600,
        grantedScopes: "https://www.googleapis.com/auth/userinfo.email",
        verificationSource: "supabase_exchange",
      }),
    ).rejects.toMatchObject({
      name: "GmailCredentialError",
      credentialFailure: { reason: "scope_insufficient", remedy: "reconnect" },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  // #124: auth.users id rotated while a stale public.users row survived.
  // upsert.where:{id} misses → create path → P2002 on email unique
  // constraint. Must surface as typed account_conflict, NOT fall through to
  // the callback's generic "unexpected" branch (which Nick hit 2026-04-20).
  it("wraps Prisma P2002 as GmailCredentialError { account_conflict / contact_support }", async () => {
    mocks.upsert.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
        code: "P2002",
        meta: { target: ["email"] },
      }),
    );
    const { storeCredentials } = await import("../service");
    await expect(
      storeCredentials({
        userId: "u-new",
        email: "collides@example.com",
        accessToken: "ya29.new",
        refreshToken: "1//rt",
        expiresInSeconds: 3600,
        grantedScopes: VALID_SCOPE,
        verificationSource: "supabase_exchange",
      }),
    ).rejects.toMatchObject({
      name: "GmailCredentialError",
      credentialFailure: { reason: "account_conflict", remedy: "contact_support" },
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-P2002 Prisma errors unchanged (not wrapped as credential error)", async () => {
    mocks.upsert.mockRejectedValueOnce(
      Object.assign(new Error("Connection lost"), { code: "P1001" }),
    );
    const { storeCredentials } = await import("../service");
    await expect(
      storeCredentials({
        userId: "u1",
        email: "a@b.com",
        accessToken: "ya29.new",
        refreshToken: "1//rt",
        expiresInSeconds: 3600,
        grantedScopes: VALID_SCOPE,
        verificationSource: "supabase_exchange",
      }),
    ).rejects.toThrow("Connection lost");
  });
});

describe("invalidateCredentials", () => {
  it("nulls the googleTokens column", async () => {
    mocks.update.mockResolvedValueOnce({});
    const { invalidateCredentials } = await import("../service");
    await invalidateCredentials("u1", "cleared");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { googleTokens: null },
    });
  });
});

describe("GmailCredentialError wire shape", () => {
  it("carries a CredentialFailure with reason + remedy", () => {
    const err = new GmailCredentialError("x", { reason: "absent", remedy: "reconnect" });
    expect(err.code).toBe(401);
    expect(err.type).toBe("GMAIL_CREDENTIAL_ERROR");
    expect(err.credentialFailure).toEqual({ reason: "absent", remedy: "reconnect" });
  });
});
