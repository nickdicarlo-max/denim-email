/**
 * Eval Wipe — full destructive reset for the formal eval session.
 *
 * Run from apps/web/:
 *   npx tsx scripts/eval-wipe.ts --confirm
 *
 * Wipes EVERY row in EVERY user-data table, including User. After this runs,
 * the next sign-in goes through Google OAuth as a brand-new account and walks
 * the full onboarding flow from zero. This is the entry point for the eval
 * session captured in nickdicarlo-max/denim-email#12.
 *
 * Safety guards:
 *   1. Requires the literal --confirm flag. No prompt fallback.
 *   2. Refuses to run unless eval-snapshot.ts has produced a snapshot file
 *      dated today in docs/test-results/. Snapshot first, always.
 *   3. Prints row counts before and after, so the wipe is observable.
 *
 * Schema/migration tables are NOT touched. RLS policies are NOT touched.
 * Auth tables in Supabase's `auth` schema are NOT touched (Prisma can't see
 * them) -- you may need to delete the Supabase Auth user separately via the
 * Supabase dashboard or service-role API for a truly clean OAuth re-run.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

// Load env from the apps/web directory. Script MUST be run from apps/web:
//   cd apps/web && npx tsx scripts/eval-wipe.ts --confirm
loadEnv({ path: resolve(process.cwd(), ".env.local") });

if (!process.env.DATABASE_URL) {
  console.error("FAILED: DATABASE_URL not set.");
  console.error("  Run from apps/web/ so .env.local is picked up:");
  console.error("    cd apps/web && npx tsx scripts/eval-wipe.ts --confirm");
  process.exit(4);
}

if (!process.argv.includes("--confirm")) {
  console.error("REFUSED: pass --confirm to actually wipe.");
  console.error("  cd apps/web && npx tsx scripts/eval-wipe.ts --confirm");
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
// cwd is apps/web; repo root is two levels up.
const snapshotPath = resolve(
  process.cwd(),
  "../../docs/test-results",
  `pre-eval-snapshot-${today}.json`,
);
if (!existsSync(snapshotPath)) {
  console.error("REFUSED: no snapshot found for today.");
  console.error(`  Expected: ${snapshotPath}`);
  console.error("  Run eval-snapshot.ts first.");
  process.exit(3);
}
console.error(`OK -- snapshot found: ${snapshotPath}\n`);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// FK-safe deletion order: leaves first, roots last.
const TABLES: [string, () => Promise<{ count: number }>][] = [
  ["CaseAction", () => prisma.caseAction.deleteMany()],
  ["CaseEmail", () => prisma.caseEmail.deleteMany()],
  ["Cluster", () => prisma.cluster.deleteMany()],
  ["Case", () => prisma.case.deleteMany()],
  ["ExtractionCost", () => prisma.extractionCost.deleteMany()],
  ["EmailAttachment", () => prisma.emailAttachment.deleteMany()],
  ["Email", () => prisma.email.deleteMany()],
  ["FeedbackEvent", () => prisma.feedbackEvent.deleteMany()],
  ["QualitySnapshot", () => prisma.qualitySnapshot.deleteMany()],
  ["ScanJob", () => prisma.scanJob.deleteMany()],
  ["ExclusionRule", () => prisma.exclusionRule.deleteMany()],
  ["ExtractedFieldDef", () => prisma.extractedFieldDef.deleteMany()],
  ["SchemaTag", () => prisma.schemaTag.deleteMany()],
  ["Entity", () => prisma.entity.deleteMany()],
  ["EntityGroup", () => prisma.entityGroup.deleteMany()],
  ["CaseSchema", () => prisma.caseSchema.deleteMany()],
  ["User", () => prisma.user.deleteMany()],
];

async function wipe() {
  console.error("Wiping ALL user-data tables (including User) in FK-safe order...\n");
  let total = 0;
  for (const [name, fn] of TABLES) {
    try {
      const r = await fn();
      total += r.count;
      console.error(`  ${name.padEnd(20)} ${r.count} deleted`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ${name.padEnd(20)} ERROR ${msg.slice(0, 80)}`);
      throw e;
    }
  }
  console.error(`\nDone. ${total} total rows deleted across ${TABLES.length} tables.`);
  console.error("\nNOTE: Supabase Auth users live in the `auth` schema and are NOT");
  console.error("touched by this script. To force a brand-new OAuth flow with no");
  console.error("session memory, also delete the user in the Supabase Auth dashboard");
  console.error("(Authentication -> Users -> ... -> Delete user) or sign out and");
  console.error("clear browser cookies for localhost.");

  await prisma.$disconnect();
}

wipe().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
