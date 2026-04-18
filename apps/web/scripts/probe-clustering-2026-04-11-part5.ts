import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// biome-ignore lint/style/noNonNullAssertion: dev script; env validated by tsx dotenv/config at import time
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const log = (s: string) => process.stderr.write(`${s}\n`);

async function main() {
  const ga11 = await p.caseSchema.findFirst({
    where: { name: "April 11 Test Girls Activities" },
    select: { id: true, name: true },
  });
  if (!ga11) return;
  log(`Schema: ${ga11.name}`);

  // 1. Replay the EXACT unclusteredEmails query from cluster.ts:124
  const unclustered = await p.email.findMany({
    where: {
      schemaId: ga11.id,
      isExcluded: false,
      caseEmails: { none: {} },
    },
    select: { id: true, entityId: true, threadId: true, subject: true, createdAt: true },
    orderBy: { date: "asc" },
  });
  log(`\nReplay of unclusteredEmails query NOW: ${unclustered.length}`);
  log(`  with entityId set: ${unclustered.filter((e) => e.entityId).length}`);
  log(`  with entityId null: ${unclustered.filter((e) => !e.entityId).length}`);

  // Distinct threadIds in current unclustered set
  const tids = new Set(unclustered.filter((e) => e.entityId).map((e) => e.threadId));
  log(`  unique threadIds (entitySet): ${tids.size}`);

  // 2. Get all 71 entitySet+notExcl emails. Compare which are in cluster.emailIds JSON
  const clusters = await p.cluster.findMany({
    where: { schemaId: ga11.id },
    select: { id: true, emailIds: true, action: true, clusterPass: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const clusteredIds = new Set<string>();
  for (const c of clusters) {
    if (Array.isArray(c.emailIds)) {
      for (const eid of c.emailIds as string[]) clusteredIds.add(eid);
    }
  }
  log(`\nUnique email IDs across all cluster.emailIds JSON: ${clusteredIds.size}`);

  // 3. Cross-check: every email in clusteredIds should be in a CaseEmail
  const clusteredArr = [...clusteredIds];
  const ceForClustered = await p.caseEmail.findMany({
    where: { emailId: { in: clusteredArr } },
    select: { emailId: true, caseId: true },
  });
  log(`CaseEmail rows for those emailIds: ${ceForClustered.length}`);
  const inClusterButNoCaseEmail = clusteredArr.filter(
    (id) => !ceForClustered.some((ce) => ce.emailId === id),
  );
  log(`Emails in cluster.emailIds but NOT in case_emails: ${inClusterButNoCaseEmail.length}`);

  // 4. Gather: of the 71 entitySet+notExcl emails, how many are in clusteredIds?
  const allEntitySet = await p.email.findMany({
    where: { schemaId: ga11.id, isExcluded: false, entityId: { not: null } },
    select: {
      id: true,
      threadId: true,
      subject: true,
      createdAt: true,
      caseEmails: { select: { id: true } },
    },
  });
  const inClusters = allEntitySet.filter((e) => clusteredIds.has(e.id));
  const notInClusters = allEntitySet.filter((e) => !clusteredIds.has(e.id));
  log(`\nOf ${allEntitySet.length} entitySet+notExcl emails:`);
  log(`  in cluster.emailIds JSON: ${inClusters.length}`);
  log(`  NOT in any cluster:        ${notInClusters.length}`);

  // 5. The 48 not in clusters: do they have any caseEmails?
  const stillOrphan = notInClusters.filter((e) => e.caseEmails.length === 0);
  log(`  not in any cluster AND no caseEmail: ${stillOrphan.length}`);

  // 6. Check if any of the 48 share threadIds with the 23 in-cluster
  const tidsInCluster = new Set(inClusters.map((e) => e.threadId));
  const sharedTids = notInClusters.filter((e) => tidsInCluster.has(e.threadId));
  log(`  Of the 48, how many share a threadId with the 23?  ${sharedTids.length}`);

  // 7. Check the 5 minutes BEFORE clustering: when was each orphan written?
  const firstClusterTs = clusters[0]?.createdAt;
  if (firstClusterTs) {
    log(`\nFirst cluster created: ${firstClusterTs.toISOString()}`);
    const orphanCreatedAfter = stillOrphan.filter((e) => e.createdAt >= firstClusterTs);
    const orphanCreatedBefore = stillOrphan.filter((e) => e.createdAt < firstClusterTs);
    log(`  Orphans createdAt < first cluster: ${orphanCreatedBefore.length}`);
    log(`  Orphans createdAt >= first cluster: ${orphanCreatedAfter.length}`);
    if (orphanCreatedBefore.length > 0) {
      // these EXISTED at clustering time but were not picked up
      const sample = orphanCreatedBefore.slice(0, 5);
      log(`\n  Sample orphans that existed BEFORE clustering started:`);
      for (const e of sample) {
        log(`    ${e.createdAt.toISOString()} | tid=${e.threadId} | ${e.subject.slice(0, 50)}`);
      }
    }
  }

  // 8. Look for partial cluster: maybe clusters were ATTEMPTED but never written
  // Check synthesis records - maybe the cases that exist had MORE emails before
  log(`\nClusters detail (action+pass+emailCount):`);
  for (const c of clusters.slice(0, 5)) {
    const ids = Array.isArray(c.emailIds) ? (c.emailIds as string[]) : [];
    log(`  ${c.action}|${c.clusterPass}| ${ids.length} emails`);
  }

  await p.$disconnect();
}
main().catch((e) => {
  log(`FAIL: ${e.message}`);
  process.exit(1);
});
