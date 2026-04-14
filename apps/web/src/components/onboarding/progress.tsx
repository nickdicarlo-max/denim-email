"use client";

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
}

export function OnboardingProgress({ currentStep, totalSteps }: OnboardingProgressProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static list of dots, no reordering
          key={i}
          className={[
            "h-1.5 rounded-full transition-all",
            i === currentStep ? "w-8 bg-accent" : "w-2 bg-surface-highest",
          ].join(" ")}
        />
      ))}
    </div>
  );
}
