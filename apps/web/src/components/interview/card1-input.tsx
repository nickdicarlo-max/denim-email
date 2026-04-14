"use client";

import { useRef, useState } from "react";
import { Button } from "../ui/button";
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
    const validGroups = groups.filter((g) => g.whats.length > 0);
    const whats = validGroups.flatMap((g) => g.whats);
    const whos = validGroups.flatMap((g) => g.whos);
    onNext({
      role,
      domain,
      whats,
      whos,
      groups: validGroups,
      sharedWhos: sharedWhos.length > 0 ? sharedWhos : undefined,
      goals,
    });
  };

  const totalWhats = groups.reduce((sum, g) => sum + g.whats.length, 0);
  const canContinue = totalWhats >= 1;

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Top bar */}
      <div className="px-6 pt-6 pb-4 max-w-2xl mx-auto w-full">
        <ProgressDots current={0} total={4} />
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-auto px-6 pb-8 max-w-2xl mx-auto w-full">
        {step === 1 ? (
          /* ─── Step 1: Pick a Category ─── */
          <div className="animate-fadeIn">
            {/* Editorial headline */}
            <div className="mb-8 md:mb-10">
              <h1 className="font-serif text-2xl md:text-[32px] md:leading-[40px] font-bold text-primary tracking-wide mb-3">
                What would you like to organize?
              </h1>
              <p className="text-base text-secondary leading-relaxed">
                Pick the category that best describes the emails you want to turn into actionable
                cases.
              </p>
            </div>

            {/* Category cards */}
            <div className="grid gap-3 md:grid-cols-2 md:gap-4">
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleSelectRole(r)}
                  className="group relative p-5 md:p-6 rounded-lg bg-white text-left cursor-pointer transition-all hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]"
                >
                  {/* Icon */}
                  <span className="material-symbols-outlined text-accent text-[28px] mb-3 block">
                    {r.materialIcon}
                  </span>
                  {/* Label */}
                  <h3 className="text-md font-semibold text-primary mb-1">{r.label}</h3>
                  {/* Description */}
                  <p className="text-sm text-secondary">{r.description}</p>
                </button>
              ))}
            </div>

            {/* Step indicator */}
            <p className="text-center text-xs text-muted mt-8 tracking-widest uppercase">
              Step 1 of 3
            </p>
          </div>
        ) : (
          /* ─── Step 2: Things + People ─── */
          <div className="animate-fadeIn">
            {/* Editorial headline */}
            <div className="mb-6">
              <h1 className="font-serif text-xl md:text-2xl font-bold text-primary tracking-wide mb-2">
                Name the key players
              </h1>
              <p className="text-base text-secondary leading-relaxed">
                Group the things you track with the people involved. You don't have to list them
                all.
              </p>
            </div>

            {/* Role badge — click to go back */}
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-accent-soft text-accent-text text-sm font-medium mb-6 cursor-pointer transition-all hover:bg-accent-container"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              <span className="material-symbols-outlined text-[18px]">
                {selectedRole?.materialIcon}
              </span>
              {selectedRole?.label}
            </button>

            {dc && (
              <>
                {/* Group cards */}
                {groups.map((group, gi) => (
                  <div key={gi} className="mb-4 p-5 md:p-6 rounded-lg bg-white">
                    {/* Group header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs font-semibold uppercase tracking-widest text-accent-text">
                        {groups.length > 1 ? `Group ${gi + 1} — ` : ""}
                        {dc.whatLabel}
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
                      <div className="flex flex-wrap gap-2 mb-3">
                        {group.whats.map((name, wi) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-soft text-accent-text text-sm font-medium"
                          >
                            {name}
                            <button
                              type="button"
                              onClick={() => handleRemoveWhat(gi, wi)}
                              className="flex opacity-60 hover:opacity-100 transition cursor-pointer"
                              aria-label={`Remove ${name}`}
                            >
                              <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* WHAT input */}
                    <div className="flex gap-2 mb-3">
                      <Input
                        ref={(el) => {
                          whatRefs.current[gi] = el;
                        }}
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
                        className="whitespace-nowrap px-5"
                      >
                        Add
                      </Button>
                    </div>

                    {/* WHO section */}
                    {group.whats.length > 0 && (
                      <>
                        {!showWho[gi] ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowWho((prev) => ({ ...prev, [gi]: true }));
                              setTimeout(() => whoRefs.current[gi]?.focus(), 100);
                            }}
                            className="flex items-center gap-2 w-full p-3 rounded-sm bg-surface-mid text-sm font-medium text-secondary cursor-pointer hover:text-upcoming-text hover:bg-upcoming-soft transition-all"
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              person_add
                            </span>
                            Add people who email you about {group.whats[0] || "this"}
                          </button>
                        ) : (
                          <div className="animate-fadeIn">
                            <div className="text-xs font-semibold uppercase tracking-widest text-upcoming-text mb-2">
                              {dc.whoLabel}
                            </div>

                            {/* WHO pills */}
                            {group.whos.length > 0 && (
                              <div className="flex flex-wrap gap-2 mb-3">
                                {group.whos.map((name, wi) => (
                                  <span
                                    key={name}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-upcoming-soft text-upcoming-text text-sm font-medium"
                                  >
                                    {name}
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveWho(gi, wi)}
                                      className="flex opacity-60 hover:opacity-100 transition cursor-pointer"
                                      aria-label={`Remove ${name}`}
                                    >
                                      <span className="material-symbols-outlined text-[16px]">
                                        close
                                      </span>
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* WHO input */}
                            <div className="flex gap-2">
                              <Input
                                ref={(el) => {
                                  whoRefs.current[gi] = el;
                                }}
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
                                className="whitespace-nowrap px-5"
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

                {/* Add another group */}
                {totalWhats >= 1 && (
                  <button
                    type="button"
                    onClick={handleAddGroup}
                    className="flex items-center gap-2 w-full p-3 rounded-sm bg-surface-mid text-sm font-medium text-secondary cursor-pointer hover:text-accent-text hover:bg-accent-soft transition-all mb-4"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    Add another group
                  </button>
                )}

                {/* Shared WHOs */}
                {totalWhats >= 1 && (
                  <div className="mb-4">
                    {!showSharedWhos ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowSharedWhos(true);
                          setTimeout(() => sharedWhoRef.current?.focus(), 100);
                        }}
                        className="flex items-center gap-2 w-full p-3 rounded-sm bg-surface-mid text-sm font-medium text-secondary cursor-pointer hover:text-upcoming-text hover:bg-upcoming-soft transition-all"
                      >
                        <span className="material-symbols-outlined text-[18px]">group_add</span>
                        Add people who email you about this
                      </button>
                    ) : (
                      <div className="p-5 rounded-lg bg-white animate-fadeIn">
                        <div className="text-xs font-semibold uppercase tracking-widest text-upcoming-text mb-2">
                          People who email you
                        </div>
                        <p className="text-xs text-muted mb-3">
                          Names of people who email you about this topic. We&apos;ll search their
                          emails to discover more.
                        </p>

                        {sharedWhos.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {sharedWhos.map((name, i) => (
                              <span
                                key={name}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-upcoming-soft text-upcoming-text text-sm font-medium"
                              >
                                {name}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSharedWho(i)}
                                  className="flex opacity-60 hover:opacity-100 transition cursor-pointer"
                                  aria-label={`Remove ${name}`}
                                >
                                  <span className="material-symbols-outlined text-[16px]">
                                    close
                                  </span>
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

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
                            className="whitespace-nowrap px-5"
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Reassurance + Goals */}
                {totalWhats >= 1 && (
                  <>
                    <div className="p-4 rounded-sm bg-surface-mid text-sm text-secondary leading-relaxed flex items-start gap-3">
                      <span className="material-symbols-outlined text-accent text-[20px] shrink-0 mt-0.5">
                        auto_awesome
                      </span>
                      <span>{dc.reassurance}</span>
                    </div>

                    <div className="mt-6">
                      <div className="text-xs font-semibold uppercase tracking-widest text-success-text mb-2">
                        What matters most to you?
                      </div>
                      <p className="text-sm text-muted mb-3">
                        Pick any that apply. This helps us know what to surface first.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {dc.goals.map((g) => {
                          const selected = goals.includes(g.id);
                          return (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => toggleGoal(g.id)}
                              className={[
                                "inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium cursor-pointer transition-all",
                                selected
                                  ? "bg-success-soft text-success-text shadow-sm"
                                  : "bg-surface-mid text-secondary hover:text-success-text hover:bg-success-soft",
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

      {/* Bottom CTA — sticky */}
      {canContinue && (
        <div className="px-6 py-4 max-w-2xl mx-auto w-full animate-fadeIn">
          <Button variant="primary" onClick={handleContinue}>
            Continue
            <span className="material-symbols-outlined text-[18px] ml-2 align-middle">
              arrow_forward
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
