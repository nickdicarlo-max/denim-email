# Issue #129 Step 2 — Hints Narrow the Search + Topic-First Review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between the design intent (*"the hints a user provides during onboarding should narrow what we search for and how we present it"*) and the current behavior (*hints feed labeling only; discovery returns everything; review is a domain-keyed noise list*). Apply four integrated architectural layers that make the pairing triangles the user built in Stage 1 (WHAT↔WHO↔domain) drive both the Gmail queries AND the review screen layout.

**Architecture:** Stage 2 entity discovery currently runs one Gemini subject-pass per confirmed domain with the user's pairings threaded in as labeling hints only. This plan rewires the Stage 2 backend so pairings narrow Gmail queries *before* Gemini sees them, short-circuit Gemini entirely when a domain unambiguously maps to one paired PRIMARY, and present the final review grouped by the user's PRIMARY entities (WHATs) rather than by sender domain. The Stage 1 domain-confirm screen is unchanged in this plan; the full Stage 1+2 UI collapse from the #129 parent issue is deferred to a follow-up plan.

**Tech Stack:** TypeScript (strict), Next.js 16 App Router, React 19 client components, Prisma (Supabase PostgreSQL), Inngest for background jobs, Gemini Flash 2.5 via `callGemini`, Vitest unit tests, Biome lint+format.

---

## Success criteria

When an E2E run against the `school_parent` domain with `whats: ["soccer", "guitar", "dance", "st agnes", "lanier"]`, `whos: ["Ziad Allan", "Amy DiCarlo"]`, `groups: [{whats: ["soccer"], whos: ["Ziad Allan"]}, {whats: ["lanier", "st agnes", "guitar"], whos: ["Amy DiCarlo"]}]` finishes Stage 2:

1. **TeamSnap domain (Ziad → Soccer, unambiguous):** Stage 2 produces **one** entity candidate (`Soccer`, kind=PRIMARY, pre-selected), **zero** Gemini calls for that domain, Gmail query was `from:donotreply@email.teamsnap.com` only (no `from:*@email.teamsnap.com`), zero granular sub-team entities ("ZSA U11 Girls FALL…") appear.
2. **gmail.com domain (Amy → Lanier/St Agnes/Guitar):** Stage 2 Gmail query is `from:amyjdicarlo@gmail.com AND (lanier OR "st agnes" OR stagnes OR guitar) newer_than:56d`, returning at most a few dozen subjects. Gemini runs and returns ≤ 5 entities all clearly tied to `Lanier`, `St Agnes`, or `Guitar`. No "Co-Op feature on staging", "Control Surface", etc.
3. **Review screen layout:** Primary section headers are user WHATs (`Soccer`, `Lanier`, `St Agnes`, `Guitar`). Each shows the paired WHO as a contact-style badge, then entity candidates sourced from Gemini nested below. An "Also noticed" section at the bottom holds anything without a `relatedWhat`. Confirmed domains are NOT top-level section headers.
4. **Tests green:** typecheck clean, all 4 workspaces unit tests pass, new Stage 2 tests cover short-circuit, public-provider scoping, topic filter, and the by-topic UI grouping.
5. **Backward compatibility:** An in-flight schema currently in `AWAITING_ENTITY_CONFIRMATION` still renders a sensible review (fallback: group by domain if `inputs.groups` is empty).

---

## Scope

### In scope
- Backend changes to Stage 2 entity discovery (`entity-discovery.ts`, `entity-discovery-fn.ts`).
- Polling DTO extensions to surface `inputs` and typed meta fields during `AWAITING_ENTITY_CONFIRMATION`.
- Stage 2 review component (`phase-entity-confirmation.tsx`) — full redesign of the grouping logic.
- New shared utility: `paired-who-resolver.ts` — pure function for deriving per-domain pairing context.
- Unit tests for all new logic.
- One live E2E validation + rollback runbook.

