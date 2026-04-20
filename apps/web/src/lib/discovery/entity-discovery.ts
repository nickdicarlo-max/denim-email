/**
 * Stage 2 entity discovery dispatcher (issue #95 Task 2.5).
 *
 * Given a Stage-1-confirmed domain and the schema's domain shape, fan out
 * Gmail metadata fetches for that domain's recent mail, then dispatch to
 * the domain-specific Stage 2 algorithm (property / school_parent / agency).
 * Returns a uniform `DiscoverEntitiesOutput` regardless of algorithm so the
 * Inngest wrapper can persist results with one writer.
 *
 * Errors per-message are counted (so a few bad fetches don't kill the
 * whole pass) but not rethrown. Top-level failures (Gmail auth, whole
 * search failing) surface to the caller.
 */
import { type DomainName, getDomainShape } from "@/lib/config/domain-shapes";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import type { GmailClient } from "@/lib/gmail/client";
import { deriveAgencyEntity } from "./agency-entity";
import { extractPropertyCandidates } from "./property-entity";
import { extractSchoolCandidates } from "./school-entity";

export interface DiscoverEntitiesInput {
  gmailClient: GmailClient;
  schemaDomain: DomainName;
  confirmedDomain: string;
  /**
   * #102: Stage 1 paired-WHO → senderEmail mappings for school_parent
   * Pattern C narrow-view scoping. Ignored by property / agency shapes.
   */
  pairedWhoAddresses?: Array<{
    senderEmail: string;
    pairedWhat: string;
    pairedWho: string;
  }>;
}

export interface EntityCandidate {
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  /** Opaque domain-specific metadata: { pattern: "A"|"B" } for school,
   *  { authoritativeDomain, derivedVia, needsUserEdit } for agency. */
  meta?: Record<string, unknown>;
}

export interface DiscoverEntitiesOutput {
  algorithm: string;
  candidates: EntityCandidate[];
  subjectsScanned: number;
  errorCount: number;
}

interface SubjectRow {
  subject: string;
  /** Bare sender email parsed from the `From` header (lowercased). */
  senderEmail: string;
}

function parseSenderEmail(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = fromHeader.match(/[^\s<>]+@[^\s<>]+/);
  return bare ? bare[0].toLowerCase() : "";
}

async function fetchSubjectsAndDisplayNames(
  client: GmailClient,
  confirmedDomain: string,
): Promise<{ rows: SubjectRow[]; displayNames: string[]; errorCount: number }> {
  // Stage 2 reuses stage1 lookback + batch size; only maxMessagesPerDomain
  // is stage2-specific (see onboarding-tunables.ts file-level comment).
  const q = `from:*@${confirmedDomain} newer_than:${ONBOARDING_TUNABLES.stage1.lookbackDays}d`;
  const ids = await client.listMessageIds(q, ONBOARDING_TUNABLES.stage2.maxMessagesPerDomain);
  const rows: SubjectRow[] = [];
  const displayNames: string[] = [];
  let errorCount = 0;

  const batchSize = ONBOARDING_TUNABLES.stage1.fetchBatchSize;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const fetched = await Promise.all(
      batch.map(async (id) => {
        try {
          return await client.getMessageMetadata(id, ["Subject", "From"]);
        } catch {
          errorCount++;
          return null;
        }
      }),
    );
    for (const row of fetched) {
      if (!row) continue;
      const s = row.payload.headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const f = row.payload.headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      if (s) rows.push({ subject: s, senderEmail: parseSenderEmail(f) });
      if (f) displayNames.push(f.replace(/<[^>]+>/, "").trim());
    }
  }
  return { rows, displayNames, errorCount };
}

export async function discoverEntitiesForDomain(
  input: DiscoverEntitiesInput,
): Promise<DiscoverEntitiesOutput> {
  const shape = getDomainShape(input.schemaDomain);
  const { rows, displayNames, errorCount } = await fetchSubjectsAndDisplayNames(
    input.gmailClient,
    input.confirmedDomain,
  );
  const subjectsScanned = rows.length;

  switch (shape.stage2Algorithm) {
    case "property-address": {
      const candidates = extractPropertyCandidates(
        rows.map((r) => ({ subject: r.subject, frequency: 1 })),
      );
      return {
        algorithm: "property-address",
        candidates: candidates.map((c) => ({
          key: c.key,
          displayString: c.displayString,
          frequency: c.frequency,
          autoFixed: c.autoFixed,
        })),
        subjectsScanned,
        errorCount,
      };
    }
    case "school-two-pattern": {
      // #102: thread senderEmail + paired-WHO addresses into Pattern C.
      const candidates = extractSchoolCandidates(
        rows.map((r) => ({
          subject: r.subject,
          frequency: 1,
          senderEmail: r.senderEmail,
        })),
        input.pairedWhoAddresses && input.pairedWhoAddresses.length > 0
          ? { pairedWhoAddresses: input.pairedWhoAddresses }
          : undefined,
      );
      return {
        algorithm: "school-two-pattern",
        candidates: candidates.map((c) => ({
          key: c.key,
          displayString: c.displayString,
          frequency: c.frequency,
          autoFixed: c.autoFixed,
          meta: {
            pattern: c.pattern,
            ...(c.sourcedFromWho ? { sourcedFromWho: c.sourcedFromWho } : {}),
            ...(c.relatedWhat ? { relatedWhat: c.relatedWhat } : {}),
          },
        })),
        subjectsScanned,
        errorCount,
      };
    }
    case "agency-domain-derive": {
      const derived = deriveAgencyEntity({
        authoritativeDomain: input.confirmedDomain,
        senderDisplayNames: displayNames,
      });
      return {
        algorithm: "agency-domain-derive",
        candidates: [
          {
            key: derived.authoritativeDomain,
            displayString: derived.displayLabel,
            frequency: subjectsScanned,
            autoFixed: false,
            meta: {
              authoritativeDomain: derived.authoritativeDomain,
              derivedVia: derived.derivedVia,
              needsUserEdit: derived.needsUserEdit,
            },
          },
        ],
        subjectsScanned,
        errorCount,
      };
    }
    default: {
      const _exhaustive: never = shape.stage2Algorithm;
      throw new Error(`Unknown stage2Algorithm: ${String(_exhaustive)}`);
    }
  }
}
