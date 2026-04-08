"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { onboardingStorage } from "@/lib/onboarding-storage";
import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * FAILED — terminal error state. Fires the Task 12 retry route
 * (POST /api/onboarding/:schemaId/retry) which re-emits
 * onboarding.session.started. The observer page's next poll tick will
 * pick up the new non-FAILED phase and swap the rendered component.
 *
 * Users can also start over, which clears the sessionStorage draft so
 * the category page doesn't resume against a dead schemaId. The failed
 * schema row itself is left behind for debugging — it isn't archived.
 */
export function PhaseFailed({ response }: { response: OnboardingPollingResponse }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const supabase = createBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch(`/api/onboarding/${response.schemaId}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Retry failed (${res.status})`);
      }
      // Intentional: don't flip `retrying` back — the next poll tick will
      // render a different phase component and this one will unmount.
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
      setRetrying(false);
    }
  }, [response.schemaId]);

  const handleStartOver = useCallback(() => {
    onboardingStorage.clearAll();
    router.push("/onboarding/category");
  }, [router]);

  const errorPhase = response.error?.phase ?? "UNKNOWN";
  const errorMessage = response.error?.message ?? "Something went wrong during setup.";

  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm">
      <span className="material-symbols-outlined text-[40px] text-overdue">error</span>
      <h1 className="font-serif text-2xl text-primary">Setup failed</h1>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">Failed during: {errorPhase}</p>
        <p className="text-sm text-muted break-words">{errorMessage}</p>
      </div>
      {retryError && <p className="text-sm text-overdue">{retryError}</p>}
      <div className="flex flex-col gap-3 w-full">
        <Button onClick={handleRetry} disabled={retrying}>
          {retrying ? "Retrying…" : "Try again"}
        </Button>
        <Button onClick={handleStartOver} variant="secondary" disabled={retrying}>
          Start over
        </Button>
      </div>
    </div>
  );
}