### Out of scope (deferred to follow-up plans)
- Collapsing `AWAITING_DOMAIN_CONFIRMATION` and `AWAITING_ENTITY_CONFIRMATION` into a single review screen (the full #129 parent issue). Kept as two screens here.
- Running Gemini on *candidate* (pre-confirmed) domains — still runs on confirmed domains only.
- Migrating deprecated columns (`stage2Candidates` JSONB stays as-is).
- Case-splitting and clustering improvements (#86, #123).
- Relevance gate over-exclusion (#118).

### What does NOT change
- `runDomainDiscovery` (Stage 1). Its output shape, keywords, find-or-tell contract.
- `phase-domain-confirmation.tsx` — Stage 1 review screen stays.
- `/api/onboarding/:schemaId/domain-confirm` route.
- `/api/onboarding/:schemaId/entity-confirm` route signature and CAS transition.
- `persistConfirmedEntities`, `seedSchemaDefaults`, `seedSchemaName` in `interview.ts`.
- `SchemaPhase` enum — no new values added.
- The Inngest function wiring (`runEntityDiscovery` still triggered by `onboarding.entity-discovery.requested`).

---

## File structure

### Create

| File | Responsibility |
|---|---|
| `apps/web/src/lib/discovery/paired-who-resolver.ts` | Pure function: given `inputs.groups`, `stage1UserContacts`, `stage1ConfirmedUserContactQueries`, `confirmedDomains`, produce a `Map<domain, DomainPairingContext>` consumed by the Inngest Stage 2 fan-out. |
| `apps/web/src/lib/discovery/__tests__/paired-who-resolver.test.ts` | Unit tests covering pairing resolution, short-circuit detection, unpaired fallback. |
| `apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts` | Unit tests for `fetchSubjects` query building, `discoverEntitiesForDomain` short-circuit and topic-filtered paths. |
| `apps/web/src/components/onboarding/__tests__/phase-entity-confirmation.test.tsx` | Component test verifying by-topic grouping renders, fallback to by-domain when `inputs.groups` is empty, `relatedWhat` routes candidates correctly. |

### Modify

| File | Reason |
|---|---|
| `apps/web/src/lib/discovery/entity-discovery.ts` | Add `confirmedSenderEmails`, `topicKeywords`, `unambiguousPairedWhat` to `DiscoverEntitiesInput`; rewrite `fetchSubjects` for public-provider scoping + topic filter; add short-circuit branch in `discoverEntitiesForDomain`. |
| `apps/web/src/lib/inngest/entity-discovery-fn.ts` | Replace ad-hoc pairing building with `resolvePairingContext`; thread per-domain context into `discoverEntitiesForDomain`. |
| `apps/web/src/lib/services/onboarding-polling.ts` | Surface `inputs` during `AWAITING_ENTITY_CONFIRMATION`; add typed fields `relatedWhat`, `sourcedFromWho`, `kind` on `Stage2DomainCandidateDTO` (replacing loose `meta`). |
| `apps/web/src/components/onboarding/phase-entity-confirmation.tsx` | Full rewrite of grouping logic: group by user WHAT, with domains / WHOs as supporting attribution. |
| `apps/web/src/lib/config/onboarding-tunables.ts` | Add `stage2.enableShortCircuit` + `stage2.useTopicContentFilter` toggles (default true). |

### Delete

None. All changes are additive or in-place rewrites.

---

## Phase sequencing

```
Phase 0  Foundation — resolver utility + tunables                       [additive, no behavior change]
Phase 1  Layer 2 — Public-provider domain scoping                       [additive, new query branch]
Phase 2  Layer 3 — Topic-scoped Gmail query content filter              [additive, new query branch]
Phase 3  Layer 1 — Pairing short-circuit                                [additive, skip-Gemini branch]
Phase 4  Polling DTO — surface inputs + typed meta fields               [additive, backward-compat]
Phase 5  Layer 4 — Review UI grouped by user PRIMARY entity             [UI rewrite]
Phase 6  E2E validation + rollback runbook                              [verification]
```

Each phase MUST land green (typecheck + unit tests) before the next starts. Phases 1–3 are incremental backend toggles; any one can be disabled at the tunable and behavior reverts to pre-change. Phase 5 has a fallback path that renders by-domain when `inputs.groups` is empty, so an in-flight schema mid-migration still works.

---

## Phase 0 — Foundation

### Task 0.1: Add tunable toggles

**Files:**
- Modify: `apps/web/src/lib/config/onboarding-tunables.ts`

- [ ] **Step 1: Add two boolean fields under `stage2`**

Replace the existing `stage2` block with the following (additions at the bottom; existing fields untouched):

```typescript
  stage2: {
    /** Max Gmail message IDs to fetch per confirmed Stage-1 domain. */
    maxMessagesPerDomain: 500,
    /** Top N candidate entities to surface per confirmed domain. */
    topNEntities: 20,
    /** Levenshtein threshold for short strings (≤6 chars). */
    levenshteinShortThreshold: 1,
    /**
     * Levenshtein threshold for longer strings. See existing comment.
     */
    levenshteinLongThreshold: 3,
    /**
     * Layer 1 (#129-step-2): when a confirmed domain maps unambiguously
     * to exactly one paired WHAT (via a user-named WHO whose senderDomain
     * matches), skip the Gemini call and return a single synthetic
     * candidate = the paired WHAT. Toggleable so we can A/B measure the
     * impact on review-screen quality.
     */
    enableShortCircuit: true,
    /**
     * Layer 3 (#129-step-2): when a confirmed domain has paired WHATs,
     * append `AND (what1 OR "what 2" OR ...)` to the Gmail query so
     * Gmail returns only subjects mentioning a paired topic. False =
     * no content filter, equivalent to pre-#129-step-2 behavior.
     */
    useTopicContentFilter: true,
    // fetchBatchSize + lookbackDays intentionally omitted — Stage 2 reuses
    // ONBOARDING_TUNABLES.stage1's values. One source of truth, no drift.
  },
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean across all 4 workspaces.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/config/onboarding-tunables.ts
git commit -m "feat(tunables): #129-step-2 add Stage 2 short-circuit + topic-filter toggles"
```

### Task 0.2: Create `paired-who-resolver.ts` with tests

**Files:**
- Create: `apps/web/src/lib/discovery/paired-who-resolver.ts`
- Create: `apps/web/src/lib/discovery/__tests__/paired-who-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/src/lib/discovery/__tests__/paired-who-resolver.test.ts
import { describe, expect, it } from "vitest";
import { resolvePairingContext, type ResolverInput } from "../paired-who-resolver";

const baseInput: ResolverInput = {
  groups: [],
  userContacts: [],
  confirmedContactQueries: [],
  confirmedDomains: [],
};

describe("resolvePairingContext", () => {
  it("returns empty map when nothing is paired", () => {
    const result = resolvePairingContext(baseInput);
    expect(result.size).toBe(0);
  });

  it("builds per-domain sender emails from confirmed user contacts", () => {
    const result = resolvePairingContext({
      ...baseInput,
      userContacts: [
        { query: "Amy DiCarlo", senderEmail: "amy@gmail.com", senderDomain: "gmail.com", matchCount: 18 },
      ],
      confirmedContactQueries: ["Amy DiCarlo"],
      confirmedDomains: ["gmail.com"],
    });
    const ctx = result.get("gmail.com");
    expect(ctx).toBeDefined();
    expect(ctx!.senderEmails).toEqual(["amy@gmail.com"]);
    expect(ctx!.pairedWhats).toEqual([]);
    expect(ctx!.unambiguousPairedWhat).toBeUndefined();
  });

  it("includes paired WHATs when a confirmed WHO is in a group", () => {
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["lanier", "st agnes"], whos: ["Amy DiCarlo"] }],
      userContacts: [
        { query: "Amy DiCarlo", senderEmail: "amy@gmail.com", senderDomain: "gmail.com", matchCount: 18 },
      ],
      confirmedContactQueries: ["Amy DiCarlo"],
      confirmedDomains: ["gmail.com"],
    });
    const ctx = result.get("gmail.com");
    expect(ctx!.pairedWhats).toEqual(["lanier", "st agnes"]);
    // Multi-WHAT means not unambiguous — Gemini still runs but with topic filter.
    expect(ctx!.unambiguousPairedWhat).toBeUndefined();
  });

  it("flags a unambiguous paired WHAT when one WHO for one WHAT owns the domain", () => {
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
      userContacts: [
        {
          query: "Ziad Allan",
          senderEmail: "donotreply@email.teamsnap.com",
          senderDomain: "email.teamsnap.com",
          matchCount: 276,
        },
      ],
      confirmedContactQueries: ["Ziad Allan"],
      confirmedDomains: ["email.teamsnap.com"],
    });
    const ctx = result.get("email.teamsnap.com");
    expect(ctx!.unambiguousPairedWhat).toBe("soccer");
    expect(ctx!.pairedWho).toBe("Ziad Allan");
  });

  it("does not flag short-circuit when the same domain hosts a WHO paired to multiple WHATs", () => {
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["lanier", "st agnes", "guitar"], whos: ["Amy DiCarlo"] }],
      userContacts: [
        { query: "Amy DiCarlo", senderEmail: "amy@gmail.com", senderDomain: "gmail.com", matchCount: 18 },
      ],
      confirmedContactQueries: ["Amy DiCarlo"],
      confirmedDomains: ["gmail.com"],
    });
    const ctx = result.get("gmail.com");
    expect(ctx!.unambiguousPairedWhat).toBeUndefined();
    expect(ctx!.pairedWhats.sort()).toEqual(["guitar", "lanier", "st agnes"]);
  });

  it("does not flag short-circuit when multiple WHOs for the same WHAT share a domain", () => {
    // Two people at different gmail addresses both pair to "lanier".
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["lanier"], whos: ["Amy DiCarlo", "Jane Doe"] }],
      userContacts: [
        { query: "Amy DiCarlo", senderEmail: "amy@gmail.com", senderDomain: "gmail.com", matchCount: 18 },
        { query: "Jane Doe", senderEmail: "jane@gmail.com", senderDomain: "gmail.com", matchCount: 5 },
      ],
      confirmedContactQueries: ["Amy DiCarlo", "Jane Doe"],
      confirmedDomains: ["gmail.com"],
    });
    const ctx = result.get("gmail.com");
    // Unambiguous WHAT = "lanier", but since two distinct WHOs share the domain,
    // pairedWho is undefined (we can't pick one) and short-circuit is disabled
    // because the Gemini filter might still discover more per-sender context.
    expect(ctx!.unambiguousPairedWhat).toBeUndefined();
    expect(ctx!.pairedWhats).toEqual(["lanier"]);
    expect(ctx!.senderEmails.sort()).toEqual(["amy@gmail.com", "jane@gmail.com"]);
  });

  it("skips unconfirmed queries and unconfirmed domains", () => {
    const result = resolvePairingContext({
      ...baseInput,
      groups: [{ whats: ["soccer"], whos: ["Ziad Allan"] }],
      userContacts: [
        {
          query: "Ziad Allan",
          senderEmail: "donotreply@email.teamsnap.com",
          senderDomain: "email.teamsnap.com",
          matchCount: 276,
        },
      ],
      confirmedContactQueries: [], // Ziad was NOT confirmed
      confirmedDomains: ["email.teamsnap.com"],
    });
    const ctx = result.get("email.teamsnap.com");
    // Domain is confirmed but the contact isn't — no sender emails.
    expect(ctx).toBeDefined();
    expect(ctx!.senderEmails).toEqual([]);
    expect(ctx!.unambiguousPairedWhat).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail on missing import**

Run: `pnpm --filter web vitest run src/lib/discovery/__tests__/paired-who-resolver.test.ts`
Expected: FAIL — "Failed to resolve import '../paired-who-resolver'"

- [ ] **Step 3: Implement the resolver**

```typescript
// apps/web/src/lib/discovery/paired-who-resolver.ts
/**
 * Resolve the per-domain pairing context for Stage 2 entity discovery.
 *
 * Stage 2 runs one `discoverEntitiesForDomain` fan-out per confirmed domain.
 * Each fan-out needs to know:
 *   - Which specific sender emails to scope a public-provider query to
 *     (`from:amy@gmail.com` instead of `from:*@gmail.com`).
 *   - Which paired WHATs to append as a Gmail content filter
 *     (`AND (lanier OR "st agnes" OR guitar)`).
 *   - Whether the domain unambiguously maps to one paired WHAT (→ skip
 *     Gemini entirely, return one synthetic candidate = the WHAT).
 *
 * Pure function. All inputs come from the already-loaded schema row; no
 * DB reads. All outputs are derived — no Gemini, no Gmail, no AI.
 */

export interface UserContactRecord {
  query: string;
  senderEmail: string | null;
  senderDomain: string | null;
  matchCount: number;
}

export interface EntityGroup {
  whats: string[];
  whos: string[];
}

export interface ResolverInput {
  /** `schema.inputs.groups ?? []`. */
  groups: EntityGroup[];
  /** `schema.stage1UserContacts ?? []`. */
  userContacts: UserContactRecord[];
  /** `schema.stage1ConfirmedUserContactQueries ?? []`. */
  confirmedContactQueries: string[];
  /** `schema.stage2ConfirmedDomains ?? []`. */
  confirmedDomains: string[];
}

export interface DomainPairingContext {
  /** Sender emails the user confirmed at this domain. Used for public-provider query scoping. */
  senderEmails: string[];
  /** Unique paired WHATs across all confirmed WHOs at this domain. */
  pairedWhats: string[];
  /**
   * Present only when:
   *  - exactly one sender email is confirmed at this domain, AND
   *  - that sender's paired WHATs has exactly one entry.
   * Used to short-circuit Gemini and return a single synthetic candidate.
   */
  unambiguousPairedWhat?: string;
  /** The WHO who established the unambiguous pair, for display attribution. */
  pairedWho?: string;
}

export function resolvePairingContext(
  input: ResolverInput,
): Map<string, DomainPairingContext> {
  const { groups, userContacts, confirmedContactQueries, confirmedDomains } = input;
  const confirmedQueriesSet = new Set(confirmedContactQueries);
  const confirmedDomainsSet = new Set(confirmedDomains);

  // who (by query) → set of paired whats
  const whoPairings = new Map<string, Set<string>>();
  for (const g of groups) {
    for (const who of g.whos) {
      const set = whoPairings.get(who) ?? new Set<string>();
      for (const what of g.whats) set.add(what);
      whoPairings.set(who, set);
    }
  }

  // domain → array of { senderEmail, pairedWhats, pairedWho }
  type Entry = { senderEmail: string; pairedWhats: string[]; pairedWho: string };
  const byDomain = new Map<string, Entry[]>();

  for (const c of userContacts) {
    if (!c.senderEmail || !c.senderDomain) continue;
    if (!confirmedDomainsSet.has(c.senderDomain)) continue;
    if (!confirmedQueriesSet.has(c.query)) continue;
    const pairedWhats = Array.from(whoPairings.get(c.query) ?? []);
    const list = byDomain.get(c.senderDomain) ?? [];
    list.push({
      senderEmail: c.senderEmail.toLowerCase(),
      pairedWhats,
      pairedWho: c.query,
    });
    byDomain.set(c.senderDomain, list);
  }

  // Ensure every confirmed domain appears in the result (with empty arrays
  // when nothing is paired). Lets callers iterate domains uniformly.
  for (const d of confirmedDomains) if (!byDomain.has(d)) byDomain.set(d, []);

  const result = new Map<string, DomainPairingContext>();
  for (const [domain, entries] of byDomain.entries()) {
    const senderEmails = Array.from(new Set(entries.map((e) => e.senderEmail)));
    const pairedWhatsSet = new Set<string>();
    for (const e of entries) for (const w of e.pairedWhats) pairedWhatsSet.add(w);
    const pairedWhats = Array.from(pairedWhatsSet);

    // Unambiguous only when one sender email AND that sender has one paired WHAT.
    let unambiguousPairedWhat: string | undefined;
    let pairedWho: string | undefined;
    if (entries.length === 1 && entries[0].pairedWhats.length === 1) {
      unambiguousPairedWhat = entries[0].pairedWhats[0];
      pairedWho = entries[0].pairedWho;
    }

    result.set(domain, {
      senderEmails,
      pairedWhats,
      ...(unambiguousPairedWhat ? { unambiguousPairedWhat, pairedWho } : {}),
    });
  }

  return result;
}
```

- [ ] **Step 4: Re-run tests, confirm they pass**

Run: `pnpm --filter web vitest run src/lib/discovery/__tests__/paired-who-resolver.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/discovery/paired-who-resolver.ts \
        apps/web/src/lib/discovery/__tests__/paired-who-resolver.test.ts
git commit -m "feat(discovery): #129-step-2 paired-who-resolver for per-domain pairing context"
```

---

## Phase 1 — Layer 2: Public-provider domain scoping

### Task 1.1: Add `confirmedSenderEmails` + public-provider branch to `fetchSubjects`

**Files:**
- Modify: `apps/web/src/lib/discovery/entity-discovery.ts`
- Create: `apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts`

- [ ] **Step 1: Write failing tests for query building**

```typescript
// apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts
import { describe, expect, it, vi } from "vitest";
import type { GmailClient } from "@/lib/gmail/client";
import { discoverEntitiesForDomain } from "../entity-discovery";

/**
 * These tests cover the query-building branches of `fetchSubjects` indirectly
 * through `discoverEntitiesForDomain`. We mock the GmailClient so the test
 * asserts on the exact Gmail query string passed to `listMessageIds`.
 */
function makeClient(): { client: GmailClient; listCalls: string[] } {
  const listCalls: string[] = [];
  const client = {
    listMessageIds: vi.fn(async (q: string) => {
      listCalls.push(q);
      return [];
    }),
    getMessageMetadata: vi.fn(),
  } as unknown as GmailClient;
  return { client, listCalls };
}

describe("discoverEntitiesForDomain — fetchSubjects query building", () => {
  it("uses from:*@domain for corporate domains (unchanged)", async () => {
    const { client, listCalls } = makeClient();
    await discoverEntitiesForDomain({
      gmailClient: client,
      schemaDomain: "school_parent",
      confirmedDomain: "email.teamsnap.com",
    });
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]).toContain("from:*@email.teamsnap.com");
  });

  it("uses from:<specific> for public-provider domains when senders are known", async () => {
    const { client, listCalls } = makeClient();
    await discoverEntitiesForDomain({
      gmailClient: client,
      schemaDomain: "school_parent",
      confirmedDomain: "gmail.com",
      confirmedSenderEmails: ["amy@gmail.com"],
    });
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]).toContain("from:amy@gmail.com");
    expect(listCalls[0]).not.toContain("from:*@gmail.com");
  });

  it("joins multiple senders with OR for public-provider domains", async () => {
    const { client, listCalls } = makeClient();
    await discoverEntitiesForDomain({
      gmailClient: client,
      schemaDomain: "school_parent",
      confirmedDomain: "gmail.com",
      confirmedSenderEmails: ["amy@gmail.com", "jane@gmail.com"],
    });
    expect(listCalls[0]).toContain("(from:amy@gmail.com OR from:jane@gmail.com)");
  });

  it("returns empty result without a Gmail call for public-provider domain with no senders", async () => {
    const { client, listCalls } = makeClient();
    const result = await discoverEntitiesForDomain({
      gmailClient: client,
      schemaDomain: "school_parent",
      confirmedDomain: "gmail.com",
      confirmedSenderEmails: [],
    });
    expect(listCalls).toHaveLength(0);
    expect(result.candidates).toEqual([]);
    expect(result.subjectsScanned).toBe(0);
    expect(result.algorithm).toBe("gemini-subject-pass");
  });
});
```

- [ ] **Step 2: Run tests to confirm baseline failure**

Run: `pnpm --filter web vitest run src/lib/discovery/__tests__/entity-discovery.test.ts`
Expected: all new tests FAIL (current code uses `from:*@gmail.com` unconditionally).

- [ ] **Step 3: Modify `entity-discovery.ts` — add import + input field**

At the top of the file, add the import:

```typescript
import { isPublicProvider } from "./public-providers";
```

In the `DiscoverEntitiesInput` interface, add the new field (directly below the existing `pairedWhoAddresses` block):

```typescript
  /**
   * Layer 2 (#129-step-2): specific sender emails confirmed by the user
   * at this domain. Required when `confirmedDomain` is a public provider
   * (gmail.com, yahoo.com, …) so the Gmail query scopes to those senders
   * rather than `from:*@gmail.com`. Empty array for a public-provider
   * domain → discovery returns zero candidates (no Gmail call).
   */
  confirmedSenderEmails?: string[];
