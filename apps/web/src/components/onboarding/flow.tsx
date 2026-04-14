"use client";

import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";
import { PhaseClustering } from "./phase-clustering";
import { PhaseDiscovering } from "./phase-discovering";
import { PhaseExtracting } from "./phase-extracting";
import { PhaseFailed } from "./phase-failed";
import { PhaseGenerating } from "./phase-generating";
import { PhaseNoEmails } from "./phase-no-emails";
import { PhasePending } from "./phase-pending";
import { PhaseReview } from "./phase-review";
import { PhaseSynthesizing } from "./phase-synthesizing";

/**
 * OnboardingFlow — single switch component that maps the flat polling
 * `phase` to one of the per-phase subcomponents. Replaces the multi-page
 * O1..O5 flow (scanning page, review page, etc.).
 *
 * COMPLETED returns null because the observer page itself listens for
 * that state and navigates to `response.nextHref` — rendering nothing
 * during the handoff avoids a brief flash of stale content before the
 * router.push() lands.
 */
export function OnboardingFlow({ response }: { response: OnboardingPollingResponse }) {
  switch (response.phase) {
    case "PENDING":
      return <PhasePending response={response} />;
    case "GENERATING_HYPOTHESIS":
      return <PhaseGenerating response={response} />;
    case "DISCOVERING":
      return <PhaseDiscovering response={response} />;
    case "EXTRACTING":
      return <PhaseExtracting response={response} />;
    case "CLUSTERING":
      return <PhaseClustering response={response} />;
    case "SYNTHESIZING":
      return <PhaseSynthesizing response={response} />;
    case "AWAITING_REVIEW":
      return <PhaseReview response={response} />;
    case "NO_EMAILS_FOUND":
      return <PhaseNoEmails response={response} />;
    case "FAILED":
      return <PhaseFailed response={response} />;
    case "COMPLETED":
      return null;
  }
}
