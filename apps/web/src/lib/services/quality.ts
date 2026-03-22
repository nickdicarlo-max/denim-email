import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

interface QualityResult {
  accuracy: number | null;
  phase: string;
  totalSignals: number;
  corrections: number;
  casesViewed: number;
}

/**
 * QualityService — computes accuracy snapshots and manages phase transitions.
 * Write owner for QualitySnapshot table.
 * Also updates CaseSchema.qualityPhase on transitions.
 *
 * Accuracy = 1 - (corrections / max(casesViewed, 1))
 * Corrections = thumbsDown + emailMoves + caseMerges + caseSplits
 * CasesViewed = distinct caseIds in FeedbackEvents (any type)
 *
 * Phase transitions:
 *   CALIBRATING → TRACKING: when totalSignals >= 5
 *   TRACKING → STABLE: when accuracy >= 0.95 for 7 consecutive days
 */

const CORRECTION_TYPES = ["THUMBS_DOWN", "EMAIL_MOVE", "CASE_MERGE", "CASE_SPLIT"];
const CALIBRATION_THRESHOLD = 5;
const STABLE_ACCURACY_THRESHOLD = 0.95;
const STABLE_CONSECUTIVE_DAYS = 7;

/**
 * Compute and persist a quality snapshot for a schema.
 */
export async function computeSnapshot(
  schemaId: string,
  date: Date,
): Promise<QualityResult> {
  const start = Date.now();

  // 30-day rolling window
  const windowStart = new Date(date);
  windowStart.setDate(windowStart.getDate() - 30);

  // Count events by type in the window
  const events = await prisma.feedbackEvent.groupBy({
    by: ["eventType"],
    where: {
      schemaId,
      createdAt: { gte: windowStart, lte: date },
    },
    _count: { _all: true },
  });

  const eventCounts: Record<string, number> = {};
  let totalSignals = 0;
  for (const e of events) {
    eventCounts[e.eventType] = e._count._all;
    totalSignals += e._count._all;
  }

  // Count corrections
  const corrections = CORRECTION_TYPES.reduce(
    (sum, type) => sum + (eventCounts[type] ?? 0),
    0,
  );

  // Count distinct cases viewed (any feedback event with a caseId)
  const casesViewedResult = await prisma.feedbackEvent.findMany({
    where: {
      schemaId,
      createdAt: { gte: windowStart, lte: date },
      caseId: { not: null },
    },
    select: { caseId: true },
    distinct: ["caseId"],
  });
  const casesViewed = casesViewedResult.length;

  // Compute accuracy
  const accuracy = casesViewed > 0 ? 1 - corrections / casesViewed : null;

  // Determine phase transition
  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId },
    select: { qualityPhase: true },
  });
  const currentPhase = schema?.qualityPhase ?? "CALIBRATING";
  let newPhase = currentPhase;

  if (currentPhase === "CALIBRATING" && totalSignals >= CALIBRATION_THRESHOLD) {
    newPhase = "TRACKING";
  } else if (currentPhase === "TRACKING" && accuracy !== null && accuracy >= STABLE_ACCURACY_THRESHOLD) {
    // Check consecutive days at >= 95%
    const recentSnapshots = await prisma.qualitySnapshot.findMany({
      where: { schemaId },
      orderBy: { date: "desc" },
      take: STABLE_CONSECUTIVE_DAYS - 1,
      select: { accuracy: true },
    });
    const allHighAccuracy = recentSnapshots.length >= STABLE_CONSECUTIVE_DAYS - 1 &&
      recentSnapshots.every((s) => s.accuracy !== null && s.accuracy >= STABLE_ACCURACY_THRESHOLD);
    if (allHighAccuracy) {
      newPhase = "STABLE";
    }
  }

  // Persist snapshot
  await prisma.qualitySnapshot.create({
    data: {
      schemaId,
      date,
      accuracy,
      totalSignals,
      thumbsUp: eventCounts.THUMBS_UP ?? 0,
      thumbsDown: eventCounts.THUMBS_DOWN ?? 0,
      emailMoves: eventCounts.EMAIL_MOVE ?? 0,
      emailExcludes: eventCounts.EMAIL_EXCLUDE ?? 0,
      caseMerges: eventCounts.CASE_MERGE ?? 0,
      caseSplits: eventCounts.CASE_SPLIT ?? 0,
      casesViewed,
      phase: newPhase,
    },
  });

  // Update schema phase if it changed
  if (newPhase !== currentPhase) {
    await prisma.caseSchema.update({
      where: { id: schemaId },
      data: { qualityPhase: newPhase },
    });

    logger.info({
      service: "quality",
      operation: "phaseTransition",
      schemaId,
      from: currentPhase,
      to: newPhase,
      accuracy,
      totalSignals,
    });
  }

  const durationMs = Date.now() - start;
  logger.info({
    service: "quality",
    operation: "computeSnapshot",
    schemaId,
    durationMs,
    accuracy,
    totalSignals,
    corrections,
    casesViewed,
    phase: newPhase,
  });

  return { accuracy, phase: newPhase, totalSignals, corrections, casesViewed };
}

/**
 * Get current accuracy and phase for a schema.
 */
export async function getCurrentAccuracy(
  schemaId: string,
): Promise<QualityResult> {
  const latest = await prisma.qualitySnapshot.findFirst({
    where: { schemaId },
    orderBy: { date: "desc" },
  });

  const schema = await prisma.caseSchema.findUnique({
    where: { id: schemaId },
    select: { qualityPhase: true },
  });

  return {
    accuracy: latest?.accuracy ?? null,
    phase: schema?.qualityPhase ?? "CALIBRATING",
    totalSignals: latest?.totalSignals ?? 0,
    corrections: (latest?.thumbsDown ?? 0) + (latest?.emailMoves ?? 0) +
      (latest?.caseMerges ?? 0) + (latest?.caseSplits ?? 0),
    casesViewed: latest?.casesViewed ?? 0,
  };
}
