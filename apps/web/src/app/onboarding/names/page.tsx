"use client";

import type { EntityGroupInput, InterviewInput } from "@denim/types";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DOMAIN_CONFIGS, type DomainId, ROLE_OPTIONS } from "@/components/interview/domain-config";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { onboardingStorage } from "@/lib/onboarding-storage";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

/**
 * #117 pairings from groups[] — extracted so both new-session sessionStorage
 * rehydration and #127 edit-mode server rehydration use the same shape.
 */
function pairingsFromGroups(groups?: ReadonlyArray<EntityGroupInput>): Map<string, Set<string>> {
  const restored = new Map<string, Set<string>>();
  if (!groups) return restored;
  for (const group of groups) {
    for (const who of group.whos) {
      const bucket = restored.get(who) ?? new Set<string>();
      for (const w of group.whats) bucket.add(w);
      restored.set(who, bucket);
    }
  }
  return restored;
}

export default function NamesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // #127: when present, edit mode — load inputs from the existing schema
  // (via the polling endpoint) instead of the sessionStorage draft, and
  // submit via PATCH /inputs instead of POST /start.
  const editingSchemaId = searchParams.get("schemaId");

  const [domain, setDomain] = useState<DomainId | null>(null);
  const [roleLabel, setRoleLabel] = useState("");
  const [roleIcon, setRoleIcon] = useState("");

  const [topicName, setTopicName] = useState("");

  const [whats, setWhats] = useState<string[]>([]);
  const [whatInput, setWhatInput] = useState("");

  const [whos, setWhos] = useState<string[]>([]);
  const [whoInput, setWhoInput] = useState("");

  // #117: WHO → set of paired WHATs. Stored as plain objects on the wire
  // (groups[]); Map/Set makes toggles cheap in-component.
  const [pairings, setPairings] = useState<Map<string, Set<string>>>(new Map());

  // #127: edit-mode load state and submit state. Kept local to this page
  // so a failed PATCH doesn't mutate the server-side schema.
  const [editLoadState, setEditLoadState] = useState<"loading" | "ready" | "error" | null>(
    editingSchemaId ? "loading" : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const whatInputRef = useRef<HTMLInputElement>(null);
  const whoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // #127 edit-mode load: skip sessionStorage entirely, pull the schema's
    // persisted inputs off the polling endpoint. This page is the single
    // editor; rewriting the sessionStorage draft here would contaminate a
    // subsequent fresh-onboarding session.
    if (editingSchemaId) {
      let cancelled = false;
      (async () => {
        try {
          const res = await authenticatedFetch(`/api/onboarding/${editingSchemaId}`);
          if (!res.ok) {
            throw new Error(`Failed to load schema (${res.status})`);
          }
          const body = (await res.json()) as {
            data: { inputs?: InterviewInput; phase: string };
          };
          if (cancelled) return;
          const inputs = body.data.inputs;
          if (!inputs) {
            // Server-side phase gate is the source of truth; if inputs are
            // not surfaced we can't safely edit. Show an error rather than
            // silently failing to pre-fill.
            setEditLoadState("error");
            return;
          }
          setDomain(inputs.domain as DomainId);
          const role = ROLE_OPTIONS.find((r) => r.id === inputs.role);
          if (role) {
            setRoleLabel(role.label);
            setRoleIcon(role.materialIcon);
          }
          setTopicName(inputs.name ?? "");
          setWhats(inputs.whats);
          setWhos(inputs.whos);
          setPairings(pairingsFromGroups(inputs.groups));
          setEditLoadState("ready");
        } catch {
          if (!cancelled) setEditLoadState("error");
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // New-session path: category + sessionStorage draft rehydrate.
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

    const saved = onboardingStorage.getNames();
    if (saved) {
      setWhats(saved.whats);
      setWhos(saved.whos);
      if (saved.name) setTopicName(saved.name);
      setPairings(pairingsFromGroups(saved.groups));
    }
  }, [router, editingSchemaId]);

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
    // #117: also strip this WHAT from every WHO's pairing set
    setPairings((prev) => {
      const next = new Map(prev);
      for (const [who, bucket] of next) {
        if (bucket.has(item)) {
          const updated = new Set(bucket);
          updated.delete(item);
          next.set(who, updated);
        }
      }
      return next;
    });
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
    // #117: drop this WHO's pairing entry entirely
    setPairings((prev) => {
      if (!prev.has(item)) return prev;
      const next = new Map(prev);
      next.delete(item);
      return next;
    });
  }

  function toggleWhoWhat(who: string, what: string) {
    setPairings((prev) => {
      const next = new Map(prev);
      const bucket = new Set(next.get(who) ?? []);
      if (bucket.has(what)) bucket.delete(what);
      else bucket.add(what);
      next.set(who, bucket);
      return next;
    });
  }

  // #117: derive the groups array that ships to the API.
  // One group per WHO that has ≥1 paired WHAT. Unpaired WHOs contribute
  // nothing to `groups[]` but stay in `whos[]` as cross-cutting senders.
  const groups = useMemo<EntityGroupInput[]>(() => {
    const out: EntityGroupInput[] = [];
    for (const who of whos) {
      const bucket = pairings.get(who);
      if (!bucket || bucket.size === 0) continue;
      // Preserve the user's WHAT input order.
      const pairedWhats = whats.filter((w) => bucket.has(w));
      if (pairedWhats.length === 0) continue;
      out.push({ whats: pairedWhats, whos: [who] });
    }
    return out;
  }, [whos, whats, pairings]);

  async function handleContinue() {
    const trimmedName = topicName.trim();

    // #127 edit mode: PATCH existing schema, server rewinds Stage 1, then
    // route back to the observer page where polling will render either
    // DISCOVERING_DOMAINS (spinner) or, if it's quick, the fresh review.
    if (editingSchemaId) {
      if (!domain) return; // ready-state gate, should be unreachable
      setSubmitting(true);
      setSubmitError(null);
      try {
        const res = await authenticatedFetch(`/api/onboarding/${editingSchemaId}/inputs`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: ROLE_OPTIONS.find((r) => r.label === roleLabel)?.id ?? "",
            domain,
            whats,
            whos,
            goals: [],
            groups,
            ...(trimmedName ? { name: trimmedName } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Save failed (${res.status})`);
        }
        router.push(`/onboarding/${editingSchemaId}`);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Save failed");
        setSubmitting(false);
      }
      return;
    }

    // New-session path: sessionStorage draft → connect page → POST /start.
    onboardingStorage.setNames({
      whats,
      whos,
      ...(trimmedName ? { name: trimmedName } : {}),
      ...(groups.length > 0 ? { groups } : {}),
    });
    router.push("/onboarding/connect");
  }

  // #127 edit-mode loading/error states take precedence over the normal
  // render. Nothing is interactive until inputs are hydrated.
  if (editingSchemaId && editLoadState !== "ready") {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        {editLoadState === "error" ? (
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <p className="font-serif text-lg text-primary">Couldn&apos;t load your topic</p>
            <p className="text-sm text-muted">
              The edit page needs the current interview inputs, but the server didn&apos;t return
              them. Your topic may have progressed past the editable phase.
            </p>
            <Button onClick={() => router.push(`/onboarding/${editingSchemaId}`)}>
              Back to topic
            </Button>
          </div>
        ) : (
          <span className="material-symbols-outlined text-[32px] text-accent animate-spin">
            progress_activity
          </span>
        )}
      </div>
    );
  }

  if (!dc) return null;

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <OnboardingProgress currentStep={1} totalSteps={5} />

      <div className="w-full max-w-2xl mt-8">
        {/* Context badge — in edit mode, routes back to the observer rather
            than the category page so the user can abandon edits safely. */}
        <div className="flex justify-center mb-8">
          <button
            type="button"
            onClick={() =>
              router.push(
                editingSchemaId ? `/onboarding/${editingSchemaId}` : "/onboarding/category",
              )
            }
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
            <p className="text-primary text-sm mt-2 font-medium">
              If a person focuses on specific topics, tap them below. If they help with everything,
              leave them unpaired.
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
              <div className="mt-3 flex flex-col gap-3">
                {whos.map((item) => {
                  const selectedWhats = pairings.get(item) ?? new Set<string>();
                  return (
                    <div key={item} className="flex flex-col gap-3 rounded-lg bg-surface-low p-4">
                      <span className="inline-flex w-fit items-center gap-1.5 px-3 py-1.5 rounded-full bg-upcoming-soft text-upcoming-text text-sm font-medium">
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-primary font-medium">
                          Tap topics {item} focuses on:
                        </span>
                        {whats.map((w) => {
                          const isSelected = selectedWhats.has(w);
                          return (
                            <button
                              key={w}
                              type="button"
                              onClick={() => toggleWhoWhat(item, w)}
                              aria-pressed={isSelected}
                              className={
                                isSelected
                                  ? "inline-flex items-center px-3 py-1.5 rounded-full bg-accent-soft text-accent-text text-sm font-medium cursor-pointer hover:brightness-95 transition-all"
                                  : "inline-flex items-center px-3 py-1.5 rounded-full bg-surface-highest text-primary text-sm font-medium border border-border cursor-pointer hover:bg-surface-high transition-all"
                              }
                            >
                              {w}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Continue / Save button */}
        {whats.length > 0 && (
          <div className="mt-8">
            <Button onClick={handleContinue} disabled={submitting}>
              {editingSchemaId
                ? submitting
                  ? "Saving…"
                  : "Save changes & re-run discovery"
                : "Continue"}
            </Button>
            {submitError && <p className="mt-3 text-sm text-overdue">{submitError}</p>}
          </div>
        )}

        {!editingSchemaId && <p className="text-sm text-muted text-center mt-8">Step 2 of 5</p>}
      </div>
    </div>
  );
}
