import { describe, expect, it } from "vitest";
import {
  type GmailMessageMeta,
  type SerializedGmailMessageMeta,
  serializeMessageForStep,
} from "../types";

const sample: GmailMessageMeta = {
  id: "msg-1",
  threadId: "thread-1",
  subject: "Hello",
  sender: "Alice <alice@example.com>",
  senderEmail: "alice@example.com",
  senderDomain: "example.com",
  senderDisplayName: "Alice",
  recipients: ["bob@example.com"],
  date: new Date("2026-04-14T12:34:56.000Z"),
  snippet: "snippet",
  isReply: false,
  labels: ["INBOX"],
};

describe("serializeMessageForStep", () => {
  it("serializes Date to ISO string", () => {
    const serialized = serializeMessageForStep(sample);
    expect(serialized.date).toBe("2026-04-14T12:34:56.000Z");
    expect(typeof serialized.date).toBe("string");
  });

  it("round-trips through JSON.stringify unchanged (Inngest replay invariant)", () => {
    const serialized = serializeMessageForStep(sample);
    const roundTripped = JSON.parse(JSON.stringify(serialized));
    expect(roundTripped).toEqual(serialized);
  });

  it("SerializedGmailMessageMeta.date is typed as string (compile-time check)", () => {
    const serialized = serializeMessageForStep(sample);
    // Compile-time assertion: this line will not type-check if `date` is
    // not exactly `string` on SerializedGmailMessageMeta.
    const _check: string = serialized.date;
    const _typed: SerializedGmailMessageMeta = serialized;
    expect(_check).toBe(_typed.date);
  });
});
