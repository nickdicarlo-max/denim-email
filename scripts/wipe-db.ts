/**
 * Wipe all data from Supabase database in FK-safe order.
 * Run: npx tsx scripts/wipe-db.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl:
    "postgresql://postgres:j4vcoiu2yfjhbdfv78ywekhjbadvhjae@db.xnewghhpuerhaottgalc.supabase.co:5432/postgres",
});

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
