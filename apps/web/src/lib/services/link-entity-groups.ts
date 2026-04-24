/**
 * Shared helper to wire `EntityGroup` + `Entity.groupId` + `Entity.associatedPrimaryIds`
 * after entity rows have been persisted.
 *
 * Extracted from the inline block in `interview.ts::persistSchemaRelations`
 * (legacy hypothesis-flow finalizer) so the Phase-2/3 `persistConfirmedEntities`
 * path — which drives the current onboarding confirm screen — can reuse it.
 * Without this, today's confirm flow persists orphan entities with null
 * `groupId` and empty `associatedPrimaryIds`, and the scan pipeline's
 * sender-fallback routing breaks for every paired WHO (Amy → Lanier,
 * Timothy → addresses, etc.).
 *
 * The scan pipeline reads `Entity.associatedPrimaryIds` on SECONDARIES in
 * three sites (extraction.ts:~399, ~450, ~526) plus cluster.ts:~200. It
 * does NOT read `EntityGroup` or `Entity.groupId` at scan time — those are
 * onboarding-review concerns. So `associatedPrimaryIds` is the critical
 * denormalisation; `groupId` is UI metadata.
 *
 * Idempotency: each call creates NEW EntityGroup rows. Re-entrant usage is
 * not supported today because both the legacy and Phase-2/3 CAS gates
 * advance phase past the review state after the first successful call.
 * Callers that need idempotency should clean up prior groups before
 * re-invoking.
 *
 * Pure function shape: takes `Prisma.TransactionClient` + pre-loaded entity
 * rows + the user's `inputs.groups`; side-effects to the DB via the passed
 * transaction only. No logger, no env reads, no external state.
 */

import type { Prisma } from "@prisma/client";

export interface PersistedEntityRow {
  id: string;
  name: string;
  type: "PRIMARY" | "SECONDARY";
}

export interface EntityGroupInput {
  whats: string[];
  whos: string[];
}

export interface LinkEntityGroupsInput {
  tx: Prisma.TransactionClient;
  schemaId: string;
  /** Entity rows already persisted (at least `id`, `name`, `type`). The
   *  helper links them into groups and sets `associatedPrimaryIds`; it
   *  does NOT create new entity rows for names outside this list, except
   *  via the `sharedWhos` list (which creates new SECONDARY rows). */
  createdEntities: ReadonlyArray<PersistedEntityRow>;
  /** User's paired groups from `inputs.groups`. When empty, fallback is
   *  "every SECONDARY associated with every PRIMARY" (matches legacy
   *  behavior for the pre-groups era). */
  groups: ReadonlyArray<EntityGroupInput>;
  /** Optional: ungrouped WHO names from `inputs.sharedWhos`. Only used by
   *  the legacy hypothesis path; the Phase-2/3 entity-confirm path
   *  passes an empty array. Creates new SECONDARY entity rows with
   *  empty `associatedPrimaryIds` and no `groupId` (discovery senders —
   *  content determines routing). Names already present in
   *  `createdEntities` are skipped (dedup). */
  sharedWhos?: ReadonlyArray<string>;
}

