/**
 * Typed Inngest event definitions.
 * These types are the contract between pipeline stages.
 * Define once here, import everywhere.
 */

export type DenimEvents = {
  "onboarding.session.started": {
    /**
     * Kicks off the runOnboarding parent workflow. The CaseSchema stub
     * must already exist in phase=PENDING and carry the raw InterviewInput
     * in `inputs` — runOnboarding reads it and drives the schema through
     * GENERATING_HYPOTHESIS → AWAITING_REVIEW → PROCESSING_SCAN.
     */
    data: {
      schemaId: string;
      userId: string;
    };
  };
  "onboarding.session.cancelled": {
    /**
     * Fired by DELETE /api/onboarding/:schemaId. runOnboarding's cancelOn
     * binding matches on data.schemaId and cancels any in-flight run.
     * The HTTP handler also flips CaseSchema.status = ARCHIVED so the row
     * falls out of active-schema queries regardless of where runOnboarding
     * was paused.
     */
    data: {
      schemaId: string;
      userId: string;
    };
  };
  "onboarding.review.confirmed": {
    /**
     * User confirmed entities on the review screen. Triggers the pipeline
     * via runOnboardingPipeline (Function B). Emitted by POST /api/onboarding/:schemaId
     * after persistSchemaRelations succeeds.
     */
    data: {
      schemaId: string;
      userId: string;
    };
  };
  "scan.requested": {
    /**
     * Request a scan for an existing ScanJob row. Consumed by runScan
     * (Phase 6). The ScanJob must already exist and be in phase PENDING
     * before emitting this event — runScan advances it through the
     * rest of the state machine.
     */
    data: {
      schemaId: string;
      userId: string;
      scanJobId: string;
    };
  };
  "scan.completed": {
    /**
     * Emitted at the end of a scan workflow — either by runSynthesis
     * (happy path, emails were processed) or by runScan's empty-scan
     * short-circuit (no emails were discovered). Consumed by the
     * runOnboarding orchestrator (Phase 7, Task 9) to flip schema
     * state forward.
     *
     * synthesizedCount / failedCount are set on the happy path.
     * reason is set on the short-circuit ("no-emails-found") and
     * carries the empty-result email count in emailCount.
     */
    data: {
      schemaId: string;
      scanJobId: string;
      synthesizedCount?: number;
      failedCount?: number;
      emailCount?: number;
      reason?: "no-emails-found";
    };
  };
  "scan.emails.discovered": {
    data: {
      schemaId: string;
      userId: string;
      scanJobId: string;
      emailIds: string[];
    };
  };
  "extraction.batch.process": {
    data: {
      schemaId: string;
      userId: string;
      scanJobId: string;
      emailIds: string[];
      batchIndex: number;
      totalBatches: number;
    };
  };
  "extraction.batch.completed": {
    data: {
      schemaId: string;
      scanJobId: string;
      batchIndex: number;
      totalBatches: number;
      processedCount: number;
      excludedCount: number;
      failedCount: number;
    };
  };
  "extraction.all.completed": {
    data: {
      schemaId: string;
      scanJobId: string;
    };
  };
  "coarse.clustering.completed": {
    data: {
      schemaId: string;
      scanJobId: string;
      coarseClusterIds: string[];
    };
  };
  "clustering.completed": {
    data: {
      schemaId: string;
      clusterIds: string[];
    };
  };
  "synthesis.case.requested": {
    /**
     * Fan-out event: one per case emitted by runSynthesis. Consumed by the
     * synthesizeCaseWorker (concurrency-capped at 4/schema) which runs the
     * actual Claude synthesis for a single case.
     */
    data: {
      schemaId: string;
      caseId: string;
      scanJobId: string;
    };
  };
  "synthesis.case.completed": {
    /**
     * Emitted by synthesizeCaseWorker after each case finishes (ok or failed).
     * Also consumed by:
     *   - checkSynthesisComplete: counts pending cases, advances scan phase
     *     and emits scan.completed when pending=0.
     *   - runClusteringCalibration: debounced per-schema calibration run.
     *
     * The optional scanJobId/status/error fields are set on the fan-out path;
     * legacy emitters of this event may omit them (calibration still works).
     */
    data: {
      schemaId: string;
      caseId: string;
      scanJobId?: string;
      status?: "ok" | "failed";
      error?: string;
    };
  };
  "feedback.case.modified": {
    data: {
      schemaId: string;
      caseId: string;
      eventType: string;
    };
  };
  "feedback.email.moved": {
    data: {
      schemaId: string;
      emailId: string;
      fromCaseId: string;
      toCaseId: string;
    };
  };
  "cron.daily.scans.trigger": {
    /**
     * Triggers the `cronDailyScans` Inngest function which walks every
     * ACTIVE schema whose `lastScannedAt` is stale (null or older than
     * the cron interval) and fires a `scan.requested` event for each.
     *
     * Task 17 of the onboarding state machine refactor leaves this as an
     * EVENT trigger rather than an actual `{ cron: "..." }` trigger so
     * the team can test the wiring manually before enabling a real
     * schedule. When ready to enable, swap the trigger in
     * `apps/web/src/lib/inngest/cron.ts` from
     *   `triggers: [{ event: "cron.daily.scans.trigger" }]`
     * to
     *   `triggers: [{ cron: "TZ=UTC 0 6 * * *" }]`
     * and the rest of the function continues to work unchanged.
     *
     * No payload fields — the cron function queries its own work list.
     */
    data: Record<string, never>;
  };
};
