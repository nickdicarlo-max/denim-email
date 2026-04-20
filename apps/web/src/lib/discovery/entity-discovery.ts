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

import { z } from "zod";
import { callGemini } from "@/lib/ai/client";
import type { DomainName } from "@/lib/config/domain-shapes";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import type { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";

const GEMINI_MODEL = "gemini-2.5-flash";

export interface DiscoverEntitiesInput {
  gmailClient: GmailClient;
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
  sourced_from_who: z.string().optional(),
  related_what: z.string().optional(),
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

async function fetchSubjects(
  client: GmailClient,
  confirmedDomain: string,
): Promise<{ rows: SubjectRow[]; errorCount: number }> {
  const q = `from:*@${confirmedDomain} newer_than:${ONBOARDING_TUNABLES.stage1.lookbackDays}d`;
  const ids = await client.listMessageIds(q, ONBOARDING_TUNABLES.stage2.maxMessagesPerDomain);
  const rows: SubjectRow[] = [];
  let errorCount = 0;
  const batchSize = ONBOARDING_TUNABLES.stage1.fetchBatchSize;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const fetched = await Promise.all(
      batch.map(async (id) => {
        try {
          return await client.getMessageMetadata(id, ["Subject", "From"]);
        } catch {
          errorCount++;
          return null;
        }
      }),
    );
    for (const row of fetched) {
      if (!row) continue;
      const s = row.payload.headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const f = row.payload.headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      if (s) rows.push({ subject: s, senderEmail: parseSenderEmail(f) });
    }
  }
  return { rows, errorCount };
}

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildPrompt(
  confirmedDomain: string,
  schemaDomain: string,
  rows: SubjectRow[],
  pairedWhoAddresses?: DiscoverEntitiesInput["pairedWhoAddresses"],
): { system: string; user: string } {
  const system =
    "You extract distinct real-world entities from email subject lines. Users will pick from your output to tell us what to track in their inbox. False positives (entities that don't really exist) hurt more than false negatives (entities you skip). Be conservative when a candidate is ambiguous.";

  const pairingNote =
    pairedWhoAddresses && pairedWhoAddresses.length > 0
      ? `\nPaired context — the user said these senders relate to these topics:\n${pairedWhoAddresses
          .map((p) => `  - ${p.pairedWho} (${p.senderEmail}) -> "${p.pairedWhat}"`)
          .join("\n")}\n`
      : "";

  // Cap the corpus sent to Gemini to stay in token budget even for very
  // chatty domains. 500 subjects is plenty for distinct-entity extraction
  // and keeps input <= ~20k tokens at typical subject lengths.
  const capped = rows.slice(0, 500);
  const subjectList = capped.map((r, i) => `${i + 1}. [${r.senderEmail}] ${r.subject}`).join("\n");

  const user = `Schema domain type: ${schemaDomain}
Sender domain: ${confirmedDomain}${pairingNote}

Email subjects (with sender):
${subjectList}

Extract the distinct real-world entities these emails reference. An entity is a thing the user would track — a team, a property, a project, a client, a person, an account. It is NOT:
  - a status verb (Updated, Canceled, New game, Reminder, Event Reminder)
  - a seasonal or date descriptor (FALL 2025, Spring 2026, October, 2026)
  - a platform label or section header

For each entity, return:
  name:              canonical form. Strip status verbs. Strip seasonal/date descriptors. Prefer the most specific non-ephemeral form.
  kind:              "team" | "property" | "project" | "person" | "account" | "other"
  approximate_count: rough number of subjects referring to this entity
  aliases:           variants that refer to the same entity (seasonal / status variants) — merge them
  sourced_from_who (optional): if the entity clearly belongs to a paired WHO from the context above, their name
  related_what    (optional): if it clearly relates to one of the paired WHATs above, that topic

Rules:
  1. If entity A is a strict substring of entity B and freq(A) <= freq(B), drop A. Longest meaningful form wins.
  2. Skip entities in fewer than 3 subjects unless clearly a distinct real-world thing the user would care about.
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
  const { rows, errorCount } = await fetchSubjects(input.gmailClient, input.confirmedDomain);
  const subjectsScanned = rows.length;

  if (subjectsScanned === 0) {
    return {
      algorithm: "gemini-subject-pass",
      candidates: [],
      subjectsScanned: 0,
      errorCount,
    };
  }

  const { system, user } = buildPrompt(
    input.confirmedDomain,
    input.schemaDomain,
    rows,
    input.pairedWhoAddresses,
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

  const candidates = deduplicateByKey(validated.data.entities.map(mapEntity));

  logger.info({
    service: "discovery",
    operation: "stage2.subject-entity-pass.complete",
    schemaId: input.schemaId,
    confirmedDomain: input.confirmedDomain,
    subjectsScanned,
    entitiesReturned: candidates.length,
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
