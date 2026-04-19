import { afterEach, describe, expect, it, vi } from "vitest";
import type { GmailClient } from "@/lib/gmail/client";
import * as fetchModule from "../gmail-metadata-fetch";
import {
  discoverUserNamedContacts,
  discoverUserNamedThings,
} from "../user-hints-discovery";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(results: Array<{ messageId: string; fromHeader: string }>) {
  return vi.spyOn(fetchModule, "fetchFromHeaders").mockResolvedValue({
    results,
    errorCount: 0,
    messagesRequested: results.length,
  });
}

const gmail = {} as GmailClient; // unused inside primitive — fetch is stubbed

describe("discoverUserNamedThings", () => {
  it("returns matchCount + top domain for a what that hits", async () => {
    mockFetch([
      { messageId: "1", fromHeader: "Farrukh Malik <farrukh@stallionis.com>" },
      { messageId: "2", fromHeader: "<nm@stallionis.com>" },
      { messageId: "3", fromHeader: "Other <x@somethingelse.com>" },
    ]);
    const [r] = await discoverUserNamedThings(gmail, ["Stallion"], "mygmail.com");
    expect(r.query).toBe("Stallion");
    expect(r.matchCount).toBe(3);
    expect(r.topDomain).toBe("stallionis.com"); // 2 > 1
    expect(r.topSenders).toContain("Farrukh Malik");
    expect(r.errorCount).toBe(0);
  });

  it("reports zero matches explicitly (find-or-tell contract)", async () => {
    mockFetch([]);
    const [r] = await discoverUserNamedThings(gmail, ["Guitar"], "mygmail.com");
    expect(r.matchCount).toBe(0);
    expect(r.topDomain).toBeNull();
    expect(r.topSenders).toEqual([]);
  });

  it("excludes public-provider domains from topDomain ranking", async () => {
    mockFetch([
      { messageId: "1", fromHeader: "<a@gmail.com>" },
      { messageId: "2", fromHeader: "<b@gmail.com>" },
      { messageId: "3", fromHeader: "<c@stallionis.com>" },
    ]);
    const [r] = await discoverUserNamedThings(gmail, ["Stallion"], "x.com");
    expect(r.topDomain).toBe("stallionis.com");
  });

  it("excludes the user's own domain", async () => {
    mockFetch([
      { messageId: "1", fromHeader: "<me@nicks.com>" },
      { messageId: "2", fromHeader: "<other@elsewhere.com>" },
    ]);
    const [r] = await discoverUserNamedThings(gmail, ["Anything"], "nicks.com");
    expect(r.topDomain).toBe("elsewhere.com");
  });

  it("returns empty array when whats is empty (no Gmail call)", async () => {
    const spy = mockFetch([]);
    const r = await discoverUserNamedThings(gmail, [], "x.com");
    expect(r).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("preserves input order when multiple whats resolve in parallel", async () => {
    vi.spyOn(fetchModule, "fetchFromHeaders")
      .mockResolvedValueOnce({
        results: [{ messageId: "1", fromHeader: "<a@foo.com>" }],
        errorCount: 0,
        messagesRequested: 1,
      })
      .mockResolvedValueOnce({
        results: [{ messageId: "2", fromHeader: "<b@bar.com>" }],
        errorCount: 0,
        messagesRequested: 1,
      });
    const results = await discoverUserNamedThings(gmail, ["First", "Second"], "x.com");
    expect(results.map((r) => r.query)).toEqual(["First", "Second"]);
  });

  it("one failed hint doesn't poison sibling results", async () => {
    vi.spyOn(fetchModule, "fetchFromHeaders")
      .mockRejectedValueOnce(new Error("Gmail rate limited"))
      .mockResolvedValueOnce({
        results: [{ messageId: "1", fromHeader: "<a@foo.com>" }],
        errorCount: 0,
        messagesRequested: 1,
      });
    const [failed, ok] = await discoverUserNamedThings(gmail, ["BadOne", "GoodOne"], "x.com");
    expect(failed.matchCount).toBe(0);
    expect(failed.errorCount).toBe(1);
    expect(ok.matchCount).toBe(1);
    expect(ok.errorCount).toBe(0);
  });
});

describe("discoverUserNamedContacts", () => {
  it("identifies the dominant sender address for a who that hits", async () => {
    mockFetch([
      { messageId: "1", fromHeader: "Farrukh Malik <farrukh@stallionis.com>" },
      { messageId: "2", fromHeader: "Farrukh M <farrukh@stallionis.com>" },
      { messageId: "3", fromHeader: "Farrukh <f.malik@personal.com>" },
    ]);
    const [r] = await discoverUserNamedContacts(gmail, ["Farrukh Malik"]);
    expect(r.query).toBe("Farrukh Malik");
    expect(r.matchCount).toBe(3);
    expect(r.senderEmail).toBe("farrukh@stallionis.com"); // 2 matches > 1
    expect(r.senderDomain).toBe("stallionis.com");
  });

  it("reports zero matches explicitly for an unknown contact", async () => {
    mockFetch([]);
    const [r] = await discoverUserNamedContacts(gmail, ["Someone Who Never Emailed"]);
    expect(r.matchCount).toBe(0);
    expect(r.senderEmail).toBeNull();
    expect(r.senderDomain).toBeNull();
  });

  it("handles From headers with no display name", async () => {
    mockFetch([
      { messageId: "1", fromHeader: "alice@example.com" },
      { messageId: "2", fromHeader: "<bob@example.com>" },
    ]);
    const [r] = await discoverUserNamedContacts(gmail, ["anyone"]);
    expect(r.matchCount).toBe(2);
    // No display-name dedup quirk — both land with their respective addresses.
    expect(r.senderEmail).toBeTruthy();
    expect(r.senderDomain).toBe("example.com");
  });

  it("returns empty array on empty whos input (no Gmail call)", async () => {
    const spy = mockFetch([]);
    const r = await discoverUserNamedContacts(gmail, []);
    expect(r).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("one failed hint doesn't poison sibling results", async () => {
    vi.spyOn(fetchModule, "fetchFromHeaders")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        results: [{ messageId: "1", fromHeader: "<ok@ok.com>" }],
        errorCount: 0,
        messagesRequested: 1,
      });
    const [bad, ok] = await discoverUserNamedContacts(gmail, ["Bad", "Good"]);
    expect(bad.matchCount).toBe(0);
    expect(bad.errorCount).toBe(1);
    expect(ok.matchCount).toBe(1);
  });
});
