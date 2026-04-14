import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const log = (s: string) => process.stderr.write(s + "\n");

async function main() {
  log("=".repeat(70));
  log("PROBE: Deep dive — full schema email counts + alternativeCaseId");
  log("=".repeat(70));

  const ga11 = await p.caseSchema.findFirst({
    where: { name: "April 11 Test Girls Activities" },
    select: { id: true, name: true },
  });
  if (!ga11) { log("Schema not found"); return; }
  log(`\nSchema: ${ga11.name} (${ga11.id})`);

  // 1. Total email distribution for this schema
  const total = await p.email.count({ where: { schemaId: ga11.id } });
  const excluded = await p.email.count({ where: { schemaId: ga11.id, isExcluded: true } });
  const notExcluded = await p.email.count({ where: { schemaId: ga11.id, isExcluded: false } });
  const withEntity = await p.email.count({ where: { schemaId: ga11.id, isExcluded: false, entityId: { not: null } } });
  const withoutEntity = await p.email.count({ where: { schemaId: ga11.id, isExcluded: false, entityId: null } });
  const inCases = await p.caseEmail.count({ where: { case: { schemaId: ga11.id } } });

  log(`\n--- FULL EMAIL DISTRIBUTION ---`);
  log(`  Total emails:              ${total}`);
  log(`  isExcluded=true:           ${excluded}`);
  log(`  isExcluded=false:          ${notExcluded}`);
  log(`  notExcluded + entityId:    ${withEntity}`);
  log(`  notExcluded + NO entityId: ${withoutEntity}`);
  log(`  In cases (CaseEmail rows): ${inCases}`);

  // 2. How many scan jobs for this schema?
  const scanJobs = await p.scanJob.findMany({
    where: { schemaId: ga11.id },
    select: { id: true, status: true, phase: true, totalEmails: true, createdAt: true, completedAt: true },
    orderBy: { createdAt: "asc" },
  });
  log(`\n--- SCAN JOBS ---`);
  for (const sj of scanJobs) {
    log(`  ${sj.id} | status=${sj.status} | phase=${sj.phase} | total=${sj.totalEmails} | created=${sj.createdAt.toISOString()}`);
  }

  // 3. Check the 6 orphans with updatedAt > createdAt
  const orphansUpdated = await p.email.findMany({
    where: {
      schemaId: ga11.id,
      isExcluded: false,
      entityId: { not: null },
      caseEmails: { none: {} },
    },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      alternativeCaseId: true,
      subject: true,
      senderEmail: true,
      discriminators: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const updated = orphansUpdated.filter(e => Math.abs(e.updatedAt.getTime() - e.createdAt.getTime()) > 1000);
  log(`\n--- ORPHANS WITH updatedAt ≠ createdAt (${updated.length}) ---`);
  for (const e of updated) {
    const diff = e.updatedAt.getTime() - e.createdAt.getTime();
    log(`  id=${e.id} | updatedAt-createdAt=${diff}ms | altCase=${e.alternativeCaseId ?? "null"} | disc=${JSON.stringify(e.discriminators)}`);
    log(`    subject: ${e.subject.slice(0, 60)}`);
  }

  // 4. Simulate the exact unclustered query as of clustering time (but we can only run it NOW)
  // The query at cluster.ts:124 is:
  //   { schemaId, isExcluded: false, caseEmails: { none: {} } }
  const unclusteredNow = await p.email.count({
    where: { schemaId: ga11.id, isExcluded: false, caseEmails: { none: {} } },
  });
  const unclusteredWithEntity = await p.email.count({
    where: { schemaId: ga11.id, isExcluded: false, entityId: { not: null }, caseEmails: { none: {} } },
  });
  log(`\n--- SIMULATED UNCLUSTERED QUERY (NOW) ---`);
  log(`  Unclustered (all):        ${unclusteredNow}`);
  log(`  Unclustered + entityId:   ${unclusteredWithEntity}`);
  log(`  (At clustering time, caseEmails: { none: {} } would have returned ALL not-excluded emails)`);

  // 5. What would the query have returned at clustering time?
  // At that point, NO CaseEmail records existed. So:
  //   unclustered = all not-excluded emails = ${notExcluded}
  //   after entityId filter = ${withEntity}
  log(`\n--- ESTIMATED CLUSTERING-TIME INPUTS ---`);
  log(`  Emails that existed before clustering: ${notExcluded} (all not-excluded)`);
  log(`  After entityId filter:                 ${withEntity}`);
  log(`  Gravity model SHOULD have seen:        ${withEntity} emails`);
  log(`  Gravity model ACTUALLY saw:            23 emails (20 cluster records)`);
  log(`  DISCREPANCY:                           ${withEntity - 23} emails missing`);

  // 6. Check cluster records — all email IDs included
  const clusters = await p.cluster.findMany({
    where: { schemaId: ga11.id },
    select: { id: true, emailIds: true, action: true, clusterPass: true },
  });
  const clusterEmailIds = new Set<string>();
  for (const c of clusters) {
    const ids = c.emailIds as string[];
    for (const id of ids) clusterEmailIds.add(id);
  }
  log(`\n--- CLUSTER RECORDS ---`);
  log(`  Total clusters: ${clusters.length}`);
  log(`  Unique email IDs in clusters: ${clusterEmailIds.size}`);

  // 7. Are the orphan email IDs present in ANY cluster record?
  const orphanIds = orphansUpdated.map(e => e.id);
  const orphansInClusters = orphanIds.filter(id => clusterEmailIds.has(id));
  log(`  Orphan IDs found in cluster records: ${orphansInClusters.length} of ${orphanIds.length}`);

  // 8. Entity breakdown
  const entityCounts = await p.email.groupBy({
    by: ["entityId"],
    where: { schemaId: ga11.id, isExcluded: false },
    _count: true,
    orderBy: { _count: { entityId: "desc" } },
  });
  log(`\n--- ENTITY DISTRIBUTION (not-excluded) ---`);
  for (const ec of entityCounts) {
    const entity = ec.entityId
      ? await p.entity.findUnique({ where: { id: ec.entityId }, select: { name: true } })
      : null;
    log(`  ${entity?.name ?? "(no entity)"}: ${ec._count} emails`);
  }

  await p.$disconnect();
}
main().catch((e) => { log("FAIL: " + e.message); process.exit(1); });
