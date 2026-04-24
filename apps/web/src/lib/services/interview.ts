import {
  buildHypothesisPrompt,
  buildValidationPrompt,
  type EntityGroupContext,
  parseHypothesisResponse,
  parseValidationResponse,
} from "@denim/ai";
import { resolveEntity, validateEntityAgainstSpec } from "@denim/engine";
import type {
  EntityGroupInput,
  HypothesisValidation,
  InterviewInput,
  SchemaHypothesis,
} from "@denim/types";
import { ExternalAPIError } from "@denim/types";
import type { Prisma } from "@prisma/client";
import { callClaude } from "@/lib/ai/client";
import { CLUSTERING_TUNABLES } from "@/lib/config/clustering-tunables";
import {
  buildDefaultClusteringConfig,
  composeFallbackSchemaName,
  defaultSummaryLabels,
} from "@/lib/config/schema-defaults";
import { logger } from "@/lib/logger";
import { withLogging } from "@/lib/logger-helpers";
import { prisma } from "@/lib/prisma";
import { linkEntityGroups } from "@/lib/services/link-entity-groups";
import { InterviewInputSchema, validateInput } from "@/lib/validation/interview";

const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Generate a schema hypothesis from interview input.
 * Validates input, builds prompt via @denim/ai, calls Claude, and parses the response.
 *
 * validateHypothesis and finalizeSchema are Phase 2.
 */
export async function generateHypothesis(
  input: InterviewInput,
  options?: { userId?: string },
): Promise<SchemaHypothesis> {
  const operation = "generateHypothesis";

  return withLogging<SchemaHypothesis>(
    {
      service: "interview",
      operation,
      context: { userId: options?.userId },
    },
    async () => {
      // Validate input
      const validated = validateInput(InterviewInputSchema, input);

      // Build prompt (pure function from @denim/ai). Numeric clustering
      // knobs are injected from our config so the prompt file stays
      // package-pure and all tuning lives in clustering-tunables.ts.
      const prompt = buildHypothesisPrompt(validated, CLUSTERING_TUNABLES);

      // Call Claude via AI client wrapper
      const result = await callClaude({
        model: DEFAULT_MODEL,
        system: prompt.system,
        user: prompt.user,
        userId: options?.userId,
        operation,
      });

      // Parse response (pure function from @denim/ai)
      try {
        return parseHypothesisResponse(result.content);
      } catch (error) {
        throw new ExternalAPIError(
          `Failed to parse hypothesis response: ${error instanceof Error ? error.message : String(error)}`,
          "claude",
          result.content,
        );
      }
    },
    (hypothesis) => ({
      domain: hypothesis.domain,
      entityCount: hypothesis.entities.length,
      tagCount: hypothesis.tags.length,
    }),
  );
}

interface EmailSampleForValidation {
  subject: string;
  senderDomain: string;
  senderName: string;
  snippet: string;
}

/**
 * Validate a schema hypothesis against real email samples.
 * Builds prompt via @denim/ai, calls Claude, and parses the response.
 */
export async function validateHypothesis(
  hypothesis: SchemaHypothesis,
  emailSamples: EmailSampleForValidation[],
  options?: {
    userId?: string;
    entityGroups?: EntityGroupContext[];
    userThings?: string[];
  },
): Promise<HypothesisValidation> {
  const operation = "validateHypothesis";
  const start = Date.now();
  let filteredHallucinations = 0;

  return withLogging<HypothesisValidation>(
    {
      service: "interview",
      operation,
      context: {
        userId: options?.userId,
        sampleCount: emailSamples.length,
        entityGroupCount: options?.entityGroups?.length ?? 0,
        userThingCount: options?.userThings?.length ?? 0,
      },
    },
    async () => {
      const prompt = buildValidationPrompt(
        hypothesis,
        emailSamples,
        options?.entityGroups,
        options?.userThings,
      );

      const result = await callClaude({
        model: DEFAULT_MODEL,
        // system is kept as the concatenated form for logs / fallback; the
        // API call uses cacheableSystemPrompt below (#79) to cache the
        // large static rules prefix across calls (Pass 1 + Pass 2).
        system: prompt.system,
        user: prompt.user,
        cacheableSystemPrompt: {
          static: prompt.systemStatic,
          dynamic: prompt.systemDynamic,
        },
        userId: options?.userId,
        operation,
      });

      let validation: ReturnType<typeof parseValidationResponse>;
      try {
        validation = parseValidationResponse(result.content);
      } catch (error) {
        throw new ExternalAPIError(
          `Failed to parse validation response: ${error instanceof Error ? error.message : String(error)}`,
          "claude",
          result.content,
        );
      }

      // Post-parse grounding filter: remove entities with no email evidence
      const totalSamples = emailSamples.length;
      const preFilterCount = validation.discoveredEntities.length;
      validation.discoveredEntities = validation.discoveredEntities.filter((entity) => {
        if (entity.emailIndices.length === 0) {
          logger.warn({
            service: "interview",
            operation: `${operation}.groundingFilter`,
            entityName: entity.name,
            claimedEmailCount: entity.emailCount,
            reason: "no_email_indices",
          });
          return false;
        }
        const validIndices = entity.emailIndices.filter((idx) => idx >= 1 && idx <= totalSamples);
        if (validIndices.length === 0) {
          logger.warn({
            service: "interview",
            operation: `${operation}.groundingFilter`,
            entityName: entity.name,
            indices: entity.emailIndices,
            maxValid: totalSamples,
            reason: "all_indices_invalid",
          });
          return false;
        }
        entity.emailIndices = validIndices;
        entity.emailCount = validIndices.length;
        return true;
      });

      filteredHallucinations = preFilterCount - validation.discoveredEntities.length;

      return {
        ...validation,
        sampleEmailCount: emailSamples.length,
        scanDurationMs: Date.now() - start,
      };
    },
    (validation) => ({
      confirmedEntities: validation.confirmedEntities.length,
      discoveredEntities: validation.discoveredEntities.length,
      filteredHallucinations,
      confidenceScore: validation.confidenceScore,
    }),
  );
}

