/**
 * Resolve the per-domain pairing context for Stage 2 entity discovery
 * (2026-04-22 plan, Phase 0 foundation).
 *
 * Stage 2 runs one `discoverEntitiesForDomain` fan-out per confirmed
 * domain. Each fan-out needs to know:
 *   - **`senderEmails[]`** — the specific sender addresses the user
 *     confirmed at this domain. Used by Layer 2 to scope a public-provider
 *     Gmail query to `from:amy@gmail.com` instead of `from:*@gmail.com`.
 *   - **`pairedWhats[]`** — the user's WHATs paired to any confirmed WHO
 *     at this domain. Used by Layer 3 (`AND (what1 OR "what 2" OR ...)`
 *     content filter appended to the `from:` query).
 *   - **`unambiguousPairedWhat`** — set only when one sender + one paired
 *     WHAT at this domain. Used by Layer 1 to short-circuit Gemini and
 *     emit a single synthetic PRIMARY = that WHAT, per school_parent.md §8.
 *   - **`pairedWho`** — the WHO who established the unambiguous pair,
 *     carried through for UI attribution.
 *
 * Pure function. All inputs come from the already-loaded schema row; no
 * DB reads, no Gmail, no AI.
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
  groups: ReadonlyArray<EntityGroup>;
  /** `schema.stage1UserContacts ?? []`. */
  userContacts: ReadonlyArray<UserContactRecord>;
  /** `schema.stage1ConfirmedUserContactQueries ?? []`. */
  confirmedContactQueries: ReadonlyArray<string>;
  /** `schema.stage2ConfirmedDomains ?? []`. */
  confirmedDomains: ReadonlyArray<string>;
}

export interface DomainPairingContext {
  /** Sender emails the user confirmed at this domain. Used for
   *  public-provider query scoping (Layer 2). */
  senderEmails: string[];
  /** Unique paired WHATs across all confirmed WHOs at this domain. Used
   *  for the topic content filter (Layer 3). */
  pairedWhats: string[];
  /**
   * Set only when:
   *  - exactly one sender email is confirmed at this domain, AND
   *  - that sender's pairedWhats has exactly one entry.
   * When set, the caller short-circuits Gemini and emits one synthetic
   * PRIMARY candidate = `unambiguousPairedWhat` (Layer 1).
   */
  unambiguousPairedWhat?: string;
  /** WHO who established the unambiguous pair, for UI attribution. */
  pairedWho?: string;
  /**
   * Phase 5 — `matchCount` from `stage1UserContacts` for the single
   * paired WHO when `unambiguousPairedWhat` is set. Used as the
   * short-circuit synthetic's `frequency` so the review UI shows the
   * truthful "N emails" instead of a misleading "0 emails".
   */
  pairedWhoMatchCount?: number;
  /**
   * Phase 5 — sum of `matchCount` across every confirmed WHO at this
   * domain. Used as the agency-domain-derive synthetic's `frequency`
   * (multi-WHO domains where `unambiguousPairedWhat` is unset).
   */
  confirmedSenderTotalMatches: number;
}

export function resolvePairingContext(input: ResolverInput): Map<string, DomainPairingContext> {
  const confirmedQueriesSet = new Set(input.confirmedContactQueries);
  const confirmedDomainsSet = new Set(input.confirmedDomains);

  // who (by query) → set of paired whats
  const whoPairings = new Map<string, Set<string>>();
  for (const g of input.groups) {
    for (const who of g.whos) {
      const set = whoPairings.get(who) ?? new Set<string>();
      for (const what of g.whats) set.add(what);
      whoPairings.set(who, set);
    }
  }

  // domain → array of entries
  type Entry = {
    senderEmail: string;
    pairedWhats: string[];
    pairedWho: string;
    matchCount: number;
  };
  const byDomain = new Map<string, Entry[]>();

  for (const c of input.userContacts) {
    if (!c.senderEmail || !c.senderDomain) continue;
    if (!confirmedDomainsSet.has(c.senderDomain)) continue;
    if (!confirmedQueriesSet.has(c.query)) continue;
    const pairedWhats = Array.from(whoPairings.get(c.query) ?? []);
    const list = byDomain.get(c.senderDomain) ?? [];
    list.push({
      senderEmail: c.senderEmail.toLowerCase(),
      pairedWhats,
      pairedWho: c.query,
      matchCount: c.matchCount,
    });
    byDomain.set(c.senderDomain, list);
  }

  // Ensure every confirmed domain appears in the result (with empty arrays
  // when nothing paired). Lets callers iterate all domains uniformly.
  for (const d of input.confirmedDomains) if (!byDomain.has(d)) byDomain.set(d, []);

  const result = new Map<string, DomainPairingContext>();
  for (const [domain, entries] of byDomain.entries()) {
    const senderEmails = Array.from(new Set(entries.map((e) => e.senderEmail)));
    const pairedWhatsSet = new Set<string>();
    for (const e of entries) for (const w of e.pairedWhats) pairedWhatsSet.add(w);
    const pairedWhats = Array.from(pairedWhatsSet);
    const confirmedSenderTotalMatches = entries.reduce((n, e) => n + (e.matchCount || 0), 0);

    // Unambiguous short-circuit: one sender AND that sender has one paired WHAT.
    let unambiguousPairedWhat: string | undefined;
    let pairedWho: string | undefined;
    let pairedWhoMatchCount: number | undefined;
    if (entries.length === 1 && entries[0].pairedWhats.length === 1) {
      unambiguousPairedWhat = entries[0].pairedWhats[0];
      pairedWho = entries[0].pairedWho;
      pairedWhoMatchCount = entries[0].matchCount;
    }

    const ctx: DomainPairingContext = {
      senderEmails,
      pairedWhats,
      confirmedSenderTotalMatches,
    };
    if (unambiguousPairedWhat) {
      ctx.unambiguousPairedWhat = unambiguousPairedWhat;
      ctx.pairedWho = pairedWho;
      ctx.pairedWhoMatchCount = pairedWhoMatchCount;
    }
    result.set(domain, ctx);
  }

  return result;
}
