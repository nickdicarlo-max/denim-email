/**
 * Onboarding Eval Harness — runs the REAL production onboarding pipeline
 * against `denim_samples_individual/` fixtures for one locked schema at a time.
 *
 * Two stages per schema:
 *
 *   --stage discovery   Runs Stage 1 (domain discovery) + Stage 2 (entity
 *                       discovery) via the real `discoverDomains` /
 *                       `discoverEntitiesForDomain` service functions with
 *                       a FixtureGmailClient. Persists candidates, stops in
 *                       AWAITING_ENTITY_CONFIRMATION. Outputs a report +
 *                       dev-server URLs for the user to review the real
 *                       domain-confirm and entity-confirm screens.
 *
 *   --stage synthesis   Auto-accepts all Stage 2 candidates, advances to
 *                       PROCESSING_SCAN, and drives extraction / clustering /
 *                       synthesis synchronously against FixtureGmailClient.
 *                       Case-quality report lands in docs/test-results/.
 *
 * Usage (from apps/web/):
 *   AI_RESPONSE_CACHE=fixture npx tsx scripts/eval-onboarding.ts --schema school_parent --stage discovery
 *   AI_RESPONSE_CACHE=fixture npx tsx scripts/eval-onboarding.ts --schema school_parent --stage synthesis
 *
 * Hard constraint: this harness calls real service code. No parallel logic.
 * When eval fails, the fix lands in the production file, not here.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DiscoveryQuery, EntityGroupInput } from "@denim/types";
import { getCacheMode } from "../src/lib/ai/interceptor";
import type { DomainName } from "../src/lib/config/domain-shapes";
import { discoverStage1Candidates } from "../src/lib/discovery/stage1-orchestrator";
import {
  discoverUserNamedContacts,
  discoverUserNamedThings,
} from "../src/lib/discovery/user-hints-discovery";
import { FixtureGmailClient } from "../src/lib/gmail/fixture-client";
import { loadFixtures } from "../src/lib/gmail/fixture-loader";
import { prisma } from "../src/lib/prisma";
import { coarseCluster, splitCoarseClusters } from "../src/lib/services/cluster";
import { runSmartDiscovery } from "../src/lib/services/discovery";
import { buildSchemaContext, processEmailBatch } from "../src/lib/services/extraction";
import {
  type ConfirmedEntity,
  createSchemaStub,
  persistConfirmedEntities,
  seedSchemaDefaults,
  writeStage1Result,
  writeStage2Result,
} from "../src/lib/services/interview";
import { advanceSchemaPhase } from "../src/lib/services/onboarding-state";
import { buildStage2Context, runStage2ForDomain } from "../src/lib/services/stage2-fanout";
import { synthesizeCase } from "../src/lib/services/synthesis";
import { simulateReviewGate } from "./eval-gate-sim";
import { EVAL_SCHEMAS, type EvalSchemaKey, evalUserId, getEvalConfig } from "./eval-ground-truth";

const FIXTURES_REL = "../../denim_samples_individual";
const REPORT_DIR_REL = "../../docs/test-results";
const DEV_SERVER_BASE = process.env.EVAL_DEV_SERVER_URL ?? "http://localhost:3000";

// ─── CLI ──────────────────────────────────────────────────────────────

type Stage = "discovery" | "synthesis";

interface CliArgs {
  schema: EvalSchemaKey;
  stage: Stage;
  refreshCache: boolean;
}

function parseArgs(): CliArgs {
  const a = process.argv.slice(2);
  let schema: string | undefined;
  let stage: string | undefined;
  let refreshCache = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--schema" && a[i + 1]) schema = a[++i];
    else if (a[i] === "--stage" && a[i + 1]) stage = a[++i];
    else if (a[i] === "--refresh-cache") refreshCache = true;
  }
  if (!schema || !(schema in EVAL_SCHEMAS)) {
    exitWithUsage(`Missing or invalid --schema. Got: ${schema ?? "(none)"}`);
  }
  if (stage !== "discovery" && stage !== "synthesis") {
    exitWithUsage(`Missing or invalid --stage. Got: ${stage ?? "(none)"}`);
  }
  return {
    schema: schema as EvalSchemaKey,
    stage: stage as Stage,
    refreshCache,
  };
}

function exitWithUsage(msg: string): never {
  console.error(`\n${msg}\n`);
  console.error("Usage (from apps/web/):");
  console.error(
    "  npx tsx scripts/eval-onboarding.ts --schema <key> --stage <discovery|synthesis> [--refresh-cache]",
  );
  console.error(`\n  schemas: ${Object.keys(EVAL_SCHEMAS).join(", ")}`);
  process.exit(2);
}

// ─── Shared setup ─────────────────────────────────────────────────────

async function ensureEvalUser(userId: string): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email: `${userId}@eval.local`,
      displayName: `Eval — ${userId}`,
    },
    update: {},
  });
}

/**
 * Domain-scoped wipe. Deletes prior CaseSchema rows matching
 * `{ userId, domain }` (plus FK-chained rows). Scoping by domain lets all
 * three eval schemas share one userId (`dev-user-id`) without reruns of
 * one schema nuking the other two's review state.
 */
async function wipePriorEvalSchema(userId: string, domain: string): Promise<void> {
  const existing = await prisma.caseSchema.findMany({
    where: { userId, domain },
    select: { id: true },
  });
  const ids = existing.map((s) => s.id);
  if (ids.length === 0) return;

  // Find email IDs up-front so rows without a direct schemaId FK (ExtractionCost,
  // EmailAttachment) can be deleted by emailId.
  const emails = await prisma.email.findMany({
    where: { schemaId: { in: ids } },
    select: { id: true },
  });
  const emailIds = emails.map((e) => e.id);

  // FK-safe deletion within the scope of this user's schemas only.
  await prisma.caseAction.deleteMany({ where: { case: { schemaId: { in: ids } } } });
  await prisma.caseEmail.deleteMany({ where: { case: { schemaId: { in: ids } } } });
  await prisma.cluster.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.case.deleteMany({ where: { schemaId: { in: ids } } });
  if (emailIds.length > 0) {
    await prisma.extractionCost.deleteMany({ where: { emailId: { in: emailIds } } });
    await prisma.emailAttachment.deleteMany({ where: { emailId: { in: emailIds } } });
  }
  await prisma.email.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.feedbackEvent.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.qualitySnapshot.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.scanJob.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.exclusionRule.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.extractedFieldDef.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.schemaTag.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.entity.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.entityGroup.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.onboardingOutbox.deleteMany({ where: { schemaId: { in: ids } } });
  await prisma.caseSchema.deleteMany({ where: { id: { in: ids } } });
}

// ─── Report builder ───────────────────────────────────────────────────

interface AssertionResult {
  label: string;
  status: "PASS" | "FAIL";
  detail?: string;
}

interface SoftResult {
  label: string;
  ratio: string;
  detail?: string;
}

interface DiscoveryReport {
  schema: EvalSchemaKey;
  schemaId: string;
  ranAt: string;
  cacheMode: string;
  timings: {
    stage1Ms: number;
    stage2MaxMs: number;
    stage2TotalMs: number;
  };
  stage1: {
    query: string;
    messagesSeen: number;
    errorCount: number;
    candidates: Array<{ domain: string; count: number }>;
    userThings: Array<{ query: string; matchCount: number; topDomain: string | null }>;
    userContacts: Array<{ query: string; matchCount: number; senderEmail: string | null }>;
  };
  stage2: Array<{
    confirmedDomain: string;
    algorithm: string;
    subjectsScanned: number;
    errorCount: number;
    candidates: Array<{ key: string; displayString: string; frequency: number }>;
    durationMs: number;
  }>;
  hard: AssertionResult[];
  soft: SoftResult[];
  urls: {
    domainConfirm: string;
    entityConfirm: string;
  };
}

