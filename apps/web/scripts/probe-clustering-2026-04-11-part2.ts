import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const log = (s: string) => process.stderr.write(s + "\n");

async function main() {
  log("=".repeat(70));
  log("PROBE: GA clusteringConfig + cluster records + orphan detail");
  log("=".repeat(70));

  const gaSchemas = await p.caseSchema.findMany({
    where: { OR: [{ name: { contains: "Girls Activities" } }, { name: { contains: "April 10" } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, domain: true, clusteringConfig: true, qualityPhase: true, discriminatorVocabulary: true },
  });

  for (const s of gaSchemas) {
    log("\n" + "-".repeat(70));
    log(`SCHEMA: ${s.name} (${s.id})`);
    log("-".repeat(70));
    log(`domain: ${s.domain}`);
    log(`qualityPhase: ${s.qualityPhase}`);
    log(`clusteringConfig:\n${JSON.stringify(s.clusteringConfig, null, 2)}`);
    log(`discriminatorVocabulary present: ${s.discriminatorVocabulary ? "yes" : "no/null"}`);

    // Cluster records for this schema
    const clusters = await p.cluster.findMany({
      where: { schemaId: s.id },
      select: { id: true, action: true, clusterPass: true, emailIds: true, score: true, resultCaseId: true, scoreBreakdown: true },
      orderBy: { createdAt: "asc" },
    });
    const grid: Record<string, number> = {};
    const emailsInClusters = new Set<string>();
    for (const c of clusters) {
      const k = `${c.clusterPass ?? "null"}|${c.action}`;
      grid[k] = (grid[k] || 0) + 1;
      if (Array.isArray(c.emailIds)) {
        for (const eid of c.emailIds as string[]) emailsInClusters.add(eid);
      }
    }
    log(`\nCluster records: ${clusters.length}`);
    for (const [k, v] of Object.entries(grid)) log(`  ${k}: ${v}`);
    log(`Unique email IDs referenced in Cluster.emailIds JSON: ${emailsInClusters.size}`);

    // Find soccer entity
    const soccer = await p.entity.findFirst({
      where: { schemaId: s.id, name: { contains: "soccer", mode: "insensitive" }, type: "PRIMARY" },
      select: { id: true, name: true, emailCount: true },
    });
    if (!soccer) { log("\n(no soccer entity)"); continue; }

    log(`\nSoccer entity ${soccer.id}, emailCount=${soccer.emailCount}`);
    // How many soccer emails appear in Cluster.emailIds?
    const soccerEmails = await p.email.findMany({
      where: { entityId: soccer.id },
      select: { id: true, subject: true, date: true, caseEmails: { select: { caseId: true } } },
    });
    const inCluster = soccerEmails.filter((e) => emailsInClusters.has(e.id)).length;
    const orphan = soccerEmails.filter((e) => e.caseEmails.length === 0);
    log(`  Total soccer emails: ${soccerEmails.length}`);
    log(`  Soccer emails referenced in Cluster.emailIds JSON: ${inCluster}`);
    log(`  Orphan (no CaseEmail): ${orphan.length}`);
    log(`  Orphans that ARE in Cluster.emailIds: ${orphan.filter((e) => emailsInClusters.has(e.id)).length}`);
    log(`  Orphans NOT in Cluster.emailIds: ${orphan.filter((e) => !emailsInClusters.has(e.id)).length}`);

    // Sample 3 orphans with full routing detail
    const orphanDetail = await p.email.findMany({
      where: { id: { in: orphan.slice(0, 3).map((e) => e.id) } },
      select: {
        id: true, subject: true, date: true, threadId: true,
        senderEmail: true, senderDisplayName: true, senderEntityId: true,
        tags: true, detectedEntities: true, routingDecision: true,
        clusteringConfidence: true, alternativeCaseId: true,
        isExcluded: true, excludeReason: true,
        firstScanJobId: true, lastScanJobId: true,
      },
    });
    log(`\n3 ORPHAN soccer emails with full detail:`);
    for (const e of orphanDetail) {
      log(`\n  id=${e.id}`);
      log(`    subject:             "${e.subject}"`);
      log(`    date:                ${e.date.toISOString()}`);
      log(`    threadId:            ${e.threadId}`);
      log(`    sender:              ${e.senderDisplayName} <${e.senderEmail}>`);
      log(`    senderEntityId:      ${e.senderEntityId}`);
      log(`    tags:                ${JSON.stringify(e.tags)}`);
      log(`    detectedEntities:    ${JSON.stringify(e.detectedEntities)}`);
      log(`    routingDecision:     ${JSON.stringify(e.routingDecision)}`);
      log(`    clusteringConfidence:${e.clusteringConfidence}`);
      log(`    alternativeCaseId:   ${e.alternativeCaseId}`);
      log(`    firstScanJobId:      ${e.firstScanJobId}`);
      log(`    lastScanJobId:       ${e.lastScanJobId}`);
      log(`    isExcluded:          ${e.isExcluded}`);
    }

    // And compare: a non-orphan soccer email (one that's IN a case)
    const inCase = soccerEmails.filter((e) => e.caseEmails.length > 0).slice(0, 2);
    if (inCase.length > 0) {
      const inCaseDetail = await p.email.findMany({
        where: { id: { in: inCase.map((e) => e.id) } },
        select: {
          id: true, subject: true, date: true, threadId: true,
          senderEmail: true, senderDisplayName: true, senderEntityId: true,
          tags: true, firstScanJobId: true, caseEmails: { select: { case: { select: { title: true } } } },
        },
      });
      log(`\n2 IN-CASE soccer emails (for comparison):`);
      for (const e of inCaseDetail) {
        log(`\n  id=${e.id}`);
        log(`    subject:         "${e.subject}"`);
        log(`    date:            ${e.date.toISOString()}`);
        log(`    threadId:        ${e.threadId}`);
        log(`    sender:          ${e.senderDisplayName} <${e.senderEmail}>`);
        log(`    senderEntityId:  ${e.senderEntityId}`);
        log(`    tags:            ${JSON.stringify(e.tags)}`);
        log(`    firstScanJobId:  ${e.firstScanJobId}`);
        log(`    case title:      ${e.caseEmails[0]?.case.title}`);
      }
    }

    // Check scan jobs for this schema — are there multiple?
    const scans = await p.scanJob.findMany({
      where: { schemaId: s.id },
      select: { id: true, phase: true, status: true, triggeredBy: true, totalEmails: true, createdAt: true, completedAt: true },
      orderBy: { createdAt: "asc" },
    });
    log(`\nScan jobs: ${scans.length}`);
    for (const sj of scans) {
      log(`  ${sj.id} | ${sj.triggeredBy} | ${sj.status}/${sj.phase} | total=${sj.totalEmails} | ${sj.createdAt.toISOString()}`);
    }
  }

  await p.$disconnect();
}
main().catch((e) => { log("FAIL: " + e.message); process.exit(1); });
