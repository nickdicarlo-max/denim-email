"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { Button } from "@/components/ui/button";
import { signInWithGmail } from "@/lib/gmail/client/oauth-config";
import { onboardingStorage } from "@/lib/onboarding-storage";
import { createBrowserClient } from "@/lib/supabase/client";

type Status = "idle" | "connecting" | "connected" | "starting" | "slow" | "error";

// `POST /api/onboarding/start` returns in <1s (it only creates a stub row
// and fires an Inngest event). The 90s safety net is kept purely for the
// recovery UI — if the request is still outstanding at 90s, something is
// genuinely wrong (network, 5xx loop, etc.) and we want to surface a
// "taking longer than usual" state rather than leave the user staring.
// Server-side idempotency on the client-supplied ULID (Task 10) makes the
// manual retry safe — it resolves to the same schemaId if the original
// POST already created one.
const START_TIMEOUT_MS = 90 * 1000;

export default function ConnectPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const hypothesisCalledRef = useRef(false);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: validate prerequisites and check for existing auth session.
  // If user is already authenticated (returning from OAuth or adding another topic),
  // skip the Connect Gmail button and go straight to hypothesis generation.
  // provider_token is NOT available in cookie-based SSR sessions after redirect,
  // so we check for session.user instead.
  useEffect(() => {
    const category = onboardingStorage.getCategory();
    const names = onboardingStorage.getNames();
    if (!category || !names) {
      router.replace("/onboarding/category");
      return;
    }

    // Resume-in-place: if a schemaId already exists in sessionStorage, the
    // start call has already happened (or is happening). Skip the POST and
    // jump straight to the observer page so a refresh during the loading
    // state cannot create a duplicate schema (#14). The observer page polls
    // `GET /api/onboarding/:schemaId` which works for any phase including
    // PENDING.
    const existingSchemaId = onboardingStorage.getSchemaId();
    if (existingSchemaId) {
      router.replace(`/onboarding/${existingSchemaId}`);
      return;
    }

    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setStatus("connected");
      }
    });
  }, [router]);

  // When connected, auto-trigger the onboarding start call.
  // We do NOT abort the fetch on unmount/cleanup because React Strict Mode
  // double-invokes effects in dev, which would cancel the in-flight request
  // before the second run sees the ref guard. The startCalledRef ensures
  // we only ever fire one request per page lifetime.
  //
  // Task 14 change: replaced the old `/api/interview/hypothesis` call with
  // `POST /api/onboarding/start` (Task 10). The client now generates a
  // stable ULID up front, persists it to sessionStorage before the POST so
  // a mid-flight refresh resumes against the same id, and sends the raw
  // InterviewInput as the request body. The whole hypothesis + finalize +
  // scan pipeline runs server-side via runOnboarding; the client just
  // routes to `/onboarding/:schemaId` and polls.
  useEffect(() => {
    if (status !== "connected") return;
    if (hypothesisCalledRef.current) return;
    hypothesisCalledRef.current = true;

    const category = onboardingStorage.getCategory();
    const names = onboardingStorage.getNames();
    if (!category || !names) return;

    setStatus("starting");

    // Generate (or reuse) a stable ULID. Persisting it before the POST
    // means a mid-flight refresh hits the "resume-in-place" branch above
    // and navigates straight to the observer page — the server's
    // idempotency guard on the same id makes the second POST a no-op.
    const schemaId = onboardingStorage.getSchemaId() ?? ulid();
    onboardingStorage.setSchemaId(schemaId);

    slowTimerRef.current = setTimeout(() => {
      setStatus((prev) => (prev === "starting" ? "slow" : prev));
    }, START_TIMEOUT_MS);

    const clearSlowTimer = () => {
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current);
        slowTimerRef.current = null;
      }
    };

    const supabase = createBrowserClient();
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!session) throw new Error("No session found");

        return fetch("/api/onboarding/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            schemaId,
            inputs: {
              role: category.role,
              domain: category.domain,
              whats: names.whats,
              whos: names.whos,
              groups: [],
              goals: [],
              ...(names.name ? { name: names.name } : {}),
              ...(category.customDescription
                ? { customDescription: category.customDescription }
                : {}),
            },
          }),
        });
      })
      .then(async (res) => {
        if (!res.ok) {
          // Gmail tokens missing or revoked — show Connect Gmail button
          // instead of an error. The start endpoint returns 422 with
          // type=GMAIL_NOT_CONNECTED when the user has a Supabase session
          // but no valid Gmail tokens.
          if (res.status === 422) {
            const body = await res.json().catch(() => null);
            if (body?.type === "GMAIL_NOT_CONNECTED") {
              clearSlowTimer();
              hypothesisCalledRef.current = false;
              onboardingStorage.clearSchemaId();
              setStatus("idle");
              return null;
            }
          }
          const body = await res.text();
          throw new Error(`Onboarding start failed (${res.status}): ${body}`);
        }
        return res.json();
      })
      .then((json) => {
        if (!json) return; // 422 GMAIL_NOT_CONNECTED — already handled above
        clearSlowTimer();
        router.push(`/onboarding/${schemaId}`);
      })
      .catch((err: unknown) => {
        clearSlowTimer();
        hypothesisCalledRef.current = false;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      });

    return () => {
      clearSlowTimer();
    };
  }, [status, router]);

  const handleConnect = useCallback(() => {
    setStatus("connecting");
    const supabase = createBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/onboarding/connect`;

    signInWithGmail(supabase, redirectTo);
  }, []);

  const handleRetry = useCallback(() => {
    setErrorMessage("");
    hypothesisCalledRef.current = false;
    setStatus("connected");
  }, []);

  // Manual continue from the "slow" state. Resets the call guard so the
  // generating effect re-runs; idempotency on the server (#14) ensures we
  // resolve to the same schemaId rather than creating a duplicate.
  const handleContinueAnyway = useCallback(() => {
    if (slowTimerRef.current) {
      clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
    hypothesisCalledRef.current = false;
    setStatus("connected");
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <OnboardingProgress currentStep={2} totalSteps={5} />

      <div className="flex flex-1 flex-col items-center justify-center w-full max-w-md mx-auto">
        {/* Idle / Connecting */}
        {(status === "idle" || status === "connecting") && (
          <>
            <h1 className="font-serif text-2xl text-primary text-center">Connect your Gmail</h1>
            <p className="text-muted text-center mt-2">
              We&apos;ll scan for emails matching what you entered. Read-only access only.
            </p>

            <div className="mt-8 w-full">
              <Button
                onClick={handleConnect}
                disabled={status === "connecting"}
                className="text-lg px-8 py-4"
              >
                {status === "connecting" ? "Connecting..." : "Connect Gmail"}
              </Button>
            </div>

            {/* Trust signals */}
            <div className="mt-8 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[20px] text-secondary">
                  visibility_off
                </span>
                <span className="text-sm text-muted">
                  Read-only access. We never send, delete, or modify email.
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[20px] text-secondary">lock</span>
                <span className="text-sm text-muted">Your data is encrypted and never shared.</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[20px] text-secondary">
                  filter_alt
                </span>
                <span className="text-sm text-muted">
                  We only look at emails matching your topics.
                </span>
              </div>
            </div>
          </>
        )}

        {/* Connected / Starting */}
        {(status === "connected" || status === "starting") && (
          <div className="flex flex-col items-center gap-4">
            {status === "connected" && (
              <>
                <span className="material-symbols-outlined text-[40px] text-success">
                  check_circle
                </span>
                <p className="text-primary font-medium">Gmail connected! Preparing scan...</p>
              </>
            )}
            {status === "starting" && (
              <>
                <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
                  progress_activity
                </span>
                <p className="text-primary font-medium">Setting up your topic...</p>
              </>
            )}
          </div>
        )}

        {/* Slow — passed the timeout but still working */}
        {status === "slow" && (
          <div className="flex flex-col items-center gap-4 max-w-sm text-center">
            <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
              progress_activity
            </span>
            <p className="text-primary font-medium">This is taking longer than usual</p>
            <p className="text-sm text-muted">
              We&apos;re still setting up your topic. You can keep waiting, or tap continue to
              retry.
            </p>
            <Button onClick={handleContinueAnyway} fullWidth={false} className="mt-2">
              Continue
            </Button>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex flex-col items-center gap-4">
            <span className="material-symbols-outlined text-[40px] text-overdue">error</span>
            <p className="text-primary font-medium text-center">{errorMessage}</p>
            <Button onClick={handleRetry} className="mt-4">
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
