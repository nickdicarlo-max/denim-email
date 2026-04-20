"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { OnboardingPollingResponse } from "@/lib/services/onboarding-polling";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

/**
 * AWAITING_DOMAIN_CONFIRMATION — Stage 1 review checkpoint (issue #95).
 *
 * Renders three sections, top-down:
 *   1. "Your things" — per-user-what find-or-tell results (#112). A user
 *      who typed "Stallion" sees "Stallion — 23 emails from stallionis.com"
 *      OR "Stallion — not found in the last 8 weeks." Pre-checked when
 *      found; checking adds the resolved top domain to `confirmedDomains`.
 *   2. "Your contacts" — per-user-who find-or-tell results (#112). Same
 *      find-or-tell contract; selection adds the contact's sender domain
 *      to `confirmedDomains` so Stage 2 derives entities from that domain.
 *   3. "Discovered" — the keyword-ranked top-N sender domains (existing).
 *
 * All three sections contribute to a single `Set<string>` of domains that
 * gets POSTed to `/domain-confirm`. After a successful POST we leave the
 * component in "submitting" state until the next poll tick flips the phase.
 */

type SubmitStatus = "idle" | "submitting" | "error";

export function PhaseDomainConfirmation({ response }: { response: OnboardingPollingResponse }) {
  const candidates = response.stage1Candidates ?? [];
  const userThings = response.stage1UserThings ?? [];
  const userContacts = response.stage1UserContacts ?? [];

  // Pre-check any user-named result with matches — user said they wanted it,
  // so default to including it. Discovered (keyword) candidates stay opt-in.
  const initial = useMemo(() => {
    const domains = new Set<string>();
    const contactQueries = new Set<string>();
    for (const t of userThings) {
      if (t.matchCount > 0 && t.topDomain) domains.add(t.topDomain);
    }
    for (const c of userContacts) {
      if (c.matchCount > 0 && c.senderDomain) {
        domains.add(c.senderDomain);
        contactQueries.add(c.query);
      }
    }
    return { domains, contactQueries };
    // Effectively a constant per-poll-response; the component unmounts when
    // phase advances past AWAITING_DOMAIN_CONFIRMATION.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selected, setSelected] = useState<Set<string>>(initial.domains);
  // #112 Tier 2: tracks which user-who query strings the user ticked so
  // Stage 2 can seed them as pre-confirmed SECONDARY entity candidates.
  const [selectedContactQueries, setSelectedContactQueries] = useState<Set<string>>(
    initial.contactQueries,
  );
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

  // Toggling a user-contact row mutates both sets: the domain (for
  // Stage 2 to run on) and the query string (for Stage 2 to seed a
  // pre-confirmed SECONDARY entity carrying the user's label + sender).
  const toggleContact = (query: string, senderDomain: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(senderDomain)) next.delete(senderDomain);
      else next.add(senderDomain);
      return next;
    });
    setSelectedContactQueries((prev) => {
      const next = new Set(prev);
      if (next.has(query)) next.delete(query);
      else next.add(query);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setStatus("submitting");
    setErrorMessage("");
    try {
      const res = await authenticatedFetch(`/api/onboarding/${response.schemaId}/domain-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmedDomains: [...selected],
          confirmedUserContactQueries: [...selectedContactQueries],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Confirm failed (${res.status})`);
      }
      // Leave status === "submitting" until the poll swaps phase.
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const hasAnyResults = candidates.length > 0 || userThings.length > 0 || userContacts.length > 0;

  if (!hasAnyResults) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="material-symbols-outlined text-[40px] text-accent animate-spin">
          progress_activity
        </span>
        <h1 className="font-serif text-2xl text-primary">Finding your senders</h1>
        <p className="text-sm text-muted">Scanning for sender domains in your inbox…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl text-primary">Confirm what's yours</h1>
      <p className="text-muted text-sm mt-1">
        Check anything relevant to this topic. We'll organize emails from these senders.
      </p>

      {userThings.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-lg text-primary">Your things</h2>
          <p className="text-xs text-muted">
            What you told us to look for, in the last 8 weeks of mail.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {userThings.map((t) => (
              <UserThingRow
                key={`thing-${t.query}`}
                thing={t}
                selected={t.topDomain ? selected.has(t.topDomain) : false}
                submitting={status === "submitting"}
                onToggle={() => t.topDomain && toggle(t.topDomain)}
              />
            ))}
          </ul>
        </section>
      )}

      {userContacts.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-lg text-primary">Your contacts</h2>
          <p className="text-xs text-muted">People you named, in the last 8 weeks of mail.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {userContacts.map((c) => (
              <UserContactRow
                key={`contact-${c.query}`}
                contact={c}
                selected={selectedContactQueries.has(c.query)}
                submitting={status === "submitting"}
                onToggle={() => c.senderDomain && toggleContact(c.query, c.senderDomain)}
              />
            ))}
          </ul>
        </section>
      )}

      {candidates.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-lg text-primary">Discovered</h2>
          <p className="text-xs text-muted">
            Top senders from your inbox keyword search. Pick any that fit.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
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
        </section>
      )}

      {status === "error" && errorMessage && (
        <p className="mt-3 text-sm text-overdue">{errorMessage}</p>
      )}

      <div className="mt-8">
        <Button onClick={submit} disabled={selected.size === 0 || status === "submitting"}>
          {status === "submitting"
            ? "Confirming…"
            : `Confirm ${selected.size} selection${selected.size === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

function UserThingRow({
  thing,
  selected,
  submitting,
  onToggle,
}: {
  thing: NonNullable<OnboardingPollingResponse["stage1UserThings"]>[number];
  selected: boolean;
  submitting: boolean;
  onToggle: () => void;
}) {
  const found = thing.matchCount > 0 && thing.topDomain;
  const checkboxId = `thing-${thing.query}`;
  if (!found) {
    return (
      <li className="flex items-center gap-3 rounded-sm bg-surface-mid px-4 py-3 opacity-70">
        <span className="material-symbols-outlined text-[18px] text-muted">search_off</span>
        <div className="flex flex-1 items-center justify-between">
          <span className="font-medium text-primary">{thing.query}</span>
          <span className="text-xs text-muted">No emails found in the last 8 weeks</span>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 rounded-sm bg-accent-soft px-4 py-3">
      <input
        type="checkbox"
        id={checkboxId}
        checked={selected}
        onChange={onToggle}
        disabled={submitting}
        className="h-4 w-4 accent-accent"
      />
      <label
        htmlFor={checkboxId}
        className="flex flex-1 items-center justify-between cursor-pointer"
      >
        <span className="font-medium text-primary">{thing.query}</span>
        <span className="text-xs text-accent-text">
          {thing.matchCount} email{thing.matchCount === 1 ? "" : "s"} from {thing.topDomain}
          {thing.sourcedFromWho ? ` (via ${thing.sourcedFromWho})` : ""}
        </span>
      </label>
    </li>
  );
}

function UserContactRow({
  contact,
  selected,
  submitting,
  onToggle,
}: {
  contact: NonNullable<OnboardingPollingResponse["stage1UserContacts"]>[number];
  selected: boolean;
  submitting: boolean;
  onToggle: () => void;
}) {
  const found = contact.matchCount > 0 && contact.senderDomain;
  const checkboxId = `contact-${contact.query}`;
  if (!found) {
    return (
      <li className="flex items-center gap-3 rounded-sm bg-surface-mid px-4 py-3 opacity-70">
        <span className="material-symbols-outlined text-[18px] text-muted">search_off</span>
        <div className="flex flex-1 items-center justify-between">
          <span className="font-medium text-primary">{contact.query}</span>
          <span className="text-xs text-muted">No emails found in the last 8 weeks</span>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 rounded-sm bg-upcoming-soft px-4 py-3">
      <input
        type="checkbox"
        id={checkboxId}
        checked={selected}
        onChange={onToggle}
        disabled={submitting}
        className="h-4 w-4 accent-accent"
      />
      <label
        htmlFor={checkboxId}
        className="flex flex-1 items-center justify-between cursor-pointer"
      >
        <span className="font-medium text-primary">{contact.query}</span>
        <span className="text-xs text-upcoming-text">
          {contact.matchCount} email{contact.matchCount === 1 ? "" : "s"} at {contact.senderDomain}
        </span>
      </label>
    </li>
  );
}
