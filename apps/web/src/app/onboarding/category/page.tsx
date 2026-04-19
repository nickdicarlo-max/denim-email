"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLE_OPTIONS } from "@/components/interview/domain-config";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { onboardingStorage } from "@/lib/onboarding-storage";

export default function CategoryPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [customDescription, setCustomDescription] = useState("");

  function handleContinue() {
    const role = ROLE_OPTIONS.find((r) => r.id === selected);
    if (!role) return;

    // Issue #113 safety net: if the user changed category (either by starting a
    // new topic or backing up and picking a different role), drop any prior
    // whats/whos — they were entered under a different domain's prompts and
    // examples. The "Add Topic" entry points already call clearAll(), but this
    // guards against direct navigation, refresh, or mid-flow category changes.
    const prior = onboardingStorage.getCategory();
    if (prior && (prior.role !== role.id || prior.domain !== role.domain)) {
      onboardingStorage.setNames({ whats: [], whos: [] });
      onboardingStorage.clearSchemaId();
    }

    onboardingStorage.setCategory({
      role: role.id,
      domain: role.domain,
      ...(role.id === "other" && customDescription.trim()
        ? { customDescription: customDescription.trim() }
        : {}),
    });

    router.push("/onboarding/names");
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <OnboardingProgress currentStep={0} totalSteps={5} />

      <div className="w-full max-w-2xl mt-8">
        <h1 className="font-serif text-2xl text-primary text-center">
          What do you want to organize?
        </h1>
        <p className="text-muted text-center mt-2">
          Pick one area. You&apos;ll add more topics later.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {ROLE_OPTIONS.map((r) => {
            const isSelected = selected === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                className={[
                  "w-full p-5 rounded-lg bg-white text-left transition-all cursor-pointer",
                  "hover:shadow-lg",
                  isSelected ? "bg-accent-soft ring-2 ring-accent" : "ring-1 ring-border",
                ].join(" ")}
              >
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-accent text-[28px]">
                    {r.materialIcon}
                  </span>
                  <div>
                    <div className="font-semibold text-primary">{r.label}</div>
                    <div className="text-sm text-muted">{r.description}</div>
                  </div>
                </div>

                {r.id === "other" && isSelected && (
                  <Input
                    className="mt-4"
                    placeholder="Describe what you want to organize..."
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                )}
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="mt-8">
            <Button onClick={handleContinue}>Continue</Button>
          </div>
        )}

        <p className="text-sm text-muted text-center mt-8">Step 1 of 5</p>
      </div>
    </div>
  );
}
