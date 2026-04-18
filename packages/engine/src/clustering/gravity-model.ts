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
} from "@denim/types";
import { actorScore, subjectScore, tagScore, threadScore, timeDecayMultiplier } from "./scoring";

/** Score a single email against a single case. */
export function scoreEmailAgainstCase(
  email: ClusterEmailInput,
  existingCase: ClusterCaseInput,
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
  const subject = subjectScore(email.subject, existingCase.subject, config);
  const tag = tagScore(email.tags, existingCase.tags, config);
  const actor = actorScore(email.senderEntityId, existingCase.senderEntityIds, config);
  const decay = timeDecayMultiplier(email.date, now, config);

  const rawScore = thread + subject + tag + actor;
  const finalScore = rawScore * decay;

  const breakdown: ScoreBreakdown = {
    threadScore: thread,
    subjectScore: subject,
    tagScore: tag,
    actorScore: actor,
    timeDecayMultiplier: decay,
    rawScore,
    finalScore,
  };

  return { caseId: existingCase.id, score: finalScore, breakdown };
}

/** Find the best matching case above mergeThreshold, or null. Also returns second-best for alternativeCaseId hints. */
export function findBestCase(
  email: ClusterEmailInput,
  cases: ClusterCaseInput[],
  config: ClusteringConfig,
  now: Date,
): ScoringResult | null {
  const result = findTopCases(email, cases, config, now);
  return result?.best ?? null;
}

/** Find top 2 matching cases above mergeThreshold. */
export function findTopCases(
  email: ClusterEmailInput,
  cases: ClusterCaseInput[],
  config: ClusteringConfig,
  now: Date,
): { best: ScoringResult; alternative: ScoringResult | null } | null {
  let best: ScoringResult | null = null;
  let secondBest: ScoringResult | null = null;

  for (const c of cases) {
    const result = scoreEmailAgainstCase(email, c, config, now);
    if (result.score >= config.mergeThreshold) {
      if (best === null || result.score > best.score) {
        secondBest = best;
        best = result;
      } else if (secondBest === null || result.score > secondBest.score) {
        secondBest = result;
      }
    }
  }

  if (!best) return null;
  return { best, alternative: secondBest };
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
    const topCases = findTopCases(representative, activeCases, config, now);

    const groupEmailIds = group.map((e) => e.id);
    const groupThreadIds = [...new Set(group.map((e) => e.threadId))];
    const groupEntityId = resolveGroupEntityId(group);
    const groupPrimaryTag = computePrimaryTag(group);

    if (topCases !== null) {
      // MERGE into existing case
      decisions.push({
        action: "MERGE",
        targetCaseId: topCases.best.caseId,
        alternativeCaseId: topCases.alternative?.caseId ?? null,
        emailIds: groupEmailIds,
        threadIds: groupThreadIds,
        score: topCases.best.score,
        breakdown: topCases.best.breakdown,
        primaryTag: groupPrimaryTag,
        entityId: groupEntityId,
      });

      // Update the active case with new data
      const caseToUpdate = activeCases.find((c) => c.id === topCases.best.caseId);
      if (caseToUpdate) {
        caseToUpdate.threadIds = [...new Set([...caseToUpdate.threadIds, ...groupThreadIds])];
        caseToUpdate.emailCount += group.length;
        caseToUpdate.senderEntityIds = [
          ...new Set([...caseToUpdate.senderEntityIds, ...collectSenderEntityIds(group)]),
        ];
        caseToUpdate.tags = [...new Set([...caseToUpdate.tags, ...collectTags(group)])];
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
        alternativeCaseId: null,
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
        senderEntityIds: collectSenderEntityIds(group),
        tags: collectTags(group),
        subject: representative.subject,
        emailCount: group.length,
        lastEmailDate: group.reduce((max, e) => (e.date > max ? e.date : max), group[0].date),
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

function collectSenderEntityIds(emails: ClusterEmailInput[]): string[] {
  const ids: string[] = [];
  for (const email of emails) {
    if (email.senderEntityId) {
      ids.push(email.senderEntityId);
    }
  }
  return [...new Set(ids)];
}

/** Collect all unique tags from a group of emails. */
function collectTags(emails: ClusterEmailInput[]): string[] {
  const tags = new Set<string>();
  for (const email of emails) {
    for (const tag of email.tags) {
      tags.add(tag);
    }
  }
  return [...tags];
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
    subjectScore: 0,
    tagScore: 0,
    actorScore: 0,
    timeDecayMultiplier: 0,
    rawScore: 0,
    finalScore: 0,
  };
}
