"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

/**
 * AWAITING_DOMAIN_CONFIRMATION — Stage 1 review checkpoint (issue #95).
 *
 * Shows the top-N sender domains surfaced by `runDomainDiscovery` and lets
 * the user tick the ones relevant to this topic. POSTing the selection
 * advances the schema through `/domain-confirm` (Task 3.1), which CAS-flips
 * `AWAITING_DOMAIN_CONFIRMATION → DISCOVERING_ENTITIES` and emits
 * `onboarding.entity-discovery.requested`.
 *
 * After a successful POST we do not navigate — we keep rendering the
 * `finalizing` state until the next poll tick returns
 * `DISCOVERING_ENTITIES`, at which point `flow.tsx` swaps the component.
 * This mirrors the pattern already baked into `phase-review.tsx`.
 */

type SubmitStatus = "idle" | "submitting" | "error";

export function PhaseDomainConfirmation({
  response,
}: {
  response: OnboardingPollingResponse;
}) {
  const candidates = response.stage1Candidates ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const toggle = (domain: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setStatus("submitting");
    setErrorMessage("");
    try {
      const res = await authenticatedFetch(
        `/api/onboarding/${response.schemaId}/domain-confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmedDomains: [...selected] }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Confirm failed (${res.status})`);
      }
      // Success: leave status === "submitting" so the CTA stays disabled.
      // The next poll tick will flip the schema phase and flow.tsx swaps us
      // out for PhasePending / PhaseEntityConfirmation.
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
          progress_activity
        </span>
        <h1 className="font-serif text-2xl text-primary">
          Finding your senders
        </h1>
        <p className="text-sm text-muted">
          Scanning for sender domains in your inbox…
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl text-primary">
        We found these senders in your inbox
      </h1>
      <p className="text-muted text-sm mt-1">
        Check the ones relevant to this topic.
      </p>

      <ul className="mt-6 flex flex-col gap-2">
        {candidates.map((c) => {
          const checkboxId = `domain-${c.domain}`;
          const isSelected = selected.has(c.domain);
          return (
            <li
              key={c.domain}
              className="flex items-center gap-3 rounded-sm bg-surface-highest px-4 py-3"
            >
              <input
                type="checkbox"
                id={checkboxId}
                checked={isSelected}
                onChange={() => toggle(c.domain)}
                disabled={status === "submitting"}
                className="h-4 w-4 accent-accent"
              />
              <label
                htmlFor={checkboxId}
                className="flex flex-1 items-center justify-between cursor-pointer"
              >
                <span className="font-medium text-primary">{c.domain}</span>
                <span className="text-xs text-muted">
                  {c.count} email{c.count === 1 ? "" : "s"}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {status === "error" && errorMessage && (
        <p className="mt-3 text-sm text-overdue">{errorMessage}</p>
      )}

      <div className="mt-8">
        <Button
          onClick={submit}
          disabled={selected.size === 0 || status === "submitting"}
        >
          {status === "submitting"
            ? "Confirming…"
            : `Confirm ${selected.size} domain${selected.size === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
