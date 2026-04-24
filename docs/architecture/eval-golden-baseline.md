# Eval Golden Baseline — locking in pipeline gains

**Status:** Design proposal, 2026-04-24. Author: Nick DiCarlo + Claude (sprint planning round).
**Implements:** `feature/perf-quality-sprint` regression-prevention strategy.
**Companion:** `apps/web/scripts/eval-onboarding.ts` (the harness this document promotes into a regression gate), master plan §6 SLAs, `eval-good-case-bad-case.md`, `eval-goodonboarding-badonboarding.md`.

---

## 1. Problem

The eval harness produces dated reports per run (`docs/test-results/eval-onboarding-{schema}-full-2026-04-23.md`, etc.). Each run is forensically useful in isolation, but there is **no canonical "this is what good looks like" baseline** that future runs are measured against. Three real consequences from the last week of work:

- Multiple bugs that the fixture harness *could* have caught at PR time were caught only on visual review of the live UI (Phase 5 confirm-screen orphan-entity bug, paired-WHO routing, Sylvan-not-discovered investigation).
- The Supabase database is wiped routinely between sessions. Anything that lived only in DB state — gate-sim verdicts, case titles, entity coverage — is lost the next time the schema is re-created.
- Regressions land silently because no test asserts "the property schema produced these 7 cases with these entities before; it had better still produce them now."

The user's framing, verbatim: *"document the actual results from each stage of the eval onboarding precisely and in a manner that is robust to wiping supabase, so that each NEXT test can match that result perfectly to confirm no regression, OR I update the definition of what good is."*

Two contracts:

1. **Regression detection.** A new run that diverges from the recorded baseline fails loudly.
2. **Intentional baseline updates.** When the divergence is the desired new behaviour, the user (or a PR author) explicitly approves and the new run becomes the baseline.

The golden file IS the spec. It must survive Supabase wipes, code refactors, and machine moves.

---

## 2. Design

### 2.1 Storage

```
docs/test-results/
  golden/
    school_parent.stage12.md      ← Stage 1 + Stage 2 baseline
    school_parent.synthesis.md    ← Full pipeline baseline (cases, entities, scorecard)
    property.stage12.md
    property.synthesis.md
    agency.stage12.md
    agency.synthesis.md
  runs/
    eval-onboarding-property-stage12-2026-04-23.md      ← per-run historical
    eval-onboarding-property-full-2026-04-23.md
    ...
```

Six golden files, one per (schema × stage) pair. Plain markdown, version-controlled, reviewed in PRs like any other source.

### 2.2 Normalisation — what's in, what's out

The golden file captures **semantically meaningful, deterministically reproducible** data. Volatile data is stripped before write/compare.

**In (must match):**

- Stage 1: ordered domain-candidate list with counts; each user-named WHAT match count and top domain; each user-named WHO sender email; hard-assertion verdicts.
- Stage 2: per-domain entity list — `(key, displayString, frequency, kind)` rows in stable sort order. Algorithm name per domain.
- Confirm gate-sim: `accepted` count, `rejected` count, `rejectedByReason` map. Per-entity gateSimVerdict.
- Synthesis: case count, multi-email %, off-topic count, cases-with-entity ratio, cases-with-actions ratio. Per-entity case-title list (sorted), per-case email count and entity-name (NOT case ID). Scorecard verdict per check.
- Performance bands (not absolute values): SLA pass/fail flags, "fast / normal / slow" buckets per stage rather than `durationMs`.

**Out (stripped before compare):**

- All cuids: `schemaId`, `caseId`, `scanJobId`, `emailId`, `entityId`.
- Wall-clock timestamps in headers ("Ran at: ...") and message bodies.
- Absolute `durationMs` values (replaced with a band: `<sla` / `>sla`).
- AI cost dollar figures (cache mode determines this; not a regression signal).
- "Manual review URLs" footer.
- Free-form file paths that include the local repo root.

A stripped golden file looks like the current report files minus the volatile fields, which means we can adapt the existing renderer with a `--golden` flag rather than building a parallel one.

### 2.3 Determinism — the AI-cache contract

Golden comparison only works against deterministic AI output. The harness already supports this via `AI_RESPONSE_CACHE=fixture` (content-hash disk cache at `apps/web/.eval-cache/ai/`). The golden contract:

- **Goldens are recorded with `AI_RESPONSE_CACHE=fixture`** (cached responses only; no live AI calls).
- **The cache directory is committed to the repo** so a fresh clone reproduces. (Roughly tens of KB; tiny.)
- **Any change that invalidates the cache** (prompt edit, model bump, new email content) requires a deliberate `--update-golden` step. This is a feature, not friction — model/prompt changes should be reviewed.

