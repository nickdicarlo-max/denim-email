import { computeCaseDecay } from "@denim/engine";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { prisma } from "@/lib/prisma";

export const GET = withAuth(async ({ userId, request }) => {
  try {
    const url = new URL(request.url);
    // Default: include RESOLVED cases, rendered greyed out via CaseCard's
    // status===RESOLVED muted styling. Opt out with ?includeResolved=false.
    const includeResolved = url.searchParams.get("includeResolved") !== "false";

    const schemas = await prisma.caseSchema.findMany({
      where: { userId, status: { in: ["ACTIVE", "ONBOARDING"] } },
      select: {
        id: true,
        name: true,
        domain: true,
        summaryLabels: true,
        entities: {
          where: { isActive: true, type: "PRIMARY" },
          // Phase 3 — surface origin + discoveryScore so the chip row can
          // render user hints first (origin=USER_HINT) and confirmed
          // discoveries second (everything else, sorted by discoveryScore).
          select: {
            id: true,
            name: true,
            origin: true,
            discoveryScore: true,
          },
        },
      },
    });

    if (schemas.length === 0) {
      return NextResponse.json({
        data: { cases: [], schemas: [] },
      });
    }

    const schemaIds = schemas.map((s) => s.id);

    const whereClause: Record<string, unknown> = {
      schemaId: { in: schemaIds },
      urgency: { not: "IRRELEVANT" },
    };

    if (!includeResolved) {
      whereClause.status = { in: ["OPEN", "IN_PROGRESS"] };
    }

    const cases = await prisma.case.findMany({
      where: whereClause,
      select: {
        id: true,
        schemaId: true,
        entityId: true,
        title: true,
        emoji: true,
        mood: true,
        summary: true,
        primaryActor: true,
        displayTags: true,
        anchorTags: true,
        status: true,
        urgency: true,
        aggregatedData: true,
        startDate: true,
        endDate: true,
        lastEmailDate: true,
        lastSenderName: true,
        lastSenderEntity: true,
        viewedAt: true,
        feedbackRating: true,
        nextActionDate: true,
        entity: { select: { id: true, name: true } },
        caseEmails: { select: { id: true } },
        actions: {
          where: { status: "PENDING" },
          select: {
            id: true,
            title: true,
            actionType: true,
            dueDate: true,
            eventStartTime: true,
            eventEndTime: true,
            eventLocation: true,
            amount: true,
            currency: true,
            status: true,
            reminderCount: true,
            confidence: true,
          },
          orderBy: [{ dueDate: "asc" }],
          take: 3,
        },
      },
      orderBy: { lastEmailDate: "desc" },
    });

    const now = new Date();
    const feedCases = cases.map((c) => {
      const decayed = computeCaseDecay(
        {
          caseStatus: c.status as "OPEN" | "IN_PROGRESS" | "RESOLVED",
          caseUrgency: c.urgency ?? "UPCOMING",
          lastEmailDate: c.lastEmailDate ?? now,
          actions: c.actions.map((a) => ({
            id: a.id,
            status: a.status as "PENDING",
            dueDate: a.dueDate,
            eventStartTime: a.eventStartTime,
            eventEndTime: a.eventEndTime ?? null,
          })),
        },
        now,
      );

      const schema = schemas.find((s) => s.id === c.schemaId);

      return {
        id: c.id,
        schemaId: c.schemaId,
        schemaName: schema?.name ?? "",
        schemaDomain: schema?.domain ?? "general",
        entityId: c.entityId,
        entityName: c.entity?.name ?? "",
        title: c.title,
        emoji: c.emoji,
        mood: c.mood,
        summary: c.summary,
        primaryActor: c.primaryActor,
        displayTags: c.displayTags,
        anchorTags: c.anchorTags,
        status: decayed.updatedStatus ?? c.status,
        urgency: decayed.updatedUrgency ?? c.urgency,
        aggregatedData: c.aggregatedData,
        startDate: c.startDate?.toISOString() ?? null,
        endDate: c.endDate?.toISOString() ?? null,
        lastEmailDate: c.lastEmailDate?.toISOString() ?? null,
        lastSenderName: c.lastSenderName,
        lastSenderEntity: c.lastSenderEntity,
        viewedAt: c.viewedAt?.toISOString() ?? null,
        feedbackRating: c.feedbackRating,
        nextActionDate: c.nextActionDate?.toISOString() ?? null,
        emailCount: c.caseEmails.length,
        actions: c.actions.map((a) => ({
          ...a,
          dueDate: a.dueDate?.toISOString() ?? null,
          eventStartTime: a.eventStartTime?.toISOString() ?? null,
          eventEndTime: a.eventEndTime?.toISOString() ?? null,
        })),
      };
    });

    feedCases.sort((a, b) => {
      // Primary: nextActionDate ASC, nulls last
      const aAction = a.nextActionDate
        ? new Date(a.nextActionDate).getTime()
        : Number.MAX_SAFE_INTEGER;
      const bAction = b.nextActionDate
        ? new Date(b.nextActionDate).getTime()
        : Number.MAX_SAFE_INTEGER;
      if (aAction !== bAction) return aAction - bAction;

      // Secondary: lastEmailDate DESC (most recent first)
      const aDate = a.lastEmailDate ? new Date(a.lastEmailDate).getTime() : 0;
      const bDate = b.lastEmailDate ? new Date(b.lastEmailDate).getTime() : 0;
      return bDate - aDate;
    });

    const schemaMetadata = schemas.map((s) => {
      const schemaCases = feedCases.filter((c) => c.schemaId === s.id);
      const entityCounts = s.entities.map((e) => ({
        id: e.id,
        name: e.name,
        caseCount: schemaCases.filter((c) => c.entityId === e.id).length,
        origin: e.origin,
        discoveryScore: e.discoveryScore,
      }));
      // Phase 3 chip-row ordering:
      //   1. User hints first (origin=USER_HINT) — these are the WHATs the
      //      user typed and represent ground truth.
      //   2. Confirmed discoveries second — sort by discoveryScore desc,
      //      then caseCount desc, then name asc for stability.
      // Sort is stable so within each tier the original order is preserved.
      const userHints = entityCounts.filter((e) => e.origin === "USER_HINT");
      const discoveries = entityCounts
        .filter((e) => e.origin !== "USER_HINT")
        .sort((a, b) => {
          const sa = a.discoveryScore ?? 0;
          const sb = b.discoveryScore ?? 0;
          if (sa !== sb) return sb - sa;
          if (a.caseCount !== b.caseCount) return b.caseCount - a.caseCount;
          return a.name.localeCompare(b.name);
        });

      return {
        id: s.id,
        name: s.name,
        domain: s.domain,
        caseCount: schemaCases.length,
        // Legacy `entities` kept for backward compatibility with existing
        // consumers; new consumers should read `hintEntities` + `discoveryEntities`.
        entities: [...userHints, ...discoveries],
        hintEntities: userHints,
        discoveryEntities: discoveries,
      };
    });

    return NextResponse.json({
      data: { cases: feedCases, schemas: schemaMetadata },
    });
  } catch (error) {
    return handleApiError(error, {
      service: "FeedAPI",
      operation: "listFeed",
      userId,
    });
  }
});
