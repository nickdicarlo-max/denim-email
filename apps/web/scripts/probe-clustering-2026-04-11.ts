// SCRATCH diagnostic for 2026-04-11 plan session. Read-only.
// Delete after the clustering analysis is written up.
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });

const log = (s: string) => process.stderr.write(s + "\n");

async function main() {
  log("=".repeat(70));
  log("PROBE 1: SOCCER ACCOUNTING — April 10 vs April 11 Girls Activities");
  log("=".repeat(70));

  const gaSchemas = await p.caseSchema.findMany({
    where: {
      OR: [{ name: { contains: "Girls Activities" } }, { name: { contains: "April 10" } }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      status: true,
      clusteringConfig: true,
    },
  });

  log(`\nGA-like schemas (${gaSchemas.length}):`);
  for (const s of gaSchemas) {
    log(`  ${s.id} | ${s.name} | ${s.status} | ${s.createdAt.toISOString().slice(0, 10)}`);
  }

  for (const s of gaSchemas) {
    const soccer = await p.entity.findFirst({
      where: {
        schemaId: s.id,
        name: { contains: "soccer", mode: "insensitive" },
        type: "PRIMARY",
      },
      select: { id: true, name: true, emailCount: true, isActive: true },
    });
    if (!soccer) {
      log(`\n[${s.name}] NO soccer entity found`);
      continue;
    }
    log(
      `\n[${s.name}] soccer entity: ${soccer.id} | emailCount=${soccer.emailCount} | active=${soccer.isActive}`,
    );

    const emails = await p.email.findMany({
      where: { entityId: soccer.id },
      select: {
        id: true,
        subject: true,
        date: true,
        threadId: true,
        senderEmail: true,
        senderDisplayName: true,
        tags: true,
        isExcluded: true,
        excludeReason: true,
        caseEmails: {
          select: {
            caseId: true,
            case: {
              select: {
                title: true,
                status: true,
                urgency: true,
                entityId: true,
              },
            },
          },
        },
      },
      orderBy: { date: "desc" },
    });

    const withCase = emails.filter((e) => e.caseEmails.length > 0).length;
    const withoutCase = emails.filter((e) => e.caseEmails.length === 0).length;
    const excluded = emails.filter((e) => e.isExcluded).length;
    log(`  Emails with entityId=soccer: ${emails.length}`);
    log(`    in a case:       ${withCase}`);
    log(`    orphan:          ${withoutCase}`);
    log(`    isExcluded=true: ${excluded}`);
    if (excluded > 0) {
      const reasons: Record<string, number> = {};
      for (const e of emails.filter((ex) => ex.isExcluded)) {
        const key = e.excludeReason || "null";
        reasons[key] = (reasons[key] || 0) + 1;
      }
      log(`    exclude reasons: ${JSON.stringify(reasons)}`);
    }

    const orphans = emails.filter((e) => e.caseEmails.length === 0).slice(0, 15);
    if (orphans.length > 0) {
      log(`\n  First 15 ORPHAN soccer emails (routed but in no case):`);
      for (const e of orphans) {
        const excl = e.isExcluded ? ` [EXCL:${e.excludeReason}]` : "";
        log(
          `    ${e.date.toISOString().slice(0, 10)} | ${e.senderDisplayName.slice(0, 25).padEnd(25)} | ${e.subject.slice(0, 60)}${excl}`,
        );
      }
    }

    const caseList = await p.case.findMany({
      where: { entityId: soccer.id },
      select: {
        id: true,
        title: true,
        status: true,
        urgency: true,
        endDate: true,
        nextActionDate: true,
        _count: { select: { caseEmails: true } },
      },
      orderBy: { endDate: "desc" },
    });
    log(`\n  Soccer cases (${caseList.length}):`);
    for (const c of caseList) {
      log(
        `    [${c._count.caseEmails}e|${c.status}|${c.urgency}|end=${c.endDate?.toISOString().slice(0, 10) || "-"}|next=${c.nextActionDate?.toISOString().slice(0, 10) || "-"}] ${c.title.slice(0, 60)}`,
      );
    }
  }

  log("\n" + "=".repeat(70));
  log("PROBE 2: 2919 SUNSET POINT — SHOWING CONFIRMED FRAGMENTATION");
  log("=".repeat(70));

  const pmSchema = await p.caseSchema.findFirst({
    where: { name: { contains: "April 11 Property Management" } },
    select: { id: true, name: true, clusteringConfig: true },
  });

  if (pmSchema) {
    log(`\nSchema: ${pmSchema.name} (${pmSchema.id})`);
    log(`\nclusteringConfig:`);
    log(JSON.stringify(pmSchema.clusteringConfig, null, 2));

    const sunsetEntity = await p.entity.findFirst({
      where: {
        schemaId: pmSchema.id,
        name: { contains: "2919 Sunset", mode: "insensitive" },
      },
      select: { id: true, name: true },
    });

    if (sunsetEntity) {
      const showingCases = await p.case.findMany({
        where: {
          entityId: sunsetEntity.id,
          title: { contains: "Showing", mode: "insensitive" },
        },
        select: {
          id: true,
          title: true,
          anchorTags: true,
          allTags: true,
          caseEmails: {
            select: {
              clusteringScore: true,
              email: {
                select: {
                  id: true,
                  subject: true,
                  date: true,
                  threadId: true,
                  senderEmail: true,
                  senderDisplayName: true,
                  tags: true,
                  discriminators: true,
                  routingDecision: true,
                },
              },
            },
          },
        },
        orderBy: { title: "asc" },
      });

      log(`\n"Showing..." cases for 2919 Sunset Point: ${showingCases.length}`);
      for (const c of showingCases) {
        log(`\n  CASE: ${c.title}`);
        log(`    id=${c.id}`);
        log(`    anchorTags=${JSON.stringify(c.anchorTags)}`);
        log(`    allTags=${JSON.stringify(c.allTags)}`);
        for (const ce of c.caseEmails) {
          const em = ce.email;
          log(`    EMAIL:`);
          log(`      subject:  "${em.subject}"`);
          log(`      date:     ${em.date.toISOString()}`);
          log(`      threadId: ${em.threadId}`);
          log(`      sender:   ${em.senderDisplayName} <${em.senderEmail}>`);
          log(`      tags:     ${JSON.stringify(em.tags)}`);
          log(`      discrims: ${JSON.stringify(em.discriminators)}`);
          log(`      cluScore: ${ce.clusteringScore}`);
          log(`      routing:  ${JSON.stringify(em.routingDecision)}`);
        }
      }
    } else {
      log(`\n(no 2919 Sunset entity found)`);
    }

    const clusters = await p.cluster.findMany({
      where: { schemaId: pmSchema.id },
      select: {
        id: true,
        action: true,
        clusterPass: true,
        score: true,
        scoreBreakdown: true,
        resultCaseId: true,
      },
      orderBy: { createdAt: "asc" },
    });
    log(`\nCluster records for PM schema: ${clusters.length}`);
    const grid: Record<string, number> = {};
    for (const c of clusters) {
      const k = `${c.clusterPass ?? "null"}|${c.action}`;
      grid[k] = (grid[k] || 0) + 1;
    }
    for (const [k, v] of Object.entries(grid)) log(`  ${k}: ${v}`);
  }

  log("\n" + "=".repeat(70));
  log("PROBE 3: PIPELINE INTELLIGENCE RECORDS");
  log("=".repeat(70));

  const aprSchemaIds = [
    pmSchema?.id,
    ...gaSchemas.filter((s) => s.name.includes("April 11")).map((s) => s.id),
  ].filter((x): x is string => !!x);

  const pi = await p.pipelineIntelligence.findMany({
    where: { schemaId: { in: aprSchemaIds } },
    select: {
      id: true,
      schemaId: true,
      stage: true,
      model: true,
      tokenCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  log(`\nPipelineIntelligence records (April 11 schemas): ${pi.length}`);
  const byStage: Record<string, number> = {};
  for (const r of pi) {
    const k = `${r.schemaId.slice(-6)} | ${r.stage}`;
    byStage[k] = (byStage[k] || 0) + 1;
  }
  for (const [k, v] of Object.entries(byStage)) log(`  ${k}: ${v}`);

  await p.$disconnect();
}

main().catch((e) => {
  log("FAIL: " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
