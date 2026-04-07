"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { Button } from "@/components/ui/button";
import { onboardingStorage } from "@/lib/onboarding-storage";
import { createBrowserClient } from "@/lib/supabase/client";

type Status = "idle" | "connecting" | "connected" | "generating" | "error";

export default function ConnectPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const hypothesisCalledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

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

    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setStatus("connected");
      }
    });
  }, [router]);

  // When connected, auto-trigger hypothesis generation.
  // We do NOT abort the fetch on unmount/cleanup because React Strict Mode
  // double-invokes effects in dev, which would cancel the in-flight request
  // before the second run sees the ref guard. The hypothesisCalledRef ensures
  // we only ever fire one request per page lifetime.
  useEffect(() => {
    if (status !== "connected") return;
    if (hypothesisCalledRef.current) return;
    hypothesisCalledRef.current = true;

    const category = onboardingStorage.getCategory();
    const names = onboardingStorage.getNames();
    if (!category || !names) return;

    setStatus("generating");

    const supabase = createBrowserClient();
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!session) throw new Error("No session found");

        return fetch("/api/interview/hypothesis", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            role: category.role,
            domain: category.domain,
            whats: names.whats,
            whos: names.whos,
            groups: [],
            goals: [],
            ...(category.customDescription
              ? { customDescription: category.customDescription }
              : {}),
          }),
        });
      })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Hypothesis generation failed (${res.status}): ${body}`);
        }
        return res.json();
      })
      .then((data: { data?: { schemaId?: string }; schemaId?: string }) => {
        // The API returns { data: hypothesis } where hypothesis includes schemaId.
        const schemaId = data.data?.schemaId ?? data.schemaId;
        if (!schemaId) {
          throw new Error("Schema ID missing from hypothesis response");
        }
        onboardingStorage.setSchemaId(schemaId);
        router.push("/onboarding/scanning");
      })
      .catch((err: unknown) => {
        hypothesisCalledRef.current = false;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      });
  }, [status, router]);

  const handleConnect = useCallback(() => {
    setStatus("connecting");
    const supabase = createBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/onboarding/connect`;

    supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: "https://www.googleapis.com/auth/gmail.readonly",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
  }, []);

  const handleRetry = useCallback(() => {
    setErrorMessage("");
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

        {/* Connected / Generating */}
        {(status === "connected" || status === "generating") && (
          <div className="flex flex-col items-center gap-4">
            {status === "connected" && (
              <>
                <span className="material-symbols-outlined text-[40px] text-success">
                  check_circle
                </span>
                <p className="text-primary font-medium">Gmail connected! Preparing scan...</p>
              </>
            )}
            {status === "generating" && (
              <>
                <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
                  progress_activity
                </span>
                <p className="text-primary font-medium">Setting up your topic...</p>
              </>
            )}
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
