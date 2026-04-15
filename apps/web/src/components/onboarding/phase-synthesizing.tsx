"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

/**
 * SYNTHESIZING — runSynthesis is calling Claude on each case to produce
 * the title, summary, tags, and action items. `progress.casesTotal`
 * shows how many cases will get a synthesis pass.
 */
export function PhaseSynthesizing({ response }: { response: OnboardingPollingResponse }) {
  const casesTotal = response.progress.casesTotal ?? 0;
  const synthesizedCases = response.progress.synthesizedCases;
  const totalCasesToSynthesize = response.progress.totalCasesToSynthesize ?? 0;
  // Live "N of M" counter (#82): prefer the ticking counter when present,
  // fall back to a static "Summarizing N cases" string for older scans.
  const showLiveCounter =
    synthesizedCases !== undefined && totalCasesToSynthesize > 0;

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
        auto_awesome
      </span>
      <h1 className="font-serif text-2xl text-primary">Writing your cases</h1>
      <p className="text-sm text-muted max-w-xs">
        {showLiveCounter
          ? `Generating case summaries — ${synthesizedCases} of ${totalCasesToSynthesize}`
          : casesTotal > 0
            ? `Summarizing ${casesTotal} ${casesTotal === 1 ? "case" : "cases"}.`
            : "Summarizing each case for your review."}
      </p>
    </div>
  );
}
