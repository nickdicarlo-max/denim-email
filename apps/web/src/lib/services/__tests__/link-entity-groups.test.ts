import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  type EntityGroupInput,
  linkEntityGroups,
  type PersistedEntityRow,
} from "../link-entity-groups";

type UpdateManyCall = {
  where: { id: { in: string[] } };
  data: { groupId?: string; associatedPrimaryIds?: string[] };
};
// The helper emits two `where` shapes for updateMany:
//   - { id: { in: [...] } } for batched writes
//   - { id: "some-id" } for per-row auto-group primary writes
// The test harness normalises both into `{ id: { in: [...] } }` so assertions
// can treat them uniformly.
type RawUpdateManyArgs = {
  where: { id: string | { in: string[] } };
  data: { groupId?: string; associatedPrimaryIds?: string[] };
};
type CreateManyCall = {
  data: Array<{
    schemaId: string;
    name: string;
    identityKey: string;
    type: string;
    associatedPrimaryIds: unknown;
  }>;
};

function makeFakeTx() {
  const groupCreateCalls: Array<{ schemaId: string; index: number; id: string }> = [];
  const entityUpdateManyCalls: UpdateManyCall[] = [];
  const entityCreateManyCalls: CreateManyCall[] = [];
  let nextGroupId = 1;

  const tx = {
    entityGroup: {
      create: async ({ data }: { data: { schemaId: string; index: number }; select: unknown }) => {
        const id = `group-${nextGroupId++}`;
        groupCreateCalls.push({ ...data, id });
        return { id };
      },
    },
    entity: {
      updateMany: async (args: RawUpdateManyArgs) => {
        const ids = typeof args.where.id === "string" ? [args.where.id] : args.where.id.in;
        const normalised: UpdateManyCall = {
          where: { id: { in: ids } },
          data: args.data,
        };
        entityUpdateManyCalls.push(normalised);
        return { count: ids.length };
      },
      createMany: async (args: CreateManyCall) => {
        entityCreateManyCalls.push(args);
        return { count: args.data.length };
      },
    },
  } as unknown as Prisma.TransactionClient;

  return { tx, groupCreateCalls, entityUpdateManyCalls, entityCreateManyCalls };
}

// Helper to pick out an updateMany call that matches a subset of ids + a predicate.
function findGroupIdAssignment(
  calls: UpdateManyCall[],
  memberIds: string[],
): UpdateManyCall | undefined {
  return calls.find(
    (c) =>
      c.data.groupId !== undefined &&
      c.where.id.in.length === memberIds.length &&
      memberIds.every((id) => c.where.id.in.includes(id)),
  );
}

function findAssociatedPrimariesAssignment(
  calls: UpdateManyCall[],
  secondaryIds: string[],
): UpdateManyCall | undefined {
  return calls.find(
    (c) =>
      c.data.associatedPrimaryIds !== undefined &&
      c.where.id.in.length === secondaryIds.length &&
      secondaryIds.every((id) => c.where.id.in.includes(id)),
  );
}

