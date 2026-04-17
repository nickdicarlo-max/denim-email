/**
 * Real Gmail Pipeline Integration Test
 *
 * Proves: Gmail token → discovery → fetch → extract (live Gemini) →
 * cluster → synthesize (live Claude) all work with real email data.
 *
 * Skips gracefully if GMAIL_TEST_REFRESH_TOKEN is not configured.
 *
 * Prerequisites:
 *   - .env.local with DATABASE_URL, SUPABASE keys, ANTHROPIC_API_KEY,
 *     GOOGLE_API_KEY (Gemini), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   - GMAIL_TEST_REFRESH_TOKEN in .env.local (see docs for setup)
 *   - `pnpm --filter web prisma generate` has been run
 *
 * Run: pnpm --filter web test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GmailClient } from "@/lib/gmail/client";
import { prisma } from "@/lib/prisma";
import { clusterNewEmails } from "@/lib/services/cluster";
import { runDiscoveryQueries } from "@/lib/services/discovery";
import { processEmailBatch } from "@/lib/services/extraction";
import { synthesizeCase } from "@/lib/services/synthesis";
import { cleanupTestUser, createTestUser, type TestUser } from "../helpers/test-user";

const HAS_GMAIL_TOKEN = Boolean(process.env.GMAIL_TEST_REFRESH_TOKEN);

/**
 * Exchange a refresh token for a short-lived access token via Google OAuth.
 */
async function exchangeRefreshToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_TEST_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GMAIL_TEST_REFRESH_TOKEN in env",
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Create a minimal generic CaseSchema suitable for any Gmail account.
 * Uses broad discovery query and generic tags to avoid brittleness.
 */
async function createGenericTestSchema(userId: string) {
  const schema = await prisma.caseSchema.create({
    data: {
      userId,
      name: "Gmail Pipeline Test",
      description: "Generic schema for real Gmail pipeline integration test",
      domain: "general",
      status: "ACTIVE",
      primaryEntityConfig: {
        name: "Organization",
        description: "Organization or sender domain",
        autoDetect: true,
        internalDomains: [],
      },
      secondaryEntityConfig: [],
      discoveryQueries: [{ query: "newer_than:7d", label: "Recent emails" }],
      summaryLabels: {
        beginning: "Context",
        middle: "Details",
        end: "Status",
      },
      extractionPrompt:
        "Extract key information from emails: dates, action items, people mentioned, and topic.",
      synthesisPrompt:
        "Synthesize email threads into cases. Group by topic. Identify action items.",
      clusteringConfig: {
        mergeThreshold: 45,
        threadMatchScore: 100,
        subjectMatchScore: 20,
        actorAffinityScore: 10,
        tagMatchScore: 15,
        timeDecayDays: { fresh: 45 },
        reminderCollapseEnabled: true,
        reminderSubjectSimilarity: 0.85,
        reminderMaxAge: 7,
      },
    },
  });

  // Create a default PRIMARY entity so clustering can assign cases
  await prisma.entity.create({
    data: {
      schemaId: schema.id,
      name: "General",
      identityKey: "General",
      type: "PRIMARY",
      aliases: [],
      autoDetected: false,
      confidence: 1.0,
    },
  });

  // Generic tags that work for any email domain
  const tagNames = [
    { name: "Action Required", description: "Requires a response or action" },
    { name: "Information", description: "Informational, no action needed" },
    { name: "Notification", description: "Automated notification or alert" },
    { name: "Event", description: "Calendar event or meeting related" },
    { name: "Account", description: "Account or billing related" },
  ];

  await Promise.all(
    tagNames.map((t) =>
      prisma.schemaTag.create({
        data: {
          schemaId: schema.id,
          name: t.name,
          description: t.description,
          aiGenerated: true,
          isActive: true,
        },
      }),
    ),
  );

  return schema;
}

let testUser: TestUser;
let schemaId: string;

