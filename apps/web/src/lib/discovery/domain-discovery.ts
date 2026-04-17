/**
 * Fast-discovery Stage 1 orchestrator (issue #95).
 *
 * Composes three primitives:
 *   1. `buildStage1Query` — turns a domain's keyword list into a Gmail query.
 *   2. `fetchFromHeaders` — metadata-only batch fetch of `From` headers.
 *   3. `aggregateDomains` — counts + ranks non-public non-self sender domains.
 *
 * Consumed by the onboarding Function A flow. Returns the query it used so
 * tests and admin tooling can reproduce the Gmail call deterministically.
 */

import { type DomainName, getDomainShape } from "@/lib/config/domain-shapes";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import { aggregateDomains, type DomainCandidate } from "./domain-aggregator";
import { fetchFromHeaders } from "./gmail-metadata-fetch";

export function buildStage1Query(domain: DomainName, lookbackDays: number): string {
  const shape = getDomainShape(domain);
  const quoted = shape.stage1Keywords.map((k) => `"${k}"`).join(" OR ");
  return `subject:(${quoted}) -category:promotions newer_than:${lookbackDays}d`;
}

export interface DiscoverDomainsInput {
  gmailClient: Parameters<typeof fetchFromHeaders>[0];
  domain: DomainName;
  userDomain: string;
}

export interface DiscoverDomainsOutput {
  candidates: DomainCandidate[];
  messagesSeen: number;
  queryUsed: string;
  errorCount: number;
}

export async function discoverDomains(
  input: DiscoverDomainsInput,
): Promise<DiscoverDomainsOutput> {
  const shape = getDomainShape(input.domain);
  const query = buildStage1Query(input.domain, ONBOARDING_TUNABLES.stage1.lookbackDays);
  const fetched = await fetchFromHeaders(
    input.gmailClient,
    query,
    ONBOARDING_TUNABLES.stage1.maxMessages,
  );
  const candidates = aggregateDomains(fetched.results, {
    userDomain: input.userDomain,
    topN: shape.stage1TopN,
  });
  return {
    candidates,
    messagesSeen: fetched.results.length,
    queryUsed: query,
    errorCount: fetched.errorCount,
  };
}
