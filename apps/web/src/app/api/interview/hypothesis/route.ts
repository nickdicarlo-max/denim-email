import type { HypothesisValidation } from "@denim/types";
import { NextResponse } from "next/server";
import { GmailClient } from "@/lib/gmail/client";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { runSmartDiscovery } from "@/lib/services/discovery";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { finalizeSchema, generateHypothesis } from "@/lib/services/interview";

/**
 * POST /api/interview/hypothesis
 *
 * Simplified onboarding endpoint: generates a schema hypothesis from interview
 * input, finalizes it into a CaseSchema (no separate review step), and triggers
 * email discovery + extraction. Returns the new schemaId so the client can
 * navigate to the scanning page.
 */
// Window during which a fresh POST is treated as a duplicate of an in-flight
// onboarding instead of starting a new schema. Slightly longer than the
// realistic worst-case scan time so that any user refresh during onboarding
// resumes in place rather than spawning a parallel pipeline.
const ONBOARDING_DEDUP_WINDOW_MS = 15 * 60 * 1000;

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();

    // Idempotency: if the user already has a recent ONBOARDING schema, return
    // its id instead of generating a duplicate. Eval session 1 (#14) showed
    // that without this guard, a user refresh during the loading state
    // multiplied the schema count and burned ~6x the expected AI cost.
    const existing = await prisma.caseSchema.findFirst({
      where: {
        userId,
        status: "ONBOARDING",
        createdAt: { gte: new Date(Date.now() - ONBOARDING_DEDUP_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (existing) {
      logger.info({
        service: "interview",
        operation: "hypothesis.idempotent.hit",
        userId,
        schemaId: existing.id,
      });
      return NextResponse.json({ data: { schemaId: existing.id } });
    }

    // Step 1: Generate hypothesis from input (calls Claude)
    const hypothesis = await generateHypothesis(body, { userId });

    // Step 2: Finalize the schema directly with empty validation/confirmations.
    // The simplified onboarding doesn't have a separate validation step — we
    // trust the hypothesis entities/tags as-is and let the user adjust on the
    // review page after scanning completes.
    const emptyValidation: HypothesisValidation = {
      confirmedEntities: [],
      discoveredEntities: [],
      confirmedTags: [],
      suggestedTags: [],
      noisePatterns: [],
      sampleEmailCount: 0,
      scanDurationMs: 0,
      confidenceScore: 1,
    };

    const schemaId = await finalizeSchema(
      hypothesis,
      emptyValidation,
      {
        confirmedEntities: [],
        removedEntities: [],
        confirmedTags: [],
        removedTags: [],
      },
      { userId },
    );

    // Step 3: Trigger discovery + extraction pipeline (best-effort)
    try {
      const schema = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: {
          domain: true,
          discoveryQueries: true,
          entityGroups: {
            orderBy: { index: "asc" },
            include: {
              entities: {
                where: { isActive: true },
                select: { name: true, type: true },
              },
            },
          },
          entities: {
            where: { isActive: true },
            select: { name: true },
          },
        },
      });

      const accessToken = await getValidGmailToken(userId);
      const gmailClient = new GmailClient(accessToken);

      const queries = schema.discoveryQueries as Array<{ query: string; label: string }>;
      const entityGroups = schema.entityGroups.map((g) => ({
        whats: g.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name),
        whos: g.entities.filter((e) => e.type === "SECONDARY").map((e) => e.name),
      }));
      const knownEntityNames = schema.entities.map((e) => e.name);

      const { emailIds } = await runSmartDiscovery(
        gmailClient,
        queries,
        entityGroups,
        knownEntityNames,
        schema.domain ?? "general",
        schemaId,
      );

      if (emailIds.length > 0) {
        const scanJob = await prisma.scanJob.create({
          data: {
            userId,
            schemaId,
            status: "PENDING",
            phase: "DISCOVERING",
            totalEmails: emailIds.length,
            triggeredBy: "ONBOARDING",
            statusMessage: `Found ${emailIds.length} emails`,
          },
        });

        await inngest.send({
          name: "scan.emails.discovered",
          data: { schemaId, userId, scanJobId: scanJob.id, emailIds },
        });

        logger.info({
          service: "interview",
          operation: "hypothesis.triggerExtraction",
          schemaId,
          userId,
          scanJobId: scanJob.id,
          emailCount: emailIds.length,
        });
      }
    } catch (extractionError) {
      // Non-fatal: schema is created, scanning page can show "no emails found"
      logger.error({
        service: "interview",
        operation: "hypothesis.triggerExtraction.error",
        schemaId,
        userId,
        error: extractionError,
      });
    }

    return NextResponse.json({ data: { schemaId } });
  } catch (error) {
    return handleApiError(error, {
      service: "interview",
      operation: "hypothesis",
      userId,
    });
  }
});
