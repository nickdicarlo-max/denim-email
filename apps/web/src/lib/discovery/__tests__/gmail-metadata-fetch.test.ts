import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailClient } from "@/lib/gmail/client";
import { fetchFromHeaders } from "../gmail-metadata-fetch";

/**
 * Build a mock `GmailClient`-shaped object that only implements the two
 * methods `fetchFromHeaders` actually calls. We pass it through `as any`
 * so TypeScript accepts it where a `GmailClient` is expected.
 */
function makeMockClient(opts: {
  ids: string[];
  getMessageMetadata: (id: string) => Promise<{
    id: string;
    payload: { headers: Array<{ name: string; value: string }> };
  }>;
}) {
  return {
    listMessageIds: vi.fn(async () => opts.ids),
    getMessageMetadata: vi.fn(opts.getMessageMetadata),
  };
}

describe("fetchFromHeaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns From header for each message ID", async () => {
    const ids = ["id-1", "id-2", "id-3"];
    const fromValues: Record<string, string> = {
      "id-1": "alice@example.com",
      "id-2": "bob@example.com",
      "id-3": "carol@example.com",
    };
    const client = makeMockClient({
      ids,
      getMessageMetadata: async (id) => ({
        id,
        payload: { headers: [{ name: "From", value: fromValues[id] }] },
      }),
    });

    const result = await fetchFromHeaders(client as unknown as GmailClient, "newer_than:365d");

    expect(result.messagesRequested).toBe(3);
    expect(result.errorCount).toBe(0);
    expect(result.firstError).toBeUndefined();
    expect(result.results).toHaveLength(3);
    expect(result.results).toEqual([
      { messageId: "id-1", fromHeader: "alice@example.com" },
      { messageId: "id-2", fromHeader: "bob@example.com" },
      { messageId: "id-3", fromHeader: "carol@example.com" },
    ]);
    expect(client.listMessageIds).toHaveBeenCalledTimes(1);
    expect(client.getMessageMetadata).toHaveBeenCalledTimes(3);
  });

  it("returns empty result when search finds nothing", async () => {
    const client = makeMockClient({
      ids: [],
      getMessageMetadata: async () => {
        throw new Error("should not be called");
      },
    });

    const result = await fetchFromHeaders(client as unknown as GmailClient, "newer_than:365d");

    expect(result.messagesRequested).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.errorCount).toBe(0);
    expect(client.listMessageIds).toHaveBeenCalledTimes(1);
    expect(client.getMessageMetadata).not.toHaveBeenCalled();
  });

  it("counts per-message failures instead of swallowing them", async () => {
    const ids = ["id-1", "id-2", "id-3"];
    const client = makeMockClient({
      ids,
      getMessageMetadata: async (id) => {
        if (id === "id-2") {
          throw new Error("429 rate limit exceeded");
        }
        return {
          id,
          payload: { headers: [{ name: "From", value: `${id}@example.com` }] },
        };
      },
    });

    const result = await fetchFromHeaders(client as unknown as GmailClient, "newer_than:365d");

    expect(result.messagesRequested).toBe(3);
    expect(result.results).toHaveLength(2);
    expect(result.errorCount).toBe(1);
    expect(result.firstError).toBeDefined();
    // Sanitized form: "<ErrorName>:<status>" — status extracted from message.
    // Message contained "429", so we expect a 429 in the sanitized string.
    expect(result.firstError).toMatch(/429/);
  });
});
