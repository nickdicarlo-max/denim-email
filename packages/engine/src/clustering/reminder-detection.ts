/**
 * Reminder detection for email dedup within cases.
 * Pure functions — zero I/O, no Date.now(), no console.log.
 */

import type { ClusterEmailInput, ClusteringConfig } from "@denim/types";
import { jaroWinkler } from "../entity/matching";
import { normalizeSubject } from "./scoring";

/**
 * Determine if an email is a reminder for an existing email in the same thread.
 * A reminder has: same thread + similar subject + within reminderMaxAge days.
 */
export function isReminder(
  email: ClusterEmailInput,
  existingEmails: ClusterEmailInput[],
  config: ClusteringConfig,
  now: Date,
): boolean {
  if (!config.reminderCollapseEnabled) return false;

  const normalizedSubject = normalizeSubject(email.subject);

  for (const existing of existingEmails) {
    if (existing.threadId !== email.threadId) continue;

    const daysBetween = Math.abs(email.date.getTime() - existing.date.getTime()) / 86_400_000;
    if (daysBetween > config.reminderMaxAge) continue;

    const similarity = jaroWinkler(normalizedSubject, normalizeSubject(existing.subject));
    if (similarity >= config.reminderSubjectSimilarity) return true;
  }

  return false;
}
