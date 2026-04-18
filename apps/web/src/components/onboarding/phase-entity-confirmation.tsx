"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  OnboardingPollingResponse,
  Stage2DomainCandidateDTO,
  Stage2PerDomainDTO,
} from "@/lib/services/onboarding-polling";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

/**
 * AWAITING_ENTITY_CONFIRMATION — Stage 2 review checkpoint (issue #95).
 *
 * Renders per-confirmed-domain groups of entity candidates extracted by the
 * Stage 2 dispatcher (property addresses, school institutions, agency
 * company names). The user ticks the entities that are real and can rename
 * the display label inline. Confirming POSTs to `/entity-confirm`
 * (Task 3.2), which CAS-flips
 * `AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN` and emits
 * `onboarding.review.confirmed` to fire the existing Function B pipeline.
 *
 * identityKey rule: pass `candidate.key` through unchanged. The producer
 * (`entity-discovery.ts`) already normalizes per algorithm:
 *   - property  → `normalizeAddressKey` (lowercased, street-type collapsed).
 *   - school_parent → lowercased trimmed institution/activity name.
 *   - agency → `authoritativeDomain` (bare DNS label, e.g., "anthropic.com").
 *
 * All Stage-2 kinds are PRIMARY by construction — SECONDARY (email-address
 * WHOs) don't come out of Stage 2. This also dodges the server-side guard
 * in `/entity-confirm` that rejects `@`-prefixed identityKeys paired with
 * PRIMARY.
 */

type SubmitStatus = "idle" | "submitting" | "error";

interface Pick {
  identityKey: string;
  displayLabel: string;
  kind: "PRIMARY";
}

function identityKeyFor(candidate: Stage2DomainCandidateDTO): string {
  return candidate.key;
}

export function PhaseEntityConfirmation({ response }: { response: OnboardingPollingResponse }) {
  const groups: Stage2PerDomainDTO[] = useMemo(
    () => response.stage2Candidates ?? [],
    [response.stage2Candidates],
  );

  // Map from identityKey → current Pick. A Map keeps insertion order stable
  // so the POST body mirrors the on-screen ordering.
  const [picks, setPicks] = useState<Map<string, Pick>>(() => new Map());
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const toggle = (candidate: Stage2DomainCandidateDTO) => {
    const key = identityKeyFor(candidate);
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, {
          identityKey: key,
          displayLabel: labelEdits[key] ?? candidate.displayString,
          kind: "PRIMARY",
        });
      }
      return next;
    });
  };

  const editLabel = (identityKey: string, value: string) => {
    setLabelEdits((prev) => ({ ...prev, [identityKey]: value }));
    setPicks((prev) => {
      const existing = prev.get(identityKey);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(identityKey, { ...existing, displayLabel: value });
      return next;
    });
  };

  const submit = async () => {
    if (picks.size === 0) return;
    setStatus("submitting");
    setErrorMessage("");
    try {
      const confirmedEntities = [...picks.values()].map((p) => ({
        displayLabel: p.displayLabel.trim(),
        identityKey: p.identityKey,
        kind: p.kind,
      }));
      const res = await authenticatedFetch(`/api/onboarding/${response.schemaId}/entity-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedEntities }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Confirm failed (${res.status})`);
      }
      // Success: stay in submitting state until polling swaps the component.
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const totalCandidates = groups.reduce((n, g) => n + g.candidates.length, 0);

  if (totalCandidates === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
          progress_activity
        </span>
        <h1 className="font-serif text-2xl text-primary">Finding what matters to you</h1>
        <p className="text-sm text-muted">Scanning confirmed senders for entities…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl text-primary">Which of these are relevant?</h1>
      <p className="text-muted text-sm mt-1">
        Pick the items you want organized. You can rename any of them inline.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {groups.map((group) => (
          <div key={group.confirmedDomain} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted">{group.confirmedDomain}</h2>
            <ul className="flex flex-col gap-2">
              {group.candidates.map((candidate) => {
                const key = identityKeyFor(candidate);
                const isPicked = picks.has(key);
                const inputValue = labelEdits[key] ?? candidate.displayString;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 rounded-sm bg-surface-highest px-4 py-3"
                  >
                    <input
                      type="checkbox"
                      id={`entity-${key}`}
                      checked={isPicked}
                      onChange={() => toggle(candidate)}
                      disabled={status === "submitting"}
                      className="h-4 w-4 accent-accent"
                    />
                    <input
                      type="text"
                      aria-label={`Name for ${candidate.displayString}`}
                      value={inputValue}
                      onChange={(e) => editLabel(key, e.target.value)}
                      disabled={!isPicked || status === "submitting"}
                      className="flex-1 bg-transparent text-primary text-sm font-medium border-b border-transparent focus:border-accent focus:outline-none disabled:text-muted"
                    />
                    <span className="text-xs text-muted">{candidate.frequency}</span>
                    {candidate.autoFixed && (
                      <span
                        className="text-[10px] uppercase tracking-wide text-accent"
                        title="Variants merged automatically"
                      >
                        merged
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {status === "error" && errorMessage && (
        <p className="mt-3 text-sm text-overdue">{errorMessage}</p>
      )}

      <div className="mt-8">
        <Button onClick={submit} disabled={picks.size === 0 || status === "submitting"}>
          {status === "submitting"
            ? "Confirming…"
            : `Confirm ${picks.size} ${picks.size === 1 ? "entity" : "entities"}`}
        </Button>
      </div>
    </div>
  );
}
