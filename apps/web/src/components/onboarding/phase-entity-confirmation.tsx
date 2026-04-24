"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  OnboardingPollingResponse,
  Stage2DomainCandidateDTO,
  Stage2PerDomainDTO,
} from "@/lib/services/onboarding-polling";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import {
  type AnchorPrimary,
  buildPerWhatGroups,
  type PairedWhoRow,
  type WhatSection,
} from "./build-per-what-groups";

/**
 * AWAITING_ENTITY_CONFIRMATION — Stage 2 review checkpoint (Phase 5 rewrite).
 *
 * Prior layout grouped candidates by confirmed sender domain. Users had no
 * way to tell which of the rows were "topics" vs "senders" vs engagement
 * fragments, and zero-match WHATs disappeared entirely (see Nick's
 * 2026-04-23 feedback). Phase 5 re-organises around the user's WHATs:
 *
 *   ▾ <WHAT>                                    [from your input]
 *       ✓ <paired WHO>           · N emails · sender@domain
 *       ✓ <PRIMARY anchor>       · N emails · pattern-source
 *         Aliases found: ... (muted, not separate checkboxes)
 *
 * Section states per WHAT:
 *   - found-and-anchored  → show anchor + paired WHOs, pre-ticked.
 *   - found-but-unanchored → ⓘ note + confirmable checkbox. On submit,
 *                           emits a PRIMARY with no domain attribution;
 *                           clustering falls back to sender-email match.
 *   - not-found           → ⚠ note. Informational, not confirmable.
 *
 * "Also noticed" section at the bottom lists Stage 2 candidates that
 * don't match any WHAT (principle #5 adjacent discoveries). Rendered
 * with softer styling, unticked by default.
 *
 * Fallback: when `inputs.groups` is empty (legacy schemas in-flight),
 * renders the pre-Phase-5 by-domain layout via `DomainFallback` so
 * existing polling responses don't break mid-migration.
 */

type SubmitStatus = "idle" | "submitting" | "error";
type Kind = "PRIMARY" | "SECONDARY";

interface Pick {
  identityKey: string;
  displayLabel: string;
  kind: Kind;
  secondaryTypeName?: string;
  /** For reporting in the confirm payload — the UI origin label. */
  uiOrigin?: "hint" | "paired-who" | "anchor" | "unanchored" | "also-noticed";
}

/** Copy constants — keep the spec pairing (`feedback_entity_rules_paired_with_ui_copy.md`)
 *  in one place. */
const NOT_FOUND_NUDGE =
  "Edit your WHOs to help anchor it, or add another WHAT that shows up in your inbox.";