/**
 * Domains that represent generic email providers, not specific orgs.
 * Sender addresses at these domains should NOT be used for domain expansion
 * (querying Gmail for other senders at the same domain) because doing so
 * would flood discovery with unrelated emails.
 *
 * Extracted from the pre-refactor validate route (b5b42a9) -- that flow
 * implicitly avoided expansion because it only ran once. Re-centralized
 * here now that runOnboarding performs the domain-expansion second pass.
 */
export const GENERIC_SENDER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "yandex.com",
  "yandex.ru",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "fastmail.com",
  "zoho.com",
]);

/**
 * Resolve WHO entity names (SECONDARY hypothesis entities) to actual sender
 * email addresses by fuzzy-matching against a sample of real messages.
 * Enriches entity.aliases in-place so downstream persistence captures the
 * mapping.
 *
 * Restored from the pre-refactor /api/interview/validate route (b5b42a9).
 * Called by runOnboarding during the validate-hypothesis step.
 */
export function resolveWhoEmails(
  hypothesis: SchemaHypothesis,
  messages: { senderDisplayName: string; senderEmail: string }[],
): void {
  const whoEntities = hypothesis.entities.filter((e) => e.type === "SECONDARY");
  if (whoEntities.length === 0) return;

  const entityList = whoEntities.map((e) => ({
    name: e.name,
    type: e.type as "PRIMARY" | "SECONDARY",
    aliases: e.aliases,
  }));

  const resolvedEmails = new Map<string, Set<string>>();
  for (const e of whoEntities) {
    resolvedEmails.set(e.name, new Set(e.aliases));
  }

  for (const msg of messages) {
    if (!msg.senderDisplayName) continue;
    const match = resolveEntity(msg.senderDisplayName, msg.senderEmail, entityList, 0.8);
    if (match) {
      const aliasSet = resolvedEmails.get(match.entityName);
      if (aliasSet && !aliasSet.has(msg.senderEmail)) {
        aliasSet.add(msg.senderEmail);
        const entity = whoEntities.find((e) => e.name === match.entityName);
        if (entity) {
          entity.aliases.push(msg.senderEmail);
        }
      }
    }
  }
}

/**
 * Extract unique, non-generic sender domains from an enriched hypothesis.
 * After `resolveWhoEmails` runs, SECONDARY entities have email addresses in
 * their alias list. This helper returns the set of specific org domains
 * worth expanding (e.g., "judgefite.com" -- but not "gmail.com").
 *
 * Used by runOnboarding's domain-expansion second pass: for each returned
 * domain, query Gmail for ALL senders at that domain, then run a second
 * validateHypothesis pass on the expanded samples. This catches entities
 * that didn't happen to make it into the initial 200-email random sample.
 */
export function extractTrustedDomains(hypothesis: SchemaHypothesis): string[] {
  const domains = new Set<string>();
  for (const entity of hypothesis.entities) {
    if (entity.type !== "SECONDARY") continue;
    for (const alias of entity.aliases) {
      const atIdx = alias.lastIndexOf("@");
      if (atIdx < 0) continue;
      const domain = alias
        .slice(atIdx + 1)
        .toLowerCase()
        .trim();
      if (!domain || domain.includes(" ")) continue;
      if (GENERIC_SENDER_DOMAINS.has(domain)) continue;
      domains.add(domain);
    }
  }
  return Array.from(domains);
}

interface FinalizeConfirmations {
  confirmedEntities: string[];
  removedEntities: string[];
  confirmedTags: string[];
  removedTags: string[];
  addedEntities?: string[];
  addedTags?: string[];
  schemaName?: string;
  groups?: EntityGroupInput[];
  sharedWhos?: string[];
}

/**
 * Create a minimal CaseSchema stub row at the start of onboarding.
 *
 * Used by the onboarding workflow to claim a schema id before hypothesis
 * generation runs (so the polling endpoint has something to read). All the
 * real content — name, domain, entities, tags, prompts, configs — lands
 * later via `persistSchemaRelations`.
 *
 * The stub is valid enough to satisfy the Prisma schema's NOT NULL
 * constraints but carries placeholder values that `persistSchemaRelations`
 * overwrites. Status starts at DRAFT and phase at PENDING; callers are
 * responsible for advancing both via the state-machine helpers.
 */
