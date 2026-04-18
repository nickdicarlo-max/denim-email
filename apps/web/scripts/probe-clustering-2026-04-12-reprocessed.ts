import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// biome-ignore lint/style/noNonNullAssertion: dev script; env validated by tsx dotenv/config at import time
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const log = (s: string) => process.stderr.write(`${s}\n`);

async function main() {
  log("=".repeat(70));
  log("PROBE: reprocessedAt / updatedAt check on orphan emails");
  log("=".repeat(70));

  const ga11 = await p.caseSchema.findFirst({
    where: { name: "April 11 Test Girls Activities" },
    select: { id: true, name: true },
  });
  if (!ga11) {
    log("Schema not found");
    return;
  }
  log(`\nSchema: ${ga11.name} (${ga11.id})`);

  // Get ALL emails with entityId set and not excluded
  const allEmails = await p.email.findMany({
    where: { schemaId: ga11.id, isExcluded: false, entityId: { not: null } },
    select: {
      id: true,
      entityId: true,
      createdAt: true,
      updatedAt: true,
      reprocessedAt: true,
      firstScanJobId: true,
      lastScanJobId: true,
      routingDecision: true,
      senderEmail: true,
      subject: true,
      caseEmails: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const inCase = allEmails.filter((e) => e.caseEmails.length > 0);
  const orphans = allEmails.filter((e) => e.caseEmails.length === 0);

  log(`\nTotal emails (entityId set, not excluded): ${allEmails.length}`);
  log(`  In cases: ${inCase.length}`);
  log(`  Orphaned: ${orphans.length}`);

  // Check reprocessedAt for orphans
  const orphansReprocessed = orphans.filter((e) => e.reprocessedAt !== null);
  const orphansNotReprocessed = orphans.filter((e) => e.reprocessedAt === null);
  log(`\n--- ORPHAN reprocessedAt ---`);
  log(`  reprocessedAt IS NOT NULL: ${orphansReprocessed.length}`);
  log(`  reprocessedAt IS NULL:     ${orphansNotReprocessed.length}`);

  // Check reprocessedAt for in-case emails
  const inCaseReprocessed = inCase.filter((e) => e.reprocessedAt !== null);
  log(`\n--- IN-CASE reprocessedAt ---`);
  log(`  reprocessedAt IS NOT NULL: ${inCaseReprocessed.length}`);
  log(`  reprocessedAt IS NULL:     ${inCase.length - inCaseReprocessed.length}`);

  // Check updatedAt vs createdAt for orphans
  log(`\n--- ORPHAN updatedAt vs createdAt ---`);
  let sameCount = 0;
  let diffCount = 0;
  for (const e of orphans) {
    const diff = Math.abs(e.updatedAt.getTime() - e.createdAt.getTime());
    if (diff < 1000) {
      // within 1 second
      sameCount++;
    } else {
      diffCount++;
    }
  }
  log(`  updatedAt ≈ createdAt (< 1s):  ${sameCount}`);
  log(`  updatedAt ≠ createdAt (> 1s):  ${diffCount}`);

  // Check scanJobIds
  log(`\n--- ORPHAN scanJobId comparison ---`);
  const sameJob = orphans.filter((e) => e.firstScanJobId === e.lastScanJobId);
  const diffJob = orphans.filter((e) => e.firstScanJobId !== e.lastScanJobId);
  log(`  firstScanJobId = lastScanJobId:  ${sameJob.length}`);
  log(`  firstScanJobId ≠ lastScanJobId:  ${diffJob.length}`);

  // Show routing decisions for first 5 orphans
  log(`\n--- ORPHAN routing decisions (first 10) ---`);
  for (const e of orphans.slice(0, 10)) {
    const rd = e.routingDecision as any;
    const reprocessed = e.reprocessedAt ? e.reprocessedAt.toISOString() : "null";
    const diffMs = e.updatedAt.getTime() - e.createdAt.getTime();
    log(
      `  ${e.senderEmail} | route=${rd?.method ?? "null"} | reprocessedAt=${reprocessed} | updatedAt-createdAt=${diffMs}ms`,
    );
    log(`    subject: ${e.subject.slice(0, 60)}`);
    log(`    detail: ${rd?.detail ?? "none"}`);
  }

  // Show routing decisions for first 5 in-case emails for comparison
  log(`\n--- IN-CASE routing decisions (first 10) ---`);
  for (const e of inCase.slice(0, 10)) {
    const rd = e.routingDecision as any;
    const reprocessed = e.reprocessedAt ? e.reprocessedAt.toISOString() : "null";
    const diffMs = e.updatedAt.getTime() - e.createdAt.getTime();
    log(
      `  ${e.senderEmail} | route=${rd?.method ?? "null"} | reprocessedAt=${reprocessed} | updatedAt-createdAt=${diffMs}ms`,
    );
    log(`    subject: ${e.subject.slice(0, 60)}`);
    log(`    detail: ${rd?.detail ?? "none"}`);
  }

  // Get cluster timestamps for reference
  const clusters = await p.cluster.findMany({
    where: { schemaId: ga11.id },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (clusters.length > 0) {
    log(`\n--- CLUSTERING TIMING REFERENCE ---`);
    log(`  First cluster created: ${clusters[0].createdAt.toISOString()}`);
    log(`  Last cluster created:  ${clusters[clusters.length - 1].createdAt.toISOString()}`);

    // Were any orphans reprocessed AFTER clustering?
    const firstClusterTs = clusters[0].createdAt.getTime();
    const reprocessedAfterClustering = orphans.filter(
      (e) => e.reprocessedAt && e.reprocessedAt.getTime() > firstClusterTs,
    );
    const updatedAfterClustering = orphans.filter((e) => e.updatedAt.getTime() > firstClusterTs);
    log(`  Orphans with reprocessedAt AFTER first cluster: ${reprocessedAfterClustering.length}`);
    log(`  Orphans with updatedAt AFTER first cluster:     ${updatedAfterClustering.length}`);
  }

  await p.$disconnect();
}
main().catch((e) => {
  log(`FAIL: ${e.message}`);
  process.exit(1);
});