export function PhaseEntityConfirmation({ response }: { response: OnboardingPollingResponse }) {
  const inputs = response.inputs;
  const stage2Candidates: Stage2PerDomainDTO[] = useMemo(
    () => response.stage2Candidates ?? [],
    [response.stage2Candidates],
  );

  const { whatSections, fallbackDomainGroups } = useMemo(
    () =>
      buildPerWhatGroups({
        inputs,
        stage1UserThings: response.stage1UserThings ?? [],
        stage1UserContacts: response.stage1UserContacts ?? [],
        stage1ConfirmedUserContactQueries: response.stage1ConfirmedUserContactQueries ?? [],
        stage2Candidates,
      }),
    [
      inputs,
      response.stage1UserThings,
      response.stage1UserContacts,
      response.stage1ConfirmedUserContactQueries,
      stage2Candidates,
    ],
  );

  // Initial picks: everything pre-ticked by the helper (paired WHOs
  // confirmed at Stage 1, deterministic anchors). Alsoto noticed rows
  // start unticked; user opts in.
  const initialPicks = useMemo(() => {
    const map = new Map<string, Pick>();
    for (const section of whatSections) {
      for (const who of section.pairedWhos) {
        if (who.preTicked) {
          map.set(who.identityKey, {
            identityKey: who.identityKey,
            displayLabel: who.displayLabel,
            kind: "SECONDARY",
            secondaryTypeName: "contact",
            uiOrigin: "paired-who",
          });
        }
      }
      const a = section.anchor;
      if (a && a.preTicked) {
        map.set(a.identityKey, {
          identityKey: a.identityKey,
          displayLabel: a.displayLabel,
          kind: "PRIMARY",
          uiOrigin: "anchor",
        });
      }
    }
    return map;
  }, [whatSections]);

  const [picks, setPicks] = useState<Map<string, Pick>>(initialPicks);
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Keep picks in sync when the polling tick widens whatSections
  // (e.g. the polling response arrives a beat after initial render).
  useEffect(() => {
    setPicks((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const section of whatSections) {
        for (const who of section.pairedWhos) {
          if (who.preTicked && !next.has(who.identityKey)) {
            next.set(who.identityKey, {
              identityKey: who.identityKey,
              displayLabel: who.displayLabel,
              kind: "SECONDARY",
              secondaryTypeName: "contact",
              uiOrigin: "paired-who",
            });
            changed = true;
          }
        }
        const a = section.anchor;
        if (a && a.preTicked && !next.has(a.identityKey)) {
          next.set(a.identityKey, {
            identityKey: a.identityKey,
            displayLabel: a.displayLabel,
            kind: "PRIMARY",
            uiOrigin: "anchor",
          });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [whatSections]);

  const togglePick = (pick: Pick) => {
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(pick.identityKey)) next.delete(pick.identityKey);
      else {
        const edited = labelEdits[pick.identityKey];
        next.set(pick.identityKey, edited ? { ...pick, displayLabel: edited } : pick);
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
        ...(p.secondaryTypeName ? { secondaryTypeName: p.secondaryTypeName } : {}),
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
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  // Fallback — no user WHATs / groups surfaced. Render the pre-Phase-5
  // by-domain layout so legacy in-flight schemas still work.
  if (fallbackDomainGroups && fallbackDomainGroups.length > 0) {
    return (
      <DomainFallback
        schemaId={response.schemaId}
        groups={fallbackDomainGroups}
        picks={picks}
        labelEdits={labelEdits}
        status={status}
        errorMessage={errorMessage}
        onToggle={(c) =>
          togglePick({
            identityKey: c.key,
            displayLabel: labelEdits[c.key] ?? c.displayString,
            kind:
              (c.meta?.kind as string | undefined)?.toLowerCase() === "secondary"
                ? "SECONDARY"
                : "PRIMARY",
            uiOrigin: "also-noticed",
          })
        }
        onEditLabel={editLabel}
        onSubmit={submit}
      />
    );
  }

  if (whatSections.length === 0) {
    return <LoadingState />;
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl text-primary">Confirm your topics</h1>
      <p className="text-muted text-sm mt-1">
        Each WHAT you entered becomes one topic. Denim groups emails under these — you can rename
        anything inline before confirming.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {whatSections.map((section) => (
          <WhatSectionView
            // Phase 6 Round 1 step 5: user-typed and discovered sections both
            // render through the same component — only the header badge and
            // pre-tick policy differ (both carried in the section data).
            key={
              section.provenance === "discovered"
                ? `discovered:${section.anchor?.identityKey ?? section.what}`
                : `user:${section.what}`
            }
            section={section}
            picks={picks}
            labelEdits={labelEdits}
            submitting={status === "submitting"}
            onToggle={togglePick}
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

function WhatSectionView({
  section,
  picks,
  labelEdits,
  submitting,
  onToggle,
  onEditLabel,
}: {
  section: WhatSection;
  picks: Map<string, Pick>;
  labelEdits: Record<string, string>;
  submitting: boolean;
  onToggle: (p: Pick) => void;
  onEditLabel: (identityKey: string, value: string) => void;
}) {
  const isDiscovered = section.provenance === "discovered";
  return (
    <section className="flex flex-col gap-2 rounded-sm bg-surface-mid px-4 py-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-primary">{section.what}</h2>
        {isDiscovered ? (
          <span
            className="text-[10px] uppercase tracking-wide text-muted bg-surface-highest rounded px-1.5 py-0.5 font-semibold whitespace-nowrap"
            title={
              section.discoveredOnDomain
                ? `Denim found this on ${section.discoveredOnDomain}${
                    typeof section.discoveryScore === "number"
                      ? ` (score ${section.discoveryScore})`
                      : ""
                  }`
                : "Denim surfaced this during discovery"
            }
          >
            Denim found this
            {section.discoveredOnDomain ? ` · ${section.discoveredOnDomain}` : ""}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-accent-text bg-accent-soft rounded px-1.5 py-0.5 font-semibold whitespace-nowrap">
            from your input
          </span>
        )}
      </header>

      {section.state === "not_found" && (
        <div className="flex flex-col gap-1 rounded-sm bg-surface-highest px-3 py-2 text-sm">
          <p className="text-overdue-text">⚠ {section.notFoundNote}</p>
          <p className="text-xs text-muted">{NOT_FOUND_NUDGE}</p>
        </div>
      )}

      {section.state === "found_unanchored" && section.unanchoredNote && (
        <p className="text-xs text-muted bg-surface-highest rounded-sm px-3 py-2">
          ⓘ {section.unanchoredNote}
        </p>
      )}

      {/* Phase 6 Round 1 step 4 — WHAT-primary layout (option A2).
          The anchor renders FIRST as the prominent row (bold label, primary
          checkbox, larger). WHOs follow beneath as muted attribution rows
          without individual checkboxes — a small toggle lets the user
          de-confirm a specific WHO if they really want to. */}
      {section.anchor && (
        <AnchorRowView
          anchor={section.anchor}
          checked={picks.has(section.anchor.identityKey)}
          editedLabel={labelEdits[section.anchor.identityKey]}
          submitting={submitting}
          onToggle={() =>
            onToggle({
              identityKey: section.anchor!.identityKey,
              displayLabel: labelEdits[section.anchor!.identityKey] ?? section.anchor!.displayLabel,
              kind: "PRIMARY",
              uiOrigin: section.state === "found_unanchored" ? "unanchored" : "anchor",
            })
          }
          onEditLabel={(v) => onEditLabel(section.anchor!.identityKey, v)}
        />
      )}

      {section.pairedWhos.length > 0 && (
        <div className="flex flex-col gap-1 pl-3 pt-1">
          <span className="text-[10px] uppercase tracking-wide text-muted font-semibold">
            found via {section.pairedWhos.length === 1 ? "contact" : "contacts"}
          </span>
          {section.pairedWhos.map((who) => (
            <AttributionWhoRow
              key={who.identityKey}
              who={who}
              checked={picks.has(who.identityKey)}
              submitting={submitting}
              onToggle={() =>
                onToggle({
                  identityKey: who.identityKey,
                  displayLabel: who.displayLabel,
                  kind: "SECONDARY",
                  secondaryTypeName: "contact",
                  uiOrigin: "paired-who",
                })
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AttributionWhoRow({
  who,
  checked,
  submitting,
  onToggle,
}: {
  who: PairedWhoRow;
  checked: boolean;
  submitting: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={submitting}
      className={[
        "flex items-center gap-2 text-xs rounded-sm px-1.5 py-1 transition-colors text-left",
        checked ? "text-secondary" : "text-muted line-through opacity-60",
        submitting ? "cursor-not-allowed" : "cursor-pointer hover:bg-surface-highest",
      ].join(" ")}
      title={checked ? "Click to remove this contact" : "Click to include this contact"}
      aria-pressed={checked}
    >
      <span
        aria-hidden="true"
        className={[
          "material-symbols-outlined text-[14px] w-4 h-4 flex items-center justify-center shrink-0",
          checked ? "text-accent-text" : "text-muted",
        ].join(" ")}
      >
        {checked ? "check" : "add"}
      </span>
      <span className="font-medium">{who.displayLabel}</span>
      {who.senderEmail && (
        <span className="font-mono text-[11px] text-muted">· {who.senderEmail}</span>
      )}
      <span className="ml-auto whitespace-nowrap">
        {who.matchCount} email{who.matchCount === 1 ? "" : "s"}
      </span>
    </button>
  );
}

function AnchorRowView({
  anchor,
  checked,
  editedLabel,
  submitting,
  onToggle,
  onEditLabel,
}: {
  anchor: AnchorPrimary;
  checked: boolean;
  editedLabel: string | undefined;
  submitting: boolean;
  onToggle: () => void;
  onEditLabel: (value: string) => void;
}) {
  const value = editedLabel ?? anchor.displayLabel;
  const attribution = sourceCopy(anchor);
  const freqText =
    anchor.frequency > 0
      ? `${anchor.frequency} email${anchor.frequency === 1 ? "" : "s"}`
      : "just confirmed";
  return (
    <div
      className={[
        "flex flex-col gap-1 rounded-sm px-3 py-2.5",
        checked ? "bg-accent-soft ring-1 ring-accent" : "bg-surface-highest",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={submitting}
          className="h-5 w-5 accent-accent"
          aria-label={`Confirm topic ${anchor.displayLabel}`}
        />
        <input
          type="text"
          aria-label={`Name for ${anchor.displayLabel}`}
          value={value}
          onChange={(e) => onEditLabel(e.target.value)}
          disabled={!checked || submitting}
          className="flex-1 bg-transparent text-primary text-base font-semibold border-b border-transparent focus:border-accent focus:outline-none disabled:text-primary"
        />
        <span className="text-[10px] uppercase tracking-wide bg-accent text-inverse rounded px-1.5 py-0.5 font-semibold">
          Topic
        </span>
        <span className="text-xs text-muted whitespace-nowrap">{freqText}</span>
      </div>
      <div className="pl-8 text-xs text-muted">
        {attribution && <span>{attribution}</span>}
        {anchor.senderAttribution && (
          <span className="font-mono">
            {attribution ? " · " : ""}
            {anchor.senderAttribution}
          </span>
        )}
        {anchor.aliases.length > 0 && (
          <div className="mt-0.5">Aliases found: {anchor.aliases.join(", ")}</div>
        )}
      </div>
    </div>
  );
}

function sourceCopy(anchor: AnchorPrimary): string {
  switch (anchor.origin) {
    case "short_circuit":
      return "From your paired contact";
    case "agency_domain_derive":
      return "From your client's domain";
    case "gemini":
      return "Denim found this";
    case "found_unanchored":
      return "From your input — no domain anchor yet";
    default:
      return "";
  }
}

function LoadingState() {
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

// ─── Fallback: pre-Phase-5 by-domain layout for legacy schemas ────────

function DomainFallback({
  schemaId,
  groups,
  picks,
  labelEdits,
  status,
  errorMessage,
  onToggle,
  onEditLabel,
  onSubmit,
}: {
  schemaId: string;
  groups: Stage2PerDomainDTO[];
  picks: Map<string, Pick>;
  labelEdits: Record<string, string>;
  status: SubmitStatus;
  errorMessage: string;
  onToggle: (c: Stage2DomainCandidateDTO) => void;
  onEditLabel: (identityKey: string, value: string) => void;
  onSubmit: () => void;
}) {
  void schemaId;
  const totalCandidates = groups.reduce((n, g) => n + g.candidates.length, 0);
  if (totalCandidates === 0) return <LoadingState />;
  return (
    <div className="w-full max-w-2xl mx-auto">
      <h1 className="font-serif text-2xl text-primary">Confirm what to track</h1>
      <p className="text-muted text-sm mt-1">Legacy review — click to confirm.</p>
      <div className="mt-6 flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.confirmedDomain} className="flex flex-col gap-2">
            <header className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-primary">
                Inside <span className="font-mono text-accent-text">{group.confirmedDomain}</span>
              </h2>
              <span className="text-xs text-muted">
                {group.candidates.length} item{group.candidates.length === 1 ? "" : "s"}
              </span>
            </header>
            <ul className="flex flex-col gap-2">
              {group.candidates.map((candidate) => {
                const checked = picks.has(candidate.key);
                const value = labelEdits[candidate.key] ?? candidate.displayString;
                return (
                  <li
                    key={`${group.confirmedDomain}-${candidate.key}`}
                    className="flex items-center gap-3 rounded-sm bg-surface-highest px-4 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(candidate)}
                      disabled={status === "submitting"}
                      className="h-4 w-4 accent-accent"
                    />
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => onEditLabel(candidate.key, e.target.value)}
                      disabled={!checked || status === "submitting"}
                      className="flex-1 bg-transparent text-primary text-sm font-medium border-b border-transparent focus:border-accent focus:outline-none disabled:text-primary"
                    />
                    <span className="text-xs text-muted whitespace-nowrap">
                      {candidate.frequency} email{candidate.frequency === 1 ? "" : "s"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {status === "error" && errorMessage && (
        <p className="mt-3 text-sm text-overdue">{errorMessage}</p>
      )}
      <div className="mt-8">
        <Button onClick={onSubmit} disabled={picks.size === 0 || status === "submitting"}>
          {status === "submitting"
            ? "Confirming…"
            : `Confirm ${picks.size} ${picks.size === 1 ? "item" : "items"}`}
        </Button>
      </div>
    </div>
  );
}
