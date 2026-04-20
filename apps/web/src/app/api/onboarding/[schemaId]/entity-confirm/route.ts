/**
 * POST /api/onboarding/:schemaId/entity-confirm — Issue #95 Stage 2 completion.
 *
 * Wires the user's confirmed entities (from the Stage 2 review screen) into
 * the existing onboarding pipeline. Mirrors /domain-confirm's CAS + outbox
 * pattern (issue #33, #67).
 *
 *   1. Zod-validate body. `@`-prefixed identityKey is reserved for
 *      server-derived SECONDARY entities — reject if paired with PRIMARY.
 *   2. Ownership check.
 *   3. Single Prisma transaction:
 *        - CAS updateMany gated on phase=AWAITING_ENTITY_CONFIRMATION,
 *          advancing to PROCESSING_SCAN (count=0 ⇒ 409).
 *        - `persistConfirmedEntities` bulk-inserts/refreshes Entity rows.
 *        - OnboardingOutbox row for `onboarding.review.confirmed` — the
 *          existing event Function B (`runOnboardingPipeline`) listens on.
 *   4. Optimistic best-effort `inngest.send`; on success flip outbox to
 *      EMITTED (matches POST /domain-confirm and POST /:schemaId). On
 *      failure the drain cron re-emits within ~1 minute.
 *
 * CAS transition ownership: AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN.
 * Function B must observe schemas already in PROCESSING_SCAN and must not
 * re-advance that transition.
 */
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { assertResourceOwnership } from "@/lib/middleware/ownership";
import { extractOnboardingSchemaId } from "@/lib/middleware/request-params";
import { prisma } from "@/lib/prisma";
import {
  persistConfirmedEntities,
  seedSchemaDefaults,
  seedSchemaName,
} from "@/lib/services/interview";

// Charset: letters, digits, dot, space, hyphen, underscore, plus, @.
// Rejects quotes, angle brackets, semicolons, control chars.
const IDENTITY_KEY_RE = /^[\w@.\-+ ]+$/;

const ConfirmedEntitySchema = z
  .object({
    displayLabel: z.string().min(1).max(200),
    identityKey: z.string().min(1).max(256).regex(IDENTITY_KEY_RE),
    kind: z.enum(["PRIMARY", "SECONDARY"]),
    secondaryTypeName: z.string().max(100).optional(),
  })
  .refine(
    // `@domain`-prefixed keys are reserved for server-derived SECONDARY
    // entities. A user editing the review screen must not be able to hijack
    // a future auto-discovered SECONDARY via the
    // (schemaId, identityKey, type) unique constraint.
    (e) => !(e.identityKey.startsWith("@") && e.kind === "PRIMARY"),
    { message: "identityKey starting with @ is reserved for SECONDARY entities" },
  );

const BodySchema = z.object({
  confirmedEntities: z.array(ConfirmedEntitySchema).min(1).max(100),
});

export const POST = withAuth(async ({ userId, request }) => {
  let schemaId: string | undefined;
  try {
    schemaId = extractOnboardingSchemaId(request);
    const body = BodySchema.parse(await request.json());

    const schema = await prisma.caseSchema.findUnique({
      where: { id: schemaId },
      select: {
        id: true,
        userId: true,
        phase: true,
        domain: true,
        name: true,
        // #121: needed to map confirmed SECONDARY entities to their Stage 1
        // senderEmail for the aliases column. Cheap — same JSON column the
        // polling response already reads.
        stage1UserContacts: true,
      },
    });
    assertResourceOwnership(schema, userId, "Schema");

    // #121: build a sender-email lookup keyed by (a) Stage 1 contact query
    // and (b) the identityKey convention `@<senderEmail>` used by the
    // entity-discovery function. The entity-confirm payload arrives with
    // the identityKey intact even when the user renamed the displayLabel,
    // so the `@`-prefix path is the robust fallback. Query-based lookup is
    // the spec-preferred primary so renames still land their alias.
    const userContacts =
      (schema!.stage1UserContacts as Array<{
        query: string;
        senderEmail: string | null;
      }> | null) ?? [];
    const queryToEmail = new Map<string, string>();
    for (const c of userContacts) {
      if (c.query && c.senderEmail) queryToEmail.set(c.query, c.senderEmail);
    }

    const augmentedEntities = body.confirmedEntities.map((e) => {
      if (e.kind !== "SECONDARY") return e;
      // Primary lookup: match displayLabel against stage1UserContacts.query.
      let senderEmail = queryToEmail.get(e.displayLabel);
      // Fallback: identityKey convention `@<senderEmail>` (see
      // entity-discovery-fn.ts seed generation). Survives user renames.
      if (!senderEmail && e.identityKey.startsWith("@")) {
        senderEmail = e.identityKey.slice(1);
      }
      if (!senderEmail) return e;
      return { ...e, aliases: [senderEmail] };
    });

    const committed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.caseSchema.updateMany({
        where: { id: schemaId!, phase: "AWAITING_ENTITY_CONFIRMATION" },
        data: { phase: "PROCESSING_SCAN", phaseUpdatedAt: new Date() },
      });
      if (count === 0) return false;
      await persistConfirmedEntities(tx, schemaId!, augmentedEntities);
      // Issue #109: Stage 1/2 flow doesn't generate clusteringConfig or
      // summaryLabels (the hypothesis flow did). Seed deterministic
      // per-domain defaults here so the scan pipeline can read them.
      await seedSchemaDefaults(tx, schemaId!, schema!.domain);
      // Issue #111: upgrade the "Setting up..." placeholder to a real name
      // when the user didn't provide one at the interview step. No-op if the
      // user supplied a name (persisted via createSchemaStub).
      await seedSchemaName(tx, schemaId!, schema!.name, schema!.domain, body.confirmedEntities);
      await tx.onboardingOutbox.create({
        data: {
          schemaId: schemaId!,
          userId,
          eventName: "onboarding.review.confirmed",
          payload: { schemaId, userId } as Prisma.InputJsonValue,
        },
      });
      return true;
    });

    if (!committed) {
      return NextResponse.json(
        { error: "Wrong phase or already confirmed", code: 409, type: "CONFLICT" },
        { status: 409 },
      );
    }

    logger.info({
      service: "onboarding",
      operation: "entity-confirm",
      userId,
      schemaId,
      confirmedEntityCount: body.confirmedEntities.length,
    });

    // Best-effort optimistic emit + EMITTED flip (same pattern as
    // /domain-confirm and existing POST /:schemaId; avoids drain-cron
    // duplicate emissions on the happy path).
    void inngest
      .send({
        name: "onboarding.review.confirmed",
        data: { schemaId, userId },
      })
      .then(() =>
        prisma.onboardingOutbox.update({
          where: {
            schemaId_eventName: {
              schemaId: schemaId!,
              eventName: "onboarding.review.confirmed",
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
          operation: "entity-confirm.optimisticEmitFailed",
          userId,
          schemaId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error, {
      service: "onboarding",
      operation: "entity-confirm",
      userId,
      schemaId,
    });
  }
});
