/**
 * Verify the synthetic ID fix: simulate the gravity model AND the write-phase
 * mapping to confirm MERGE decisions would now resolve correctly.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const log = (s: string) => process.stderr.write(s + "\n");

import type { ClusteringConfig, ClusterEmailInput } from "@denim/types";
import { clusterEmails } from "@denim/engine/src/clustering/gravity-model";

async function main() {
  log("=".repeat(70));
  log("VERIFY FIX: Simulate gravity model + write-phase mapping");
  log("=".repeat(70));

  const ga11 = await p.caseSchema.findFirst({
    where: { name: "April 11 Test Girls Activities" },
    select: { id: true, name: true, clusteringConfig: true },
  });
  if (!ga11) { log("Schema not found"); return; }

  const config = ga11.clusteringConfig as unknown as ClusteringConfig;
  log(`\nSchema: ${ga11.name}`);
  log(`mergeThreshold: ${config.mergeThreshold}`);

  // Load emails (simulate what clustering would see)
  const emails = await p.email.findMany({
    where: { schemaId: ga11.id, isExcluded: false, entityId: { not: null } },
    select: {
      id: true, threadId: true, subject: true, summary: true,
      tags: true, date: true, senderEntityId: true, entityId: true,
    },
    orderBy: { date: "asc" },
  });

  const emailInputs: ClusterEmailInput[] = emails.map(e => ({
    id: e.id, threadId: e.threadId, subject: e.subject,
    summary: e.summary ?? "", date: e.date,
    tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
    senderEntityId: e.senderEntityId, entityId: e.entityId,
  }));

  log(`Emails: ${emailInputs.length}`);

  // Run gravity model
  const now = new Date("2026-04-11T20:40:33Z");
  const decisions = clusterEmails(emailInputs, [], config, now);

  const creates = decisions.filter(d => d.action === "CREATE");
  const merges = decisions.filter(d => d.action === "MERGE");

  log(`\n--- GRAVITY MODEL OUTPUT ---`);
  log(`Decisions: ${decisions.length} (${creates.length} CREATE, ${merges.length} MERGE)`);

  // Simulate the write-phase mapping (the fix)
  const syntheticToReal = new Map<string, string>();
  let casesCreated = 0;
  let casesMerged = 0;
  let mergesResolved = 0;
  let mergesUnresolved = 0;

  for (const [decisionIndex, decision] of decisions.entries()) {
    if (decision.action === "CREATE") {
      const fakeCuid = `real-case-${casesCreated}`;
      syntheticToReal.set(`new-case-${decisionIndex}`, fakeCuid);
      casesCreated++;
    } else {
      // MERGE -- resolve synthetic target
      let targetCaseId = decision.targetCaseId!;
      if (targetCaseId.startsWith("new-case-")) {
        const realId = syntheticToReal.get(targetCaseId);
        if (realId) {
          mergesResolved++;
        } else {
          mergesUnresolved++;
        }
      }
      casesMerged++;
    }
  }

  log(`\n--- WRITE-PHASE MAPPING SIMULATION ---`);
  log(`Synthetic IDs mapped: ${syntheticToReal.size}`);
  log(`Cases created:        ${casesCreated}`);
  log(`Merges resolved:      ${mergesResolved} of ${casesMerged}`);
  log(`Merges UNRESOLVED:    ${mergesUnresolved} (would still be dropped)`);

  // Count emails per resulting case
  const caseEmails = new Map<string, number>();
  for (const [decisionIndex, decision] of decisions.entries()) {
    let caseKey: string;
    if (decision.action === "CREATE") {
      caseKey = syntheticToReal.get(`new-case-${decisionIndex}`)!;
    } else {
      const target = decision.targetCaseId!;
      caseKey = target.startsWith("new-case-") ? (syntheticToReal.get(target) ?? target) : target;
    }
    caseEmails.set(caseKey, (caseEmails.get(caseKey) ?? 0) + decision.emailIds.length);
  }

  log(`\n--- RESULTING CASES (with merges working) ---`);
  log(`Total cases: ${caseEmails.size}`);
  const emailCounts = [...caseEmails.values()].sort((a, b) => b - a);
  log(`Emails per case: ${emailCounts.join(", ")}`);
  log(`Total emails accounted for: ${emailCounts.reduce((s, n) => s + n, 0)} of ${emailInputs.length}`);
  const singletons = emailCounts.filter(c => c === 1).length;
  log(`Singleton cases: ${singletons} of ${caseEmails.size} (${(singletons/caseEmails.size*100).toFixed(0)}%)`);

  // Also verify alternativeCaseId resolution
  const altCaseIds = merges
    .map(d => d.alternativeCaseId)
    .filter(Boolean);
  const altResolved = altCaseIds.filter(id => !id!.startsWith("new-case-") || syntheticToReal.has(id!));
  const altUnresolved = altCaseIds.filter(id => id!.startsWith("new-case-") && !syntheticToReal.has(id!));
  log(`\n--- ALTERNATIVE CASE ID RESOLUTION ---`);
  log(`Total with alternativeCaseId: ${altCaseIds.length}`);
  log(`Resolved: ${altResolved.length}`);
  log(`Unresolved: ${altUnresolved.length}`);

  await p.$disconnect();
}
main().catch((e) => { log("FAIL: " + e.message); process.exit(1); });
