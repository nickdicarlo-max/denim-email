/**
 * One-time backfill: compute and write nextActionDate for all non-resolved cases.
 * Run from apps/web/ with dotenv loaded and DATABASE_URL set to DIRECT_URL.
 */
import { PrismaClient } from "@prisma/client";
import { computeNextActionDate } from "@denim/engine";

const prisma = new PrismaClient();

async function main() {
  const cases = await prisma.case.findMany({
    where: { status: { not: "RESOLVED" } },
    select: {
      id: true,
      actions: {
        where: { status: "PENDING" },
        select: { dueDate: true, eventStartTime: true, status: true },
      },
    },
  });

  let updated = 0;
  for (const c of cases) {
    const nextActionDate = computeNextActionDate(
      c.actions.map((a) => ({
        status: a.status as "PENDING",
        dueDate: a.dueDate,
        eventStartTime: a.eventStartTime,
      })),
    );

    await prisma.case.update({
      where: { id: c.id },
      data: { nextActionDate },
    });
    if (nextActionDate !== null) updated++;
  }

  console.error(`Backfilled nextActionDate for ${updated}/${cases.length} cases`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