export async function createSchemaStub(opts: {
  /**
   * Optional Prisma transaction client. When provided, the stub INSERT runs
   * inside the caller's transaction — used by POST /api/onboarding/start to
   * atomically write the stub + OnboardingOutbox row together (see #33). When
   * omitted, the call uses the singleton Prisma client directly.
   */
  tx?: Prisma.TransactionClient;
  /** Optional client-supplied ULID/cuid. When omitted, Prisma generates one. */
  schemaId?: string;
  userId: string;
  inputs?: InterviewInput;
}): Promise<string> {
  const client = opts.tx ?? prisma;
  // #111: prefer user-provided name if the interview captured one. When empty,
  // the "Setting up..." placeholder triggers the entity-confirm composed-name
  // fallback in `seedSchemaName`.
  const userProvidedName = opts.inputs?.name?.trim();
  const schema = await client.caseSchema.create({
    data: {
      ...(opts.schemaId ? { id: opts.schemaId } : {}),
      userId: opts.userId,
      // Placeholder fields — overwritten by persistSchemaRelations (legacy
      // flow) or seedSchemaDefaults + seedSchemaName (Stage 1/2 flow).
      name: userProvidedName || "Setting up...",
      description: "",
      primaryEntityConfig: {} as Prisma.InputJsonValue,
      discoveryQueries: [] as unknown as Prisma.InputJsonValue,
      summaryLabels: {} as Prisma.InputJsonValue,
      clusteringConfig: {} as Prisma.InputJsonValue,
      extractionPrompt: "",
      synthesisPrompt: "",
      // Real values.
      status: "DRAFT",
      phase: "PENDING",
      phaseUpdatedAt: new Date(),
      // Issue #95: runOnboarding's thin Stage-1 trigger guards on
      // `schema.domain` (see apps/web/src/lib/inngest/onboarding.ts). Persist
      // the interview-declared domain on the stub row so fast-discovery can
      // pick up the per-domain shape config without a second round-trip.
      domain: opts.inputs?.domain,
      inputs: opts.inputs ? (opts.inputs as unknown as Prisma.InputJsonValue) : undefined,
    },
    select: { id: true },
  });
  return schema.id;
}

/**
 * Populate an existing CaseSchema row with hypothesis + validation +
 * confirmations data. Assumes the stub row has already been created via
 * `createSchemaStub` (or the delegating `finalizeSchema` wrapper).
 *
 * Writes: updates the existing CaseSchema row (name, domain, configs,
 * prompts, raw hypothesis) and creates Entity, EntityGroup, SchemaTag,
 * ExtractedFieldDef rows.
 *
 * Transaction handling: when `opts.tx` is provided, the caller owns the
 * outer transaction (e.g. the POST confirm route atomically writes
 * entities + an OnboardingOutbox row — see #67). When omitted, this
 * function opens its own transaction. Either way all relation writes
 * commit as a single unit.
 */
