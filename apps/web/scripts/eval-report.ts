/**
 * Post-pipeline eval report — scorecard + CSV export for pivot table analysis.
 *
 * Produces:
 *   1. Console scorecard with pass/fail thresholds
 *   2. CSV: docs/test-results/eval-{schemaName}-included.csv  (emails in cases)
 *   3. CSV: docs/test-results/eval-{schemaName}-excluded.csv  (excluded + orphaned emails)
 *
 * Usage (from apps/web/):
 *   npx tsx scripts/eval-report.ts                    # all schemas
 *   npx tsx scripts/eval-report.ts --schema-id <id>   # specific schema
 *   npx tsx scripts/eval-report.ts --latest           # most recently created schema
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), ".env.local") });

if (!process.env.DATABASE_URL) {
  console.error("FAILED: DATABASE_URL not set. Run from apps/web/.");
  process.exit(4);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const schemaIdArg = args.includes("--schema-id") ? args[args.indexOf("--schema-id") + 1] : null;
const latestArg = args.includes("--latest");
const outputDir = resolve(process.cwd(), "../../docs/test-results");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = (s: string) => process.stderr.write(s + "\n");

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: unknown[]): string {
  return fields.map(csvEscape).join(",");
}

// ---------------------------------------------------------------------------
// Thresholds (derived from April 11-12 investigation)
// ---------------------------------------------------------------------------

const THRESHOLDS = {
  orphanRate: { warn: 0.1, fail: 0.25, label: "Orphan rate (emails with entity but no case)" },
  singletonRate: { warn: 0.5, fail: 0.7, label: "Singleton rate (cases with 1 email)" },
  mergeRate: { warn: 0.0, fail: -1, label: "Merge cluster records (should be >0)" },
  exclusionRate: { warn: 0.7, fail: 0.85, label: "Exclusion rate (excluded/total)" },
  tagCoverage: { warn: 0.5, fail: 0.2, label: "Tag coverage (cases with non-empty displayTags)" },
  caseSplitVisibility: { warn: 0, fail: -1, label: "Case-splitting PipelineIntelligence rows" },
};

type Grade = "PASS" | "WARN" | "FAIL";
function grade(
  value: number,
  threshold: { warn: number; fail: number },
  lowerIsBetter = true,
): Grade {
  if (lowerIsBetter) {
    if (value > threshold.fail && threshold.fail >= 0) return "FAIL";
    if (value > threshold.warn) return "WARN";
    return "PASS";
  }
  // higher is better
  if (value < threshold.fail && threshold.fail >= 0) return "FAIL";
  if (value < threshold.warn) return "WARN";
  return "PASS";
}

function gradeEmoji(g: Grade): string {
  return g === "PASS" ? "[PASS]" : g === "WARN" ? "[WARN]" : "[FAIL]";
}

// ---------------------------------------------------------------------------
// Main report for a single schema
// ---------------------------------------------------------------------------

async function reportSchema(schemaId: string) {
  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId },
    select: {
      id: true,
      name: true,
      domain: true,
      clusteringConfig: true,
      createdAt: true,
    },
  });
  if (!schema) {
    log(`Schema ${schemaId} not found`);
    return;
  }

  const config = schema.clusteringConfig as Record<string, unknown> | null;
  const schemaLabel = `${schema.name} (${schema.domain ?? "unknown"})`;

  log("\n" + "=".repeat(72));
  log(`EVAL REPORT: ${schemaLabel}`);
  log(`Schema ID: ${schema.id}`);
  log(`Created: ${schema.createdAt.toISOString()}`);
  if (config) {
    log(
      `Clustering config: mergeThreshold=${config.mergeThreshold}, reminderCollapse=${config.reminderCollapseEnabled}`,
    );
  }
  log("=".repeat(72));

  // ---- 1. Email distribution ----

  const totalEmails = await prisma.email.count({ where: { schemaId } });
  const excludedEmails = await prisma.email.count({ where: { schemaId, isExcluded: true } });
  const includedEmails = await prisma.email.count({ where: { schemaId, isExcluded: false } });
  const withEntity = await prisma.email.count({
    where: { schemaId, isExcluded: false, entityId: { not: null } },
  });
  const withoutEntity = await prisma.email.count({
    where: { schemaId, isExcluded: false, entityId: null },
  });

  log("\n--- EMAIL DISTRIBUTION ---");
  log(`  Total discovered:    ${totalEmails}`);
  log(`  Excluded:            ${excludedEmails} (${pct(excludedEmails, totalEmails)})`);
  log(`  Included:            ${includedEmails} (${pct(includedEmails, totalEmails)})`);
  log(`  With entity:         ${withEntity}`);
  log(`  Without entity:      ${withoutEntity}`);

  const exclusionGrade = grade(excludedEmails / Math.max(totalEmails, 1), THRESHOLDS.exclusionRate);
  log(
    `  ${gradeEmoji(exclusionGrade)} ${THRESHOLDS.exclusionRate.label}: ${pct(excludedEmails, totalEmails)}`,
  );

  // Exclusion reason breakdown
  const exclusionReasons = await prisma.email.groupBy({
    by: ["excludeReason"],
    where: { schemaId, isExcluded: true },
    _count: true,
  });
  if (exclusionReasons.length > 0) {
    log("  Exclusion reasons:");
    for (const r of exclusionReasons) {
      log(`    ${r.excludeReason ?? "(no reason)"}: ${r._count}`);
    }
  }

  // ---- 2. Entity distribution ----

  const entities = await prisma.entity.findMany({
    where: { schemaId },
    select: { id: true, name: true, type: true, isActive: true, emailCount: true },
    orderBy: { emailCount: "desc" },
  });
  log("\n--- ENTITIES ---");
  for (const e of entities) {
    const active = e.isActive ? "" : " [INACTIVE]";
    log(`  ${e.name} (${e.type}): ${e.emailCount} emails${active}`);
  }

  // ---- 3. Case quality ----

  const cases = await prisma.case.findMany({
    where: { schemaId },
    select: {
      id: true,
      title: true,
      entityId: true,
      status: true,
      urgency: true,
      displayTags: true,
      allTags: true,
      startDate: true,
      lastEmailDate: true,
      _count: { select: { caseEmails: true } },
    },
    orderBy: { lastEmailDate: "desc" },
  });

  const totalCases = cases.length;
  const singletons = cases.filter((c) => c._count.caseEmails === 1).length;
  const emailsInCases = cases.reduce((s, c) => s + c._count.caseEmails, 0);
  const orphans = withEntity - emailsInCases;
  const casesWithTags = cases.filter((c) => {
    const tags = c.displayTags;
    return Array.isArray(tags) && tags.length > 0;
  }).length;

  log("\n--- CASE QUALITY ---");
  log(`  Total cases:         ${totalCases}`);
  log(`  Emails in cases:     ${emailsInCases}`);
  log(`  Orphaned (entity set, no case): ${orphans}`);
  log(`  Singletons:          ${singletons} of ${totalCases}`);
  log(`  Cases with tags:     ${casesWithTags} of ${totalCases}`);

  const orphanRate = orphans / Math.max(withEntity, 1);
  const singletonRate = singletons / Math.max(totalCases, 1);
  const tagCoverage = casesWithTags / Math.max(totalCases, 1);

  const orphanGrade = grade(orphanRate, THRESHOLDS.orphanRate);
  const singletonGrade = grade(singletonRate, THRESHOLDS.singletonRate);
  const tagGrade = grade(tagCoverage, THRESHOLDS.tagCoverage, false);

  log(`  ${gradeEmoji(orphanGrade)} ${THRESHOLDS.orphanRate.label}: ${pct(orphans, withEntity)}`);
  log(
    `  ${gradeEmoji(singletonGrade)} ${THRESHOLDS.singletonRate.label}: ${pct(singletons, totalCases)}`,
  );
  log(
    `  ${gradeEmoji(tagGrade)} ${THRESHOLDS.tagCoverage.label}: ${pct(casesWithTags, totalCases)}`,
  );

  // Emails-per-case distribution
  const emailCounts = cases.map((c) => c._count.caseEmails).sort((a, b) => b - a);
  log(`  Emails/case: ${emailCounts.join(", ")}`);

  // ---- 4. Cluster records ----

  const clusterRecords = await prisma.cluster.findMany({
    where: { schemaId },
    select: { action: true, clusterPass: true, score: true },
  });
  const creates = clusterRecords.filter((c) => c.action === "CREATE");
  const merges = clusterRecords.filter((c) => c.action === "MERGE");
  const coarse = clusterRecords.filter((c) => c.clusterPass === "COARSE");
  const splits = clusterRecords.filter((c) => c.clusterPass === "SPLIT");

  log("\n--- CLUSTERING ---");
  log(`  Total cluster records: ${clusterRecords.length}`);
  log(
    `  COARSE: ${coarse.length} (CREATE: ${creates.filter((c) => coarse.some((co) => co === c)).length}, MERGE: ${merges.filter((c) => coarse.some((co) => co === c)).length})`,
  );
  log(`  SPLIT:  ${splits.length}`);

  const mergeGrade = merges.length > 0 ? ("PASS" as Grade) : ("WARN" as Grade);
  log(`  ${gradeEmoji(mergeGrade)} ${THRESHOLDS.mergeRate.label}: ${merges.length}`);

  if (merges.length > 0) {
    const mergeScores = merges.map((m) => m.score ?? 0).sort((a, b) => b - a);
    log(
      `  Merge scores: min=${mergeScores[mergeScores.length - 1]?.toFixed(1)}, max=${mergeScores[0]?.toFixed(1)}, median=${mergeScores[Math.floor(mergeScores.length / 2)]?.toFixed(1)}`,
    );
  }

  // ---- 5. Case-splitting visibility ----

  const splitIntel = await prisma.pipelineIntelligence.count({
    where: { schemaId, stage: "case-splitting" },
  });
  const splitGrade = splitIntel > 0 ? ("PASS" as Grade) : ("WARN" as Grade);
  log("\n--- CASE SPLITTING ---");
  log(`  ${gradeEmoji(splitGrade)} ${THRESHOLDS.caseSplitVisibility.label}: ${splitIntel}`);

  // ---- 6. Urgency distribution ----

  const urgencyDist = await prisma.case.groupBy({
    by: ["urgency"],
    where: { schemaId },
    _count: true,
    orderBy: { _count: { urgency: "desc" } },
  });
  log("\n--- URGENCY DISTRIBUTION ---");
  for (const u of urgencyDist) {
    log(`  ${u.urgency ?? "null"}: ${u._count}`);
  }

  // ---- 7. Scan job timing ----

  const scanJob = await prisma.scanJob.findFirst({
    where: { schemaId },
    select: {
      id: true,
      status: true,
      phase: true,
      totalEmails: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  if (scanJob) {
    const duration =
      scanJob.startedAt && scanJob.completedAt
        ? ((scanJob.completedAt.getTime() - scanJob.startedAt.getTime()) / 1000).toFixed(1) + "s"
        : "N/A";
    log("\n--- SCAN JOB ---");
    log(`  Status: ${scanJob.status} | Phase: ${scanJob.phase}`);
    log(`  Total emails: ${scanJob.totalEmails} | Duration: ${duration}`);
  }

  // ---- 8. Export CSVs ----

  await exportCSVs(schemaId, schema.name ?? "unknown");

  // ---- Summary ----

  const grades = [exclusionGrade, orphanGrade, singletonGrade, tagGrade, mergeGrade, splitGrade];
  const fails = grades.filter((g) => g === "FAIL").length;
  const warns = grades.filter((g) => g === "WARN").length;
  const passes = grades.filter((g) => g === "PASS").length;

  log("\n--- SUMMARY ---");
  log(`  ${passes} PASS, ${warns} WARN, ${fails} FAIL`);
  if (fails > 0) {
    log("  >> OVERALL: NEEDS WORK");
  } else if (warns > 0) {
    log("  >> OVERALL: ACCEPTABLE (with warnings)");
  } else {
    log("  >> OVERALL: GOOD");
  }
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

async function exportCSVs(schemaId: string, schemaName: string) {
  mkdirSync(outputDir, { recursive: true });

  const safeName = schemaName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  const timestamp = new Date().toISOString().slice(0, 10);

  // Fetch ALL emails for the schema with entity and case info
  const emails = await prisma.email.findMany({
    where: { schemaId },
    select: {
      id: true,
      gmailMessageId: true,
      threadId: true,
      subject: true,
      senderEmail: true,
      senderDisplayName: true,
      senderDomain: true,
      date: true,
      summary: true,
      tags: true,
      entityId: true,
      entity: { select: { name: true, type: true } },
      senderEntityId: true,
      senderEntity: { select: { name: true } },
      isExcluded: true,
      excludeReason: true,
      routingDecision: true,
      caseEmails: {
        select: {
          case: {
            select: {
              id: true,
              title: true,
              urgency: true,
              displayTags: true,
            },
          },
          clusteringScore: true,
          assignedBy: true,
        },
      },
    },
    orderBy: { date: "asc" },
  });

  // CSV headers
  const headers = [
    "emailId",
    "gmailMessageId",
    "threadId",
    "date",
    "subject",
    "senderEmail",
    "senderDisplayName",
    "senderDomain",
    "summary",
    "tags",
    "entityName",
    "entityType",
    "entityId",
    "senderEntityName",
    "isExcluded",
    "excludeReason",
    "routeMethod",
    "routeDetail",
    "caseId",
    "caseTitle",
    "caseUrgency",
    "caseTags",
    "clusteringScore",
    "assignedBy",
    "status",
  ];

  const includedRows: string[] = [csvRow(headers)];
  const excludedRows: string[] = [csvRow(headers)];

  for (const e of emails) {
    const rd = e.routingDecision as Record<string, unknown> | null;
    const tags = Array.isArray(e.tags) ? (e.tags as string[]).join("; ") : "";
    const caseEmail = e.caseEmails[0];
    const caseData = caseEmail?.case;
    const caseTags = caseData?.displayTags;

    let status: string;
    if (e.isExcluded) {
      status = "EXCLUDED";
    } else if (caseEmail) {
      status = "IN_CASE";
    } else if (e.entityId) {
      status = "ORPHANED";
    } else {
      status = "NO_ENTITY";
    }

    const row = csvRow([
      e.id,
      e.gmailMessageId,
      e.threadId,
      e.date.toISOString(),
      e.subject,
      e.senderEmail,
      e.senderDisplayName,
      e.senderDomain,
      e.summary?.slice(0, 200),
      tags,
      e.entity?.name ?? "",
      e.entity?.type ?? "",
      e.entityId ?? "",
      e.senderEntity?.name ?? "",
      e.isExcluded ? "true" : "false",
      e.excludeReason ?? "",
      rd?.method ?? "",
      (rd?.detail as string)?.slice(0, 150) ?? "",
      caseData?.id ?? "",
      caseData?.title ?? "",
      caseData?.urgency ?? "",
      Array.isArray(caseTags) ? (caseTags as string[]).join("; ") : "",
      caseEmail?.clusteringScore?.toString() ?? "",
      caseEmail?.assignedBy ?? "",
      status,
    ]);

    if (status === "IN_CASE") {
      includedRows.push(row);
    } else {
      excludedRows.push(row);
    }
  }

  const includedPath = join(outputDir, `eval-${timestamp}-${safeName}-included.csv`);
  const excludedPath = join(outputDir, `eval-${timestamp}-${safeName}-excluded.csv`);

  writeFileSync(includedPath, includedRows.join("\n"), "utf-8");
  writeFileSync(excludedPath, excludedRows.join("\n"), "utf-8");

  log(`\n--- CSV EXPORT ---`);
  log(`  Included: ${includedRows.length - 1} rows -> ${includedPath}`);
  log(`  Excluded: ${excludedRows.length - 1} rows -> ${excludedPath}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  log("Post-Pipeline Eval Report");
  log("========================\n");

  let schemaIds: string[];

  if (schemaIdArg) {
    schemaIds = [schemaIdArg];
  } else if (latestArg) {
    const latest = await prisma.caseSchema.findFirst({
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) {
      log("No schemas found.");
      await prisma.$disconnect();
      return;
    }
    schemaIds = [latest.id];
  } else {
    // All schemas
    const schemas = await prisma.caseSchema.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    });
    if (schemas.length === 0) {
      log("No schemas found.");
      await prisma.$disconnect();
      return;
    }
    log(`Found ${schemas.length} schemas. Reporting on all.\n`);
    schemaIds = schemas.map((s) => s.id);
  }

  for (const id of schemaIds) {
    await reportSchema(id);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  log(`FAIL: ${e.message}`);
  process.exit(1);
});
