/**
 * Gravity model clustering algorithm.
 * Groups emails by thread, scores against existing cases, decides MERGE or CREATE.
 * Pure functions — zero I/O, no Date.now(), no console.log.
 */

import type {
  ClusterCaseInput,
  ClusterDecision,
  ClusterEmailInput,
  ClusteringConfig,
  ScoreBreakdown,
  ScoringResult,
  TagFrequencyMap,
} from "@denim/types";
import {
  actorScore,
  caseSizeBonus,
  normalizeSubject,
  subjectScore,
  tagScore,
  threadScore,
  timeDecayMultiplier,
} from "./scoring";

/** Score a single email against a single case. */
export function scoreEmailAgainstCase(
  email: ClusterEmailInput,
  existingCase: ClusterCaseInput,
  tagFrequencies: TagFrequencyMap,
  config: ClusteringConfig,
  now: Date,
): ScoringResult {
  // Primary entity boundary: mismatched entities score 0
  if (
    email.entityId !== null &&
    existingCase.entityId !== null &&
    email.entityId !== existingCase.entityId
  ) {
    return {
      caseId: existingCase.id,
      score: 0,
      breakdown: zeroBreakdown(),
    };
  }

  const thread = threadScore(email.threadId, existingCase.threadIds, config);
  const tag = tagScore(email.tags, existingCase.anchorTags, tagFrequencies, config);
  const subject = subjectScore(email.subject, existingCase.subject, config);
  const actor = actorScore(email.senderEntityId, existingCase.senderEntityIds, config);
  const sizeBonus = caseSizeBonus(existingCase.emailCount, config);
  const decay = timeDecayMultiplier(email.date, now, config);

  // Subject additive bonus when both tag and subject match
  const additiveBonus = tag > 0 && subject > 0 ? config.subjectAdditiveBonus : 0;

  const rawScore = thread + tag + subject + actor + sizeBonus + additiveBonus;
  const finalScore = rawScore * decay;

  const breakdown: ScoreBreakdown = {
    threadScore: thread,
    tagScore: tag,
    subjectScore: subject,
    actorScore: actor,
    caseSizeBonus: sizeBonus,
    timeDecayMultiplier: decay,
    rawScore,
    finalScore,
  };

  return { caseId: existingCase.id, score: finalScore, breakdown };
}

/** Find the best matching case above mergeThreshold, or null. */
export function findBestCase(
  email: ClusterEmailInput,
  cases: ClusterCaseInput[],
  tagFrequencies: TagFrequencyMap,
  config: ClusteringConfig,
  now: Date,
): ScoringResult | null {
  let best: ScoringResult | null = null;

  for (const c of cases) {
    const result = scoreEmailAgainstCase(email, c, tagFrequencies, config, now);
    if (result.score >= config.mergeThreshold && (best === null || result.score > best.score)) {
      best = result;
    }
  }

  return best;
}

/**
 * Main clustering algorithm.
 * 1. Group emails by threadId
 * 2. Sort groups chronologically (oldest first)
 * 3. For each group: score representative email against active cases
 * 4. MERGE if above threshold, CREATE otherwise
 * 5. Newly created cases added to active list for subsequent groups
 */
