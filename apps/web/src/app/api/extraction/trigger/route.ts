import { withAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { GmailClient } from "@/lib/gmail/client";
import { runSmartDiscovery } from "@/lib/services/discovery";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { z } from "zod";

const TriggerSchema = z.object({
  schemaId: z.string().min(1),
});

export const POST = withAuth(async ({ userId, request }) => {
  const body = await request.json();
  const parsed = TriggerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { schemaId } = parsed.data;

  // Verify schema belongs to user and load entity groups for smart discovery
  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId },
    select: {
      id: true,
      userId: true,
      domain: true,
      discoveryQueries: true,
      status: true,
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

  if (!schema || schema.userId !== userId) {
    return NextResponse.json({ error: "Schema not found" }, { status: 404 });
  }

  // Get Gmail token
  const accessToken = await getValidGmailToken(userId);
  const gmailClient = new GmailClient(accessToken);

  // Run smart discovery: broad scan → social graph → body sampling → AI queries
  const queries = schema.discoveryQueries as Array<{
    query: string;
    label: string;
  }>;

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

  if (emailIds.length === 0) {
    return NextResponse.json(
      { error: "No emails found matching discovery queries" },
      { status: 404 },
    );
  }

  // Create ScanJob
  const scanJob = await prisma.scanJob.create({
    data: {
      userId,
      schemaId,
      status: "PENDING",
      phase: "DISCOVERING",
      totalEmails: emailIds.length,
      triggeredBy: "manual",
      statusMessage: `Found ${emailIds.length} emails`,
    },
  });

  // Emit event to start extraction pipeline
  await inngest.send({
    name: "scan.emails.discovered",
    data: {
      schemaId,
      userId,
      scanJobId: scanJob.id,
      emailIds,
    },
  });

  logger.info({
    service: "api",
    operation: "extraction.trigger",
    schemaId,
    userId,
    scanJobId: scanJob.id,
    emailCount: emailIds.length,
  });

  return NextResponse.json({
    scanJobId: scanJob.id,
    emailCount: emailIds.length,
  });
});
