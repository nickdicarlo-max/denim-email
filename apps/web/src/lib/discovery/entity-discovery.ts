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
import { getDomainShape, type DomainName } from "@/lib/config/domain-shapes";
import { ONBOARDING_TUNABLES } from "@/lib/config/onboarding-tunables";
import type { GmailClient } from "@/lib/gmail/client";
import { extractPropertyCandidates } from "./property-entity";
import { extractSchoolCandidates } from "./school-entity";
import { deriveAgencyEntity } from "./agency-entity";

export interface DiscoverEntitiesInput {
  gmailClient: GmailClient;
  schemaDomain: DomainName;
  confirmedDomain: string;
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

async function fetchSubjectsAndDisplayNames(
  client: GmailClient,
  confirmedDomain: string,
): Promise<{ subjects: string[]; displayNames: string[]; errorCount: number }> {
  // Stage 2 reuses stage1 lookback + batch size; only maxMessagesPerDomain
  // is stage2-specific (see onboarding-tunables.ts file-level comment).
  const q = `from:*@${confirmedDomain} newer_than:${ONBOARDING_TUNABLES.stage1.lookbackDays}d`;
  const ids = await client.listMessageIds(q, ONBOARDING_TUNABLES.stage2.maxMessagesPerDomain);
  const subjects: string[] = [];
  const displayNames: string[] = [];
  let errorCount = 0;

  const batchSize = ONBOARDING_TUNABLES.stage1.fetchBatchSize;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const rows = await Promise.all(
      batch.map(async (id) => {
        try {
          return await client.getMessageMetadata(id, ["Subject", "From"]);
        } catch {
          errorCount++;
          return null;
        }
      }),
    );
    for (const row of rows) {
      if (!row) continue;
      const s = row.payload.headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const f = row.payload.headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      if (s) subjects.push(s);
      if (f) displayNames.push(f.replace(/<[^>]+>/, "").trim());
    }
  }
  return { subjects, displayNames, errorCount };
}

export async function discoverEntitiesForDomain(
  input: DiscoverEntitiesInput,
): Promise<DiscoverEntitiesOutput> {
  const shape = getDomainShape(input.schemaDomain);
  const { subjects, displayNames, errorCount } = await fetchSubjectsAndDisplayNames(
    input.gmailClient,
    input.confirmedDomain,
  );

  switch (shape.stage2Algorithm) {
    case "property-address": {
      const candidates = extractPropertyCandidates(
        subjects.map((s) => ({ subject: s, frequency: 1 })),
      );
      return {
        algorithm: "property-address",
        candidates: candidates.map((c) => ({
          key: c.key,
          displayString: c.displayString,
          frequency: c.frequency,
          autoFixed: c.autoFixed,
        })),
        subjectsScanned: subjects.length,
        errorCount,
      };
    }
    case "school-two-pattern": {
      const candidates = extractSchoolCandidates(
        subjects.map((s) => ({ subject: s, frequency: 1 })),
      );
      return {
        algorithm: "school-two-pattern",
        candidates: candidates.map((c) => ({
          key: c.key,
          displayString: c.displayString,
          frequency: c.frequency,
          autoFixed: c.autoFixed,
          meta: { pattern: c.pattern },
        })),
        subjectsScanned: subjects.length,
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
            frequency: subjects.length,
            autoFixed: false,
            meta: {
              authoritativeDomain: derived.authoritativeDomain,
              derivedVia: derived.derivedVia,
              needsUserEdit: derived.needsUserEdit,
            },
          },
        ],
        subjectsScanned: subjects.length,
        errorCount,
      };
    }
    default: {
      const _exhaustive: never = shape.stage2Algorithm;
      throw new Error(`Unknown stage2Algorithm: ${String(_exhaustive)}`);
    }
  }
}
