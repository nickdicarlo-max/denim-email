import {
  buildHypothesisPrompt,
  buildValidationPrompt,
  type EntityGroupContext,
  parseHypothesisResponse,
  parseValidationResponse,
} from "@denim/ai";
import { resolveEntity } from "@denim/engine";
import type {
  EntityGroupInput,
  HypothesisValidation,
  InterviewInput,
  SchemaHypothesis,
} from "@denim/types";
import { ExternalAPIError } from "@denim/types";
import type { Prisma } from "@prisma/client";
import { callClaude } from "@/lib/ai/client";
import { logger } from "@/lib/logger";
import { withLogging } from "@/lib/logger-helpers";
import { prisma } from "@/lib/prisma";
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

      // Build prompt (pure function from @denim/ai)
      const prompt = buildHypothesisPrompt(validated);

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
  const schema = await client.caseSchema.create({
    data: {
      ...(opts.schemaId ? { id: opts.schemaId } : {}),
      userId: opts.userId,
      // Placeholder fields — overwritten by persistSchemaRelations.
      name: "Setting up...",
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

  // Build final entity list: hypothesis entities (minus removed) + discovered (if confirmed) + user-added
  const removedSet = new Set(effectiveConfirmations.removedEntities);
  const confirmedDiscoveredSet = new Set(effectiveConfirmations.confirmedEntities);

  const finalEntities = [
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

  // Build final tag list: hypothesis tags (minus removed) + suggested (if confirmed) + user-added
  const removedTagSet = new Set(effectiveConfirmations.removedTags);

  const finalTags = [
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

  // Cap mergeThreshold at the mathematically achievable ceiling.
  // Without sender-entity match, max score = subjectMatchScore + tagMatchScore
  // (typically 20 + 15 = 35). A threshold above 40 makes merges unreachable.
  const clusteringConfig = hypothesis.clusteringConfig as unknown as Record<string, unknown>;
  if (
    typeof clusteringConfig.mergeThreshold === "number" &&
    clusteringConfig.mergeThreshold > 40
  ) {
    clusteringConfig.mergeThreshold = 30;
  }

  const runWork = async (tx: Prisma.TransactionClient) => {
    // Overwrite the stub's placeholder values with the real configs.
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
        // extractionPrompt / synthesisPrompt still filled in by later pipeline stages.
      },
    });

    // Store validation confidence score
    if (effectiveValidation.confidenceScore != null) {
      await tx.caseSchema.update({
        where: { id: schemaId },
        data: { validationConfidenceScore: effectiveValidation.confidenceScore },
      });
    }

    // Create entities
    if (finalEntities.length > 0) {
      await tx.entity.createMany({
        data: finalEntities.map((e) => ({
          schemaId,
          name: e.name,
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

      // Load created entities for linking
      const createdEntities = await tx.entity.findMany({
        where: { schemaId, isActive: true },
        select: { id: true, name: true, type: true },
      });
      const entityByName = new Map(createdEntities.map((e) => [e.name, e]));

      // Create EntityGroup rows and link entities via groupId + associatedPrimaryIds
      const groups = effectiveConfirmations.groups ?? [];
      if (groups.length > 0) {
        for (let i = 0; i < groups.length; i++) {
          const group = groups[i];
          const allNames = [...group.whats, ...group.whos];
          const memberIds = allNames
            .map((name) => entityByName.get(name)?.id)
            .filter((id): id is string => !!id);

          if (memberIds.length === 0) continue;

          const entityGroup = await tx.entityGroup.create({
            data: {
              schemaId,
              index: i,
            },
          });

          // Link all group members
          await tx.entity.updateMany({
            where: { id: { in: memberIds } },
            data: { groupId: entityGroup.id },
          });

          // Set associatedPrimaryIds for secondaries in this group
          const primaryIdsInGroup = group.whats
            .map((name) => entityByName.get(name)?.id)
            .filter((id): id is string => !!id);
          const secondaryIdsInGroup = group.whos
            .map((name) => entityByName.get(name)?.id)
            .filter((id): id is string => !!id);

          if (primaryIdsInGroup.length > 0 && secondaryIdsInGroup.length > 0) {
            for (const secId of secondaryIdsInGroup) {
              await tx.entity.update({
                where: { id: secId },
                data: { associatedPrimaryIds: primaryIdsInGroup },
              });
            }
          }
        }
      } else {
        // Fallback: no groups — associate every secondary with every primary
        const primaryIds = createdEntities.filter((e) => e.type === "PRIMARY").map((e) => e.id);
        const secondaryIds = createdEntities.filter((e) => e.type === "SECONDARY").map((e) => e.id);

        if (primaryIds.length > 0 && secondaryIds.length > 0) {
          for (const secId of secondaryIds) {
            await tx.entity.update({
              where: { id: secId },
              data: { associatedPrimaryIds: primaryIds },
            });
          }
        }
      }

      // Auto-promote ungrouped PRIMARY entities to their own groups.
      // Discovered primaries (from validation scan) and user-added primaries that weren't
      // placed in any group should each become their own EntityGroup so they generate cases.
      const groupedEntityNames = new Set<string>();
      for (const group of groups) {
        for (const name of [...group.whats, ...group.whos]) {
          groupedEntityNames.add(name);
        }
      }
      const ungroupedPrimaries = createdEntities.filter(
        (e) => e.type === "PRIMARY" && !groupedEntityNames.has(e.name),
      );
      let autoGroupIndex = groups.length;
      for (const primary of ungroupedPrimaries) {
        // Check if already linked to a group (e.g., from drag-drop assignment handled above)
        const existing = await tx.entity.findUnique({
          where: { id: primary.id },
          select: { groupId: true },
        });
        if (existing?.groupId) continue;

        const entityGroup = await tx.entityGroup.create({
          data: { schemaId, index: autoGroupIndex++ },
        });
        await tx.entity.update({
          where: { id: primary.id },
          data: { groupId: entityGroup.id },
        });
      }

      // Process shared WHOs — SECONDARY entities with no group, empty associatedPrimaryIds.
      // These are discovery senders: their "from:" queries find emails, but content determines routing.
      const sharedWhos = effectiveConfirmations.sharedWhos ?? [];
      for (const whoName of sharedWhos) {
        // Skip if already created as part of a group
        if (entityByName.has(whoName)) continue;

        await tx.entity.create({
          data: {
            schemaId,
            name: whoName,
            type: "SECONDARY",
            secondaryTypeName: null,
            aliases: [],
            confidence: 1.0,
            autoDetected: false,
            associatedPrimaryIds: [],
            // No groupId — intentionally ungrouped
          },
        });
      }
    }

    // Create tags
    if (finalTags.length > 0) {
      await tx.schemaTag.createMany({
        data: finalTags.map((t) => ({
          schemaId,
          name: t.name,
          description: t.description,
          aiGenerated: true,
          isActive: true,
        })),
      });
    }

    // Create extracted field definitions
    if (hypothesis.extractedFields.length > 0) {
      await tx.extractedFieldDef.createMany({
        data: hypothesis.extractedFields.map((f) => ({
          schemaId,
          name: f.name,
          type: f.type,
          description: f.description,
          source: f.source,
          format: f.format,
          showOnCard: f.showOnCard,
          aggregation: f.aggregation,
        })),
      });
    }

    // Persist noise patterns as exclusion rules
    if (effectiveValidation.noisePatterns?.length > 0) {
      const noiseRules = effectiveValidation.noisePatterns.map((pattern) => ({
        schemaId,
        ruleType: pattern.includes("@") ? ("SENDER" as const) : ("DOMAIN" as const),
        pattern,
        source: "interview",
        isActive: true,
        matchCount: 0,
      }));
      await tx.exclusionRule.createMany({ data: noiseRules });
      logger.info({
        service: "interview",
        operation: "persistSchemaRelations.exclusionRules",
        schemaId,
        rulesCreated: noiseRules.length,
      });
    }
  };

  if (opts?.tx) {
    // Caller owns the outer transaction. Run all writes against their
    // tx client so our inserts commit together with whatever else they
    // write in the same transaction (see POST confirm route, #67).
    await runWork(opts.tx);
  } else {
    await prisma.$transaction(runWork, { timeout: 15000 });
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
