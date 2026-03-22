"use client";

import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { CardShell } from "../ui/card-shell";
import { Input } from "../ui/input";
import { ProgressDots } from "../ui/progress-dots";
import { DOMAIN_CONFIGS, type DomainId, ROLE_OPTIONS, type RoleId } from "./domain-config";

interface EntityGroup {
  whats: string[];
  whos: string[];
}

interface Card1Props {
  onNext: (data: {
    role: string;
    domain: string;
    whats: string[];
    whos: string[];
    groups: EntityGroup[];
    sharedWhos?: string[];
    goals: string[];
  }) => void;
}

export function Card1Input({ onNext }: Card1Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<RoleId | null>(null);
  const [groups, setGroups] = useState<EntityGroup[]>([{ whats: [], whos: [] }]);
  const [currentWhats, setCurrentWhats] = useState<Record<number, string>>({});
  const [currentWhos, setCurrentWhos] = useState<Record<number, string>>({});
  const [showWho, setShowWho] = useState<Record<number, boolean>>({});
  const [goals, setGoals] = useState<string[]>([]);
  const [sharedWhos, setSharedWhos] = useState<string[]>([]);
  const [currentSharedWho, setCurrentSharedWho] = useState("");
  const [showSharedWhos, setShowSharedWhos] = useState(false);
  const whatRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const whoRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const sharedWhoRef = useRef<HTMLInputElement | null>(null);

  const selectedRole = role ? ROLE_OPTIONS.find((r) => r.id === role) : null;
  const domain = selectedRole?.domain as DomainId | undefined;
  const dc = domain ? DOMAIN_CONFIGS[domain] : null;

  const handleSelectRole = (r: (typeof ROLE_OPTIONS)[number]) => {
    setRole(r.id);
    setTimeout(() => {
      setStep(2);
      setTimeout(() => whatRefs.current[0]?.focus(), 150);
    }, 200);
  };

  const handleAddWhat = (groupIndex: number) => {
    const trimmed = (currentWhats[groupIndex] ?? "").trim();
    if (!trimmed) return;
    if (groups[groupIndex].whats.includes(trimmed)) return;
    setGroups((prev) =>
      prev.map((g, i) => (i === groupIndex ? { ...g, whats: [...g.whats, trimmed] } : g)),
    );
    setCurrentWhats((prev) => ({ ...prev, [groupIndex]: "" }));
    setTimeout(() => whatRefs.current[groupIndex]?.focus(), 50);
  };

  const handleAddWho = (groupIndex: number) => {
    const trimmed = (currentWhos[groupIndex] ?? "").trim();
    if (!trimmed) return;
    if (groups[groupIndex].whos.includes(trimmed)) return;
    setGroups((prev) =>
      prev.map((g, i) => (i === groupIndex ? { ...g, whos: [...g.whos, trimmed] } : g)),
    );
    setCurrentWhos((prev) => ({ ...prev, [groupIndex]: "" }));
    setTimeout(() => whoRefs.current[groupIndex]?.focus(), 50);
  };

  const handleRemoveWhat = (groupIndex: number, whatIndex: number) =>
    setGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, whats: g.whats.filter((_, j) => j !== whatIndex) } : g,
      ),
    );

  const handleRemoveWho = (groupIndex: number, whoIndex: number) =>
    setGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, whos: g.whos.filter((_, j) => j !== whoIndex) } : g,
      ),
    );

  const handleAddGroup = () => {
    const newIndex = groups.length;
    setGroups((prev) => [...prev, { whats: [], whos: [] }]);
    setTimeout(() => whatRefs.current[newIndex]?.focus(), 150);
  };

  const handleRemoveGroup = (groupIndex: number) => {
    if (groups.length <= 1) return;
    setGroups((prev) => prev.filter((_, i) => i !== groupIndex));
  };

  const toggleGoal = (goalId: string) =>
    setGoals((prev) =>
      prev.includes(goalId) ? prev.filter((g) => g !== goalId) : [...prev, goalId],
    );

  const handleAddSharedWho = () => {
    const trimmed = currentSharedWho.trim();
    if (!trimmed || sharedWhos.includes(trimmed)) return;
    setSharedWhos((prev) => [...prev, trimmed]);
    setCurrentSharedWho("");
    setTimeout(() => sharedWhoRef.current?.focus(), 50);
  };

  const handleRemoveSharedWho = (index: number) =>
    setSharedWhos((prev) => prev.filter((_, i) => i !== index));

  const handleBack = () => {
    setStep(1);
    setRole(null);
    setGroups([{ whats: [], whos: [] }]);
    setCurrentWhats({});
    setCurrentWhos({});
    setShowWho({});
    setSharedWhos([]);
    setCurrentSharedWho("");
    setShowSharedWhos(false);
    setGoals([]);
  };

  const handleContinue = () => {
    if (!role || !domain) return;
    // Filter out empty groups
    const validGroups = groups.filter((g) => g.whats.length > 0);
    // Derive flat lists for backward compat
    const whats = validGroups.flatMap((g) => g.whats);
    const whos = validGroups.flatMap((g) => g.whos);
    onNext({ role, domain, whats, whos, groups: validGroups, sharedWhos: sharedWhos.length > 0 ? sharedWhos : undefined, goals });
  };

  const totalWhats = groups.reduce((sum, g) => sum + g.whats.length, 0);
  const canContinue = totalWhats >= 1;

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
              : "Group the things you track with the people involved. You don't have to list them all."}
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
          /* Step 2: Groups (what + who per group + goals) */
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
                {/* Group cards */}
                {groups.map((group, gi) => (
                  <div
                    key={gi}
                    className="mb-3 p-3 rounded-lg border-[1.5px] border-border bg-white"
                  >
                    {/* Group header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-accent-text">
                        {groups.length > 1 ? `Group ${gi + 1} — ` : ""}{dc.whatLabel}
                      </div>
                      {groups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveGroup(gi)}
                          className="text-xs text-muted hover:text-error transition cursor-pointer"
                          aria-label={`Remove group ${gi + 1}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {/* WHAT pills */}
                    {group.whats.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {group.whats.map((name, wi) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent-soft text-accent-text text-sm font-medium"
                          >
                            {name}
                            <button
                              type="button"
                              onClick={() => handleRemoveWhat(gi, wi)}
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

                    {/* WHAT input */}
                    <div className="flex gap-2 mb-2">
                      <Input
                        ref={(el) => { whatRefs.current[gi] = el; }}
                        value={currentWhats[gi] ?? ""}
                        onChange={(e) =>
                          setCurrentWhats((prev) => ({ ...prev, [gi]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddWhat(gi);
                          }
                        }}
                        placeholder={dc.whatPlaceholder}
                        className="flex-1"
                      />
                      <Button
                        variant="primary"
                        fullWidth={false}
                        onClick={() => handleAddWhat(gi)}
                        disabled={!(currentWhats[gi] ?? "").trim()}
                        className="whitespace-nowrap px-4"
                      >
                        Add
                      </Button>
                    </div>

                    {/* WHO section - appears after at least one WHAT */}
                    {group.whats.length > 0 && (
                      <>
                        {!showWho[gi] ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowWho((prev) => ({ ...prev, [gi]: true }));
                              setTimeout(() => whoRefs.current[gi]?.focus(), 100);
                            }}
                            className="flex items-center gap-1.5 w-full p-2 rounded-md border-[1.5px] border-dashed border-border bg-transparent cursor-pointer text-sm font-medium text-secondary hover:border-warning hover:text-warning-text transition"
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
                            Add people who email you about {group.whats[0] || "this"}
                          </button>
                        ) : (
                          <div className="animate-fadeIn">
                            <div className="text-xs font-semibold uppercase tracking-wider text-warning-text mb-1">
                              {dc.whoLabel}
                            </div>

                            {/* WHO pills */}
                            {group.whos.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {group.whos.map((name, wi) => (
                                  <span
                                    key={name}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-warning-soft text-warning-text text-sm font-medium"
                                  >
                                    {name}
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveWho(gi, wi)}
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

                            {/* WHO input */}
                            <div className="flex gap-2">
                              <Input
                                ref={(el) => { whoRefs.current[gi] = el; }}
                                value={currentWhos[gi] ?? ""}
                                onChange={(e) =>
                                  setCurrentWhos((prev) => ({ ...prev, [gi]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleAddWho(gi);
                                  }
                                }}
                                placeholder={dc.whoPlaceholder}
                                className="flex-1"
                              />
                              <Button
                                variant="primary"
                                fullWidth={false}
                                onClick={() => handleAddWho(gi)}
                                disabled={!(currentWhos[gi] ?? "").trim()}
                                className="whitespace-nowrap px-4"
                              >
                                Add
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}

                {/* Add another group button */}
                {totalWhats >= 1 && (
                  <button
                    type="button"
                    onClick={handleAddGroup}
                    className="flex items-center gap-1.5 w-full p-2.5 rounded-md border-[1.5px] border-dashed border-border bg-transparent cursor-pointer text-sm font-medium text-secondary hover:border-accent hover:text-accent-text transition mb-3"
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
                    Add another group
                  </button>
                )}

                {/* People who email you (ungrouped WHOs) */}
                {totalWhats >= 1 && (
                  <div className="mb-3">
                    {!showSharedWhos ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowSharedWhos(true);
                          setTimeout(() => sharedWhoRef.current?.focus(), 100);
                        }}
                        className="flex items-center gap-1.5 w-full p-2.5 rounded-md border-[1.5px] border-dashed border-warning bg-transparent cursor-pointer text-sm font-medium text-warning-text hover:bg-warning-soft transition"
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
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        Add people who email you about this
                      </button>
                    ) : (
                      <div className="p-3 rounded-lg border-[1.5px] border-warning bg-white animate-fadeIn">
                        <div className="text-xs font-semibold uppercase tracking-wider text-warning-text mb-1.5">
                          People who email you
                        </div>
                        <p className="text-xs text-muted mb-2">
                          Names of people who email you about this topic. We&apos;ll search their emails to discover more.
                        </p>

                        {/* Shared WHO pills */}
                        {sharedWhos.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {sharedWhos.map((name, i) => (
                              <span
                                key={name}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-warning-soft text-warning-text text-sm font-medium"
                              >
                                {name}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSharedWho(i)}
                                  className="flex opacity-60 hover:opacity-100 transition cursor-pointer"
                                  aria-label={`Remove ${name}`}
                                >
                                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                                  </svg>
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Shared WHO input */}
                        <div className="flex gap-2">
                          <Input
                            ref={sharedWhoRef}
                            value={currentSharedWho}
                            onChange={(e) => setCurrentSharedWho(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddSharedWho();
                              }
                            }}
                            placeholder="e.g. Vivek Gupta"
                            className="flex-1"
                          />
                          <Button
                            variant="primary"
                            fullWidth={false}
                            onClick={handleAddSharedWho}
                            disabled={!currentSharedWho.trim()}
                            className="whitespace-nowrap px-4"
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Reassurance + Goals (show after at least one what) */}
                {totalWhats >= 1 && (
                  <>
                    {/* Reassurance */}
                    <div className="p-2.5 rounded-md bg-subtle text-sm text-muted leading-snug flex items-start gap-2">
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
