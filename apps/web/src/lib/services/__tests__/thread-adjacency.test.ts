import { describe, expect, it } from "vitest";
import {
  type OrphanEmail,
  resolveByThreadAdjacency,
  type ThreadSibling,
} from "../thread-adjacency";

describe("resolveByThreadAdjacency", () => {
  it("adopts the one primary that matches a thread sibling", () => {
    // Amy DiCarlo's paired-WHATs: Lanier, Stagnes, St Agnes, Dance.
    // One orphan in a thread where a Lanier email has already landed.
    const orphans: OrphanEmail[] = [
      {
        id: "orphan-1",
        threadId: "thread-A",
        candidatePrimaryIds: ["lanier", "stagnes", "st-agnes", "dance"],
      },
    ];
    const siblings: ThreadSibling[] = [{ threadId: "thread-A", entityId: "lanier" }];

    const result = resolveByThreadAdjacency(orphans, siblings);
    expect(result).toEqual([{ emailId: "orphan-1", entityId: "lanier" }]);
  });

  it("leaves orphan unresolved when multiple candidate primaries match siblings", () => {
    // Edge: a thread that somehow has two different resolved primaries,
    // both in the orphan's candidate set. Can't decide — stay orphan.
    const orphans: OrphanEmail[] = [
      {
        id: "orphan-1",
        threadId: "thread-A",
        candidatePrimaryIds: ["lanier", "stagnes"],
      },
    ];
    const siblings: ThreadSibling[] = [
      { threadId: "thread-A", entityId: "lanier" },
      { threadId: "thread-A", entityId: "stagnes" },
    ];

    const result = resolveByThreadAdjacency(orphans, siblings);
    expect(result).toEqual([]);
  });

  it("leaves orphan unresolved when no sibling matches any candidate", () => {
    const orphans: OrphanEmail[] = [
      {
        id: "orphan-1",
        threadId: "thread-A",
        candidatePrimaryIds: ["lanier", "stagnes"],
      },
    ];
    const siblings: ThreadSibling[] = [{ threadId: "thread-A", entityId: "unrelated" }];

    const result = resolveByThreadAdjacency(orphans, siblings);
    expect(result).toEqual([]);
  });

  it("leaves orphan unresolved when the thread has no resolved siblings at all", () => {
    const orphans: OrphanEmail[] = [
      {
        id: "orphan-1",
        threadId: "thread-A",
        candidatePrimaryIds: ["lanier"],
      },
    ];
    const siblings: ThreadSibling[] = []; // empty — orphan is alone in its thread

    const result = resolveByThreadAdjacency(orphans, siblings);
    expect(result).toEqual([]);
  });

  it("resolves each orphan independently in a batch", () => {
    // Property schema case: Timothy paired with 3 addresses. Two orphan
    // emails in different threads — one disambiguates via Freedom Trail
    // sibling, the other doesn't disambiguate.
    const orphans: OrphanEmail[] = [
      {
        id: "orphan-1",
        threadId: "thread-freedom",
        candidatePrimaryIds: ["freedom-trail", "cardinal", "sylvan"],
      },
      {
        id: "orphan-2",
        threadId: "thread-unknown",
        candidatePrimaryIds: ["freedom-trail", "cardinal", "sylvan"],
      },
    ];
    const siblings: ThreadSibling[] = [{ threadId: "thread-freedom", entityId: "freedom-trail" }];

    const result = resolveByThreadAdjacency(orphans, siblings);
    expect(result).toEqual([{ emailId: "orphan-1", entityId: "freedom-trail" }]);
  });

  it("deduplicates sibling entityIds within the same thread — one sibling counted once", () => {
    // If 3 emails in the thread all resolved to Lanier, that still counts
    // as a single match, and the orphan should adopt Lanier.
    const orphans: OrphanEmail[] = [
      {
        id: "orphan-1",
        threadId: "thread-A",
        candidatePrimaryIds: ["lanier", "stagnes"],
      },
    ];
    const siblings: ThreadSibling[] = [
      { threadId: "thread-A", entityId: "lanier" },
      { threadId: "thread-A", entityId: "lanier" },
      { threadId: "thread-A", entityId: "lanier" },
    ];

    const result = resolveByThreadAdjacency(orphans, siblings);
    expect(result).toEqual([{ emailId: "orphan-1", entityId: "lanier" }]);
  });

  it("ignores siblings with entityIds outside the orphan's candidate set", () => {
    // Thread has a resolved email for an unrelated PRIMARY (Stallion at
    // agency domain) AND a resolved email for a candidate (PPA). The
    // unrelated one is ignored; the candidate match wins.
    const orphans: OrphanEmail[] = [
      {
        id: "orphan-1",
        threadId: "thread-A",
        candidatePrimaryIds: ["ppa"],
      },
    ];
    const siblings: ThreadSibling[] = [
      { threadId: "thread-A", entityId: "stallion" },
      { threadId: "thread-A", entityId: "ppa" },
    ];

    const result = resolveByThreadAdjacency(orphans, siblings);
    expect(result).toEqual([{ emailId: "orphan-1", entityId: "ppa" }]);
  });

  it("returns empty list when given no orphans", () => {
    expect(resolveByThreadAdjacency([], [])).toEqual([]);
    expect(resolveByThreadAdjacency([], [{ threadId: "t", entityId: "e" }])).toEqual([]);
  });
});