export function clusterEmails(
  emails: ClusterEmailInput[],
  existingCases: ClusterCaseInput[],
  tagFrequencies: TagFrequencyMap,
  config: ClusteringConfig,
  now: Date,
): ClusterDecision[] {
  const threadGroups = groupByThread(emails);
  const sortedGroups = sortChronologically(threadGroups);

  // Mutable list of cases: starts with existing, grows as new cases are created
  const activeCases: ClusterCaseInput[] = [...existingCases];
  const decisions: ClusterDecision[] = [];

  for (const group of sortedGroups) {
    // Use the oldest email as the representative for scoring
    const representative = group[0];
    const bestMatch = findBestCase(representative, activeCases, tagFrequencies, config, now);

    const groupEmailIds = group.map((e) => e.id);
    const groupThreadIds = [...new Set(group.map((e) => e.threadId))];
    const groupEntityId = resolveGroupEntityId(group);
    const groupPrimaryTag = computePrimaryTag(group);

    if (bestMatch !== null) {
      // MERGE into existing case
      decisions.push({
        action: "MERGE",
        targetCaseId: bestMatch.caseId,
        emailIds: groupEmailIds,
        threadIds: groupThreadIds,
        score: bestMatch.score,
        breakdown: bestMatch.breakdown,
        primaryTag: groupPrimaryTag,
        entityId: groupEntityId,
      });

      // Update the active case with new data
      const caseToUpdate = activeCases.find((c) => c.id === bestMatch.caseId);
      if (caseToUpdate) {
        caseToUpdate.threadIds = [...new Set([...caseToUpdate.threadIds, ...groupThreadIds])];
        caseToUpdate.emailCount += group.length;
        caseToUpdate.anchorTags = computeAnchorTags(
          [...caseToUpdate.anchorTags, ...collectAllTags(group)],
          config.anchorTagLimit,
        );
        caseToUpdate.senderEntityIds = [
          ...new Set([...caseToUpdate.senderEntityIds, ...collectSenderEntityIds(group)]),
        ];
        const latestDate = group.reduce(
          (max, e) => (e.date > max ? e.date : max),
          caseToUpdate.lastEmailDate,
        );
        caseToUpdate.lastEmailDate = latestDate;
      }
    } else {
      // CREATE new case — skip if no entity resolved (defense in depth)
      if (groupEntityId === null) {
        continue;
      }
      const newCaseId = `new-case-${decisions.length}`;

      decisions.push({
        action: "CREATE",
        targetCaseId: null,
        emailIds: groupEmailIds,
        threadIds: groupThreadIds,
        score: 0,
        breakdown: null,
        primaryTag: groupPrimaryTag,
        entityId: groupEntityId,
      });

      // Add the new case to the active list so subsequent groups can merge into it
      activeCases.push({
        id: newCaseId,
        entityId: groupEntityId ?? "",
        threadIds: groupThreadIds,
        anchorTags: computeAnchorTags(collectAllTags(group), config.anchorTagLimit),
        senderEntityIds: collectSenderEntityIds(group),
        subject: representative.subject,
        emailCount: group.length,
        lastEmailDate: group.reduce(
          (max, e) => (e.date > max ? e.date : max),
          group[0].date,
        ),
      });
    }
  }

  return decisions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByThread(emails: ClusterEmailInput[]): ClusterEmailInput[][] {
  const map = new Map<string, ClusterEmailInput[]>();
  for (const email of emails) {
    const group = map.get(email.threadId);
    if (group) {
      group.push(email);
    } else {
      map.set(email.threadId, [email]);
    }
  }
  return Array.from(map.values());
}

function sortChronologically(groups: ClusterEmailInput[][]): ClusterEmailInput[][] {
  return groups
    .map((group) => {
      // Sort emails within group oldest-first
      const sorted = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());
      return sorted;
    })
    .sort((a, b) => a[0].date.getTime() - b[0].date.getTime());
}

/** Pick the most common tag across the group's emails. */
function computePrimaryTag(emails: ClusterEmailInput[]): string | null {
  const counts = new Map<string, number>();
  for (const email of emails) {
    for (const tag of email.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [tag, count] of counts) {
    if (count > bestCount) {
      best = tag;
      bestCount = count;
    }
  }
  return best;
}

/** Compute the top N anchor tags by frequency. */
export function computeAnchorTags(tags: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

function collectAllTags(emails: ClusterEmailInput[]): string[] {
  const tags: string[] = [];
  for (const email of emails) {
    tags.push(...email.tags);
  }
  return tags;
}

function collectSenderEntityIds(emails: ClusterEmailInput[]): string[] {
  const ids: string[] = [];
  for (const email of emails) {
    if (email.senderEntityId) {
      ids.push(email.senderEntityId);
    }
  }
  return [...new Set(ids)];
}

/** Resolve entity for a thread group: first email with an entityId, or null. */
function resolveGroupEntityId(emails: ClusterEmailInput[]): string | null {
  for (const email of emails) {
    if (email.entityId) return email.entityId;
  }
  return null;
}

function zeroBreakdown(): ScoreBreakdown {
  return {
    threadScore: 0,
    tagScore: 0,
    subjectScore: 0,
    actorScore: 0,
    caseSizeBonus: 0,
    timeDecayMultiplier: 0,
    rawScore: 0,
    finalScore: 0,
  };
}
