/**
 * Discovery — runs schema discovery queries against Gmail with safety limits.
 *
 * Two hard limits enforced:
 * 1. Time window: only emails from the last 8 weeks (newer_than:8w)
 * 2. Total cap: never more than MAX_DISCOVERY_EMAILS total (default 200)
 *
 * Hybrid discovery flow:
 * Phase A: Broad metadata scan (lightweight, no AI calls)
 * Phase B: Social graph analysis (from co-recipients)
 * Phase C: Body sampling for unclassified domains
 * Phase D: AI-driven query generation
 * Phase E: Targeted fetch with merged queries
 */

import type { BodySample, SenderPattern, SocialCluster } from "@denim/ai";
import { buildDiscoveryIntelligencePrompt, parseDiscoveryIntelligenceResponse } from "@denim/ai";
import type { EntityGroupInput } from "@denim/types";
import pLimit from "p-limit";
import { callClaude } from "@/lib/ai/client";
import { logAICost } from "@/lib/ai/cost-tracker";
import type { GmailClient } from "@/lib/gmail/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";

/** Strip markdown code fences from AI response. */
function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

const BROAD_SCAN_LIMIT = 200;
const BODY_SAMPLE_COUNT = 3;

interface DiscoveryQuery {
  query: string;
  label: string;
}

interface DiscoveryResult {
  emailIds: string[];
  queriesRun: number;
  queriesSkipped: number;
  cappedAt: number;
}

interface SmartDiscoveryResult extends DiscoveryResult {
  aiQueriesGenerated: number;
  senderPatternsFound: number;
  socialClustersFound: number;
}

/**
 * Run discovery queries against Gmail and return deduplicated message IDs.
 * Appends `newer_than:8w` to every query and stops once 200 total IDs are collected.
 */
export async function runDiscoveryQueries(
  gmailClient: GmailClient,
  queries: DiscoveryQuery[],
  options?: { maxEmails?: number; lookback?: string },
): Promise<DiscoveryResult> {
  const maxEmails = options?.maxEmails ?? ONBOARDING_TUNABLES.discovery.maxTotalEmails;
  const lookback = options?.lookback ?? ONBOARDING_TUNABLES.discovery.lookback;
  const allMessageIds = new Set<string>();
  let queriesRun = 0;
  let queriesSkipped = 0;

  // Run queries in parallel with bounded concurrency. Gmail API calls are
  // independent per query; the `remaining` check is non-atomic but cheap over-fetch
  // is trimmed by the final Set size + cap. Dedup preserved via the shared Set.
  const limit = pLimit(3);
  await Promise.all(
    queries.map(({ query }) =>
      limit(async () => {
        if (allMessageIds.size >= maxEmails) {
          queriesSkipped++;
          return;
        }

        // Remaining capacity at the time this query starts (best-effort under concurrency).
        const remaining = maxEmails - allMessageIds.size;

        // Append time window to every query
        const scopedQuery = `${query} newer_than:${lookback}`;

        const messages = await gmailClient.searchEmails(scopedQuery, remaining);
        for (const msg of messages) {
          if (allMessageIds.size >= maxEmails) break;
          allMessageIds.add(msg.id);
        }
        queriesRun++;
      }),
    ),
  );

  // Trim any incidental over-fetch from concurrent queries.
  const emailIds = Array.from(allMessageIds).slice(0, maxEmails);

  logger.info({
    service: "discovery",
    operation: "runDiscoveryQueries",
    totalQueries: queries.length,
    queriesRun,
    queriesSkipped,
    emailCount: emailIds.length,
    maxEmails,
    lookback,
  });

  return { emailIds, queriesRun, queriesSkipped, cappedAt: maxEmails };
}

/**
 * Phase A: Broad metadata scan — fetch recent email metadata (lightweight).
 * searchEmails already returns metadata (subject, sender, recipients, etc).
 * Groups by sender domain/name, returns frequency map.
 */
export async function broadInboxScan(
  gmailClient: GmailClient,
  limit: number = BROAD_SCAN_LIMIT,
): Promise<{
  senderPatterns: SenderPattern[];
  metadata: Array<{
    id: string;
    subject: string;
    senderEmail: string;
    senderDisplayName: string;
    domain: string;
    recipients: string[];
  }>;
}> {
  // searchEmails returns GmailMessageMeta which includes all the fields we need
  const messages = await gmailClient.searchEmails(`newer_than:${ONBOARDING_TUNABLES.discovery.lookback}`, limit);

  const metadata = messages.map((msg) => ({
    id: msg.id,
    subject: msg.subject,
    senderEmail: msg.senderEmail,
    senderDisplayName: msg.senderDisplayName,
    domain: msg.senderDomain,
    recipients: msg.recipients,
  }));

  // Group by sender
  const senderCounts = new Map<string, SenderPattern>();
  for (const m of metadata) {
    const key = m.senderEmail.toLowerCase();
    const existing = senderCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      senderCounts.set(key, {
        senderEmail: m.senderEmail,
        senderDisplayName: m.senderDisplayName,
        domain: m.domain,
        count: 1,
      });
    }
  }

  // Sort by count descending
  const senderPatterns = Array.from(senderCounts.values()).sort((a, b) => b.count - a.count);

  logger.info({
    service: "discovery",
    operation: "broadInboxScan",
    messagesScanned: metadata.length,
    uniqueSenders: senderPatterns.length,
  });

  return { senderPatterns, metadata };
}

