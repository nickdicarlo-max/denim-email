import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const log = (s: string) => process.stderr.write(s + "\n");

async function main() {
  log("=".repeat(70));
  log("PROBE 4: Email timestamps vs ScanJob phase transitions");
  log("=".repeat(70));

  const ga11 = await p.caseSchema.findFirst({
    where: { name: "April 11 Test Girls Activities" },
    select: { id: true, name: true },
  });
  if (!ga11) { log("not found"); return; }

  // Scan job phase transitions
  const scan = await p.scanJob.findFirst({
    where: { schemaId: ga11.id },
    select: {
      id: true, status: true, phase: true,
      createdAt: true, startedAt: true, completedAt: true,
      totalEmails: true,
    },
  });
  log(`\nScan job: ${scan?.id}`);
  log(`  createdAt:   ${scan?.createdAt.toISOString()}`);
  log(`  startedAt:   ${scan?.startedAt?.toISOString()}`);
  log(`  completedAt: ${scan?.completedAt?.toISOString()}`);
  log(`  totalEmails: ${scan?.totalEmails}`);

  // Cluster records: when were they created?
  const clusters = await p.cluster.findMany({
    where: { schemaId: ga11.id },
    select: { id: true, createdAt: true, emailIds: true, action: true, clusterPass: true },
    orderBy: { createdAt: "asc" },
  });
  if (clusters.length > 0) {
    log(`\nCluster records: ${clusters.length}`);
    log(`  first cluster createdAt: ${clusters[0].createdAt.toISOString()}`);
    log(`  last cluster createdAt:  ${clusters[clusters.length - 1].createdAt.toISOString()}`);
  }

  // Email createdAt distribution: orphans vs in-case
  const all = await p.email.findMany({
    where: { schemaId: ga11.id, isExcluded: false, entityId: { not: null } },
    select: {
      id: true, subject: true, createdAt: true, updatedAt: true, date: true,
      caseEmails: { select: { id: true } },
      senderDisplayName: true, senderEmail: true, threadId: true,
      tags: true,
    },
    orderBy: { createdAt: "asc" },
  });
  log(`\nEmails with entitySet+notExcl: ${all.length}`);

  const inCase = all.filter(e => e.caseEmails.length > 0);
  const orphan = all.filter(e => e.caseEmails.length === 0);
  log(`  in case: ${inCase.length}`);
  log(`  orphan:  ${orphan.length}`);

  if (inCase.length > 0) {
    const minIC = inCase[0].createdAt;
    const maxIC = inCase[inCase.length - 1].createdAt;
    log(`\n  IN-CASE createdAt range:`);
    log(`    earliest: ${minIC.toISOString()}`);
    log(`    latest:   ${maxIC.toISOString()}`);
  }
  if (orphan.length > 0) {
    const sortedOrphan = [...orphan].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    log(`\n  ORPHAN createdAt range:`);
    log(`    earliest: ${sortedOrphan[0].createdAt.toISOString()}`);
    log(`    latest:   ${sortedOrphan[sortedOrphan.length - 1].createdAt.toISOString()}`);
  }

  // Critical: did any orphans get created BEFORE the clusters? If yes, they
  // should have been picked up.
  if (clusters.length > 0 && orphan.length > 0) {
    const firstClusterTs = clusters[0].createdAt.getTime();
    const beforeClustering = orphan.filter(e => e.createdAt.getTime() < firstClusterTs);
    const afterClustering = orphan.filter(e => e.createdAt.getTime() >= firstClusterTs);
    log(`\n  Orphans CREATED BEFORE first cluster row: ${beforeClustering.length}`);
    log(`  Orphans CREATED AFTER first cluster row:  ${afterClustering.length}`);
  }

  // Are orphans grouped by threadId — i.e., do orphans share threadIds with in-case emails?
  const inCaseThreads = new Set(inCase.map(e => e.threadId));
  const orphanThreads = new Set(orphan.map(e => e.threadId));
  const sharedThreads = [...orphanThreads].filter(t => inCaseThreads.has(t));
  log(`\n  Unique threadIds: in-case=${inCaseThreads.size}, orphan=${orphanThreads.size}`);
  log(`  Threads shared between in-case and orphan groups: ${sharedThreads.length}`);

  // Look at threadId of in-case soccer emails vs orphans -- maybe they're 
  // different patterns
  log(`\n  IN-CASE email threadIds (first 10):`);
  for (const e of inCase.slice(0, 10)) {
    log(`    ${e.createdAt.toISOString()} | tid=${e.threadId} | ${e.subject.slice(0, 50)}`);
  }
  log(`\n  ORPHAN email threadIds (first 10):`);
  for (const e of orphan.slice(0, 10)) {
    log(`    ${e.createdAt.toISOString()} | tid=${e.threadId} | ${e.subject.slice(0, 50)}`);
  }

  await p.$disconnect();
}
main().catch((e) => { log("FAIL: " + e.message); process.exit(1); });
