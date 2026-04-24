/**
 * Stage 2 entity discovery — Gemini subject-pass (issue #129).
 *
 * Replaces the Pattern A/B/C regex mining (deleted in the same commit) with
 * a single Gemini Flash 2.5 call per confirmed domain. Semantic extraction
 * on subjects is strictly better than n-gram counting: Gemini gets status-
 * verb stripping (TeamSnap "Updated X", "Canceled X"), cross-season merge
 * ("FALL 2025" + "Spring 2026" same team), and substring suppression for
 * free — it understands subjects as language, not as ngrams.
 *
 * The public surface (`DiscoverEntitiesInput` / `DiscoverEntitiesOutput` /
 * `discoverEntitiesForDomain`) is preserved verbatim so
 * `entity-discovery-fn.ts` needs zero changes. Only `algorithm` changes —
 * from "property-address" | "school-two-pattern" | "agency-domain-derive"
 * to the single value "gemini-subject-pass".
 *
 * Mid-scan PRIMARY creation (#76) remains the fallback for entities the
 * subject pass misses. Subjects are strictly less context than bodies; the
 * scan reads bodies and any entity passing the trust gate gets upserted.
 */

import { isPublicProvider, scoreEntityCandidates } from "@denim/engine";
import { z } from "zod";
import { callGemini } from "@/lib/ai/client";
import type { DomainName } from "@/lib/config/domain-shapes";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import type { GmailClientLike } from "@/lib/gmail/types";
import { logger } from "@/lib/logger";

const GEMINI_MODEL = "gemini-2.5-flash";

export interface DiscoverEntitiesInput {
  gmailClient: GmailClientLike;
  schemaDomain: DomainName;
  confirmedDomain: string;
  /**
   * #117 paired-WHO context from Stage 1. When present, threaded into the
   * prompt so Gemini can attribute entities back to the user's named WHO
   * for downstream `sourcedFromWho` / `relatedWhat` routing. Empty when
   * the schema has no `groups[]` (property / unpaired flows).
   */
  pairedWhoAddresses?: Array<{
    senderEmail: string;
    pairedWhat: string;
    pairedWho: string;
  }>;
  /**
   * 04-22 Layer 2 — specific sender emails confirmed at this domain.
   * Required when `confirmedDomain` is a public provider (gmail.com etc.)
   * so the Gmail query scopes to `from:<specific>` rather than
   * `from:*@<domain>`. Empty array on a public-provider domain → zero-cost
   * skip (no Gmail call, zero candidates).
   */
  confirmedSenderEmails?: ReadonlyArray<string>;
  /**
   * 04-22 Layer 3 — paired WHATs at this domain. When non-empty, appended
   * to the Gmail query as `AND (what1 OR "what 2" OR ...)` so Gmail narrows
   * the subject corpus before Gemini sees it.
   */
  topicKeywords?: ReadonlyArray<string>;
  /**
   * 04-22 Layer 1 — when exactly one sender + one paired WHAT at this
   * domain, short-circuit: skip Gemini and emit a single synthetic
   * PRIMARY candidate = this WHAT (per school_parent.md §8).
   */
  unambiguousPairedWhat?: string;
  /** WHO who established the unambiguous pair (Layer 1). UI attribution. */
  pairedWho?: string;
  /** Phase 5 — matchCount for the single paired WHO (short-circuit path).
   *  Used as the synthetic's `frequency` so the review UI shows "N emails"
   *  rather than "0 emails". */
  pairedWhoMatchCount?: number;
  /** Phase 5 — sum of matchCounts across all confirmed WHOs at this domain
   *  (agency-domain-derive path). Used as that synthetic's `frequency`. */
  confirmedSenderTotalMatches?: number;
  /** User-entered WHATs for this schema — used by the post-Gemini scorer
   *  to award `hint_token_match` points to candidates whose names overlap. */
  userWhats?: ReadonlyArray<string>;
  /** Confirmed-WHO sender emails across all domains — the scorer awards
   *  `confirmed_who_sender` points to any candidate whose key encodes one
   *  of these addresses. */
  confirmedWhoEmails?: ReadonlyArray<string>;
  /** Optional — threaded into structured AI-client logging for traceability. */
  schemaId?: string;
  userId?: string;
}

