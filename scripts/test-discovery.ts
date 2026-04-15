/**
 * Discovery Test Script
 *
 * Validates that entity-scoped discovery queries produce targeted results
 * and that domain-default queries are the source of noise.
 *
 * Two modes:
 *   Mode 1 — Existing schema: reads discoveryQueries from the current CaseSchema
 *            in DB, runs each against Gmail, prints what comes back.
 *   Mode 2 — Fresh hypothesis: generates a new hypothesis via Claude with
 *            tighter test inputs, runs those queries against Gmail, compares.
 *
 * Usage:
 *   npx tsx scripts/test-discovery.ts
 *
 * Requires .env.local in apps/web with:
 *   ANTHROPIC_API_KEY, DATABASE_URL, DIRECT_URL, TOKEN_ENCRYPTION_KEY
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

// Load env vars before anything else
dotenv.config({ path: path.join(process.cwd(), "apps", "web", ".env.local") });
import { google } from "googleapis";
import { buildHypothesisPrompt, parseHypothesisResponse } from "../packages/ai/src/index";
import { CLUSTERING_TUNABLES } from "../apps/web/src/lib/config/clustering-tunables";
import type { DiscoveryQuery, InterviewInput } from "../packages/types/src/schema";

// Dynamic import of PrismaClient — resolved at runtime from apps/web's dependency tree
async function createPrisma() {
  const { pathToFileURL } = await import("node:url");
  const prismaPath = require.resolve("@prisma/client", {
    paths: [path.join(process.cwd(), "apps", "web")],
  });
  const mod = await import(pathToFileURL(prismaPath).href);
  return new mod.PrismaClient();
}

// ---------------------------------------------------------------------------
// Prisma + Anthropic setup
// ---------------------------------------------------------------------------

let prisma: any;
const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Inline token decryption (avoids @/ path alias issues)
// ---------------------------------------------------------------------------

function decryptTokens(encrypted: string): Record<string, unknown> {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  const keyBuf = Buffer.from(key, "hex");
  const [ivHex, authTagHex, data] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}

// ---------------------------------------------------------------------------
// Inline Gmail search (avoids importing GmailClient with @/ aliases)
// ---------------------------------------------------------------------------

async function searchGmail(
  accessToken: string,
  query: string,
  maxResults = 20,
): Promise<{ subject: string; sender: string; date: string }[]> {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messageIds = listRes.data.messages?.map((m) => m.id!) ?? [];
  if (messageIds.length === 0) return [];

  const results: { subject: string; sender: string; date: string }[] = [];
  for (const id of messageIds) {
    try {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      });
      const headers = msg.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value ?? "(unknown)";
      const dateStr = headers.find((h) => h.name === "Date")?.value ?? "";
      const date = dateStr ? new Date(dateStr).toISOString().split("T")[0] : "unknown";
      results.push({ subject, sender: from, date });
    } catch {
      // Skip individual message fetch failures
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Test scenarios for Mode 2
// ---------------------------------------------------------------------------

const testScenarios: { name: string; input: InterviewInput }[] = [
  {
    name: "Scenario A: Soccer + Ziad only",
    input: {
      role: "parent",
      domain: "school_parent",
      whats: ["soccer"],
      whos: ["Ziad Allan"],
      goals: ["Track practice schedules"],
    },
  },
  {
    name: "Scenario B: Schools only",
    input: {
      role: "parent",
      domain: "school_parent",
      whats: ["Lanier", "St Agnes"],
      whos: [],
      goals: ["Track school communications"],
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface QueryResult {
  query: string;
  label: string;
  source: string;
  entityName: string | null;
  emailCount: number;
  emails: { subject: string; sender: string; date: string }[];
}

async function runQuery(
  accessToken: string,
  dq: DiscoveryQuery,
  maxResults = 20,
): Promise<QueryResult> {
  try {
    const emails = await searchGmail(accessToken, dq.query, maxResults);
    return {
      query: dq.query,
      label: dq.label,
      source: dq.source,
      entityName: dq.entityName,
      emailCount: emails.length,
      emails,
    };
  } catch (error) {
    console.error(`  Query failed: "${dq.query}" — ${error}`);
    return {
      query: dq.query,
      label: dq.label,
      source: dq.source,
      entityName: dq.entityName,
      emailCount: -1,
      emails: [],
    };
  }
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in .env.local");
  }

  console.log("  Refreshing expired access token...");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Token refresh failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  console.log("  Token refreshed successfully.");
  return data.access_token;
}

async function getAccessToken(): Promise<{ token: string; userId: string }> {
  const user = await prisma.user.findFirst({
    where: { googleTokens: { not: null }, deletedAt: null },
    select: { id: true, googleTokens: true, email: true },
  });

  if (!user?.googleTokens) {
    throw new Error("No user with Gmail tokens found in DB");
  }

  console.log(`Using Gmail account: ${user.email}`);

  const tokens = decryptTokens(user.googleTokens);
  const accessToken = tokens.access_token as string;
  const refreshToken = tokens.refresh_token as string;
  const expiryDate = tokens.expiry_date as number;

  if (!accessToken) {
    throw new Error("Decrypted tokens missing access_token");
  }

  // Check if token is expired (with 5 min buffer)
  if (expiryDate && expiryDate < Date.now() + 5 * 60 * 1000) {
    if (!refreshToken) {
      throw new Error("Access token expired and no refresh token available");
    }
    const freshToken = await refreshAccessToken(refreshToken);
    return { token: freshToken, userId: user.id };
  }

  return { token: accessToken, userId: user.id };
}

// ---------------------------------------------------------------------------
// Mode 1: Existing Schema
// ---------------------------------------------------------------------------

async function runMode1(accessToken: string): Promise<string> {
  console.log("\n=== MODE 1: Existing Schema Queries ===\n");

  const schema = await prisma.caseSchema.findFirst({
    where: { status: { in: ["ACTIVE", "ONBOARDING"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      domain: true,
      discoveryQueries: true,
      emailCount: true,
      caseCount: true,
    },
  });

  if (!schema) {
    return "No active schema found.\n";
  }

  console.log(`Schema: "${schema.name}" (${schema.domain})`);
  console.log(`Emails: ${schema.emailCount}, Cases: ${schema.caseCount}`);

  const queries = schema.discoveryQueries as unknown as DiscoveryQuery[];
  if (!Array.isArray(queries) || queries.length === 0) {
    return "No discovery queries on schema.\n";
  }

  let md = `## Mode 1: Existing Schema — "${schema.name}"\n\n`;
  md += `| Query | Source | Entity | Email Count |\n`;
  md += `|---|---|---|---|\n`;

  let entityDerived = 0;
  let domainDefault = 0;
  const allEmailKeys = new Set<string>();

  for (const dq of queries) {
    console.log(`  Running: "${dq.query}" (${dq.source})...`);
    const result = await runQuery(accessToken, dq);

    md += `| \`${result.query}\` | ${result.source} | ${result.entityName ?? "—"} | ${result.emailCount} |\n`;

    if (result.source === "entity_name") entityDerived += result.emailCount;
    else domainDefault += result.emailCount;

    for (const e of result.emails) {
      allEmailKeys.add(`${e.subject}:${e.sender}:${e.date}`);
    }

    for (const e of result.emails.slice(0, 5)) {
      console.log(`    ${e.date} | ${e.sender.slice(0, 30)} | ${e.subject.slice(0, 60)}`);
    }
    if (result.emailCount > 5) {
      console.log(`    ... and ${result.emailCount - 5} more`);
    }
  }

  md += `\n**Totals:** ${allEmailKeys.size} unique emails\n`;
  md += `- Entity-derived queries: ${entityDerived} emails\n`;
  md += `- Domain-default queries: ${domainDefault} emails\n`;

  console.log(`\nTotals: ${allEmailKeys.size} unique, entity=${entityDerived}, domain-default=${domainDefault}`);

  return md;
}

// ---------------------------------------------------------------------------
// Mode 2: Fresh Hypothesis
// ---------------------------------------------------------------------------

async function runMode2(accessToken: string): Promise<string> {
  console.log("\n=== MODE 2: Fresh Hypothesis Queries ===\n");

  let md = "";

  for (const scenario of testScenarios) {
    console.log(`\n--- ${scenario.name} ---`);
    console.log(`  whats: [${scenario.input.whats.join(", ")}]`);
    console.log(`  whos: [${scenario.input.whos.join(", ")}]`);

    // Generate hypothesis via Claude
    const prompt = buildHypothesisPrompt(scenario.input, CLUSTERING_TUNABLES);
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const content = textBlock && "text" in textBlock ? textBlock.text : "";
    const hypothesis = parseHypothesisResponse(content);

    console.log(`  Generated ${hypothesis.discoveryQueries.length} discovery queries:`);
    for (const dq of hypothesis.discoveryQueries) {
      console.log(`    [${dq.source}] ${dq.query} → entity: ${dq.entityName ?? "none"}`);
    }

    // Flag domain_default queries
    const domainDefaults = hypothesis.discoveryQueries.filter((q) => q.source === "domain_default");
    if (domainDefaults.length > 0) {
      console.log(`  WARNING: ${domainDefaults.length} domain-default queries found (noise source):`);
      for (const dq of domainDefaults) {
        console.log(`    - "${dq.query}"`);
      }
    } else {
      console.log(`  OK: No domain-default queries (prompt fix working)`);
    }

    md += `### ${scenario.name}\n\n`;
    md += `**Input:** whats=[${scenario.input.whats.join(", ")}], whos=[${scenario.input.whos.join(", ")}]\n\n`;
    md += `| Query | Source | Entity | Email Count |\n`;
    md += `|---|---|---|---|\n`;

    let entityDerived = 0;
    let domainDefault = 0;

    for (const dq of hypothesis.discoveryQueries) {
      console.log(`  Running: "${dq.query}" (${dq.source})...`);
      const result = await runQuery(accessToken, dq);

      md += `| \`${result.query}\` | ${result.source} | ${result.entityName ?? "—"} | ${result.emailCount} |\n`;

      if (result.source === "entity_name") entityDerived += result.emailCount;
      else domainDefault += result.emailCount;

      for (const e of result.emails.slice(0, 3)) {
        console.log(`    ${e.date} | ${e.sender.slice(0, 30)} | ${e.subject.slice(0, 60)}`);
      }
    }

    md += `\n**Entity-derived:** ${entityDerived} emails | **Domain-default:** ${domainDefault} emails\n\n`;
    console.log(`  Entity: ${entityDerived}, Domain-default: ${domainDefault}`);
  }

  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Discovery Test Script");
  console.log("=====================\n");

  prisma = await createPrisma();

  const { token: accessToken } = await getAccessToken();

  const mode1Result = await runMode1(accessToken);
  const mode2Result = await runMode2(accessToken);

  // Write markdown report
  const date = new Date().toISOString().split("T")[0];
  let md = `# Discovery Test Results\n\n`;
  md += `**Date:** ${date}\n`;
  md += `**Purpose:** Validate that domain-default queries cause noise, entity-scoped queries are targeted.\n\n`;
  md += mode1Result;
  md += `\n---\n\n`;
  md += `## Mode 2: Fresh Hypothesis (after prompt changes)\n\n`;
  md += mode2Result;

  const outPath = path.join(process.cwd(), "docs", "test-results", "discovery-test.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  console.log(`\nReport saved to ${outPath}`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
