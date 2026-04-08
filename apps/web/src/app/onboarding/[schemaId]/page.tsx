"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OnboardingFlow } from "@/components/onboarding/flow";
import { OnboardingProgress } from "@/components/onboarding/progress";
import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * OnboardingObserverPage — single polling page that drives the whole
 * post-connect onboarding flow. Polls `GET /api/onboarding/:schemaId`
 * on a 2s interval and hands the merged response to `<OnboardingFlow>`,
 * which picks the right per-phase component.
 *
 * On `phase=COMPLETED` (server has flipped `status=ACTIVE` after the
 * review-confirm POST, or the schema arrived in that state on first
 * load), the page navigates to `response.nextHref` — `/feed?schema=:id`.
 *
 * Cancellation is handled inside the poll callback via a `cancelled`
 * closure flag rather than a ref, because the effect re-runs on
 * `schemaId` changes and each run needs its own flag.
 *
 * There is no AbortController here because:
 *   - the response is small (<1KB JSON),
 *   - a fetch mid-flight during unmount is a 2s window at most, and
 *   - the cancelled flag prevents any state updates after unmount, so
 *     there's no React warning to chase.
 */

const POLL_INTERVAL_MS = 2000;

export default function OnboardingObserverPage() {
  const router = useRouter();
  const params = useParams<{ schemaId: string }>();
  const schemaId = params?.schemaId;

  const [response, setResponse] = useState<OnboardingPollingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (!schemaId) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const supabase = createBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session) {
          setError("Not authenticated");
          return;
        }

        const res = await fetch(`/api/onboarding/${schemaId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (cancelled) return;

        if (res.status === 404) {
          setError("Onboarding session not found");
          return;
        }
        if (res.status === 403) {
          setError("Forbidden");
          return;
        }
        if (!res.ok) {
          // Transient — next tick will retry.
          return;
        }

        const json = (await res.json()) as { data: OnboardingPollingResponse };
        if (cancelled) return;
        setResponse(json.data);

        // Terminal: flip to the destination href. Guard against double-
        // navigation if the interval fires again before the router
        // transition finishes.
        if (json.data.phase === "COMPLETED" && json.data.nextHref && !navigatedRef.current) {
          navigatedRef.current = true;
          router.push(json.data.nextHref);
        }
      } catch {
        // Silent retry on next tick.
      }
    };

    // Immediate fetch, then interval.
    void poll();
    intervalId = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [schemaId, router]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <p className="text-sm text-overdue">{error}</p>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <OnboardingProgress currentStep={3} totalSteps={5} />
      <div className="flex flex-1 flex-col items-center justify-center w-full max-w-2xl mx-auto">
        <OnboardingFlow response={response} />
      </div>
    </div>
  );
}