function verdict(hard: AssertionResult[]): "PASS" | "FAIL" {
  return hard.every((h) => h.status === "PASS") ? "PASS" : "FAIL";
}

function writeDiscoveryReport(report: DiscoveryReport): string {
  const date = report.ranAt.slice(0, 10);
  const reportDir = resolve(process.cwd(), REPORT_DIR_REL);
  mkdirSync(reportDir, { recursive: true });
  const path = resolve(reportDir, `eval-onboarding-${report.schema}-stage12-${date}.md`);

  const lines: string[] = [];
  lines.push(`# Eval Onboarding — ${report.schema} — Stage 1+2`);
  lines.push("");
  lines.push(`- **Ran at:** ${report.ranAt}`);
  lines.push(`- **Schema ID:** \`${report.schemaId}\``);
  lines.push(`- **Cache mode:** \`${report.cacheMode}\``);
  lines.push(
    `- **Timings:** Stage 1 = ${report.timings.stage1Ms} ms • Stage 2 max-per-domain = ${report.timings.stage2MaxMs} ms • Stage 2 total = ${report.timings.stage2TotalMs} ms`,
  );
  lines.push("");
  lines.push(`## Verdict: **${verdict(report.hard)}**`);
  lines.push("");

  lines.push(`## Hard assertions`);
  lines.push("");
  lines.push(`| Check | Status | Detail |`);
  lines.push(`| --- | --- | --- |`);
  for (const h of report.hard) {
    lines.push(`| ${h.label} | ${h.status} | ${h.detail ?? ""} |`);
  }
  lines.push("");

  lines.push(`## Soft expectations`);
  lines.push("");
  lines.push(`| Check | Result | Detail |`);
  lines.push(`| --- | --- | --- |`);
  for (const s of report.soft) {
    lines.push(`| ${s.label} | ${s.ratio} | ${s.detail ?? ""} |`);
  }
  lines.push("");

  lines.push(`## Stage 1 — domain discovery`);
  lines.push("");
  lines.push(
    `Messages seen: **${report.stage1.messagesSeen}** • Errors: ${report.stage1.errorCount}`,
  );
  lines.push("");
  lines.push("Candidates:");
  lines.push("");
  if (report.stage1.candidates.length === 0) {
    lines.push("_(none)_");
  } else {
    lines.push(`| # | Domain | Count |`);
    lines.push(`| --- | --- | --- |`);
    for (let i = 0; i < report.stage1.candidates.length; i++) {
      const c = report.stage1.candidates[i];
      lines.push(`| ${i + 1} | ${c.domain} | ${c.count} |`);
    }
  }
  lines.push("");
  if (report.stage1.userThings.length > 0) {
    lines.push(`### User-named things`);
    lines.push("");
    lines.push(`| Query | Matches | Top domain |`);
    lines.push(`| --- | --- | --- |`);
    for (const t of report.stage1.userThings) {
      lines.push(`| ${t.query} | ${t.matchCount} | ${t.topDomain ?? "—"} |`);
    }
    lines.push("");
  }
  if (report.stage1.userContacts.length > 0) {
    lines.push(`### User-named contacts`);
    lines.push("");
    lines.push(`| Query | Matches | Sender email |`);
    lines.push(`| --- | --- | --- |`);
    for (const t of report.stage1.userContacts) {
      lines.push(`| ${t.query} | ${t.matchCount} | ${t.senderEmail ?? "—"} |`);
    }
    lines.push("");
  }

  lines.push(`## Stage 2 — entity discovery`);
  lines.push("");
  for (const s of report.stage2) {
    lines.push(
      `### ${s.confirmedDomain} — ${s.algorithm} (${s.subjectsScanned} subjects • ${s.durationMs} ms • ${s.errorCount} errors)`,
    );
    lines.push("");
    if (s.candidates.length === 0) {
      lines.push("_(no candidates)_");
    } else {
      lines.push(`| # | Key | Display | Frequency |`);
      lines.push(`| --- | --- | --- | --- |`);
      for (let i = 0; i < s.candidates.length; i++) {
        const c = s.candidates[i];
        lines.push(`| ${i + 1} | \`${c.key}\` | ${c.displayString} | ${c.frequency} |`);
      }
    }
    lines.push("");
  }

  lines.push(`## Manual review URLs`);
  lines.push("");
  lines.push(`Open these in a browser with the dev server running:`);
  lines.push("");
  lines.push(`- Domain confirm: ${report.urls.domainConfirm}`);
  lines.push(`- Entity confirm: ${report.urls.entityConfirm}`);

  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

// ─── Stage 1 + Stage 2 run ────────────────────────────────────────────

async function runDiscoveryStage(args: CliArgs): Promise<void> {
  const cfg = getEvalConfig(args.schema);
  const userId = evalUserId(cfg.schemaKey);
  const cacheMode = getCacheMode();

  console.error(`\n=== EVAL ONBOARDING — DISCOVERY (${cfg.schemaKey}) ===`);
  console.error(`  User: ${userId}`);
  console.error(`  Cache mode: ${cacheMode}`);

  // 0. Fixtures
  const fixturesPath = resolve(process.cwd(), FIXTURES_REL);
  const fixtures = loadFixtures(fixturesPath);
  console.error(`  Fixtures: ${fixtures.length} from ${fixturesPath}`);
  if (fixtures.length === 0) {
    console.error("  No fixtures. Abort.");
    process.exit(1);
  }
  const fixtureClient = new FixtureGmailClient(fixtures);

  // 1. Ensure user + wipe prior schema (scoped to this domain only so
  // other schemas under the same synthetic user stay reviewable)
  await ensureEvalUser(userId);
  await wipePriorEvalSchema(userId, cfg.domain);

  // 2. Create schema stub
  const schemaId = await createSchemaStub({ userId, inputs: cfg.interview });
  console.error(`  Schema: ${schemaId}`);

  // 3. Stage 1 — discoverDomains + user-hints (mirrors runDomainDiscovery)
  const userDomain = "eval.local"; // synthetic — not a sender in fixtures
  const whats = cfg.interview.whats;
  const whos = cfg.interview.whos;
  const groups = cfg.interview.groups as EntityGroupInput[];

  const s1Start = Date.now();
  await advanceSchemaPhase({
    schemaId,
    from: "PENDING",
    to: "DISCOVERING_DOMAINS",
    work: async () => undefined,
  });

  const stage1 = await discoverStage1Candidates({
    gmailClient: fixtureClient,
    userDomain,
    whats,
    whos,
    groups,
  });
  const { candidates: scoredCandidates, userThings, userContacts } = stage1;
  const s1Ms = Date.now() - s1Start;

  await writeStage1Result(schemaId, {
    candidates: scoredCandidates.map((c) => ({
      domain: c.domain,
      score: c.score,
      signals: c.signals,
      hintsMatched: c.hintsMatched,
      ...(c.pairedWho ? { pairedWho: c.pairedWho } : {}),
      count: c.score,
    })),
    queryUsed: `hint-anchored: ${userThings.length} WHAT, ${userContacts.length} WHO`,
    messagesSeen: stage1.messagesSeen,
    errorCount: stage1.errorCount,
    userThings,
    userContacts,
  });
  await advanceSchemaPhase({
    schemaId,
    from: "DISCOVERING_DOMAINS",
    to: "AWAITING_DOMAIN_CONFIRMATION",
    work: async () => undefined,
  });
  console.error(
    `  Stage 1 done (${s1Ms} ms) — ${scoredCandidates.length} scored domain candidates, ${userThings.length} user-things, ${userContacts.length} user-contacts`,
  );

  // 4. Auto-confirm all Stage 1 domains + all contacts with matches > 0
  const confirmedDomains = scoredCandidates.map((c) => c.domain);
  const confirmedUserContactQueries = userContacts
    .filter((c) => c.matchCount > 0)
    .map((c) => c.query);
  await prisma.caseSchema.update({
    where: { id: schemaId },
    data: {
      stage2ConfirmedDomains: confirmedDomains,
      stage1ConfirmedUserContactQueries: confirmedUserContactQueries,
    },
  });
  await advanceSchemaPhase({
    schemaId,
    from: "AWAITING_DOMAIN_CONFIRMATION",
    to: "DISCOVERING_ENTITIES",
    work: async () => undefined,
  });

  // 5. Stage 2 — reload schema snapshot and drive the shared fanout helper
  //    that `runEntityDiscovery` (Inngest) also uses. Guarantees the eval
  //    exercises the same seed-prepend + paired-WHO behaviour as prod.
  const reloaded = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: schemaId },
    select: {
      id: true,
      userId: true,
      domain: true,
      stage2ConfirmedDomains: true,
      stage1UserContacts: true,
      stage1ConfirmedUserContactQueries: true,
      inputs: true,
    },
  });
  const ctx = buildStage2Context(reloaded);

  const s2Start = Date.now();
  const perDomainTimings = new Map<string, number>();
  const perDomainResults = await Promise.all(
    ctx.confirmedDomains.map(async (confirmedDomain) => {
      const start = Date.now();
      const res = await runStage2ForDomain(ctx, confirmedDomain, fixtureClient);
      perDomainTimings.set(confirmedDomain, Date.now() - start);
      return { ...res, durationMs: Date.now() - start };
    }),
  );
  const s2TotalMs = Date.now() - s2Start;
  const s2MaxMs = Math.max(...Array.from(perDomainTimings.values()), 0);

  await writeStage2Result(schemaId, { perDomain: perDomainResults });
  await advanceSchemaPhase({
    schemaId,
    from: "DISCOVERING_ENTITIES",
    to: "AWAITING_ENTITY_CONFIRMATION",
    work: async () => undefined,
  });
  console.error(
    `  Stage 2 done (${s2TotalMs} ms total, ${s2MaxMs} ms max/domain) — ${perDomainResults.length} domains`,
  );

  // 6. Assertions
  const hard: AssertionResult[] = [];
  const soft: SoftResult[] = [];

  // SLA — Stage 1 < 5s, Stage 2 per-domain max < 6s
  hard.push({
    label: "SLA: Stage 1 < 5 s",
    status: s1Ms < 5000 ? "PASS" : "FAIL",
    detail: `${s1Ms} ms`,
  });
  hard.push({
    label: "SLA: Stage 2 per-domain ≤ 6 s (max)",
    status: s2MaxMs < 6000 ? "PASS" : "FAIL",
    detail: `${s2MaxMs} ms`,
  });

  // Seeded primaries — each must surface somewhere: Stage 2 candidates (any domain)
  // OR userThings matched (matchCount > 0).
  const allStage2Candidates = perDomainResults.flatMap((r) =>
    (r.candidates as Array<{ key: string; displayString: string; frequency: number }>).map((c) => ({
      ...c,
      domain: r.confirmedDomain,
    })),
  );
  const userThingsMatched = new Set(
    userThings.filter((t) => t.matchCount > 0).map((t) => t.query.toLowerCase()),
  );
  for (const primary of cfg.seededPrimaries) {
    const needle = primary.toLowerCase();
    const inStage2 = allStage2Candidates.some(
      (c) =>
        c.displayString.toLowerCase().includes(needle) ||
        c.key.toLowerCase().includes(needle.replace(/\s+/g, "-")),
    );
    const inUserThings = userThingsMatched.has(needle);
    const ok = inStage2 || inUserThings;
    hard.push({
      label: `Seeded primary: "${primary}"`,
      status: ok ? "PASS" : "FAIL",
      detail: ok
        ? `found in ${inStage2 ? "stage2" : ""}${inStage2 && inUserThings ? "+" : ""}${inUserThings ? "userThings" : ""}`
        : "not surfaced",
    });
  }

  // Seeded WHOs — each must appear in userContacts with matchCount > 0.
  const userContactsMap = new Map(userContacts.map((c) => [c.query.toLowerCase(), c]));
  for (const who of cfg.seededWhos) {
    const uc = userContactsMap.get(who.toLowerCase());
    const ok = uc !== undefined && uc.matchCount > 0;
    hard.push({
      label: `Seeded WHO: "${who}"`,
      status: ok ? "PASS" : "FAIL",
      detail: uc ? `matches=${uc.matchCount} sender=${uc.senderEmail ?? "—"}` : "not seen",
    });
  }

  // Soft — expected domains
  for (const expected of cfg.expectedDomains) {
    const rank = scoredCandidates.findIndex((c) => c.domain === expected);
    soft.push({
      label: `Expected domain: "${expected}"`,
      ratio: rank >= 0 ? `found @ #${rank + 1}` : "not found",
    });
  }

  // Soft — expected discoveries (primaries the system should surface but user didn't seed)
  for (const expected of cfg.expectedDiscoveries) {
    const needle = expected.toLowerCase();
    const hit = allStage2Candidates.some((c) => c.displayString.toLowerCase().includes(needle));
    soft.push({
      label: `Expected discovery: "${expected}"`,
      ratio: hit ? "found" : "not found",
    });
  }

  // Soft — count range (e.g., property: 9-12 property entities on judgefite.com)
  if (cfg.countRange) {
    const count = allStage2Candidates.length;
    soft.push({
      label: cfg.countRange.label,
      ratio: `${count} (expected ${cfg.countRange.min}–${cfg.countRange.max})`,
      detail:
        count >= cfg.countRange.min && count <= cfg.countRange.max ? "in range" : "out of range",
    });
  }

  // 7. Report
  const report: DiscoveryReport = {
    schema: cfg.schemaKey,
    schemaId,
    ranAt: new Date().toISOString(),
    cacheMode,
    timings: { stage1Ms: s1Ms, stage2MaxMs: s2MaxMs, stage2TotalMs: s2TotalMs },
    stage1: {
      query: `hint-anchored: ${userThings.length} WHAT, ${userContacts.length} WHO`,
      messagesSeen: stage1.messagesSeen,
      errorCount: stage1.errorCount,
      candidates: scoredCandidates.map((c) => ({ domain: c.domain, count: c.score })),
      userThings: userThings.map((t) => ({
        query: t.query,
        matchCount: t.matchCount,
        topDomain: t.topDomain,
      })),
      userContacts: userContacts.map((c) => ({
        query: c.query,
        matchCount: c.matchCount,
        senderEmail: c.senderEmail,
      })),
    },
    stage2: perDomainResults.map((r) => ({
      confirmedDomain: r.confirmedDomain,
      algorithm: r.algorithm,
      subjectsScanned: r.subjectsScanned,
      errorCount: r.errorCount,
      candidates: (
        r.candidates as Array<{ key: string; displayString: string; frequency: number }>
      ).map((c) => ({ key: c.key, displayString: c.displayString, frequency: c.frequency })),
      durationMs: r.durationMs,
    })),
    hard,
    soft,
    urls: {
      // Single polling page that picks the right component per-phase.
      domainConfirm: `${DEV_SERVER_BASE}/onboarding/${schemaId}`,
      entityConfirm: `${DEV_SERVER_BASE}/onboarding/${schemaId}`,
    },
  };

  const reportPath = writeDiscoveryReport(report);

  // 8. Console summary
  console.log("");
  console.log(`== ${cfg.schemaKey.toUpperCase()} — ${verdict(hard)} ==`);
  console.log("");
  console.log("Hard assertions:");
  for (const h of hard) {
    console.log(
      `  ${h.status === "PASS" ? "✅" : "❌"} ${h.label}${h.detail ? ` — ${h.detail}` : ""}`,
    );
  }
  console.log("");
  console.log("Soft expectations:");
  for (const s of hard.length ? soft : []) {
    console.log(`  · ${s.label} — ${s.ratio}${s.detail ? ` (${s.detail})` : ""}`);
  }
  console.log("");
  console.log(`Report: ${reportPath}`);
  console.log("");
  console.log("Manual review (dev server must be running):");
  console.log(`  Domain confirm: ${report.urls.domainConfirm}`);
  console.log(`  Entity confirm: ${report.urls.entityConfirm}`);
  console.log("");

  await prisma.$disconnect();
  process.exit(verdict(hard) === "PASS" ? 0 : 1);
}