describe.skipIf(!HAS_GMAIL_TOKEN)(
  "Real Gmail Pipeline: Discovery → Extract → Cluster → Synthesize",
  () => {
    let accessToken: string;

    beforeAll(async () => {
      // 1. Create test user + schema
      testUser = await createTestUser();
      const schema = await createGenericTestSchema(testUser.userId);
      schemaId = schema.id;

      // 2. Exchange refresh token for access token
      accessToken = await exchangeRefreshToken();
    }, 60_000);

    afterAll(async () => {
      if (testUser?.userId) {
        await cleanupTestUser(testUser.userId);
      }
      await prisma.$disconnect();
    }, 30_000);

    it("runs the full pipeline with real Gmail data", async () => {
      // --- Step 1: Discovery ---
      const gmailClient = new GmailClient(accessToken);

      const schema = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        select: { discoveryQueries: true },
      });

      const queries = schema.discoveryQueries as Array<{
        query: string;
        label: string;
      }>;

      const discovery = await runDiscoveryQueries(gmailClient, queries, {
        maxEmails: 5,
      });

      expect(discovery.emailIds.length).toBeGreaterThan(0);
      console.log(`Discovery: found ${discovery.emailIds.length} email IDs`);

      // --- Step 2: Extraction (live Gmail fetch + live Gemini) ---
      const schemaWithRelations = await prisma.caseSchema.findUniqueOrThrow({
        where: { id: schemaId },
        include: {
          tags: {
            where: { isActive: true },
            select: { name: true, description: true, isActive: true },
          },
          entities: {
            where: { isActive: true },
            select: {
              name: true,
              type: true,
              aliases: true,
              isActive: true,
              autoDetected: true,
            },
          },
          extractedFields: {
            select: {
              name: true,
              type: true,
              description: true,
              source: true,
            },
          },
          exclusionRules: {
            where: { isActive: true },
            select: { ruleType: true, pattern: true, isActive: true },
          },
        },
      });

      const schemaContext = {
        domain: schemaWithRelations.domain ?? "general",
        tags: schemaWithRelations.tags.map((t) => ({
          name: t.name,
          description: t.description ?? "",
        })),
        entities: schemaWithRelations.entities.map((e) => ({
          name: e.name,
          type: e.type as "PRIMARY" | "SECONDARY",
          aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
          isUserInput: !e.autoDetected,
        })),
        extractedFields: schemaWithRelations.extractedFields.map((f) => ({
          name: f.name,
          type: f.type,
          description: f.description,
          source: f.source,
        })),
        exclusionPatterns: schemaWithRelations.exclusionRules.map((r) => r.pattern),
      };

      const entities = schemaWithRelations.entities.map((e) => ({
        name: e.name,
        type: e.type as "PRIMARY" | "SECONDARY",
        aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
      }));

      const exclusionRules = schemaWithRelations.exclusionRules.map((r) => ({
        ruleType: r.ruleType,
        pattern: r.pattern,
        isActive: r.isActive,
      }));

      const batchResult = await processEmailBatch(
        discovery.emailIds,
        accessToken,
        schemaContext,
        entities,
        exclusionRules,
        { schemaId, userId: testUser.userId },
      );

      expect(batchResult.processed + batchResult.excluded).toBeGreaterThan(0);
      console.log(
        `Extraction: processed=${batchResult.processed}, excluded=${batchResult.excluded}`,
      );

      // --- Step 3: Clustering ---
      const clusterResult = await clusterNewEmails(schemaId);

      expect(clusterResult.casesCreated + clusterResult.casesMerged).toBeGreaterThan(0);
      console.log(
        `Clustering: created=${clusterResult.casesCreated}, merged=${clusterResult.casesMerged}`,
      );

      // --- Step 4: Synthesis (live Claude) ---
      const cases = await prisma.case.findMany({
        where: { schemaId },
        select: { id: true },
      });

      expect(cases.length).toBeGreaterThan(0);

      for (const c of cases) {
        await synthesizeCase(c.id, schemaId);
      }

      // --- Verify final state ---
      const emails = await prisma.email.findMany({
        where: { schemaId, isExcluded: false },
        select: { id: true, summary: true },
      });

      expect(emails.length).toBeGreaterThan(0);
      for (const email of emails) {
        expect(email.summary).toBeTruthy();
      }

      const synthesizedCases = await prisma.case.findMany({
        where: { schemaId },
        select: { id: true, title: true, synthesizedAt: true },
      });

      expect(synthesizedCases.length).toBeGreaterThan(0);
      for (const c of synthesizedCases) {
        expect(c.title).toBeTruthy();
        expect(c.synthesizedAt).toBeTruthy();
      }

      console.log(`Pipeline complete: ${emails.length} emails → ${synthesizedCases.length} cases`);
    }, 600_000);
  },
);
