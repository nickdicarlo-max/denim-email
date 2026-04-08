/**
 * Onboarding polling — flattens the two-row state machine
 * (CaseSchema.phase + latest ScanJob.phase) into a single response shape
 * the onboarding UI polls.
 *
 * The client never needs to know that the workflow lives across two tables:
 * it sees one `phase` string plus progress counters and follows the state
 * diagram forward. Every branch is exercised by a test — if you add a new
 * state, add a test first or the merge will silently map it to PENDING.
 */
import type { CaseSchema, ScanJob, ScanPhase } from "@prisma/client";
import { logger } from "@/lib/logger";
import { computeScanMetrics } from "./scan-metrics";

export type OnboardingPhase =
  | "PENDING"
  | "GENERATING_HYPOTHESIS"
  | "FINALIZING_SCHEMA"
  | "DISCOVERING"
  | "EXTRACTING"
  | "CLUSTERING"
  | "SYNTHESIZING"
  | "AWAITING_REVIEW"
  | "COMPLETED"
  | "NO_EMAILS_FOUND"
  | "FAILED";

export interface OnboardingProgress {
  emailsTotal?: number;
  emailsProcessed?: number;
  emailsExcluded?: number;
  emailsFailed?: number;
  casesTotal?: number;
}

export interface OnboardingError {
  phase: string;
  message: string;
  retryable: boolean;
}

export interface OnboardingPollingResponse {
  schemaId: string;
  phase: OnboardingPhase;
  progress: OnboardingProgress;
  error?: OnboardingError;
  nextHref?: string;
  updatedAt: string;
}

/**
 * Map a ScanJob.phase to the user-facing phase during PROCESSING_SCAN.
 * PENDING/IDLE show up as DISCOVERING so the UI doesn't flash an
 * in-between state. COMPLETED maps to SYNTHESIZING on the assumption
 * that the orchestrator is about to flip the schema to AWAITING_REVIEW.
 */
const SCAN_PHASE_TO_USER_PHASE: Record<ScanPhase, OnboardingPhase> = {
  PENDING: "DISCOVERING",
  IDLE: "DISCOVERING",
  DISCOVERING: "DISCOVERING",
  EXTRACTING: "EXTRACTING",
  CLUSTERING: "CLUSTERING",
  SYNTHESIZING: "SYNTHESIZING",
  COMPLETED: "SYNTHESIZING",
  FAILED: "FAILED",
};

/**
 * Extract the phase name from a phaseError of the form `[PHASE_NAME] message`.
 * Returns "UNKNOWN" if the pattern doesn't match.
 */
function extractErrorPhase(phaseError: string | null): string {
  if (!phaseError) return "UNKNOWN";
  return phaseError.match(/^\[([^\]]+)\]/)?.[1] ?? "UNKNOWN";
}

/**
 * Merge a CaseSchema row and (optionally) the most recent onboarding ScanJob
 * into a single polling response. When `schema.phase === "PROCESSING_SCAN"`,
 * this hits the DB via computeScanMetrics to derive live counters; all other
 * branches are pure synchronous merges over the passed-in rows.
 */
export async function derivePollingResponse(
  schema: CaseSchema,
  onboardingScan: ScanJob | null,
): Promise<OnboardingPollingResponse> {
  const updatedAt = (schema.phaseUpdatedAt ?? schema.updatedAt ?? new Date()).toISOString();
  const base = {
    schemaId: schema.id,
    progress: {} as OnboardingProgress,
    updatedAt,
  };

  // Terminal: user confirmed review, schema is live.
  if (schema.status === "ACTIVE") {
    return {
      ...base,
      phase: "COMPLETED",
      nextHref: `/feed?schema=${schema.id}`,
    };
  }

  // Terminal: schema-level failure (takes precedence over everything else).
  if (schema.phase === "FAILED") {
    return {
      ...base,
      phase: "FAILED",
      error: {
        phase: extractErrorPhase(schema.phaseError),
        message: schema.phaseError ?? "Unknown error",
        retryable: true,
      },
    };
  }

  // Terminal: scan discovered nothing.
  if (schema.phase === "NO_EMAILS_FOUND") {
    return { ...base, phase: "NO_EMAILS_FOUND" };
  }

  // User checkpoint — waiting for the human to confirm before going ACTIVE.
  if (schema.phase === "AWAITING_REVIEW") {
    return { ...base, phase: "AWAITING_REVIEW" };
  }

  // Terminal: schema.phase === COMPLETED but status hasn't flipped to ACTIVE
  // yet. Treat as COMPLETED so the UI can stop polling.
  if (schema.phase === "COMPLETED") {
    return {
      ...base,
      phase: "COMPLETED",
      nextHref: `/feed?schema=${schema.id}`,
    };
  }

  // Pre-scan schema-owned phases — no scan row involved yet.
  if (schema.phase === "PENDING") return { ...base, phase: "PENDING" };
  if (schema.phase === "GENERATING_HYPOTHESIS") {
    return { ...base, phase: "GENERATING_HYPOTHESIS" };
  }
  if (schema.phase === "FINALIZING_SCHEMA") {
    return { ...base, phase: "FINALIZING_SCHEMA" };
  }

  // PROCESSING_SCAN: the active ScanJob owns the visible phase. Counters
  // come from computeScanMetrics (the only DB hit in this function).
  if (schema.phase === "PROCESSING_SCAN") {
    if (!onboardingScan) {
      // Invariant violation: PROCESSING_SCAN without a scan row. The
      // orchestrator writes schema.phase=PROCESSING_SCAN in the same tx
      // that creates the scan row, so this should never fire. Log loudly
      // and show DISCOVERING so the UI doesn't hang.
      logger.error({
        service: "onboarding-polling",
        operation: "derivePollingResponse.missingScan",
        schemaId: schema.id,
      });
      return { ...base, phase: "DISCOVERING" };
    }

    if (onboardingScan.phase === "FAILED") {
      return {
        ...base,
        phase: "FAILED",
        error: {
          phase: onboardingScan.errorPhase ?? "UNKNOWN",
          message: onboardingScan.errorMessage ?? "Scan failed",
          retryable: true,
        },
      };
    }

    const metrics = await computeScanMetrics(onboardingScan.id);
    const userPhase = SCAN_PHASE_TO_USER_PHASE[onboardingScan.phase] ?? "DISCOVERING";

    return {
      ...base,
      phase: userPhase,
      progress: {
        emailsTotal: metrics.totalEmails,
        emailsProcessed: metrics.processedEmails,
        emailsExcluded: metrics.excludedEmails,
        emailsFailed: metrics.failedEmails,
        casesTotal: metrics.casesCreated,
      },
    };
  }

  // Defensive: unknown schema phase (including null). Log and map to PENDING.
  logger.error({
    service: "onboarding-polling",
    operation: "derivePollingResponse.unknownPhase",
    schemaId: schema.id,
    phase: schema.phase,
  });
  return { ...base, phase: "PENDING" };
}
