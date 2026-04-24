/**
 * #130 — thread-adjacency disambiguation for orphan emails with a
 * `candidatePrimaryIds` list.
 *
 * Extraction's Stage 5 records `candidatePrimaryIds` on emails where the
 * sender is a known SECONDARY linked to multiple PRIMARIES and content did
 * not disambiguate (e.g. Amy DiCarlo's generic school blast when she's paired
 * with Lanier + Stagnes + St Agnes + Dance). At cluster time, if a sibling
 * email in the same thread already landed on exactly ONE of those primaries,
 * we adopt that primary here too. If zero or multiple siblings match, the
 * orphan stays unrouted (honest — content/adjacency didn't disambiguate).
 *
 * Pure function: takes the orphan list + the sibling resolved-entity map,
 * returns the resolution list. The DB read/write of the surrounding
 * transaction lives in cluster.ts.
 */

export interface OrphanEmail {
  id: string;
  threadId: string;
  candidatePrimaryIds: string[];
}

export interface ThreadSibling {
  threadId: string;
  entityId: string;
}

export interface AdjacencyResolution {
  emailId: string;
  entityId: string;
}

export function resolveByThreadAdjacency(
  orphans: ReadonlyArray<OrphanEmail>,
  siblings: ReadonlyArray<ThreadSibling>,
): AdjacencyResolution[] {
  if (orphans.length === 0) return [];

  const resolvedByThread = new Map<string, Set<string>>();
  for (const sib of siblings) {
    const bucket = resolvedByThread.get(sib.threadId) ?? new Set<string>();
    bucket.add(sib.entityId);
    resolvedByThread.set(sib.threadId, bucket);
  }

  const resolutions: AdjacencyResolution[] = [];
  for (const orphan of orphans) {
    const threadResolved = resolvedByThread.get(orphan.threadId);
    if (!threadResolved) continue;
    const matching = orphan.candidatePrimaryIds.filter((c) => threadResolved.has(c));
    if (matching.length === 1) {
      resolutions.push({ emailId: orphan.id, entityId: matching[0] });
    }
  }
  return resolutions;
}
