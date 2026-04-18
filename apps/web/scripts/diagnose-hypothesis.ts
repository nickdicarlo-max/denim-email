/**
 * Diagnose Hypothesis — dumps all data collected during the hypothesis +
 * validation stage (Function A of onboarding) for manual inspection.
 *
 * Run after the review screen appears (phase=AWAITING_REVIEW).
 *
 * Usage from apps/web/:
 *   npx tsx scripts/diagnose-hypothesis.ts
 *   npx tsx scripts/diagnose-hypothesis.ts <schemaId>   # specific schema
 */

import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), ".env.local") });

if (!process.env.DATABASE_URL) {
  console.error("FAILED: DATABASE_URL not set. Run from apps/web/.");
  process.exit(4);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function divider(title: string) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(72)}\n`);
}

function subheader(title: string) {
  console.log(`\n--- ${title} ${"─".repeat(Math.max(0, 60 - title.length))}\n`);
}

function jsonBlock(label: string, data: unknown) {
  console.log(`${label}:`);
  console.log(JSON.stringify(data, null, 2));
}

function elapsed(start: Date, end: Date | null): string {
  if (!end) return "(still running)";
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const targetSchemaId = process.argv[2];

  // Find the schema(s) to inspect
  const schemas = targetSchemaId
    ? await prisma.caseSchema.findMany({ where: { id: targetSchemaId } })
    : await prisma.caseSchema.findMany({
        orderBy: { createdAt: "desc" },
        take: 1,
      });

  if (schemas.length === 0) {
    console.error(
      targetSchemaId ? `No schema found with id: ${targetSchemaId}` : "No schemas in database.",
    );
    process.exit(1);
  }

  for (const schema of schemas) {
    await diagnoseSchema(schema);
  }

  await prisma.$disconnect();
}

async function diagnoseSchema(schema: any) {
  divider(`SCHEMA: ${schema.name ?? "(unnamed)"}`);

  // =========================================================================
  // 1. Schema Identity & State
  // =========================================================================
  subheader("1. Schema Identity & Workflow State");

  console.log(`  id:              ${schema.id}`);
  console.log(`  name:            ${schema.name}`);
  console.log(`  domain:          ${schema.domain}`);
  console.log(`  status:          ${schema.status}`);
  console.log(`  phase:           ${schema.phase ?? "(null — post-onboarding)"}`);
  console.log(`  phaseError:      ${schema.phaseError ?? "(none)"}`);
  console.log(`  createdAt:       ${schema.createdAt.toISOString()}`);
  console.log(`  phaseUpdatedAt:  ${schema.phaseUpdatedAt?.toISOString() ?? "(null)"}`);

  if (schema.createdAt && schema.phaseUpdatedAt) {
    console.log(`  total elapsed:   ${elapsed(schema.createdAt, schema.phaseUpdatedAt)}`);
  }

  // =========================================================================
  // 2. User Inputs (what the user typed on the interview screens)
  // =========================================================================
  subheader("2. User Inputs (from onboarding screens)");

  if (schema.inputs) {
    const inputs = schema.inputs as any;
    console.log(`  role:            ${inputs.role ?? "(not set)"}`);
    console.log(`  domain:          ${inputs.domain ?? "(not set)"}`);
    console.log(`  whats:           ${JSON.stringify(inputs.whats ?? [])}`);
    console.log(`  whos:            ${JSON.stringify(inputs.whos ?? [])}`);
    console.log(`  goals:           ${JSON.stringify(inputs.goals ?? [])}`);
    console.log(`  customDescription: ${inputs.customDescription ?? "(none)"}`);

    if (inputs.groups?.length) {
      console.log(`  groups (${inputs.groups.length}):`);
      for (const g of inputs.groups) {
        console.log(
          `    - whats: ${JSON.stringify(g.whats)} | whos: ${JSON.stringify(g.whos ?? [])}`,
        );
      }
    } else {
      console.log(`  groups:          (none — flat input)`);
    }
  } else {
    console.log("  (no inputs stored — schema may predate onboarding refactor)");
  }

  // =========================================================================
  // 3. Hypothesis (Claude's generated schema config)
  // =========================================================================
  subheader("3. Hypothesis (Claude output)");

  if (schema.hypothesis) {
    const h = schema.hypothesis as any;
    console.log(`  schemaName:      ${h.schemaName ?? h.name ?? "(none)"}`);
    console.log(`  domain:          ${h.domain}`);
    console.log(`  primaryEntity:   ${JSON.stringify(h.primaryEntity)}`);
    console.log(
      `  secondaryTypes:  ${JSON.stringify(h.secondaryEntityTypes ?? h.secondaryEntities)}`,
    );
    console.log(`  summaryLabels:   ${JSON.stringify(h.summaryLabels)}`);

    subheader("3a. Hypothesis Entities");
    if (h.entities?.length) {
      for (const e of h.entities) {
        console.log(
          `    [${e.type?.padEnd(9) ?? "?"}] ${(e.name ?? e.name ?? "?").padEnd(25)} aliases=${JSON.stringify(e.aliases ?? [])} confidence=${e.confidence ?? "?"} autoDetected=${e.autoDetected ?? false}`,
        );
      }
    } else {
      console.log("    (no entities in hypothesis)");
    }

    subheader("3b. Hypothesis Tags");
    if (h.tags?.length) {
      for (const t of h.tags) {
        console.log(`    ${(t.name ?? t).toString().padEnd(25)} weak=${t.isWeak ?? false}`);
      }
    } else {
      console.log("    (no tags)");
    }

    subheader("3c. Discovery Queries (from hypothesis)");
    if (h.discoveryQueries?.length) {
      for (const q of h.discoveryQueries) {
        console.log(`    [${q.groupIndex ?? "?"}] ${q.label?.padEnd(30) ?? ""} | ${q.query}`);
      }
    } else {
      console.log("    (no discovery queries in hypothesis)");
    }

    subheader("3d. Clustering Config");
    if (h.clusteringConfig) {
      jsonBlock("    config", h.clusteringConfig);
    } else {
      console.log("    (no clustering config)");
    }
  } else {
    console.log("  (no hypothesis stored — generation may not have completed)");
  }

  // =========================================================================
  // 4. Validation (Claude's pass over real Gmail samples)
  // =========================================================================
  subheader("4. Validation Result (Gmail sample scan)");

  if (schema.validation) {
    const v = schema.validation as any;
    console.log(`  confidenceScore:   ${v.confidenceScore}`);
    console.log(`  sampleEmailCount:  ${v.sampleEmailCount}`);
    console.log(`  scanDurationMs:    ${v.scanDurationMs}`);

    subheader("4a. Confirmed Entities (string list — type/metadata comes from hypothesis)");
    if (v.confirmedEntities?.length) {
      for (const e of v.confirmedEntities) {
        console.log(`    ${(e.name ?? e).toString().padEnd(30)} type=${e.type ?? "?"}`);
      }
    } else {
      console.log("    (none)");
    }

    subheader("4b. Discovered Entities");
    if (v.discoveredEntities?.length) {
      for (const e of v.discoveredEntities) {
        console.log(
          `    ${(e.name ?? e.name ?? e).toString().padEnd(30)} type=${e.type ?? "?"} emailCount=${e.emailCount ?? "?"} confidence=${e.confidence ?? "?"}`,
        );
      }
    } else {
      console.log("    (none discovered)");
    }

    subheader("4c. Confirmed Tags (from hypothesis that appeared in real emails)");
    if (v.confirmedTags?.length) {
      for (const t of v.confirmedTags) {
        console.log(`    ${t}`);
      }
    } else {
      console.log("    (none — no hypothesis tags matched the sample)");
    }

    subheader("4d. Suggested Tags (new patterns Claude found — may include off-topic inbox noise)");
    if (v.suggestedTags?.length) {
      for (const t of v.suggestedTags) {
        console.log(`    ${(t.name ?? t).toString()}`);
      }
    } else {
      console.log("    (none)");
    }

    subheader("4e. Noise Patterns");
    if (v.noisePatterns?.length) {
      for (const p of v.noisePatterns) {
        console.log(`    ${typeof p === "string" ? p : JSON.stringify(p)}`);
      }
    } else {
      console.log("    (none)");
    }
  } else {
    console.log("  (no validation stored — validation may not have run yet)");
  }

  // =========================================================================
  // 5. Persisted Discovery Queries (written to schema after finalize)
  // =========================================================================
  subheader("5. Persisted Discovery Queries (schema.discoveryQueries)");

  const dqRaw = schema.discoveryQueries;
  const dqArr = Array.isArray(dqRaw) ? (dqRaw as any[]) : [];
  if (dqArr.length > 0) {
    console.log(`  Total queries: ${dqArr.length}\n`);
    for (const q of dqArr) {
      console.log(`    [group=${q.groupIndex ?? "?"}] ${(q.label ?? "").padEnd(35)} | ${q.query}`);
    }
  } else {
    console.log("  Total queries: 0");
    console.log("  (This is CORRECT at AWAITING_REVIEW. The stub was created with an");
    console.log("   empty discoveryQueries array; persistSchemaRelations writes the real");
    console.log("   list at confirm time. The queries exist in the hypothesis JSON —");
    console.log("   see section 3c.)");
  }

  // =========================================================================
  // 6. Persisted Entities (DB rows created by persistSchemaRelations)
  // =========================================================================
  subheader("6. Persisted Entity Rows");

  const entities = await prisma.entity.findMany({
    where: { schemaId: schema.id },
    include: { group: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  if (entities.length > 0) {
    console.log(`  Total: ${entities.length}\n`);
    for (const e of entities) {
      console.log(
        `    [${e.type.padEnd(9)}] ${e.name.padEnd(25)} groupId=${e.groupId ?? "(none)"} aliases=${JSON.stringify(e.aliases)} confidence=${e.confidence} autoDetected=${e.autoDetected} associatedPrimaryIds=${JSON.stringify(e.associatedPrimaryIds)}`,
      );
    }
  } else {
    console.log("  (no entities persisted yet — expected before confirm)");
  }

  // =========================================================================
  // 7. Entity Groups
  // =========================================================================
  subheader("7. Entity Groups");

  const groups = await prisma.entityGroup.findMany({
    where: { schemaId: schema.id },
    include: { entities: { select: { name: true, type: true } } },
    orderBy: { index: "asc" },
  });

  if (groups.length > 0) {
    for (const g of groups) {
      const members = g.entities.map((e: any) => `${e.name} (${e.type})`).join(", ");
      console.log(`    Group ${g.index}: ${members}`);
    }
  } else {
    console.log("  (no groups created yet)");
  }

  // =========================================================================
  // 8. Schema Tags
  // =========================================================================
  subheader("8. Schema Tags");

  const tags = await prisma.schemaTag.findMany({
    where: { schemaId: schema.id },
    orderBy: { name: "asc" },
  });

  if (tags.length > 0) {
    for (const t of tags) {
      console.log(`    ${t.name.padEnd(25)} weak=${t.isWeak} frequency=${t.frequency}`);
    }
  } else {
    console.log("  (no tags persisted yet)");
  }

  // =========================================================================
  // 9. Onboarding Outbox
  // =========================================================================
  subheader("9. Onboarding Outbox");

  const outbox = await prisma.onboardingOutbox.findMany({
    where: { schemaId: schema.id },
  });

  if (outbox.length > 0) {
    for (const o of outbox) {
      console.log(`    schemaId:  ${o.schemaId}`);
      console.log(`    status:    ${o.status}`);
      console.log(`    attempts:  ${o.attempts}`);
      console.log(`    createdAt: ${o.createdAt.toISOString()}`);
      console.log(`    lastAttemptAt: ${o.lastAttemptAt?.toISOString() ?? "(never)"}`);
      console.log(`    emittedAt:     ${o.emittedAt?.toISOString() ?? "(not emitted)"}`);
    }
  } else {
    console.log("  (no outbox row — schema may predate outbox pattern)");
  }

  // =========================================================================
  // 10. AI Cost for this schema
  // =========================================================================
  subheader("10. AI Cost (ExtractionCost rows for this schema)");

  const scanJobIds = (
    await prisma.scanJob.findMany({
      where: { schemaId: schema.id },
      select: { id: true },
    })
  ).map((j) => j.id);

  const costs = await prisma.extractionCost.findMany({
    where: { scanJobId: { in: scanJobIds } },
    orderBy: { createdAt: "asc" },
  });

  if (costs.length > 0) {
    let totalCost = 0;
    for (const c of costs) {
      const cost = Number(c.estimatedCostUsd ?? 0);
      totalCost += cost;
      console.log(
        `    ${c.model?.padEnd(25) ?? "?"} ${(c.operation ?? "?").padEnd(20)} in=${c.inputTokens} out=${c.outputTokens} $${cost.toFixed(4)} ${c.createdAt.toISOString().slice(11, 19)}`,
      );
    }
    console.log(`\n    TOTAL: $${totalCost.toFixed(4)}`);
  } else {
    console.log("  (no cost rows yet — expected before pipeline runs)");
  }

  // =========================================================================
  // 11. ScanJob (should NOT exist at AWAITING_REVIEW)
  // =========================================================================
  subheader("11. Scan Jobs (should be empty at AWAITING_REVIEW)");

  const scanJobs = await prisma.scanJob.findMany({
    where: { schemaId: schema.id },
    orderBy: { createdAt: "asc" },
  });

  if (scanJobs.length > 0) {
    console.log(`  WARNING: ${scanJobs.length} scan job(s) exist already!`);
    for (const j of scanJobs) {
      console.log(
        `    id=${j.id} status=${j.status} phase=${j.phase} trigger=${j.triggeredBy} total=${j.totalEmails} created=${j.createdAt.toISOString()}`,
      );
    }
  } else {
    console.log("  (none — correct for AWAITING_REVIEW phase)");
  }

  // =========================================================================
  // 12. Raw Hypothesis JSON (full dump for debugging)
  // =========================================================================
  subheader("12. Raw Hypothesis JSON (full)");

  if (schema.rawHypothesis) {
    console.log(JSON.stringify(schema.rawHypothesis, null, 2));
  } else if (schema.hypothesis) {
    console.log("  (rawHypothesis not stored separately; hypothesis shown in section 3)");
  } else {
    console.log("  (none)");
  }

  // =========================================================================
  // 13. Timing Summary
  // =========================================================================
  subheader("13. Timing Summary");

  const created = schema.createdAt;
  const phaseUpdated = schema.phaseUpdatedAt;

  console.log(`  Schema created:       ${created.toISOString()}`);
  if (phaseUpdated) {
    console.log(`  Phase last updated:   ${phaseUpdated.toISOString()}`);
    console.log(`  Total time to ${schema.phase ?? "current"}: ${elapsed(created, phaseUpdated)}`);
  }

  // Note: hypothesis + validation calls don't write ExtractionCost rows.
  // Per-step timing is available in:
  //   - Server console logs (withLogging wrapper)
  //   - Inngest dashboard (step-level timing for generate-hypothesis, validate-hypothesis)
  console.log(`\n  NOTE: For per-step timing (hypothesis gen, validation passes),`);
  console.log(`        check the Inngest dashboard or server console output.`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
