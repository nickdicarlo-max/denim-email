import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const log = (s: string) => process.stderr.write(s + "\n");

import { clusterEmails } from "@denim/engine/src/clustering/gravity-model";
// Import the actual scoring functions to simulate
import {
  actorScore,
  subjectScore,
  tagScore,
  threadScore,
  timeDecayMultiplier,
} from "@denim/engine/src/clustering/scoring";
import type { ClusterCaseInput, ClusterEmailInput, ClusteringConfig } from "@denim/types";

async function main() {
  log("=".repeat(70));
  log("PROBE: Scoring simulation — what would the gravity model produce?");
  log("=".repeat(70));

  // Load BOTH schemas
  for (const schemaName of ["April 11 Test Girls Activities", "April 11 Property Management"]) {
    const schema = await p.caseSchema.findFirst({
      where: { name: schemaName },
      select: {
        id: true,
        name: true,
        clusteringConfig: true,
        entities: {
          where: { isActive: true },
          select: { id: true, name: true, type: true },
        },
      },
    });
    if (!schema) {
      log(`\nSchema "${schemaName}" not found`);
      continue;
    }

    const config = schema.clusteringConfig as unknown as ClusteringConfig;
    log(`\n${"=".repeat(70)}`);
    log(`SCHEMA: ${schema.name}`);
    log(`${"=".repeat(70)}`);
    log(`\nClustering Config:`);
    log(`  mergeThreshold:         ${config.mergeThreshold}`);
    log(`  subjectMatchScore:      ${config.subjectMatchScore}`);
    log(`  tagMatchScore:          ${config.tagMatchScore}`);
    log(`  actorAffinityScore:     ${config.actorAffinityScore}`);
    log(`  threadMatchScore:       ${config.threadMatchScore}`);
    log(`  timeDecayDays.fresh:    ${config.timeDecayDays?.fresh ?? "default"}`);
    log(`  reminderCollapseEnabled: ${config.reminderCollapseEnabled}`);

    // Load ALL unclustered emails (simulate what clustering saw)
    const emails = await p.email.findMany({
      where: { schemaId: schema.id, isExcluded: false },
      select: {
        id: true,
        threadId: true,
        subject: true,
        summary: true,
        tags: true,
        date: true,
        senderEntityId: true,
        entityId: true,
        senderDisplayName: true,
        senderEmail: true,
      },
      orderBy: { date: "asc" },
    });

    const emailInputs: ClusterEmailInput[] = emails
      .filter((e) => e.entityId !== null)
      .map((e) => ({
        id: e.id,
        threadId: e.threadId,
        subject: e.subject,
        summary: e.summary ?? "",
        tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
        date: e.date,
        senderEntityId: e.senderEntityId,
        entityId: e.entityId,
      }));

    log(`\nEmails with entity: ${emailInputs.length}`);

    // Count unique thread groups
    const threadGroups = new Map<string, typeof emailInputs>();
    for (const e of emailInputs) {
      const group = threadGroups.get(e.threadId) ?? [];
      group.push(e);
      threadGroups.set(e.threadId, group);
    }
    log(`Unique thread groups: ${threadGroups.size}`);

    // Simulate the gravity model with NO existing cases (fresh schema)
    const now = new Date("2026-04-11T20:40:33Z"); // approximate clustering time
    const decisions = clusterEmails(emailInputs, [], config, now);

    const creates = decisions.filter((d) => d.action === "CREATE");
    const merges = decisions.filter((d) => d.action === "MERGE");
    log(`\n--- GRAVITY MODEL SIMULATION ---`);
    log(`Total decisions: ${decisions.length}`);
    log(
      `  CREATE: ${creates.length} (${creates.reduce((s, d) => s + d.emailIds.length, 0)} emails)`,
    );
    log(`  MERGE:  ${merges.length} (${merges.reduce((s, d) => s + d.emailIds.length, 0)} emails)`);

    // Show merge scores
    if (merges.length > 0) {
      log(`\n--- MERGE DECISION SCORES ---`);
      for (const m of merges.slice(0, 15)) {
        const email = emails.find((e) => e.id === m.emailIds[0]);
        log(
          `  score=${m.score.toFixed(1)} | target=${m.targetCaseId} | alt=${m.alternativeCaseId ?? "none"}`,
        );
        log(`    emails: ${m.emailIds.length} | subject: ${email?.subject?.slice(0, 60) ?? "?"}`);
        if (m.breakdown) {
          log(
            `    breakdown: thread=${m.breakdown.threadScore} subj=${m.breakdown.subjectScore.toFixed(1)} tag=${m.breakdown.tagScore.toFixed(1)} actor=${m.breakdown.actorScore} decay=${m.breakdown.timeDecayMultiplier.toFixed(3)}`,
          );
        }
      }
    }

    // Show a sample of CREATE scores (first 10 for brevity)
    log(`\n--- CREATE DECISIONS (first 10) ---`);
    for (const c of creates.slice(0, 10)) {
      const email = emails.find((e) => e.id === c.emailIds[0]);
      log(
        `  syntheticId=${c.entityId ? "has-entity" : "no-entity"} | emails=${c.emailIds.length} | subject: ${email?.subject?.slice(0, 60) ?? "?"}`,
      );
    }

    // What would cases look like after merges succeed?
    const uniqueCases = new Set<string>();
    for (const d of decisions) {
      if (d.action === "CREATE") {
        uniqueCases.add(`new-case-${decisions.indexOf(d)}`);
      } else {
        uniqueCases.add(d.targetCaseId!);
      }
    }
    log(`\n--- RESULTING CASE COUNT ---`);
    log(`  Without merges (CREATE only): ${creates.length} cases`);
    log(`  With merges (CREATE + MERGE): ${uniqueCases.size} cases`);
    log(
      `  Emails accounted for:         ${decisions.reduce((s, d) => s + d.emailIds.length, 0)} of ${emailInputs.length}`,
    );

    // Score distribution for near-threshold decisions
    const nearThreshold = decisions.filter(
      (d) => d.score > 0 && d.score < config.mergeThreshold * 1.5,
    );
    if (nearThreshold.length > 0) {
      log(`\n--- NEAR-THRESHOLD DECISIONS (score > 0 and < ${config.mergeThreshold * 1.5}) ---`);
      for (const d of nearThreshold.slice(0, 10)) {
        const email = emails.find((e) => e.id === d.emailIds[0]);
        log(
          `  action=${d.action} score=${d.score.toFixed(1)} | ${email?.subject?.slice(0, 50) ?? "?"}`,
        );
        if (d.breakdown) {
          log(
            `    subj=${d.breakdown.subjectScore.toFixed(1)} tag=${d.breakdown.tagScore.toFixed(1)} actor=${d.breakdown.actorScore} decay=${d.breakdown.timeDecayMultiplier.toFixed(3)}`,
          );
        }
      }
    }
  }

  await p.$disconnect();
}
main().catch((e) => {
  log("FAIL: " + e.message + "\n" + e.stack);
  process.exit(1);
});
