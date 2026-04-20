import { describe, expect, it } from "vitest";
import { GmailCredentialError } from "../errors";
import {
  credentialFailure,
  extractCredentialFailure,
  isCredentialFailure,
  remedyFor,
} from "../gmail-credentials";

describe("isCredentialFailure", () => {
  it("accepts a valid CredentialFailure object", () => {
    expect(isCredentialFailure({ reason: "absent", remedy: "reconnect" })).toBe(true);
    expect(isCredentialFailure({ reason: "revoked", remedy: "reconnect" })).toBe(true);
  });

  it("rejects primitives, null, undefined, arrays", () => {
    expect(isCredentialFailure(null)).toBe(false);
    expect(isCredentialFailure(undefined)).toBe(false);
    expect(isCredentialFailure("reason")).toBe(false);
    expect(isCredentialFailure(42)).toBe(false);
    expect(isCredentialFailure([])).toBe(false);
  });

  it("rejects objects missing reason or remedy", () => {
    expect(isCredentialFailure({ reason: "absent" })).toBe(false);
    expect(isCredentialFailure({ remedy: "reconnect" })).toBe(false);
    expect(isCredentialFailure({})).toBe(false);
  });

  it("rejects objects where reason or remedy aren't strings", () => {
    expect(isCredentialFailure({ reason: 1, remedy: "reconnect" })).toBe(false);
    expect(isCredentialFailure({ reason: "absent", remedy: null })).toBe(false);
  });
});

describe("extractCredentialFailure", () => {
  it("pulls credentialFailure off a real GmailCredentialError instance", () => {
    const err = new GmailCredentialError("Gmail not connected", credentialFailure("absent"));
    const cf = extractCredentialFailure(err);
    expect(cf).toEqual({ reason: "absent", remedy: "reconnect" });
  });

  it("pulls credentialFailure off a plain object shaped like GmailCredentialError", () => {
    // Regression: this is the Turbopack scenario — the thrown error has the
    // right shape but `instanceof GmailCredentialError` returns false because
    // the class was loaded via a different module instance.
    const ducktyped = {
      name: "GmailCredentialError",
      message: "x",
      credentialFailure: { reason: "revoked", remedy: "reconnect" },
    };
    const cf = extractCredentialFailure(ducktyped);
    expect(cf).toEqual({ reason: "revoked", remedy: "reconnect" });
  });

  it("returns undefined for plain Error without credentialFailure", () => {
    expect(extractCredentialFailure(new Error("nope"))).toBeUndefined();
  });

  it("returns undefined for non-error values", () => {
    expect(extractCredentialFailure(null)).toBeUndefined();
    expect(extractCredentialFailure(undefined)).toBeUndefined();
    expect(extractCredentialFailure("string error")).toBeUndefined();
    expect(extractCredentialFailure(42)).toBeUndefined();
  });

  it("returns undefined when credentialFailure is malformed", () => {
    const bad = { credentialFailure: { reason: "x" } }; // missing remedy
    expect(extractCredentialFailure(bad)).toBeUndefined();
  });
});

describe("remedyFor", () => {
  it("maps reconnect-category reasons to `reconnect`", () => {
    expect(remedyFor("absent")).toBe("reconnect");
    expect(remedyFor("scope_insufficient")).toBe("reconnect");
    expect(remedyFor("revoked")).toBe("reconnect");
    expect(remedyFor("refresh_failed")).toBe("reconnect");
    expect(remedyFor("decrypt_failed")).toBe("reconnect");
  });

  // #124: account_conflict is NOT user-recoverable via OAuth — reconnecting
  // would hit the same P2002. `contact_support` is the honest remedy.
  it("maps account_conflict to `contact_support`", () => {
    expect(remedyFor("account_conflict")).toBe("contact_support");
  });
});

describe("credentialFailure constructor", () => {
  it("couples account_conflict with contact_support remedy", () => {
    expect(credentialFailure("account_conflict")).toEqual({
      reason: "account_conflict",
      remedy: "contact_support",
    });
  });
});
