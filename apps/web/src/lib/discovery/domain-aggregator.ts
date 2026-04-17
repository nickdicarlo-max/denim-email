import { isPublicProvider } from "./public-providers";
import type { FromHeaderResult } from "./gmail-metadata-fetch";

export interface DomainCandidate {
  domain: string;
  count: number;
}

export interface AggregateOptions {
  userDomain: string;
  topN: number;
}

function extractDomain(fromHeader: string): string {
  const addr = fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader;
  const at = addr.indexOf("@");
  if (at < 0) return "";
  return addr.slice(at + 1).trim().toLowerCase();
}

export function aggregateDomains(
  rows: FromHeaderResult[],
  opts: AggregateOptions,
): DomainCandidate[] {
  const userDomain = opts.userDomain.toLowerCase();
  const counts = new Map<string, number>();

  for (const row of rows) {
    const domain = extractDomain(row.fromHeader);
    if (!domain) continue;
    if (isPublicProvider(domain)) continue;
    if (domain === userDomain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, opts.topN);
}
