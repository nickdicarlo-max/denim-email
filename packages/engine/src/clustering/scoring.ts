/**
 * Pure scoring functions for the gravity model.
 * Each function computes one dimension of email-to-case affinity.
 * Zero I/O, no Date.now(), no console.log.
 */

import type { ClusteringConfig, TagFrequencyMap } from "@denim/types";
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
 * Tag overlap score with weak tag discount.
 * Each overlapping tag contributes tagMatchScore / anchorTagLimit,
 * discounted by weakTagDiscount if the tag is high-frequency.
 */
export function tagScore(
  emailTags: string[],
  caseAnchorTags: string[],
  tagFrequencies: TagFrequencyMap,
  config: ClusteringConfig,
): number {
  if (emailTags.length === 0 || caseAnchorTags.length === 0) return 0;

  let score = 0;
  const perTagScore = config.tagMatchScore / Math.max(config.anchorTagLimit, 1);

  for (const tag of emailTags) {
    if (caseAnchorTags.includes(tag)) {
      const freq = tagFrequencies[tag];
      const discount = freq?.isWeak ? config.weakTagDiscount : 1;
      score += perTagScore * discount;
    }
  }

  return Math.min(score, config.tagMatchScore);
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
 * Case size bonus: larger cases attract more emails (gravity).
 * Scales linearly from 0 to caseSizeMaxBonus as emailCount approaches caseSizeThreshold.
 */
export function caseSizeBonus(
  caseEmailCount: number,
  config: ClusteringConfig,
): number {
  if (caseEmailCount <= 1) return 0;
  const ratio = Math.min(caseEmailCount / config.caseSizeThreshold, 1);
  return config.caseSizeMaxBonus * ratio;
}

/**
 * Time decay: recent emails score higher. Returns a multiplier 0-1.
 * fresh (<=freshDays): 1.0
 * recent (<=recentDays): 0.7
 * stale (<=staleDays): 0.4
 * ancient (>staleDays): 0.2
 */
export function timeDecayMultiplier(
  emailDate: Date,
  now: Date,
  config: ClusteringConfig,
): number {
  const daysSince = (now.getTime() - emailDate.getTime()) / 86_400_000;

  if (daysSince <= config.timeDecayDays.fresh) return 1.0;
  if (daysSince <= config.timeDecayDays.recent) return 0.7;
  if (daysSince <= config.timeDecayDays.stale) return 0.4;
  return 0.2;
}
