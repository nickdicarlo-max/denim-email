"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  OnboardingPollingResponse,
  Stage2DomainCandidateDTO,
  Stage2PerDomainDTO,
} from "@/lib/services/onboarding-polling";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

/**
 * AWAITING_ENTITY_CONFIRMATION — Stage 2 review checkpoint (issues #95 +
 * #112 Tier 2 + #115).
 *
 * Per-confirmed-domain groups of entity candidates. Two sources in the
 * candidate list:
 *
 * 1. Algorithm-derived (autoDetected) — property addresses, school
 *    institutions, agency first-token convergence. Kind = PRIMARY.
 * 2. User-seeded (meta.source === "user_named", Tier 2) — surfaced from
 *    the user's Stage 1 "Your contacts" selections via
 *    `stage1ConfirmedUserContactQueries`. Kind = SECONDARY. Pre-checked
 *    on mount because the user already confirmed intent on Stage 1.
 *
 * identityKey semantics stay the producer's:
 *   - property         → normalized address (lowercased, street-type collapsed)
 *   - school_parent    → lowercased trimmed institution/activity name
 *   - agency (derived) → authoritative DNS label ("anthropic.com")
 *   - user-seeded      → `@<senderEmail>` (matches SECONDARY convention in
 *                        `/entity-confirm` Zod refine)
 *
 * Kind is derived per-candidate from `meta.kind`; falls back to PRIMARY to
 * stay safe for pre-Tier-2 schemas with no `meta`.
 */

type SubmitStatus = "idle" | "submitting" | "error";
type Kind = "PRIMARY" | "SECONDARY";

interface Pick {
  identityKey: string;
  displayLabel: string;
  kind: Kind;
  /** #115: rendered as a small "Added by you" badge on the row. */
  isUserSeeded: boolean;
}

function kindFor(candidate: Stage2DomainCandidateDTO): Kind {
  const kind = (candidate.meta?.kind as Kind | undefined) ?? "PRIMARY";
  return kind === "SECONDARY" ? "SECONDARY" : "PRIMARY";
}

function isUserSeeded(candidate: Stage2DomainCandidateDTO): boolean {
  return candidate.meta?.source === "user_named";
}