export async function persistSchemaRelations(
  schemaId: string,
  hypothesis: SchemaHypothesis,
  validation?: HypothesisValidation,
  confirmations?: FinalizeConfirmations,
  opts?: { tx?: Prisma.TransactionClient },
): Promise<void> {
  // Both validation and confirmations are optional so the state-machine
  // orchestrator (runOnboarding / Task 9) can call this with just the
  // hypothesis — the auto-onboarding path has no human-in-the-loop review
  // step, so validation+confirmations become identity merges.
  const effectiveValidation: HypothesisValidation = validation ?? {
    confirmedEntities: [],
    discoveredEntities: [],
    confirmedTags: [],
    suggestedTags: [],
    noisePatterns: [],
    sampleEmailCount: 0,
    scanDurationMs: 0,
    confidenceScore: 1,
  };
  const effectiveConfirmations: FinalizeConfirmations = confirmations ?? {
    confirmedEntities: [],
    removedEntities: [],
    confirmedTags: [],
    removedTags: [],
  };

  // Build final entity list: hypothesis entities (minus removed) + discovered (if confirmed) + user-added.
  //
  // Dedupe on (name, type). The same entity CAN appear in both
  // `hypothesis.entities` (Claude's initial read of the interview) AND
  // `validation.discoveredEntities` (Claude re-detecting it during Pass 1).
  // Without dedup, `tx.entity.createMany` hits P2002 on
  // @@unique([schemaId, name, type]), the whole tx rolls back, and the
  // outbox row for `onboarding.review.confirmed` never gets written —
  // Function B never fires, and the user sees a perpetual "Starting your
  // scan…" screen.
  //
  // First occurrence wins (hypothesis > discovered > user-added), since
  // the hypothesis version carries richer data (aliases, confidence).
  const removedSet = new Set(effectiveConfirmations.removedEntities);
  const confirmedDiscoveredSet = new Set(effectiveConfirmations.confirmedEntities);

  const rawFinalEntities = [
    ...hypothesis.entities
      .filter((e) => !removedSet.has(e.name))
      .map((e) => ({
        name: e.name,
        type: e.type,
        secondaryTypeName: e.secondaryTypeName,
        aliases: e.aliases,
        confidence: e.confidence,
        autoDetected: e.source === "email_scan",
      })),
    ...effectiveValidation.discoveredEntities
      .filter((e) => confirmedDiscoveredSet.has(e.name))
      .map((e) => ({
        name: e.name,
        type: e.type as "PRIMARY" | "SECONDARY",
        secondaryTypeName: e.secondaryTypeName,
        aliases: [] as string[],
        confidence: e.confidence,
        autoDetected: true,
        emailCount: e.emailCount ?? 0,
        validationEmailIndices: e.emailIndices ?? [],
        likelyAliasOf: e.likelyAliasOf ?? null,
        aliasConfidence: e.aliasConfidence ?? null,
        aliasReason: e.aliasReason ?? null,
      })),
    ...(effectiveConfirmations.addedEntities ?? []).map((name) => ({
      name,
      type: "PRIMARY" as const,
      secondaryTypeName: null as string | null,
      aliases: [] as string[],
      confidence: 1.0,
      autoDetected: false,
    })),
  ];

  const seenEntityKeys = new Set<string>();
  const finalEntities = rawFinalEntities.filter((e) => {
    const key = `${e.name}:${e.type}`;
    if (seenEntityKeys.has(key)) {
      logger.info({
        service: "interview",
        operation: "persistSchemaRelations.dedupeEntity",
        schemaId,
        name: e.name,
        type: e.type,
      });
      return false;
    }
    seenEntityKeys.add(key);
    return true;
  });

  // Build final tag list: hypothesis tags (minus removed) + suggested (if confirmed) + user-added.
  // Same dedup rationale as finalEntities above — SchemaTag @@unique([schemaId, name])
  // would P2002 if the same tag name appears in both hypothesis.tags and
  // validation.suggestedTags. First occurrence wins (hypothesis description
  // is typically richer than the re-suggestion).
  const removedTagSet = new Set(effectiveConfirmations.removedTags);

  const rawFinalTags = [
    ...hypothesis.tags.filter((t) => !removedTagSet.has(t.name)),
    ...effectiveValidation.suggestedTags
      .filter((t) => effectiveConfirmations.confirmedTags.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        isActionable: t.isActionable,
      })),
    ...(effectiveConfirmations.addedTags ?? []).map((name) => ({
      name,
      description: "",
      isActionable: false,
    })),
  ];

  const seenTagNames = new Set<string>();
  const finalTags = rawFinalTags.filter((t) => {
    if (seenTagNames.has(t.name)) {
      logger.info({
        service: "interview",
        operation: "persistSchemaRelations.dedupeTag",
        schemaId,
        name: t.name,
      });
      return false;
    }
    seenTagNames.add(t.name);
    return true;
  });

  // Dedupe extractedFields by name. ExtractedFieldDef has
  // @@unique([schemaId, name]) — a duplicate would P2002 the transaction and
  // roll back the whole persistSchemaRelations write (same failure mode as
  // finalEntities / finalTags, see commits d02a4bc / d1ccab2). Today the
  // source is hypothesis.extractedFields alone, but guard against a future
  // edit that merges extracted fields from multiple sources.
  const seenFieldNames = new Set<string>();
  const finalExtractedFields = hypothesis.extractedFields.filter((f) => {
    if (seenFieldNames.has(f.name)) {
      logger.info({
        service: "interview",
        operation: "persistSchemaRelations.dedupeExtractedField",
        schemaId,
        name: f.name,
      });
      return false;
    }
    seenFieldNames.add(f.name);
    return true;
  });

  // Dedupe noisePatterns by composite (ruleType, pattern). ExclusionRule has
  // @@unique([schemaId, ruleType, pattern]); same P2002 rollback risk as
  // above. ruleType is derived from whether the pattern contains "@" so in
  // practice (ruleType, pattern) collapses to pattern, but we key on the
  // composite to match the DB constraint exactly.
  const seenRuleKeys = new Set<string>();
  const finalNoiseRules = (effectiveValidation.noisePatterns ?? [])
    .map((pattern) => ({
      pattern,
      ruleType: pattern.includes("@") ? ("SENDER" as const) : ("DOMAIN" as const),
    }))
    .filter(({ pattern, ruleType }) => {
      const key = `${ruleType}:${pattern}`;
      if (seenRuleKeys.has(key)) {
        logger.info({
          service: "interview",
          operation: "persistSchemaRelations.dedupeExclusionRule",
          schemaId,
          ruleType,
          pattern,
        });
        return false;
      }
      seenRuleKeys.add(key);
      return true;
    });

  // Cap mergeThreshold at the mathematically achievable ceiling. See
  // `clustering-tunables.ts` for the scoring math and the rationale
  // behind the ceiling/clamp values (#59).
  const clusteringConfig = hypothesis.clusteringConfig as unknown as Record<string, unknown>;
  if (
    typeof clusteringConfig.mergeThreshold === "number" &&
    clusteringConfig.mergeThreshold > CLUSTERING_TUNABLES.validator.unreachableCeiling
  ) {
    clusteringConfig.mergeThreshold = CLUSTERING_TUNABLES.validator.clampReachableValue;
  }

  const runWork = async (tx: Prisma.TransactionClient) => {
    // Overwrite the stub's placeholder values with the real configs.
    // Issue #63: merged the previous second `caseSchema.update` (validationConfidenceScore)
    // into this single call — cuts one round-trip with no behavioral change.
    await tx.caseSchema.update({
      where: { id: schemaId },
      data: {
        name: effectiveConfirmations.schemaName ?? hypothesis.schemaName,
        description: `${hypothesis.domain} schema`,
        domain: hypothesis.domain,
        interviewResponses: {
          groups: (effectiveConfirmations.groups ?? []) as unknown as Prisma.InputJsonValue,
          sharedWhos: (effectiveConfirmations.sharedWhos ?? []) as unknown as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
        rawHypothesis: hypothesis as unknown as Prisma.InputJsonValue,
        primaryEntityConfig: {
          name: hypothesis.primaryEntity.name,
          description: hypothesis.primaryEntity.description,
          autoDetect: true,
          internalDomains: [],
        },
        secondaryEntityConfig: hypothesis.secondaryEntityTypes as unknown as Prisma.InputJsonValue,
        discoveryQueries: hypothesis.discoveryQueries as unknown as Prisma.InputJsonValue,
        summaryLabels: hypothesis.summaryLabels as unknown as Prisma.InputJsonValue,
        clusteringConfig: hypothesis.clusteringConfig as unknown as Prisma.InputJsonValue,
        ...(effectiveValidation.confidenceScore != null
          ? { validationConfidenceScore: effectiveValidation.confidenceScore }
          : {}),
        // extractionPrompt / synthesisPrompt still filled in by later pipeline stages.
      },
    });

    // Create entities
    if (finalEntities.length > 0) {
      await tx.entity.createMany({
        data: finalEntities.map((e) => ({
          schemaId,
          name: e.name,
          identityKey: e.name,
          type: e.type,
          secondaryTypeName: e.secondaryTypeName,
          aliases: e.aliases,
          confidence: e.confidence,
          autoDetected: e.autoDetected,
          emailCount: "emailCount" in e ? (e as { emailCount: number }).emailCount : 0,
          validationEmailIndices:
            "validationEmailIndices" in e
              ? (e as { validationEmailIndices: number[] }).validationEmailIndices
              : undefined,
          likelyAliasOf:
            "likelyAliasOf" in e
              ? (e as { likelyAliasOf: string | null }).likelyAliasOf
              : undefined,
          aliasConfidence:
            "aliasConfidence" in e
              ? (e as { aliasConfidence: number | null }).aliasConfidence
              : undefined,
          aliasReason:
            "aliasReason" in e ? (e as { aliasReason: string | null }).aliasReason : undefined,
        })),
      });

      // Load created entities for linking.
      const createdEntities = await tx.entity.findMany({
        where: { schemaId, isActive: true },
        select: { id: true, name: true, type: true },
      });

      // Link entities into groups, set associatedPrimaryIds, auto-group
      // ungrouped primaries, and create sharedWhos entity rows. Shared helper
      // so the Phase-2/3 `persistConfirmedEntities` path reuses identical
      // logic (#130).
      const parallelWrites: Array<Promise<unknown>> = [];
      parallelWrites.push(
        linkEntityGroups({
          tx,
          schemaId,
          createdEntities,
          groups: effectiveConfirmations.groups ?? [],
          sharedWhos: effectiveConfirmations.sharedWhos ?? [],
        }),
      );

      // Create tags
      if (finalTags.length > 0) {
        parallelWrites.push(
          tx.schemaTag.createMany({
            data: finalTags.map((t) => ({
              schemaId,
              name: t.name,
              description: t.description,
              aiGenerated: true,
              isActive: true,
            })),
          }),
        );
      }

      // Create extracted field definitions
      if (finalExtractedFields.length > 0) {
        parallelWrites.push(
          tx.extractedFieldDef.createMany({
            data: finalExtractedFields.map((f) => ({
              schemaId,
              name: f.name,
              type: f.type,
              description: f.description,
              source: f.source,
              format: f.format,
              showOnCard: f.showOnCard,
              aggregation: f.aggregation,
            })),
          }),
        );
      }

      // Persist noise patterns as exclusion rules
      if (finalNoiseRules.length > 0) {
        const noiseRules = finalNoiseRules.map(({ pattern, ruleType }) => ({
          schemaId,
          ruleType,
          pattern,
          source: "interview",
          isActive: true,
          matchCount: 0,
        }));
        parallelWrites.push(tx.exclusionRule.createMany({ data: noiseRules }));
        logger.info({
          service: "interview",
          operation: "persistSchemaRelations.exclusionRules",
          schemaId,
          rulesCreated: noiseRules.length,
        });
      }

      await Promise.all(parallelWrites);
    } else {
      // No entities created — still need to persist tags, fields, exclusion rules.
      const sideWrites: Array<Promise<unknown>> = [];

      if (finalTags.length > 0) {
        sideWrites.push(
          tx.schemaTag.createMany({
            data: finalTags.map((t) => ({
              schemaId,
              name: t.name,
              description: t.description,
              aiGenerated: true,
              isActive: true,
            })),
          }),
        );
      }

      if (finalExtractedFields.length > 0) {
        sideWrites.push(
          tx.extractedFieldDef.createMany({
            data: finalExtractedFields.map((f) => ({
              schemaId,
              name: f.name,
              type: f.type,
              description: f.description,
              source: f.source,
              format: f.format,
              showOnCard: f.showOnCard,
              aggregation: f.aggregation,
            })),
          }),
        );
      }

      if (finalNoiseRules.length > 0) {
        const noiseRules = finalNoiseRules.map(({ pattern, ruleType }) => ({
          schemaId,
          ruleType,
          pattern,
          source: "interview",
          isActive: true,
          matchCount: 0,
        }));
        sideWrites.push(tx.exclusionRule.createMany({ data: noiseRules }));
        logger.info({
          service: "interview",
          operation: "persistSchemaRelations.exclusionRules",
          schemaId,
          rulesCreated: noiseRules.length,
        });
      }

      if (sideWrites.length > 0) {
        await Promise.all(sideWrites);
      }
    }
  };

  if (opts?.tx) {
    // Caller owns the outer transaction. Run all writes against their
    // tx client so our inserts commit together with whatever else they
    // write in the same transaction (see POST confirm route, #67).
    await runWork(opts.tx);
  } else {
    // Issue #63: removed { timeout: 15000 } workaround — batched writes
    // bring the worst-case well under the default 5s timeout.
    await prisma.$transaction(runWork);
  }

  logger.info({
    service: "interview",
    operation: "persistSchemaRelations.complete",
    schemaId,
    entityCount: finalEntities.length,
    tagCount: finalTags.length,
  });
}

