/**
 * Onboarding state machine helpers — compare-and-swap (CAS) phase transitions
 * for CaseSchema and ScanJob.
 *
 * These helpers solve three classes of bug from Eval Session 1:
 *
 *   1. Races — two concurrent writers advancing a scan stuck the pipeline
 *      in the middle phase. CAS means only one advance wins per transition.
 *   2. Hangs — onboarding got stuck on the loading screen when a retry
 *      re-ran a step that had already advanced. Idempotent skip handles it.
 *   3. Silent drops — a mismatched phase used to no-op without surfacing.
 *      Now any unexpected pre-state throws a NonRetriableError with the
 *      exact mismatch recorded.
 *
 * All writes go through advanceSchemaPhase / advanceScanPhase (for happy-path
 * transitions) or markSchemaFailed / markScanFailed (for error paths). Callers
 * never write `phase` directly.
 */

import type { ScanPhase, SchemaPhase } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Phase ordering
// ---------------------------------------------------------------------------

/**
 * Monotonic ordering of schema onboarding phases. Terminal states
 * (NO_EMAILS_FOUND, FAILED) share the max index so idempotency checks treat
 * them as "already past" every normal phase.
 */
const SCHEMA_PHASE_ORDER: Record<SchemaPhase, number> = {
  PENDING: 0,
  GENERATING_HYPOTHESIS: 1,
  FINALIZING_SCHEMA: 2,
  AWAITING_REVIEW: 3,
  PROCESSING_SCAN: 4,
  COMPLETED: 5,
  NO_EMAILS_FOUND: 99,
  FAILED: 99,
};

export function phaseIndex(phase: SchemaPhase | null | undefined): number {
  if (!phase) return -1;
  return SCHEMA_PHASE_ORDER[phase] ?? -1;
}

/**
 * Monotonic ordering of scan phases. PENDING is the post-migration initial
 * state; IDLE is kept for legacy rows (same index so either can be the entry
 * point into DISCOVERING).
 */
const SCAN_PHASE_ORDER: Record<ScanPhase, number> = {
  PENDING: 0,
  IDLE: 0,
  DISCOVERING: 1,
  EXTRACTING: 2,
  CLUSTERING: 3,
  SYNTHESIZING: 4,
  COMPLETED: 5,
  FAILED: 99,
};

export function scanPhaseIndex(phase: ScanPhase | null | undefined): number {
  if (!phase) return -1;
  return SCAN_PHASE_ORDER[phase] ?? -1;
}

// ---------------------------------------------------------------------------
// CaseSchema phase transitions
// ---------------------------------------------------------------------------

export interface AdvanceSchemaPhaseOpts<T> {
  schemaId: string;
  from: SchemaPhase;
  to: SchemaPhase;
  work: () => Promise<T>;
}

/**
 * Atomically advance a CaseSchema's phase from `from` to `to`.
 *
 * Returns `"skipped"` if the row is already past `from` (idempotent re-run
 * by an Inngest retry, for example).
 *
 * Throws NonRetriableError if:
 *   - the row is in an unexpected pre-state (not `from`, not already past)
 *   - the CAS lost because another writer advanced the row between read and
 *     write — meaning our `work()` raced and shouldn't be committed.
 *
 * The `work()` callback runs only after the pre-state check passes. Its
 * return value is returned to the caller on success.
 */
export async function advanceSchemaPhase<T>(
  opts: AdvanceSchemaPhaseOpts<T>,
): Promise<T | "skipped"> {
  const schema = await prisma.caseSchema.findUniqueOrThrow({
    where: { id: opts.schemaId },
    select: { phase: true },
  });

  // Idempotent skip: already past the `from` state.
  if (phaseIndex(schema.phase) > phaseIndex(opts.from)) {
    return "skipped";
  }

  if (schema.phase !== opts.from) {
    throw new NonRetriableError(
      `advanceSchemaPhase: expected phase=${opts.from}, got phase=${schema.phase ?? "null"} (schemaId=${opts.schemaId})`,
    );
  }

  const result = await opts.work();

  const updated = await prisma.caseSchema.updateMany({
    where: { id: opts.schemaId, phase: opts.from },
    data: {
      phase: opts.to,
      phaseUpdatedAt: new Date(),
      phaseError: null,
      phaseErrorAt: null,
    },
  });

  if (updated.count !== 1) {
    throw new NonRetriableError(
      `advanceSchemaPhase: CAS lost on ${opts.from} → ${opts.to} (schemaId=${opts.schemaId})`,
    );
  }

  return result;
}

/**
 * Mark a schema as FAILED with the phase where it died and an error message.
 * Always succeeds regardless of current phase — terminal error state.
 */
export async function markSchemaFailed(
  schemaId: string,
  phaseAtFailure: SchemaPhase,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.caseSchema.update({
    where: { id: schemaId },
    data: {
      phase: "FAILED",
      phaseError: `[${phaseAtFailure}] ${message}`,
      phaseErrorAt: new Date(),
      phaseUpdatedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// ScanJob phase transitions
// ---------------------------------------------------------------------------

export interface AdvanceScanPhaseOpts<T> {
  scanJobId: string;
  from: ScanPhase;
  to: ScanPhase;
  work: () => Promise<T>;
}

/**
 * Atomically advance a ScanJob's phase. Same semantics as advanceSchemaPhase.
 *
 * When `from` is PENDING, IDLE is also accepted as a legacy-compatible
 * starting state (both map to index 0 in SCAN_PHASE_ORDER).
 */
export async function advanceScanPhase<T>(opts: AdvanceScanPhaseOpts<T>): Promise<T | "skipped"> {
  const scan = await prisma.scanJob.findUniqueOrThrow({
    where: { id: opts.scanJobId },
    select: { phase: true },
  });

  if (scanPhaseIndex(scan.phase) > scanPhaseIndex(opts.from)) {
    return "skipped";
  }

  // Accept either PENDING or IDLE as the pre-state when the caller expects
  // a PENDING-equivalent starting phase.
  const preStateOk =
    scan.phase === opts.from || scanPhaseIndex(scan.phase) === scanPhaseIndex(opts.from);
  if (!preStateOk) {
    throw new NonRetriableError(
      `advanceScanPhase: expected phase=${opts.from}, got phase=${scan.phase} (scanJobId=${opts.scanJobId})`,
    );
  }

  const result = await opts.work();

  const updated = await prisma.scanJob.updateMany({
    where: { id: opts.scanJobId, phase: scan.phase },
    data: { phase: opts.to },
  });

  if (updated.count !== 1) {
    throw new NonRetriableError(
      `advanceScanPhase: CAS lost on ${opts.from} → ${opts.to} (scanJobId=${opts.scanJobId})`,
    );
  }

  return result;
}

/**
 * Mark a ScanJob as failed with phase recording and completion timestamp.
 * Always succeeds regardless of current phase — terminal error state.
 */
export async function markScanFailed(
  scanJobId: string,
  phaseAtFailure: ScanPhase,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: {
      phase: "FAILED",
      status: "FAILED",
      errorPhase: phaseAtFailure,
      errorMessage: message,
      completedAt: new Date(),
    },
  });
}