Live-Gmail runs (the user's real inbox) **do not** participate in golden compare. They're separate quality probes; their reports live under `docs/test-results/runs/` and are referenced by date but never asserted against.

### 2.4 Workflow

**Day-to-day developer flow:**

```bash
# Run all three locked schemas through the full pipeline against fixtures.
# Each run compares against the recorded golden and exits nonzero on divergence.
pnpm eval:check

# Output for a passing run:
#   ✓ school_parent.stage12 — matches golden
#   ✓ school_parent.synthesis — matches golden
#   ✓ property.stage12 — matches golden
#   ...
#   3 schemas, 6 baselines, all matched. Pipeline behaviour locked.

# Output for a failing run:
#   ✓ school_parent.stage12 — matches golden
#   ✗ property.synthesis — DIVERGED
#       diff: docs/test-results/runs/property.synthesis.diff
#       7 of 7 cases produced (matches), but case "3910 Bucknell Drive – Plumbing & Repairs"
#       email count changed: 5 → 4
```

**When divergence is a regression:** revert the offending change, reproduce, fix the bug.

**When divergence is intentional:**

```bash
pnpm eval:approve --schema property --stage synthesis
# Overwrites docs/test-results/golden/property.synthesis.md with the new run.
# Prints a side-by-side diff for review and prompts y/n.
```

The approval step is verbose by design — the user is signing the new contract, not just clicking through.

**CI enforcement:**

- `pnpm eval:check` runs on every PR via GitHub Actions.
- A diverged golden fails the CI job.
- The PR description must either explain the regression fix or include the updated golden file in the diff. Reviewers see both code and golden in the same PR.
- A separate CI job re-runs the cache against the master plan's locked schemas weekly to catch corpus drift.

### 2.5 What "matches" means — comparison rules

Comparison is **deterministic line-equality on the normalised golden**, not a fuzzy AI-style match. The normaliser handles ordering (sort entities by key, sort cases by entity then title, sort domains alphabetically) so that legitimate ordering differences don't trigger false alarms.

When entries genuinely differ, the diff is shown in unified-diff format. The user (or reviewer) reads it and decides.

---

## 3. Implementation steps

Estimated 4-6 hours. Bounded by writing the normaliser + plumbing, not novel logic.

| # | Work | File(s) | Notes |
|---|---|---|---|
| 1 | Add `--mode {compare-golden, update-golden, write-run}` flag to `eval-onboarding.ts`. Default: `write-run` (current behaviour). | `apps/web/scripts/eval-onboarding.ts` | Existing flow keeps working unchanged. |
| 2 | Extract a `normaliseReport(report)` function that strips volatile fields. | new `apps/web/scripts/eval-onboarding-normalise.ts` | Pure, unit-testable. |
| 3 | Capture initial goldens — one-time run of all 3 schemas × 2 stages with `--mode update-golden`. | `docs/test-results/golden/*.md` | Six files, ~20 KB total. |
| 4 | Add `pnpm eval:check` and `pnpm eval:approve` scripts to root `package.json`. | `package.json` | Wraps the harness with sensible defaults. |
| 5 | Wire CI: `.github/workflows/eval-gate.yml` runs `pnpm eval:check` on every PR. | `.github/workflows/eval-gate.yml` | Cached AI responses make this cheap. |
| 6 | Write `apps/web/scripts/README.md` covering the workflow + when to update goldens. | `apps/web/scripts/README.md` | Single source for the contract. |
| 7 | Add a lessons-learned entry: "AI-driven outputs at trust boundaries get golden-baseline regression tests, not just unit tests." | `docs/01_denim_lessons_learned.md` | New principle #19 (or wherever the count sits). |

---

## 4. What this gives us

**Direct:**

- A single command tells you whether your last change broke the eval pipeline.
- Approving a new behaviour is an explicit, reviewable act.
- Supabase wipes don't lose anything that matters — the golden is the source of truth.

**Indirect:**

- The "locked-schemas-pass" claim in the master plan §16 becomes machine-checkable.
- New domains (construction, legal, general per master plan §5) get added to the golden set when their first eval run produces an acceptable baseline.
- Refactors that touch clustering, extraction, or synthesis surface their case-quality impact at PR time, not on a Friday-afternoon visual review.

**What it does NOT replace:**

- The live-Gmail test against the user's real inbox. That's a separate probe and stays separate. Goldens cover deterministic fixture behaviour; live-Gmail covers reality drift.
- Manual visual review of confirm screens and the feed. Goldens assert pipeline shape; humans assert UI quality.
- Per-PR judgement on whether a change is correct — a passing golden compare doesn't mean the change is right, only that it's not causing pipeline regression in covered cases.

---

## 5. Risks and edge cases

- **Cache miss on a new prompt or model bump cascades into golden invalidation.** Mitigation: a model/prompt bump is a deliberate change that should produce a deliberate golden update in the same PR. The friction is the feature.
- **Three locked schemas might not catch domain-specific regressions in `construction` / `legal` / `general` once those land.** Mitigation: the framework supports adding goldens; new domains earn one as they stabilise.
- **Fixture corpus rot** — if `denim_samples_individual/` ever changes (curation, additions), goldens shift. Mitigation: the corpus is also committed; changes to it are a deliberate PR.
- **The "exactly 30.0 merge score" issue (#123) shows up in the property golden right now.** That's a *current* baseline, not a target. When #123 is fixed, the golden updates to reflect the better baseline (more multi-email cases, fewer singletons). The golden tracks reality, not aspirational behaviour.

---

## 6. Open questions for sprint planning

1. Do we capture golden for the live-Gmail run in any form, or keep it strictly fixture-only? Suggestion: live-Gmail produces a dated run report under `docs/test-results/runs/` for archaeology, but no golden compare. Reality drifts; goldens shouldn't pretend otherwise.
2. Should the gate-sim verdicts go in stage12 or synthesis golden? Suggestion: synthesis (it's the contract for the confirm flow's downstream impact).
3. Is six golden files the right granularity, or should we split synthesis into "scorecard" + "case-list" so a case-title rename doesn't invalidate the scorecard? Suggestion: keep six for now; split if false alarms become a real friction. YAGNI applies.

---

## 7. Decision

**Recommend: implement.** The estimated cost is 4-6 hours. The leverage is durable — every future change to the pipeline gets a free regression check. The user's framing in the design ask is exactly the right contract; the work is mostly plumbing on top of an eval harness that's already proven.

Open the implementation as a tracked issue and slot it into the next sprint.
