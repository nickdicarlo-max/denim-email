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
     * GENERATING_HYPOTHESIS → FINALIZING_SCHEMA → PROCESSING_SCAN →
     * AWAITING_REVIEW.
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
  "synthesis.case.completed": {
    data: {
      schemaId: string;
      caseId: string;
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
};