// ─── Synthesis (scan + extraction + clustering + synthesis) ─────────

interface SynthesisReport {
  schema: EvalSchemaKey;
  schemaId: string;
  ranAt: string;
  cacheMode: string;
  timings: {
    discoveryMs: number;
    extractionMs: number;
    clusteringMs: number;
    synthesisMs: number;
    totalMs: number;
  };
  scan: {
    discoveredEmails: number;
    extracted: number;
    excluded: number;
    failed: number;
  };
  cases: {
    total: number;
    multiEmail: number;
    singleEmail: number;
    withActions: number;
    withEntity: number;
    minEmails: number;
    maxEmails: number;
    avgEmails: number;
  };
  costUsd: number;
  hard: AssertionResult[];
  soft: SoftResult[];
  caseDetails: Array<{
    id: string;
    title: string | null;
    emailCount: number;
    urgency: string | null;
    entityName: string | null;
  }>;
  // Phase 4 (2026-04-23): quality metrics that correlate "eval PASS" with
  // "chip row will look right." Predicted chip row lets a human eyeball
  // without opening the browser; off-topic cases are the bleed metric that
  // replaces the old count-based assertions.
  chipRow: {
    hints: Array<{
      name: string;
      origin: string;
      score: number | null;
      caseCount: number;
    }>;
    discoveries: Array<{
      name: string;
      origin: string;
      score: number | null;
      caseCount: number;
    }>;
  };
  offTopicCases: Array<{
    id: string;
    title: string;
    entity: string | null;
    entityOrigin: string | null;
  }>;
  // Phase 5 Part E — review-screen gate simulation. `accepted` entities
  // were persisted; `rejected` would have been left unticked by a real user.
  gateSim: {
    accepted: number;
    rejected: number;
    rejectedByReason: Record<string, number>;
    verdicts: Array<{
      identityKey: string;
      displayLabel: string;
      verdict: "accepted" | "rejected";
    }>;
  };
}