export function PhaseEntityConfirmation({ response }: { response: OnboardingPollingResponse }) {
  const groups: Stage2PerDomainDTO[] = useMemo(
    () => response.stage2Candidates ?? [],
    [response.stage2Candidates],
  );

  // Pre-populate picks with every user-seeded candidate — the user
  // ticked these on Stage 1 already; forcing a second click is the
  // opacity problem we're fixing.
  const [picks, setPicks] = useState<Map<string, Pick>>(() => {
    const initial = new Map<string, Pick>();
    for (const group of groups) {
      for (const c of group.candidates) {
        if (isUserSeeded(c)) {
          initial.set(c.key, {
            identityKey: c.key,
            displayLabel: c.displayString,
            kind: kindFor(c),
            isUserSeeded: true,
          });
        }
      }
    }
    return initial;
  });
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Groups can arrive after the initial render (polling tick fills them
  // in). Add any new user-seeded candidates to picks as they appear.
  useEffect(() => {
    setPicks((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const group of groups) {
        for (const c of group.candidates) {
          if (isUserSeeded(c) && !next.has(c.key)) {
            next.set(c.key, {
              identityKey: c.key,
              displayLabel: c.displayString,
              kind: kindFor(c),
              isUserSeeded: true,
            });
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [groups]);

  const toggle = (candidate: Stage2DomainCandidateDTO) => {
    const key = candidate.key;
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, {
          identityKey: key,
          displayLabel: labelEdits[key] ?? candidate.displayString,
          kind: kindFor(candidate),
          isUserSeeded: isUserSeeded(candidate),
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
      <h1 className="font-serif text-2xl text-primary">Confirm what to track</h1>
      <p className="text-muted text-sm mt-1">
        Things are topics Denim organizes emails into. Contacts are people you asked us to find. You
        can rename any of them inline.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {groups.map((group) => (
          <DomainGroup
            key={group.confirmedDomain}
            group={group}
            picks={picks}
            labelEdits={labelEdits}
            submitting={status === "submitting"}
            onToggle={toggle}
            onEditLabel={editLabel}
          />
        ))}
      </div>

      {status === "error" && errorMessage && (
        <p className="mt-3 text-sm text-overdue">{errorMessage}</p>
      )}

      <div className="mt-8">
        <Button onClick={submit} disabled={picks.size === 0 || status === "submitting"}>
          {status === "submitting"
            ? "Confirming…"
            : `Confirm ${picks.size} ${picks.size === 1 ? "item" : "items"}`}
        </Button>
      </div>
    </div>
  );
}

function DomainGroup({
  group,
  picks,
  labelEdits,
  submitting,
  onToggle,
  onEditLabel,
}: {
  group: Stage2PerDomainDTO;
  picks: Map<string, Pick>;
  labelEdits: Record<string, string>;
  submitting: boolean;
  onToggle: (c: Stage2DomainCandidateDTO) => void;
  onEditLabel: (identityKey: string, value: string) => void;
}) {
  const hasCandidates = group.candidates.length > 0;

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-primary">
          Inside <span className="font-mono text-accent-text">{group.confirmedDomain}</span>
        </h2>
        {hasCandidates && (
          <span className="text-xs text-muted">
            {group.candidates.length} item{group.candidates.length === 1 ? "" : "s"}
          </span>
        )}
      </header>

      {!hasCandidates ? (
        <p className="text-xs text-muted italic bg-surface-mid rounded-sm px-4 py-3">
          We didn't find specific things inside {group.confirmedDomain}. Denim will still track the
          domain as a whole.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {group.candidates.map((candidate) => (
            <CandidateRow
              // #119: prefix with confirmedDomain to guarantee uniqueness
              // across sibling DomainGroups. `picks`/`labelEdits` remain
              // keyed by `candidate.key` because identityKey semantics are
              // (schemaId, identityKey, type) unique — the React key only
              // needs to be unique within this render tree.
              key={`${group.confirmedDomain}-${candidate.key}`}
              candidate={candidate}
              picked={picks.has(candidate.key)}
              editedLabel={labelEdits[candidate.key]}
              submitting={submitting}
              onToggle={onToggle}
              onEditLabel={onEditLabel}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CandidateRow({
  candidate,
  picked,
  editedLabel,
  submitting,
  onToggle,
  onEditLabel,
}: {
  candidate: Stage2DomainCandidateDTO;
  picked: boolean;
  editedLabel: string | undefined;
  submitting: boolean;
  onToggle: (c: Stage2DomainCandidateDTO) => void;
  onEditLabel: (identityKey: string, value: string) => void;
}) {
  const kind = kindFor(candidate);
  const userSeeded = isUserSeeded(candidate);
  const inputValue = editedLabel ?? candidate.displayString;
  const senderEmail = (candidate.meta?.senderEmail as string | undefined) ?? null;
  const frequency = candidate.frequency;

  // User-seeded rows get a soft accent background so they read as
  // "things you asked for" at a glance; derived rows stay neutral.
  const rowBg = userSeeded ? "bg-upcoming-soft" : "bg-surface-highest";

  return (
    <li className={`flex flex-col gap-1 rounded-sm ${rowBg} px-4 py-3`}>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id={`entity-${candidate.key}`}
          checked={picked}
          onChange={() => onToggle(candidate)}
          disabled={submitting}
          className="h-4 w-4 accent-accent"
        />
        <input
          type="text"
          aria-label={`Name for ${candidate.displayString}`}
          value={inputValue}
          onChange={(e) => onEditLabel(candidate.key, e.target.value)}
          disabled={!picked || submitting}
          className="flex-1 bg-transparent text-primary text-sm font-medium border-b border-transparent focus:border-accent focus:outline-none disabled:text-primary"
        />
        <KindBadge kind={kind} />
        <span className="text-xs text-muted whitespace-nowrap">
          {frequency} email{frequency === 1 ? "" : "s"}
        </span>
      </div>
      {(senderEmail || userSeeded || candidate.autoFixed) && (
        <div className="flex items-center gap-2 pl-7 text-xs text-muted">
          {senderEmail && <span className="font-mono">{senderEmail}</span>}
          {userSeeded && <span className="text-upcoming-text font-medium">· Added by you</span>}
          {candidate.autoFixed && (
            <span className="uppercase tracking-wide text-accent" title="Variants merged">
              · merged
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function KindBadge({ kind }: { kind: Kind }) {
  const label = kind === "PRIMARY" ? "Thing" : "Contact";
  const style =
    kind === "PRIMARY" ? "bg-accent-soft text-accent-text" : "bg-upcoming-soft text-upcoming-text";
  return (
    <span
      className={`text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 ${style}`}
    >
      {label}
    </span>
  );
}
