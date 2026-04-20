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
import type { CredentialFailure, InterviewInput } from "@denim/types";
import type { CaseSchema, ScanJob, ScanPhase } from "@prisma/client";
import { logger } from "@/lib/logger";
import { computeScanMetrics } from "./scan-metrics";

export type OnboardingPhase =
  | "PENDING"
  | "GENERATING_HYPOTHESIS"
  // Issue #95 fast-discovery phases — Stage 1 (domain discovery) and
  // Stage 2 (entity discovery) each have a running + awaiting-confirm pair.
  | "DISCOVERING_DOMAINS"
  | "AWAITING_DOMAIN_CONFIRMATION"
  | "DISCOVERING_ENTITIES"
  | "AWAITING_ENTITY_CONFIRMATION"
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
  // Synthesis live counter (#82). Both present together during SYNTHESIZING.
  synthesizedCases?: number;
  totalCasesToSynthesize?: number;
}

export interface OnboardingError {
  phase: string;
  message: string;
  retryable: boolean;
}

// --- Issue #95 fast-discovery payload types --------------------------------

export interface Stage1CandidateDTO {
  domain: string;
  count: number;
}

/** #112: per-user-what find-or-tell result surfaced on Stage 1 review. */
export interface Stage1UserThingDTO {
  query: string;
  matchCount: number;
  topDomain: string | null;
  topSenders: ReadonlyArray<string>;
  errorCount: number;
  /**
   * #117: name of the paired WHO whose `from:` result supplied `topDomain`
   * and `matchCount` for this entry. Absent on full-text-only results.
   */
  sourcedFromWho?: string;
}

/** #112: per-user-who find-or-tell result surfaced on Stage 1 review. */
export interface Stage1UserContactDTO {
  query: string;
  matchCount: number;
  senderEmail: string | null;
  senderDomain: string | null;
  errorCount: number;
}

export interface Stage2DomainCandidateDTO {
  key: string;
  displayString: string;
  frequency: number;
  autoFixed: boolean;
  meta?: Record<string, unknown>;
}

export interface Stage2PerDomainDTO {
  confirmedDomain: string;
  algorithm: string;
  candidates: Stage2DomainCandidateDTO[];
}

export interface OnboardingPollingResponse {
  schemaId: string;
  phase: OnboardingPhase;
  progress: OnboardingProgress;
  error?: OnboardingError;
  /**
   * Typed credential-failure payload. Present when the schema failed with
   * a Gmail-auth-related cause; carries `{ reason, remedy }` so the UI can
   * branch on `remedy === "reconnect"` without string-matching `error.message`.
   * Issue #105 step 4.
   */
  credentialFailure?: CredentialFailure;
  nextHref?: string;
  updatedAt: string;
  // Present during DISCOVERING_DOMAINS / AWAITING_DOMAIN_CONFIRMATION.
  stage1Candidates?: Stage1CandidateDTO[];
  stage1QueryUsed?: string;
  // #112: user-hint find-or-tell results surfaced alongside stage1Candidates.
  stage1UserThings?: Stage1UserThingDTO[];
  stage1UserContacts?: Stage1UserContactDTO[];
  // Present during DISCOVERING_ENTITIES / AWAITING_ENTITY_CONFIRMATION.
  stage2Candidates?: Stage2PerDomainDTO[];
  // #127: interview inputs surfaced while the schema is in a rewind-eligible
  // phase so the `/onboarding/names` edit screen can pre-fill without a
  // second endpoint. Omitted past AWAITING_DOMAIN_CONFIRMATION — past that
  // the rewind path is blocked, so the UI has no reason to read inputs.
  inputs?: InterviewInput;
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
    const cf = schema.phaseCredentialFailure as CredentialFailure | null;
    return {
      ...base,
      phase: "FAILED",
      error: {
        phase: extractErrorPhase(schema.phaseError),
        message: schema.phaseError ?? "Unknown error",
        retryable: true,
      },
      ...(cf ? { credentialFailure: cf } : {}),
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
    // Legacy: FINALIZING_SCHEMA no longer appears in the new flow.
    // Map to GENERATING_HYPOTHESIS so existing rows don't break the UI.
    return { ...base, phase: "GENERATING_HYPOTHESIS" };
  }

  // Issue #95 Stage 1 — domain discovery running or awaiting user confirm.
  // Surface candidates so the review screen can render top-N domains.
  if (schema.phase === "DISCOVERING_DOMAINS" || schema.phase === "AWAITING_DOMAIN_CONFIRMATION") {
    return {
      ...base,
      phase: schema.phase,
      stage1Candidates: (schema.stage1Candidates as Stage1CandidateDTO[] | null) ?? [],
      stage1QueryUsed: schema.stage1QueryUsed ?? undefined,
      stage1UserThings: (schema.stage1UserThings as Stage1UserThingDTO[] | null) ?? [],
      stage1UserContacts: (schema.stage1UserContacts as Stage1UserContactDTO[] | null) ?? [],
      // #127: expose inputs for the edit-mode names page. Cast once here so
      // the UI doesn't re-parse out of the generic Json column type.
      ...(schema.inputs ? { inputs: schema.inputs as unknown as InterviewInput } : {}),
    };
  }

  // Issue #95 Stage 2 — entity discovery running or awaiting user confirm.
  // Surface per-domain candidates for the entity review screen.
  if (schema.phase === "DISCOVERING_ENTITIES" || schema.phase === "AWAITING_ENTITY_CONFIRMATION") {
    return {
      ...base,
      phase: schema.phase,
      stage2Candidates: (schema.stage2Candidates as Stage2PerDomainDTO[] | null) ?? [],
    };
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
        // Surface live synthesis counters (#82). Observer renders "N of M"
        // when phase === SYNTHESIZING and totalCasesToSynthesize > 0.
        synthesizedCases: onboardingScan.synthesizedCases,
        totalCasesToSynthesize: onboardingScan.totalCasesToSynthesize,
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
