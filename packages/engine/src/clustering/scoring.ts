/**
 * Pure scoring functions for the gravity model.
 * Each function computes one dimension of email-to-case affinity.
 * Zero I/O, no Date.now(), no console.log.
 */

import type { ClusteringConfig } from "@denim/types";
import { jaroWinkler } from "../entity/matching";

/** Strip RE:/FW:/FWD: prefixes (possibly chained) and lowercase for comparison. */
export function normalizeSubject(subject: string): string {
  let result = subject.trim();
  let prev = "";
  while (result !== prev) {
    prev = result;
    result = result.replace(/^(re|fw|fwd)\s*:\s*/i, "");
  }
  return result.toLowerCase();
}

/** Thread match: if email shares a threadId with the case, return config score. */
export function threadScore(
  emailThreadId: string,
  caseThreadIds: string[],
  config: ClusteringConfig,
): number {
  return caseThreadIds.includes(emailThreadId) ? config.threadMatchScore : 0;
}

/**
 * Subject similarity via Jaro-Winkler on normalized subjects.
 * Returns config score scaled by similarity, or 0 if below 0.7 threshold.
 */
export function subjectScore(
  emailSubject: string,
  caseSubject: string,
  config: ClusteringConfig,
): number {
  const normEmail = normalizeSubject(emailSubject);
  const normCase = normalizeSubject(caseSubject);

  if (normEmail.length === 0 || normCase.length === 0) return 0;

  const similarity = jaroWinkler(normEmail, normCase);
  if (similarity < 0.7) return 0;

  return config.subjectMatchScore * similarity;
}

/** Actor affinity: if email sender is among case's known senders. */
export function actorScore(
  emailSenderEntityId: string | null,
  caseSenderEntityIds: string[],
  config: ClusteringConfig,
): number {
  if (!emailSenderEntityId) return 0;
  return caseSenderEntityIds.includes(emailSenderEntityId)
    ? config.actorAffinityScore
    : 0;
}

/**
 * Time decay: recent emails score higher. Returns a multiplier 0.2-1.0.
 * Within fresh days: 1.0
 * Beyond fresh: linearly decays to 0.2 at 365 days.
 */
export function timeDecayMultiplier(
  emailDate: Date,
  now: Date,
  config: ClusteringConfig,
): number {
  const daysSince = (now.getTime() - emailDate.getTime()) / 86_400_000;

  if (daysSince <= config.timeDecayDays.fresh) return 1.0;

  const decay = 1.0 - (0.8 * (daysSince - config.timeDecayDays.fresh)) / (365 - config.timeDecayDays.fresh);
  return Math.max(decay, 0.2);
}
