/**
 * Deterministic defaults for schema-level JSON columns that the scan
 * pipeline reads but the Stage 1/2 fast-discovery flow doesn't generate.
 *
 * The legacy hypothesis path (`persistSchemaRelations`) populated these
 * from Claude output. The #95 Phase 4 cutover removed that writer and
 * `persistConfirmedEntities` only writes Entity rows, leaving
 * `clusteringConfig` / `summaryLabels` as placeholders from
 * `createSchemaStub`. Coarse clustering crashed on `timeDecayDays.fresh`
 * access against `{}` on the first live run (issue #109).
 *
 * This module builds both fields deterministically from the user's
 * declared domain. No Claude call; idempotent; safe to run inside the
 * Stage 2 entity-confirm transaction.
 */

import type { ClusteringConfig } from "@denim/types";
import { CLUSTERING_TUNABLES } from "./clustering-tunables";

export type SeedDomain = keyof typeof CLUSTERING_TUNABLES.domainDefaults;

const SUMMARY_LABELS: Record<SeedDomain, { beginning: string; middle: string; end: string }> = {
  school_parent: { beginning: "What", middle: "Details", end: "Action Needed" },
  property: { beginning: "Issue", middle: "Activity", end: "Status" },
  construction: { beginning: "Issue", middle: "Progress", end: "Current Status" },
  legal: { beginning: "Matter", middle: "Proceedings", end: "Status" },
  agency: { beginning: "Brief", middle: "Progress", end: "Status" },
  general: { beginning: "Topic", middle: "Details", end: "Status" },
};

function resolveDomain(domain: string | null | undefined): SeedDomain {
  if (domain && domain in CLUSTERING_TUNABLES.domainDefaults) {
    return domain as SeedDomain;
  }
  return "general";
}

export function buildDefaultClusteringConfig(domain: string | null | undefined): ClusteringConfig {
  const dd = CLUSTERING_TUNABLES.domainDefaults[resolveDomain(domain)];
  return {
    mergeThreshold: dd.mergeThreshold,
    threadMatchScore: CLUSTERING_TUNABLES.weights.threadMatchScore,
    subjectMatchScore: dd.subjectMatchScore,
    actorAffinityScore: dd.actorAffinityScore,
    tagMatchScore: CLUSTERING_TUNABLES.weights.tagMatchScore,
    timeDecayDays: { fresh: dd.timeDecayFresh },
    reminderCollapseEnabled: dd.reminderCollapseEnabled,
    reminderSubjectSimilarity: CLUSTERING_TUNABLES.reminder.subjectSimilarity,
    reminderMaxAge: CLUSTERING_TUNABLES.reminder.maxAgeDays,
  };
}

export function defaultSummaryLabels(domain: string | null | undefined) {
  return SUMMARY_LABELS[resolveDomain(domain)];
}