/**
 * Finalize a schema by merging hypothesis + validation + user confirmations,
 * then persisting everything to the database.
 *
 * Delegates to `createSchemaStub` + `persistSchemaRelations` and then flips
 * the schema's status to ONBOARDING to match the existing contract. Returns
 * the new schemaId.
 *
 * NOTE: the stub create and the relation writes are now in SEPARATE
 * transactions (the old implementation was single-transaction). A failure
 * in `persistSchemaRelations` leaves an orphan DRAFT/PENDING stub behind
 * instead of rolling the whole thing back. This is intentional — the
 * onboarding state machine can recover from an orphan stub (phase=PENDING
 * with no name/entities), whereas the single-transaction version could
 * not be resumed.
 */
export async function finalizeSchema(
  hypothesis: SchemaHypothesis,
  validation: HypothesisValidation,
  confirmations: FinalizeConfirmations,
  options: { userId: string },
): Promise<string> {
  return withLogging<string>(
    {
      service: "interview",
      operation: "finalizeSchema",
      context: { userId: options.userId },
    },
    async () => {
      const schemaId = await createSchemaStub({ userId: options.userId });
      await persistSchemaRelations(schemaId, hypothesis, validation, confirmations);

      // Preserve existing contract: finalizeSchema callers expect status=ONBOARDING.
      await prisma.caseSchema.update({
        where: { id: schemaId },
        data: { status: "ONBOARDING" },
      });

      return schemaId;
    },
    (schemaId) => ({ schemaId }),
  );
}

