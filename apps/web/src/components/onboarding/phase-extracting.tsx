"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

/**
 * EXTRACTING — Gemini is pulling structured data (entities, dates, actions)
 * out of the discovered emails. This is the richest progress phase because
 * `progress.emailsTotal` is set at the end of DISCOVERING and
 * `progress.emailsProcessed` ticks up as batches complete.
 *
 * The bar is capped at 95% while still extracting so there's visible motion
 * between "almost done extracting" and "clustering", which is a second
 * phase the user will land on via a phase swap.
 */
export function PhaseExtracting({ response }: { response: OnboardingPollingResponse }) {
  const total = response.progress.emailsTotal ?? 0;
  const processed = response.progress.emailsProcessed ?? 0;
  const percent = total > 0 ? Math.min(95, Math.round((processed / total) * 100)) : 10;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm">
      <h1 className="font-serif text-2xl text-primary text-center">Reading your emails</h1>
      <div className="w-full h-2 bg-surface-highest rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      {total > 0 ? (
        <p className="text-sm text-muted">
          {processed} of {total} emails
        </p>
      ) : (
        <p className="text-sm text-muted">Getting ready…</p>
      )}
    </div>
  );
}