/**
 * Auto-confirm all Stage 2 candidates + advance the schema to PROCESSING_SCAN.
 * Mirrors POST /api/onboarding/:schemaId/entity-confirm without the HTTP layer
 * so the eval can drive the same service code synchronously.
 */
interface AutoConfirmResult {
  confirmedCount: number;
  gateSim: {
    accepted: number;
    rejected: number;
    rejectedByReason: Record<string, number>;
    verdicts: Array<{
      identityKey: string;
      displayLabel: string;
      verdict: "accepted" | "rejected";
    }>;
  };
}

async function autoConfirmEntitiesAndAdvance(schemaId: string): Promise<AutoConfirmResult> {
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: schemaId },
    select: {
      id: true,
      name: true,
      domain: true,
      phase: true,
      stage2Candidates: true,
      stage1UserContacts: true,
      stage1UserThings: true,
      inputs: true,
    },
  });
  if (schema.phase !== "AWAITING_ENTITY_CONFIRMATION") {
    throw new Error(
      `Schema ${schemaId} is phase=${schema.phase}, expected AWAITING_ENTITY_CONFIRMATION. Run --stage discovery first.`,
    );
  }

  // Flatten the perDomain candidate payload into ConfirmedEntity[].
  // PRIMARY for everything NOT prefixed with `@`; SECONDARY for `@sender@domain` keys.
  // Phase 3: also annotate each entity with its origin + discoveryScore so
  // evals exercise the same chip-row ordering the live feed will use.
  const perDomain =
    (schema.stage2Candidates as Array<{
      confirmedDomain: string;
      algorithm?: string;
      candidates: Array<{ key: string; displayString: string; meta?: Record<string, unknown> }>;
    }> | null) ?? [];
  const userThings = (schema.stage1UserThings as Array<{ query: string }> | null) ?? [];
  function tokens(s: string): string[] {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
  }
  const userHintTokenSets: string[][] = userThings
    .map((t) => tokens(t.query ?? ""))
    .filter((arr) => arr.length > 0);
  function matchesUserHint(displayLabel: string): boolean {
    const labelTokens = new Set(tokens(displayLabel));
    for (const hintTokens of userHintTokenSets) {
      if (hintTokens.every((t) => labelTokens.has(t))) return true;
    }
    return false;
  }

  type OriginName = NonNullable<ConfirmedEntity["origin"]>;
  function resolveOrigin(
    kind: "PRIMARY" | "SECONDARY",
    displayString: string,
    algorithm: string | undefined,
    meta: Record<string, unknown> | undefined,
  ): { origin: OriginName; discoveryScore?: number } {
    if (kind === "PRIMARY" && matchesUserHint(displayString)) {
      return { origin: "USER_HINT" };
    }
    if (kind === "SECONDARY" && meta?.source === "user_named") {
      return { origin: "USER_SEEDED" };
    }
    const pattern = meta?.pattern as string | undefined;
    const score = meta?.discoveryScore as number | undefined;
    if (pattern === "short-circuit" || algorithm === "pair-short-circuit") {
      return { origin: "STAGE2_SHORT_CIRCUIT", discoveryScore: score };
    }
    if (pattern === "agency-domain-derive" || algorithm === "agency-domain-derive") {
      return { origin: "STAGE2_AGENCY_DOMAIN", discoveryScore: score };
    }
    if (pattern === "gemini" || algorithm === "gemini-subject-pass") {
      return { origin: "STAGE2_GEMINI", discoveryScore: score };
    }
    return { origin: kind === "SECONDARY" ? "USER_SEEDED" : "STAGE2_GEMINI" };
  }

  const seen = new Set<string>();
  const confirmed: ConfirmedEntity[] = [];
  for (const d of perDomain) {
    for (const c of d.candidates) {
      if (!c.key || !c.displayString) continue;
      const isSecondary = c.key.startsWith("@");
      const dedupKey = `${isSecondary ? "S" : "P"}:${c.key.toLowerCase()}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const kind: "PRIMARY" | "SECONDARY" = isSecondary ? "SECONDARY" : "PRIMARY";
      const { origin, discoveryScore } = resolveOrigin(kind, c.displayString, d.algorithm, c.meta);
      confirmed.push({
        displayLabel: c.displayString,
        identityKey: c.key,
        kind,
        secondaryTypeName: isSecondary ? "contact" : undefined,
        origin,
        discoveryScore,
      });
    }
  }

  // Augment SECONDARY entities with sender-email aliases (matches #121 logic
  // in entity-confirm/route.ts).
  const userContacts =
    (schema.stage1UserContacts as Array<{
      query: string;
      senderEmail: string | null;
    }> | null) ?? [];
  const queryToEmail = new Map<string, string>();
  for (const c of userContacts) {
    if (c.query && c.senderEmail) queryToEmail.set(c.query, c.senderEmail);
  }
  const augmented = confirmed.map((e) => {
    if (e.kind !== "SECONDARY") return e;
    let senderEmail = queryToEmail.get(e.displayLabel);
    if (!senderEmail && e.identityKey.startsWith("@")) {
      senderEmail = e.identityKey.slice(1);
    }
    return senderEmail ? { ...e, aliases: [senderEmail] } : e;
  });

  if (augmented.length === 0) {
    throw new Error(`Schema ${schemaId} has 0 Stage 2 candidates to confirm`);
  }

  // Phase 5 Part E — simulate the review-screen gate before persisting.
  // The new by-WHAT UI pre-ticks deterministic + seeded rows, leaves low-
  // signal Gemini adjacents unticked in "Also noticed," and hides spec-§5
  // violations entirely. Apply that policy here so the eval measures the
  // same acceptance set a real user would submit — not a blind accept-all.
  const userWhats = ((schema.inputs as { whats?: string[] } | null)?.whats ?? []) as string[];
  const gateSim = simulateReviewGate({ entities: augmented, userWhats });
  const toPersist = gateSim.accepted;

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.caseSchema.updateMany({
      where: { id: schemaId, phase: "AWAITING_ENTITY_CONFIRMATION" },
      data: { phase: "PROCESSING_SCAN", phaseUpdatedAt: new Date() },
    });
    if (count === 0) throw new Error("CAS lost on AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN");
    await persistConfirmedEntities(tx, schemaId, toPersist);
    await seedSchemaDefaults(tx, schemaId, schema.domain);
  });

  return {
    confirmedCount: toPersist.length,
    gateSim: {
      accepted: gateSim.accepted.length,
      rejected: gateSim.rejected.length,
      rejectedByReason: gateSim.rejectedByReason,
      verdicts: augmented.map((e) => ({
        identityKey: e.identityKey,
        displayLabel: e.displayLabel,
        verdict: gateSim.verdicts.get(e.identityKey) ?? "accepted",
      })),
    },
  };
}

function writeSynthesisReport(report: SynthesisReport): string {
  const date = report.ranAt.slice(0, 10);
  const reportDir = resolve(process.cwd(), REPORT_DIR_REL);
  mkdirSync(reportDir, { recursive: true });
  const mdPath = resolve(reportDir, `eval-onboarding-${report.schema}-full-${date}.md`);
  const csvPath = resolve(reportDir, `eval-onboarding-${report.schema}-full-${date}.csv`);

  const lines: string[] = [];
  lines.push(`# Eval Onboarding — ${report.schema} — Full Pipeline`);
  lines.push("");
  lines.push(`- **Ran at:** ${report.ranAt}`);
  lines.push(`- **Schema ID:** \`${report.schemaId}\``);
  lines.push(`- **Cache mode:** \`${report.cacheMode}\``);
  lines.push(
    `- **Timings:** discovery ${report.timings.discoveryMs} ms • extraction ${report.timings.extractionMs} ms • clustering ${report.timings.clusteringMs} ms • synthesis ${report.timings.synthesisMs} ms • total ${report.timings.totalMs} ms`,
  );
  lines.push(`- **AI cost this run:** $${report.costUsd.toFixed(4)}`);
  lines.push("");
  lines.push(`## Verdict: **${verdict(report.hard)}**`);
  lines.push("");
  lines.push(`## Scan totals`);
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Discovered emails | ${report.scan.discoveredEmails} |`);
  lines.push(`| Extracted | ${report.scan.extracted} |`);
  lines.push(`| Excluded | ${report.scan.excluded} |`);
  lines.push(`| Failed | ${report.scan.failed} |`);
  lines.push("");
  lines.push(`## Cases`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total cases | ${report.cases.total} |`);
  lines.push(
    `| Multi-email cases | ${report.cases.multiEmail} (${pctDisplay(report.cases.multiEmail, report.cases.total)}) |`,
  );
  lines.push(`| Single-email cases | ${report.cases.singleEmail} |`);
  lines.push(`| Cases with entity | ${report.cases.withEntity}/${report.cases.total} |`);
  lines.push(`| Cases with actions | ${report.cases.withActions}/${report.cases.total} |`);
  lines.push(
    `| Emails/case | min=${report.cases.minEmails} avg=${report.cases.avgEmails.toFixed(1)} max=${report.cases.maxEmails} |`,
  );
  lines.push("");
  lines.push(`## Hard assertions`);
  lines.push("");
  lines.push(`| Check | Status | Detail |`);
  lines.push(`| --- | --- | --- |`);
  for (const h of report.hard) {
    lines.push(`| ${h.label} | ${h.status} | ${h.detail ?? ""} |`);
  }
  lines.push("");
  lines.push(`## Soft expectations`);
  lines.push("");
  lines.push(`| Check | Result | Detail |`);
  lines.push(`| --- | --- | --- |`);
  for (const s of report.soft) {
    lines.push(`| ${s.label} | ${s.ratio} | ${s.detail ?? ""} |`);
  }
  lines.push("");
  lines.push(`## Predicted chip row (feed)`);
  lines.push("");
  lines.push(
    "What the feed will render at the top of this schema. User hints render first (pre-confirmed, always shown); discoveries render after, ranked by compounding-signal score then case count.",
  );
  lines.push("");
  if (report.chipRow.hints.length === 0 && report.chipRow.discoveries.length === 0) {
    lines.push("_(no active PRIMARY entities — chip row will be empty)_");
  } else {
    lines.push(`| Tier | Chip | Origin | Score | Cases |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const h of report.chipRow.hints) {
      lines.push(`| hint | ${h.name} | ${h.origin} | ${h.score ?? "—"} | ${h.caseCount} |`);
    }
    for (const d of report.chipRow.discoveries) {
      lines.push(`| discovery | ${d.name} | ${d.origin} | ${d.score ?? "—"} | ${d.caseCount} |`);
    }
  }
  lines.push("");
  lines.push(`## Off-topic cases (bleed metric)`);
  lines.push("");
  if (report.offTopicCases.length === 0) {
    lines.push(
      "_Zero off-topic cases. Every case's entity triangulates back to a user hint, per principle #5 validation feedback loop._",
    );
  } else {
    lines.push(
      `${report.offTopicCases.length} cases have entities that do NOT triangulate to a user hint. These are chip-row bleed — the discovery loop produced an entity unrelated to anything the user typed, and synthesis grouped emails under it. Review whether the entity should be rejected by §5 alias-prohibition or the user's hints need expansion.`,
    );
    lines.push("");
    lines.push(`| Case | Title | Entity | Entity origin |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const c of report.offTopicCases) {
      lines.push(
        `| \`${c.id.slice(-8)}\` | ${c.title} | ${c.entity ?? "—"} | ${c.entityOrigin ?? "—"} |`,
      );
    }
  }
  lines.push("");
  lines.push(`## Review-screen gate simulation`);
  lines.push("");
  lines.push(
    "Simulates what a real user would tick at the by-WHAT confirm screen: always-accept deterministic origins (USER_HINT, USER_SEEDED, STAGE2_SHORT_CIRCUIT, STAGE2_AGENCY_DOMAIN), conditional-accept STAGE2_GEMINI (score ≥ 1 or hint-token overlap), reject the rest.",
  );
  lines.push("");
  lines.push(`**Accepted:** ${report.gateSim.accepted} · **Rejected:** ${report.gateSim.rejected}`);
  lines.push("");
  const reasonEntries = Object.entries(report.gateSim.rejectedByReason);
  if (reasonEntries.length > 0) {
    lines.push(`| Reason | Count |`);
    lines.push(`| --- | --- |`);
    for (const [reason, count] of reasonEntries) {
      lines.push(`| \`${reason}\` | ${count} |`);
    }
  } else {
    lines.push("_No rejections._");
  }
  lines.push("");
  lines.push(`## Case-by-case`);
  lines.push("");
  lines.push(`| Case | Title | Emails | Urgency | Entity |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const c of report.caseDetails) {
    lines.push(
      `| \`${c.id.slice(-8)}\` | ${c.title ?? "—"} | ${c.emailCount} | ${c.urgency ?? "—"} | ${c.entityName ?? "—"} |`,
    );
  }

  writeFileSync(mdPath, `${lines.join("\n")}\n`);

  // CSV: per-entity gate-sim verdicts so the reviewer can see who got
  // accepted vs rejected at a glance.
  const csvLines: string[] = ["caseId,title,emailCount,urgency,entity"];
  for (const c of report.caseDetails) {
    const title = (c.title ?? "").replace(/"/g, '""');
    const entity = (c.entityName ?? "").replace(/"/g, '""');
    csvLines.push(`${c.id},"${title}",${c.emailCount},${c.urgency ?? ""},"${entity}"`);
  }
  writeFileSync(csvPath, `${csvLines.join("\n")}\n`);

  const gateSimCsvPath = csvPath.replace(/\.csv$/, "-gate-sim.csv");
  const gateLines: string[] = ["identityKey,displayLabel,verdict"];
  for (const v of report.gateSim.verdicts) {
    const label = v.displayLabel.replace(/"/g, '""');
    gateLines.push(`${v.identityKey},"${label}",${v.verdict}`);
  }
  writeFileSync(gateSimCsvPath, `${gateLines.join("\n")}\n`);

  return mdPath;
}

function pctDisplay(n: number, total: number): string {
  if (total === 0) return "—";
  return `${((n / total) * 100).toFixed(0)}%`;
}

async function runSynthesisStage(args: CliArgs): Promise<void> {
  const cfg = getEvalConfig(args.schema);
  const userId = evalUserId(cfg.schemaKey);
  const cacheMode = getCacheMode();
  const pipelineStart = Date.now();

  console.error(`\n=== EVAL ONBOARDING — SYNTHESIS (${cfg.schemaKey}) ===`);
  console.error(`  User: ${userId}`);
  console.error(`  Cache mode: ${cacheMode}`);

  // 0. Find prior schema at AWAITING_ENTITY_CONFIRMATION
  const priorSchema = await prisma.caseSchema.findFirst({
    where: { userId, domain: cfg.domain, phase: "AWAITING_ENTITY_CONFIRMATION" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!priorSchema) {
    console.error(
      `  No schema found at AWAITING_ENTITY_CONFIRMATION for ${cfg.domain}. Run --stage discovery first.`,
    );
    await prisma.$disconnect();
    process.exit(2);
  }
  const schemaId = priorSchema.id;
  console.error(`  Schema: ${schemaId}`);

  // 1. Auto-confirm + advance to PROCESSING_SCAN
  const confirmResult = await autoConfirmEntitiesAndAdvance(schemaId);
  const confirmedCount = confirmResult.confirmedCount;
  console.error(
    `  Auto-confirmed ${confirmedCount} entities (gate sim: ${confirmResult.gateSim.accepted} accepted / ${confirmResult.gateSim.rejected} rejected)`,
  );

  // 2. Load fixtures + build fixture client
  const fixturesPath = resolve(process.cwd(), FIXTURES_REL);
  const fixtures = loadFixtures(fixturesPath);
  const fixtureClient = new FixtureGmailClient(fixtures);
  console.error(`  Fixtures: ${fixtures.length}`);

  // 3. Create ScanJob
  const scanJob = await prisma.scanJob.create({
    data: {
      schemaId,
      userId,
      status: "PENDING",
      phase: "PENDING",
      triggeredBy: "ONBOARDING",
      totalEmails: 0,
    },
    select: { id: true },
  });
  console.error(`  ScanJob: ${scanJob.id}`);

  // 4. Discovery — mirror runScan's step 1
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: schemaId },
    include: {
      tags: { where: { isActive: true } },
      entities: { where: { isActive: true } },
      extractedFields: true,
      exclusionRules: { where: { isActive: true } },
      entityGroups: {
        orderBy: { index: "asc" },
        include: {
          entities: {
            where: { isActive: true },
            select: { name: true, type: true, isActive: true },
          },
        },
      },
    },
  });

  const discoveryQueries = (schema.discoveryQueries ?? []) as unknown as DiscoveryQuery[];
  const entityGroups: EntityGroupInput[] = schema.entityGroups.map((g) => ({
    whats: g.entities.filter((e) => e.type === "PRIMARY").map((e) => e.name),
    whos: g.entities.filter((e) => e.type === "SECONDARY").map((e) => e.name),
  }));
  const knownEntityNames = schema.entities.map((e) => e.name);

  const discoveryStart = Date.now();
  // runSmartDiscovery expects a concrete GmailClient; FixtureGmailClient
  // satisfies the surface it uses (searchEmails + getEmailFull). Same
  // `as any` escape hatch eval-run.ts uses — eliminating this requires
  // widening runSmartDiscovery + broadInboxScan + sampleBodies to
  // GmailClientLike, a Phase 4+ refactor.
  // biome-ignore lint/suspicious/noExplicitAny: FixtureGmailClient is structurally compatible.
  const discoveryResult = await runSmartDiscovery(
    fixtureClient as any,
    discoveryQueries,
    entityGroups,
    knownEntityNames,
    schema.domain ?? "general",
    schemaId,
    scanJob.id,
  );
  const discoveredIds = discoveryResult.emailIds;
  const discoveryMs = Date.now() - discoveryStart;
  console.error(`  Discovery: ${discoveredIds.length} emails in ${discoveryMs} ms`);

  await prisma.scanJob.update({
    where: { id: scanJob.id },
    data: {
      phase: "EXTRACTING",
      totalEmails: discoveredIds.length,
      discoveredEmailIds: discoveredIds as unknown as object,
      startedAt: new Date(),
    },
  });

  // 5. Extraction
  const schemaContext = buildSchemaContext(schema);
  const entitiesForExtraction = schema.entities
    .filter((e) => e.isActive)
    .map((e) => ({
      name: e.name,
      type: e.type as "PRIMARY" | "SECONDARY",
      aliases: Array.isArray(e.aliases) ? (e.aliases as string[]) : [],
    }));
  const exclusionRules = schema.exclusionRules;

  const extractionStart = Date.now();
  const BATCH_SIZE = 20;
  let processed = 0;
  let excluded = 0;
  let failed = 0;
  for (let i = 0; i < discoveredIds.length; i += BATCH_SIZE) {
    const batch = discoveredIds.slice(i, i + BATCH_SIZE);
    try {
      const r = await processEmailBatch(
        batch,
        "fixture",
        schemaContext,
        entitiesForExtraction,
        exclusionRules,
        { schemaId, scanJobId: scanJob.id },
        fixtureClient,
      );
      processed += r.processed;
      excluded += r.excluded;
    } catch (err) {
      failed += batch.length;
      console.error(`  BATCH FAILED: ${(err as Error).message.slice(0, 100)}`);
    }
  }
  const extractionMs = Date.now() - extractionStart;
  console.error(
    `  Extraction: ${processed} extracted, ${excluded} excluded, ${failed} failed in ${extractionMs} ms`,
  );

  // 6. Clustering
  await prisma.scanJob.update({
    where: { id: scanJob.id },
    data: { phase: "CLUSTERING" },
  });
  const clusterStart = Date.now();
  await coarseCluster(schemaId);
  await splitCoarseClusters(schemaId);
  const clusteringMs = Date.now() - clusterStart;
  console.error(`  Clustering done in ${clusteringMs} ms`);

  // 7. Synthesis
  await prisma.scanJob.update({
    where: { id: scanJob.id },
    data: { phase: "SYNTHESIZING" },
  });
  const openCases = await prisma.case.findMany({
    where: { schemaId, status: "OPEN" },
    select: { id: true },
  });
  const synthStart = Date.now();
  let synthOk = 0;
  let synthFail = 0;
  for (const c of openCases) {
    try {
      await synthesizeCase(c.id, schemaId);
      synthOk++;
    } catch (err) {
      synthFail++;
      console.error(
        `  Synth failed for case ${c.id.slice(-8)}: ${(err as Error).message.slice(0, 120)}`,
      );
    }
  }
  const synthesisMs = Date.now() - synthStart;
  console.error(
    `  Synthesis: ${synthOk}/${openCases.length} ok, ${synthFail} failed in ${synthesisMs} ms`,
  );

  // 8. Advance to COMPLETED
  await advanceSchemaPhase({
    schemaId,
    from: "PROCESSING_SCAN",
    to: "COMPLETED",
    work: async () => {
      await prisma.caseSchema.update({
        where: { id: schemaId },
        data: { status: "ACTIVE" },
      });
    },
  });
  await prisma.scanJob.update({
    where: { id: scanJob.id },
    data: { phase: "COMPLETED", status: "COMPLETED", completedAt: new Date() },
  });

  const totalMs = Date.now() - pipelineStart;

  // 9. Gather case-quality data + Phase 4 chip/bleed metrics
  const fullCases = await prisma.case.findMany({
    where: { schemaId },
    include: {
      caseEmails: { select: { emailId: true } },
      actions: { select: { id: true } },
      entity: { select: { name: true, origin: true, discoveryScore: true } },
    },
  });

  const emailsPerCase = fullCases.map((c) => c.caseEmails.length);
  const totalCaseEmails = emailsPerCase.reduce((a, b) => a + b, 0);
  const multiEmail = fullCases.filter((c) => c.caseEmails.length > 1).length;
  const singleEmail = fullCases.filter((c) => c.caseEmails.length === 1).length;
  const withEntity = fullCases.filter((c) => c.entityId).length;
  const withActions = fullCases.filter((c) => c.actions.length > 0).length;

  // Phase 4: predicted chip row — exactly what the feed API will render.
  // Entities with origin=USER_HINT come first (ground truth), then every
  // other active PRIMARY sorted by discoveryScore desc, then caseCount desc,
  // then name asc.
  const primaryEntities = await prisma.entity.findMany({
    where: { schemaId, isActive: true, type: "PRIMARY" },
    select: {
      id: true,
      name: true,
      origin: true,
      discoveryScore: true,
    },
  });
  const caseCountByEntity = new Map<string, number>();
  for (const c of fullCases) {
    if (!c.entityId) continue;
    caseCountByEntity.set(c.entityId, (caseCountByEntity.get(c.entityId) ?? 0) + 1);
  }
  const chipHintEntities = primaryEntities
    .filter((e) => e.origin === "USER_HINT")
    .map((e) => ({
      name: e.name,
      origin: e.origin,
      score: e.discoveryScore,
      caseCount: caseCountByEntity.get(e.id) ?? 0,
    }));
  const chipDiscoveryEntities = primaryEntities
    .filter((e) => e.origin !== "USER_HINT")
    .map((e) => ({
      name: e.name,
      origin: e.origin,
      score: e.discoveryScore,
      caseCount: caseCountByEntity.get(e.id) ?? 0,
    }))
    .sort((a, b) => {
      const sa = a.score ?? 0;
      const sb = b.score ?? 0;
      if (sa !== sb) return sb - sa;
      if (a.caseCount !== b.caseCount) return b.caseCount - a.caseCount;
      return a.name.localeCompare(b.name);
    });

  // Phase 4: off-topic cases (bleed metric).
  //
  // A STAGE2_GEMINI entity on a confirmed anchor domain is a LEGITIMATE
  // adjacent discovery per master-plan principle #5 — principle #5's whole
  // point is "Seeded-WHO → discovered-PRIMARY → expanded-WHO". Property's
  // 205 Freedom Trail / 3305 Cardinal are the textbook case: the user typed
  // 3 addresses, Gemini surfaced 2 more adjacents from judgefite.com's
  // subject corpus, and those should absolutely appear.
  //
  // So off-topic flags the ACTUAL bleed shape:
  //   - entity missing (orphaned case) — should never happen post-Phase-1
  //   - entity origin outside the recognised enum — data corruption
  //   - MID_SCAN origin with zero token overlap against any user hint — the
  //     deep-scan fallback created an entity for something unrelated
  //
  // Stage-2-origin entities on confirmed anchor domains are categorised as
  // "adjacent discoveries" (soft metric), NOT bleed.
  const offTopicHintTokenSets: string[][] = (cfg.interview.whats ?? [])
    .map((w) =>
      w
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter((t) => t.length >= 2),
    )
    .filter((arr) => arr.length > 0);
  function hasHintOverlap(entityName: string | null | undefined): boolean {
    if (!entityName) return false;
    const nameTokens = new Set(
      entityName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter((t) => t.length >= 2),
    );
    for (const hintTokens of offTopicHintTokenSets) {
      if (hintTokens.some((t) => nameTokens.has(t))) return true;
    }
    return false;
  }
  const ON_TOPIC_ORIGINS = new Set([
    "USER_HINT",
    "USER_SEEDED",
    "STAGE1_TRIANGULATED",
    "STAGE2_SHORT_CIRCUIT",
    "STAGE2_AGENCY_DOMAIN",
    "STAGE2_GEMINI", // adjacent discoveries on confirmed anchor domains — legit per principle #5
  ]);
  function caseIsOnTopic(
    entityName: string | null | undefined,
    entityOrigin: string | null | undefined,
  ): boolean {
    if (!entityName) return false;
    if (!entityOrigin) return false;
    if (ON_TOPIC_ORIGINS.has(entityOrigin)) return true;
    // MID_SCAN / FEEDBACK_RULE fall through — accept only with hint overlap.
    return hasHintOverlap(entityName);
  }
  const offTopicCases = fullCases
    .filter((c) => !caseIsOnTopic(c.entity?.name, c.entity?.origin))
    .map((c) => ({
      id: c.id,
      title: c.title ?? "(untitled)",
      entity: c.entity?.name ?? null,
      entityOrigin: c.entity?.origin ?? null,
    }));
  // Adjacent-discovery metric — soft/informational. These are principle-#5
  // legitimate discoveries the user didn't type but the anchor-domain
  // corpus surfaced. Zero is NOT the target — more discoveries = better
  // validation feedback loop, provided they actually pass user review.
  const adjacentDiscoveryCases = fullCases
    .filter((c) => c.entity?.origin === "STAGE2_GEMINI" && !hasHintOverlap(c.entity?.name ?? null))
    .map((c) => ({
      id: c.id,
      title: c.title ?? "(untitled)",
      entity: c.entity?.name ?? null,
    }));

  const schemaEmails = await prisma.email.findMany({
    where: { schemaId },
    select: { id: true },
  });
  const costs = await prisma.extractionCost.aggregate({
    where: { emailId: { in: schemaEmails.map((e) => e.id) } },
    _sum: { estimatedCostUsd: true },
  });
  const costUsd = costs._sum?.estimatedCostUsd ?? 0;

  // 10. Assertions
  const hard: AssertionResult[] = [];
  const soft: SoftResult[] = [];

  hard.push({
    label: "SLA: full pipeline < 5 min",
    status: totalMs < 5 * 60_000 ? "PASS" : "FAIL",
    detail: `${(totalMs / 1000).toFixed(1)} s`,
  });
  hard.push({
    label: "Synthesis: no case synthesis failures",
    status: synthFail === 0 ? "PASS" : "FAIL",
    detail: `${synthOk}/${openCases.length} ok, ${synthFail} failed`,
  });
  hard.push({
    label: "Cases produced (> 0)",
    status: fullCases.length > 0 ? "PASS" : "FAIL",
    detail: `${fullCases.length} cases`,
  });
  // Phase 4 (2026-04-23) — bleed metric. See the `caseIsOnTopic` comment
  // for the definition: a case is off-topic only when its entity origin
  // falls OUTSIDE the recognised Stage-produced enum values, OR when it's a
  // mid-scan/feedback-rule origin with no token overlap against user hints.
  // STAGE2_GEMINI entities on anchor domains are legitimate adjacent
  // discoveries (master plan §7 principle #5) — surfaced as a soft metric.
  hard.push({
    label: "Off-topic case count == 0 (bleed metric)",
    status: offTopicCases.length === 0 ? "PASS" : "FAIL",
    detail:
      offTopicCases.length === 0
        ? `${fullCases.length}/${fullCases.length} cases have recognised stage-produced entity origins`
        : `${offTopicCases.length} off-topic: ${offTopicCases
            .slice(0, 3)
            .map((c) => `"${c.entity ?? "?"}" (${c.entityOrigin ?? "null"})`)
            .join(", ")}${offTopicCases.length > 3 ? ", …" : ""}`,
  });
  // Soft metric — adjacent discoveries. Non-zero is NOT a failure; it's
  // exactly what Stage 2 is supposed to surface on a well-anchored domain.
  soft.push({
    label: "Adjacent discoveries (Stage 2 surfaced, not user-typed)",
    ratio: `${adjacentDiscoveryCases.length} cases under ${new Set(adjacentDiscoveryCases.map((c) => c.entity)).size} entities`,
    detail:
      adjacentDiscoveryCases.length > 0
        ? adjacentDiscoveryCases
            .slice(0, 3)
            .map((c) => `"${c.entity}"`)
            .join(", ")
        : "—",
  });

  const multiEmailPct = fullCases.length > 0 ? multiEmail / fullCases.length : 0;
  soft.push({
    label: "Multi-email cases ≥ 80% (master plan §10)",
    ratio: `${(multiEmailPct * 100).toFixed(0)}% (${multiEmail}/${fullCases.length})`,
    detail: multiEmailPct >= 0.8 ? "OK" : "below target",
  });
  soft.push({
    label: "Cases with entity",
    ratio: `${withEntity}/${fullCases.length}`,
  });
  soft.push({
    label: "Cases with actions",
    ratio: `${withActions}/${fullCases.length}`,
  });

  const report: SynthesisReport = {
    schema: cfg.schemaKey,
    schemaId,
    ranAt: new Date().toISOString(),
    cacheMode,
    timings: { discoveryMs, extractionMs, clusteringMs, synthesisMs, totalMs },
    scan: { discoveredEmails: discoveredIds.length, extracted: processed, excluded, failed },
    cases: {
      total: fullCases.length,
      multiEmail,
      singleEmail,
      withActions,
      withEntity,
      minEmails: emailsPerCase.length > 0 ? Math.min(...emailsPerCase) : 0,
      maxEmails: emailsPerCase.length > 0 ? Math.max(...emailsPerCase) : 0,
      avgEmails: fullCases.length > 0 ? totalCaseEmails / fullCases.length : 0,
    },
    costUsd,
    hard,
    soft,
    caseDetails: fullCases.map((c) => ({
      id: c.id,
      title: c.title,
      emailCount: c.caseEmails.length,
      urgency: c.urgency,
      entityName: c.entity?.name ?? null,
    })),
    chipRow: {
      hints: chipHintEntities,
      discoveries: chipDiscoveryEntities,
    },
    offTopicCases,
    gateSim: confirmResult.gateSim,
  };

  const reportPath = writeSynthesisReport(report);

  // 11. Console summary
  console.log("");
  console.log(`== ${cfg.schemaKey.toUpperCase()} — ${verdict(hard)} ==`);
  console.log("");
  console.log(
    `Discovered ${report.scan.discoveredEmails} emails → extracted ${report.scan.extracted} → ${report.cases.total} cases`,
  );
  console.log(`AI cost this run: $${costUsd.toFixed(4)}`);
  console.log(
    `Timings: discovery ${discoveryMs}ms • extract ${extractionMs}ms • cluster ${clusteringMs}ms • synth ${synthesisMs}ms • total ${(totalMs / 1000).toFixed(1)}s`,
  );
  console.log("");
  console.log("Hard assertions:");
  for (const h of hard) {
    console.log(
      `  ${h.status === "PASS" ? "✅" : "❌"} ${h.label}${h.detail ? ` — ${h.detail}` : ""}`,
    );
  }
  console.log("");
  console.log("Soft expectations:");
  for (const s of soft) {
    console.log(`  · ${s.label} — ${s.ratio}${s.detail ? ` (${s.detail})` : ""}`);
  }
  console.log("");
  console.log(`Report: ${reportPath}`);
  console.log(`Feed URL: http://localhost:3000/feed?schema=${schemaId}`);
  console.log("");

  await prisma.$disconnect();
  process.exit(verdict(hard) === "PASS" ? 0 : 1);
}

// ─── Entry ────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("FAILED: DATABASE_URL not set. Run from apps/web/ so .env.local is picked up.");
    process.exit(4);
  }
  const args = parseArgs();
  if (args.refreshCache) {
    process.env.AI_RESPONSE_CACHE = "record";
  }
  if (args.stage === "discovery") {
    await runDiscoveryStage(args);
  } else {
    await runSynthesisStage(args);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
