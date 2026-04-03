/**
 * Analyze what features Claude uses to form its intelligence groups.
 * Reads the experiment results from PipelineIntelligence and cross-references
 * with the actual email data to find shared features within each AI group.
 *
 * Usage:
 *   npx tsx scripts/analyze-ai-groups.ts                          # all schemas with experiments
 *   npx tsx scripts/analyze-ai-groups.ts cmmyu83dw0001qe805si7dotg  # specific schema
 */

import * as path from "node:path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), "apps", "web", ".env.local") });
import { pathToFileURL } from "node:url";

let prisma: any;

async function createPrisma() {
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

async function analyzeSchema(schemaId: string) {
  // Get the experiment
  const intel = await prisma.pipelineIntelligence.findFirst({
    where: { schemaId, stage: "clustering-intelligence-experiment" },
    orderBy: { createdAt: "desc" },
    select: { output: true, createdAt: true },
  });

  if (!intel) {
    console.error(`  No experiment found for schema ${schemaId}`);
    return;
  }

  const groups = intel.output.setB.groups;

  // Get the schema
  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId },
    select: { name: true, domain: true, entities: { select: { id: true, name: true, type: true } } },
  });

  // Get emails
  const emails = await prisma.email.findMany({
    where: { schemaId, isExcluded: false },
    select: {
      id: true, threadId: true, subject: true, summary: true,
      tags: true, senderDisplayName: true, senderDomain: true,
      senderEmail: true, entityId: true, senderEntityId: true,
    },
  });

  const emailMap = new Map(emails.map((e: any) => [e.id, e]));
  const entityById = new Map(schema.entities.map((e: any) => [e.id, e.name]));

  console.error(`\n${"=".repeat(80)}`);
  console.error(`SCHEMA: "${schema.name}" (${schema.domain}) — ${emails.length} emails`);
  console.error(`${"=".repeat(80)}`);

  // Track which features are discriminating across groups
  const allGroupFeatures: Array<{
    title: string;
    emailCount: number;
    uniqueThreads: number;
    dominantEntity: string;
    entityPurity: number;
    dominantDomain: string;
    domainPurity: number;
    dominantSender: string;
    senderPurity: number;
    topTags: string[];
    tagOverlap: number;
    subjectKeywords: string[];
  }> = [];

  for (const g of groups) {
    const groupEmails = g.emailIds
      .map((id: string) => emailMap.get(id))
      .filter(Boolean);

    if (groupEmails.length === 0) continue;

    console.error(`\n--- "${g.caseTitle}" (${groupEmails.length} emails) ---`);
    if (g.isRecurring) console.error(`  Recurring: ${g.recurringPattern}`);

    // Thread analysis
    const threadIds = new Set(groupEmails.map((e: any) => e.threadId));
    const threadRatio = threadIds.size / groupEmails.length;
    console.error(`  Threads: ${threadIds.size} unique / ${groupEmails.length} emails (${(threadRatio * 100).toFixed(0)}% unique — ${threadRatio > 0.8 ? "MOSTLY NON-THREADED" : threadRatio < 0.3 ? "HEAVILY THREADED" : "MIXED"})`);

    // Entity analysis
    const entityCounts = new Map<string, number>();
    for (const e of groupEmails) {
      const name = e.entityId ? entityById.get(e.entityId) ?? e.entityId : "none";
      entityCounts.set(name, (entityCounts.get(name) || 0) + 1);
    }
    const topEntity = [...entityCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const entityPurity = topEntity[1] / groupEmails.length;
    console.error(`  Entity: ${topEntity[0]} (${(entityPurity * 100).toFixed(0)}% purity) ${entityCounts.size > 1 ? `+ ${[...entityCounts.entries()].slice(1).map(([e, c]) => `${e}(${c})`).join(", ")}` : ""}`);

    // Sender domain analysis
    const domainCounts = new Map<string, number>();
    for (const e of groupEmails) {
      domainCounts.set(e.senderDomain || "unknown", (domainCounts.get(e.senderDomain || "unknown") || 0) + 1);
    }
    const topDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const domainPurity = topDomain[1] / groupEmails.length;
    console.error(`  Domain: ${topDomain[0]} (${(domainPurity * 100).toFixed(0)}% purity) ${domainCounts.size > 1 ? `+ ${[...domainCounts.entries()].filter(([d]) => d !== topDomain[0]).map(([d, c]) => `${d}(${c})`).join(", ")}` : ""}`);

    // Sender name analysis
    const senderCounts = new Map<string, number>();
    for (const e of groupEmails) {
      const name = e.senderDisplayName || e.senderEmail || "unknown";
      senderCounts.set(name, (senderCounts.get(name) || 0) + 1);
    }
    const topSender = [...senderCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const senderPurity = topSender[1] / groupEmails.length;
    console.error(`  Sender: "${topSender[0].slice(0, 50)}" (${(senderPurity * 100).toFixed(0)}% purity) ${senderCounts.size > 1 ? `+ ${senderCounts.size - 1} others` : ""}`);

    // Tag analysis
    const tagCounts = new Map<string, number>();
    for (const e of groupEmails) {
      for (const t of (Array.isArray(e.tags) ? e.tags : [])) {
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    // Tag overlap = fraction of emails sharing the top tag
    const tagOverlap = topTags.length > 0 ? topTags[0][1] / groupEmails.length : 0;
    console.error(`  Tags: ${topTags.map(([t, c]) => `"${t}"(${c}/${groupEmails.length})`).join(", ") || "none"}`);
    console.error(`  Tag overlap: ${(tagOverlap * 100).toFixed(0)}% share top tag "${topTags[0]?.[0] ?? "none"}"`);

    // Subject keyword analysis
    const wordCounts = new Map<string, number>();
    const stopwords = new Set(["the", "for", "from", "with", "this", "that", "your", "have", "been", "will", "event", "reminder", "updated", "canceled", "new"]);
    for (const e of groupEmails) {
      const words = e.subject.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w: string) => w.length > 2 && !stopwords.has(w));
      for (const w of words) {
        wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
      }
    }
    const topWords = [...wordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([, c]) => c >= groupEmails.length * 0.4) // Only words appearing in 40%+ of group
      .slice(0, 6);
    console.error(`  Subject keywords (≥40%): ${topWords.map(([w, c]) => `"${w}"(${c}/${groupEmails.length})`).join(", ") || "none distinctive"}`);

    // What signal could the gravity model use?
    const signals: string[] = [];
    if (threadRatio < 0.5) signals.push("threadId (heavily threaded)");
    if (entityPurity >= 0.9) signals.push(`entity=${topEntity[0]}`);
    if (domainPurity >= 0.9) signals.push(`senderDomain=${topDomain[0]}`);
    if (senderPurity >= 0.8) signals.push(`sender="${topSender[0].slice(0, 30)}"`);
    if (tagOverlap >= 0.7) signals.push(`tag="${topTags[0]?.[0]}"`);
    if (topWords.length >= 2) signals.push(`subjectKeywords=[${topWords.map(([w]) => w).join(",")}]`);

    const missing: string[] = [];
    if (threadRatio > 0.8) missing.push("NO thread overlap");
    if (entityPurity < 0.5) missing.push("mixed entities");
    if (topWords.length === 0) missing.push("no distinctive subject words");

    console.error(`  AVAILABLE SIGNALS: ${signals.join(" + ") || "NONE — content-only grouping"}`);
    if (missing.length) console.error(`  MISSING SIGNALS: ${missing.join(", ")}`);

    allGroupFeatures.push({
      title: g.caseTitle,
      emailCount: groupEmails.length,
      uniqueThreads: threadIds.size,
      dominantEntity: topEntity[0],
      entityPurity,
      dominantDomain: topDomain[0],
      domainPurity,
      dominantSender: topSender[0],
      senderPurity,
      topTags: topTags.map(([t]) => t),
      tagOverlap,
      subjectKeywords: topWords.map(([w]) => w),
    });
  }

  // Summary: what features distinguish between groups?
  console.error(`\n--- DISCRIMINATING FEATURES SUMMARY ---`);

  // Can entity alone separate groups?
  const entitiesUsed = new Set(allGroupFeatures.map((g) => g.dominantEntity));
  const groupsPerEntity = new Map<string, string[]>();
  for (const g of allGroupFeatures) {
    if (!groupsPerEntity.has(g.dominantEntity)) groupsPerEntity.set(g.dominantEntity, []);
    groupsPerEntity.get(g.dominantEntity)!.push(g.title);
  }
  const multiGroupEntities = [...groupsPerEntity.entries()].filter(([, gs]) => gs.length > 1);

  console.error(`  Unique entities: ${entitiesUsed.size}`);
  if (multiGroupEntities.length > 0) {
    console.error(`  Entities with MULTIPLE groups (need sub-entity splitting):`);
    for (const [entity, groups] of multiGroupEntities) {
      console.error(`    "${entity}" → ${groups.map((g) => `"${g}"`).join(", ")}`);
    }
  }

  // What additional signal separates sub-entity groups?
  for (const [entity, groupTitles] of multiGroupEntities) {
    console.error(`\n  Sub-entity discrimination for "${entity}":`);
    const entityGroups = allGroupFeatures.filter((g) => g.dominantEntity === entity);
    for (const g of entityGroups) {
      console.error(`    "${g.title}": tags=[${g.topTags.slice(0, 3).join(",")}] keywords=[${g.subjectKeywords.join(",")}] domain=${g.dominantDomain}(${(g.domainPurity * 100).toFixed(0)}%)`);
    }

    // Check if tags alone can separate
    const tagSets = entityGroups.map((g) => new Set(g.topTags));
    let tagsDiscriminate = true;
    for (let i = 0; i < tagSets.length; i++) {
      for (let j = i + 1; j < tagSets.length; j++) {
        const overlap = [...tagSets[i]].filter((t) => tagSets[j].has(t));
        if (overlap.length === Math.min(tagSets[i].size, tagSets[j].size)) {
          tagsDiscriminate = false;
        }
      }
    }
    console.error(`    Tags discriminate: ${tagsDiscriminate ? "YES" : "NO (overlapping tags)"}`);

    // Check if subject keywords can separate
    const kwSets = entityGroups.map((g) => new Set(g.subjectKeywords));
    let kwDiscriminate = true;
    for (let i = 0; i < kwSets.length; i++) {
      for (let j = i + 1; j < kwSets.length; j++) {
        const overlap = [...kwSets[i]].filter((t) => kwSets[j].has(t));
        if (kwSets[i].size === 0 || kwSets[j].size === 0) kwDiscriminate = false;
        else if (overlap.length === Math.min(kwSets[i].size, kwSets[j].size)) kwDiscriminate = false;
      }
    }
    console.error(`    Subject keywords discriminate: ${kwDiscriminate ? "YES" : "NO"}`);
  }

  // Proposed scoring additions
  console.error(`\n--- PROPOSED GRAVITY MODEL ADDITIONS ---`);
  console.error(`Based on the AI grouping patterns, these signals would close the gap:`);

  const needsTagScore = allGroupFeatures.some((g) => g.tagOverlap >= 0.7 && g.uniqueThreads / g.emailCount > 0.5);
  const needsDomainScore = allGroupFeatures.some((g) => g.domainPurity >= 0.9 && g.uniqueThreads / g.emailCount > 0.5);
  const needsKeywordScore = multiGroupEntities.length > 0;

  if (needsTagScore) {
    console.error(`  1. TAG MATCH SCORE: Emails sharing extracted tags (e.g., "Practice", "Game/Match")`);
    console.error(`     Reason: Non-threaded emails in the same group share tags at 70%+ rate`);
  }
  if (needsDomainScore) {
    console.error(`  2. SENDER DOMAIN SCORE: Emails from the same platform domain (e.g., email.teamsnap.com)`);
    console.error(`     Reason: 90%+ of non-threaded group emails share a sender domain`);
  }
  if (needsKeywordScore) {
    console.error(`  3. SUBJECT KEYWORD SCORE: Match on extracted keywords like "practice", "game", "league"`);
    console.error(`     Reason: Same-entity groups are separated by subject keyword clusters`);
  }
}

async function main() {
  prisma = await createPrisma();

  const schemaIdArg = process.argv[2];

  if (schemaIdArg) {
    await analyzeSchema(schemaIdArg);
  } else {
    // Find all schemas with experiments
    const experiments = await prisma.pipelineIntelligence.findMany({
      where: { stage: "clustering-intelligence-experiment" },
      select: { schemaId: true },
      distinct: ["schemaId"],
    });
    for (const exp of experiments) {
      await analyzeSchema(exp.schemaId);
    }
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma?.$disconnect());
