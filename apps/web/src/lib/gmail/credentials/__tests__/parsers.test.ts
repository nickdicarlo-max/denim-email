/**
 * Contract tests for the external-boundary Zod parsers.
 *
 * Each fixture is a shape we consume from a third-party service. If Supabase
 * or Google ever change what they return, these fail first — before
 * `storeCredentials` or `refreshAndPersist` run into a TypeError five
 * frames deep.
 *
 * Parser shapes live with the module (`../parsers.ts`); fixtures live beside
 * this file (`./fixtures/*.json`) as representative samples drawn from real
 * responses with identifiers redacted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GoogleTokenErrorResponseSchema,
  GoogleTokenRefreshResponseSchema,
  SupabaseExchangeDataSchema,
} from "../parsers";

function loadFixture(name: string): unknown {
  const path = join(__dirname, "fixtures", name);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("SupabaseExchangeDataSchema", () => {
  it("accepts a well-formed exchange response with provider_token", () => {
    const fx = loadFixture("supabase-exchange-ok.json");
    const parsed = SupabaseExchangeDataSchema.parse(fx);
    expect(parsed.session.provider_token.length).toBeGreaterThan(0);
    expect(parsed.user.id).toBe("efdf1077-c2c4-48db-8c86-40f64ffbd6f4");
    expect(parsed.user.email).toBe("test@example.com");
  });

  it("rejects an exchange response missing provider_token (the root of tonight's bug)", () => {
    const fx = loadFixture("supabase-exchange-no-provider-token.json");
    const result = SupabaseExchangeDataSchema.safeParse(fx);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      // Must mention provider_token so the callback can render a useful
      // error page instead of silently looping.
      expect(msg.toLowerCase()).toContain("provider_token");
    }
  });

  it("rejects empty provider_token", () => {
    const bad = {
      session: { provider_token: "", provider_refresh_token: null },
      user: { id: "u1", email: "a@b.com" },
    };
    const result = SupabaseExchangeDataSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("tolerates a null provider_refresh_token (first-consent only returns one once)", () => {
    const ok = {
      session: { provider_token: "ya29.abc", provider_refresh_token: null },
      user: { id: "u1", email: "a@b.com" },
    };
    expect(SupabaseExchangeDataSchema.safeParse(ok).success).toBe(true);
  });

  it("tolerates a null user.email (rare but Supabase-possible)", () => {
    const ok = {
      session: { provider_token: "ya29.abc" },
      user: { id: "u1", email: null },
    };
    expect(SupabaseExchangeDataSchema.safeParse(ok).success).toBe(true);
  });
});

describe("GoogleTokenRefreshResponseSchema", () => {
  it("accepts a real refresh response", () => {
    const fx = loadFixture("google-token-refresh-ok.json");
    const parsed = GoogleTokenRefreshResponseSchema.parse(fx);
    expect(parsed.access_token).toContain("ya29.");
    expect(parsed.expires_in).toBeGreaterThan(0);
    expect(parsed.scope).toContain("gmail.readonly");
  });

  it("defaults expires_in to 3600 when omitted", () => {
    const parsed = GoogleTokenRefreshResponseSchema.parse({
      access_token: "ya29.x",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });
    expect(parsed.expires_in).toBe(3600);
  });

  it("rejects a response with missing access_token", () => {
    const bad = { scope: "x", expires_in: 3600 };
    expect(GoogleTokenRefreshResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a response with empty scope", () => {
    const bad = { access_token: "ya29.x", scope: "" };
    expect(GoogleTokenRefreshResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("permits an omitted refresh_token (Google reuses the prior one)", () => {
    const parsed = GoogleTokenRefreshResponseSchema.parse({
      access_token: "ya29.x",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      expires_in: 3600,
    });
    expect(parsed.refresh_token).toBeUndefined();
  });
});

describe("GoogleTokenErrorResponseSchema", () => {
  it("accepts a real invalid_grant error body", () => {
    const fx = loadFixture("google-token-refresh-invalid-grant.json");
    const parsed = GoogleTokenErrorResponseSchema.parse(fx);
    expect(parsed.error).toBe("invalid_grant");
  });

  it("requires the error field", () => {
    expect(GoogleTokenErrorResponseSchema.safeParse({}).success).toBe(false);
  });
});
