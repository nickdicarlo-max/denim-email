/**
 * Phase 1 Evaluation Script
 *
 * Tests hypothesis generation across 5 domains.
 * Calls Claude directly (bypasses service layer path aliases).
 * Outputs results to docs/test-results/phase1-schema-quality.md
 *
 * Usage: ANTHROPIC_API_KEY=sk-... npx tsx scripts/test-interview.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { buildHypothesisPrompt, parseHypothesisResponse } from "../packages/ai/src/index";
import type { InterviewInput, SchemaHypothesis } from "../packages/types/src/schema";

const MODEL = "claude-sonnet-4-6";

const anthropic = new Anthropic();

const testInputs: { name: string; input: InterviewInput }[] = [
  {
    name: "School Parent",
    input: {
      role: "parent",
      domain: "school_parent",
      whats: ["Vail Mountain School", "Eagle Valley SC"],
      whos: ["Coach Martinez", "Mrs. Patterson"],
      goals: ["actions", "schedule"],
    },
  },
  {
    name: "Property Manager",
    input: {
      role: "property",
      domain: "property",
      whats: ["123 Main St", "456 Oak Ave", "789 Elm St"],
      whos: ["Quick Fix Plumbing"],
      goals: ["costs", "status"],
    },
  },
  {
    name: "Construction",
    input: {
      role: "construction",
      domain: "construction",
      whats: ["Harbor View Renovation", "Elm Street Addition"],
      whos: ["Comfort Air Solutions", "Torres Engineering"],
      goals: ["costs", "deadlines"],
    },
  },
  {
    name: "Agency",
    input: {
      role: "agency",
      domain: "agency",
      whats: ["Acme Corp rebrand", "Widget Inc Q2"],
      whos: ["Sarah at Acme"],
      goals: ["deadlines", "actions"],
    },
  },
  {
    name: "Legal",
    input: {
      role: "legal",
      domain: "legal",
      whats: ["Smith v. Jones", "Acme Corp acquisition"],
      whos: ["Johnson & Associates"],
      goals: ["deadlines", "status"],
    },
  },
];

interface EvalCheck {
  name: string;
  passed: boolean;
  detail: string;
}

interface EvalResult {
  name: string;
  passed: boolean;
  checks: EvalCheck[];
  hypothesis: SchemaHypothesis | null;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

function evaluate(name: string, hypothesis: SchemaHypothesis, input: InterviewInput): EvalCheck[] {
  const checks: EvalCheck[] = [];

  // Primary entity type makes sense
  checks.push({
    name: "Primary entity type",
    passed: hypothesis.primaryEntity.name.length > 0,
    detail: `"${hypothesis.primaryEntity.name}" - ${hypothesis.primaryEntity.description}`,
  });

  // At least 5 relevant tags
  const tagCount = hypothesis.tags.length;
  checks.push({
    name: "At least 5 tags",
    passed: tagCount >= 5,
    detail: `${tagCount} tags: ${hypothesis.tags.map((t) => t.name).join(", ")}`,
  });

  // No generic tags
  const genericTags = ["Communication", "Updates", "General", "Other", "Miscellaneous"];
  const foundGeneric = hypothesis.tags.filter((t) => genericTags.includes(t.name));
  checks.push({
    name: "No generic tags",
    passed: foundGeneric.length === 0,
    detail:
      foundGeneric.length > 0
        ? `Found generic: ${foundGeneric.map((t) => t.name).join(", ")}`
        : "All domain-specific",
  });

  // Clustering constants present and reasonable
  const config = hypothesis.clusteringConfig;
  checks.push({
    name: "Domain-specific clustering",
    passed: config.mergeThreshold > 0 && config.mergeThreshold <= 100,
    detail: `mergeThreshold=${config.mergeThreshold}, timeDecay.fresh=${config.timeDecayDays.fresh}, reminderCollapse=${config.reminderCollapseEnabled}`,
  });

  // Summary labels non-empty
  checks.push({
    name: "Summary labels",
    passed:
      hypothesis.summaryLabels.beginning.length > 0 &&
      hypothesis.summaryLabels.middle.length > 0 &&
      hypothesis.summaryLabels.end.length > 0,
    detail: `${hypothesis.summaryLabels.beginning} / ${hypothesis.summaryLabels.middle} / ${hypothesis.summaryLabels.end}`,
  });

  // Discovery queries reference entity names
  const queryTexts = hypothesis.discoveryQueries.map((q) => q.query.toLowerCase());
  const entityWords = input.whats.flatMap((w) => w.toLowerCase().split(/\s+/));
  const queriesRefEntities = entityWords.some((word) => queryTexts.some((q) => q.includes(word)));
  checks.push({
    name: "Discovery queries reference entities",
    passed: queriesRefEntities,
    detail: `${hypothesis.discoveryQueries.length} queries: ${hypothesis.discoveryQueries.map((q) => q.query).join("; ")}`,
  });

  // At least one showOnCard extracted field
  const showOnCardFields = hypothesis.extractedFields.filter((f) => f.showOnCard);
  checks.push({
    name: "Actionable extracted fields",
    passed: showOnCardFields.length >= 1,
    detail: `${showOnCardFields.length} showOnCard: ${showOnCardFields.map((f) => f.name).join(", ")}`,
  });

  // Entity aliases generated
  const withAliases = hypothesis.entities.filter((e) => e.aliases.length > 0);
  checks.push({
    name: "Entity aliases generated",
    passed: withAliases.length > 0,
    detail: hypothesis.entities.map((e) => `${e.name}: [${e.aliases.join(", ")}]`).join("; "),
  });

  // All user whats appear as PRIMARY entities
  const primaryNames = hypothesis.entities
    .filter((e) => e.type === "PRIMARY")
    .map((e) => e.name.toLowerCase());
  const allWhatsPresent = input.whats.every((w) =>
    primaryNames.some((p) => p.includes(w.toLowerCase()) || w.toLowerCase().includes(p)),
  );
  checks.push({
    name: "All whats as PRIMARY entities",
    passed: allWhatsPresent,
    detail: `Input: ${input.whats.join(", ")} -> Found: ${hypothesis.entities
      .filter((e) => e.type === "PRIMARY")
      .map((e) => e.name)
      .join(", ")}`,
  });

  // Goals affect showOnCard
  const goalFieldMap: Record<string, string[]> = {
    deadlines: ["deadline"],
    costs: ["cost", "amount", "budget"],
    schedule: ["eventdate", "date", "event"],
    actions: [],
    status: [],
  };
  const expectedFields = input.goals.flatMap((g) => goalFieldMap[g] || []);
  const showOnCardNames = hypothesis.extractedFields
    .filter((f) => f.showOnCard)
    .map((f) => f.name.toLowerCase());
  const goalsReflected =
    expectedFields.length === 0 ||
    expectedFields.some((expected) => showOnCardNames.some((actual) => actual.includes(expected)));
  checks.push({
    name: "Goals affect showOnCard",
    passed: goalsReflected,
    detail: `Goals: ${input.goals.join(", ")} -> showOnCard: ${showOnCardNames.join(", ")}`,
  });

  return checks;
}

async function runTest(name: string, input: InterviewInput): Promise<EvalResult> {
  console.log(`\nTesting: ${name}...`);
  const start = Date.now();

  try {
    const prompt = buildHypothesisPrompt(input);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });

    const latencyMs = Date.now() - start;
    const textBlock = response.content.find((b) => b.type === "text");
    const content = textBlock && "text" in textBlock ? textBlock.text : "";

    const hypothesis = parseHypothesisResponse(content);
    const checks = evaluate(name, hypothesis, input);
    const passed = checks.every((c) => c.passed);

    console.log(
      `  ${passed ? "PASS" : "FAIL"} (${checks.filter((c) => c.passed).length}/${checks.length} checks) [${latencyMs}ms]`,
    );

    return {
      name,
      passed,
      checks,
      hypothesis,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ERROR [${latencyMs}ms]: ${msg}`);
    return { name, passed: false, checks: [], hypothesis: null, error: msg };
  }
}

async function main() {
  console.log("Phase 1: Schema Quality Evaluation");
  console.log(`Model: ${MODEL}`);
  console.log(`Domains: ${testInputs.length}`);

  const results: EvalResult[] = [];
  for (const { name, input } of testInputs) {
    const result = await runTest(name, input);
    results.push(result);
  }

  // Cross-domain clustering check
  console.log("\n--- Cross-Domain Clustering Check ---");
  const configs = results
    .filter((r) => r.hypothesis)
    .map((r) => ({
      name: r.name,
      config: r.hypothesis?.clusteringConfig,
    }));

  if (configs.length >= 2) {
    const thresholds = new Set(configs.map((c) => c.config.mergeThreshold));
    console.log(
      `  Merge thresholds: ${configs.map((c) => `${c.name}=${c.config.mergeThreshold}`).join(", ")}`,
    );
    console.log(
      `  Distinct values: ${thresholds.size} ${thresholds.size > 1 ? "(GOOD - differentiated)" : "(BAD - all same)"}`,
    );
  }

  // Generate markdown report
  const date = new Date().toISOString().split("T")[0];
  let md = "# Phase 1: Schema Quality Evaluation\n\n";
  md += `**Date:** ${date}\n`;
  md += `**Model:** ${MODEL}\n\n`;

  // Summary table
  md += "## Summary\n\n";
  md += "| Domain | Result | Checks | Latency | Tokens (in/out) |\n";
  md += "|---|---|---|---|---|\n";
  for (const r of results) {
    const status = r.error ? "ERROR" : r.passed ? "PASS" : "FAIL";
    const checksStr = `${r.checks.filter((c) => c.passed).length}/${r.checks.length}`;
    const latency = r.latencyMs ? `${r.latencyMs}ms` : "-";
    const tokens = r.inputTokens && r.outputTokens ? `${r.inputTokens}/${r.outputTokens}` : "-";
    md += `| ${r.name} | ${status} | ${checksStr} | ${latency} | ${tokens} |\n`;
  }

  // Clustering comparison
  md += "\n## Cross-Domain Clustering Constants\n\n";
  md += "| Domain | mergeThreshold | timeDecay.fresh | reminderCollapse |\n";
  md += "|---|---|---|---|\n";
  for (const r of results) {
    if (r.hypothesis) {
      const c = r.hypothesis.clusteringConfig;
      md += `| ${r.name} | ${c.mergeThreshold} | ${c.timeDecayDays.fresh} | ${c.reminderCollapseEnabled} |\n`;
    }
  }

  // Detailed results
  md += "\n## Detailed Results\n\n";
  for (const r of results) {
    md += `### ${r.name}\n\n`;
    if (r.error) {
      md += `**Error:** ${r.error}\n\n`;
      continue;
    }
    for (const check of r.checks) {
      md += `- ${check.passed ? "[x]" : "[ ]"} **${check.name}:** ${check.detail}\n`;
    }
    if (r.hypothesis) {
      md += `\n**Schema name:** ${r.hypothesis.schemaName}\n`;
      md += `**Primary entity:** ${r.hypothesis.primaryEntity.name}\n`;
      md += `**Secondary types:** ${r.hypothesis.secondaryEntityTypes.map((t) => t.name).join(", ")}\n`;
      md += `**Exclusion patterns:** ${r.hypothesis.exclusionPatterns.join(", ")}\n`;
    }
    md += "\n";
  }

  // Write report
  const outPath = path.join(process.cwd(), "docs", "test-results", "phase1-schema-quality.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  console.log(`\nReport saved to ${outPath}`);

  // Exit summary
  const passCount = results.filter((r) => r.passed).length;
  console.log(`\n${passCount}/${results.length} domains passed all checks`);
  process.exit(passCount === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
