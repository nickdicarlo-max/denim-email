"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

/**
 * CLUSTERING — runCoarseClustering + runCaseSplitting are grouping the
 * extracted emails into cases via the gravity model. Metrics usually
 * show a full extraction count but no cases yet.
 */
export function PhaseClustering({ response }: { response: OnboardingPollingResponse }) {
  const processed = response.progress.emailsProcessed ?? 0;

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="material-symbols-outlined text-[40px] text-accent animate-spin">hub</span>
      <h1 className="font-serif text-2xl text-primary">Finding connections</h1>
      <p className="text-sm text-muted max-w-xs">
        {processed > 0
          ? `Grouping ${processed} emails into cases.`
          : "Grouping related emails into cases."}
      </p>
    </div>
  );
}
