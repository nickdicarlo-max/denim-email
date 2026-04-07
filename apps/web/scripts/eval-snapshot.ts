/**
 * Eval Snapshot — exports user-data tables to JSON before a DB wipe.
 *
 * Run from apps/web/:
 *   npx tsx scripts/eval-snapshot.ts
 *
 * Output: ../../docs/test-results/pre-eval-snapshot-YYYY-MM-DD.json
 *
 * Captures: CaseSchema, Entity, EntityGroup, SchemaTag, ExtractedFieldDef,
 * ExclusionRule, Email, EmailAttachment, Case, CaseEmail, CaseAction, Cluster,
 * ScanJob, ExtractionCost, FeedbackEvent, QualitySnapshot. User table excluded
 * (PII + auth-managed; not part of the eval surface).
 *
 * Why: FeedbackEvents and QualitySnapshots are append-only and irreplaceable.
 * Cases + clustering output are useful as a "before" for any later regression
 * comparison even if the underlying scan is stale.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

// Load env from the apps/web directory. Script MUST be run from apps/web:
//   cd apps/web && npx tsx scripts/eval-snapshot.ts
loadEnv({ path: resolve(process.cwd(), ".env.local") });

if (!process.env.DATABASE_URL) {
  console.error("FAILED: DATABASE_URL not set.");
  console.error("  Run from apps/web/ so .env.local is picked up:");
  console.error("    cd apps/web && npx tsx scripts/eval-snapshot.ts");
  process.exit(4);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function snapshot() {
  console.error("Snapshotting user-data tables...\n");

  const data = {
    snapshotAt: new Date().toISOString(),
    schemaVersion: "pre-eval-2026-04-07",
    tables: {} as Record<string, unknown[]>,
    counts: {} as Record<string, number>,
  };

  const exporters: [string, () => Promise<unknown[]>][] = [
    ["caseSchema", () => prisma.caseSchema.findMany()],
    ["entity", () => prisma.entity.findMany()],
    ["entityGroup", () => prisma.entityGroup.findMany()],
    ["schemaTag", () => prisma.schemaTag.findMany()],
    ["extractedFieldDef", () => prisma.extractedFieldDef.findMany()],
    ["exclusionRule", () => prisma.exclusionRule.findMany()],
    ["email", () => prisma.email.findMany()],
    ["emailAttachment", () => prisma.emailAttachment.findMany()],
    ["case", () => prisma.case.findMany()],
    ["caseEmail", () => prisma.caseEmail.findMany()],
    ["caseAction", () => prisma.caseAction.findMany()],
    ["cluster", () => prisma.cluster.findMany()],
    ["scanJob", () => prisma.scanJob.findMany()],
    ["extractionCost", () => prisma.extractionCost.findMany()],
    ["feedbackEvent", () => prisma.feedbackEvent.findMany()],
    ["qualitySnapshot", () => prisma.qualitySnapshot.findMany()],
  ];

  for (const [name, fn] of exporters) {
    try {
      const rows = await fn();
      data.tables[name] = rows;
      data.counts[name] = rows.length;
      console.error(`  ${name}: ${rows.length}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ${name}: ERROR ${msg.slice(0, 80)}`);
      data.tables[name] = [];
      data.counts[name] = -1;
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  // cwd is apps/web; repo root is two levels up.
  const outPath = resolve(
    process.cwd(),
    "../../docs/test-results",
    `pre-eval-snapshot-${date}.json`,
  );

  // BigInt-safe serializer (Prisma can return BigInt for some columns)
  const json = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  writeFileSync(outPath, json, "utf8");

  console.error(`\nWrote ${json.length.toLocaleString()} bytes to:`);
  console.error(`  ${outPath}`);

  await prisma.$disconnect();
}

snapshot().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
