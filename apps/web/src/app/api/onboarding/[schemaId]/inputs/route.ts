/**
 * PATCH /api/onboarding/:schemaId/inputs — Issue #127 editable interview inputs.
 *
 * Lets the user Back-button the Stage 1 review screen, fix a typo / missed
 * pairing / forgotten WHAT, and have Stage 1 re-run against the corrected
 * inputs. Without this route, the interview is effectively one-shot — every
 * input error required a full DB wipe + OAuth round-trip to recover.
 *
 * ## State machine contract
 *
 * Allowed only while `phase ∈ {DISCOVERING_DOMAINS, AWAITING_DOMAIN_CONFIRMATION}`.
 * Past that, Stage 2 (entity discovery) and/or the scan pipeline have
 * consumed Stage 1 output; rewinding inputs would silently invalidate
 * entities, clusters, and cases. The CAS `updateMany` in `rewindSchemaInputs`
 * enforces this — 0 rows updated → 409 CONFLICT.
 *
 * CAS transition ownership: phase-in-{DISCOVERING_DOMAINS,AWAITING_DOMAIN_CONFIRMATION}
 * → DISCOVERING_DOMAINS (self-loop on discovering; rewind from awaiting).
 *
 * ## Outbox semantics
 *
 * `onboarding.domain-discovery.requested` has a composite-PK outbox row that
 * may or may not already exist (the original Stage 1 run could have used
 * this event either via POST /start → runOnboarding's step.sendEvent, or
 * via a prior rewind through this same route). UPSERT keeps the PK intact
 * while flipping the row back to PENDING_EMIT so the drain cron re-emits
 * if the optimistic send fails. Same pattern as /domain-confirm → /entity-confirm.
 *
 * Bypasses `runOnboarding` (no domain re-validation needed — the stub row
 * already has a domain written). Goes directly to `runDomainDiscovery`.
 */
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { assertResourceOwnership } from "@/lib/middleware/ownership";
import { extractOnboardingSchemaId } from "@/lib/middleware/request-params";
import { prisma } from "@/lib/prisma";
import { rewindSchemaInputs } from "@/lib/services/interview";
import { InterviewInputSchema } from "@/lib/validation/interview";

const EVENT_NAME = "onboarding.domain-discovery.requested";

export const PATCH = withAuth(async ({ userId, request }) => {
  let schemaId: string | undefined;
  try {
    schemaId = extractOnboardingSchemaId(request);
    const inputs = InterviewInputSchema.parse(await request.json());

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, userId: true, phase: true },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // Atomic CAS rewind + outbox upsert. Loser of a concurrent click
    // falls through the count=0 branch to 409.
    const updatedCount = await prisma.$transaction(async (tx) => {
      const count = await rewindSchemaInputs(tx, schemaId!, inputs);
      if (count === 0) return 0;
      await tx.onboardingOutbox.upsert({
        where: {
          schemaId_eventName: {
            schemaId: schemaId!,
            eventName: EVENT_NAME,
          },
        },
        create: {
          schemaId: schemaId!,
          userId,
          eventName: EVENT_NAME,
          payload: { schemaId, userId } as Prisma.InputJsonValue,
        },
        update: {
          // Reset to a re-emit-ready state. Drain cron picks this up if
          // the optimistic send below fails.
          status: "PENDING_EMIT",
          nextAttemptAt: new Date(),
          payload: { schemaId, userId } as Prisma.InputJsonValue,
          // Preserve attempts history — don't reset to 0. A persistent
          // emission failure still trips the attempt cap.
        },
      });
      return count;
    });

    if (updatedCount === 0) {
      return NextResponse.json(
        {
          error:
            "Wrong phase for input edits. Inputs can only be edited while the schema is in DISCOVERING_DOMAINS or AWAITING_DOMAIN_CONFIRMATION.",
          code: 409,
          type: "CONFLICT",
        },
        { status: 409 },
      );
    }

    logger.info({
      service: "onboarding",
      operation: "inputs-patch",
      userId,
      schemaId,
      whatCount: inputs.whats.length,
      whoCount: inputs.whos.length,
      groupCount: inputs.groups.length,
    });

    // Optimistic fire-and-forget, same shape as /start and /domain-confirm.
    void inngest
      .send({ name: EVENT_NAME, data: { schemaId, userId } })
      .then(() =>
        prisma.onboardingOutbox.update({
          where: {
            schemaId_eventName: {
              schemaId: schemaId!,
              eventName: EVENT_NAME,
            },
          },
          data: {
            status: "EMITTED",
            emittedAt: new Date(),
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        }),
      )
      .catch((err: unknown) => {
        logger.warn({
          service: "onboarding",
          operation: "inputs-patch.optimisticEmitFailed",
          userId,
          schemaId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "inputs-patch",
      userId,
      schemaId,
    });
  }
});