export interface EntityCandidate {
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  meta?: Record<string, unknown>;
}

export interface DiscoverEntitiesOutput {
  algorithm: string;
  candidates: EntityCandidate[];
  subjectsScanned: number;
  errorCount: number;
}

/**
 * Gemini response shape. Validated at the trust boundary before we map to
 * EntityCandidate; a malformed response falls through to an empty-candidate
 * result plus an errorCount bump, never crashes the whole Stage 2 run.
 */
const GeminiEntitySchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["team", "property", "project", "person", "account", "other"]).default("other"),
  approximate_count: z.number().int().min(1),
  aliases: z.array(z.string()).default([]),
  // Gemini sometimes returns `null` (not omitted) for these optional paired
  // fields. `.optional()` alone rejects `null`; allow both absent and null.
  sourced_from_who: z.string().nullable().optional(),
  related_what: z.string().nullable().optional(),
});

const GeminiResponseSchema = z.object({
  entities: z.array(GeminiEntitySchema).max(50),
});

type GeminiEntity = z.infer<typeof GeminiEntitySchema>;

interface SubjectRow {
  subject: string;
  senderEmail: string;
}

function parseSenderEmail(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = fromHeader.match(/[^\s<>]+@[^\s<>]+/);
  return bare ? bare[0].toLowerCase() : "";
}

/**
 * Build the Stage 2 Gmail search query.
 *
 * - For non-public-provider domains: `from:*@<domain>`.
 * - For public-provider domains: `(from:sender1 OR from:sender2 ...)` using
 *   `confirmedSenderEmails`. If the list is empty the caller zero-cost
 *   skips — see `discoverEntitiesForDomain`.
 * - Always appends `-category:promotions newer_than:Nd` to reject marketing
 *   blasts without requiring a separate veto pass.
 * - When `topicKeywords` are supplied (Layer 3), appends
 *   `AND (word1 OR "two words" ...)` to content-filter before Gemini.
 */
function buildStage2Query(
  confirmedDomain: string,
  confirmedSenderEmails: ReadonlyArray<string>,
  topicKeywords: ReadonlyArray<string>,
): string {
  const senderClause = isPublicProvider(confirmedDomain)
    ? confirmedSenderEmails.length === 1
      ? `from:${confirmedSenderEmails[0]}`
      : `(${confirmedSenderEmails.map((e) => `from:${e}`).join(" OR ")})`
    : `from:*@${confirmedDomain}`;
  const base = `${senderClause} -category:promotions newer_than:${ONBOARDING_TUNABLES.stage1.lookbackDays}d`;
  if (topicKeywords.length === 0) return base;
  const keywords = topicKeywords.map((k) => (k.includes(" ") ? `"${k}"` : k)).join(" OR ");
  return `${base} (${keywords})`;
}

async function fetchSubjects(
  client: GmailClientLike,
  query: string,
): Promise<{ rows: SubjectRow[]; errorCount: number; droppedUnsubscribe: number }> {
  const ids = await client.listMessageIds(query, ONBOARDING_TUNABLES.stage2.maxMessagesPerDomain);
  const rows: SubjectRow[] = [];
  let errorCount = 0;
  let droppedUnsubscribe = 0;
  const batchSize = ONBOARDING_TUNABLES.stage1.fetchBatchSize;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const fetched = await Promise.all(
      batch.map(async (id) => {
        try {
          return await client.getMessageMetadata(id, ["Subject", "From", "List-Unsubscribe"]);
        } catch {
          errorCount++;
          return null;
        }
      }),
    );
    for (const row of fetched) {
      if (!row) continue;
      const headers = row.payload.headers;
      const s = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const f = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      const u = headers.find((h) => h.name.toLowerCase() === "list-unsubscribe")?.value ?? "";
      // Drop messages carrying List-Unsubscribe — they volunteer the
      // "newsletter / bulk mail" signal. Keeps newsletter subjects out of
      // Gemini even when they slip past the `-category:promotions` gate.
      if (u) {
        droppedUnsubscribe++;
        continue;
      }
      if (s) rows.push({ subject: s, senderEmail: parseSenderEmail(f) });
    }
  }
  return { rows, errorCount, droppedUnsubscribe };
}

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Agency-domain-derive (agency.md §4 step 2b): strip TLD, split on hyphens,
 * title-case each segment. Keeps acronyms uppercase when all letters are
 * already uppercase in the segment (e.g. `sghgroup.com` → `Sghgroup`; handled
 * by the common case since the raw domain is usually lowercase — the user
 * corrects at the review screen when needed per spec §4 step 3).
 */
