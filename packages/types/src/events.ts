/**
 * Typed Inngest event definitions.
 * These types are the contract between pipeline stages.
 * Define once here, import everywhere.
 */

export type DenimEvents = {
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
