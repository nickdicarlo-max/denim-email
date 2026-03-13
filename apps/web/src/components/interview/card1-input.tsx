"use client";

import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { CardShell } from "../ui/card-shell";
import { Input } from "../ui/input";
import { ProgressDots } from "../ui/progress-dots";
import { DOMAIN_CONFIGS, type DomainId, ROLE_OPTIONS, type RoleId } from "./domain-config";

interface Card1Props {
  onNext: (data: {
    role: string;
    domain: string;
    whats: string[];
    whos: string[];
    goals: string[];
  }) => void;
}

export function Card1Input({ onNext }: Card1Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<RoleId | null>(null);
  const [whats, setWhats] = useState<string[]>([]);
  const [whos, setWhos] = useState<string[]>([]);
  const [currentWhat, setCurrentWhat] = useState("");
  const [currentWho, setCurrentWho] = useState("");
  const [showWho, setShowWho] = useState(false);
  const [goals, setGoals] = useState<string[]>([]);
  const whatRef = useRef<HTMLInputElement>(null);
  const whoRef = useRef<HTMLInputElement>(null);

  const selectedRole = role ? ROLE_OPTIONS.find((r) => r.id === role) : null;
  const domain = selectedRole?.domain as DomainId | undefined;
  const dc = domain ? DOMAIN_CONFIGS[domain] : null;

  const handleSelectRole = (r: (typeof ROLE_OPTIONS)[number]) => {
    setRole(r.id);
    setTimeout(() => {
      setStep(2);
      setTimeout(() => whatRef.current?.focus(), 150);
    }, 200);
  };

  const handleAddWhat = () => {
    const trimmed = currentWhat.trim();
    if (trimmed && !whats.includes(trimmed)) {
      setWhats((prev) => [...prev, trimmed]);
      setCurrentWhat("");
      setTimeout(() => whatRef.current?.focus(), 50);
    }
  };

  const handleAddWho = () => {
    const trimmed = currentWho.trim();
    if (trimmed && !whos.includes(trimmed)) {
      setWhos((prev) => [...prev, trimmed]);
      setCurrentWho("");
      setTimeout(() => whoRef.current?.focus(), 50);
    }
  };

  const handleRemoveWhat = (index: number) =>
    setWhats((prev) => prev.filter((_, i) => i !== index));

  const handleRemoveWho = (index: number) => setWhos((prev) => prev.filter((_, i) => i !== index));

  const toggleGoal = (goalId: string) =>
    setGoals((prev) =>
      prev.includes(goalId) ? prev.filter((g) => g !== goalId) : [...prev, goalId],
    );

  const handleBack = () => {
    setStep(1);
    setRole(null);
    setWhats([]);
    setWhos([]);
    setCurrentWhat("");
    setCurrentWho("");
    setShowWho(false);
    setGoals([]);
  };

  const handleContinue = () => {
    if (!role || !domain) return;
    onNext({ role, domain, whats, whos, goals });
  };

  const canContinue = whats.length >= 1;

  return (
    <CardShell className="flex flex-col h-full p-5 md:p-6 max-w-md mx-auto">
      <ProgressDots current={0} total={4} />

      <div className="flex-1 overflow-auto">
        {/* Header */}
        <div className="mb-4 mt-3">
          <h2 className="text-xl font-bold text-primary mb-1.5 tracking-tight leading-tight">
            {step === 1 ? "Let's organize one topic at a time." : "Name the key players"}
          </h2>
          <p className="text-sm text-secondary leading-snug">
            {step === 1
              ? "First, tell me about yourself."
              : "We'll use these names to search your email. You don't have to list them all."}
          </p>
        </div>

        {/* Step 1: Role selection */}
        {step === 1 ? (
          <div className="flex flex-col gap-1.5">
            {ROLE_OPTIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleSelectRole(r)}
                className="p-3 rounded-md border-[1.5px] border-border bg-white cursor-pointer flex items-center gap-3 hover:border-accent hover:bg-accent-soft transition text-left"
              >
                <span className="text-lg">{r.icon}</span>
                <span className="text-base font-medium text-primary">{r.label}</span>
              </button>
            ))}
          </div>
        ) : (
          /* Step 2: Names (what + who + goals) */
          <div className="animate-fadeIn">
            {/* Role badge - click to go back */}
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-accent-soft text-accent-text text-sm font-medium mb-4 cursor-pointer border border-transparent hover:border-accent transition"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-50"
              >
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
              <span>{selectedRole?.icon}</span>
              {selectedRole?.label}
            </button>

            {dc && (
              <>
                {/* WHAT section */}
                <div className="text-xs font-semibold uppercase tracking-wider text-accent-text mb-1">
                  {dc.whatLabel}
                </div>
                <div className="text-sm text-muted mb-2">{dc.whatHint}</div>

                {whats.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {whats.map((name, i) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent-soft text-accent-text text-sm font-medium"
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() => handleRemoveWhat(i)}
                          className="flex opacity-60 hover:opacity-100 transition cursor-pointer"
                          aria-label={`Remove ${name}`}
                        >
                          <svg
                            aria-hidden="true"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mb-4">
                  <Input
                    ref={whatRef}
                    value={currentWhat}
                    onChange={(e) => setCurrentWhat(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddWhat();
                      }
                    }}
                    placeholder={dc.whatPlaceholder}
                    className="flex-1"
                  />
                  <Button
                    variant="primary"
                    fullWidth={false}
                    onClick={handleAddWhat}
                    disabled={!currentWhat.trim()}
                    className="whitespace-nowrap px-4"
                  >
                    Add
                  </Button>
                </div>

                {/* WHO section - appears after at least one WHAT */}
                {whats.length > 0 && (
                  <>
                    {!showWho ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowWho(true);
                          setTimeout(() => whoRef.current?.focus(), 100);
                        }}
                        className="flex items-center gap-1.5 w-full p-2.5 rounded-md border-[1.5px] border-dashed border-border bg-transparent cursor-pointer text-sm font-medium text-secondary hover:border-warning hover:text-warning-text transition"
                      >
                        <svg
                          aria-hidden="true"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                        Now add some of the people involved (recommended)
                      </button>
                    ) : (
                      <div className="animate-fadeIn">
                        <div className="text-xs font-semibold uppercase tracking-wider text-warning-text mb-1">
                          {dc.whoLabel}
                        </div>
                        <div className="text-sm text-muted mb-2">{dc.whoHint}</div>

                        {whos.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {whos.map((name, i) => (
                              <span
                                key={name}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-warning-soft text-warning-text text-sm font-medium"
                              >
                                {name}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveWho(i)}
                                  className="flex opacity-60 hover:opacity-100 transition cursor-pointer"
                                  aria-label={`Remove ${name}`}
                                >
                                  <svg
                                    aria-hidden="true"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                  </svg>
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Input
                            ref={whoRef}
                            value={currentWho}
                            onChange={(e) => setCurrentWho(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddWho();
                              }
                            }}
                            placeholder={dc.whoPlaceholder}
                            className="flex-1"
                          />
                          <Button
                            variant="primary"
                            fullWidth={false}
                            onClick={handleAddWho}
                            disabled={!currentWho.trim()}
                            className="whitespace-nowrap px-4"
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Reassurance */}
                    <div className="mt-3.5 p-2.5 rounded-md bg-subtle text-sm text-muted leading-snug flex items-start gap-2">
                      <svg
                        aria-hidden="true"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 mt-0.5 text-accent"
                      >
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                      </svg>
                      <span>{dc.reassurance}</span>
                    </div>

                    {/* Goals */}
                    <div className="mt-4">
                      <div className="text-xs font-semibold uppercase tracking-wider text-success-text mb-1.5">
                        What matters most to you?
                      </div>
                      <div className="text-sm text-muted mb-2">
                        Pick any that apply. This helps us know what to surface first.
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {dc.goals.map((g) => {
                          const selected = goals.includes(g.id);
                          return (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => toggleGoal(g.id)}
                              className={[
                                "inline-flex items-center gap-1 px-3 py-1.5 rounded-full border-[1.5px] text-sm font-medium cursor-pointer transition",
                                selected
                                  ? "border-success bg-success-soft text-success-text"
                                  : "border-border bg-white text-secondary hover:border-success hover:text-success-text",
                              ].join(" ")}
                            >
                              <span className="text-sm">{g.icon}</span>
                              {g.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      {canContinue && (
        <div className="mt-3 animate-fadeIn">
          <Button variant="primary" onClick={handleContinue}>
            Continue
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="inline-block ml-2"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Button>
        </div>
      )}
    </CardShell>
  );
}
