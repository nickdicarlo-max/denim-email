"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DOMAIN_CONFIGS, type DomainId, ROLE_OPTIONS } from "@/components/interview/domain-config";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { onboardingStorage } from "@/lib/onboarding-storage";

export default function NamesPage() {
  const router = useRouter();
  const [domain, setDomain] = useState<DomainId | null>(null);
  const [roleLabel, setRoleLabel] = useState("");
  const [roleIcon, setRoleIcon] = useState("");

  const [topicName, setTopicName] = useState("");

  const [whats, setWhats] = useState<string[]>([]);
  const [whatInput, setWhatInput] = useState("");

  const [whos, setWhos] = useState<string[]>([]);
  const [whoInput, setWhoInput] = useState("");

  const whatInputRef = useRef<HTMLInputElement>(null);
  const whoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cat = onboardingStorage.getCategory();
    if (!cat) {
      router.replace("/onboarding/category");
      return;
    }
    setDomain(cat.domain as DomainId);
    const role = ROLE_OPTIONS.find((r) => r.id === cat.role);
    if (role) {
      setRoleLabel(role.label);
      setRoleIcon(role.materialIcon);
    }

    // Restore previously saved names if user navigates back
    const saved = onboardingStorage.getNames();
    if (saved) {
      setWhats(saved.whats);
      setWhos(saved.whos);
      if (saved.name) setTopicName(saved.name);
    }
  }, [router]);

  const dc = domain ? DOMAIN_CONFIGS[domain] : null;

  function addWhat() {
    const val = whatInput.trim();
    if (!val || whats.includes(val)) return;
    setWhats((prev) => [...prev, val]);
    setWhatInput("");
    whatInputRef.current?.focus();
  }

  function removeWhat(item: string) {
    setWhats((prev) => prev.filter((w) => w !== item));
  }

  function addWho() {
    const val = whoInput.trim();
    if (!val || whos.includes(val)) return;
    setWhos((prev) => [...prev, val]);
    setWhoInput("");
    whoInputRef.current?.focus();
  }

  function removeWho(item: string) {
    setWhos((prev) => prev.filter((w) => w !== item));
  }

  function handleContinue() {
    const trimmedName = topicName.trim();
    onboardingStorage.setNames({
      whats,
      whos,
      ...(trimmedName ? { name: trimmedName } : {}),
    });
    router.push("/onboarding/connect");
  }

  if (!dc) return null;

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <OnboardingProgress currentStep={1} totalSteps={5} />

      <div className="w-full max-w-2xl mt-8">
        {/* Context badge */}
        <div className="flex justify-center mb-8">
          <button
            type="button"
            onClick={() => router.push("/onboarding/category")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-accent-soft text-accent-text text-sm font-medium cursor-pointer hover:brightness-95 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            <span className="material-symbols-outlined text-[18px]">{roleIcon}</span>
            {roleLabel}
          </button>
        </div>

        {/* Section 0: Topic name (optional) */}
        <h1 className="font-serif text-xl text-primary">Name this topic</h1>
        <p className="text-muted text-sm mt-1">
          Optional. We&apos;ll pick one from what you add if you skip this.
        </p>
        <div className="mt-4">
          <Input
            placeholder="e.g. Client Work, Rental Properties, Kids Activities"
            value={topicName}
            onChange={(e) => setTopicName(e.target.value)}
            maxLength={100}
          />
        </div>

        {/* Section 1: Things */}
        <h2 className="font-serif text-xl text-primary mt-10">Name the things you track</h2>
        <p className="text-muted text-sm mt-1">{dc.whatHint}</p>

        <div className="mt-4 flex gap-2">
          <Input
            ref={whatInputRef}
            placeholder={dc.whatPlaceholder}
            value={whatInput}
            onChange={(e) => setWhatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addWhat();
              }
            }}
          />
          <Button
            variant="secondary"
            fullWidth={false}
            onClick={addWhat}
            disabled={!whatInput.trim()}
          >
            Add
          </Button>
        </div>

        {whats.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {whats.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-soft text-accent-text text-sm font-medium"
              >
                {item}
                <button
                  type="button"
                  onClick={() => removeWhat(item)}
                  className="cursor-pointer hover:opacity-70 transition-opacity"
                  aria-label={`Remove ${item}`}
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Section 2: People (appears after 1+ Things) */}
        {whats.length > 0 && (
          <div className="mt-10">
            <h2 className="font-serif text-xl text-primary">Who emails you about these?</h2>
            <p className="text-muted text-sm mt-1">
              Optional. Just a few names to help us find the rest.
            </p>

            <div className="mt-4 flex gap-2">
              <Input
                ref={whoInputRef}
                placeholder={dc.whoPlaceholder}
                value={whoInput}
                onChange={(e) => setWhoInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addWho();
                  }
                }}
              />
              <Button
                variant="secondary"
                fullWidth={false}
                onClick={addWho}
                disabled={!whoInput.trim()}
              >
                Add
              </Button>
            </div>

            {whos.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {whos.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-upcoming-soft text-upcoming-text text-sm font-medium"
                  >
                    {item}
                    <button
                      type="button"
                      onClick={() => removeWho(item)}
                      className="cursor-pointer hover:opacity-70 transition-opacity"
                      aria-label={`Remove ${item}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Continue button */}
        {whats.length > 0 && (
          <div className="mt-8">
            <Button onClick={handleContinue}>Continue</Button>
          </div>
        )}

        <p className="text-sm text-muted text-center mt-8">Step 2 of 5</p>
      </div>
    </div>
  );
}
