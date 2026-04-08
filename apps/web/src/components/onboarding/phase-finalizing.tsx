"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

/**
 * FINALIZING_SCHEMA — persistSchemaRelations is writing the hypothesis
 * into CaseSchema, Entity, EntityGroup, SchemaTag, etc. Usually <2s.
 */
export function PhaseFinalizing(_: { response: OnboardingPollingResponse }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
        progress_activity
      </span>
      <h1 className="font-serif text-2xl text-primary">Saving your schema</h1>
      <p className="text-sm text-muted">Almost ready to start scanning…</p>
    </div>
  );
}
