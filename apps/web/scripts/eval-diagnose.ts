/**
 * Eval Diagnose — dumps schemas, scan jobs, cases, and clustering quality
 * for post-eval inspection. Read-only, safe to run anytime.
 *
 * Run from apps/web/:
 *   npx tsx scripts/eval-diagnose.ts
 */

import { resolve } from "node:path";
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

function pad(s: string, n: number): string {
  return (s + " ".repeat(n)).slice(0, n);
}

function short(id: string): string {
  return id.slice(-8);
}

function hhmmss(d: Date): string {
  return d.toISOString().slice(11, 19);
}

async function main() {
  // === SCHEMAS ===
  const schemas = await prisma.caseSchema.findMany({
    orderBy: { createdAt: "asc" },
  });
  console.log("=== SCHEMAS ===");
  console.log(`Total: ${schemas.length}\n`);
  for (const s of schemas) {
    console.log(
      `  ${short(s.id)} | ${pad(s.name ?? "(unnamed)", 30)} | ${pad(s.domain ?? "(none)", 14)} | ${pad(s.status, 11)} | emails=${s.emailCount} cases=${s.caseCount} | ${hhmmss(s.createdAt)}`,
    );
  }

  // === SCAN JOBS ===
  const jobs = await prisma.scanJob.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`\n=== SCAN JOBS ===`);
  console.log(`Total: ${jobs.length}\n`);
  let totalCost = 0;
  for (const j of jobs) {
    const durMs = j.completedAt
      ? j.completedAt.getTime() - (j.startedAt?.getTime() ?? j.createdAt.getTime())
      : null;
    const dur = durMs ? `${Math.round(durMs / 1000)}s` : "running";
    const cost = Number(j.estimatedCostUsd ?? 0);
    totalCost += cost;
    console.log(
      `  ${short(j.schemaId)} | ${pad(j.status, 10)} | ${pad(j.phase ?? "-", 14)} | ${j.processedEmails}/${j.totalEmails} proc, ${j.failedEmails} failed | cases=${j.casesCreated} clusters=${j.clustersCreated} | $${cost.toFixed(3)} | ${dur} | ${hhmmss(j.createdAt)}`,
    );
  }
  console.log(`\nTotal scan job cost: $${totalCost.toFixed(3)}`);

  // === CASES PER SCHEMA WITH EMAIL COUNT DISTRIBUTION ===
  console.log(`\n=== CASES (per schema) ===\n`);
  for (const s of schemas) {
    const cases = await prisma.case.findMany({
      where: { schemaId: s.id },
      select: {
        id: true,
        title: true,
        urgency: true,
        status: true,
        _count: { select: { caseEmails: true } },
      },
      orderBy: { urgency: "desc" },
    });
    if (cases.length === 0) {
      console.log(`  ${short(s.id)} (${s.name ?? "unnamed"}): 0 cases`);
      continue;
    }
    const emailCounts = cases.map((c) => c._count.caseEmails);
    const singleEmail = emailCounts.filter((n) => n === 1).length;
    const multiEmail = emailCounts.filter((n) => n > 1).length;
    const maxEmails = Math.max(...emailCounts);
    const avgEmails = (emailCounts.reduce((a, b) => a + b, 0) / emailCounts.length).toFixed(1);
    console.log(
      `  ${short(s.id)} (${s.name ?? "unnamed"}): ${cases.length} cases | single-email=${singleEmail} multi-email=${multiEmail} | avg=${avgEmails} max=${maxEmails}`,
    );
    for (const c of cases.slice(0, 10)) {
      const actionCount = await prisma.caseAction.count({ where: { caseId: c.id } });
      console.log(
        `      [${String(c.urgency).padStart(3)}] ${pad(c.title ?? "(no title)", 60)} emails=${c._count.caseEmails} actions=${actionCount} ${c.status}`,
      );
    }
    if (cases.length > 10) console.log(`      ... and ${cases.length - 10} more`);
  }

  // === ROW COUNTS ===
  console.log(`\n=== ROW COUNTS ===`);
  const [users, entities, emails, cases, clusters, caseEmails, caseActions, feedbackEvents, costs] =
    await Promise.all([
      prisma.user.count(),
      prisma.entity.count(),
      prisma.email.count(),
      prisma.case.count(),
      prisma.cluster.count(),
      prisma.caseEmail.count(),
      prisma.caseAction.count(),
      prisma.feedbackEvent.count(),
      prisma.extractionCost.count(),
    ]);
  console.log(
    `  users=${users} entities=${entities} emails=${emails} cases=${cases} clusters=${clusters} caseEmails=${caseEmails} caseActions=${caseActions} feedbackEvents=${feedbackEvents} extractionCosts=${costs}`,
  );

  // === TOTAL AI SPEND ===
  const costRows = await prisma.extractionCost.findMany({
    select: { model: true, operation: true, estimatedCostUsd: true },
  });
  const byModel: Record<string, { calls: number; cost: number }> = {};
  let grandTotal = 0;
  for (const r of costRows) {
    const key = `${r.model} / ${r.operation}`;
    byModel[key] ??= { calls: 0, cost: 0 };
    byModel[key].calls += 1;
    const c = Number(r.estimatedCostUsd ?? 0);
    byModel[key].cost += c;
    grandTotal += c;
  }
  console.log(`\n=== AI SPEND (all extraction_costs rows) ===`);
  for (const [key, v] of Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(`  ${pad(key, 40)} calls=${v.calls} cost=$${v.cost.toFixed(4)}`);
  }
  console.log(`  TOTAL: $${grandTotal.toFixed(4)}`);

  // === ORPHAN / DUPLICATE SCHEMAS CHECK ===
  console.log(`\n=== DUPLICATE DETECTION ===`);
  const byDomain: Record<string, typeof schemas> = {};
  for (const s of schemas) {
    const domainKey = s.domain ?? "(none)";
    byDomain[domainKey] ??= [];
    byDomain[domainKey].push(s);
  }
  for (const [domain, list] of Object.entries(byDomain)) {
    if (list.length > 1) {
      console.log(`  DUPLICATE domain "${domain}" has ${list.length} schemas:`);
      for (const s of list) {
        console.log(
          `    ${short(s.id)} "${s.name ?? "unnamed"}" status=${s.status} emails=${s.emailCount} cases=${s.caseCount} created=${hhmmss(s.createdAt)}`,
        );
      }
    }
  }

  // === SCAN JOBS PER SCHEMA (detect zombies) ===
  console.log(`\n=== SCAN JOBS PER SCHEMA ===`);
  for (const s of schemas) {
    const jobsForSchema = jobs.filter((j) => j.schemaId === s.id);
    if (jobsForSchema.length > 1) {
      console.log(`  schema ${short(s.id)} has ${jobsForSchema.length} scan jobs:`);
      for (const j of jobsForSchema) {
        console.log(
          `    ${j.status} ${j.phase ?? "-"} processed=${j.processedEmails}/${j.totalEmails} ${hhmmss(j.createdAt)}`,
        );
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
