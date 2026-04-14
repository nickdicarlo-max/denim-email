"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

/**
 * DISCOVERING — runScan is walking Gmail with the smart-discovery queries
 * to find candidate emails. Shown while scan.phase is PENDING, IDLE, or
 * DISCOVERING.
 */
export function PhaseDiscovering(_: { response: OnboardingPollingResponse }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="material-symbols-outlined text-[40px] text-accent animate-spin">search</span>
      <h1 className="font-serif text-2xl text-primary">Searching your inbox</h1>
      <p className="text-sm text-muted max-w-xs">
        Looking for emails that match what you told us about.
      </p>
    </div>
  );
}