```

- [ ] **Step 4: Rewrite `fetchSubjects` query construction**

Replace the current first line of `fetchSubjects` (the `const q = …` declaration):

```typescript
async function fetchSubjects(
  client: GmailClient,
  confirmedDomain: string,
  confirmedSenderEmails?: string[],
): Promise<{ rows: SubjectRow[]; errorCount: number }> {
  const lookback = `newer_than:${ONBOARDING_TUNABLES.stage1.lookbackDays}d`;
  let q: string;
  if (isPublicProvider(confirmedDomain)) {
    // Public-provider scope: must be specific sender(s), never the whole
    // domain. No senders known = no search (caller can surface "no
    // discoveries" UX for this domain).
    if (!confirmedSenderEmails || confirmedSenderEmails.length === 0) {
      return { rows: [], errorCount: 0 };
    }
    const fromClauses = confirmedSenderEmails.map((e) => `from:${e}`).join(" OR ");
    q = confirmedSenderEmails.length === 1
      ? `${fromClauses} ${lookback}`
      : `(${fromClauses}) ${lookback}`;
  } else {
    q = `from:*@${confirmedDomain} ${lookback}`;
  }
  const ids = await client.listMessageIds(q, ONBOARDING_TUNABLES.stage2.maxMessagesPerDomain);
  // ... rest of existing body unchanged: batch fetch, parse From/Subject,
  // push to rows, return { rows, errorCount }
```

- [ ] **Step 5: Thread the field through `discoverEntitiesForDomain`**

In the exported function, change the opening line from:

```typescript
  const { rows, errorCount } = await fetchSubjects(input.gmailClient, input.confirmedDomain);
```

to:

```typescript
  const { rows, errorCount } = await fetchSubjects(
    input.gmailClient,
    input.confirmedDomain,
    input.confirmedSenderEmails,
  );
```

- [ ] **Step 6: Run unit tests — all should pass now**

Run: `pnpm --filter web vitest run src/lib/discovery/__tests__/entity-discovery.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/discovery/entity-discovery.ts \
        apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts
git commit -m "feat(stage2): #129-step-2 Layer 2 — scope public-provider Gmail query to confirmed senders"
```

### Task 1.2: Wire `confirmedSenderEmails` through the Inngest fan-out

**Files:**
- Modify: `apps/web/src/lib/inngest/entity-discovery-fn.ts`

- [ ] **Step 1: Replace the ad-hoc `userSeedsByDomain` / `pairedWhoAddresses` building with the resolver**

At the top of the file, add the import:

```typescript
import { resolvePairingContext } from "@/lib/discovery/paired-who-resolver";
```

Inside `runEntityDiscovery`, replace the two blocks labeled "#112 Tier 2: user-named contact seeds…" and "#102: resolve Stage 1 per-topic pairings…" with a single call to the resolver, **keeping the downstream `userSeedsByDomain` map for seed prepending**:

```typescript
      // Build per-domain pairing context (#129-step-2). Layer 1/2/3 all read
      // from this map. #112 user-named seeds (SECONDARY entity pre-checks
      // on the review screen) are built from the same data but kept as a
      // distinct map because seeds are prepended to the candidate list
      // after discovery, not passed into discovery.
      const userContacts =
        (schema.stage1UserContacts as Array<{
          query: string;
          matchCount: number;
          senderEmail: string | null;
          senderDomain: string | null;
        }> | null) ?? [];
      const confirmedQueries =
        (schema.stage1ConfirmedUserContactQueries as string[] | null) ?? [];
      const schemaInputs =
        (schema.inputs as { groups?: Array<{ whats: string[]; whos: string[] }> } | null) ?? null;
      const groups = schemaInputs?.groups ?? [];
      const pairingByDomain = resolvePairingContext({
        groups,
        userContacts,
        confirmedContactQueries: confirmedQueries,
        confirmedDomains: confirmed,
      });

      // SECONDARY seeds — one per user-confirmed contact, pre-checked on
      // the review screen. Reuses the same source data as the resolver.
      const userSeedsByDomain = new Map<
        string,
        Array<{
          key: string;
          displayString: string;
          frequency: number;
          autoFixed: boolean;
          meta: Record<string, unknown>;
        }>
      >();
      for (const c of userContacts) {
        if (!confirmedQueries.includes(c.query)) continue;
        if (!c.senderEmail || !c.senderDomain) continue;
        if (!confirmed.includes(c.senderDomain)) continue;
        const bucket = userSeedsByDomain.get(c.senderDomain) ?? [];
        bucket.push({
          key: `@${c.senderEmail.toLowerCase()}`,
          displayString: c.query,
          frequency: c.matchCount,
          autoFixed: false,
          meta: {
            source: "user_named",
            senderEmail: c.senderEmail,
            senderDomain: c.senderDomain,
            kind: "SECONDARY",
          },
        });
        userSeedsByDomain.set(c.senderDomain, bucket);
      }
```

- [ ] **Step 2: Update the fan-out to pass `confirmedSenderEmails`**

Locate the `step.run(\`discover-${slug(confirmedDomain)}\`, …)` block. In the call to `discoverEntitiesForDomain`, pass the new field:

```typescript
              const ctx = pairingByDomain.get(confirmedDomain);
              const r = await discoverEntitiesForDomain({
                gmailClient: gmail,
                schemaDomain: schema.domain as DomainName,
                confirmedDomain,
                pairedWhoAddresses: pairedWhoAddresses.length > 0 ? pairedWhoAddresses : undefined,
                confirmedSenderEmails: ctx?.senderEmails,
                schemaId,
                userId,
              });
```

Note: `pairedWhoAddresses` (the existing array passed to the Gemini prompt as labeling context) stays as-is. The resolver's per-domain map is purely additive.

- [ ] **Step 3: Typecheck + existing tests**

Run: `pnpm typecheck && pnpm --filter web vitest run src/lib/discovery/__tests__/`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/inngest/entity-discovery-fn.ts
git commit -m "refactor(stage2): #129-step-2 wire pairing resolver into Stage 2 fan-out"
```

---

## Phase 2 — Layer 3: Topic-scoped Gmail content filter

### Task 2.1: Add `topicKeywords` input + query builder

**Files:**
- Modify: `apps/web/src/lib/discovery/entity-discovery.ts`
- Modify: `apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts`

- [ ] **Step 1: Append topic-filter tests**

Append to the `describe("discoverEntitiesForDomain — fetchSubjects query building", …)` block:

```typescript
  it("appends topic keyword filter for public-provider + paired WHATs", async () => {
    const { client, listCalls } = makeClient();
    await discoverEntitiesForDomain({
      gmailClient: client,
      schemaDomain: "school_parent",
      confirmedDomain: "gmail.com",
      confirmedSenderEmails: ["amy@gmail.com"],
      topicKeywords: ["lanier", "st agnes", "guitar"],
    });
    const q = listCalls[0];
    expect(q).toContain("from:amy@gmail.com");
    // Each multi-word WHAT must be quoted; single-word WHATs stay bare.
    expect(q).toContain("(lanier OR \"st agnes\" OR guitar)");
  });

  it("appends topic keyword filter for corporate domain + paired WHATs", async () => {
    const { client, listCalls } = makeClient();
    await discoverEntitiesForDomain({
      gmailClient: client,
      schemaDomain: "school_parent",
      confirmedDomain: "stagnes.com",
      topicKeywords: ["lanier", "st agnes"],
    });
    expect(listCalls[0]).toContain("from:*@stagnes.com");
    expect(listCalls[0]).toContain("(lanier OR \"st agnes\")");
  });

  it("skips the topic filter when topicKeywords is empty", async () => {
    const { client, listCalls } = makeClient();
    await discoverEntitiesForDomain({
      gmailClient: client,
      schemaDomain: "school_parent",
      confirmedDomain: "email.teamsnap.com",
      topicKeywords: [],
    });
    expect(listCalls[0]).not.toContain(" OR ");
    expect(listCalls[0]).not.toMatch(/\(/);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Expected: 3 FAIL on missing `topicKeywords` field.

- [ ] **Step 3: Extend `DiscoverEntitiesInput`**

Directly below the `confirmedSenderEmails` field added in Phase 1, add:

```typescript
  /**
   * Layer 3 (#129-step-2): user's WHATs paired to a WHO at this domain.
   * When present and `ONBOARDING_TUNABLES.stage2.useTopicContentFilter` is
   * true, the Gmail query appends `AND (w1 OR "w 2" OR …)` so only subjects
   * mentioning a paired topic come back. Cheaper + more precise than
   * filtering at Gemini's output. Multi-word WHATs are quoted; single-word
   * stay bare.
   */
  topicKeywords?: string[];
```

- [ ] **Step 4: Extend `fetchSubjects` + add a helper**

Add a small helper near the top of the file (alongside `parseSenderEmail`):

```typescript
function formatTopicFilter(keywords: string[]): string {
  // Quote any keyword containing whitespace so Gmail treats it as a phrase.
  // Single-word keywords stay bare (Gmail normalizes case/punctuation).
  const parts = keywords.map((k) => (k.includes(" ") ? `"${k}"` : k));
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}
```

Update `fetchSubjects` signature and body:

```typescript
async function fetchSubjects(
  client: GmailClient,
  confirmedDomain: string,
  confirmedSenderEmails?: string[],
  topicKeywords?: string[],
): Promise<{ rows: SubjectRow[]; errorCount: number }> {
  const lookback = `newer_than:${ONBOARDING_TUNABLES.stage1.lookbackDays}d`;
  let q: string;
  if (isPublicProvider(confirmedDomain)) {
    if (!confirmedSenderEmails || confirmedSenderEmails.length === 0) {
      return { rows: [], errorCount: 0 };
    }
    const fromClauses = confirmedSenderEmails.map((e) => `from:${e}`).join(" OR ");
    q = confirmedSenderEmails.length === 1
      ? `${fromClauses} ${lookback}`
      : `(${fromClauses}) ${lookback}`;
  } else {
    q = `from:*@${confirmedDomain} ${lookback}`;
  }
  if (topicKeywords && topicKeywords.length > 0 && ONBOARDING_TUNABLES.stage2.useTopicContentFilter) {
    q = `${q} ${formatTopicFilter(topicKeywords)}`;
  }
  const ids = await client.listMessageIds(q, ONBOARDING_TUNABLES.stage2.maxMessagesPerDomain);
  // ... rest unchanged
```

- [ ] **Step 5: Thread through `discoverEntitiesForDomain`**

```typescript
  const { rows, errorCount } = await fetchSubjects(
    input.gmailClient,
    input.confirmedDomain,
    input.confirmedSenderEmails,
    input.topicKeywords,
  );
```

- [ ] **Step 6: Re-run tests**

Run: `pnpm --filter web vitest run src/lib/discovery/__tests__/entity-discovery.test.ts`
Expected: PASS (7 tests total now).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/discovery/entity-discovery.ts \
        apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts
git commit -m "feat(stage2): #129-step-2 Layer 3 — topic keyword content filter in Gmail query"
```

### Task 2.2: Thread `topicKeywords` through the Inngest fan-out

**Files:**
- Modify: `apps/web/src/lib/inngest/entity-discovery-fn.ts`

- [ ] **Step 1: Update the fan-out**

Inside the `step.run(\`discover-${slug(confirmedDomain)}\`, …)` block, in the call to `discoverEntitiesForDomain`, add `topicKeywords`:

```typescript
              const ctx = pairingByDomain.get(confirmedDomain);
              const r = await discoverEntitiesForDomain({
                gmailClient: gmail,
                schemaDomain: schema.domain as DomainName,
                confirmedDomain,
                pairedWhoAddresses: pairedWhoAddresses.length > 0 ? pairedWhoAddresses : undefined,
                confirmedSenderEmails: ctx?.senderEmails,
                topicKeywords: ctx?.pairedWhats,
                schemaId,
                userId,
              });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/inngest/entity-discovery-fn.ts
git commit -m "refactor(stage2): #129-step-2 pass topicKeywords into discovery fan-out"
```

---

## Phase 3 — Layer 1: Pairing short-circuit

### Task 3.1: Short-circuit path in `discoverEntitiesForDomain`

**Files:**
- Modify: `apps/web/src/lib/discovery/entity-discovery.ts`
- Modify: `apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts`

- [ ] **Step 1: Add short-circuit tests**

Append a new describe block to the test file:

```typescript
describe("discoverEntitiesForDomain — short-circuit", () => {
  it("skips Gemini and returns one synthetic candidate when a domain has an unambiguous paired WHAT", async () => {
    const { client, listCalls } = makeClient();
    const result = await discoverEntitiesForDomain({
      gmailClient: client,
      schemaDomain: "school_parent",
      confirmedDomain: "email.teamsnap.com",
      unambiguousPairedWhat: "soccer",
      pairedWho: "Ziad Allan",
      confirmedSenderEmails: ["donotreply@email.teamsnap.com"],
    });
    expect(listCalls).toHaveLength(0); // no Gmail call at all
    expect(result.algorithm).toBe("paired-short-circuit");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].displayString).toBe("soccer");
    expect(result.candidates[0].meta?.kind).toBe("PRIMARY");
    expect(result.candidates[0].meta?.relatedWhat).toBe("soccer");
    expect(result.candidates[0].meta?.sourcedFromWho).toBe("Ziad Allan");
    expect(result.candidates[0].meta?.source).toBe("paired_short_circuit");
  });

  it("falls through to Gemini when unambiguousPairedWhat is absent", async () => {
    const { client, listCalls } = makeClient();
    await discoverEntitiesForDomain({
      gmailClient: client,
      schemaDomain: "school_parent",
      confirmedDomain: "gmail.com",
      confirmedSenderEmails: ["amy@gmail.com"],
      topicKeywords: ["lanier"],
    });
    expect(listCalls).toHaveLength(1); // Gemini path took over
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Extend `DiscoverEntitiesInput`**

Directly below `topicKeywords`, add:

```typescript
  /**
   * Layer 1 (#129-step-2): when a confirmed domain unambiguously maps to
   * exactly one paired WHAT (one WHO pairs to one WHAT and owns this
   * domain), skip Gemini entirely and return a single synthetic candidate
   * = the WHAT itself. `pairedWho` provides display attribution on the
   * review screen. Callers determine unambiguity via `paired-who-resolver`.
   */
  unambiguousPairedWhat?: string;
  /** Display name of the WHO whose pairing drove the short-circuit decision. */
  pairedWho?: string;
```

- [ ] **Step 4: Add the short-circuit branch at the top of `discoverEntitiesForDomain`**

Before the `fetchSubjects` call, insert:

```typescript
  // Layer 1 (#129-step-2): paired-and-confirmed triangle short-circuit.
  // When the domain unambiguously maps to one paired WHAT, we already know
  // what to track there — Gemini would just re-extract granular subject
  // fragments. Return the user's own WHAT as a pre-selected PRIMARY
  // candidate, tagged with attribution.
  if (
    ONBOARDING_TUNABLES.stage2.enableShortCircuit &&
    input.unambiguousPairedWhat
  ) {
    return {
      algorithm: "paired-short-circuit",
      candidates: [
        {
          key: normalizeKey(input.unambiguousPairedWhat),
          displayString: input.unambiguousPairedWhat,
          // Frequency unknown without a Gmail call; 0 is a sentinel the UI
          // renders as "(from {pairedWho})" instead of "N emails". Stage 1
          // already showed the count on the domain-confirm row.
          frequency: 0,
          autoFixed: false,
          meta: {
            source: "paired_short_circuit",
            kind: "PRIMARY",
            relatedWhat: input.unambiguousPairedWhat,
            ...(input.pairedWho ? { sourcedFromWho: input.pairedWho } : {}),
          },
        },
      ],
      subjectsScanned: 0,
      errorCount: 0,
    };
  }
```

- [ ] **Step 5: Re-run tests**

Run: `pnpm --filter web vitest run src/lib/discovery/__tests__/entity-discovery.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/discovery/entity-discovery.ts \
        apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts
git commit -m "feat(stage2): #129-step-2 Layer 1 — paired-and-confirmed short-circuit skips Gemini"
```

### Task 3.2: Wire short-circuit inputs through the fan-out

**Files:**
- Modify: `apps/web/src/lib/inngest/entity-discovery-fn.ts`

- [ ] **Step 1: Pass short-circuit fields**

In the fan-out call:

```typescript
              const ctx = pairingByDomain.get(confirmedDomain);
              const r = await discoverEntitiesForDomain({
                gmailClient: gmail,
                schemaDomain: schema.domain as DomainName,
                confirmedDomain,
                pairedWhoAddresses: pairedWhoAddresses.length > 0 ? pairedWhoAddresses : undefined,
                confirmedSenderEmails: ctx?.senderEmails,
                topicKeywords: ctx?.pairedWhats,
                unambiguousPairedWhat: ctx?.unambiguousPairedWhat,
                pairedWho: ctx?.pairedWho,
                schemaId,
                userId,
              });
```

- [ ] **Step 2: Typecheck, all tests**

Run: `pnpm typecheck && pnpm -r test`
Expected: green. Note: this is a good time to run the full web test suite since we've touched the fan-out.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/inngest/entity-discovery-fn.ts
git commit -m "refactor(stage2): #129-step-2 pass short-circuit pairing context into fan-out"
```

---

## Phase 4 — Polling DTO: surface `inputs` + typed meta

### Task 4.1: Type `Stage2DomainCandidateDTO` explicitly + surface `inputs` during entity phase

**Files:**
- Modify: `apps/web/src/lib/services/onboarding-polling.ts`

- [ ] **Step 1: Tighten the DTO**

Replace the existing `Stage2DomainCandidateDTO` definition:

```typescript
export interface Stage2DomainCandidateDTO {
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  /**
   * Kind derived from the Stage 2 extractor. PRIMARY = a case-boundary
   * entity (the WHAT). SECONDARY = a person/contact entity (the WHO).
   * Paired short-circuit (#129-step-2 Layer 1) always returns PRIMARY.
   */
  kind?: "PRIMARY" | "SECONDARY";
  /**
   * The user's WHAT this candidate relates to, when Gemini attributed it
   * or when the short-circuit produced it. Drives the by-topic grouping
   * on the review screen (#129-step-2 Layer 4). Absent = cross-topic or
   * unpaired, rendered in "Also noticed".
   */
  relatedWhat?: string;
  /** The user's WHO whose pairing sourced this candidate. Display-only. */
  sourcedFromWho?: string;
  /**
   * Raw sender email for SECONDARY user-seeded candidates. Rendered as
   * the monospace address on the review row.
   */
  senderEmail?: string;
  /**
   * Provenance tag. Known values:
   *  - "user_named"           — SECONDARY seeded from Stage 1 confirmed contact
   *  - "paired_short_circuit" — PRIMARY synthetic from #129-step-2 Layer 1
   *  - "gemini"               — PRIMARY extracted by the Gemini subject-pass
   */
  source?: string;
  /**
   * Escape hatch for any additional metadata the extractor writes. New
   * UI code should prefer the typed fields above; `meta` kept for
   * backward compat with pre-#129-step-2 stored payloads.
   */
  meta?: Record<string, unknown>;
}
```

- [ ] **Step 2: Update the entity-phase branch to surface `inputs` and flatten meta**

Replace the block that handles `DISCOVERING_ENTITIES` / `AWAITING_ENTITY_CONFIRMATION`:

```typescript
  // Issue #95 Stage 2 — entity discovery running or awaiting user confirm.
  // Surface per-domain candidates for the entity review screen. #129-step-2
  // flattens typed fields off `meta` for the by-topic review UI and exposes
  // `inputs` so the UI can render user WHATs as section headers.
  if (schema.phase === "DISCOVERING_ENTITIES" || schema.phase === "AWAITING_ENTITY_CONFIRMATION") {
    const raw = (schema.stage2Candidates as Stage2PerDomainDTO[] | null) ?? [];
    const stage2Candidates: Stage2PerDomainDTO[] = raw.map((g) => ({
      ...g,
      candidates: g.candidates.map((c) => ({
        ...c,
        kind: (c.meta?.kind as "PRIMARY" | "SECONDARY" | undefined) ?? undefined,
        relatedWhat: (c.meta?.relatedWhat as string | undefined) ?? undefined,
        sourcedFromWho: (c.meta?.sourcedFromWho as string | undefined) ?? undefined,
        senderEmail: (c.meta?.senderEmail as string | undefined) ?? undefined,
        source: (c.meta?.source as string | undefined) ?? undefined,
      })),
    }));
    return {
      ...base,
      phase: schema.phase,
      stage2Candidates,
      ...(schema.inputs ? { inputs: schema.inputs as unknown as InterviewInput } : {}),
    };
  }
```

- [ ] **Step 3: Typecheck + unit tests**

Run: `pnpm typecheck && pnpm --filter web vitest run`
Expected: green. `phase-entity-confirmation.tsx` reads the old `meta` shape today; the typed-fields flattening is backward-compatible because `meta` is preserved.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/services/onboarding-polling.ts
git commit -m "feat(polling): #129-step-2 surface inputs + typed meta fields on Stage 2 candidates"
```

---

## Phase 5 — Layer 4: Review UI grouped by user PRIMARY entity

### Task 5.1: Rewrite `phase-entity-confirmation.tsx` — by-topic grouping with by-domain fallback

**Files:**
- Modify: `apps/web/src/components/onboarding/phase-entity-confirmation.tsx`

- [ ] **Step 1: Replace the top-level component body**

Full replacement for the file. Extracted helpers (`KindBadge`, `CandidateRow`) are reused; top-level layout changes from per-domain sections to per-topic sections.

```typescript
"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  OnboardingPollingResponse,
  Stage2DomainCandidateDTO,
  Stage2PerDomainDTO,
} from "@/lib/services/onboarding-polling";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

/**
 * AWAITING_ENTITY_CONFIRMATION — Stage 2 review checkpoint.
 *
 * Primary grouping: by the user's PRIMARY entities (WHATs) they entered
 * in the interview. Each WHAT is a section header, listing:
 *   - The paired WHO(s), as a contact-style badge
 *   - Entity candidates whose `relatedWhat` matches the section WHAT
 *   - A gentle empty-state when nothing attributed
 *
 * An "Also noticed" section at the bottom holds candidates without a
 * `relatedWhat` (Gemini's cross-topic / unpaired discoveries).
 *
 * Fallback: if `response.inputs.whats` is empty (pre-#117 schemas or a
 * user who skipped pairing entirely), render the legacy by-domain
 * layout so existing in-flight schemas still work.
 *
 * #129-step-2.
 */

type SubmitStatus = "idle" | "submitting" | "error";
type Kind = "PRIMARY" | "SECONDARY";

interface Pick {
  identityKey: string;
  displayLabel: string;
  kind: Kind;
  isUserSeeded: boolean;
}

function kindFor(candidate: Stage2DomainCandidateDTO): Kind {
  const k = candidate.kind ?? (candidate.meta?.kind as Kind | undefined) ?? "PRIMARY";
  return k === "SECONDARY" ? "SECONDARY" : "PRIMARY";
}

function isUserSeeded(candidate: Stage2DomainCandidateDTO): boolean {
  return (candidate.source ?? (candidate.meta?.source as string | undefined)) === "user_named";
}

function relatedWhatOf(candidate: Stage2DomainCandidateDTO): string | null {
  return (candidate.relatedWhat ?? (candidate.meta?.relatedWhat as string | undefined)) ?? null;
}

function sourcedFromOf(candidate: Stage2DomainCandidateDTO): string | null {
  return (candidate.sourcedFromWho ?? (candidate.meta?.sourcedFromWho as string | undefined)) ?? null;
}

export function PhaseEntityConfirmation({ response }: { response: OnboardingPollingResponse }) {
  const groups: Stage2PerDomainDTO[] = useMemo(
    () => response.stage2Candidates ?? [],
    [response.stage2Candidates],
  );
  const userWhats = useMemo(
    () => response.inputs?.whats ?? [],
    [response.inputs?.whats],
  );

  // Flatten all candidates across domains with provenance retained.
  type FlatCandidate = { candidate: Stage2DomainCandidateDTO; domain: string };
  const flat: FlatCandidate[] = useMemo(() => {
    const out: FlatCandidate[] = [];
    for (const g of groups) {
      for (const c of g.candidates) out.push({ candidate: c, domain: g.confirmedDomain });
    }
    return out;
  }, [groups]);

  // Bucket by relatedWhat (case-insensitive match against userWhats).
  const whatLower = useMemo(() => new Map(userWhats.map((w) => [w.toLowerCase(), w])), [userWhats]);
  const byTopic = useMemo(() => {
    const map = new Map<string, FlatCandidate[]>();
    const orphans: FlatCandidate[] = [];
    for (const f of flat) {
      const rw = relatedWhatOf(f.candidate);
      const keyedWhat = rw ? whatLower.get(rw.toLowerCase()) : null;
      if (keyedWhat) {
        const bucket = map.get(keyedWhat) ?? [];
        bucket.push(f);
        map.set(keyedWhat, bucket);
      } else {
        orphans.push(f);
      }
    }
    return { map, orphans };
  }, [flat, whatLower]);

  const hasAnyWhats = userWhats.length > 0;

  // Pre-check: all user-seeded (SECONDARY) candidates + all paired-short-circuit
  // (PRIMARY) candidates. Both are "the user already confirmed intent on Stage 1"
  // signals.
  const [picks, setPicks] = useState<Map<string, Pick>>(() => {
    const initial = new Map<string, Pick>();
    for (const f of flat) {
      const src = f.candidate.source ?? (f.candidate.meta?.source as string | undefined);
      if (src === "user_named" || src === "paired_short_circuit") {
        initial.set(f.candidate.key, {
          identityKey: f.candidate.key,
          displayLabel: f.candidate.displayString,
          kind: kindFor(f.candidate),
          isUserSeeded: src === "user_named",
        });
      }
    }
    return initial;
  });
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Poll updates can add candidates after the initial render (Stage 2 may
  // still be writing mid-poll). Merge new pre-check sources as they appear.
  useEffect(() => {
    setPicks((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const f of flat) {
        const src = f.candidate.source ?? (f.candidate.meta?.source as string | undefined);
        const preCheck = src === "user_named" || src === "paired_short_circuit";
        if (preCheck && !next.has(f.candidate.key)) {
          next.set(f.candidate.key, {
            identityKey: f.candidate.key,
            displayLabel: f.candidate.displayString,
            kind: kindFor(f.candidate),
            isUserSeeded: src === "user_named",
          });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [flat]);

  const toggle = (candidate: Stage2DomainCandidateDTO) => {
    const key = candidate.key;
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else
        next.set(key, {
          identityKey: key,
          displayLabel: labelEdits[key] ?? candidate.displayString,
          kind: kindFor(candidate),
          isUserSeeded: isUserSeeded(candidate),
        });
      return next;
    });
  };

  const editLabel = (identityKey: string, value: string) => {
    setLabelEdits((prev) => ({ ...prev, [identityKey]: value }));
    setPicks((prev) => {
      const existing = prev.get(identityKey);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(identityKey, { ...existing, displayLabel: value });
      return next;
    });
  };

  const submit = async () => {
    if (picks.size === 0) return;
    setStatus("submitting");
    setErrorMessage("");
    try {
      const confirmedEntities = [...picks.values()].map((p) => ({
        displayLabel: p.displayLabel.trim(),
        identityKey: p.identityKey,
        kind: p.kind,
      }));
      const res = await authenticatedFetch(
        `/api/onboarding/${response.schemaId}/entity-confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmedEntities }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Confirm failed (${res.status})`);
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const totalCandidates = flat.length;

  if (totalCandidates === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
          progress_activity
        </span>
        <h1 className="font-serif text-2xl text-primary">Finding what matters to you</h1>
        <p className="text-sm text-muted">Scanning confirmed senders for entities…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl text-primary">Confirm what to track</h1>
      <p className="text-muted text-sm mt-1">
        Your topics are below. Check anything worth tracking and rename anything inline.
      </p>

      <div className="mt-6 flex flex-col gap-8">
        {hasAnyWhats ? (
          <>
            {userWhats.map((what) => (
              <TopicSection
                key={what}
                what={what}
                items={byTopic.map.get(what) ?? []}
                picks={picks}
                labelEdits={labelEdits}
                submitting={status === "submitting"}
                onToggle={toggle}
                onEditLabel={editLabel}
              />
            ))}
            {byTopic.orphans.length > 0 && (
              <OrphansSection
                items={byTopic.orphans}
                picks={picks}
                labelEdits={labelEdits}
                submitting={status === "submitting"}
                onToggle={toggle}
                onEditLabel={editLabel}
              />
            )}
          </>
        ) : (
          // Fallback: no user WHATs known — render legacy by-domain layout.
          groups.map((group) => (
            <DomainGroup
              key={group.confirmedDomain}
              group={group}
              picks={picks}
              labelEdits={labelEdits}
              submitting={status === "submitting"}
              onToggle={toggle}
              onEditLabel={editLabel}
            />
          ))
        )}
      </div>

      {status === "error" && errorMessage && (
        <p className="mt-3 text-sm text-overdue">{errorMessage}</p>
      )}

      <div className="mt-8">
        <Button onClick={submit} disabled={picks.size === 0 || status === "submitting"}>
          {status === "submitting"
            ? "Confirming…"
            : `Confirm ${picks.size} ${picks.size === 1 ? "item" : "items"}`}
        </Button>
      </div>
    </div>
  );
}

function TopicSection({
  what,
  items,
  picks,
  labelEdits,
  submitting,
  onToggle,
  onEditLabel,
}: {
  what: string;
  items: Array<{ candidate: Stage2DomainCandidateDTO; domain: string }>;
  picks: Map<string, Pick>;
  labelEdits: Record<string, string>;
  submitting: boolean;
  onToggle: (c: Stage2DomainCandidateDTO) => void;
  onEditLabel: (identityKey: string, value: string) => void;
}) {
  // Pull the set of sourcedFromWho names for this topic so we can show them
  // as a quiet attribution line under the header.
  const attributions = new Set<string>();
  for (const i of items) {
    const who = sourcedFromOf(i.candidate);
    if (who) attributions.add(who);
  }

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <h2 className="font-serif text-lg text-primary">{what}</h2>
        {attributions.size > 0 && (
          <span className="text-xs text-muted">via {Array.from(attributions).join(", ")}</span>
        )}
      </header>
      {items.length === 0 ? (
        <p className="text-xs text-muted italic bg-surface-mid rounded-sm px-4 py-3">
          We didn't find specific things for {what}. We'll still track emails you flagged as
          related.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map(({ candidate, domain }) => (
            <CandidateRow
              key={`${domain}-${candidate.key}`}
              candidate={candidate}
              picked={picks.has(candidate.key)}
              editedLabel={labelEdits[candidate.key]}
              submitting={submitting}
              onToggle={onToggle}
              onEditLabel={onEditLabel}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function OrphansSection({
  items,
  picks,
  labelEdits,
  submitting,
  onToggle,
  onEditLabel,
}: {
  items: Array<{ candidate: Stage2DomainCandidateDTO; domain: string }>;
  picks: Map<string, Pick>;
  labelEdits: Record<string, string>;
  submitting: boolean;
  onToggle: (c: Stage2DomainCandidateDTO) => void;
  onEditLabel: (identityKey: string, value: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <h2 className="font-serif text-lg text-primary">Also noticed</h2>
        <span className="text-xs text-muted">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </header>
      <p className="text-xs text-muted mb-1">
        Things we found that didn't clearly fit a topic. Add any that matter; ignore the rest.
      </p>
      <ul className="flex flex-col gap-2">
        {items.map(({ candidate, domain }) => (
          <CandidateRow
            key={`orphan-${domain}-${candidate.key}`}
            candidate={candidate}
            picked={picks.has(candidate.key)}
            editedLabel={labelEdits[candidate.key]}
            submitting={submitting}
            onToggle={onToggle}
            onEditLabel={onEditLabel}
          />
        ))}
      </ul>
    </section>
  );
}

// --- Legacy by-domain fallback (unchanged shape, kept for fallback path) ----

function DomainGroup({
  group,
  picks,
  labelEdits,
  submitting,
  onToggle,
  onEditLabel,
}: {
  group: Stage2PerDomainDTO;
  picks: Map<string, Pick>;
  labelEdits: Record<string, string>;
  submitting: boolean;
  onToggle: (c: Stage2DomainCandidateDTO) => void;
  onEditLabel: (identityKey: string, value: string) => void;
}) {
  const hasCandidates = group.candidates.length > 0;
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-primary">
          Inside <span className="font-mono text-accent-text">{group.confirmedDomain}</span>
        </h2>
        {hasCandidates && (
          <span className="text-xs text-muted">
            {group.candidates.length} item{group.candidates.length === 1 ? "" : "s"}
          </span>
        )}
      </header>
      {!hasCandidates ? (
        <p className="text-xs text-muted italic bg-surface-mid rounded-sm px-4 py-3">
          We didn't find specific things inside {group.confirmedDomain}. Denim will still track the
          domain as a whole.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {group.candidates.map((candidate) => (
            <CandidateRow
              key={`${group.confirmedDomain}-${candidate.key}`}
              candidate={candidate}
              picked={picks.has(candidate.key)}
              editedLabel={labelEdits[candidate.key]}
              submitting={submitting}
              onToggle={onToggle}
              onEditLabel={onEditLabel}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CandidateRow({
  candidate,
  picked,
  editedLabel,
  submitting,
  onToggle,
  onEditLabel,
}: {
  candidate: Stage2DomainCandidateDTO;
  picked: boolean;
  editedLabel: string | undefined;
  submitting: boolean;
  onToggle: (c: Stage2DomainCandidateDTO) => void;
  onEditLabel: (identityKey: string, value: string) => void;
}) {
  const kind = kindFor(candidate);
  const userSeeded = isUserSeeded(candidate);
  const isShortCircuit =
    (candidate.source ?? (candidate.meta?.source as string | undefined)) === "paired_short_circuit";
  const inputValue = editedLabel ?? candidate.displayString;
  const senderEmail = candidate.senderEmail ?? (candidate.meta?.senderEmail as string | undefined) ?? null;
  const sourcedFromWho = sourcedFromOf(candidate);
  const frequency = candidate.frequency;

  // Visual treatment: three states — pre-paired (gold), user-seeded (teal-ish),
  // and discovered (neutral).
  const rowBg = isShortCircuit
    ? "bg-accent-soft"
    : userSeeded
      ? "bg-upcoming-soft"
      : "bg-surface-highest";

  return (
    <li className={`flex flex-col gap-1 rounded-sm ${rowBg} px-4 py-3`}>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id={`entity-${candidate.key}`}
          checked={picked}
          onChange={() => onToggle(candidate)}
          disabled={submitting}
          className="h-4 w-4 accent-accent"
        />
        <input
          type="text"
          aria-label={`Name for ${candidate.displayString}`}
          value={inputValue}
          onChange={(e) => onEditLabel(candidate.key, e.target.value)}
          disabled={!picked || submitting}
          className="flex-1 bg-transparent text-primary text-sm font-medium border-b border-transparent focus:border-accent focus:outline-none disabled:text-primary"
        />
        <KindBadge kind={kind} />
        {frequency > 0 && (
          <span className="text-xs text-muted whitespace-nowrap">
            {frequency} email{frequency === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {(senderEmail || userSeeded || isShortCircuit || candidate.autoFixed || sourcedFromWho) && (
        <div className="flex items-center gap-2 pl-7 text-xs text-muted">
          {senderEmail && <span className="font-mono">{senderEmail}</span>}
          {isShortCircuit && sourcedFromWho && (
            <span className="text-accent-text font-medium">· confirmed via {sourcedFromWho}</span>
          )}
          {userSeeded && <span className="text-upcoming-text font-medium">· Added by you</span>}
          {candidate.autoFixed && (
            <span className="uppercase tracking-wide text-accent" title="Variants merged">
              · merged
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function KindBadge({ kind }: { kind: Kind }) {
  const label = kind === "PRIMARY" ? "Thing" : "Contact";
  const style =
    kind === "PRIMARY" ? "bg-accent-soft text-accent-text" : "bg-upcoming-soft text-upcoming-text";
  return (
    <span
      className={`text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 ${style}`}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Run existing web tests**

Run: `pnpm --filter web vitest run`
Expected: green. No component tests for this file today; adding below.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/onboarding/phase-entity-confirmation.tsx
git commit -m "feat(onboarding-ui): #129-step-2 Layer 4 — Stage 2 review grouped by user PRIMARY entities"
```

### Task 5.2: Component test covering by-topic, by-domain fallback, and short-circuit row

**Files:**
- Create: `apps/web/src/components/onboarding/__tests__/phase-entity-confirmation.test.tsx`

- [ ] **Step 1: Write the test**

```typescript
// apps/web/src/components/onboarding/__tests__/phase-entity-confirmation.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PhaseEntityConfirmation } from "../phase-entity-confirmation";
import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

// authenticatedFetch is called on submit, not on render. Stub it so the
// import resolves without hitting supabase.
vi.mock("@/lib/supabase/authenticated-fetch", () => ({
  authenticatedFetch: vi.fn(),
}));

function baseResponse(overrides: Partial<OnboardingPollingResponse> = {}): OnboardingPollingResponse {
  return {
    schemaId: "test-schema",
    phase: "AWAITING_ENTITY_CONFIRMATION",
    progress: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("PhaseEntityConfirmation", () => {
  it("groups candidates by user WHATs when inputs.whats is present", () => {
    render(
      <PhaseEntityConfirmation
        response={baseResponse({
          inputs: {
            role: "parent",
            domain: "school_parent",
            whats: ["Soccer", "Lanier"],
            whos: ["Ziad Allan", "Amy DiCarlo"],
            groups: [],
          },
          stage2Candidates: [
            {
              confirmedDomain: "email.teamsnap.com",
              algorithm: "paired-short-circuit",
              candidates: [
                {
                  key: "soccer",
                  displayString: "Soccer",
                  frequency: 0,
                  autoFixed: false,
                  kind: "PRIMARY",
                  relatedWhat: "Soccer",
                  sourcedFromWho: "Ziad Allan",
                  source: "paired_short_circuit",
                },
              ],
            },
            {
              confirmedDomain: "gmail.com",
              algorithm: "gemini-subject-pass",
              candidates: [
                {
                  key: "lanier-middle-school-pto",
                  displayString: "Lanier Middle School PTO",
                  frequency: 3,
                  autoFixed: false,
                  kind: "PRIMARY",
                  relatedWhat: "Lanier",
                  sourcedFromWho: "Amy DiCarlo",
                  source: "gemini",
                },
              ],
            },
          ],
        })}
      />,
    );
    // Topic section headers render as the user's own WHAT strings.
    expect(screen.getByRole("heading", { name: "Soccer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lanier" })).toBeInTheDocument();
    // No by-domain headers leak into the DOM in this path.
    expect(screen.queryByText(/Inside /)).not.toBeInTheDocument();
  });

  it("falls back to by-domain grouping when inputs.whats is empty", () => {
    render(
      <PhaseEntityConfirmation
        response={baseResponse({
          inputs: {
            role: "parent",
            domain: "school_parent",
            whats: [],
            whos: [],
            groups: [],
          },
          stage2Candidates: [
            {
              confirmedDomain: "email.teamsnap.com",
              algorithm: "gemini-subject-pass",
              candidates: [
                {
                  key: "zsa",
                  displayString: "ZSA U11",
                  frequency: 5,
                  autoFixed: false,
                  kind: "PRIMARY",
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Inside/)).toBeInTheDocument();
    expect(screen.getByText("email.teamsnap.com")).toBeInTheDocument();
  });

  it("routes candidates without relatedWhat to the 'Also noticed' section", () => {
    render(
      <PhaseEntityConfirmation
        response={baseResponse({
          inputs: {
            role: "parent",
            domain: "school_parent",
            whats: ["Soccer"],
            whos: ["Ziad Allan"],
            groups: [],
          },
          stage2Candidates: [
            {
              confirmedDomain: "email.teamsnap.com",
              algorithm: "gemini-subject-pass",
              candidates: [
                {
                  key: "orphan-1",
                  displayString: "Mystery Club",
                  frequency: 2,
                  autoFixed: false,
                  kind: "PRIMARY",
                  // relatedWhat intentionally missing
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Also noticed" })).toBeInTheDocument();
    expect(screen.getByText("Mystery Club")).toBeInTheDocument();
  });

  it("shows 'confirmed via <who>' attribution for paired-short-circuit rows", () => {
    render(
      <PhaseEntityConfirmation
        response={baseResponse({
          inputs: {
            role: "parent",
            domain: "school_parent",
            whats: ["Soccer"],
            whos: ["Ziad Allan"],
            groups: [{ whats: ["Soccer"], whos: ["Ziad Allan"] }],
          },
          stage2Candidates: [
            {
              confirmedDomain: "email.teamsnap.com",
              algorithm: "paired-short-circuit",
              candidates: [
                {
                  key: "soccer",
                  displayString: "Soccer",
                  frequency: 0,
                  autoFixed: false,
                  kind: "PRIMARY",
                  relatedWhat: "Soccer",
                  sourcedFromWho: "Ziad Allan",
                  source: "paired_short_circuit",
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/confirmed via Ziad Allan/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter web vitest run src/components/onboarding/__tests__/phase-entity-confirmation.test.tsx`
Expected: PASS (4 tests). If `@testing-library/react` isn't already wired into the vitest config, see `apps/web/vitest.config.ts` and extend `environment` to `jsdom` and include `testing-library/jest-dom` in setup files if not present. Most component tests in this repo live in `tests/` not co-located; if that's the established convention, place this test there instead (follow `apps/web/tests/` structure found at the repo root).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/onboarding/__tests__/phase-entity-confirmation.test.tsx
git commit -m "test(onboarding-ui): #129-step-2 by-topic grouping, by-domain fallback, short-circuit attribution"
```

---

## Phase 6 — E2E validation + rollback runbook

### Task 6.1: Ground-truth validation on real inbox

**Files:** no code changes.

- [ ] **Step 1: Fresh onboarding**

Start a fresh `school_parent` onboarding against the OAuth test account (see `reference_gmail_test_account.md` memory). Interview inputs:

```
role:   parent
whats:  soccer, guitar, dance, st agnes, lanier
whos:   Ziad Allan, Amy DiCarlo
groups: { whats: [soccer],                       whos: [Ziad Allan]    }
        { whats: [lanier, st agnes, guitar],     whos: [Amy DiCarlo]   }
```

Walk to Stage 1 review and confirm defaults.

- [ ] **Step 2: Inspect the structured logs**

Tail `/tmp/web.log` and grep for the Stage 2 entity discovery entries. Expected two signals:

```
stage2.subject-entity-pass.complete       confirmedDomain=email.teamsnap.com   -- MUST NOT appear (short-circuit)
stage2.subject-entity-pass.complete       confirmedDomain=gmail.com            -- subjectsScanned < 40 (topic filter tight)
```

If `email.teamsnap.com` still fires a Gemini call, short-circuit didn't fire → check the resolver output by re-running the integration against a mocked schema row.

- [ ] **Step 3: Verify the review screen visually**

The review screen should now render:
- Header: "Confirm what to track"
- Section "Soccer" — one row "Soccer" (pre-checked, gold background, "confirmed via Ziad Allan")
- Section "Lanier" — rows only if Gemini found Lanier-related entities in Amy's emails; otherwise the empty-state line
- Section "St Agnes", "Guitar" — similar
- Section "Dance" — likely empty (no paired WHO)
- Section "Also noticed" — anything orphaned; should be small or zero

Confirm: no "Inside email.teamsnap.com" header anywhere. No granular ZSA sub-team entities. No Co-Op / Control Surface / Exterior Cleaning entities.

- [ ] **Step 4: DB forensics**

Using the `supabase-db` skill, inspect the resulting schema:

```sql
SELECT id, "stage2ConfirmedDomains", "stage2Candidates"
FROM case_schemas
WHERE id = '<new-schema-id>';
```

- `stage2Candidates[].candidates[].meta.source` values must include `"paired_short_circuit"` for the TeamSnap entry.
- `stage2Candidates[].candidates[].meta.relatedWhat` must be populated on every candidate that landed under a "Your Topics" section.

- [ ] **Step 5: Confirm the scan**

Click Confirm, let the pipeline run to completion. Check that the final cases in `/feed` are:
- A single case (or a small number) scoped to the `Soccer` PRIMARY
- Additional cases scoped to `Lanier`, `St Agnes`, `Guitar` as applicable

Absence of `ZSA U11 Girls FALL Competitive Rise` as a PRIMARY entity is the pass signal.

### Task 6.2: Property regression

- [ ] **Step 1: Run a property-domain onboarding**

Same steps as Task 6.1 but with `domain: property` and a property-specific input set (see `reference_stage_validator.md` for ground-truth). `groups` stays empty (property users typically don't pair WHOs to WHATs).

- [ ] **Step 2: Verify fallback**

Because `inputs.groups` is empty and no unambiguous pairings exist, Layer 1 (short-circuit) won't fire. Layer 3 (topic filter) won't fire (no paired WHATs). Layer 2 (public-provider scoping) still applies — confirm that a `gmail.com` domain, if confirmed via a user-contact like Krystin Jernigan, queries `from:krystin@gmail.com` not `from:*@gmail.com`.

- [ ] **Step 3: Review screen**

With `inputs.whats` being the long address list, the UI will render one section per address. This is arguably less useful for property users — flag as a follow-up improvement (not a regression; today's UI also renders 10+ sections, just by domain).

### Task 6.3: Rollback runbook

**Files:**
- Modify: `docs/00_denim_current_status.md` (add a session block documenting this change)

- [ ] **Step 1: Write runbook section**

Append to `docs/00_denim_current_status.md` under a new session heading `## 2026-04-22 — #129 Step 2 Hints Narrow + Topic Review`:

```markdown
### Rollback

Per-layer toggles (all in `apps/web/src/lib/config/onboarding-tunables.ts`):

- `stage2.enableShortCircuit = false` → Layer 1 off (Gemini runs on paired-unambiguous domains again)
- `stage2.useTopicContentFilter = false` → Layer 3 off (Gmail query drops the `AND (what1 OR …)` clause)
- Layer 2 (public-provider scoping) has no toggle — it's a correctness fix; rollback = `git revert`.
- Layer 4 UI falls back to by-domain automatically when `inputs.whats` is empty; no toggle needed.

Full code revert: `git revert <commit-range>` on `feature/perf-quality-sprint`.

### Verification evidence

After Task 6.1 completes, paste:
- The structured log line(s) for each Stage 2 domain (algorithm + subjectsScanned).
- The DB dump of `stage2Candidates` showing `meta.source` values.
- A screenshot or note confirming the review screen renders Your Topics as section headers.
```

- [ ] **Step 2: Commit**

```bash
git add docs/00_denim_current_status.md
git commit -m "docs(status): #129-step-2 rollback runbook + verification record"
```

- [ ] **Step 3: Close out**

```bash
git log --oneline HEAD~16..HEAD
```

Expected: roughly 12–16 commits on `feature/perf-quality-sprint`, one per task plus commits from the test-first cycles. Review the list; amend or squash if any are empty / purely mechanical.

---

## Backward compatibility

- **In-flight schemas at `DISCOVERING_ENTITIES` / `AWAITING_ENTITY_CONFIRMATION`** when this lands: the polling DTO still surfaces `stage2Candidates`; the UI either renders by-topic (if `inputs.whats` is populated, which is the #127-plus shape) or falls back to by-domain. Either path produces a working review screen.
- **Stored `stage2Candidates` without typed meta**: the polling DTO flattening reads fields off `meta` if the top-level fields are undefined. No migration required.
- **Deprecated `meta` key**: we still write it from the entity-discovery code (the mapEntity helper persists pattern/kind/aliases/sourcedFromWho/relatedWhat under `meta`). New UI reads the flattened fields; old UI (if any persists) would keep reading `meta`. Zero-risk dual-path.
- **Schema phase enum**: no changes. No migration.
- **API routes**: `domain-confirm` and `entity-confirm` unchanged in signature.
- **Inngest events**: `onboarding.entity-discovery.requested` + `onboarding.review.confirmed` unchanged.

---

## Test impact summary

### New tests

- `apps/web/src/lib/discovery/__tests__/paired-who-resolver.test.ts` — 7 cases.
- `apps/web/src/lib/discovery/__tests__/entity-discovery.test.ts` — 9 cases across query-build + short-circuit describes.
- `apps/web/src/components/onboarding/__tests__/phase-entity-confirmation.test.tsx` — 4 cases.

### Existing tests unaffected

- All `packages/types`, `packages/engine`, `packages/ai` tests — zero touched code.
- `apps/web/src/lib/discovery/__tests__/public-providers.test.ts` — stays as-is.
- `apps/web/src/lib/discovery/__tests__/user-hints-discovery.test.ts` — Stage 1 only, unchanged.
- `apps/web/src/lib/inngest/entity-discovery-fn.ts` tests — none today; the fan-out is covered by integration tests only.

### Integration tests

- Existing Stage 2 integration tests: see `apps/web/tests/integration/`. None today exercise the pairing resolution end-to-end against a mocked Gmail client. Consider adding one as a follow-up but not gating.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Layer 3 content filter excludes too aggressively, misses a paired-topic email Gemini should have seen | Medium | Tunable off via `useTopicContentFilter=false`; revert path clean. Mid-scan entity discovery (#76) catches misses downstream. |
| Short-circuit fires on a domain where it shouldn't (e.g., a TeamSnap account shared across two teams) | Low | Unambiguity requires exactly ONE sender at the domain AND exactly ONE paired WHAT. Multi-team covered by falling through to Gemini. |
| Review UI by-topic layout feels worse for property users with 11 address WHATs | Medium | Fallback to by-domain when `inputs.whats` is empty; property users typically don't pair, so fallback path matches their existing UX. Flagged as follow-up. |
| Gmail query with OR'd content terms exceeds length or syntax limits | Low | Gmail's search supports long OR chains; `topicKeywords` comes from user-typed WHATs (typically < 10, total query < 200 chars). |
| Polling DTO flattening introduces a subtle shape drift downstream (e.g., another consumer reading `meta` vs top-level) | Low | Both `meta` and flattened fields remain populated. Only the new by-topic component reads the flattened fields. |
| `phase-entity-confirmation.test.tsx` vitest setup not matching codebase convention | Medium | If `@testing-library/react` isn't wired, skip component test (Task 5.2) and rely on manual E2E (Task 6.1) for Layer 4 validation. File the setup as a follow-up. |

---

## Self-review — spec coverage check

- **Layer 1 (short-circuit):** covered by Task 3.1 + 3.2 + test at Task 3.1 Step 1 + E2E verification in 6.1 Step 2.
- **Layer 2 (public-provider scoping):** covered by Task 1.1 + 1.2 + tests in 1.1 Step 1.
- **Layer 3 (topic content filter):** covered by Task 2.1 + 2.2 + tests in 2.1 Step 1.
- **Layer 4 (by-topic review):** covered by Task 5.1 + 5.2 + tests in 5.2 Step 1.
- **Backward compat for in-flight schemas:** covered by fallback path in Task 5.1 (`hasAnyWhats` branch) + polling DTO backward-read at Task 4.1 Step 2.
- **Tunable rollback for each layer:** covered by Task 0.1 (toggles) + runbook at 6.3.
- **Live E2E validation:** Task 6.1 + 6.2.

No placeholders in the task bodies. All code blocks complete. Type consistency: `DomainPairingContext.senderEmails` / `.pairedWhats` / `.unambiguousPairedWhat` / `.pairedWho` used identically everywhere. `Stage2DomainCandidateDTO` flattened fields — `kind`, `relatedWhat`, `sourcedFromWho`, `senderEmail`, `source` — match across polling + UI reads.
