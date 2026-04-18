"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { signInWithGmail } from "@/lib/gmail/oauth-config";
import { onboardingStorage } from "@/lib/onboarding-storage";
import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * FAILED — terminal error state. Fires the Task 12 retry route
 * (POST /api/onboarding/:schemaId/retry) which re-emits
 * onboarding.session.started. The observer page's next poll tick will
 * pick up the new non-FAILED phase and swap the rendered component.
 *
 * Credential failures (expired/revoked Google tokens, missing scope) get
 * special treatment: instead of "Try again" (which would fail identically),
 * the user sees a "Reconnect Google" button that re-triggers the OAuth flow.
 * We branch on the TYPED `response.credentialFailure.remedy` field now —
 * previously this was a string-match against `error.message`, which silently
 * broke whenever the server-side error message text changed (see #105 Bug 2
 * class).
 *
 * Users can also start over, which clears the sessionStorage draft so
 * the category page doesn't resume against a dead schemaId. The failed
 * schema row itself is left behind for debugging — it isn't archived.
 */

export function PhaseFailed({ response }: { response: OnboardingPollingResponse }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const errorPhase = response.error?.phase ?? "UNKNOWN";
  const errorMessage = response.error?.message ?? "Something went wrong during setup.";
  // Typed field -- present when server classified this as a credential
  // failure. remedy === "reconnect" means OAuth is the only way forward.
  const credentialFailure = response.credentialFailure;
  const authError = credentialFailure?.remedy === "reconnect";

  const handleReconnect = useCallback(() => {
    const supabase = createBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/onboarding/${response.schemaId}`;
    signInWithGmail(supabase, redirectTo);
  }, [response.schemaId]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await authenticatedFetch(`/api/onboarding/${response.schemaId}/retry`, {
        method: "POST",
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

  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm">
      <span className="material-symbols-outlined text-[40px] text-overdue">
        {authError ? "link_off" : "error"}
      </span>
      <h1 className="font-serif text-2xl text-primary">
        {authError ? "Google connection lost" : "Setup failed"}
      </h1>
      <div className="flex flex-col gap-1">
        {authError ? (
          <p className="text-sm text-muted">
            Your Google account needs to be reconnected. This can happen when permissions expire or
            are revoked.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">Failed during: {errorPhase}</p>
            <p className="text-sm text-muted break-words">{errorMessage}</p>
          </>
        )}
      </div>
      {retryError && <p className="text-sm text-overdue">{retryError}</p>}
      <div className="flex flex-col gap-3 w-full">
        {authError ? (
          <>
            <Button onClick={handleReconnect}>Reconnect Google</Button>
            <Button onClick={handleRetry} variant="secondary" disabled={retrying}>
              {retrying ? "Retrying…" : "Try again anyway"}
            </Button>
          </>
        ) : (
          <Button onClick={handleRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Try again"}
          </Button>
        )}
        <Button onClick={handleStartOver} variant="secondary" disabled={retrying}>
          Start over
        </Button>
      </div>
    </div>
  );
}
