"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type EntityData, ReviewEntities } from "@/components/onboarding/review-entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { onboardingStorage } from "@/lib/onboarding-storage";
import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

/**
 * AWAITING_REVIEW — the human checkpoint. Lifted from the previous
 * standalone `apps/web/src/app/onboarding/review/page.tsx`, with two
 * changes:
 *
 * 1. Submit target is now `POST /api/onboarding/:schemaId` (Task 11's
 *    review-confirmation handler) instead of `/api/interview/review-finalize`.
 *    The handler CAS-flips `phase=AWAITING_REVIEW → COMPLETED` +
 *    `status=ACTIVE` + `name=<topicName>` in a single updateMany, and
 *    applies entity toggles in a transaction.
 *
 * 2. After a successful submit we do NOT navigate directly. The observer
 *    page's next poll tick will receive `phase=COMPLETED` + `nextHref` and
 *    push the router itself, which keeps all navigation decisions in one
 *    place.
 *
 * The schema row is still loaded separately via `GET /api/schemas/:schemaId`
 * — the OnboardingPollingResponse shape doesn't carry entity detail, only
 * phase/progress.
 */

type ReviewStatus = "loading" | "ready" | "finalizing" | "error";

interface RawEntity {
  id: string;
  name: string;
  type: string;
  autoDetected: boolean;
  emailCount: number;
  aliases: unknown;
  isActive: boolean;
  confidence: number;
  likelyAliasOf: string | null;
  aliasConfidence: number | null;
  aliasReason: string | null;
}

export function PhaseReview({ response }: { response: OnboardingPollingResponse }) {
  const fetchCalledRef = useRef(false);

  const [status, setStatus] = useState<ReviewStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [entities, setEntities] = useState<EntityData[]>([]);
  const [topicName, setTopicName] = useState("");
  const [userThings] = useState<string[]>(() => onboardingStorage.getNames()?.whats ?? []);

  // Load name + entities for the review UI. Only runs once — subsequent
  // polling ticks will re-render this component with a new `response` prop
  // but we keep the locally-loaded entity state to preserve the user's
  // in-progress toggles.
  useEffect(() => {
    if (fetchCalledRef.current) return;
    fetchCalledRef.current = true;

    const run = async () => {
      try {
        const res = await authenticatedFetch(`/api/schemas/${response.schemaId}`);
        if (!res.ok) throw new Error(`Failed to load schema (${res.status})`);

        const json = (await res.json()) as {
          data: { name: string; entities: RawEntity[] };
        };

        setTopicName(json.data.name);
        setEntities(
          json.data.entities.map((e) => ({
            id: e.id,
            name: e.name,
            type: e.type as "PRIMARY" | "SECONDARY",
            autoDetected: e.autoDetected,
            emailCount: e.emailCount,
            aliases: parseAliases(e.aliases),
            isActive: e.isActive,
            confidence: e.confidence ?? 1.0,
            likelyAliasOf: e.likelyAliasOf ?? null,
            aliasConfidence: e.aliasConfidence ?? null,
            aliasReason: e.aliasReason ?? null,
          })),
        );
        setStatus("ready");
      } catch (err) {
        fetchCalledRef.current = false;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to load review data");
      }
    };
    void run();
  }, [response.schemaId]);

  const handleToggleEntity = useCallback((entityId: string, active: boolean) => {
    setEntities((prev) => prev.map((e) => (e.id === entityId ? { ...e, isActive: active } : e)));
  }, []);

  const handleFinalize = useCallback(async () => {
    setStatus("finalizing");
    setErrorMessage("");
    try {
      const entityToggles = entities.map((e) => ({ id: e.id, isActive: e.isActive }));

      const res = await authenticatedFetch(`/api/onboarding/${response.schemaId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topicName: topicName.trim(), entityToggles }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Finalize failed (${res.status})`);
      }

      // Clear the sessionStorage draft now that the schema is ACTIVE.
      // Navigation happens on the next poll tick via the observer page.
      onboardingStorage.clearAll();
      // Leave status === "finalizing" so the CTA stays disabled until the
      // poll tick swaps the component out.
    } catch (err) {
      setStatus("ready");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [entities, response.schemaId, topicName]);

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
          progress_activity
        </span>
        <p className="text-sm text-muted">Loading review…</p>
      </div>
    );
  }

  if (status === "error" && entities.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <span className="material-symbols-outlined text-[40px] text-overdue">error</span>
        <p className="text-primary font-medium">{errorMessage}</p>
        <Button
          onClick={() => {
            setStatus("loading");
            fetchCalledRef.current = false;
            setEntities([]);
          }}
          fullWidth={false}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl text-primary">Here&apos;s what we found</h1>
      <p className="text-muted text-sm mt-1">Confirm what looks right. Tap to change.</p>

      <div className="mt-6">
        <ReviewEntities
          userThings={userThings}
          entities={entities}
          onToggleEntity={handleToggleEntity}
        />
      </div>

      <div className="mt-8">
        <label htmlFor="topic-name" className="block text-sm font-medium text-primary mb-2">
          Name this topic
        </label>
        <Input
          id="topic-name"
          value={topicName}
          onChange={(e) => setTopicName(e.target.value)}
          placeholder="e.g. My Projects"
        />
      </div>

      {errorMessage && status === "ready" && (
        <p className="mt-3 text-sm text-overdue">{errorMessage}</p>
      )}

      <div className="mt-8">
        <Button onClick={handleFinalize} disabled={status === "finalizing" || !topicName.trim()}>
          {status === "finalizing" ? "Setting up…" : "Show me my cases!"}
        </Button>
      </div>
    </div>
  );
}

function parseAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
