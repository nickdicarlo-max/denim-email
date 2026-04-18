/**
 * Eval Runner — tests the REAL production pipeline (discovery → extraction →
 * clustering → synthesis) against fixture emails using a FixtureGmailClient.
 *
 * Usage (from apps/web/):
 *   node --env-file=.env.local --import tsx/esm scripts/eval-run.ts --schema-id <ID> --fixtures ../../Denim_Samples_Individual
 *   node --env-file=.env.local --import tsx/esm scripts/eval-run.ts --create-schema --role "parent" --domain "school_parent" --whats "Lanier,St Agnes" --whos "soccer,dance" --fixtures ../../Denim_Samples_Individual
 *   node --env-file=.env.local --import tsx/esm scripts/eval-run.ts --coverage --fixtures ../../Denim_Samples_Individual
 */

import { resolve } from "node:path";
import type { EntityGroupInput } from "@denim/types";
import { FixtureGmailClient } from "../src/lib/gmail/fixture-client";
import { loadFixtures } from "../src/lib/gmail/fixture-loader";
import type { GmailMessageFull } from "../src/lib/gmail/types";
import { prisma } from "../src/lib/prisma";
import { coarseCluster, splitCoarseClusters } from "../src/lib/services/cluster";
import { runSmartDiscovery } from "../src/lib/services/discovery";
import {
  buildSchemaContext,
  extractEmail,
  processEmailBatch,
} from "../src/lib/services/extraction";
import {
  createSchemaStub,
  generateHypothesis,
  persistSchemaRelations,
  validateHypothesis,
} from "../src/lib/services/interview";
import { synthesizeCase } from "../src/lib/services/synthesis";

if (!process.env.DATABASE_URL) {
  console.error("FAILED: DATABASE_URL not set. Run from apps/web/.");
  process.exit(4);
}

