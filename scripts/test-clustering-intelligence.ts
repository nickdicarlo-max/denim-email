/**
 * Clustering Intelligence Experiment
 *
 * Compares three clustering approaches on the same email data:
 *   Set A: Gravity model with default params (what we have today)
 *   Set B: AI intelligence groups (Claude reads emails, suggests groupings)
 *   Set C: Gravity model with AI-calibrated params (the bridge)
 *
 * No pipeline changes, no Case/CaseEmail writes. Gravity model runs in-memory.
 * Results saved to PipelineIntelligence for review.
 *
 * Usage:
 *   npx tsx scripts/test-clustering-intelligence.ts                         # most recent schema
 *   npx tsx scripts/test-clustering-intelligence.ts cmn1x29e60001qey4d236irrn  # specific schema
 */

import * as crypto from "node:crypto";
import * as path from "node:path";
import * as dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config({ path: path.join(process.cwd(), "apps", "web", ".env.local") });

// Types are imported dynamically to avoid tsx path resolution issues
type ClusterDecision = any;
type ClusterEmailInput = any;
type ClusteringConfig = any;

import {
  buildClusteringIntelligencePrompt,
  parseClusteringIntelligenceResponse,
} from "../packages/ai/src/index";
import { clusterEmails } from "../packages/engine/src/clustering/gravity-model";

// ---------------------------------------------------------------------------
// Prisma setup (same pattern as test-alias-detection.ts)
// ---------------------------------------------------------------------------

let prisma: any;

