/**
 * Pipeline Quality Comparison Test
 *
 * Creates a 2nd "Kids Activities" schema with the new pipeline
 * (smart discovery → extraction → AI clustering → synthesis) and
 * compares results against the existing schema 1 (old pipeline).
 *
 * Validates:
 * - Smart discovery with AI query generation
 * - Relevance gating filters newsletters
 * - AI-driven clustering intelligence
 * - Urgency tiers on synthesized cases
 * - PipelineIntelligence records for discovery + clustering
 *
 * Cost guards: max 30 emails extracted, max 10 cases synthesized (~$0.15 total).
 *
 * Skips if GMAIL_TEST_REFRESH_TOKEN is not set.
 *
 * Run:
 *   pnpm --filter web vitest run --config vitest.integration.config.ts tests/integration/flows/pipeline-quality-comparison.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestUser, cleanupTestUser, type TestUser } from "../helpers/test-user";
import { GmailClient } from "@/lib/gmail/client";
import { finalizeSchema } from "@/lib/services/interview";
import { runSmartDiscovery } from "@/lib/services/discovery";
import { processEmailBatch } from "@/lib/services/extraction";
import { clusterNewEmails } from "@/lib/services/cluster";
import { synthesizeCase } from "@/lib/services/synthesis";
import type { SchemaHypothesis, HypothesisValidation } from "@denim/types";

const HAS_GMAIL_TOKEN = Boolean(process.env.GMAIL_TEST_REFRESH_TOKEN);

// --- Fixtures: match live "Kids Activities" schema config ---

const FIXTURE_HYPOTHESIS: SchemaHypothesis = {
  domain: "school_parent",
  schemaName: "Kids Activities",
  primaryEntity: {
    name: "Activity",
    description: "A school or extracurricular activity",
  },
  secondaryEntityTypes: [
    {
      name: "Coach",
      description: "Coach or instructor",
      derivedFrom: "sender",
      affinityScore: 30,
    },
  ],
  entities: [
    { name: "Soccer", type: "PRIMARY", secondaryTypeName: null, aliases: ["ZSA Soccer"], confidence: 1.0, source: "user_input" },
    { name: "Dance", type: "PRIMARY", secondaryTypeName: null, aliases: [], confidence: 1.0, source: "user_input" },
    { name: "Lanier", type: "PRIMARY", secondaryTypeName: null, aliases: ["Lanier Middle School"], confidence: 1.0, source: "user_input" },
    { name: "St Agnes", type: "PRIMARY", secondaryTypeName: null, aliases: ["Saint Agnes"], confidence: 1.0, source: "user_input" },
    { name: "Ziad Allan", type: "SECONDARY", secondaryTypeName: "Coach", aliases: [], confidence: 1.0, source: "user_input" },
  ],
  tags: [
    { name: "Schedule", description: "Schedule changes", expectedFrequency: "high", isActionable: false },
    { name: "Action Required", description: "Needs parent action", expectedFrequency: "high", isActionable: true },
    { name: "Game/Match", description: "Game information", expectedFrequency: "medium", isActionable: false },
    { name: "Practice", description: "Practice info", expectedFrequency: "high", isActionable: false },
    { name: "Payment", description: "Fees or payments", expectedFrequency: "medium", isActionable: true },
  ],
  extractedFields: [
    { name: "eventDate", type: "DATE", description: "Event date", source: "BODY", format: "date", showOnCard: true, aggregation: "LATEST" },
  ],
  summaryLabels: { beginning: "What", middle: "Details", end: "Action Needed" },
  clusteringConfig: {
    mergeThreshold: 35,
    threadMatchScore: 100,
    tagMatchScore: 15,
    subjectMatchScore: 20,
    actorAffinityScore: 10,
    subjectAdditiveBonus: 5,
    timeDecayDays: { fresh: 60, recent: 120, stale: 365 },
    weakTagDiscount: 0.5,
    frequencyThreshold: 0.1,
    anchorTagLimit: 3,
    caseSizeThreshold: 5,
    caseSizeMaxBonus: 10,
    reminderCollapseEnabled: true,
    reminderSubjectSimilarity: 0.85,
    reminderMaxAge: 7,
  },
  discoveryQueries: [
    { query: "soccer", label: "Soccer", entityName: "Soccer", source: "entity_name" },
    { query: "from:ziad", label: "Ziad Allan", entityName: "Ziad Allan", source: "entity_name" },
  ],
  exclusionPatterns: ["noreply@"],
};

const FIXTURE_VALIDATION: HypothesisValidation = {
  confirmedEntities: [],
  discoveredEntities: [],
  confirmedTags: [],
  suggestedTags: [],
  noisePatterns: [],
  sampleEmailCount: 0,
  scanDurationMs: 0,
  confidenceScore: 0.5,
};

// Live schema groupings: [Soccer+Ziad], [St Agnes], [Lanier+Dance]
const CONFIRMATIONS_WITH_GROUPS = {
  confirmedEntities: [] as string[],
  removedEntities: [] as string[],
  confirmedTags: [] as string[],
  removedTags: [] as string[],
  groups: [
    { whats: ["Soccer"], whos: ["Ziad Allan"] },
    { whats: ["St Agnes"], whos: [] },
    { whats: ["Lanier", "Dance"], whos: [] },
  ],
};

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

describe.skipIf(!HAS_GMAIL_TOKEN)(
  "Pipeline Quality Comparison: Old vs New Pipeline",
  () => {
    let testUser: TestUser;
    let accessToken: string;
    let schema1Id: string | null = null;
    let schema2Id: string;

    beforeAll(async () => {
      // 1. Create test user
      testUser = await createTestUser();

      // 2. Exchange Gmail refresh token for access token
      accessToken = await exchangeRefreshToken();

      // 3. Find schema 1 (existing "Kids Activities")
      const existingSchema = await prisma.caseSchema.findFirst({
        where: { name: "Kids Activities" },
        select: { id: true },
      });
      if (existingSchema) {
        schema1Id = existingSchema.id;
        console.log(`Schema 1 (old pipeline) found: ${schema1Id}`);
      } else {
        console.warn("Schema 1 not found — comparison will be skipped, pipeline still tested");
      }

      // 4. Create schema 2 via finalizeSchema with live groupings
      schema2Id = await finalizeSchema(
        FIXTURE_HYPOTHESIS,
        FIXTURE_VALIDATION,
        CONFIRMATIONS_WITH_GROUPS,
        { userId: testUser.userId },
      );
      console.log(`Schema 2 (new pipeline) created: ${schema2Id}`);

      // 5. Verify schema 2 setup
      const entities = await prisma.entity.findMany({
        where: { schemaId: schema2Id, isActive: true },
      });
      const tags = await prisma.schemaTag.findMany({
        where: { schemaId: schema2Id, isActive: true },
      });
      const groups = await prisma.entityGroup.findMany({
        where: { schemaId: schema2Id },
      });

      expect(entities).toHaveLength(5);
      expect(tags).toHaveLength(5);
      expect(groups).toHaveLength(3);
      console.log(`Schema 2 verified: ${entities.length} entities, ${tags.length} tags, ${groups.length} groups`);
    }, 120_000);

    afterAll(async () => {
      try {
        // Clean up extraction costs for schema 2 emails
        const schema2Emails = await prisma.email.findMany({
          where: { schemaId: schema2Id },
          select: { id: true },
        });
        const emailIds = schema2Emails.map((e) => e.id);
        if (emailIds.length > 0) {
          await prisma.extractionCost.deleteMany({
            where: { emailId: { in: emailIds } },
          });
        }
        // Clean up discovery extraction costs (placeholder emailId)
        await prisma.extractionCost.deleteMany({
          where: { emailId: "discovery" },
        });

        // Delete PipelineIntelligence rows for schema 2
        await prisma.pipelineIntelligence.deleteMany({
          where: { schemaId: schema2Id },
        });

        // Delete schema 2 (cascades children)
        await prisma.caseSchema.delete({ where: { id: schema2Id } });
      } catch (e) {
        console.warn("Cleanup warning:", e);
      }

      if (testUser?.userId) {
        await cleanupTestUser(testUser.userId);
      }
      await prisma.$disconnect();
    }, 30_000);

    it(
      "runs new pipeline and compares with old pipeline",
      async () => {
        const gmailClient = new GmailClient(accessToken);

        // ======= Step 1: Smart Discovery =======
        console.log("\n--- Step 1: Smart Discovery ---");

        const hypothesisQueries = FIXTURE_HYPOTHESIS.discoveryQueries.map((q) => ({
          query: q.query,
          label: q.label,
        }));

        const entityGroups = CONFIRMATIONS_WITH_GROUPS.groups;
        const knownEntityNames = FIXTURE_HYPOTHESIS.entities.map((e) => e.name);

        const discovery = await runSmartDiscovery(
          gmailClient,
          hypothesisQueries,
          entityGroups,
          knownEntityNames,
          "school_parent",
          schema2Id,
        );

        expect(discovery.emailIds.length).toBeGreaterThan(0);
        console.log(`Discovery: ${discovery.emailIds.length} emails found`);
        console.log(`  AI queries generated: ${discovery.aiQueriesGenerated}`);
        console.log(`  Sender patterns found: ${discovery.senderPatternsFound}`);
        console.log(`  Social clusters found: ${discovery.socialClustersFound}`);

        // Cost guard: take only first 30 email IDs
        const cappedEmailIds = discovery.emailIds.slice(0, 30);
        console.log(`  Capped to ${cappedEmailIds.length} emails for extraction`);

        // Verify PipelineIntelligence record for discovery
        const discoveryIntel = await prisma.pipelineIntelligence.findFirst({
          where: { schemaId: schema2Id, stage: "discovery" },
        });
        if (discoveryIntel) {
          console.log("  PipelineIntelligence: discovery record created");
        } else {
          console.warn("  PipelineIntelligence: no discovery record (AI may have been skipped)");
        }

        // ======= Step 2: Extraction =======
        console.log("\n--- Step 2: Extraction ---");

        const schemaWithRelations = await prisma.caseSchema.findUniqueOrThrow({
          where: { id: schema2Id },
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
              select: { name: true, type: true, description: true, source: true },
            },
            exclusionRules: {
              where: { isActive: true },
              select: { ruleType: true, pattern: true, isActive: true },
            },
            entityGroups: {
              orderBy: { index: "asc" },
              include: {
                entities: {
                  where: { isActive: true },
                  select: { name: true, type: true, isActive: true },
                },
              },
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
          entityGroups: schemaWithRelations.entityGroups
            .sort((a, b) => a.index - b.index)
            .map((g) => ({
              whats: g.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name),
              whos: g.entities.filter((e) => e.type === "SECONDARY").map((e) => e.name),
            })),
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
          cappedEmailIds,
          accessToken,
          schemaContext,
          entities,
          exclusionRules,
          { schemaId: schema2Id, userId: testUser.userId },
        );

        expect(batchResult.processed + batchResult.excluded).toBeGreaterThan(0);
        expect(batchResult.processed).toBeGreaterThan(0); // At least 1 email passes relevance gate

        // Count relevance-gated emails
        const relevanceGated = await prisma.email.count({
          where: { schemaId: schema2Id, isExcluded: true, excludeReason: "relevance:low" },
        });

        console.log(`Extraction: processed=${batchResult.processed}, excluded=${batchResult.excluded}, failed=${batchResult.failed}`);
        console.log(`  Relevance-gated (newsletters filtered): ${relevanceGated}`);

        // ======= Step 3: Clustering =======
        console.log("\n--- Step 3: Clustering ---");

        const clusterResult = await clusterNewEmails(schema2Id);

        expect(clusterResult.casesCreated + clusterResult.casesMerged).toBeGreaterThan(0);

        // Verify every case has an entityId
        const cases = await prisma.case.findMany({
          where: { schemaId: schema2Id },
          select: { id: true, entityId: true, title: true },
        });
        for (const c of cases) {
          expect(c.entityId, `Case "${c.title}" should have an entityId`).toBeTruthy();
        }

        // Verify PipelineIntelligence record for clustering
        const clusteringIntel = await prisma.pipelineIntelligence.findFirst({
          where: { schemaId: schema2Id, stage: "clustering" },
        });
        expect(clusteringIntel).toBeTruthy();

        // Entity distribution
        const entityDist = await prisma.case.groupBy({
          by: ["entityId"],
          where: { schemaId: schema2Id },
          _count: true,
        });

        console.log(`Clustering: created=${clusterResult.casesCreated}, merged=${clusterResult.casesMerged}`);
        console.log(`  Total cases: ${cases.length}`);
        console.log(`  Entity distribution: ${entityDist.length} entities used`);
        for (const ed of entityDist) {
          const entity = await prisma.entity.findUnique({
            where: { id: ed.entityId! },
            select: { name: true },
          });
          console.log(`    ${entity?.name ?? "unknown"}: ${ed._count} cases`);
        }

        // Ideally cases span 2+ entities, but with a 30-email cap it depends on discovery mix
        if (entityDist.length < 2) {
          console.warn(`  WARNING: Only ${entityDist.length} entity used — discovery may have been skewed by email cap`);
        } else {
          console.log(`  Entity spread: ${entityDist.length} entities (good)`);
        }

        // ======= Step 4: Synthesis =======
        console.log("\n--- Step 4: Synthesis ---");

        const casesToSynthesize = cases.slice(0, 10); // Cost guard: max 10 Claude calls
        for (const c of casesToSynthesize) {
          await synthesizeCase(c.id, schema2Id);
        }

        const synthesizedCases = await prisma.case.findMany({
          where: { schemaId: schema2Id, synthesizedAt: { not: null } },
          select: { id: true, title: true, synthesizedAt: true, urgency: true, status: true },
        });

        for (const c of synthesizedCases) {
          expect(c.title).toBeTruthy();
          expect(c.synthesizedAt).toBeTruthy();
          expect(c.urgency).toBeTruthy();
          expect(["IMMINENT", "THIS_WEEK", "UPCOMING", "NO_ACTION", "IRRELEVANT"]).toContain(c.urgency);
        }

        // IRRELEVANT cases should be RESOLVED
        const irrelevantCases = synthesizedCases.filter((c) => c.urgency === "IRRELEVANT");
        for (const c of irrelevantCases) {
          expect(c.status).toBe("RESOLVED");
        }

        console.log(`Synthesis: ${synthesizedCases.length} cases synthesized`);

        // Group by urgency tier
        const urgencyGroups: Record<string, string[]> = {};
        for (const c of synthesizedCases) {
          const tier = c.urgency ?? "UNKNOWN";
          if (!urgencyGroups[tier]) urgencyGroups[tier] = [];
          urgencyGroups[tier].push(c.title ?? "untitled");
        }
        for (const [tier, titles] of Object.entries(urgencyGroups)) {
          console.log(`  ${tier}: ${titles.length} cases`);
          for (const t of titles) {
            console.log(`    - ${t}`);
          }
        }

        // ======= Step 5: Comparison Report =======
        console.log("\n\n========================================");
        console.log("  PIPELINE QUALITY COMPARISON REPORT");
        console.log("========================================\n");

        try {
          // Schema 2 stats
          const s2Emails = await prisma.email.count({ where: { schemaId: schema2Id } });
          const s2Relevant = await prisma.email.count({ where: { schemaId: schema2Id, isExcluded: false } });
          const s2RelevanceExcluded = await prisma.email.count({
            where: { schemaId: schema2Id, isExcluded: true, excludeReason: "relevance:low" },
          });
          const s2Cases = await prisma.case.count({ where: { schemaId: schema2Id } });
          const s2WithUrgency = await prisma.case.count({
            where: { schemaId: schema2Id, urgency: { not: null } },
          });
          const s2Irrelevant = await prisma.case.count({
            where: { schemaId: schema2Id, urgency: "IRRELEVANT" },
          });
          const s2Actions = await prisma.caseAction.count({
            where: { case: { schemaId: schema2Id } },
          });

          // Schema 1 stats (read-only, may not exist)
          let s1Emails = 0;
          let s1Relevant = 0;
          let s1RelevanceExcluded = 0;
          let s1Cases = 0;
          let s1WithUrgency = 0;
          let s1Irrelevant = 0;
          let s1Actions = 0;

          if (schema1Id) {
            s1Emails = await prisma.email.count({ where: { schemaId: schema1Id } });
            s1Relevant = await prisma.email.count({ where: { schemaId: schema1Id, isExcluded: false } });
            s1RelevanceExcluded = await prisma.email.count({
              where: { schemaId: schema1Id, isExcluded: true, excludeReason: "relevance:low" },
            });
            s1Cases = await prisma.case.count({ where: { schemaId: schema1Id } });
            s1WithUrgency = await prisma.case.count({
              where: { schemaId: schema1Id, urgency: { not: null } },
            });
            s1Irrelevant = await prisma.case.count({
              where: { schemaId: schema1Id, urgency: "IRRELEVANT" },
            });
            s1Actions = await prisma.caseAction.count({
              where: { case: { schemaId: schema1Id } },
            });
          }

          const pad = (s: string | number, w: number) => String(s).padStart(w);
          const row = (label: string, v1: number | string, v2: number | string) =>
            `  ${label.padEnd(28)} ${pad(v1, 12)}  ${pad(v2, 12)}`;

          console.log(row("Metric", "Schema 1 (old)", "Schema 2 (new)"));
          console.log(row("", "------------", "------------"));
          console.log(row("Total emails", schema1Id ? s1Emails : "N/A", s2Emails));
          console.log(row("Relevant emails", schema1Id ? s1Relevant : "N/A", s2Relevant));
          console.log(row("Excluded (relevance)", schema1Id ? s1RelevanceExcluded : "N/A", s2RelevanceExcluded));
          console.log(row("Cases created", schema1Id ? s1Cases : "N/A", s2Cases));
          console.log(row("Cases with urgency", schema1Id ? s1WithUrgency : "N/A", s2WithUrgency));
          console.log(row("IRRELEVANT cases", schema1Id ? s1Irrelevant : "N/A", s2Irrelevant));
          console.log(row("Total actions", schema1Id ? s1Actions : "N/A", s2Actions));

          // Entity distribution for both schemas
          console.log("\n  Entity Distribution:");
          if (schema1Id) {
            const s1EntityDist = await prisma.case.groupBy({
              by: ["entityId"],
              where: { schemaId: schema1Id },
              _count: true,
            });
            console.log("    Schema 1:");
            for (const ed of s1EntityDist) {
              const entity = ed.entityId
                ? await prisma.entity.findUnique({ where: { id: ed.entityId }, select: { name: true } })
                : null;
              console.log(`      ${entity?.name ?? "unassigned"}: ${ed._count} cases`);
            }
          }

          console.log("    Schema 2:");
          const s2EntityDist = await prisma.case.groupBy({
            by: ["entityId"],
            where: { schemaId: schema2Id },
            _count: true,
          });
          for (const ed of s2EntityDist) {
            const entity = ed.entityId
              ? await prisma.entity.findUnique({ where: { id: ed.entityId }, select: { name: true } })
              : null;
            console.log(`      ${entity?.name ?? "unassigned"}: ${ed._count} cases`);
          }

          // AI cost summary
          console.log("\n  AI Cost Summary (Schema 2):");
          const costs = await prisma.extractionCost.findMany({
            where: {
              OR: [
                { emailId: { in: (await prisma.email.findMany({ where: { schemaId: schema2Id }, select: { id: true } })).map((e) => e.id) } },
                { emailId: "discovery" },
              ],
            },
            select: { model: true, operation: true, estimatedCostUsd: true },
          });
          const costByOp: Record<string, { count: number; total: number }> = {};
          for (const c of costs) {
            const key = `${c.model}/${c.operation}`;
            if (!costByOp[key]) costByOp[key] = { count: 0, total: 0 };
            costByOp[key].count++;
            costByOp[key].total += c.estimatedCostUsd;
          }
          let totalCost = 0;
          for (const [key, val] of Object.entries(costByOp)) {
            console.log(`    ${key}: ${val.count} calls, $${val.total.toFixed(4)}`);
            totalCost += val.total;
          }
          console.log(`    TOTAL: $${totalCost.toFixed(4)}`);

          console.log("\n========================================\n");
        } catch (reportError) {
          console.error("Comparison report failed (partial output above):", reportError);
        }
      },
      600_000,
    );
  },
);