// ---------------------------------------------------------------------------
// Fast-discovery writers (issue #95). CaseSchema is single-writer-owned by
// InterviewService per engineering-practices.md — Inngest functions must
// never write stage1/stage2 columns directly.
// ---------------------------------------------------------------------------

export interface Stage1Result {
  /**
   * Compounding-signal-scored candidate domains (2026-04-23 rewrite).
   * Each carries a score, its signal provenance, the user hints that
   * converged on it, and the optional paired WHO. The `count` field is
   * preserved for backward compatibility with polling DTO consumers and
   * reports the same value as `score` until consumers migrate.
   */
  candidates: Array<{
    domain: string;
    score: number;
    signals: ReadonlyArray<string>;
    hintsMatched: ReadonlyArray<string>;
    pairedWho?: string;
    /** Deprecated alias for `score`. Kept for DTO backward compat; new
     *  code should read `score`. */
    count: number;
  }>;
  /** Comma-joined summary of the per-hint Gmail queries for traceability.
   *  Replaces the old single shape-keyword query string. */
  queryUsed: string;
  messagesSeen: number;
  errorCount: number;
  /** #112: per-user-what find-or-tell results. Always same length as
   *  `inputs.whats`, including zero-match entries. */
  userThings: Array<{
    query: string;
    matchCount: number;
    topDomain: string | null;
    topSenders: ReadonlyArray<string>;
    errorCount: number;
    /** #117: optional paired WHO name that supplied topDomain/matchCount. */
    sourcedFromWho?: string;
  }>;
  /** #112: per-user-who find-or-tell results. Same semantics as userThings. */
  userContacts: Array<{
    query: string;
    matchCount: number;
    senderEmail: string | null;
    senderDomain: string | null;
    errorCount: number;
  }>;
}

export async function writeStage1Result(schemaId: string, result: Stage1Result): Promise<void> {
  await prisma.caseSchema.update({
    where: { id: schemaId },
    data: {
      stage1Candidates: result.candidates as unknown as Prisma.InputJsonValue,
      stage1QueryUsed: result.queryUsed,
      stage1MessagesSeen: result.messagesSeen,
      stage1ErrorCount: result.errorCount,
      stage1UserThings: result.userThings as unknown as Prisma.InputJsonValue,
      stage1UserContacts: result.userContacts as unknown as Prisma.InputJsonValue,
    },
  });
}

export interface Stage2Result {
  perDomain: Array<{
    confirmedDomain: string;
    algorithm: string;
    subjectsScanned: number;
    candidates: unknown[];
    errorCount: number;
    /** True when the per-domain Stage 2 pass crashed and was isolated
     *  (a Gmail auth error rethrows to fail the whole schema instead). */
    failed?: boolean;
    errorMessage?: string;
  }>;
}

