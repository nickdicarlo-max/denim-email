/**
 * Alias Detection Test Script
 *
 * Tests the production validation prompt (with alias detection + grounding)
 * against real email data. Uses the same buildValidationPrompt and
 * parseValidationResponse as production, plus the post-parse grounding filter.
 *
 * Usage:
 *   npx tsx scripts/test-alias-detection.ts                    # most recent schema
 *   npx tsx scripts/test-alias-detection.ts cmmpb334b0001qeg0  # specific schema
 *
 * Requires apps/web/.env.local with:
 *   ANTHROPIC_API_KEY, DATABASE_URL, DIRECT_URL, TOKEN_ENCRYPTION_KEY,
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */

import * as crypto from "node:crypto";
import * as path from "node:path";
import * as dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

// Load env vars before anything else
dotenv.config({ path: path.join(process.cwd(), "apps", "web", ".env.local") });
import { google } from "googleapis";
import {
  buildValidationPrompt,
  parseValidationResponse,
  type EntityGroupContext,
} from "../packages/ai/src/index";

// ---------------------------------------------------------------------------
// Prisma setup (import from custom output path)
// ---------------------------------------------------------------------------

let prisma: any;

async function createPrisma() {
  const { pathToFileURL } = await import("node:url");

  // Prisma 7.x requires an adapter — import PrismaPg
  const adapterPath = require.resolve("@prisma/adapter-pg", {
    paths: [path.join(process.cwd(), "apps", "web")],
  });
  const adapterMod = await import(pathToFileURL(adapterPath).href);
  const PrismaPg = adapterMod.PrismaPg;

  // Prisma 7.x generates TS files to custom output: apps/web/prisma/generated/prisma/client
  const clientPath = path.join(
    process.cwd(),
    "apps",
    "web",
    "prisma",
    "generated",
    "prisma",
    "client",
    "client.ts",
  );
  const mod = await import(pathToFileURL(clientPath).href);

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  return new mod.PrismaClient({ adapter });
}

// ---------------------------------------------------------------------------
// Anthropic setup
// ---------------------------------------------------------------------------

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Inline token decryption (same as test-discovery.ts)
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
// Gmail token management
// ---------------------------------------------------------------------------

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
// Gmail email fetching
// ---------------------------------------------------------------------------

interface EmailSample {
  subject: string;
  senderDomain: string;
  senderName: string;
  snippet: string;
}

interface DiscoveryQuery {
  query: string;
  label: string;
  source: string;
  entityName: string | null;
}

async function fetchEmailSamples(
  accessToken: string,
  discoveryQueries: DiscoveryQuery[],
  maxPerQuery: number = 30,
): Promise<EmailSample[]> {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const seenIds = new Set<string>();
  const results: EmailSample[] = [];

  for (const dq of discoveryQueries) {
    console.log(`  Query: "${dq.query}" (${dq.label})...`);
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: dq.query,
      maxResults: maxPerQuery,
    });

    const messageIds = (listRes.data.messages ?? [])
      .map((m) => m.id!)
      .filter((id) => !seenIds.has(id));

    for (const id of messageIds) {
      seenIds.add(id);
      try {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "Subject"],
        });
        const headers = msg.data.payload?.headers ?? [];
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
        const from = headers.find((h) => h.name === "From")?.value ?? "(unknown)";
        const snippet = msg.data.snippet ?? "";

        const emailMatch = from.match(/<([^>]+)>/);
        const email = emailMatch ? emailMatch[1] : from;
        const domain = email.includes("@") ? email.split("@")[1] : "unknown";
        const name = emailMatch ? from.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "") : email;

        results.push({
          subject,
          senderDomain: domain,
          senderName: name || email,
          snippet,
        });
      } catch {
        // Skip individual message fetch failures
      }
    }

    console.log(`    ${messageIds.length} new emails (${results.length} total)`);
  }

  console.log(`  Fetched ${results.length} unique email samples across ${discoveryQueries.length} queries.`);
  return results;
}

