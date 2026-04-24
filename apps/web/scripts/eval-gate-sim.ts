/**
 * Eval review-screen gate simulator (Phase 5 Part E).
 *
 * The review screen I just shipped pre-ticks USER_HINT / USER_SEEDED /
 * STAGE2_SHORT_CIRCUIT / STAGE2_AGENCY_DOMAIN rows, leaves STAGE2_GEMINI
 * rows in the "Also noticed" section (unticked), and omits spec-§5
 * violations entirely. A real user would click "Confirm" after reviewing —
 * so the expected default acceptance set is:
 *
 *   - All deterministic-origin rows (short-circuit / agency-derive)
 *   - Every paired-WHO row that surfaced (USER_SEEDED)
 *   - Every user-typed WHAT row (USER_HINT, including found-unanchored)
 *   - STAGE2_GEMINI rows that are "high-signal" adjacents — score ≥ 1 OR
 *     token-overlap with a user hint. Score=0 singletons with no overlap
 *     represent the "user probably wouldn't bother checking this" case.
 *
 * Everything else is rejected (with a reason code so the eval report can
 * show where noise came from).
 *
 * Pure function — no I/O. Input is the `ConfirmedEntity[]` the harness is
 * about to pass to `persistConfirmedEntities`.
 */

import type { ConfirmedEntity } from "@/lib/services/interview";

type OriginName = NonNullable<ConfirmedEntity["origin"]>;

export type GateVerdict = "accepted" | "rejected";

export type RejectionReason =
  | "stage2_gemini_score_0_no_hint_overlap"
  | "unknown_origin"
  | "mid_scan_without_hint_overlap";

export interface GateSimInput {
  entities: ReadonlyArray<ConfirmedEntity>;
  /** Literal user-typed WHAT phrases. Used for token-overlap check. */
  userWhats: ReadonlyArray<string>;
}

export interface GateSimResult {
  accepted: ConfirmedEntity[];
  rejected: Array<{ entity: ConfirmedEntity; reason: RejectionReason }>;
  /** Per-entity verdict map keyed by `identityKey` so reports can annotate. */
  verdicts: Map<string, GateVerdict>;
  /** Per-reason rejection counts for the summary report. */
  rejectedByReason: Record<string, number>;
}

const ALWAYS_ACCEPT: ReadonlySet<OriginName> = new Set<OriginName>([
  "USER_HINT",
  "USER_SEEDED",
  "STAGE1_TRIANGULATED",
  "STAGE2_SHORT_CIRCUIT",
  "STAGE2_AGENCY_DOMAIN",
  "FEEDBACK_RULE",
]);

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

function hasHintOverlap(label: string, userWhats: ReadonlyArray<string>): boolean {
  if (userWhats.length === 0) return false;
  const labelTokens = tokenSet(label);
  if (labelTokens.size === 0) return false;
  for (const what of userWhats) {
    for (const t of tokenSet(what)) {
      if (labelTokens.has(t)) return true;
    }
  }
  return false;
}

export function simulateReviewGate(input: GateSimInput): GateSimResult {
  const accepted: ConfirmedEntity[] = [];
  const rejected: Array<{ entity: ConfirmedEntity; reason: RejectionReason }> = [];
  const verdicts = new Map<string, GateVerdict>();
  const rejectedByReason: Record<string, number> = {};

  const recordReject = (entity: ConfirmedEntity, reason: RejectionReason) => {
    rejected.push({ entity, reason });
    verdicts.set(entity.identityKey, "rejected");
    rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
  };

  for (const e of input.entities) {
    const origin = e.origin;
    if (origin && ALWAYS_ACCEPT.has(origin)) {
      accepted.push(e);
      verdicts.set(e.identityKey, "accepted");
      continue;
    }
    if (origin === "STAGE2_GEMINI") {
      const score = e.discoveryScore ?? 0;
      const overlap = hasHintOverlap(e.displayLabel, input.userWhats);
      if (score >= 1 || overlap) {
        accepted.push(e);
        verdicts.set(e.identityKey, "accepted");
      } else {
        recordReject(e, "stage2_gemini_score_0_no_hint_overlap");
      }
      continue;
    }
    if (origin === "MID_SCAN") {
      if (hasHintOverlap(e.displayLabel, input.userWhats)) {
        accepted.push(e);
        verdicts.set(e.identityKey, "accepted");
      } else {
        recordReject(e, "mid_scan_without_hint_overlap");
      }
      continue;
    }
    // Unknown / undefined origin → reject with a catch-all reason so the
    // report surfaces data-shape drift.
    recordReject(e, "unknown_origin");
  }

  return { accepted, rejected, verdicts, rejectedByReason };
}
