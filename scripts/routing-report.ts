/**
 * Routing diagnostic report — run after a scan to see how emails were routed.
 * Run: npx tsx scripts/routing-report.ts [schemaId]
 *
 * If no schemaId given, reports on the most recent schema.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl:
    "postgresql://postgres:j4vcoiu2yfjhbdfv78ywekhjbadvhjae@db.xnewghhpuerhaottgalc.supabase.co:5432/postgres",
});

interface RoutingDecision {
  method: string | null;
  detail: string | null;
  relevanceScore: number;
  relevanceEntity: string | null;
  detectedEntities: string[];
  senderMatch: string | null;
}

async function report() {
  let schemaId = process.argv[2];

  if (!schemaId) {
    const latest = await prisma.caseSchema.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    });
    if (!latest) {
      console.log("No schemas found.");
      return;
    }
    schemaId = latest.id;
    console.log(`Using latest schema: "${latest.name}" (${schemaId})\n`);
  }

  // Load all non-excluded emails for this schema
  const emails = await prisma.email.findMany({
    where: { schemaId, isExcluded: false },
    select: {
      id: true,
      subject: true,
      senderDisplayName: true,
      entityId: true,
      entity: { select: { name: true, type: true } },
      routingDecision: true,
    },
    orderBy: { date: "desc" },
  });

  // Load excluded emails too for the full picture
  const excluded = await prisma.email.count({
    where: { schemaId, isExcluded: true },
  });

  console.log(`Total emails: ${emails.length} routed, ${excluded} excluded\n`);

  // Group by routing method
  const byMethod: Record<string, typeof emails> = {
    sender: [],
    relevance: [],
    detected: [],
    unrouted: [],
    "no-data": [], // emails extracted before routing tracking was added
  };

  for (const email of emails) {
    const rd = email.routingDecision as RoutingDecision | null;
    if (!rd) {
      byMethod["no-data"].push(email);
    } else if (!rd.method) {
      byMethod.unrouted.push(email);
    } else {
      (byMethod[rd.method] ??= []).push(email);
    }
  }

  // Summary table
  console.log("=== ROUTING METHOD BREAKDOWN ===\n");
  for (const [method, group] of Object.entries(byMethod)) {
    if (group.length === 0) continue;
    console.log(`  ${method}: ${group.length} emails`);
  }

  // Detail for each method
  console.log("\n=== DETAIL BY METHOD ===\n");

  for (const [method, group] of Object.entries(byMethod)) {
    if (group.length === 0) continue;

    console.log(`--- ${method.toUpperCase()} (${group.length}) ---`);
    for (const email of group) {
      const rd = email.routingDecision as RoutingDecision | null;
      const entity = email.entity?.name ?? "(null)";
      const subject = email.subject.length > 60
        ? `${email.subject.slice(0, 57)}...`
        : email.subject;
      console.log(`  → [${entity}] "${subject}"`);
      if (rd?.detail) {
        console.log(`    ${rd.detail}`);
      }
    }
    console.log();
  }

  // Entity distribution
  console.log("=== ENTITY DISTRIBUTION ===\n");
  const byEntity: Record<string, number> = {};
  for (const email of emails) {
    const name = email.entity?.name ?? "(unrouted)";
    byEntity[name] = (byEntity[name] ?? 0) + 1;
  }
  const sorted = Object.entries(byEntity).sort(([, a], [, b]) => b - a);
  for (const [name, count] of sorted) {
    console.log(`  ${name}: ${count}`);
  }

  await prisma.$disconnect();
}

report().catch((err) => {
  console.error("Report failed:", err);
  process.exit(1);
});
