"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Button } from "../ui/button";
import { CardShell } from "../ui/card-shell";
import { ProgressDots } from "../ui/progress-dots";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

interface Card2Props {
  onNext: (authToken: string) => void;
  onBack: () => void;
}

function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 4L12 13L2 4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M5 12L10 17L19 7" />
    </svg>
  );
}

function BackArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4L6 10L12 16" />
    </svg>
  );
}

const PRIVACY_ITEMS = [
  "We read email metadata (sender, subject, date)",
  "We never store full email content",
  "Read-only access — we can never send email",
];

export function Card2GmailConnect({ onNext, onBack }: Card2Props) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const authTokenRef = useRef<string | null>(null);

  // Check if user already has a session with gmail scope (return-from-redirect case)
  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.provider_token && session?.access_token) {
        authTokenRef.current = session.access_token;
        setStatus("connected");

        // Fallback: store tokens server-side if callback didn't
        fetch("/api/auth/store-tokens", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            providerToken: session.provider_token,
            providerRefreshToken: session.provider_refresh_token ?? "",
          }),
        }).catch(() => {
          // Non-fatal: tokens may already be stored from callback
        });
      }
    });
  }, []);

  // Auto-advance after connected
  useEffect(() => {
    if (status !== "connected" || !authTokenRef.current) return;
    const token = authTokenRef.current;
    const timer = setTimeout(() => {
      onNext(token);
    }, 1000);
    return () => clearTimeout(timer);
  }, [status, onNext]);

  async function handleConnect() {
    setStatus("connecting");
    setErrorMessage("");

    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes: "https://www.googleapis.com/auth/gmail.readonly",
          redirectTo: `${window.location.origin}/auth/callback?next=/interview`,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch {
      setStatus("error");
      setErrorMessage("Failed to start Gmail connection. Please try again.");
    }
  }

  return (
    <CardShell className="flex flex-col items-center h-full">
      {/* Back button */}
      <div className="w-full">
        <Button variant="ghost" className="w-auto flex items-center gap-1" onClick={onBack}>
          <BackArrowIcon />
          <span>Back</span>
        </Button>
      </div>

      <ProgressDots current={1} total={4} />

      <div className="flex-1 flex flex-col justify-center items-center text-center max-w-sm px-4">
        {/* Icon */}
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center mb-5 transition-all duration-300 ${
            status === "connected" ? "bg-success-soft text-success" : "bg-accent-soft text-accent"
          }`}
        >
          {status === "connected" ? <CheckIcon /> : <MailIcon />}
        </div>

        {/* Header */}
        <h2 className="text-xl font-bold text-primary tracking-tight mb-2">
          {status === "connected" ? "Gmail connected" : "Connect your Gmail"}
        </h2>
        <p className="text-sm text-secondary mb-6 leading-relaxed">
          {status === "connected"
            ? "Starting to analyze your email..."
            : "We need read-only access to organize your email"}
        </p>

        {/* Privacy section */}
        {status !== "connected" && (
          <div className="w-full flex flex-col gap-2 mb-6">
            {PRIVACY_ITEMS.map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 p-3 rounded-md bg-subtle text-sm text-secondary"
              >
                <div className="w-10 h-10 rounded-full bg-accent-soft flex items-center justify-center text-accent shrink-0">
                  <ShieldIcon />
                </div>
                <span className="text-left">{item}</span>
              </div>
            ))}
          </div>
        )}

        {/* Connect / Try Again / Connecting */}
        {status === "idle" && (
          <Button variant="primary" onClick={handleConnect}>
            <span className="flex items-center justify-center gap-2">
              <MailIcon />
              Connect Gmail
            </span>
          </Button>
        )}

        {status === "connecting" && (
          <Button variant="primary" disabled>
            Connecting...
          </Button>
        )}

        {status === "error" && (
          <div className="w-full flex flex-col items-center gap-3">
            <p className="text-error text-sm">{errorMessage}</p>
            <Button variant="primary" onClick={handleConnect}>
              Try Again
            </Button>
          </div>
        )}
      </div>
    </CardShell>
  );
}
