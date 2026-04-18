/**
 * Wipe all data from Supabase database in FK-safe order.
 *
 * Run: pnpm --filter web exec tsx ../../scripts/wipe-db.ts
 * (runs from apps/web/ so the Prisma client is resolvable)
 *
 * Requires DATABASE_URL (or DIRECT_URL) in the environment. Refuses to
 * run without one -- no hardcoded fallback, ever. If you need to wipe
 * locally, load apps/web/.env.local first (dotenv-cli or explicit export).
 */
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!connectionString) {
  console.error(
    "wipe-db: DATABASE_URL (or DIRECT_URL) env var is required. " +
      "Load apps/web/.env.local before running, e.g.\n" +
      "  cd apps/web && npx dotenv-cli -e .env.local -- npx tsx ../../scripts/wipe-db.ts",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: connectionString });

async function wipe() {
  console.log("Wiping all data in FK-safe order...\n");

  // Delete in FK-safe order (children first)
  const tables = [
    { name: "CaseAction", fn: () => prisma.caseAction.deleteMany() },
    { name: "CaseEmail", fn: () => prisma.caseEmail.deleteMany() },
    { name: "Cluster", fn: () => prisma.cluster.deleteMany() },
    { name: "Case", fn: () => prisma.case.deleteMany() },
    { name: "ExtractionCost", fn: () => prisma.extractionCost.deleteMany() },
    { name: "EmailAttachment", fn: () => prisma.emailAttachment.deleteMany() },
    { name: "Email", fn: () => prisma.email.deleteMany() },
    { name: "FeedbackEvent", fn: () => prisma.feedbackEvent.deleteMany() },
    { name: "QualitySnapshot", fn: () => prisma.qualitySnapshot.deleteMany() },
    { name: "ScanJob", fn: () => prisma.scanJob.deleteMany() },
    { name: "ExclusionRule", fn: () => prisma.exclusionRule.deleteMany() },
    { name: "ExtractedFieldDef", fn: () => prisma.extractedFieldDef.deleteMany() },
    { name: "SchemaTag", fn: () => prisma.schemaTag.deleteMany() },
    { name: "Entity", fn: () => prisma.entity.deleteMany() },
    { name: "EntityGroup", fn: () => prisma.entityGroup.deleteMany() },
    { name: "CaseSchema", fn: () => prisma.caseSchema.deleteMany() },
    { name: "User", fn: () => prisma.user.deleteMany() },
  ];

  for (const { name, fn } of tables) {
    const result = await fn();
    console.log(`  ${name}: ${result.count} rows deleted`);
  }

  console.log("\nDone. All tables empty.");
  await prisma.$disconnect();
}

wipe().catch((err) => {
  console.error("Wipe failed:", err);
  process.exit(1);
});