/**
 * Phase B: Build social graph from co-recipients of known entities.
 */
export function buildSocialGraph(
  metadata: Array<{
    senderEmail: string;
    senderDisplayName: string;
    domain: string;
    recipients: string[];
  }>,
  knownEntityNames: string[],
): SocialCluster[] {
  const clusters: SocialCluster[] = [];
  const knownNamesLower = new Set(knownEntityNames.map((n) => n.toLowerCase()));

  // Find senders that match known entity names
  const entitySenders = metadata.filter((m) => {
    const nameLower = m.senderDisplayName.toLowerCase();
    return (
      knownNamesLower.has(nameLower) ||
      knownEntityNames.some((n) => nameLower.includes(n.toLowerCase()))
    );
  });

  // Group by sender and collect co-recipients
  const senderMap = new Map<
    string,
    { entityName: string | null; recipients: Set<string>; domains: Set<string> }
  >();

  for (const m of entitySenders) {
    const key = m.senderEmail.toLowerCase();
    const existing = senderMap.get(key);
    if (existing) {
      for (const r of m.recipients) {
        existing.recipients.add(r);
        const domain = r.split("@")[1];
        if (domain) existing.domains.add(domain);
      }
    } else {
      const matchedEntity = knownEntityNames.find((n) =>
        m.senderDisplayName.toLowerCase().includes(n.toLowerCase()),
      );
      senderMap.set(key, {
        entityName: matchedEntity ?? null,
        recipients: new Set(m.recipients),
        domains: new Set(m.recipients.map((r) => r.split("@")[1]).filter(Boolean) as string[]),
      });
    }
  }

  for (const [sender, data] of senderMap) {
    clusters.push({
      primarySender: sender,
      entityName: data.entityName,
      coRecipients: Array.from(data.recipients).slice(0, 20),
      recipientDomains: Array.from(data.domains),
    });
  }

  return clusters;
}

/**
 * Phase C: Sample email bodies from unclassified high-frequency domains.
 */
export async function sampleBodies(
  gmailClient: GmailClient,
  unknownDomains: string[],
  sampleSize: number = BODY_SAMPLE_COUNT,
): Promise<BodySample[]> {
  const samples: BodySample[] = [];

  for (const domain of unknownDomains.slice(0, 5)) {
    try {
      const messages = await gmailClient.searchEmails(
        `from:${domain} newer_than:${ONBOARDING_TUNABLES.discovery.lookback}`,
        sampleSize,
      );

      for (const msg of messages.slice(0, sampleSize)) {
        try {
          const full = await gmailClient.getEmailFullWithPacing(msg.id, 100);
          // Create a brief summary (first 200 chars of body)
          const bodyPreview = full.body.slice(0, 300).replace(/\n+/g, " ").trim();
          samples.push({
            domain,
            senderDisplayName: full.senderDisplayName,
            subject: full.subject,
            summary: bodyPreview,
          });
        } catch {
          // Skip failed fetches
        }
      }
    } catch {
      // Skip failed domain searches
    }
  }

  return samples;
}

/**
 * Phase D: AI-driven query generation.
 * Claude analyzes patterns and generates targeted Gmail queries.
 */