async function createPrisma() {
  const { pathToFileURL } = await import("node:url");
  const adapterPath = require.resolve("@prisma/adapter-pg", {
    paths: [path.join(process.cwd(), "apps", "web")],
  });
  const adapterMod = await import(pathToFileURL(adapterPath).href);
  const clientPath = path.join(
    process.cwd(), "apps", "web", "prisma", "generated", "prisma", "client", "client.ts",
  );
  const mod = await import(pathToFileURL(clientPath).href);
  const adapter = new adapterMod.PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new mod.PrismaClient({ adapter });
}

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group ClusterDecisions into synthetic "cases" for comparison. */
function decisionsToGroups(decisions: ClusterDecision[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  let nextCaseIdx = 0;

  for (const d of decisions) {
    if (d.action === "CREATE") {
      const key = `case-${nextCaseIdx++}`;
      groups.set(key, [...d.emailIds]);
    } else if (d.action === "MERGE" && d.targetCaseId) {
      const existing = groups.get(d.targetCaseId);
      if (existing) {
        existing.push(...d.emailIds);
      } else {
        groups.set(d.targetCaseId, [...d.emailIds]);
      }
    }
  }

  return groups;
}

/** Compute agreement rate: what fraction of email pairs are grouped the same way. */
function computeAgreement(
  groupsA: Map<string, string[]>,
  groupsB: Map<string, string[]>,
): { rate: number; totalPairs: number; agreedPairs: number } {
  // Build email→group lookup for each set
  const lookupA = new Map<string, string>();
  for (const [groupId, emailIds] of groupsA) {
    for (const id of emailIds) lookupA.set(id, groupId);
  }
  const lookupB = new Map<string, string>();
  for (const [groupId, emailIds] of groupsB) {
    for (const id of emailIds) lookupB.set(id, groupId);
  }

  // Only compare emails present in both sets
  const commonEmails = [...lookupA.keys()].filter((id) => lookupB.has(id));
  if (commonEmails.length < 2) return { rate: 0, totalPairs: 0, agreedPairs: 0 };

  let totalPairs = 0;
  let agreedPairs = 0;

  for (let i = 0; i < commonEmails.length; i++) {
    for (let j = i + 1; j < commonEmails.length; j++) {
      totalPairs++;
      const sameInA = lookupA.get(commonEmails[i]) === lookupA.get(commonEmails[j]);
      const sameInB = lookupB.get(commonEmails[i]) === lookupB.get(commonEmails[j]);
      if (sameInA === sameInB) agreedPairs++;
    }
  }

  return { rate: agreedPairs / totalPairs, totalPairs, agreedPairs };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Clustering Intelligence Experiment");
  console.log("==================================\n");

  const schemaIdArg = process.argv[2];
  prisma = await createPrisma();

  // --- Load schema + extracted emails ---
  console.log("Loading schema and extracted emails...");
  const schema = await prisma.caseSchema.findFirst({
    where: schemaIdArg
      ? { id: schemaIdArg }
      : { status: { in: ["ACTIVE", "ONBOARDING"] } },
    orderBy: { createdAt: "desc" },
    include: {
      entities: true,
      entityGroups: { include: { entities: true } },
    },
  });

  if (!schema) throw new Error(schemaIdArg ? `Schema ${schemaIdArg} not found` : "No schema found");

  const rawConfig = schema.clusteringConfig as unknown as ClusteringConfig;
  if (!rawConfig) throw new Error("Schema has no clusteringConfig");
  // Existing schemas may not have tagMatchScore — default to 0 for Sets A/C (old behavior)
  const config: ClusteringConfig = { ...rawConfig, tagMatchScore: rawConfig.tagMatchScore ?? 0 };

  console.log(`  Schema: "${schema.name}" (${schema.domain})`);
  console.log(`  ID: ${schema.id}`);
  console.log(`  Config: mergeThreshold=${config.mergeThreshold}, threadMatch=${config.threadMatchScore}, subjectMatch=${config.subjectMatchScore}, actorAffinity=${config.actorAffinityScore}, tagMatch=${config.tagMatchScore}, freshDays=${config.timeDecayDays.fresh}`);

  const emails = await prisma.email.findMany({
    where: { schemaId: schema.id, isExcluded: false },
    select: {
      id: true, threadId: true, subject: true, summary: true,
      tags: true, date: true, senderEntityId: true, entityId: true,
      senderDisplayName: true, senderEmail: true, senderDomain: true,
    },
    orderBy: { date: "asc" },
  });

  console.log(`  Emails: ${emails.length}`);

  if (emails.length === 0) throw new Error("No extracted emails — run the pipeline first");

  // Build entity lookup
  const entityById = new Map<string, string>();
  for (const e of schema.entities) {
    entityById.set(e.id, e.name);
  }

  // Transform emails to ClusterEmailInput for gravity model
  const emailInputs: ClusterEmailInput[] = emails
    .filter((e: any) => e.entityId !== null)
    .map((e: any) => ({
      id: e.id,
      threadId: e.threadId,
      subject: e.subject,
      summary: e.summary ?? "",
      tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
      date: new Date(e.date),
      senderEntityId: e.senderEntityId,
      entityId: e.entityId,
    }));

  console.log(`  Emails with entity: ${emailInputs.length} (${emails.length - emailInputs.length} skipped — no entity)`);

  // =========================================================================
  // SET A: Gravity model with default params
  // =========================================================================
  console.log("\n=== SET A: Gravity Model (default params) ===\n");
  console.log(`Config: mergeThreshold=${config.mergeThreshold}, subjectMatch=${config.subjectMatchScore}, actorAffinity=${config.actorAffinityScore}, freshDays=${config.timeDecayDays.fresh}`);

  const setADecisions = clusterEmails(emailInputs, [], config, new Date());
  const setAGroups = decisionsToGroups(setADecisions);

  const creates = setADecisions.filter((d) => d.action === "CREATE").length;
  const merges = setADecisions.filter((d) => d.action === "MERGE").length;
  console.log(`Decisions: ${creates} CREATE, ${merges} MERGE → ${setAGroups.size} cases\n`);

  for (const [caseId, emailIds] of setAGroups) {
    const representative = emailInputs.find((e) => e.id === emailIds[0]);
    const entityName = representative?.entityId ? entityById.get(representative.entityId) ?? "?" : "?";
    console.log(`  [${caseId}] ${emailIds.length} emails | Entity: ${entityName} | "${representative?.subject.slice(0, 60)}"`);
  }

  // =========================================================================
  // SET B: AI intelligence groups
  // =========================================================================
  console.log("\n=== SET B: AI Intelligence Groups ===\n");
  console.log("Calling Claude (this may take 30-60 seconds)...");

  // Build intelligence input
  const intelligenceInput = {
    domain: schema.domain,
    today: new Date().toISOString().split("T")[0],
    entityGroups: schema.entityGroups.map((g: any) => ({
      whats: g.entities.filter((e: any) => e.type === "PRIMARY").map((e: any) => e.name),
      whos: g.entities.filter((e: any) => e.type === "SECONDARY").map((e: any) => e.name),
    })),
    emails: emails
      .filter((e: any) => e.entityId !== null)
      .slice(0, 150) // Cap to stay within token limits
      .map((e: any) => ({
        id: e.id,
        subject: e.subject,
        senderDisplayName: e.senderDisplayName ?? e.senderEmail,
        senderDomain: e.senderDomain ?? "unknown",
        date: new Date(e.date).toISOString().split("T")[0],
        summary: (e.summary ?? "").slice(0, 200),
        tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
        entityName: e.entityId ? entityById.get(e.entityId) ?? null : null,
      })),
    currentConfig: {
      mergeThreshold: config.mergeThreshold,
      threadMatchScore: config.threadMatchScore,
      subjectMatchScore: config.subjectMatchScore,
      actorAffinityScore: config.actorAffinityScore,
      timeDecayFreshDays: config.timeDecayDays.fresh,
    },
  };

  if (intelligenceInput.emails.length < emails.filter((e: any) => e.entityId).length) {
    console.log(`  (Capped at 150 emails, ${emails.filter((e: any) => e.entityId).length - intelligenceInput.emails.length} omitted)`);
  }

  const prompt = buildClusteringIntelligencePrompt(intelligenceInput);
  console.log(`  System prompt: ${prompt.system.length} chars`);
  console.log(`  User prompt: ${prompt.user.length} chars`);

  const startTime = Date.now();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });

  const latencyMs = Date.now() - startTime;
  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock && "text" in textBlock ? textBlock.text : "";

  console.log(`  Response in ${(latencyMs / 1000).toFixed(1)}s | Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);

  let intelligence: ReturnType<typeof parseClusteringIntelligenceResponse>;
  try {
    intelligence = parseClusteringIntelligenceResponse(content);
  } catch (error) {
    console.error("\nFailed to parse response. Raw output:\n");
    console.error(content.slice(0, 2000));
    throw error;
  }

  console.log(`\nAI Groups: ${intelligence.groups.length}`);
  const setBGroups = new Map<string, string[]>();
  for (let i = 0; i < intelligence.groups.length; i++) {
    const g = intelligence.groups[i];
    setBGroups.set(`ai-${i}`, g.emailIds);
    const recurring = g.isRecurring ? ` (recurring: ${g.recurringPattern})` : "";
    console.log(`  "${g.caseTitle}" — ${g.emailIds.length} emails${recurring}`);
    console.log(`    Reasoning: ${g.reasoning.slice(0, 150)}`);
  }

  if (intelligence.excludeSuggestions.length > 0) {
    console.log(`\nExclude suggestions: ${intelligence.excludeSuggestions.length} emails`);
    if (intelligence.excludeReasoning) {
      console.log(`  Reason: ${intelligence.excludeReasoning}`);
    }
  }

  console.log(`\nConfig overrides suggested:`);
  const ov = intelligence.configOverrides;
  if (ov.mergeThreshold != null) console.log(`  mergeThreshold: ${config.mergeThreshold} → ${ov.mergeThreshold}`);
  if (ov.subjectMatchScore != null) console.log(`  subjectMatchScore: ${config.subjectMatchScore} → ${ov.subjectMatchScore}`);
  if (ov.actorAffinityScore != null) console.log(`  actorAffinityScore: ${config.actorAffinityScore} → ${ov.actorAffinityScore}`);
  if (ov.timeDecayFreshDays != null) console.log(`  timeDecayFreshDays: ${config.timeDecayDays.fresh} → ${ov.timeDecayFreshDays}`);
  if (!ov.mergeThreshold && !ov.subjectMatchScore && !ov.actorAffinityScore && !ov.timeDecayFreshDays) {
    console.log(`  (none — AI kept defaults)`);
  }
  console.log(`  Reasoning: ${ov.reasoning}`);

  // =========================================================================
  // SET C: Gravity model with AI-calibrated params
  // =========================================================================
  console.log("\n=== SET C: Gravity Model (AI-calibrated params) ===\n");

  const calibratedConfig: ClusteringConfig = { ...config, timeDecayDays: { ...config.timeDecayDays } };
  if (ov.mergeThreshold != null) calibratedConfig.mergeThreshold = ov.mergeThreshold;
  if (ov.subjectMatchScore != null) calibratedConfig.subjectMatchScore = ov.subjectMatchScore;
  if (ov.actorAffinityScore != null) calibratedConfig.actorAffinityScore = ov.actorAffinityScore;
  if (ov.timeDecayFreshDays != null) calibratedConfig.timeDecayDays = { fresh: ov.timeDecayFreshDays };

  console.log(`Config: mergeThreshold=${calibratedConfig.mergeThreshold}, subjectMatch=${calibratedConfig.subjectMatchScore}, actorAffinity=${calibratedConfig.actorAffinityScore}, freshDays=${calibratedConfig.timeDecayDays.fresh}`);

  // Filter out excluded emails
  const excludeSet = new Set(intelligence.excludeSuggestions);
  const filteredInputs = emailInputs.filter((e) => !excludeSet.has(e.id));
  if (excludeSet.size > 0) {
    console.log(`Excluded ${emailInputs.length - filteredInputs.length} emails per AI suggestion`);
  }

  const setCDecisions = clusterEmails(filteredInputs, [], calibratedConfig, new Date());
  const setCGroups = decisionsToGroups(setCDecisions);

  const createsC = setCDecisions.filter((d) => d.action === "CREATE").length;
  const mergesC = setCDecisions.filter((d) => d.action === "MERGE").length;
  console.log(`Decisions: ${createsC} CREATE, ${mergesC} MERGE → ${setCGroups.size} cases\n`);

  for (const [caseId, emailIds] of setCGroups) {
    const representative = filteredInputs.find((e) => e.id === emailIds[0]);
    const entityName = representative?.entityId ? entityById.get(representative.entityId) ?? "?" : "?";
    console.log(`  [${caseId}] ${emailIds.length} emails | Entity: ${entityName} | "${representative?.subject.slice(0, 60)}"`);
  }

  // =========================================================================
  // SET D: Gravity model with tag scoring enabled (new feature)
  // =========================================================================
  console.log("\n=== SET D: Gravity Model (tag scoring enabled, tagMatchScore=25) ===\n");

  const tagConfig: ClusteringConfig = { ...config, tagMatchScore: 25 };
  console.log(`Config: mergeThreshold=${tagConfig.mergeThreshold}, subjectMatch=${tagConfig.subjectMatchScore}, actorAffinity=${tagConfig.actorAffinityScore}, tagMatch=${tagConfig.tagMatchScore}, freshDays=${tagConfig.timeDecayDays.fresh}`);

  const setDDecisions = clusterEmails(emailInputs, [], tagConfig, new Date());
  const setDGroups = decisionsToGroups(setDDecisions);

  const createsD = setDDecisions.filter((d) => d.action === "CREATE").length;
  const mergesD = setDDecisions.filter((d) => d.action === "MERGE").length;
  console.log(`Decisions: ${createsD} CREATE, ${mergesD} MERGE → ${setDGroups.size} cases\n`);

  for (const [caseId, emailIds] of setDGroups) {
    const representative = emailInputs.find((e) => e.id === emailIds[0]);
    const entityName = representative?.entityId ? entityById.get(representative.entityId) ?? "?" : "?";
    console.log(`  [${caseId}] ${emailIds.length} emails | Entity: ${entityName} | "${representative?.subject.slice(0, 60)}"`);
  }

  // =========================================================================
  // COMPARISON
  // =========================================================================
  console.log("\n=== COMPARISON ===\n");

  const aVsB = computeAgreement(setAGroups, setBGroups);
  const cVsB = computeAgreement(setCGroups, setBGroups);
  const dVsB = computeAgreement(setDGroups, setBGroups);
  const aVsD = computeAgreement(setAGroups, setDGroups);

  console.log(`Set A (default, no tags) vs Set B (AI):    ${(aVsB.rate * 100).toFixed(1)}% pair agreement (${aVsB.agreedPairs}/${aVsB.totalPairs} pairs)`);
  console.log(`Set C (AI-calibrated)    vs Set B (AI):    ${(cVsB.rate * 100).toFixed(1)}% pair agreement (${cVsB.agreedPairs}/${cVsB.totalPairs} pairs)`);
  console.log(`Set D (tag scoring)      vs Set B (AI):    ${(dVsB.rate * 100).toFixed(1)}% pair agreement (${dVsB.agreedPairs}/${dVsB.totalPairs} pairs)`);
  console.log(`Set A (default)          vs Set D (tags):  ${(aVsD.rate * 100).toFixed(1)}% pair agreement (${aVsD.agreedPairs}/${aVsD.totalPairs} pairs)`);

  const improvementC = cVsB.rate - aVsB.rate;
  const improvementD = dVsB.rate - aVsB.rate;

  console.log(`\nCase counts: A=${setAGroups.size}, B=${setBGroups.size}, C=${setCGroups.size}, D=${setDGroups.size}`);
  console.log(`AI agreement improvement over baseline (A):`);
  console.log(`  Set C (AI param tuning): ${improvementC > 0.001 ? "+" : ""}${(improvementC * 100).toFixed(1)}pp`);
  console.log(`  Set D (tag scoring):     ${improvementD > 0.001 ? "+" : ""}${(improvementD * 100).toFixed(1)}pp`);

  // =========================================================================
  // Save to PipelineIntelligence
  // =========================================================================
  console.log("\nSaving experiment results to PipelineIntelligence...");

  await prisma.pipelineIntelligence.create({
    data: {
      schemaId: schema.id,
      stage: "clustering-intelligence-experiment-v2",
      model: MODEL,
      tokenCount: response.usage.input_tokens + response.usage.output_tokens,
      input: {
        emailCount: emailInputs.length,
        defaultConfig: {
          mergeThreshold: config.mergeThreshold,
          threadMatchScore: config.threadMatchScore,
          subjectMatchScore: config.subjectMatchScore,
          actorAffinityScore: config.actorAffinityScore,
          tagMatchScore: config.tagMatchScore,
          timeDecayFreshDays: config.timeDecayDays.fresh,
        },
      },
      output: {
        setA: { caseCount: setAGroups.size, groups: Object.fromEntries(setAGroups) },
        setB: { groupCount: setBGroups.size, groups: intelligence.groups, configOverrides: intelligence.configOverrides },
        setC: { caseCount: setCGroups.size, groups: Object.fromEntries(setCGroups) },
        setD: { caseCount: setDGroups.size, groups: Object.fromEntries(setDGroups), tagMatchScore: 25 },
        comparison: {
          aVsBMatchRate: aVsB.rate,
          cVsBMatchRate: cVsB.rate,
          dVsBMatchRate: dVsB.rate,
          improvementC,
          improvementD,
        },
      },
    },
  });

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma?.$disconnect());