function deriveAgencyDisplayName(domain: string): string {
  const host = domain.toLowerCase();
  // Strip TLD conservatively — take everything before the last dot.
  const lastDot = host.lastIndexOf(".");
  const core = lastDot > 0 ? host.slice(0, lastDot) : host;
  // Collapse subdomains — agency domains are usually second-level only
  // (portfolioproadvisors.com, stallionis.com). If the user's client ran
  // mail through a subdomain (mail.anthropic.com) we prefer the second
  // level; the review screen lets the user edit the label.
  const parts = core.split(".");
  const baseSegment = parts[parts.length - 1] ?? core;
  // Split on hyphens then title-case. `portfolio-pro-advisors` →
  // `Portfolio Pro Advisors`.
  return baseSegment
    .split("-")
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function buildPrompt(
  confirmedDomain: string,
  schemaDomain: string,
  rows: SubjectRow[],
  pairedWhoAddresses?: DiscoverEntitiesInput["pairedWhoAddresses"],
  userHints?: {
    whats: ReadonlyArray<string>;
    pairedWhats: ReadonlyArray<string>;
  },
): { system: string; user: string } {
  const system =
    "You extract distinct real-world entities from email subject lines. Users will pick from your output to tell us what to track in their inbox. False positives (entities that don't really exist, platform boilerplate, newsletter titles, SaaS product names, marketing campaigns) hurt more than false negatives. Be conservative when a candidate is ambiguous. Engagements (dated events, specific projects, meeting series) are CASES, not entities — do not surface them.";

  const pairingNote =
    pairedWhoAddresses && pairedWhoAddresses.length > 0
      ? `\nPaired context — the user said these senders relate to these topics:\n${pairedWhoAddresses
          .map((p) => `  - ${p.pairedWho} (${p.senderEmail}) -> "${p.pairedWhat}"`)
          .join("\n")}\n`
      : "";

  const hintNote =
    userHints && (userHints.whats.length > 0 || userHints.pairedWhats.length > 0)
      ? `\nUser hints — WHAT the user said they want tracked:\n  ${[
          ...userHints.whats,
          ...userHints.pairedWhats,
        ]
          .filter((s, i, a) => a.indexOf(s) === i)
          .map((w) => `"${w}"`)
          .join(
            ", ",
          )}\nPrefer entities that align with these or their paired-WHO senders. Reject entities that clearly belong to an unrelated topic.\n`
      : "";

  // Cap the corpus sent to Gemini to stay in token budget even for very
  // chatty domains. 500 subjects is plenty for distinct-entity extraction
  // and keeps input <= ~20k tokens at typical subject lengths.
  const capped = rows.slice(0, 500);
  const subjectList = capped.map((r, i) => `${i + 1}. [${r.senderEmail}] ${r.subject}`).join("\n");

  const user = `Schema domain type: ${schemaDomain}
Sender domain: ${confirmedDomain}${pairingNote}${hintNote}

Email subjects (with sender):
${subjectList}

Extract the distinct real-world entities these emails reference. An entity is a thing the user would track — a team, a property, a project topic, a client, a person, an account. It is NOT:
  - a status verb (Updated, Canceled, New game, Reminder, Event Reminder)
  - a seasonal or date descriptor (FALL 2025, Spring 2026, October, 2026)
  - a platform label, section header, or SaaS product/feature name (GitHub, Twilio, Stripe, FloSports, Copilot, Slack)
  - a newsletter/digest title or marketing campaign name
  - a billing/account/credit-card notification subject
  - a usage-policy, retention-policy, terms-of-service, or legal-boilerplate phrase
  - a single-word common noun (Nick, PPA, Stallion, Soccer) — those repeat across many emails and do not distinguish
  - an engagement, meeting series, or specific project ("KPI Dashboard Dreamlist", "AI Session #2", "Rhodes Data Test Sample", "V7 Update"). These are CASES, not entities — skip them entirely.

For each entity, return:
  name:              canonical form. Strip status verbs. Strip seasonal/date descriptors. Prefer the most specific non-ephemeral form.
  kind:              "team" | "property" | "project" | "person" | "account" | "other"
  approximate_count: rough number of subjects referring to this entity
  aliases:           variants that refer to the same entity (seasonal / status variants) — merge them
  sourced_from_who (optional): if the entity clearly belongs to a paired WHO from the context above, their name
  related_what    (optional): if it clearly relates to one of the paired WHATs above, that topic

Rules:
  1. If entity A is a strict substring of entity B and freq(A) <= freq(B), drop A. Longest meaningful form wins.
  2. Low-frequency entities ARE valid if they look like distinct real-world things the user would track (a specific property address, a specific company name, a specific project topic). Do not drop single-email entities just because they're single-email — but do drop single-email engagements/meetings/campaigns.
  3. Max 30 entities. Quality over quantity.
  4. No duplicates.

Respond with PURE JSON, no prose, no markdown fences: {"entities": [ ... ]}.`;

  return { system, user };
}

function extractJsonPayload(raw: string): string {
  // Gemini occasionally wraps in ```json ... ``` despite the explicit
  // "no markdown" instruction. Strip fences before parsing.
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return trimmed;
}

function mapEntity(e: GeminiEntity): EntityCandidate {
  return {
    key: normalizeKey(e.name),
    displayString: e.name,
    frequency: e.approximate_count,
    autoFixed: false,
    meta: {
      pattern: "gemini",
      kind: e.kind,
      ...(e.aliases.length > 0 ? { aliases: e.aliases } : {}),
      ...(e.sourced_from_who ? { sourcedFromWho: e.sourced_from_who } : {}),
      ...(e.related_what ? { relatedWhat: e.related_what } : {}),
    },
  };
}

function deduplicateByKey(candidates: EntityCandidate[]): EntityCandidate[] {
  // Defensive: Gemini usually honors "no duplicates" but the normalizeKey
  // transform can collapse two distinct names to the same key. Higher-count
  // wins on collision.
  const byKey = new Map<string, EntityCandidate>();
  for (const c of candidates) {
    if (!c.key) continue;
    const existing = byKey.get(c.key);
    if (!existing || c.frequency > existing.frequency) {
      byKey.set(c.key, c);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.frequency - a.frequency);
}

export async function discoverEntitiesForDomain(
  input: DiscoverEntitiesInput,
): Promise<DiscoverEntitiesOutput> {
  const confirmedSenderEmails = input.confirmedSenderEmails ?? [];
  const topicKeywords = input.topicKeywords ?? [];

  // 04-22 Layer 2 — public-provider zero-sender skip. When a public
  // provider (gmail.com etc.) has no confirmed senders, there's no way to
  // scope the query to actual content; return zero candidates at zero cost.
  if (isPublicProvider(input.confirmedDomain) && confirmedSenderEmails.length === 0) {
    return {
      algorithm: "public-provider-skip",
      candidates: [],
      subjectsScanned: 0,
      errorCount: 0,
    };
  }

  // 04-22 Layer 1 — unambiguous-pair short-circuit. One sender + one
  // paired WHAT at this domain → emit ONE synthetic PRIMARY candidate =
  // the paired WHAT, skip Gemini entirely. Per school_parent.md §8: the
  // WHAT is the PRIMARY; team variants fold in as aliases (not separate
  // candidates).
  if (
    ONBOARDING_TUNABLES.stage2.enableShortCircuit &&
    input.unambiguousPairedWhat &&
    confirmedSenderEmails.length === 1
  ) {
    const what = input.unambiguousPairedWhat;
    const synthetic: EntityCandidate = {
      key: normalizeKey(what),
      displayString: what,
      // Phase 5: surface the paired WHO's matchCount so the review UI shows
      // a truthful "N emails" rather than a misleading "0 emails". Falls
      // back to 0 only when the caller didn't thread the count through —
      // the confirm UI renders that fallback state as "· just confirmed".
      frequency: input.pairedWhoMatchCount ?? 0,
      autoFixed: false,
      meta: {
        pattern: "short-circuit",
        kind: "primary",
        sourcedFromWho: input.pairedWho,
        relatedWhat: what,
      },
    };
    logger.info({
      service: "discovery",
      operation: "stage2.short-circuit",
      schemaId: input.schemaId,
      confirmedDomain: input.confirmedDomain,
      pairedWhat: what,
      pairedWho: input.pairedWho,
    });
    return {
      algorithm: "pair-short-circuit",
      candidates: [synthetic],
      subjectsScanned: 0,
      errorCount: 0,
    };
  }

  // Agency-specific shortcut (agency.md §4): one PRIMARY per confirmed
  // domain. The entity IS the client company; there is NO subject-content
  // regex and NO Gemini entity enumeration. Display label preference order:
  //   1. A single paired WHAT at this domain (user's typed label — per
  //      spec §5 "Display label = user's typed input"). Handles the PPA
  //      multi-sender case (Margaret + George paired to "PPA").
  //   2. Domain-derive (strip TLD, split on hyphens, title-case). For
  //      domains without hyphens this yields a single-segment capitalised
  //      form the user edits at confirmation per spec §4 step 3.
  if (input.schemaDomain === "agency" && !isPublicProvider(input.confirmedDomain)) {
    const displayName =
      topicKeywords.length === 1
        ? topicKeywords[0]
        : deriveAgencyDisplayName(input.confirmedDomain);
    const synthetic: EntityCandidate = {
      key: normalizeKey(displayName),
      displayString: displayName,
      // Phase 5: sum of confirmed-WHO matchCounts at this domain (Margaret 9
      // + George 10 = 19 for PPA). When no WHOs are confirmed yet, 0 → UI
      // renders "· just confirmed" fallback copy.
      frequency: input.confirmedSenderTotalMatches ?? 0,
      autoFixed: false,
      meta: {
        pattern: "agency-domain-derive",
        kind: "primary",
        authoritativeDomain: input.confirmedDomain,
        // Phase 5: unify on `relatedWhat` across short-circuit / Gemini /
        // agency-derive so the confirm UI reads one attribution field.
        // (Previously this path wrote `sourcedFromWhat`.)
        ...(topicKeywords.length === 1 ? { relatedWhat: topicKeywords[0] } : {}),
      },
    };
    logger.info({
      service: "discovery",
      operation: "stage2.agency-domain-derive",
      schemaId: input.schemaId,
      confirmedDomain: input.confirmedDomain,
      displayName,
      source: topicKeywords.length === 1 ? "paired-what" : "domain-derive",
    });
    return {
      algorithm: "agency-domain-derive",
      candidates: [synthetic],
      subjectsScanned: 0,
      errorCount: 0,
    };
  }

  // 04-22 Layer 3 topic content filter — apply ONLY when a single paired
  // WHAT converges on this domain (disambiguation case: Amy @ gmail paired
  // with "lanier" → narrow her email to lanier-related). Skip when ≥2
  // paired WHATs converge — that signals the domain is an ANCHOR for the
  // user's topic area (Timothy + Krystin @ judgefite.com paired with 3
  // addresses) and Gemini should see the full corpus to DISCOVER adjacent
  // PRIMARIES per master plan §7 principle #5 (validation feedback loop).
  const shouldApplyTopicFilter =
    ONBOARDING_TUNABLES.stage2.useTopicContentFilter && topicKeywords.length === 1;
  const topicFilter = shouldApplyTopicFilter ? topicKeywords : [];
  const query = buildStage2Query(input.confirmedDomain, confirmedSenderEmails, topicFilter);
  const { rows, errorCount, droppedUnsubscribe } = await fetchSubjects(input.gmailClient, query);
  const subjectsScanned = rows.length;

  if (subjectsScanned === 0) {
    logger.info({
      service: "discovery",
      operation: "stage2.subject-entity-pass.empty",
      schemaId: input.schemaId,
      confirmedDomain: input.confirmedDomain,
      query,
      droppedUnsubscribe,
    });
    return {
      algorithm: "gemini-subject-pass",
      candidates: [],
      subjectsScanned: 0,
      errorCount,
    };
  }

  // Gather user-hint context for the prompt: the paired WHATs at this
  // domain (from `topicKeywords`) plus any non-paired schema-level WHATs
  // so Gemini knows the wanted axis without needing to guess.
  const { system, user } = buildPrompt(
    input.confirmedDomain,
    input.schemaDomain,
    rows,
    input.pairedWhoAddresses,
    { whats: [], pairedWhats: topicKeywords },
  );

  const aiResult = await callGemini({
    model: GEMINI_MODEL,
    system,
    user,
    maxTokens: 4096,
    operation: "stage2.subject-entity-pass",
    schemaId: input.schemaId,
    userId: input.userId,
  });

  const payload = extractJsonPayload(aiResult.content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    logger.error({
      service: "discovery",
      operation: "stage2.subject-entity-pass.jsonParseFailed",
      confirmedDomain: input.confirmedDomain,
      schemaId: input.schemaId,
      error: err instanceof Error ? err.message : String(err),
      rawLength: aiResult.content.length,
    });
    return {
      algorithm: "gemini-subject-pass",
      candidates: [],
      subjectsScanned,
      errorCount: errorCount + 1,
    };
  }

  const validated = GeminiResponseSchema.safeParse(parsed);
  if (!validated.success) {
    logger.error({
      service: "discovery",
      operation: "stage2.subject-entity-pass.schemaInvalid",
      confirmedDomain: input.confirmedDomain,
      schemaId: input.schemaId,
      issues: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return {
      algorithm: "gemini-subject-pass",
      candidates: [],
      subjectsScanned,
      errorCount: errorCount + 1,
    };
  }

  const deduped = deduplicateByKey(validated.data.entities.map(mapEntity));

  // Post-Gemini scoring — annotate each candidate with its compounding-
  // signal score + signal provenance, and reject anything that fails the
  // per-spec §5 alias-prohibition rules. NB: we do NOT threshold-filter by
  // score here. On a confirmed-anchored domain (Stage 1 already triangulated
  // it), Gemini's output is the "discovered PRIMARIES" step of principle #5's
  // validation feedback loop — adjacent entities the user did not explicitly
  // type (e.g. "205 Freedom Trail" among the user's property hints) are
  // EXPECTED output. The review screen filters by score for ranking, and
  // `persistConfirmedEntities` applies a second spec-§5 gate.
  const scored = scoreEntityCandidates({
    candidates: deduped.map((d) => ({
      key: d.key,
      displayString: d.displayString,
      frequency: d.frequency,
      meta: d.meta,
    })),
    schemaDomain: input.schemaDomain,
    userWhats: input.userWhats ?? [],
    confirmedWhoEmails: input.confirmedWhoEmails ?? [],
    sourceAlgorithm: "gemini-subject-pass",
  });
  const surfaced = scored.filter((s) => s.score !== Number.NEGATIVE_INFINITY);
  const rejected = scored.length - surfaced.length;
  // Sort by score desc so the review screen ranks hint-matched candidates
  // above unadorned discoveries. Ties preserve Gemini's frequency ordering.
  surfaced.sort((a, b) => b.score - a.score);
  // Map back into EntityCandidate shape for persistence.
  const candidates: EntityCandidate[] = surfaced.map((s) => {
    const original = deduped.find((d) => d.key === s.key);
    return {
      key: s.key,
      displayString: s.displayString,
      frequency: s.frequency,
      autoFixed: original?.autoFixed ?? false,
      meta: {
        ...(original?.meta ?? {}),
        discoveryScore: s.score,
        discoverySignals: s.signals,
      },
    };
  });

  logger.info({
    service: "discovery",
    operation: "stage2.subject-entity-pass.complete",
    schemaId: input.schemaId,
    confirmedDomain: input.confirmedDomain,
    subjectsScanned,
    droppedUnsubscribe,
    entitiesGeminiReturned: deduped.length,
    entitiesSurfaced: candidates.length,
    entitiesRejected: rejected,
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    latencyMs: aiResult.latencyMs,
  });

  return {
    algorithm: "gemini-subject-pass",
    candidates,
    subjectsScanned,
    errorCount,
  };
}
