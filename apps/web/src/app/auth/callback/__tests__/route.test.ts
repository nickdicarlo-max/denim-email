/**
 * Unit tests for the OAuth callback route.
 *
 * The callback is the single most important fail-closed boundary in the
 * app -- tonight's bug (2026-04-18) was a silent-failure path that
 * redirected a user to the happy-path destination while leaving their
 * credentials unstored. These tests codify the fail-closed contract:
 *
 *   - Missing provider_token -> error redirect (NOT happy path).
 *   - storeCredentials throws -> error redirect (NOT happy path).
 *   - Exchange error -> error redirect.
 *   - Happy path -> storeCredentials called, user redirected to onboarding/feed.
 *
 * Supabase `createServerClient` and the `storeCredentials` / Prisma
 * surface are mocked. This keeps the test a true unit test of the
 * callback's branching logic, independent of external services.
 */
import { GmailCredentialError } from "@denim/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  storeCredentials: vi.fn(),
  caseSchemaCount: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  }),
}));

vi.mock("@/lib/gmail/credentials", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gmail/credentials")>("@/lib/gmail/credentials");
  return {
    ...actual,
    storeCredentials: mocks.storeCredentials,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caseSchema: { count: mocks.caseSchemaCount },
  },
}));

import { GET } from "../route";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  vi.clearAllMocks();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeRequest(search = "?code=abc123") {
  return new Request(`http://localhost:3000/auth/callback${search}`) as never;
}

function goodExchangeData() {
  return {
    data: {
      session: {
        provider_token: "ya29.fresh",
        provider_refresh_token: "1//refresh",
      },
      user: { id: "u-1", email: "a@b.com" },
    },
    error: null,
  };
}

describe("GET /auth/callback -- fail-closed contract", () => {
  it("redirects to the error page with reason=NO_CODE when no auth code is present", async () => {
    const res = await GET(makeRequest("?"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("auth_error=true");
    expect(res.headers.get("location")).toContain("reason=NO_CODE");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.storeCredentials).not.toHaveBeenCalled();
  });

  it("redirects to the error page when exchangeCodeForSession returns an error", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      data: null,
      error: { name: "AuthError", message: "invalid code" },
    });
    const res = await GET(makeRequest());
    expect(res.headers.get("location")).toContain("reason=EXCHANGE_FAILED");
    expect(mocks.storeCredentials).not.toHaveBeenCalled();
  });

  it("redirects to TOKEN_SHAPE_INVALID when provider_token is missing (tonight's bug)", async () => {
    // This is the exact shape that bit us 2026-04-18: exchange succeeds,
    // but Supabase didn't pass provider tokens through. Pre-refactor this
    // path logged warn and redirected happy-path. Post-refactor, error.
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: { provider_token: null, provider_refresh_token: null },
        user: { id: "u-1", email: "a@b.com" },
      },
      error: null,
    });
    const res = await GET(makeRequest());
    expect(res.headers.get("location")).toContain("reason=TOKEN_SHAPE_INVALID");
    expect(mocks.storeCredentials).not.toHaveBeenCalled();
  });

  it("redirects to CREDENTIAL_STORE_FAILED with the typed reason when storeCredentials throws", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce(goodExchangeData());
    mocks.storeCredentials.mockRejectedValueOnce(
      new GmailCredentialError("scope missing", {
        reason: "scope_insufficient",
        remedy: "reconnect",
      }),
    );
    const res = await GET(makeRequest());
    expect(res.headers.get("location")).toContain("reason=CREDENTIAL_STORE_FAILED");
    expect(res.headers.get("location")).toContain("detail=scope_insufficient");
    expect(mocks.caseSchemaCount).not.toHaveBeenCalled();
  });

  it("redirects to CREDENTIAL_STORE_FAILED (no detail) when storeCredentials throws a non-typed error", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce(goodExchangeData());
    mocks.storeCredentials.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.headers.get("location")).toContain("reason=CREDENTIAL_STORE_FAILED");
    expect(res.headers.get("location")).not.toContain("detail=");
  });

  it("happy path: stores credentials and redirects to /onboarding/category for first-time user", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce(goodExchangeData());
    mocks.storeCredentials.mockResolvedValueOnce(undefined);
    mocks.caseSchemaCount.mockResolvedValueOnce(0);

    const res = await GET(makeRequest());
    expect(res.headers.get("location")).toContain("/onboarding/category");
    expect(mocks.storeCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u-1",
        email: "a@b.com",
        accessToken: "ya29.fresh",
        refreshToken: "1//refresh",
        verificationSource: "supabase_exchange",
      }),
    );
  });

  it("happy path: redirects to /feed for a returning user with existing schemas", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce(goodExchangeData());
    mocks.storeCredentials.mockResolvedValueOnce(undefined);
    mocks.caseSchemaCount.mockResolvedValueOnce(3);

    const res = await GET(makeRequest());
    expect(res.headers.get("location")).toContain("/feed");
  });

  it("honors the explicit ?next= param over dynamic routing", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce(goodExchangeData());
    mocks.storeCredentials.mockResolvedValueOnce(undefined);

    const res = await GET(makeRequest("?code=abc&next=/onboarding/01KABC"));
    expect(res.headers.get("location")).toContain("/onboarding/01KABC");
    // Dynamic routing should be skipped when next is provided.
    expect(mocks.caseSchemaCount).not.toHaveBeenCalled();
  });

  it("falls back to /onboarding/category when dynamic routing errors (credentials already stored)", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce(goodExchangeData());
    mocks.storeCredentials.mockResolvedValueOnce(undefined);
    mocks.caseSchemaCount.mockRejectedValueOnce(new Error("db glitch"));

    const res = await GET(makeRequest());
    expect(res.headers.get("location")).toContain("/onboarding/category");
    // Credentials were stored successfully -- the glitch is non-fatal.
    expect(mocks.storeCredentials).toHaveBeenCalledTimes(1);
  });
});
