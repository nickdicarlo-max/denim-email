import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const log = (s: string) => process.stderr.write(s + "\n");

async function main() {
  log("=".repeat(70));
  log("PROBE: Verify synthetic-ID MERGE bug hypothesis");
  log("=".repeat(70));

  const ga11 = await p.caseSchema.findFirst({
    where: { name: "April 11 Test Girls Activities" },
    select: { id: true },
  });
  if (!ga11) { log("Schema not found"); return; }

  // 1. Check cluster actions — are ALL clusters CREATE (no MERGE)?
  const clusters = await p.cluster.findMany({
    where: { schemaId: ga11.id, clusterPass: "COARSE" },
    select: { id: true, action: true, emailIds: true, score: true, resultCaseId: true, targetCaseId: true },
  });
  const creates = clusters.filter(c => c.action === "CREATE");
  const merges = clusters.filter(c => c.action === "MERGE");
  log(`\n--- CLUSTER ACTIONS ---`);
  log(`  Total COARSE clusters: ${clusters.length}`);
  log(`  CREATE: ${creates.length}`);
  log(`  MERGE:  ${merges.length}`);
  log(`  >>> If 0 MERGEs, ALL merge decisions were silently dropped <<<`);

  // 2. Check if any cluster has a synthetic targetCaseId
  for (const c of clusters) {
    if (c.targetCaseId && c.targetCaseId.startsWith("new-case-")) {
      log(`  WARNING: cluster ${c.id} has synthetic targetCaseId: ${c.targetCaseId}`);
    }
  }

  // 3. Check cases — are their IDs CUIDs (not synthetic)?
  const cases = await p.case.findMany({
    where: { schemaId: ga11.id },
    select: { id: true, entityId: true, title: true },
    take: 25,
  });
  log(`\n--- CASES ---`);
  log(`  Total cases: ${cases.length}`);
  const syntheticCases = cases.filter(c => c.id.startsWith("new-case-"));
  log(`  With synthetic IDs: ${syntheticCases.length}`);
  log(`  With CUID IDs:      ${cases.length - syntheticCases.length}`);

  // 4. Check alternativeCaseId on ALL emails (not just orphans)
  const withAltCase = await p.email.findMany({
    where: { schemaId: ga11.id, alternativeCaseId: { not: null } },
    select: { id: true, alternativeCaseId: true, caseEmails: { select: { id: true } } },
  });
  log(`\n--- EMAILS WITH alternativeCaseId ---`);
  log(`  Total: ${withAltCase.length}`);
  const altCaseValues = [...new Set(withAltCase.map(e => e.alternativeCaseId))];
  log(`  Unique alternativeCaseId values: ${JSON.stringify(altCaseValues)}`);
  const altInCase = withAltCase.filter(e => e.caseEmails.length > 0);
  const altOrphan = withAltCase.filter(e => e.caseEmails.length === 0);
  log(`  In cases: ${altInCase.length}, Orphaned: ${altOrphan.length}`);

  // 5. NOW check the Property Management schema too
  const pm11 = await p.caseSchema.findFirst({
    where: { name: { contains: "Property Management" } },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });
  if (pm11) {
    log(`\n--- PROPERTY MANAGEMENT: ${pm11.name} ---`);
    const pmClusters = await p.cluster.findMany({
      where: { schemaId: pm11.id, clusterPass: "COARSE" },
      select: { action: true },
    });
    const pmCreates = pmClusters.filter(c => c.action === "CREATE");
    const pmMerges = pmClusters.filter(c => c.action === "MERGE");
    log(`  COARSE clusters: ${pmClusters.length}`);
    log(`  CREATE: ${pmCreates.length}`);
    log(`  MERGE:  ${pmMerges.length}`);
    log(`  >>> If 0 MERGEs here too, bug is systemic <<<`);

    const pmCaseCount = await p.case.count({ where: { schemaId: pm11.id } });
    const pmEmailsInCases = await p.caseEmail.count({ where: { case: { schemaId: pm11.id } } });
    const pmTotalNotExcl = await p.email.count({ where: { schemaId: pm11.id, isExcluded: false } });
    const pmOrphans = await p.email.count({
      where: { schemaId: pm11.id, isExcluded: false, entityId: { not: null }, caseEmails: { none: {} } },
    });
    log(`  Cases: ${pmCaseCount}, Emails in cases: ${pmEmailsInCases}`);
    log(`  Total not-excluded: ${pmTotalNotExcl}, Orphaned (entity+notExcl): ${pmOrphans}`);
  }

  await p.$disconnect();
}
main().catch((e) => { log("FAIL: " + e.message); process.exit(1); });