export async function generateSmartQueries(
  senderPatterns: SenderPattern[],
  socialClusters: SocialCluster[],
  bodySamples: BodySample[],
  entityGroups: EntityGroupInput[],
  domain: string,
  existingQueries: DiscoveryQuery[],
  schemaId: string,
  scanJobId?: string,
): Promise<{ query: string; reason: string; entityName: string | null }[]> {
  try {
    const input = {
      domain,
      entityGroups,
      senderPatterns: senderPatterns.slice(0, 30),
      socialClusters,
      bodySamples,
      existingQueries,
    };

    const prompt = buildDiscoveryIntelligencePrompt(input);

    const aiResult = await callClaude({
      model: "claude-sonnet-4-6",
      system: prompt.system,
      user: prompt.user,
      maxTokens: 2048,
      schemaId,
      operation: "discovery-intelligence",
    });

    // Parse AI response with Zod validation
    const parsed = parseDiscoveryIntelligenceResponse(aiResult.content);

    // Store in PipelineIntelligence
    await prisma.pipelineIntelligence.create({
      data: {
        schemaId,
        scanJobId,
        stage: "discovery",
        input: {
          senderPatternCount: senderPatterns.length,
          socialClusterCount: socialClusters.length,
          bodySampleCount: bodySamples.length,
        } as any,
        output: parsed as any,
        model: "claude-sonnet-4-6",
        tokenCount: aiResult.inputTokens + aiResult.outputTokens,
      },
    });

    // Log cost
    await logAICost(
      {
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        latencyMs: aiResult.latencyMs,
      },
      {
        emailId: "discovery", // No specific email — use placeholder
        scanJobId,
        model: "claude-sonnet-4-6",
        operation: "discovery-intelligence",
      },
    );

    logger.info({
      service: "discovery",
      operation: "generateSmartQueries",
      schemaId,
      queriesGenerated: parsed.relevantQueries.length,
      excludeDomains: parsed.excludeDomains.length,
    });

    return parsed.relevantQueries;
  } catch (error) {
    logger.error({
      service: "discovery",
      operation: "generateSmartQueries.error",
      schemaId,
      error,
    });
    return []; // Fallback: no additional queries
  }
}

/**
 * Run hybrid discovery: broad scan → social graph → body sampling → AI queries → targeted fetch.
 * Falls back to standard hypothesis queries if any phase fails.
 */
export async function runSmartDiscovery(
  gmailClient: GmailClient,
  hypothesisQueries: DiscoveryQuery[],
  entityGroups: EntityGroupInput[],
  knownEntityNames: string[],
  domain: string,
  schemaId: string,
  scanJobId?: string,
): Promise<SmartDiscoveryResult> {
  // Phase A: Broad metadata scan
  let senderPatterns: SenderPattern[] = [];
  let socialClusters: SocialCluster[] = [];
  let bodySamples: BodySample[] = [];
  let aiQueriesGenerated = 0;

  try {
    const scanResult = await broadInboxScan(gmailClient, BROAD_SCAN_LIMIT);
    senderPatterns = scanResult.senderPatterns;

    // Phase B: Social graph
    socialClusters = buildSocialGraph(scanResult.metadata, knownEntityNames);

    // Phase C: Body sampling for unknown high-frequency domains
    const knownDomains = new Set(
      hypothesisQueries
        .map((q) => {
          const match = q.query.match(/from:(\S+)/);
          return match?.[1]?.toLowerCase();
        })
        .filter(Boolean) as string[],
    );
    // Noise domains to skip
    const noiseDomains = new Set([
      "gmail.com",
      "google.com",
      "googlemail.com",
      "yahoo.com",
      "hotmail.com",
      "outlook.com",
      "github.com",
      "linkedin.com",
      "facebook.com",
      "twitter.com",
      "noreply.com",
      "notification.com",
    ]);

    const unknownDomains = senderPatterns
      .filter(
        (s) =>
          s.count >= 3 &&
          !knownDomains.has(s.domain.toLowerCase()) &&
          !noiseDomains.has(s.domain.toLowerCase()),
      )
      .map((s) => s.domain)
      .slice(0, 5);

    if (unknownDomains.length > 0) {
      bodySamples = await sampleBodies(gmailClient, unknownDomains);
    }

    // Phase D: AI-driven query generation
    const smartQueries = await generateSmartQueries(
      senderPatterns,
      socialClusters,
      bodySamples,
      entityGroups,
      domain,
      hypothesisQueries,
      schemaId,
      scanJobId,
    );
    aiQueriesGenerated = smartQueries.length;

    // Phase E: Merge queries and run targeted fetch
    const allQueries: DiscoveryQuery[] = [
      ...hypothesisQueries,
      ...smartQueries.map((q) => ({
        query: q.query,
        label: q.reason,
      })),
    ];

    const result = await runDiscoveryQueries(gmailClient, allQueries);

    return {
      ...result,
      aiQueriesGenerated,
      senderPatternsFound: senderPatterns.length,
      socialClustersFound: socialClusters.length,
    };
  } catch (error) {
    logger.error({
      service: "discovery",
      operation: "runSmartDiscovery.error",
      schemaId,
      error,
    });

    // Fallback to standard hypothesis queries
    const result = await runDiscoveryQueries(gmailClient, hypothesisQueries);
    return {
      ...result,
      aiQueriesGenerated: 0,
      senderPatternsFound: senderPatterns.length,
      socialClustersFound: socialClusters.length,
    };
  }
}
