import { describe, expect, it } from "vitest";
import { isPublicProvider, PUBLIC_PROVIDERS } from "../discovery/public-providers";

describe("public-providers", () => {
  it("recognizes gmail", () => {
    expect(isPublicProvider("gmail.com")).toBe(true);
  });

  it("recognizes yahoo variants", () => {
    expect(isPublicProvider("yahoo.com")).toBe(true);
    expect(isPublicProvider("YAHOO.COM")).toBe(true);
  });

  it("does not match custom domains", () => {
    expect(isPublicProvider("portfolioproadvisors.com")).toBe(false);
    expect(isPublicProvider("anthropic.com")).toBe(false);
  });

  it("exports a non-empty set", () => {
    expect(PUBLIC_PROVIDERS.size).toBeGreaterThan(8);
  });
});
