"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

/**
 * GENERATING_HYPOTHESIS — Claude is turning the interview answers into a
 * schema hypothesis. The longest pre-scan phase (~20–30s in practice).
 */
export function PhaseGenerating(_: { response: OnboardingPollingResponse }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
        progress_activity
      </span>
      <h1 className="font-serif text-2xl text-primary">Thinking about your topic</h1>
      <p className="text-sm text-muted max-w-xs">
        We&apos;re figuring out what to look for in your inbox.
      </p>
    </div>
  );
}
