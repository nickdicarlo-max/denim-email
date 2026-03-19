import { GmailClient } from "@/lib/gmail/client";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";
import { runDiscoveryQueries } from "@/lib/services/discovery";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { finalizeSchema } from "@/lib/services/interview";
import { FinalizeConfirmationsSchema } from "@/lib/validation/interview";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();
    const { hypothesis, validation, confirmations: rawConfirmations } = body;

    if (!hypothesis || !validation || !rawConfirmations) {
      return NextResponse.json(
        {
          error: "Missing required fields: hypothesis, validation, confirmations",
        },
        { status: 400 },
      );
    }

    // Validate and sanitize confirmations (including groups)
    const parseResult = FinalizeConfirmationsSchema.safeParse(rawConfirmations);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: `Invalid confirmations: ${parseResult.error.issues.map((i) => i.message).join("; ")}` },
        { status: 400 },
      );
    }
    const confirmations = parseResult.data;

    const schemaId = await finalizeSchema(hypothesis, validation, confirmations, { userId });

    // Trigger extraction pipeline: discover emails and emit Inngest event
    try {
      const schema = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { discoveryQueries: true },
      });

      const accessToken = await getValidGmailToken(userId);
      const gmailClient = new GmailClient(accessToken);

      const queries = schema.discoveryQueries as Array<{ query: string; label: string }>;
      const { emailIds } = await runDiscoveryQueries(gmailClient, queries);

      if (emailIds.length > 0) {
        const scanJob = await prisma.scanJob.create({
          data: {
            userId,
            schemaId,
            status: "PENDING",
            phase: "DISCOVERING",
            totalEmails: emailIds.length,
            triggeredBy: "onboarding",
            statusMessage: `Found ${emailIds.length} emails`,
          },
        });

        await inngest.send({
          name: "scan.emails.discovered",
          data: { schemaId, userId, scanJobId: scanJob.id, emailIds },
        });

        logger.info({
          service: "interview",
          operation: "finalize.triggerExtraction",
          schemaId,
          userId,
          scanJobId: scanJob.id,
          emailCount: emailIds.length,
        });
      }
    } catch (extractionError) {
      // Non-fatal: schema is created, extraction can be triggered manually later
      logger.error({
        service: "interview",
        operation: "finalize.triggerExtraction.error",
        schemaId,
        userId,
        error: extractionError,
      });
    }

    return NextResponse.json({ data: { schemaId } });
  } catch (error) {
    return handleApiError(error, {
      service: "interview",
      operation: "finalize",
      userId,
    });
  }
});