export async function writeStage2Result(schemaId: string, result: Stage2Result): Promise<void> {
  await prisma.caseSchema.update({
    where: { id: schemaId },
    data: {
      stage2Candidates: result.perDomain as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * CAS-style write: persist confirmed domains AND advance the phase in a
 * single row update. Returns the number of rows updated — 0 means the phase
 * gate didn't match (TOCTOU or double-submit), and the caller should treat
 * that as "already advanced, don't re-run Stage 2" (issue #33 pattern).
 */
export async function writeStage2ConfirmedDomains(
  tx: Prisma.TransactionClient,
  schemaId: string,
  confirmedDomains: string[],
  /** #112 Tier 2: user-who query strings the user ticked on the Stage 1
   *  review. Stage 2 cross-references against `stage1UserContacts` to
   *  seed pre-confirmed SECONDARY entity candidates. Empty array is the
   *  legacy shape (no user-named contacts confirmed). */
  confirmedUserContactQueries: string[] = [],
): Promise<number> {
  const { count } = await tx.caseSchema.updateMany({
    where: { id: schemaId, phase: "AWAITING_DOMAIN_CONFIRMATION" },
    data: {
      stage2ConfirmedDomains: confirmedDomains as unknown as Prisma.InputJsonValue,
      stage1ConfirmedUserContactQueries:
        confirmedUserContactQueries as unknown as Prisma.InputJsonValue,
      phase: "DISCOVERING_ENTITIES",
      phaseUpdatedAt: new Date(),
    },
  });
  return count;
}

export interface ConfirmedEntity {
  displayLabel: string;
  identityKey: string;
  kind: "PRIMARY" | "SECONDARY";
  secondaryTypeName?: string;
  /**
   * #121: sender-email aliases populated for SECONDARY entities whose
   * `identityKey` resolves to a Stage 1 `senderEmail`. Powers the relevance-
   * gate sender-bypass in `extraction.ts::resolveEntity` when the display
   * name varies across sends (e.g. `Ziad Allan` vs `ZSA U11/12 Girls`) but
   * the underlying sender email is stable.
   *
   * Empty / undefined → no alias merge performed; the bulk update path runs.
   */
  aliases?: string[];
  /**
   * Phase 3 — provenance of this confirmed entity. Drives the feed chip
   * row's "user hints first, discoveries second" ordering and the review
   * screen's "from your input" vs "Denim found this" attribution.
   * Defaults to STAGE2_GEMINI when unset (backward-compat for routes that
   * don't yet populate it).
   */
  origin?:
    | "USER_HINT"
    | "USER_SEEDED"
    | "STAGE1_TRIANGULATED"
    | "STAGE2_SHORT_CIRCUIT"
    | "STAGE2_AGENCY_DOMAIN"
    | "STAGE2_GEMINI"
    | "MID_SCAN"
    | "FEEDBACK_RULE";
  /** Phase 3 — compounding-signal score at the time of confirmation. Used
   *  to rank discoveries on the chip row. */
  discoveryScore?: number;
}

/**
 * Persist user-confirmed entities from the Stage 2 review screen (issue #95).
 *
 * Uses createMany(skipDuplicates) + per-label updateMany instead of a per-row
 * upsert loop. At 30 entities, the loop cost 30 DB roundtrips (~450ms at
 * pooler latency); this is 1 insert + (≤N) targeted updates on distinct
 * labels. The user-visible confirm click is on the critical path — every ms
 * here is felt.
 *
 * Semantics match an upsert-with-update loop:
 *   1. createMany(skipDuplicates) inserts new rows with autoDetected=false
 *      and the caller-supplied `aliases` (default `[]`).
 *   2. updateMany refreshes `name` + `isActive` on pre-existing rows (auto-
 *      discovered entities the user is now explicitly confirming). Scoped to
 *      the schemaId so there is no cross-tenant risk.
 *   3. #121: entities with non-empty `aliases` take a per-row raw-SQL update
 *      that merges the new aliases into the existing JSONB array and
 *      deduplicates. Only SECONDARY entities with a resolved senderEmail
 *      take this path — usually a handful, keeping the critical-path cost
 *      bounded.
 *
 * No-op on an empty array.
 */
export async function persistConfirmedEntities(
  tx: Prisma.TransactionClient,
  schemaId: string,
  entities: ConfirmedEntity[],
): Promise<void> {
  if (entities.length === 0) return;

  // Last-chance spec-§5 alias-prohibition gate — user confirmation at the
  // review screen does NOT override the locked domain-input-shapes rules.
  // A confirmed entity that would violate §5 (e.g. single-word fragment
  // "Bucknell" for property, or "KPI Dashboard Review" engagement for
  // agency) is rejected here with a structured log; the caller sees zero
  // rows inserted for that entity.
  const schema = await tx.caseSchema.findUnique({
    where: { id: schemaId },
    select: { domain: true, inputs: true },
  });
  const schemaDomain = schema?.domain;
  const schemaInputs = (schema?.inputs as InterviewInput | null | undefined) ?? null;
  const accepted: ConfirmedEntity[] = [];
  const rejectedBySpec: Record<string, number> = {};
  for (const e of entities) {
    // SECONDARY entities (contacts) skip the validator — §5 rules describe
    // PRIMARIES only.
    if (e.kind === "SECONDARY") {
      accepted.push(e);
      continue;
    }
    if (
      schemaDomain === "property" ||
      schemaDomain === "school_parent" ||
      schemaDomain === "agency"
    ) {
      const validation = validateEntityAgainstSpec({
        name: e.displayLabel,
        schemaDomain,
      });
      if (!validation.valid) {
        const code = validation.violationCode ?? "unknown";
        rejectedBySpec[code] = (rejectedBySpec[code] ?? 0) + 1;
        logger.warn({
          service: "interview",
          operation: "persistConfirmedEntities.specViolation",
          schemaId,
          schemaDomain,
          name: e.displayLabel,
          violationCode: validation.violationCode,
          rationale: validation.rationale,
        });
        continue;
      }
    }
    accepted.push(e);
  }
  // Phase 5 — single aggregated summary log so observability sees the
  // intake-to-accept ratio at a glance without scraping per-row warnings.
  logger.info({
    service: "interview",
    operation: "persistConfirmedEntities.summary",
    schemaId,
    schemaDomain: schemaDomain ?? "unknown",
    requested: entities.length,
    accepted: accepted.length,
    rejectedBySpec,
    rejectedTotal: entities.length - accepted.length,
  });
  if (accepted.length === 0) return;

  await tx.entity.createMany({
    data: accepted.map((e) => ({
      schemaId,
      name: e.displayLabel,
      identityKey: e.identityKey,
      type: e.kind,
      secondaryTypeName: e.secondaryTypeName,
      aliases: (e.aliases ?? []) as unknown as Prisma.InputJsonValue,
      autoDetected: false,
      isActive: true,
      // Phase 3 — default provenance when the caller didn't supply one.
      // SECONDARY + no origin → the user typed a WHO on Q4 and confirmed it
      // on the Stage 1 review (USER_SEEDED). PRIMARY + no origin → legacy
      // callers (treat as STAGE2_GEMINI; the column default handles this).
      origin: e.origin ?? (e.kind === "SECONDARY" ? "USER_SEEDED" : "STAGE2_GEMINI"),
      discoveryScore: e.discoveryScore,
    })),
    skipDuplicates: true,
  });

  // Partition: entities without aliases go through the fast bulk path
  // (grouped updateMany by label), entities with aliases take the JSONB
  // merge path so existing auto-discovered aliases aren't clobbered.
  const withAliases: ConfirmedEntity[] = [];
  const withoutAliases: ConfirmedEntity[] = [];
  for (const e of accepted) {
    if (e.aliases && e.aliases.length > 0) withAliases.push(e);
    else withoutAliases.push(e);
  }

  // Bulk path — group by display label so one updateMany refreshes every row
  // that shares a label. In practice labels are usually distinct, making this
  // N small statements; still strictly fewer round-trips than a per-row
  // upsert loop.
  const byLabel = new Map<string, ConfirmedEntity[]>();
  for (const e of withoutAliases) {
    const bucket = byLabel.get(e.displayLabel) ?? [];
    bucket.push(e);
    byLabel.set(e.displayLabel, bucket);
  }
  for (const [label, bucket] of byLabel) {
    await tx.entity.updateMany({
      where: {
        schemaId,
        OR: bucket.map((e) => ({ identityKey: e.identityKey, type: e.kind })),
      },
      data: { name: label, isActive: true },
    });
  }

  // Alias-merge path — one raw UPDATE per entity. Uses JSONB concat + a
  // DISTINCT subquery to dedupe so re-confirming the same SECONDARY doesn't
  // grow the aliases array unboundedly. Parameterized via `Prisma.sql` — no
  // user string interpolated into the query body.
  for (const e of withAliases) {
    await tx.$executeRaw`
      UPDATE "entities"
      SET
        "name" = ${e.displayLabel},
        "isActive" = true,
        "aliases" = (
          SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb)
          FROM jsonb_array_elements_text(
            "aliases" || to_jsonb(${e.aliases as string[]}::text[])
          ) AS t(v)
        )
      WHERE "schemaId" = ${schemaId}
        AND "identityKey" = ${e.identityKey}
        AND "type"::text = ${e.kind}
    `;
  }

  // #130 — wire EntityGroup + Entity.groupId + Entity.associatedPrimaryIds
  // from `inputs.groups`. Without this, the confirm screen produces orphan
  // entities and the scan pipeline's sender→PRIMARY fallback (Stage 5 of
  // extraction.ts's cascade) can't route paired SECONDARIES to their
  // PRIMARY case boundaries.
  //
  // Idempotency: `linkEntityGroups` creates fresh EntityGroup rows on every
  // call, so this must only fire once per schema. Re-entrant calls to
  // persistConfirmedEntities would double the groups. The onboarding state
  // machine's phase CAS gates prevent that today (review confirmation
  // advances past AWAITING_ENTITY_CONFIRMATION on first success).
  const entityRows = await tx.entity.findMany({
    where: {
      schemaId,
      OR: accepted.map((e) => ({ identityKey: e.identityKey, type: e.kind })),
    },
    select: { id: true, name: true, type: true },
  });
  await linkEntityGroups({
    tx,
    schemaId,
    createdEntities: entityRows,
    groups: schemaInputs?.groups ?? [],
    // sharedWhos are not re-created here — the Phase-2/3 confirm path
    // treats user-typed WHOs as explicit SECONDARIES already included in
    // `entities`. Only the legacy hypothesis flow passes sharedWhos.
    sharedWhos: [],
  });
}

/**
 * Populates schema-level JSON columns the scan pipeline reads but the
 * Stage 1/2 fast-discovery flow doesn't generate. Pairs with
 * `persistConfirmedEntities` in the Stage 2 entity-confirm transaction.
 * See `schema-defaults.ts` for the deterministic per-domain values.
 */
export async function seedSchemaDefaults(
  tx: Prisma.TransactionClient,
  schemaId: string,
  domain: string | null | undefined,
): Promise<void> {
  await tx.caseSchema.update({
    where: { id: schemaId },
    data: {
      clusteringConfig: buildDefaultClusteringConfig(domain) as unknown as Prisma.InputJsonValue,
      summaryLabels: defaultSummaryLabels(domain) as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * #111: upgrade `schema.name` from the "Setting up..." placeholder to a
 * human-readable title when the user didn't provide one at the interview
 * step. Never overwrites a user-provided (or already-upgraded) name.
 *
 * `currentName` is passed in to avoid a DB round-trip; the caller already
 * read it alongside domain + phase for the transaction's CAS check.
 */
export async function seedSchemaName(
  tx: Prisma.TransactionClient,
  schemaId: string,
  currentName: string,
  domain: string | null | undefined,
  entities: ReadonlyArray<ConfirmedEntity>,
): Promise<void> {
  if (currentName !== "Setting up...") return;
  const derived = composeFallbackSchemaName(
    domain,
    entities.map((e) => ({ displayLabel: e.displayLabel, kind: e.kind })),
  );
  await tx.caseSchema.update({ where: { id: schemaId }, data: { name: derived } });
}
