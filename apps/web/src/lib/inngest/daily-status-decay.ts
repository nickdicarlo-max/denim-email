import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { inngest } from "./client";
import { computeCaseDecay } from "@denim/engine";

/**
 * Daily status decay: expires past actions, recalculates urgency tiers,
 * resolves cases with no remaining actions, and updates nextActionDate.
 * Runs at 6 AM ET daily for all non-terminal cases.
 */
export const dailyStatusDecay = inngest.createFunction(
  {
    id: "daily-status-decay",
    triggers: [{ cron: "TZ=America/New_York 0 6 * * *" }],
    concurrency: { limit: 1 },
    retries: 1,
  },
  async ({ step }) => {
    const now = new Date();

    const cases = await step.run("load-cases", async () => {
      return prisma.case.findMany({
        where: {
          status: { not: "RESOLVED" },
          urgency: { not: "IRRELEVANT" },
        },
        select: {
          id: true,
          status: true,
          urgency: true,
          lastEmailDate: true,
          actions: {
            where: { status: "PENDING" },
            select: {
              id: true,
              status: true,
              dueDate: true,
              eventStartTime: true,
              eventEndTime: true,
            },
          },
        },
      });
    });

    let updatedCount = 0;

    for (const c of cases) {
      // step.run serializes Dates to strings; reconvert for pure functions
      const toDate = (v: string | Date | null): Date | null =>
        v == null ? null : v instanceof Date ? v : new Date(v);

      const decay = computeCaseDecay(
        {
          caseStatus: c.status as "OPEN" | "IN_PROGRESS" | "RESOLVED",
          caseUrgency: c.urgency ?? "UPCOMING",
          actions: c.actions.map((a) => ({
            id: a.id,
            status: a.status as "PENDING",
            dueDate: toDate(a.dueDate),
            eventStartTime: toDate(a.eventStartTime),
            eventEndTime: toDate(a.eventEndTime),
          })),
          lastEmailDate: toDate(c.lastEmailDate) ?? now,
        },
        now,
      );

      if (!decay.changed) continue;

      await step.run(`decay-${c.id}`, async () => {
        if (decay.expiredActionIds.length > 0) {
          await prisma.caseAction.updateMany({
            where: { id: { in: decay.expiredActionIds } },
            data: { status: "EXPIRED" },
          });
        }

        await prisma.case.update({
          where: { id: c.id },
          data: {
            urgency: decay.updatedUrgency,
            status: decay.updatedStatus,
            nextActionDate: decay.nextActionDate,
          },
        });

        updatedCount++;
      });
    }

    logger.info({
      service: "inngest",
      operation: "dailyStatusDecay",
      totalCases: cases.length,
      updatedCount,
    });
  },
);