export async function linkEntityGroups(input: LinkEntityGroupsInput): Promise<void> {
  const { tx, schemaId, createdEntities, groups, sharedWhos = [] } = input;
  const entityByName = new Map(createdEntities.map((e) => [e.name, e]));

  // User-typed names in `inputs.groups` can lag the augmented entity.name
  // persisted by the confirm flow (e.g. user typed "851 Peavy", Gemini
  // canonicalized to "851 Peavy Road"). Resolve loosely via case-insensitive
  // prefix + token-subset match so the paired-group wiring still fires.
  // Restricted to same `type` so a PRIMARY name can't accidentally match a
  // SECONDARY entity and vice versa.
  const resolveByTypedName = (
    typedName: string,
    expectedType: "PRIMARY" | "SECONDARY",
  ): PersistedEntityRow | undefined => {
    const exact = entityByName.get(typedName);
    if (exact && exact.type === expectedType) return exact;

    const lower = typedName.toLowerCase().trim();
    if (lower.length === 0) return undefined;
    const typedTokens = new Set(lower.split(/\s+/));

    // Candidate order: prefer the longest entity name that still contains the
    // typed tokens, so "851 Peavy" matches "851 Peavy Road" and not a
    // shorter accidental prefix.
    let best: { row: PersistedEntityRow; score: number } | undefined;
    for (const row of createdEntities) {
      if (row.type !== expectedType) continue;
      const candidate = row.name.toLowerCase();
      const candidateTokens = candidate.split(/\s+/);
      const candidateTokenSet = new Set(candidateTokens);

      let score = 0;
      if (candidate === lower)
        score = 1000; // exact-insensitive
      else if (candidate.startsWith(`${lower} `) || candidate.startsWith(`${lower}-`))
        score = 500; // user input is a prefix of entity name
      else {
        // Token-subset: every typed token appears in candidate's token set.
        const allPresent = [...typedTokens].every((t) => candidateTokenSet.has(t));
        if (allPresent && typedTokens.size > 0) score = 100 + typedTokens.size;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { row, score };
      }
    }
    return best?.row;
  };

  const groupMemberAssignments: Array<{ groupId: string; memberIds: string[] }> = [];
  const associatedPrimaryByFingerprint = new Map<
    string,
    { primaryIds: string[]; secondaryIds: string[] }
  >();

  if (groups.length > 0) {
    // Pre-compute group member mappings in memory, then batch-create groups.
    const groupSpecs = groups
      .map((group, i) => {
        const primaryIdsInGroup = group.whats
          .map((name) => resolveByTypedName(name, "PRIMARY")?.id)
          .filter((id): id is string => !!id);
        const secondaryIdsInGroup = group.whos
          .map((name) => resolveByTypedName(name, "SECONDARY")?.id)
          .filter((id): id is string => !!id);
        const memberIds = [...primaryIdsInGroup, ...secondaryIdsInGroup];
        return { index: i, memberIds, primaryIdsInGroup, secondaryIdsInGroup };
      })
      .filter((g) => g.memberIds.length > 0);

    const createdGroups = await Promise.all(
      groupSpecs.map((g) =>
        tx.entityGroup.create({
          data: { schemaId, index: g.index },
          select: { id: true },
        }),
      ),
    );

    for (let i = 0; i < groupSpecs.length; i++) {
      const spec = groupSpecs[i];
      const entityGroupId = createdGroups[i].id;
      groupMemberAssignments.push({ groupId: entityGroupId, memberIds: spec.memberIds });

      if (spec.primaryIdsInGroup.length > 0 && spec.secondaryIdsInGroup.length > 0) {
        // Fingerprint by sorted primary IDs so secondaries with identical
        // associatedPrimaryIds coalesce into one updateMany.
        const fp = [...spec.primaryIdsInGroup].sort().join(",");
        const bucket = associatedPrimaryByFingerprint.get(fp) ?? {
          primaryIds: spec.primaryIdsInGroup,
          secondaryIds: [],
        };
        bucket.secondaryIds.push(...spec.secondaryIdsInGroup);
        associatedPrimaryByFingerprint.set(fp, bucket);
      }
    }
  } else {
    // Fallback: no groups — associate every secondary with every primary.
    const primaryIds = createdEntities.filter((e) => e.type === "PRIMARY").map((e) => e.id);
    const secondaryIds = createdEntities.filter((e) => e.type === "SECONDARY").map((e) => e.id);

    if (primaryIds.length > 0 && secondaryIds.length > 0) {
      associatedPrimaryByFingerprint.set([...primaryIds].sort().join(","), {
        primaryIds,
        secondaryIds,
      });
    }
  }

  // Auto-promote ungrouped PRIMARY entities to their own groups. Discovered
  // primaries (mid-scan or Stage 2 "Also noticed") and user-added primaries
  // that weren't placed in any group should each become their own EntityGroup
  // so downstream clustering treats them as case boundaries.
  const groupedEntityIds = new Set<string>();
  for (const group of groups) {
    for (const name of group.whats) {
      const resolved = resolveByTypedName(name, "PRIMARY");
      if (resolved) groupedEntityIds.add(resolved.id);
    }
    for (const name of group.whos) {
      const resolved = resolveByTypedName(name, "SECONDARY");
      if (resolved) groupedEntityIds.add(resolved.id);
    }
  }
  const ungroupedPrimaries = createdEntities.filter(
    (e) => e.type === "PRIMARY" && !groupedEntityIds.has(e.id),
  );

  const autoGroupBase = groups.length;
  const createdAutoGroups = await Promise.all(
    ungroupedPrimaries.map((_, i) =>
      tx.entityGroup.create({
        data: { schemaId, index: autoGroupBase + i },
        select: { id: true },
      }),
    ),
  );

  // Shared WHOs — new SECONDARY entities with no group, empty
  // associatedPrimaryIds. These are discovery senders: their `from:`
  // queries find emails, but content determines routing. Skip names
  // already present in `createdEntities` (dedup).
  const sharedWhoData = sharedWhos
    .filter((whoName) => !entityByName.has(whoName))
    .map((whoName) => ({
      schemaId,
      name: whoName,
      identityKey: whoName,
      type: "SECONDARY" as const,
      secondaryTypeName: null,
      aliases: [] as unknown as Prisma.InputJsonValue,
      confidence: 1.0,
      autoDetected: false,
      associatedPrimaryIds: [] as unknown as Prisma.InputJsonValue,
      // No groupId — intentionally ungrouped.
    }));

  // Fire all group-member links, associatedPrimaryIds links, ungrouped-
  // primary group links, and sharedWhos creation in parallel. They target
  // disjoint rows (different entity IDs), so no write-write conflict
  // within the transaction.
  const parallelWrites: Array<Promise<unknown>> = [];

  for (const { groupId, memberIds } of groupMemberAssignments) {
    parallelWrites.push(
      tx.entity.updateMany({
        where: { id: { in: memberIds } },
        data: { groupId },
      }),
    );
  }

  for (const { primaryIds, secondaryIds } of associatedPrimaryByFingerprint.values()) {
    parallelWrites.push(
      tx.entity.updateMany({
        where: { id: { in: secondaryIds } },
        data: { associatedPrimaryIds: primaryIds as unknown as Prisma.InputJsonValue },
      }),
    );
  }

  // Each ungrouped primary gets a distinct groupId, so one updateMany per
  // primary (updateMany can't set different values per row). Issued in
  // parallel alongside the other writes.
  for (let i = 0; i < ungroupedPrimaries.length; i++) {
    const primary = ungroupedPrimaries[i];
    const groupId = createdAutoGroups[i].id;
    parallelWrites.push(
      tx.entity.updateMany({
        where: { id: primary.id },
        data: { groupId },
      }),
    );
  }

  if (sharedWhoData.length > 0) {
    parallelWrites.push(tx.entity.createMany({ data: sharedWhoData }));
  }

  await Promise.all(parallelWrites);
}
