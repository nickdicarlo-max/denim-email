/**
 * Scan and schema metrics — compute-on-demand.
 *
 * Phase 1 of the onboarding state machine refactor removed the denormalized
 * counter columns from ScanJob (processedEmails, excludedEmails, failedEmails,
 * casesCreated, etc.) and CaseSchema (emailCount, caseCount). All reads now
 * derive these numbers from the authoritative row sources:
 *
 *   - processedEmails / excludedEmails → count Email by firstScanJobId + isExcluded
 *   - failedEmails                     → count ScanFailure by scanJobId
 *   - estimatedCostUsd                 → sum ExtractionCost by scanJobId
 *   - casesCreated                     → count Case whose CaseEmail junction
 *                                        references an email with that firstScanJobId
 *
 * Queries are parallelized with Promise.all. The only durable counter on
 * ScanJob is `totalEmails`, set once at discovery — it's included here for
 * callers that want a single source for the full metrics shape.
 */
import { prisma } from "@/lib/prisma";

export interface ScanMetrics {
  totalEmails: number;
  processedEmails: number;
  excludedEmails: number;
  failedEmails: number;
  estimatedCostUsd: number;
  casesCreated: number;
}

const ZERO_METRICS: ScanMetrics = {
  totalEmails: 0,
  processedEmails: 0,
  excludedEmails: 0,
  failedEmails: 0,
  estimatedCostUsd: 0,
  casesCreated: 0,
};

export async function computeScanMetrics(scanJobId: string): Promise<ScanMetrics> {
  const scan = await prisma.scanJob.findUnique({
    where: { id: scanJobId },
    select: { totalEmails: true, schemaId: true },
  });

  if (!scan) {
    return { ...ZERO_METRICS };
  }

  const [processed, excluded, failed, costSum, casesCreated] = await Promise.all([
    prisma.email.count({
      where: { firstScanJobId: scanJobId, isExcluded: false },
    }),
    prisma.email.count({
      where: { firstScanJobId: scanJobId, isExcluded: true },
    }),
    prisma.scanFailure.count({
      where: { scanJobId },
    }),
    prisma.extractionCost.aggregate({
      where: { scanJobId },
      _sum: { estimatedCostUsd: true },
    }),
    prisma.case.count({
      where: {
        schemaId: scan.schemaId,
        caseEmails: {
          some: { email: { firstScanJobId: scanJobId } },
        },
      },
    }),
  ]);

  return {
    totalEmails: scan.totalEmails,
    processedEmails: processed,
    excludedEmails: excluded,
    failedEmails: failed,
    estimatedCostUsd: Number(costSum._sum.estimatedCostUsd ?? 0),
    casesCreated,
  };
}

export interface SchemaMetrics {
  emailCount: number;
  caseCount: number;
  actionCount: number;
}

export async function computeSchemaMetrics(schemaId: string): Promise<SchemaMetrics> {
  const [emailCount, caseCount, actionCount] = await Promise.all([
    prisma.email.count({ where: { schemaId, isExcluded: false } }),
    prisma.case.count({ where: { schemaId } }),
    prisma.caseAction.count({ where: { schemaId } }),
  ]);

  return { emailCount, caseCount, actionCount };
}