async function main() {
  const args = parseArgs();

  // ── Phase 0: Load fixtures ──────────────────────────────────────
  console.error(`\n=== PHASE 0: LOADING FIXTURES ===`);
  const fixturesPath = resolve(process.cwd(), args.fixtures);
  const fixtures = loadFixtures(fixturesPath);
  console.error(`  Loaded ${fixtures.length} fixture emails`);

  if (fixtures.length === 0) {
    console.error("  No fixtures found. Check --fixtures path.");
    process.exit(1);
  }

  const dateRange = {
    earliest: fixtures[0].date.toISOString().slice(0, 10),
    latest: fixtures[fixtures.length - 1].date.toISOString().slice(0, 10),
  };
  console.error(`  Date range: ${dateRange.earliest} → ${dateRange.latest}`);

  const domainCounts = new Map<string, number>();
  for (const f of fixtures) {
    domainCounts.set(f.senderDomain, (domainCounts.get(f.senderDomain) ?? 0) + 1);
  }
  const topDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.error(`  Top sender domains:`);
  for (const [domain, count] of topDomains) {
    console.error(`    ${domain}: ${count}`);
  }

  // ── Coverage mode ───────────────────────────────────────────────
  if (args.coverage) {
    await runCoverageReport(fixtures);
    await prisma.$disconnect();
    return;
  }

  // ── Create-schema mode ──────────────────────────────────────────
  if (args.createSchema) {
    const schemaId = await runCreateSchema(fixtures, args);
    console.log(`\nSchema created: ${schemaId}`);
    console.log(`\nRun the pipeline now:`);
    console.log(
      `  node --env-file=.env.local --import tsx/esm scripts/eval-run.ts --schema-id ${schemaId} --fixtures ${args.fixtures}`,
    );
    await prisma.$disconnect();
    return;
  }

  // ── Pipeline mode (requires --schema-id) ────────────────────────
  if (!args.schemaId) {
    console.error("\nERROR: --schema-id or --create-schema is required.");
    process.exit(1);
  }

  const fixtureClient = new FixtureGmailClient(fixtures);
  const startTime = Date.now();

  // ── Phase 1: Load schema ────────────────────────────────────────
  console.error(`\n=== PHASE 1: LOADING SCHEMA ===`);

  const schema = await prisma.caseSchema.findUnique({
    where: { id: args.schemaId },
    include: {
      tags: {
        where: { isActive: true },
        select: { name: true, description: true, isActive: true },
      },
      entities: {
        where: { isActive: true },
        select: { name: true, type: true, aliases: true, isActive: true, autoDetected: true },
      },
      extractedFields: { select: { name: true, type: true, description: true, source: true } },
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

  if (!schema) {
    console.error(`  Schema ${args.schemaId} not found.`);
    process.exit(1);
  }

  console.error(`  Schema: "${schema.name}" (domain: ${schema.domain})`);
  console.error(
    `  Entities: ${schema.entities.length} (${schema.entities.filter((e) => e.type === "PRIMARY").length} primary)`,
  );
  console.error(`  Tags: ${schema.tags.length}`);
  console.error(`  Exclusion rules: ${schema.exclusionRules.length}`);

  const schemaContext = buildSchemaContext(schema);
  const entities = schema.entities
    .filter((e) => e.isActive)
    .map((e) => ({
      name: e.name,
      type: e.type as "PRIMARY" | "SECONDARY",
      aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
    }));
  const exclusionRules = schema.exclusionRules;

  // ── Phase 2: Discovery (same as production runSmartDiscovery) ───
  console.error(`\n=== PHASE 2: DISCOVERY ===`);

  const discoveryQueries = (schema.discoveryQueries ?? []) as unknown as {
    query: string;
    label: string;
  }[];
  const entityGroups: EntityGroupInput[] = schema.entityGroups.map((g) => ({
    whats: g.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name),
    whos: g.entities.filter((e) => e.type === "SECONDARY").map((e) => e.name),
  }));
  const knownEntityNames = schema.entities.map((e) => e.name);

  console.error(`  Discovery queries: ${discoveryQueries.length}`);
  for (const q of discoveryQueries.slice(0, 10)) {
    console.error(`    ${q.label}: ${q.query}`);
  }
  if (discoveryQueries.length > 10) {
    console.error(`    ... and ${discoveryQueries.length - 10} more`);
  }

  const discoveryResult = await runSmartDiscovery(
    fixtureClient as any, // FixtureGmailClient is structurally compatible
    discoveryQueries,
    entityGroups,
    knownEntityNames,
    schema.domain ?? "general",
    args.schemaId,
  );

  const discoveredIds = discoveryResult.emailIds;
  console.error(`  Discovered: ${discoveredIds.length} emails (from ${fixtures.length} fixtures)`);
  console.error(
    `  Queries run: ${discoveryResult.queriesRun}, skipped: ${discoveryResult.queriesSkipped}`,
  );

  if (discoveredIds.length === 0) {
    console.error("  No emails discovered. Check schema discovery queries.");
    await prisma.$disconnect();
    return;
  }

  // ── Phase 3: Extraction (same as production processEmailBatch) ──
  console.error(`\n=== PHASE 3: EXTRACTION (Gemini Flash 2.5) ===`);

  const BATCH_SIZE = 20;
  let processed = 0;
  let excluded = 0;
  let failed = 0;
  const failedIds: string[] = [];
  const extractionStart = Date.now();

  for (let i = 0; i < discoveredIds.length; i += BATCH_SIZE) {
    const batch = discoveredIds.slice(i, i + BATCH_SIZE);
    try {
      const result = await processEmailBatch(
        batch,
        "fixture", // accessToken placeholder — not used when injectedClient is provided
        schemaContext,
        entities,
        exclusionRules,
        { schemaId: args.schemaId },
        fixtureClient, // injected client — uses fixtures instead of Gmail API
      );
      processed += result.processed;
      excluded += result.excluded;
    } catch (err) {
      failed += batch.length;
      console.error(`  BATCH FAILED: ${(err as Error).message.slice(0, 100)}`);
    }
    const elapsed = ((Date.now() - extractionStart) / 1000).toFixed(1);
    const done = Math.min(i + BATCH_SIZE, discoveredIds.length);
    console.error(
      `  [${elapsed}s] ${done}/${discoveredIds.length} — ${processed} extracted, ${excluded} excluded, ${failed} failed`,
    );
  }

  const extractionTime = ((Date.now() - extractionStart) / 1000).toFixed(1);
  console.error(`  Extraction complete in ${extractionTime}s`);

  // ── Phase 4: Clustering ─────────────────────────────────────────
  console.error(`\n=== PHASE 4: CLUSTERING ===`);

  const clusterStart = Date.now();
  const coarseResult = await coarseCluster(args.schemaId);
  console.error(
    `  Pass 1 (coarse): ${coarseResult.casesCreated} created, ${coarseResult.casesMerged} merged`,
  );

  const splitResult = await splitCoarseClusters(args.schemaId);
  console.error(`  Pass 2 (split): ${splitResult.casesCreated} created`);

  const clusterTime = ((Date.now() - clusterStart) / 1000).toFixed(1);
  console.error(`  Clustering complete in ${clusterTime}s`);

  // ── Phase 5: Synthesis (real Claude) ────────────────────────────
  console.error(`\n=== PHASE 5: SYNTHESIS (Claude Sonnet) ===`);

  const cases = await prisma.case.findMany({
    where: { schemaId: args.schemaId, status: "OPEN" },
    select: { id: true },
  });
  console.error(`  ${cases.length} cases to synthesize`);

  const synthStart = Date.now();
  let synthOk = 0;
  let synthFail = 0;

  for (const [idx, c] of cases.entries()) {
    try {
      await synthesizeCase(c.id, args.schemaId);
      synthOk++;
    } catch (err) {
      synthFail++;
      console.error(`  FAILED case ${c.id.slice(-8)}: ${(err as Error).message.slice(0, 100)}`);
    }
    if ((idx + 1) % 5 === 0 || idx === cases.length - 1) {
      const elapsed = ((Date.now() - synthStart) / 1000).toFixed(1);
      console.error(`  [${elapsed}s] ${idx + 1}/${cases.length} synthesized`);
    }
  }

  const synthTime = ((Date.now() - synthStart) / 1000).toFixed(1);

  // ── Phase 6: Quality Report ─────────────────────────────────────
  console.error(`\n=== PHASE 6: QUALITY REPORT ===\n`);

  const fullCases = await prisma.case.findMany({
    where: { schemaId: args.schemaId },
    include: {
      caseEmails: { select: { emailId: true } },
      actions: { select: { id: true } },
    },
  });

  const emailsPerCase = fullCases.map((c) => c.caseEmails.length);
  const totalCaseEmails = emailsPerCase.reduce((a, b) => a + b, 0);

  const urgencyDist = new Map<string, number>();
  for (const c of fullCases) {
    urgencyDist.set(c.urgency ?? "UNKNOWN", (urgencyDist.get(c.urgency ?? "UNKNOWN") ?? 0) + 1);
  }

  const casesWithEntity = fullCases.filter((c) => c.entityId).length;

  const schemaEmails = await prisma.email.findMany({
    where: { schemaId: args.schemaId },
    select: { id: true },
  });
  const schemaEmailIds = schemaEmails.map((e) => e.id);
  const costs = await prisma.extractionCost.aggregate({
    where: { emailId: { in: schemaEmailIds } },
    _sum: { estimatedCostUsd: true },
    _count: true,
  });

  const exclusionReasons = await prisma.email.groupBy({
    by: ["excludeReason"],
    where: { schemaId: args.schemaId, isExcluded: true },
    _count: true,
  });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  const claimedEmails = await prisma.email.findMany({
    where: { schemaId: args.schemaId, isExcluded: false },
    select: { gmailMessageId: true },
  });
  const claimedIds = new Set(claimedEmails.map((e) => e.gmailMessageId));

  // Print report
  console.log(`Schema: "${schema.name}" (${args.schemaId.slice(-8)})`);
  console.log(`Domain: ${schema.domain}`);
  console.log(`─────────────────────────────────────`);
  console.log(`Fixtures:     ${fixtures.length}`);
  console.log(
    `Discovered:   ${discoveredIds.length} (${pct(discoveredIds.length, fixtures.length)} of fixtures)`,
  );
  console.log(`Extracted:    ${processed}`);
  console.log(`Excluded:     ${excluded}`);
  console.log(`Failed:       ${failed}`);
  if (exclusionReasons.length > 0) {
    console.log(`  Exclusion breakdown:`);
    for (const r of exclusionReasons) {
      console.log(`    ${r.excludeReason ?? "null"}: ${r._count}`);
    }
  }
  console.log(`─────────────────────────────────────`);
  if (fullCases.length > 0) {
    console.log(`Cases:        ${fullCases.length}`);
    console.log(
      `  with entity:  ${casesWithEntity}/${fullCases.length} (${pct(casesWithEntity, fullCases.length)})`,
    );
    console.log(
      `  with actions: ${fullCases.filter((c) => c.actions.length > 0).length}/${fullCases.length}`,
    );
    console.log(
      `  emails/case:  min=${Math.min(...emailsPerCase)} avg=${(totalCaseEmails / fullCases.length).toFixed(1)} max=${Math.max(...emailsPerCase)}`,
    );
    console.log(`  Urgency:`);
    for (const [urgency, count] of [...urgencyDist.entries()].sort()) {
      console.log(`    ${urgency}: ${count}`);
    }
  } else {
    console.log(`Cases:        0`);
  }
  console.log(`─────────────────────────────────────`);
  console.log(`Synthesis:    ${synthOk} ok, ${synthFail} failed`);
  const totalCost = costs._sum?.estimatedCostUsd ?? 0;
  console.log(`AI cost:      $${totalCost.toFixed(4)} (${costs._count} calls)`);
  console.log(`─────────────────────────────────────`);
  console.log(
    `Coverage:     ${claimedIds.size}/${fixtures.length} fixtures claimed (${pct(claimedIds.size, fixtures.length)})`,
  );
  console.log(`─────────────────────────────────────`);
  console.log(
    `Time: discovery=${((Date.now() - startTime) / 1000 - Number.parseFloat(extractionTime) - Number.parseFloat(clusterTime) - Number.parseFloat(synthTime)).toFixed(1)}s extraction=${extractionTime}s clustering=${clusterTime}s synthesis=${synthTime}s total=${totalTime}s`,
  );

  if (failedIds.length > 0) {
    console.log(`\nFailed fixture IDs:`);
    for (const id of failedIds) {
      console.log(`  ${id}`);
    }
  }

  await prisma.$disconnect();
}

// ── Create Schema ───────────────────────────────────────────────────

async function runCreateSchema(
  fixtures: GmailMessageFull[],
  args: ReturnType<typeof parseArgs>,
): Promise<string> {
  console.error(`\n=== CREATE SCHEMA FROM FIXTURES ===`);

  const EVAL_USER_ID = args.userId ?? "eval-fixture-user";
  const EVAL_USER_EMAIL = "eval@fixture.local";

  await prisma.user.upsert({
    where: { id: EVAL_USER_ID },
    create: { id: EVAL_USER_ID, email: EVAL_USER_EMAIL, displayName: "Eval User" },
    update: {},
  });
  console.error(`  User: ${EVAL_USER_ID}`);

  const role = args.role ?? "general";
  const domain = args.domain ?? "general";
  const whats = args.whats
    ? args.whats
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const whos = args.whos
    ? args.whos
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const groups =
    whats.length > 0
      ? whats.map((w) => ({ whats: [w], whos }))
      : whos.length > 0
        ? [{ whats: [], whos }]
        : [];

  const sampleSubjects = fixtures.slice(0, 50).map((f) => f.subject);
  const sampleSenders = [
    ...new Set(fixtures.map((f) => f.senderDisplayName || f.senderEmail)),
  ].slice(0, 30);

  const interviewInput = {
    role,
    domain,
    whats,
    whos,
    groups,
    sharedWhos: whos,
    goals: [
      `Organize my ${role} emails into actionable cases`,
      `Sample subjects: ${sampleSubjects.slice(0, 10).join("; ")}`,
      `Common senders: ${sampleSenders.slice(0, 10).join(", ")}`,
    ],
  };

  if (whats.length > 0) console.error(`  WHATs (primary entities): ${whats.join(", ")}`);
  if (whos.length > 0) console.error(`  WHOs (secondary entities): ${whos.join(", ")}`);
  console.error(`  Role: ${role} | Domain: ${domain}`);
  console.error(`  Generating hypothesis via Claude...`);

  const hypothesis = await generateHypothesis(interviewInput, { userId: EVAL_USER_ID });
  console.error(`  Hypothesis: "${hypothesis.schemaName}"`);
  console.error(
    `    Entities: ${hypothesis.entities.length} (${hypothesis.entities.filter((e: any) => e.type === "PRIMARY").length} primary)`,
  );
  console.error(`    Tags: ${hypothesis.tags.length}`);

  const emailSamples = fixtures.slice(0, 30).map((f) => ({
    subject: f.subject,
    senderDomain: f.senderDomain,
    senderName: f.senderDisplayName || f.senderEmail,
    snippet: f.snippet || f.body.slice(0, 200),
  }));

  console.error(`  Validating hypothesis against ${emailSamples.length} email samples...`);
  const validation = await validateHypothesis(hypothesis, emailSamples, { userId: EVAL_USER_ID });
  console.error(`    Confirmed entities: ${validation.confirmedEntities.length}`);
  console.error(`    Discovered entities: ${validation.discoveredEntities.length}`);
  console.error(`    Confirmed tags: ${validation.confirmedTags.length}`);
  console.error(`    Suggested tags: ${validation.suggestedTags.length}`);

  const schemaId = await createSchemaStub({ userId: EVAL_USER_ID, inputs: interviewInput });

  // Only accept hypothesis entities + user-provided entities.
  // Skip validation-discovered entities — in real onboarding, the user
  // reviews those. Without human review, they pollute the schema
  // (e.g., Vanguard, Capital One discovered as "senders").
  const confirmations = {
    confirmedEntities: hypothesis.entities.map((e: any) => e.name),
    removedEntities: [] as string[],
    confirmedTags: [
      ...hypothesis.tags.map((t: any) => t.name),
      ...(validation.suggestedTags?.map((t: any) => t.name) ?? []),
    ],
    removedTags: [] as string[],
  };

  await persistSchemaRelations(schemaId, hypothesis, validation, confirmations);

  await prisma.caseSchema.update({
    where: { id: schemaId },
    data: { status: "ACTIVE", phase: "COMPLETED" },
  });

  console.error(`  Schema ${schemaId} created and activated.`);
  return schemaId;
}

// ── Coverage Report ─────────────────────────────────────────────────

async function runCoverageReport(
  fixtures: {
    id: string;
    subject: string;
    senderDomain: string;
    senderEmail: string;
    date: Date;
  }[],
) {
  console.error(`\n=== CROSS-SCHEMA COVERAGE REPORT ===\n`);

  const schemas = await prisma.caseSchema.findMany({
    where: { status: { not: "ARCHIVED" } },
    select: { id: true, name: true, domain: true },
  });

  if (schemas.length === 0) {
    console.log("No active schemas found.");
    return;
  }

  const fixtureIds = new Set(fixtures.map((f) => f.id));
  const claimedBy = new Map<string, string[]>();

  console.log(`Schemas: ${schemas.length}`);
  console.log(`Fixtures: ${fixtures.length}`);
  console.log(`─────────────────────────────────────`);

  for (const schema of schemas) {
    const emails = await prisma.email.findMany({
      where: { schemaId: schema.id, isExcluded: false },
      select: { gmailMessageId: true },
    });

    const excludedCount = await prisma.email.count({
      where: { schemaId: schema.id, isExcluded: true },
    });

    const caseCount = await prisma.case.count({ where: { schemaId: schema.id } });

    const claimed = emails.filter((e) => fixtureIds.has(e.gmailMessageId));
    for (const e of claimed) {
      const existing = claimedBy.get(e.gmailMessageId) ?? [];
      existing.push(schema.name);
      claimedBy.set(e.gmailMessageId, existing);
    }

    console.log(`\n  "${schema.name}" (${schema.domain})`);
    console.log(
      `    Claimed: ${claimed.length} | Excluded: ${excludedCount} | Cases: ${caseCount}`,
    );
  }

  const allClaimed = new Set(claimedBy.keys());
  const unclaimed = fixtures.filter((f) => !allClaimed.has(f.id));
  const overlap = [...claimedBy.entries()].filter(([, schemas]) => schemas.length > 1);

  console.log(`\n─────────────────────────────────────`);
  console.log(
    `Total claimed:    ${allClaimed.size}/${fixtures.length} (${pct(allClaimed.size, fixtures.length)})`,
  );
  console.log(`Overlap (2+ schemas): ${overlap.length}`);
  console.log(`Unclaimed:        ${unclaimed.length}`);

  if (unclaimed.length > 0) {
    const unclaimedDomains = new Map<string, number>();
    for (const f of unclaimed) {
      unclaimedDomains.set(f.senderDomain, (unclaimedDomains.get(f.senderDomain) ?? 0) + 1);
    }
    const topUnclaimed = [...unclaimedDomains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

    console.log(`\n  Unclaimed by sender domain (top 15):`);
    for (const [domain, count] of topUnclaimed) {
      console.log(`    ${domain}: ${count}`);
    }

    const unclaimedDates = unclaimed.map((f) => f.date).sort((a, b) => a.getTime() - b.getTime());
    console.log(
      `  Unclaimed date range: ${unclaimedDates[0].toISOString().slice(0, 10)} → ${unclaimedDates[unclaimedDates.length - 1].toISOString().slice(0, 10)}`,
    );

    console.log(`\n  Sample unclaimed subjects:`);
    for (const f of unclaimed.slice(0, 10)) {
      console.log(`    [${f.senderDomain}] ${f.subject.slice(0, 70)}`);
    }
    if (unclaimed.length > 10) {
      console.log(`    ... and ${unclaimed.length - 10} more`);
    }
  }
}

// ── CLI Helpers ──────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let schemaId: string | undefined;
  let fixtures = "../../Denim_Samples_Individual";
  let coverage = false;
  let createSchema = false;
  let role: string | undefined;
  let domain: string | undefined;
  let userId: string | undefined;
  let whats: string | undefined;
  let whos: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--schema-id" && args[i + 1]) {
      schemaId = args[++i];
    } else if (args[i] === "--fixtures" && args[i + 1]) {
      fixtures = args[++i];
    } else if (args[i] === "--coverage") {
      coverage = true;
    } else if (args[i] === "--create-schema") {
      createSchema = true;
    } else if (args[i] === "--role" && args[i + 1]) {
      role = args[++i];
    } else if (args[i] === "--domain" && args[i + 1]) {
      domain = args[++i];
    } else if (args[i] === "--user-id" && args[i + 1]) {
      userId = args[++i];
    } else if (args[i] === "--whats" && args[i + 1]) {
      whats = args[++i];
    } else if (args[i] === "--whos" && args[i + 1]) {
      whos = args[++i];
    }
  }

  return { schemaId, fixtures, coverage, createSchema, role, domain, userId, whats, whos };
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

// ── Run ──────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
