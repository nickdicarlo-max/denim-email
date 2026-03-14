"use client";

import { useInterviewScan } from "@/hooks/use-interview-scan";
import type { ScanDiscovery } from "@/lib/gmail/types";
import type { HypothesisValidation, SchemaHypothesis } from "@denim/types";
import { useEffect } from "react";
import { Button } from "../ui/button";
import { CardShell } from "../ui/card-shell";
import { ProgressDots } from "../ui/progress-dots";

interface Card3Props {
  hypothesis: SchemaHypothesis;
  authToken: string;
  onNext: (validation: HypothesisValidation, discoveries: ScanDiscovery[]) => void;
  onBack: () => void;
}

function SparkleIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Sparkle"
    >
      <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
    </svg>
  );
}

function SearchIcon() {
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
      role="img"
      aria-label="Search"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21L16.65 16.65" />
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
      role="img"
      aria-label="Back"
    >
      <path d="M12 4L6 10L12 16" />
    </svg>
  );
}

export function Card3Scan({ hypothesis, authToken, onNext, onBack }: Card3Props) {
  const { status, discoveries, validation, error, startScan, abort } = useInterviewScan();
  // Auto-start scan once we have a valid auth token, abort on unmount
  useEffect(() => {
    if (!authToken) return;
    startScan(hypothesis, authToken);
    return () => abort();
  }, [hypothesis, authToken, startScan, abort]);

  // Auto-advance when complete
  useEffect(() => {
    if (status !== "complete" || !validation) return;
    const timer = setTimeout(() => {
      onNext(validation, discoveries);
    }, 800);
    return () => clearTimeout(timer);
  }, [status, validation, discoveries, onNext]);

  // Limit visible discoveries to 15
  const visibleDiscoveries = discoveries.slice(0, 15);

  return (
    <CardShell className="flex flex-col h-full">
      {/* Back button - only show on error */}
      {status === "error" && (
        <div className="w-full">
          <Button
            variant="ghost"
            className="w-auto flex items-center gap-1"
            onClick={() => {
              abort();
              onBack();
            }}
          >
            <BackArrowIcon />
            <span>Back</span>
          </Button>
        </div>
      )}

      <ProgressDots current={2} total={4} />

      {/* Header */}
      <div className="mt-4 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              status === "error" ? "bg-error-soft text-error" : "bg-accent-soft text-accent"
            } ${status === "scanning" || status === "validating" ? "animate-pulse" : ""}`}
          >
            {status === "validating" ? <SparkleIcon /> : <SearchIcon />}
          </div>
          <h2 className="text-xl font-bold text-primary tracking-tight">
            {status === "scanning" && "Scanning your email..."}
            {status === "validating" && "Analyzing patterns..."}
            {status === "complete" && "Analysis complete"}
            {status === "error" && "Scan failed"}
            {status === "idle" && "Preparing scan..."}
          </h2>
        </div>
        <p className="text-sm text-secondary leading-relaxed">
          {status === "scanning" && "Searching your recent emails for matches"}
          {status === "validating" && "AI is refining your schema with real email data"}
          {status === "complete" && "Building your schema..."}
          {status === "error" && (error ?? "Something went wrong")}
          {status === "idle" && "Getting ready to scan your email"}
        </p>
      </div>

      {/* Progress bar for scanning/validating */}
      {(status === "scanning" || status === "validating") && (
        <div className="mb-5">
          <div className="h-1.5 bg-accent-soft rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                status === "validating" ? "bg-accent w-4/5" : "bg-accent w-2/5"
              }`}
            />
          </div>
        </div>
      )}

      {status === "complete" && (
        <div className="mb-5">
          <div className="h-1.5 bg-success-soft rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-success w-full transition-all duration-300" />
          </div>
        </div>
      )}

      {/* Discovery list */}
      {visibleDiscoveries.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2.5">
            Sender Domains Found
          </div>
          <div className="flex flex-col gap-1.5">
            {visibleDiscoveries.map((d) => (
              <div
                key={d.domain}
                className="flex justify-between items-center px-3 py-2.5 rounded-md border border-border bg-white animate-fadeIn"
              >
                <div>
                  <div className="text-sm font-medium text-primary">{d.label}</div>
                  <div className="text-xs text-muted">{d.domain}</div>
                </div>
                <div className="text-sm font-semibold font-mono text-accent-text bg-accent-soft px-2 py-0.5 rounded-full">
                  {d.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state during scanning before discoveries arrive */}
      {visibleDiscoveries.length === 0 && status === "scanning" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted">Discovering email patterns...</p>
        </div>
      )}

      {/* Error actions */}
      {status === "error" && (
        <div className="mt-auto pt-4 flex flex-col gap-3">
          <Button variant="primary" onClick={() => startScan(hypothesis, authToken)}>
            Try Again
          </Button>
        </div>
      )}
    </CardShell>
  );
}
