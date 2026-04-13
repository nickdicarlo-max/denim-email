import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const log = (s: string) => process.stderr.write(s + "\n");

async function main() {
  log("=".repeat(70));
  log("PROBE 3: Email distribution by entityId/isExcluded across both GA");
  log("=".repeat(70));

  const gaSchemas = await p.caseSchema.findMany({
    where: { OR: [{ name: { contains: "Girls Activities" } }, { name: { contains: "April 10" } }] },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  for (const s of gaSchemas) {
    log("\n" + "-".repeat(70));
    log(`SCHEMA: ${s.name}`);
    log("-".repeat(70));

    const all = await p.email.findMany({
      where: { schemaId: s.id },
      select: {
        id: true,
        entityId: true,
        isExcluded: true,
        excludeReason: true,
        senderEntityId: true,
        senderEmail: true,
        senderDisplayName: true,
        caseEmails: { select: { caseId: true } },
      },
    });

    log(`Total Email rows: ${all.length}`);
    const counts = {
      entityIdSet: 0, entityIdNull: 0,
      excluded: 0, notExcluded: 0,
      inCase: 0, orphan: 0,
      // composite
      entitySetExcluded: 0, entitySetNotExcl: 0,
      entityNullExcluded: 0, entityNullNotExcl: 0,
      // orphan breakdown
      orphanEntitySet: 0, orphanEntityNull: 0, orphanExcluded: 0,
    };
    for (const e of all) {
      if (e.entityId) counts.entityIdSet++;
      else counts.entityIdNull++;
      if (e.isExcluded) counts.excluded++;
      else counts.notExcluded++;
      if (e.caseEmails.length > 0) counts.inCase++;
      else counts.orphan++;

      if (e.entityId && e.isExcluded) counts.entitySetExcluded++;
      if (e.entityId && !e.isExcluded) counts.entitySetNotExcl++;
      if (!e.entityId && e.isExcluded) counts.entityNullExcluded++;
      if (!e.entityId && !e.isExcluded) counts.entityNullNotExcl++;

      if (e.caseEmails.length === 0) {
        if (e.entityId) counts.orphanEntitySet++;
        else counts.orphanEntityNull++;
        if (e.isExcluded) counts.orphanExcluded++;
      }
    }
    log(`  entityId set:  ${counts.entityIdSet}`);
    log(`  entityId null: ${counts.entityIdNull}`);
    log(`  isExcluded:    ${counts.excluded}`);
    log(`  in a case:     ${counts.inCase}`);
    log(`  orphan:        ${counts.orphan}`);
    log(``);
    log(`  CROSSTAB:`);
    log(`    entitySet+notExcl:    ${counts.entitySetNotExcl}  <- SHOULD have been clustered`);
    log(`    entitySet+excluded:   ${counts.entitySetExcluded}`);
    log(`    entityNull+notExcl:   ${counts.entityNullNotExcl}`);
    log(`    entityNull+excluded:  ${counts.entityNullExcluded}`);
    log(``);
    log(`  ORPHAN BREAKDOWN:`);
    log(`    orphan+entitySet: ${counts.orphanEntitySet}  <- the bug`);
    log(`    orphan+entityNull: ${counts.orphanEntityNull}`);
    log(`    orphan+isExcluded: ${counts.orphanExcluded}`);

    // Exclude reasons
    if (counts.excluded > 0) {
      const reasons: Record<string, number> = {};
      for (const e of all.filter((x) => x.isExcluded)) {
        const k = e.excludeReason || "(null)";
        reasons[k] = (reasons[k] || 0) + 1;
      }
      log(`\n  Excluded reasons:`);
      for (const [k, v] of Object.entries(reasons)) log(`    ${k}: ${v}`);
    }

    // Sender breakdown for the entitySet+notExcl orphans (the bug surface)
    const orphansEligible = all.filter(
      (e) => e.caseEmails.length === 0 && e.entityId && !e.isExcluded,
    );
    if (orphansEligible.length > 0) {
      const senderCounts: Record<string, number> = {};
      for (const e of orphansEligible) {
        senderCounts[e.senderEmail] = (senderCounts[e.senderEmail] || 0) + 1;
      }
      const sorted = Object.entries(senderCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      log(`\n  TOP SENDERS in orphans-with-entity (the bug surface):`);
      for (const [email, n] of sorted) log(`    ${n.toString().padStart(4)} | ${email}`);
    }
  }

  await p.$disconnect();
}
main().catch((e) => { log("FAIL: " + e.message); process.exit(1); });
