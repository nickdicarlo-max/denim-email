/**
 * Scan management endpoints for a CaseSchema.
 *
 *   GET  /api/schemas/:schemaId/scans — audit-log listing of the 50 most
 *        recent ScanJob rows for this schema, each decorated with
 *        compute-on-demand metrics from `computeScanMetrics`. Ordered
 *        newest first.
 *
 *   POST /api/schemas/:schemaId/scans — manual rescan. Creates a fresh
 *        ScanJob row with `triggeredBy=MANUAL` and fires `scan.requested`
 *        so `runScan` picks it up. Returns 409 if there is already an
 *        active (PENDING or RUNNING) ScanJob for this schema — we never
 *        run two scans concurrently for the same schema (runScan's
 *        concurrency key also enforces this, but a fast 409 gives the
 *        client a cleaner error than a dropped event).
 *
 * Note: a manual rescan does NOT unblock an in-flight onboarding run.
 * `runOnboarding.waitForEvent` matches on the original onboarding
 * scanJobId, so a new MANUAL scan's `scan.completed` event is ignored
 * by the waiting workflow. The Task 12 scan-stage retry limitation is
 * still open after Task 13.
 */
import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { assertResourceOwnership } from "@/lib/middleware/ownership";
import { extractSchemasSchemaId } from "@/lib/middleware/request-params";
import { prisma } from "@/lib/prisma";
import { computeScanMetrics } from "@/lib/services/scan-metrics";

// GET — list recent scans for a schema ---------------------------------------
export const GET = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemasSchemaId(request);

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // 50 is enough for the audit log UI; add pagination only if that proves
    // insufficient in practice.
    const scans = await prisma.scanJob.findMany({
      where: { schemaId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Compute metrics sequentially per scan. Promise.all would be faster but
    // would also fan out 50 DB queries concurrently against a pooled
    // connection — not worth the churn for an audit-log view. Revisit if the
    // list page feels slow.
    const withMetrics = await Promise.all(
      scans.map(async (s) => ({
        ...s,
        metrics: await computeScanMetrics(s.id),
      })),
    );

    return NextResponse.json({ data: withMetrics });
  } catch (error) {
    return handleApiError(error, {
      service: "scans",
      operation: "list",
      userId,
    });
  }
});

// POST — manual rescan --------------------------------------------------------
export const POST = withAuth(async ({ userId, request }) => {
  try {
    const schemaId = extractSchemasSchemaId(request);

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // Conflict guard: refuse to create a second ScanJob while one is still
    // active. runScan's concurrency key would also catch this, but returning
    // 409 here gives the caller the existing scan id so it can redirect to
    // the in-flight job instead of getting a silent drop.
    const activeScan = await prisma.scanJob.findFirst({
      where: { schemaId, status: { in: ["PENDING", "RUNNING"] } },
      select: { id: true, status: true, phase: true },
    });
    if (activeScan) {
      return NextResponse.json(
        {
          error: "Scan already in progress",
          code: 409,
          type: "CONFLICT",
          data: {
            scanJobId: activeScan.id,
            status: activeScan.status,
            phase: activeScan.phase,
          },
        },
        { status: 409 },
      );
    }

    const scan = await prisma.scanJob.create({
      data: {
        schemaId,
        userId,
        status: "PENDING",
        phase: "PENDING",
        triggeredBy: "MANUAL",
        totalEmails: 0,
      },
      select: { id: true },
    });

    await inngest.send({
      name: "scan.requested",
      data: { scanJobId: scan.id, schemaId, userId },
    });

    logger.info({
      service: "scans",
      operation: "manual-rescan",
      userId,
      schemaId,
      scanJobId: scan.id,
    });

    return NextResponse.json({ data: { scanJobId: scan.id, status: "queued" } }, { status: 202 });
  } catch (error) {
    return handleApiError(error, {
      service: "scans",
      operation: "manual-rescan",
      userId,
    });
  }
});