// Production prompt and parser are now used directly — no duplicated code

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Alias Detection Test Script");
  console.log("===========================\n");

  const schemaIdArg = process.argv[2];

  prisma = await createPrisma();

  // Step 1: Load schema + entity groups
  console.log("Step 1: Loading schema from database...");
  const schema = await prisma.caseSchema.findFirst({
    where: schemaIdArg
      ? { id: schemaIdArg }
      : { status: { in: ["ACTIVE", "ONBOARDING"] } },
    orderBy: { createdAt: "desc" },
    include: {
      entities: { include: { group: true } },
      tags: true,
      entityGroups: { include: { entities: true } },
    },
  });

  if (!schema) {
    throw new Error(
      schemaIdArg
        ? `Schema ${schemaIdArg} not found`
        : "No ACTIVE or ONBOARDING schema found",
    );
  }

  const hypothesis = schema.rawHypothesis as any;
  if (!hypothesis) {
    throw new Error(`Schema ${schema.id} has no rawHypothesis stored`);
  }

  console.log(`  Schema: "${schema.name}" (${schema.domain})`);
  console.log(`  ID: ${schema.id}`);
  console.log(`  Entities: ${schema.entities.length}`);
  console.log(`  Entity Groups: ${schema.entityGroups.length}`);

  // Print entity groups for context
  for (const group of schema.entityGroups) {
    const names = group.entities.map((e: any) => `${e.name} (${e.type})`).join(" + ");
    console.log(`    Group ${group.index + 1}: ${names}`);
  }

  // Step 2: Fetch email samples via Gmail using discovery queries
  console.log("\nStep 2: Fetching email samples from Gmail (using discovery queries)...");
  const queries = (hypothesis.discoveryQueries ?? []) as DiscoveryQuery[];
  if (queries.length === 0) {
    throw new Error("Schema hypothesis has no discoveryQueries — cannot fetch targeted emails");
  }
  console.log(`  ${queries.length} discovery queries found`);
  const { token: accessToken } = await getAccessToken();
  const emailSamples = await fetchEmailSamples(accessToken, queries, 30);

  if (emailSamples.length === 0) {
    throw new Error("No emails fetched — cannot run validation");
  }

  // Step 3: Build prompt using PRODUCTION buildValidationPrompt
  console.log("\nStep 3: Building production validation prompt...");
  const entityGroups: EntityGroupContext[] = schema.entityGroups.map((g: any) => ({
    index: g.index,
    primaryNames: g.entities.filter((e: any) => e.type === "PRIMARY").map((e: any) => e.name),
    secondaryNames: g.entities.filter((e: any) => e.type === "SECONDARY").map((e: any) => e.name),
  }));

  const prompt = buildValidationPrompt(hypothesis, emailSamples, entityGroups);

  // Print prompt size for debugging
  console.log(`  System prompt: ${prompt.system.length} chars`);
  console.log(`  User prompt: ${prompt.user.length} chars`);

  // Step 4: Call Claude
  console.log("\nStep 4: Calling Claude (this may take 30-60 seconds)...");
  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });

  const latencyMs = Date.now() - startTime;
  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock && "text" in textBlock ? textBlock.text : "";

  console.log(`  Response received in ${(latencyMs / 1000).toFixed(1)}s`);
  console.log(`  Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);

  // Parse response using PRODUCTION parser
  let result: ReturnType<typeof parseValidationResponse>;
  try {
    result = parseValidationResponse(content);
  } catch (error) {
    console.error("\nFailed to parse Claude response. Raw output:\n");
    console.error(content);
    throw error;
  }

  // Apply the same grounding filter as production (interview.ts)
  const totalSamples = emailSamples.length;
  const preFilterCount = result.discoveredEntities.length;
  result.discoveredEntities = result.discoveredEntities.filter((entity) => {
    if (entity.emailIndices.length === 0) {
      console.log(`  FILTERED (no indices): "${entity.name}" (claimed ${entity.emailCount} emails)`);
      return false;
    }
    const validIndices = entity.emailIndices.filter((idx) => idx >= 1 && idx <= totalSamples);
    if (validIndices.length === 0) {
      console.log(`  FILTERED (invalid indices): "${entity.name}" indices=${JSON.stringify(entity.emailIndices)} max=${totalSamples}`);
      return false;
    }
    entity.emailIndices = validIndices;
    entity.emailCount = validIndices.length;
    return true;
  });
  const filteredCount = preFilterCount - result.discoveredEntities.length;
  if (filteredCount > 0) {
    console.log(`  Grounding filter removed ${filteredCount} hallucinated entities`);
  }

  // Step 5: Print results
  console.log("\n=== ALIAS DETECTION RESULTS ===\n");

  // Section 1: Confirmed entities
  console.log("CONFIRMED ENTITIES:");
  for (const name of result.confirmedEntities) {
    console.log(`  \u2713 ${name}`);
  }

  // Section 2: Discovered entities WITH alias detection + grounding
  console.log("\nDISCOVERED ENTITIES (grounded):");
  for (const entity of result.discoveredEntities) {
    if (entity.likelyAliasOf) {
      console.log(
        `  \uD83D\uDD17 "${entity.name}" \u2192 ALIAS OF "${entity.likelyAliasOf}" (confidence: ${entity.aliasConfidence})`,
      );
      console.log(`     Reason: ${entity.aliasReason}`);
      console.log(`     Emails: ${entity.emailCount} [indices: ${entity.emailIndices.join(", ")}]`);
    } else {
      console.log(
        `  \uD83C\uDD95 "${entity.name}" (${entity.type}, confidence: ${entity.confidence})`,
      );
      console.log(`     Emails: ${entity.emailCount} [indices: ${entity.emailIndices.join(", ")}]`);
    }
  }

  // Section 3: Noise patterns
  if (result.noisePatterns.length > 0) {
    console.log("\nNOISE PATTERNS:");
    for (const pattern of result.noisePatterns) {
      console.log(`  \uD83D\uDEAB ${pattern}`);
    }
  }

  // Section 4: Summary stats
  const aliased = result.discoveredEntities.filter((e) => e.likelyAliasOf);
  const genuinelyNew = result.discoveredEntities.filter((e) => !e.likelyAliasOf);

  console.log(
    `\nSUMMARY: ${aliased.length} aliases detected, ${genuinelyNew.length} genuinely new entities`,
  );
  console.log(`Confidence score: ${result.confidenceScore}`);

  // Detailed alias breakdown by target entity
  if (aliased.length > 0) {
    console.log("\nALIAS BREAKDOWN BY TARGET:");
    const byTarget = new Map<string, typeof aliased>();
    for (const a of aliased) {
      const existing = byTarget.get(a.likelyAliasOf!) ?? [];
      existing.push(a);
      byTarget.set(a.likelyAliasOf!, existing);
    }
    for (const [target, aliases] of byTarget) {
      console.log(`  ${target}:`);
      for (const a of aliases) {
        console.log(`    - "${a.name}" (confidence: ${a.aliasConfidence})`);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma?.$disconnect());
