"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { onboardingStorage } from "@/lib/onboarding-storage";
import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";

/**
 * NO_EMAILS_FOUND — runScan's empty-scan short-circuit fired. Terminal
 * state. The user needs to either broaden their topic or start over.
 * We wipe the sessionStorage onboarding draft on "start over" so the
 * category page doesn't resume the same dead session.
 */
export function PhaseNoEmails(_: { response: OnboardingPollingResponse }) {
  const router = useRouter();

  const handleStartOver = () => {
    onboardingStorage.clearAll();
    router.push("/onboarding/category");
  };

  return (
    <div className="flex flex-col items-center gap-6 text-center max-w-sm">
      <span className="material-symbols-outlined text-[40px] text-muted">inbox</span>
      <h1 className="font-serif text-2xl text-primary">We didn&apos;t find any emails</h1>
      <p className="text-sm text-muted">
        Your inbox doesn&apos;t have emails matching what you described. Try broadening your topic
        or picking a different category.
      </p>
      <Button onClick={handleStartOver} fullWidth={false}>
        Start over
      </Button>
    </div>
  );
}
