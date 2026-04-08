"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

/**
 * PENDING — the workflow row exists but runOnboarding hasn't picked it up
 * yet. Usually visible for <1s; acts as the default "initializing" screen.
 */
export function PhasePending(_: { response: OnboardingPollingResponse }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
        progress_activity
      </span>
      <h1 className="font-serif text-2xl text-primary">Getting started</h1>
      <p className="text-sm text-muted">Claiming your onboarding session…</p>
    </div>
  );
}