describe("linkEntityGroups", () => {
  it("links a paired 1:1 group (one WHAT + one WHO)", async () => {
    const { tx, groupCreateCalls, entityUpdateManyCalls } = makeFakeTx();
    const createdEntities: PersistedEntityRow[] = [
      { id: "p1", name: "Lanier", type: "PRIMARY" },
      { id: "s1", name: "Amy DiCarlo", type: "SECONDARY" },
    ];
    const groups: EntityGroupInput[] = [{ whats: ["Lanier"], whos: ["Amy DiCarlo"] }];

    await linkEntityGroups({ tx, schemaId: "sch", createdEntities, groups });

    // One EntityGroup for the paired group.
    expect(groupCreateCalls).toHaveLength(1);
    expect(groupCreateCalls[0]).toMatchObject({ schemaId: "sch", index: 0 });

    // Members of the group (both p1 and s1) get groupId set.
    const memberAssign = findGroupIdAssignment(entityUpdateManyCalls, ["p1", "s1"]);
    expect(memberAssign).toBeDefined();
    expect(memberAssign?.data.groupId).toBe("group-1");

    // Secondary s1 gets associatedPrimaryIds=[p1].
    const assoc = findAssociatedPrimariesAssignment(entityUpdateManyCalls, ["s1"]);
    expect(assoc).toBeDefined();
    expect(assoc?.data.associatedPrimaryIds).toEqual(["p1"]);
  });

  it("links a paired 1:N group (one WHO + multiple WHATs) — secondary gets all primary ids", async () => {
    const { tx, entityUpdateManyCalls } = makeFakeTx();
    const createdEntities: PersistedEntityRow[] = [
      { id: "p1", name: "Lanier", type: "PRIMARY" },
      { id: "p2", name: "Stagnes", type: "PRIMARY" },
      { id: "p3", name: "St Agnes", type: "PRIMARY" },
      { id: "p4", name: "Dance", type: "PRIMARY" },
      { id: "s1", name: "Amy DiCarlo", type: "SECONDARY" },
    ];
    const groups: EntityGroupInput[] = [
      {
        whats: ["Lanier", "Stagnes", "St Agnes", "Dance"],
        whos: ["Amy DiCarlo"],
      },
    ];

    await linkEntityGroups({ tx, schemaId: "sch", createdEntities, groups });

    const assoc = findAssociatedPrimariesAssignment(entityUpdateManyCalls, ["s1"]);
    expect(assoc).toBeDefined();
    expect(assoc?.data.associatedPrimaryIds).toEqual(
      expect.arrayContaining(["p1", "p2", "p3", "p4"]),
    );
    expect(assoc?.data.associatedPrimaryIds).toHaveLength(4);
  });

  it("coalesces associatedPrimaryIds writes by fingerprint when two groups share the same primary set", async () => {
    const { tx, entityUpdateManyCalls } = makeFakeTx();
    const createdEntities: PersistedEntityRow[] = [
      { id: "p1", name: "Lanier", type: "PRIMARY" },
      { id: "p2", name: "Stagnes", type: "PRIMARY" },
      { id: "s1", name: "Amy DiCarlo", type: "SECONDARY" },
      { id: "s2", name: "Office Admin", type: "SECONDARY" },
    ];
    const groups: EntityGroupInput[] = [
      { whats: ["Lanier", "Stagnes"], whos: ["Amy DiCarlo"] },
      { whats: ["Stagnes", "Lanier"], whos: ["Office Admin"] }, // same primaries, different order
    ];

    await linkEntityGroups({ tx, schemaId: "sch", createdEntities, groups });

    const assocCalls = entityUpdateManyCalls.filter(
      (c) => c.data.associatedPrimaryIds !== undefined,
    );
    // One coalesced write covering both secondaries.
    expect(assocCalls).toHaveLength(1);
    expect(assocCalls[0].where.id.in).toEqual(expect.arrayContaining(["s1", "s2"]));
    expect(assocCalls[0].data.associatedPrimaryIds).toEqual(expect.arrayContaining(["p1", "p2"]));
  });

  it("falls back to everyone-with-everyone when no groups are provided", async () => {
    const { tx, groupCreateCalls, entityUpdateManyCalls } = makeFakeTx();
    const createdEntities: PersistedEntityRow[] = [
      { id: "p1", name: "Alpha", type: "PRIMARY" },
      { id: "p2", name: "Beta", type: "PRIMARY" },
      { id: "s1", name: "Contact1", type: "SECONDARY" },
      { id: "s2", name: "Contact2", type: "SECONDARY" },
    ];

    await linkEntityGroups({ tx, schemaId: "sch", createdEntities, groups: [] });

    // No explicit group (groups.length === 0), but ungrouped-primary auto-grouping
    // still runs: p1 + p2 each get their own EntityGroup.
    expect(groupCreateCalls).toHaveLength(2);

    // Both secondaries get [p1, p2] as associatedPrimaryIds in one coalesced write.
    const assocCalls = entityUpdateManyCalls.filter(
      (c) => c.data.associatedPrimaryIds !== undefined,
    );
    expect(assocCalls).toHaveLength(1);
    expect(assocCalls[0].where.id.in).toEqual(expect.arrayContaining(["s1", "s2"]));
    expect(assocCalls[0].data.associatedPrimaryIds).toEqual(expect.arrayContaining(["p1", "p2"]));
  });

  it("auto-groups ungrouped PRIMARY entities into their own EntityGroups", async () => {
    const { tx, groupCreateCalls, entityUpdateManyCalls } = makeFakeTx();
    const createdEntities: PersistedEntityRow[] = [
      { id: "p1", name: "InGroup", type: "PRIMARY" },
      { id: "p2", name: "Loner1", type: "PRIMARY" },
      { id: "p3", name: "Loner2", type: "PRIMARY" },
      { id: "s1", name: "Amy", type: "SECONDARY" },
    ];
    const groups: EntityGroupInput[] = [{ whats: ["InGroup"], whos: ["Amy"] }];

    await linkEntityGroups({ tx, schemaId: "sch", createdEntities, groups });

    // Explicit group (index 0) + 2 auto-groups for p2, p3 (index 1, 2).
    expect(groupCreateCalls).toHaveLength(3);
    expect(groupCreateCalls.map((g) => g.index).sort()).toEqual([0, 1, 2]);

    // Each loner primary gets its own groupId set via a single-row updateMany.
    const loner1Assign = findGroupIdAssignment(entityUpdateManyCalls, ["p2"]);
    const loner2Assign = findGroupIdAssignment(entityUpdateManyCalls, ["p3"]);
    expect(loner1Assign).toBeDefined();
    expect(loner2Assign).toBeDefined();
    expect(loner1Assign?.data.groupId).not.toEqual(loner2Assign?.data.groupId);
  });

  it("creates sharedWhos SECONDARY rows and skips names already present", async () => {
    const { tx, entityCreateManyCalls } = makeFakeTx();
    const createdEntities: PersistedEntityRow[] = [
      { id: "p1", name: "Topic", type: "PRIMARY" },
      { id: "s1", name: "AlreadyHere", type: "SECONDARY" },
    ];

    await linkEntityGroups({
      tx,
      schemaId: "sch",
      createdEntities,
      groups: [],
      sharedWhos: ["AlreadyHere", "BrandNewSender"],
    });

    expect(entityCreateManyCalls).toHaveLength(1);
    expect(entityCreateManyCalls[0].data).toHaveLength(1);
    expect(entityCreateManyCalls[0].data[0].name).toBe("BrandNewSender");
    expect(entityCreateManyCalls[0].data[0].type).toBe("SECONDARY");
  });

  it("is a no-op on an empty schema (no entities, no groups)", async () => {
    const { tx, groupCreateCalls, entityUpdateManyCalls, entityCreateManyCalls } = makeFakeTx();

    await linkEntityGroups({ tx, schemaId: "sch", createdEntities: [], groups: [] });

    expect(groupCreateCalls).toHaveLength(0);
    expect(entityUpdateManyCalls).toHaveLength(0);
    expect(entityCreateManyCalls).toHaveLength(0);
  });

  it("resolves typed names that are a prefix of the augmented persisted entity name (property schema regression)", async () => {
    // Regression for a bug that surfaced on the property eval schema:
    // inputs.groups stores the user-typed strings ("851 Peavy"), but the
    // confirm flow persisted augmented names ("851 Peavy Road"). Exact
    // name lookup missed → all SECONDARIES ended up with empty
    // associatedPrimaryIds and the scan pipeline's sender fallback couldn't
    // route.
    const { tx, entityUpdateManyCalls } = makeFakeTx();
    const createdEntities: PersistedEntityRow[] = [
      { id: "p1", name: "851 Peavy Road", type: "PRIMARY" },
      { id: "p2", name: "3910 Bucknell Drive", type: "PRIMARY" },
      { id: "p3", name: "2310 Healey Drive", type: "PRIMARY" },
      { id: "s1", name: "Timothy Bishop", type: "SECONDARY" },
      { id: "s2", name: "Vivek Gupta", type: "SECONDARY" },
      { id: "s3", name: "Krystin Jernigan", type: "SECONDARY" },
    ];
    const groups: EntityGroupInput[] = [
      {
        // User typed short labels.
        whats: ["851 Peavy", "3910 Bucknell", "2310 Healey"],
        whos: ["Timothy Bishop", "Vivek Gupta", "Krystin Jernigan"],
      },
    ];

    await linkEntityGroups({ tx, schemaId: "sch", createdEntities, groups });

    // Every SECONDARY should get all 3 primary ids as associatedPrimaryIds.
    const assocCalls = entityUpdateManyCalls.filter(
      (c) => c.data.associatedPrimaryIds !== undefined,
    );
    expect(assocCalls).toHaveLength(1);
    expect(assocCalls[0].where.id.in).toEqual(expect.arrayContaining(["s1", "s2", "s3"]));
    expect(assocCalls[0].data.associatedPrimaryIds).toEqual(
      expect.arrayContaining(["p1", "p2", "p3"]),
    );
    expect(assocCalls[0].data.associatedPrimaryIds).toHaveLength(3);
  });

  it("restricts fuzzy matching to the correct type — typed WHO cannot resolve to a PRIMARY", async () => {
    // Defensive: if the user happened to type "Lanier" under `whos`, the
    // resolver must not accidentally bind it to a "Lanier"-named PRIMARY.
    const { tx, entityUpdateManyCalls } = makeFakeTx();
    const createdEntities: PersistedEntityRow[] = [
      { id: "p1", name: "Lanier", type: "PRIMARY" },
      { id: "s1", name: "Amy DiCarlo", type: "SECONDARY" },
    ];
    const groups: EntityGroupInput[] = [
      { whats: ["Amy DiCarlo"], whos: ["Lanier"] }, // inverted on purpose
    ];

    await linkEntityGroups({ tx, schemaId: "sch", createdEntities, groups });

    // No match for whats=["Amy DiCarlo"] as PRIMARY → empty primaryIds →
    // no associatedPrimaryIds write.
    const assocCalls = entityUpdateManyCalls.filter(
      (c) => c.data.associatedPrimaryIds !== undefined,
    );
    expect(assocCalls).toHaveLength(0);
  });

  it("ignores names in groups that don't map to a created entity", async () => {
    const { tx, groupCreateCalls, entityUpdateManyCalls } = makeFakeTx();
    const createdEntities: PersistedEntityRow[] = [
      { id: "p1", name: "Lanier", type: "PRIMARY" },
      // "Amy DiCarlo" not persisted
    ];
    const groups: EntityGroupInput[] = [{ whats: ["Lanier"], whos: ["Amy DiCarlo"] }];

    await linkEntityGroups({ tx, schemaId: "sch", createdEntities, groups });

    // Group created with only p1 as member.
    expect(groupCreateCalls).toHaveLength(1);
    const groupAssign = findGroupIdAssignment(entityUpdateManyCalls, ["p1"]);
    expect(groupAssign).toBeDefined();

    // No associatedPrimaryIds write since there are zero resolved secondaries.
    const assocCalls = entityUpdateManyCalls.filter(
      (c) => c.data.associatedPrimaryIds !== undefined,
    );
    expect(assocCalls).toHaveLength(0);
  });
});
