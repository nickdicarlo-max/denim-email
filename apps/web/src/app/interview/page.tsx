"use client";

import { Card1Input } from "@/components/interview/card1-input";
import { Card2GmailConnect } from "@/components/interview/card2-gmail-connect";
import { Card3Scan } from "@/components/interview/card3-scan";
import { Card4Review } from "@/components/interview/card4-review";
import { useInterviewFlow } from "@/hooks/use-interview-flow";
import { createBrowserClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

export default function InterviewPage() {
  const flow = useInterviewFlow();
  const [authToken, setAuthToken] = useState<string | null>(null);

  // Elapsed timer for generating/finalizing overlays
  const [elapsedMs, setElapsedMs] = useState(0);
  const isTimerActive = flow.step === "generating" || flow.step === "finalizing";

  useEffect(() => {
    if (!isTimerActive) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimerActive]);

  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  // Listen for auth state (e.g., returning from OAuth redirect)
  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        setAuthToken(session.access_token);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        setAuthToken(session.access_token);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-md">
        {/* Card 1: Input (no auth needed) */}
        {flow.step === "input" && (
          <Card1Input
            onNext={(data) => {
              flow.submitInput(data);
            }}
          />
        )}

        {/* Card 2: Gmail Connect */}
        {(flow.step === "gmail_connect" || flow.step === "generating") && (
          <Card2GmailConnect
            onNext={(token) => {
              flow.onGmailConnected(token);
            }}
            onBack={flow.goBack}
          />
        )}

        {/* Generating overlay (shows over Card 2 while hypothesis is being generated) */}
        {flow.step === "generating" && (
          <div className="fixed inset-0 bg-overlay flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 text-center shadow-xl">
              <div className="animate-pulse text-accent mb-3">
                <svg
                  aria-hidden="true"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="mx-auto"
                >
                  <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
                </svg>
              </div>
              <p className="text-sm text-secondary">Generating your schema...</p>
              <p className="text-xs text-muted mt-1">{elapsedSeconds}s elapsed</p>
              {elapsedSeconds >= 5 && (
                <button
                  type="button"
                  onClick={flow.goBack}
                  className="mt-3 text-xs font-medium text-accent-text hover:opacity-70 transition"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Card 3: Scan */}
        {flow.step === "scanning" && flow.hypothesis && (
          <Card3Scan
            hypothesis={flow.hypothesis}
            authToken={authToken ?? ""}
            onNext={flow.onScanComplete}
            onBack={flow.goBack}
          />
        )}

        {/* Card 4: Review */}
        {(flow.step === "review" || flow.step === "finalizing") &&
          flow.hypothesis &&
          flow.validation && (
            <Card4Review
              hypothesis={flow.hypothesis}
              validation={flow.validation}
              discoveries={flow.discoveries}
              isLoading={flow.step === "finalizing"}
              onFinalize={flow.onFinalize}
              onBack={flow.goBack}
            />
          )}

        {/* Finalizing overlay */}
        {flow.step === "finalizing" && (
          <div className="fixed inset-0 bg-overlay flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 text-center shadow-xl">
              <div className="animate-pulse text-accent mb-3">
                <svg
                  aria-hidden="true"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="mx-auto"
                >
                  <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
                </svg>
              </div>
              <p className="text-sm text-secondary">Creating your schema...</p>
              <p className="text-xs text-muted mt-1">{elapsedSeconds}s elapsed</p>
            </div>
          </div>
        )}

        {/* Complete */}
        {flow.step === "complete" && (
          <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-success-soft flex items-center justify-center mb-4">
              <svg
                aria-hidden="true"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="text-success"
              >
                <path d="M5 12L10 17L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-primary mb-2">You're all set!</h2>
            <p className="text-sm text-secondary mb-6">
              Your email is being organized. We'll notify you when it's ready.
            </p>
            <p className="text-xs text-muted">Schema ID: {flow.schemaId}</p>
          </div>
        )}

        {/* Error toast */}
        {flow.error && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-primary text-inverse px-4 py-2.5 rounded-full text-sm shadow-lg z-50 animate-fadeIn">
            {flow.error}
          </div>
        )}
      </div>
    </div>
  );
}
