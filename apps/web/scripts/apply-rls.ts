/**
 * Apply Row Level Security (RLS) to all tables.
 * Run: npx tsx scripts/apply-rls.ts
 *
 * Per CLAUDE.md security requirements:
 * - RLS enabled on ALL tables
 * - Every query scoped by userId (via schema -> user chain)
 * - Service role key bypasses RLS (server-side only)
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({
  // biome-ignore lint/style/noNonNullAssertion: dev script; env validated by tsx dotenv/config at import time
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function applyRLS() {
  console.log("Applying Row Level Security policies...\n");

  // All table names from schema.prisma @@map directives
  const allTables = [
    "users",
    "case_schemas",
    "schema_tags",
    "extracted_field_defs",
    "entities",
    "emails",
    "email_attachments",
    "cases",
    "case_emails",
    "case_actions",
    "clusters",
    "feedback_events",
    "quality_snapshots",
    "exclusion_rules",
    "scan_jobs",
    "extraction_costs",
  ];

  // Step 1: Enable RLS on all tables
  for (const table of allTables) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    console.log(`  ✓ RLS enabled on ${table}`);
  }

  console.log("\nCreating policies...\n");

  // Step 2: Drop existing policies (idempotent)
  for (const table of allTables) {
    await prisma.$executeRawUnsafe(
      `DROP POLICY IF EXISTS "Users can access own data" ON "${table}";`,
    );
  }

  // Step 3: Create policies

  // --- users: direct auth.uid() match ---
  await prisma.$executeRawUnsafe(`
    CREATE POLICY "Users can access own data" ON "users"
    FOR ALL USING (id = auth.uid()::text);
  `);
  console.log("  ✓ users: id = auth.uid()");

  // --- case_schemas: direct user_id match ---
  await prisma.$executeRawUnsafe(`
    CREATE POLICY "Users can access own data" ON "case_schemas"
    FOR ALL USING ("userId" = auth.uid()::text);
  `);
  console.log("  ✓ case_schemas: userId = auth.uid()");

  // --- scan_jobs: direct user_id match ---
  await prisma.$executeRawUnsafe(`
    CREATE POLICY "Users can access own data" ON "scan_jobs"
    FOR ALL USING ("userId" = auth.uid()::text);
  `);
  console.log("  ✓ scan_jobs: userId = auth.uid()");

  // --- Tables scoped through schemaId ---
  const schemaIdTables = [
    "schema_tags",
    "extracted_field_defs",
    "entities",
    "emails",
    "cases",
    "case_actions",
    "clusters",
    "feedback_events",
    "quality_snapshots",
    "exclusion_rules",
  ];

  for (const table of schemaIdTables) {
    await prisma.$executeRawUnsafe(`
      CREATE POLICY "Users can access own data" ON "${table}"
      FOR ALL USING (
        "schemaId" IN (
          SELECT id FROM "case_schemas" WHERE "userId" = auth.uid()::text
        )
      );
    `);
    console.log(`  ✓ ${table}: schemaId -> case_schemas.userId = auth.uid()`);
  }

  // --- email_attachments: scoped through emailId -> emails -> schemaId ---
  await prisma.$executeRawUnsafe(`
    CREATE POLICY "Users can access own data" ON "email_attachments"
    FOR ALL USING (
      "emailId" IN (
        SELECT id FROM "emails" WHERE "schemaId" IN (
          SELECT id FROM "case_schemas" WHERE "userId" = auth.uid()::text
        )
      )
    );
  `);
  console.log("  ✓ email_attachments: emailId -> emails -> case_schemas.userId = auth.uid()");

  // --- case_emails: scoped through caseId -> cases -> schemaId ---
  await prisma.$executeRawUnsafe(`
    CREATE POLICY "Users can access own data" ON "case_emails"
    FOR ALL USING (
      "caseId" IN (
        SELECT id FROM "cases" WHERE "schemaId" IN (
          SELECT id FROM "case_schemas" WHERE "userId" = auth.uid()::text
        )
      )
    );
  `);
  console.log("  ✓ case_emails: caseId -> cases -> case_schemas.userId = auth.uid()");

  // --- extraction_costs: scoped through emailId -> emails -> schemaId ---
  await prisma.$executeRawUnsafe(`
    CREATE POLICY "Users can access own data" ON "extraction_costs"
    FOR ALL USING (
      "emailId" IN (
        SELECT id FROM "emails" WHERE "schemaId" IN (
          SELECT id FROM "case_schemas" WHERE "userId" = auth.uid()::text
        )
      )
    );
  `);
  console.log("  ✓ extraction_costs: emailId -> emails -> case_schemas.userId = auth.uid()");

  console.log("\n✓ All RLS policies applied successfully.");
  console.log("\nNote: Service role key (used by server-side services) bypasses RLS.");
  console.log("Supabase anon key (used by client) is subject to these policies.");
}

applyRLS()
  .catch((e) => {
    console.error("\n✗ Failed to apply RLS:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
