import { callClaude } from "@/lib/ai/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { InterviewInputSchema, validateInput } from "@/lib/validation/interview";
import {
  buildHypothesisPrompt,
  buildValidationPrompt,
  parseHypothesisResponse,
  parseValidationResponse,
} from "@denim/ai";
import type { EntityGroupInput, HypothesisValidation, InterviewInput, SchemaHypothesis } from "@denim/types";
import { ExternalAPIError } from "@denim/types";
import type { Prisma } from "@prisma/client";

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
  const start = Date.now();
  const operation = "generateHypothesis";

  logger.info({ service: "interview", operation, userId: options?.userId });

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
  let hypothesis: SchemaHypothesis;
  try {
    hypothesis = parseHypothesisResponse(result.content);
  } catch (error) {
    throw new ExternalAPIError(
      `Failed to parse hypothesis response: ${error instanceof Error ? error.message : String(error)}`,
      "claude",
      result.content,
    );
  }

  const durationMs = Date.now() - start;
  logger.info({
    service: "interview",
    operation: `${operation}.complete`,
    userId: options?.userId,
    durationMs,
    domain: hypothesis.domain,
    entityCount: hypothesis.entities.length,
    tagCount: hypothesis.tags.length,
  });

  return hypothesis;
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
  options?: { userId?: string },
): Promise<HypothesisValidation> {
  const start = Date.now();
  const operation = "validateHypothesis";

  logger.info({
    service: "interview",
    operation,
    userId: options?.userId,
    sampleCount: emailSamples.length,
  });

  const prompt = buildValidationPrompt(hypothesis, emailSamples);

  const result = await callClaude({
    model: DEFAULT_MODEL,
    system: prompt.system,
    user: prompt.user,
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

  const scanDurationMs = Date.now() - start;

  logger.info({
    service: "interview",
    operation: `${operation}.complete`,
    userId: options?.userId,
    durationMs: scanDurationMs,
    confirmedEntities: validation.confirmedEntities.length,
    discoveredEntities: validation.discoveredEntities.length,
    confidenceScore: validation.confidenceScore,
  });

  return {
    ...validation,
    sampleEmailCount: emailSamples.length,
    scanDurationMs,
  };
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
 * Finalize a schema by merging hypothesis + validation + user confirmations,
 * then persisting everything to the database in a single transaction.
 *
 * Creates: CaseSchema, Entity, SchemaTag, and ExtractedFieldDef rows.
 * Returns the new schemaId.
 */
export async function finalizeSchema(
  hypothesis: SchemaHypothesis,
  validation: HypothesisValidation,
  confirmations: FinalizeConfirmations,
  options: { userId: string },
): Promise<string> {
  const start = Date.now();
  const operation = "finalizeSchema";

  logger.info({ service: "interview", operation, userId: options.userId });

  // Build final entity list: hypothesis entities (minus removed) + discovered (if confirmed) + user-added
  const removedSet = new Set(confirmations.removedEntities);
  const confirmedDiscoveredSet = new Set(confirmations.confirmedEntities);

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
    ...validation.discoveredEntities
      .filter((e) => confirmedDiscoveredSet.has(e.name))
      .map((e) => ({
        name: e.name,
        type: e.type as "PRIMARY" | "SECONDARY",
        secondaryTypeName: e.secondaryTypeName,
        aliases: [] as string[],
        confidence: e.confidence,
        autoDetected: true,
      })),
    ...(confirmations.addedEntities ?? []).map((name) => ({
      name,
      type: "PRIMARY" as const,
      secondaryTypeName: null as string | null,
      aliases: [] as string[],
      confidence: 1.0,
      autoDetected: false,
    })),
  ];

  // Build final tag list: hypothesis tags (minus removed) + suggested (if confirmed) + user-added
  const removedTagSet = new Set(confirmations.removedTags);

  const finalTags = [
    ...hypothesis.tags.filter((t) => !removedTagSet.has(t.name)),
    ...validation.suggestedTags
      .filter((t) => confirmations.confirmedTags.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        isActionable: t.isActionable,
      })),
    ...(confirmations.addedTags ?? []).map((name) => ({
      name,
      description: "",
      isActionable: false,
    })),
  ];

  // Create everything in a transaction
  const schemaId = await prisma.$transaction(async (tx) => {
    const schema = await tx.caseSchema.create({
      data: {
        userId: options.userId,
        name: confirmations.schemaName ?? hypothesis.schemaName,
        description: `${hypothesis.domain} schema`,
        domain: hypothesis.domain,
        status: "ONBOARDING",
        interviewResponses: {
          groups: (confirmations.groups ?? []) as unknown as Prisma.InputJsonValue,
          sharedWhos: (confirmations.sharedWhos ?? []) as unknown as Prisma.InputJsonValue,
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
        extractionPrompt: "", // Generated in Phase 3
        synthesisPrompt: "", // Generated in Phase 5
      },
    });

    // Create entities
    if (finalEntities.length > 0) {
      await tx.entity.createMany({
        data: finalEntities.map((e) => ({
          schemaId: schema.id,
          name: e.name,
          type: e.type,
          secondaryTypeName: e.secondaryTypeName,
          aliases: e.aliases,
          confidence: e.confidence,
          autoDetected: e.autoDetected,
        })),
      });

      // Load created entities for linking
      const createdEntities = await tx.entity.findMany({
        where: { schemaId: schema.id, isActive: true },
        select: { id: true, name: true, type: true },
      });
      const entityByName = new Map(createdEntities.map((e) => [e.name, e]));

      // Create EntityGroup rows and link entities via groupId + associatedPrimaryIds
      const groups = confirmations.groups ?? [];
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
              schemaId: schema.id,
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
        const primaryIds = createdEntities
          .filter((e) => e.type === "PRIMARY")
          .map((e) => e.id);
        const secondaryIds = createdEntities
          .filter((e) => e.type === "SECONDARY")
          .map((e) => e.id);

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
          data: { schemaId: schema.id, index: autoGroupIndex++ },
        });
        await tx.entity.update({
          where: { id: primary.id },
          data: { groupId: entityGroup.id },
        });
      }

      // Process shared WHOs — SECONDARY entities with no group, empty associatedPrimaryIds.
      // These are discovery senders: their "from:" queries find emails, but content determines routing.
      const sharedWhos = confirmations.sharedWhos ?? [];
      for (const whoName of sharedWhos) {
        // Skip if already created as part of a group
        if (entityByName.has(whoName)) continue;

        await tx.entity.create({
          data: {
            schemaId: schema.id,
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
          schemaId: schema.id,
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
          schemaId: schema.id,
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

    return schema.id;
  });

  const durationMs = Date.now() - start;
  logger.info({
    service: "interview",
    operation: `${operation}.complete`,
    userId: options.userId,
    durationMs,
    schemaId,
    entityCount: finalEntities.length,
    tagCount: finalTags.length,
  });

  return schemaId;
}
