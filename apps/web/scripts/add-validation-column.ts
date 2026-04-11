/**
 * One-off migration: add `validation JSONB` column to case_schemas.
 *
 * Part of #56 fix -- the runOnboarding workflow now stores the result of
 * `sampleScan(200) + validateHypothesis` on the schema row so discovered
 * entities can be persisted by persistSchemaRelations during
 * FINALIZING_SCHEMA. Idempotent -- safe to re-run.
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const existing: Array<{ column_name: string }> = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'case_schemas'
      AND column_name = 'validation'
  `;

  if (existing.length > 0) {
    console.error("[add-validation-column] Column already exists, skipping.");
    return;
  }

  await prisma.$executeRawUnsafe("ALTER TABLE case_schemas ADD COLUMN validation JSONB");
  console.error("[add-validation-column] Added validation JSONB column to case_schemas.");
}

main()
  .catch((e: unknown) => {
    console.error("[add-validation-column] FAILED:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
