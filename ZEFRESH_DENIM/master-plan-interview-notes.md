# denim master plan — interview notes (working draft)

**Author:** Claude, interviewing Nick
**Status:** Rounds 1 and 2 complete. Round 3 (Q13–Q18) pending — Nick answering ~2026-04-22 evening.
**Purpose:** Accumulate everything captured during the master-plan interview so the final `denim-master-plan.md` draft is synthesis, not memory. Read this before resuming.
**Companion docs:**
- `ZEFRESH_DENIM/denim-master-plan.md` — Nick's original kernel (do not overwrite)
- `ZEFRESH_DENIM/eval-goodcase-bad-case.md` — Nick's case-quality criteria (already extracted)
- `docs/domain-input-shapes/{property,school_parent,agency}.md` — locked domain specs
- `docs/domain-input-shapes/consumer-research-notes.md` — deferred research

---

## 1. Mission (locked)

Denim transforms unstructured email into organized cases using deterministic clustering + AI extraction, so that affluent professional parents — and later anyone with a noisy inbox — feel in control of their life admin with minimum effort. Brand promise: **simple, easy, quiet**. We don't add to notification hell; we reduce cognitive load so the user can make fast decisions from a glance.

Commercial-grade SaaS from day one. CASA Tier 2 security target. 10K–100K monthly subscribers as the long-horizon destination.

---

## 2. Target user / ICP (locked)

- **Provider:** Gmail / Google Workspace only at launch. Outlook is a post-10K-customer feature.
- **Persona:** Affluent professional who is also a parent. Primary organization need is **kids' activities and school**, expanding organically into investments, home renovations, small work projects run from personal Gmail, etc.
- **Attitude:** Does not care about "AI" or tech. Wants life organized with minimum effort. Willing to pay to quiet the noise.
- **Users per user:** Starts with 1 topic. Sweet spot 3–5 topics. Power users 3–10. Each topic onboarded separately so each gets a clean, fast experience.
- **Geography:** US-only for the first 12 months minimum.

---

## 3. Success metrics (locked, 3–6 month horizon)

| Metric | Target |
|---|---|
| Paying subscribers | 100–1,000 in 3–6 months post-launch |
| Weekly active rate | 75%+ (anything less is churn risk) |
| Retention | High — churn risk is concentrated at onboarding (user sees cases and judges quality) |
| Topics per user | 3–5 sweet spot; 3–10 typical |
| Sessions per day | Multiple — users check several times daily |
| Session length | ~4 seconds per glance is the target ambient usage |
| Gross margin | 30–70% after AI + infra |

**Unit-economics thesis:** Onboarding is AI-heavy and expensive (Claude + Gemini). Steady-state organization is cheap because the gravity model is deterministic and Gemini synthesis is inexpensive. Costs drop the longer the subscriber stays — this is the core business-model bet.

---

## 4. Pricing (locked)

- SaaS, month-to-month, paid-only, no contract.
- Free trial: 7 or 30 days, tuned to onboarding token cost.
- Target price: $5–$10/month; max $15/month. Above that, the value ceiling is crossed.
- Instant unsubscribe, one-click account delete.

---

## 5. Performance SLAs (locked from /domain-input-shapes)

| Stage | Budget | Status |
|---|---|---|
| Stage 1 — domain confirmation | **<5 sec** | Commitment, not aspiration. Metadata-only Gmail fetch, regex, zero AI. |
| Stage 2 — entity confirmation | **<6 sec** | Commitment. `from:*@<domain>` parallel, regex + Levenshtein, zero AI. |
| Stage 3 — deep scan | **<5 min (background)** | Commitment. Gemini extraction + Claude clustering, user is not waiting. |
| First-topic end-to-end perceived time | **~2 min ideal, ≤5 min acceptable** | User is engaged; deep scan finishes while they continue. |
| Subsequent topic onboarding | **Background only** — user never waits |
| Daily sync | **6am local time** cron + on-login auto-trigger. Cases waiting when the user arrives. |

**Rate-limit stance:** Design to avoid Gmail rate limits, do not handle them at runtime. This is a hard architectural constraint.

---

## 6. Architecture principles (locked from /domain-input-shapes)

1. **Asymmetric axes.** PRIMARY = WHATs (things being managed). SECONDARY = WHOs (email-addressable interactors). WHO signal is cheap (headers); WHAT signal is expensive (content).
2. **Time-durability.** A PRIMARY exists without a date. A CASE is always date/event-tied. Test: *"Can this exist without a date attached?"*
3. **SECONDARY = email addresses, not names.** Names are hints; addresses are identity. Routing happens on `From:`/`To:`/`Cc:` only, never body text.
4. **Compounding-context inclusion.** No single signal confirms membership. Multiple signals must align.
5. **Validation feedback loop.** Seeded-WHO → discovered-PRIMARY → expanded-WHO. This loop IS why Stages 1/2/3 exist as separate stages.
6. **Speed constraint on WHO discovery.** <10 sec for several hundred emails, via metadata + parallel + regex/string-math. No AI in hot path.

Plus from CLAUDE.md:

7. **Zero I/O in packages.** `@denim/engine` and `@denim/ai` are pure. All I/O lives in `apps/web/src/lib/services/`.
8. **Metadata-first.** Rarely re-fetch from Gmail.
9. **Feedback as first-class data.** Every correction is an event.
10. **Interview-generated configuration.** No domain-specific `if/else` inside services.
11. **Defense in depth.** RLS + Zod + encrypted tokens + scoped queries + typed errors.
12. **Pairing principle.** Every entity rule ships paired with its UI copy. Mismatched copy silently undoes rules.

---

## 7. Privacy promise (locked)

Plain-English commitments, user-facing:

- **We never train AI on your data.**
- **One-click delete: everything, including backups, gone on request.**
- **Instant unsubscribe, month-to-month, no contract.**
- **We store email metadata + AI-generated summaries. We do NOT store email bodies or attachment bytes.**
- **OAuth tokens encrypted at rest. `gmail.readonly` scope only at launch. Calendar write later. Never `gmail.send`.**
- **Service role key server-only.**

CASA Tier 2 compliance is the target (Q14 pending: timing).

---

## 8. MVP scope (locked)

**In:**
- Gmail / Google Workspace only
- Unlimited topics per user
- Mobile-primary responsive web, desktop secondary
- Daily cron sync + on-login auto-trigger; cases ready when user arrives
- CASA Tier 2 authorization (timing TBD — Q14)
- The 3-stage onboarding flow per domain specs
- Locked schemas: `property`, `school_parent`, `agency` + (pending) `construction`, `legal`, `general`

**Out (post-10K-customer features):**
- Email sending / reply drafting
- Outlook support
- Native mobile app
- Team / shared inboxes
- Full-text email search
- AI chat/RAG over inbox
- Write to calendar (later), write to-do lists (later), other form factors (later)

---

## 9. Good-case / bad-case criteria (locked — pointer)

Full criteria in `ZEFRESH_DENIM/eval-goodcase-bad-case.md` (Nick maintains).

**Summary:**
- **Good case** = topic coherence + future-oriented time logic + real action needed
- **Bad case** = mixed practices/games/misc, newsletter/marketing contamination, irrelevant senders

**Tolerance:** Moderate. A few stray emails OK. Borderline join/split calls are OK *as long as* the system can take feedback and tune to the specific subscriber's preferences. The feedback loop is the answer to quality variance — it isn't a "nice to have" feature, it's the structural reason we can ship imperfect first-pass clustering.

---

## 10. Failure behavior (locked)

**Universal rule:** Errors are **loud to developers, quiet to users.** Every failure produces a structured log with full context (`{timestamp, level, service, schemaId, userId, operation, duration, stack}`) that the team can triage. The user sees the correct result (after silent retry/degrade) or a plain-English action-oriented message ("We couldn't reach Gmail just now — we'll retry automatically"). Never a stack trace, error code, or silent blank state.

**Specific failure modes:**
- AI extraction fails on 1–2 emails per batch → non-fatal, log and continue.
- Gmail rate limits → **avoid by design**, not handle at runtime.
- 50K-email 56-day inbox → topic-at-a-time moderates this; lookback cap reserved; the review screen lets the user confirm scope.
- Discovered entity is wrong → review screens are the mitigation. Search should also surface things the user didn't mention, so the product *helps them get organized over time*.
- User adds to an existing topic 6 months in (e.g., kid picks up a new activity) → supported, not a special case.

---

## 11. Information hierarchy (locked)

Each case card at a glance shows, in order:

1. **What it is** (case title — understandable in <2 seconds)
2. **Next action + deadline** (the thing to do, when)
3. **Where + when** (event location + time, with clickable map if applicable)

Rich visual design already exists for this — use it as the source of truth when building.

4-second-glance rule: if a user has to click, tap, or scroll to know what to do about a case, the information hierarchy has failed.

---

## 12. Topic constraints (partially locked, Q17 to confirm)

**Already locked schemas** (per /domain-input-shapes):
- `property` — street-addressed/named properties; tenants, vendors, HOAs
- `school_parent` — schools, activities, coaches, teachers, youth sports + arts
- `agency` — external client companies for consultants/agencies

**Phase-1 next schemas:** `construction`, `legal`, `general` (in progress per 2026-04-15 session doc).

**Candidate backlog (deferred, parked in consumer-research-notes.md):**
- Healthcare / caregiver-for-family (highest priority after Phase 1)
- Travel (trip-based PRIMARY)
- Tax-year management
- Subscriptions / recurring invoices
- Household services (owner-occupier variant of property)
- Portal-bounce detection (possibly a case type, not a schema)

**Explicitly NOT schemas — filter, don't organize:**
- Retail promos / e-commerce
- SaaS system alerts
- Newsletters / content bloat

**Topic smell test (needs UI enforcement — not yet specified):**
- A topic must pass the time-durability test (can a PRIMARY exist without a date?).
- A topic must be entity-anchored, not semantic ("all my work emails" fails; "Anthropic client work" passes).
- Single-sender "topics" (e.g., "emails from my wife") are NOT topics — the product is for organizing life admin, not relationship management.

---

## 13. Parked for later decision (do not build yet)

1. **Downstream actions beyond calendar.** Research says the real value is reducing friction of *acting* on organized info (text spouse, update calendar, change work schedule). Today we only support calendar. Add post-MVP, likely post-10K.
2. **Aggressive noise-exclusion filter as a parallel workstream.** Retail/SaaS/newsletter filter layer could be a paid-tier differentiator. Not MVP.
3. **Portal-bounce case type.** PowerSchool/Canvas/Infinite-Campus-style "you have a new message in a portal" emails are a distinct pain shape. Design later.
4. **Chat/RAG over inbox.** Nick flagged as valuable but explicitly not MVP.
5. **Drag-drop regrouping UI.** Referenced as deferred in school_parent.md. Part of the learning loop when that lands.
6. **Demographic generalization.** ICP is locked to affluent professional parents. The consumer-research doc's open question ("general consumer vs prosumer vs niche") is *answered for Phase 1*; generalization is a post-10K question.

---

## 14. Round 3 answers (LOCKED 2026-04-22 evening)

### Q14. CASA Tier 2 timing — **LAUNCH-GATING**

CASA Tier 2 certification is **required before any public launch**. Google will not let us launch without it. "Security is paramount throughout our development" — this is not a milestone we reach late; it's a constraint on every line of code.

**Master-plan consequences:**
- CASA2 is a P0 blocker, not a phase-3 item. The RLS verification gap (from §15.3) is effectively a CASA2 readiness gap — must be resolved before any beta with real users.
- Every feature's acceptance criteria include a security review. Tokens, scopes, RLS, logging, data retention are checked at PR time, not at audit time.
- Plan ~6–12 weeks + $15K–$75K for the assessment itself. Factor this into the 3–6-month go-to-market window.

### Q16. Feedback loop — **User corrections are authoritative per-topic routing rules**

> *"User tells us an email doesn't belong in a case at all, or what case it belongs in. That is authoritative and we rewrite the routing rules based on that for that topic."*

Not a vote, not a soft signal — **an absolute command to the system**. Two canonical user actions produce deterministic per-topic routing rules:

| User action | System response on next sync |
|---|---|
| *"This email doesn't belong in this case"* (with no target) | That email is **excluded** from clustering for this topic. Persisted as a per-user, per-topic rule. Future emails matching the same routing signature (sender + subject-shape? thread?) are evaluated against the exclusion. |
| *"This email belongs in case X"* (explicit target) | A positive routing rule is written: future emails matching the same routing signature go to case X. Rule is immediate and deterministic; the gravity model is told the answer, it does not re-vote on it. |

**Design principles:**
- Rules are **per-schema** (per-topic), **per-user**, **deterministic**, and effective on next sync.
- Rules **override** gravity-model scoring — user authority trumps algorithm.
- The *routing signature* (what's the match key for "similar future emails"?) is an engineering design question worth a separate spec — candidates: sender address, sender-domain + subject-vocabulary, thread ID, or a combination.
- Current `FeedbackEvent` + auto-`EMAIL_EXCLUSION` rule (from §15.2) is a down-payment but isn't complete: it handles exclusion after 3+ corrections and doesn't handle positive routing at all. This is the MVP gap to close.
- **No Claude/Gemini retraining.** Rules are stored rows, not model weights. Cheap, auditable, explainable to the user ("you moved these 3 emails to case X, that's why future ones go there").

### Demographic — confirmed

ICP = affluent professional parent (Gmail / Google Workspace). Locked as written in §2.

### Q18. Agent autonomy / dev process — **"Do the correct thing, not the easy thing."**

Nick's exact guidance:

> *"The agent who is coding needs to really understand the problem they are solving, not just rush to fix things. No compromises on quality or usability of the solution and no short cuts. Do the correct thing, not the easy thing. Be open and transparent."*

**Master-plan translation to concrete agent rules:**

1. **Understand before acting.** Every non-trivial task begins with reading the relevant section of: CLAUDE.md, `docs/00_denim_current_status.md`, `docs/01_denim_lessons_learned.md`, the relevant /domain-input-shapes spec (if domain-related), and the relevant `docs/superpowers/plans/` file (if active sprint work). If you can't articulate the problem in your own words, you are not ready to write code.
2. **No shortcuts that create debt.** If the spec says "zero AI in Stage 2," don't ship Gemini-in-Stage-2 "for now" without explicit spec amendment. If a CAS helper owns a transition, don't `updateMany` around it. If a constant should be in `shared/`, don't co-locate it with `"use client"`. The lessons-learned log has 12 classes of silent failure that started as "just for now" shortcuts.
3. **Transparency is required.** When you find something messy, say so. When you make a judgment call not explicitly covered by the spec, flag it. When the easy path and the correct path diverge, surface the choice to the user rather than deciding silently.
4. **Security is foundational, not a stage.** Every change goes through the security checklist from §7 and §10 before it's considered done.
5. **Read `docs/01_denim_lessons_learned.md` before any non-trivial PR.** The "Patterns to watch for" section (12 codified patterns with concrete grep checks) is mandatory preflight. Violations cost the project days of E2E debugging — the sprint history shows Bug 1 → Bug 5 → Bug 7 as the same class of error caught three times.
6. **Definition of done:** (a) code compiles, (b) typecheck clean, (c) affected unit + integration tests pass, (d) manual verification if the change touches user-facing flow or data, (e) documented in a commit message or PR body with the *why*, (f) no new violations of the 12 preventive patterns.

**Implicit posture:** Default to "propose → approve → execute" for architectural calls, spec amendments, new AI calls, new dependencies, anything security-touching. Execute-within-guardrails for bounded, spec-aligned, well-trodden code changes. When in doubt, propose.

---

## 14B. Governing principles carried forward into the master plan

These become canonical text in the final master plan:

- **Security is paramount throughout development.** Not a phase, not a checklist item — a pervasive constraint that shapes every design call.
- **User corrections are authoritative.** The system does not debate the user's labels; it rewrites rules to match them.
- **CASA Tier 2 is launch-gating.** No CASA, no launch.
- **Do the correct thing, not the easy thing.** Transparent about tradeoffs. No "just for now" shortcuts that become permanent.
- **Read before writing.** Every non-trivial task starts with relevant spec + lessons-learned + current-status reading.

---

## 14C. Mandatory agent reading (required before any non-trivial code)

These documents are canonical. Agents who skip them repeat production-impacting bugs the team has already paid for.

| Doc | Purpose | When to read |
|---|---|---|
| `CLAUDE.md` | Stack, structure, security non-negotiables | Every session start |
| `docs/00_denim_current_status.md` | What's shipped, what's in flight, what's deferred | Before proposing new work |
| `docs/01_denim_lessons_learned.md` | 12 codified preventive patterns + CAS Ownership Map | Before any PR touching Inngest, auth, CAS, credentials, schemas, or AI orchestration |
| `docs/domain-input-shapes/{property,school_parent,agency}.md` | The 6 principles + locked per-domain specs | Before any onboarding/discovery/entity work |
| `docs/architecture/engineering-practices.md` (if present) | Table ownership, idempotency patterns, naming rules | Before writing any service |
| Active sprint plan under `docs/superpowers/plans/` | Current execution context | If working on an open issue |

---

## 14D. Still-open clarifications (small, can default if Nick doesn't answer)

These are minor; I'll default them in the master plan draft unless Nick overrides:

- **SLA strictness (Q13):** Proposed default — treat <5s/<6s/<5min as commitments. Failing them is a P1 (not P0) with a structured log + alert + weekly review. Upgrade to P0 if the same SLA fails twice in a week.
- **Review-screen cadence (Q15):** Proposed default — review screens appear at (a) onboarding Stages 1 and 2, (b) explicit user action ("Add to this topic"), and (c) monthly "we found these new things — keep/drop?" surface for each active topic. No periodic forced review — users hate that.
- **Routing signature for feedback rules (implied by Q16):** Proposed default — MVP uses sender address (or sender domain for corporate domains) + subject-tag-set. Thread-ID-based rules added if sender-based misclassifies. Full specification to land in a dedicated design doc before code.

---

## 15. Codebase inventory (complete — 2026-04-22)

Three subagents inventoried the codebase in parallel. Full reports below. **Synthesis up top.**

### 15.0 Top-line synthesis

**The good news — more than 50% of what exists is worth keeping.**

- `@denim/engine` and `@denim/ai` packages are **clean, pure, tested, and production-quality**. Zero I/O leaks. Single gravity model, no competing experiments. This is the strongest layer of the codebase.
- Onboarding infrastructure (outbox, CAS guards, state machine, Inngest fan-out, domain discovery, per-domain entity discovery) is **solid and spec-aligned**.
- Security primitives (AES-256-GCM token encryption, `gmail.readonly`-only scope, typed errors, structured logging, Zod input validation) are **done right**.
- `domain-config.ts` UI copy implements the pairing principle for 6 domains.

**The bad news — four high-priority gaps.**

| # | Finding | Severity | Why it matters |
|---|---|---|---|
| 1 | **RLS policies NOT version-controlled.** Prisma schema has no RLS comments; no RLS migration files exist. Whether policies are actually enabled in Supabase is unknown. | **P0 BLOCKER** | CLAUDE.md mandates RLS on every table. CASA Tier 2 cannot pass without verified RLS. If missing, every query is only logically scoped (by code), not database-enforced. |
| 2 | **Stage 2 spec drift: commit #129 replaced regex + Levenshtein with Gemini subject-pass.** The locked /domain-input-shapes spec commits to **zero AI + <6s** for Stage 2. Current code uses Gemini. | **Strategic — needs Nick decision** | Either restore regex + Levenshtein (spec-compliant, faster, no AI cost) or formally amend the spec to accept Gemini (simpler code, AI cost per onboarding). Cannot have both as "locked." |
| 3 | **Stage 1 + Stage 2 review-screen UI is missing.** Stage 1/2 results are persisted but never shown to the user. Flow jumps Card1 → Card4 deep-scan. The core "discovery-confirm-include" loop Nick flagged in his memory is architecturally incomplete. | **P0 feature gap** | The whole point of the 3-stage architecture (per Nick's memory `feedback_core_product_loop.md`) is the confirm step. Without it, the validation feedback loop can't function. |
| 4 | **Feedback loop partially wired; Q16 blocks the rest.** FeedbackEvents are logged + used for calibration and auto-EXCLUSION rules, but there's no mid-sync weight adjustment. Per memory `project_learning_loop_needed.md`, this is known. | **Medium — design pending** | Nick's Q16 answer determines the MVP mechanics (blacklist vs. tag-score vs. retrain). Engine is ready to receive the decision. |

**Smaller findings:**
- Agency `whatPlaceholder` still says "Acme Corp rebrand" (an engagement) instead of company names — caused the 2026-04-15 Consulting test user to type "Asset Management." Quick fix.
- `cronDailyScans` exists but runs event-driven, not scheduled yet (ready to swap to `cron: "TZ=UTC 0 6 * * *"`).
- No real-inbox fixtures for clustering quality regression tests. Engine tests use synthetic data only.
- Email-body-storage audit not yet done (need grep for `format: "full"` and `mimeMessage` in services).
- On-login auto-trigger of sync is claimed in master plan but not found in code.

**Net verdict:** Do NOT throw out 100%. The engine and security foundations are worth preserving. The onboarding pipeline infrastructure is worth preserving. What needs work: the Stage 1/2 review UI, the Stage 2 AI-vs-regex decision, RLS verification, and the feedback mechanics. These are 4 bounded problems, not a rewrite.

---

### 15.1 Onboarding + discovery inventory (full report)

#### KEEP (aligns with spec, production-quality)

- `apps/web/src/app/api/onboarding/start/route.ts` — Transactional outbox pattern (#33) for `onboarding.session.started` with CAS idempotency. Dual-path (fast optimistic emit + drain cron recovery). 202 accepted response per spec.
- `apps/web/src/app/api/onboarding/[schemaId]/domain-confirm/route.ts` — Stage 1→2 transition gate. CAS guards `AWAITING_DOMAIN_CONFIRMATION → DISCOVERING_ENTITIES`. Handles `confirmedUserContactQueries` for #112 paired-WHO context seeding.
- `apps/web/src/app/api/onboarding/[schemaId]/entity-confirm/route.ts` — Stage 2→3 transition gate. Persists confirmed entities atomically, emits `onboarding.review.confirmed` via outbox. Identity-key validation blocks server-reserved `@`-prefix hijacking.
- `apps/web/src/lib/inngest/onboarding.ts` (Functions A + B) — Thin dispatcher + pipeline driver. CAS guards prevent race-condition phase doubly-advancement. Retries bumped to 2 (#69).
- `apps/web/src/lib/inngest/domain-discovery-fn.ts` — Stage 1 orchestrator. Parallel discovery: domains + named-contacts + named-things. Writes stage1 candidates, advances to AWAITING_DOMAIN_CONFIRMATION. <5s wall.
- `apps/web/src/lib/inngest/entity-discovery-fn.ts` — Stage 2 per-domain fan-out. Per-domain error isolation (Gmail auth rethrows, other errors logged + continued).
- `apps/web/src/lib/discovery/domain-discovery.ts` — Stage 1 orchestrator. Metadata-only fetch + domain aggregation + generic-provider drop. Zero AI.
- `apps/web/src/lib/discovery/entity-discovery.ts` — Stage 2 Gemini subject-pass (see REVISE below — this is the spec-drift).
- `apps/web/src/lib/inngest/onboarding-outbox-drain.ts` — Generic transactional-outbox recovery cron. Exponential backoff, 10-attempt DEAD_LETTER cap.
- `apps/web/src/lib/inngest/scan.ts` — Stage 3 orchestrator.
- `apps/web/src/components/interview/domain-config.ts` — Pairing principle lock for 6 domains.
- `apps/web/src/components/interview/card1-input.tsx` — Role selection + entity group input.
- `apps/web/src/lib/config/onboarding-tunables.ts` — Centralized Stage 1/2/3 knobs.

#### REVISE

- **`domain-config.ts` agency `whatPlaceholder`** — says `"Acme Corp rebrand"` (engagement, not company). Spec says `"e.g. \"Anthropic\" or \"Portfolio Pro Advisors\""`. Known to have misled 2026-04-15 Consulting test user.

#### DELETE / STRATEGIC DECISION

- **Stage 2 Gemini subject-pass vs. regex + Levenshtein** — Commit 4020e62 replaced regex-based entity mining (Pattern A/B/C per spec) with Gemini. This violates the locked "zero AI, <6s" commitment in the domain specs. **Decision required (Nick):** honor spec (restore regex) or amend spec (accept Gemini as Stage 2 primary).

#### MISSING

- **Stage 1 + Stage 2 review screen UI** — Spec §4 (all three domains) calls for confirmation UI with email counts, inline edit/merge, "Add another" fallback. `Card4Review` exists but is the old single-screen hypothesis flow, not the new three-stage flow. Current code jumps Card1 → Card4 deep-scan. Stage 1/2 results are persisted silently and never shown.
- **No UI for discovered "user-named things"** — `discoverUserNamedThings` runs, `stage1UserThings` is persisted, no UI surface.
- **No UI for "your contacts" discovery** — `discoverUserNamedContacts` runs, `stage1UserContacts` is persisted, no UI surface.
- **Prisma schema alignment audit** — Code references `stage2ConfirmedDomains`, `stage1UserContacts`, `stage1ConfirmedUserContactQueries`, `discoveryQueries`, `entityGroups`. Verify these columns all exist.
- **Stage 3 spec-compliance verification** — Verify Gemini extraction + Claude clustering system prompts match anti-signals sections of domain docs.

---

### 15.2 Engine + AI inventory (full report)

#### KEEP (pure, tested, production-quality)

- `packages/engine/src/clustering/gravity-model.ts` — Deterministic clustering, zero I/O, single implementation.
- `packages/engine/src/clustering/scoring.ts` — Pure scoring (thread 100, subject 50×sim, actor 30, tags 15×Jaccard). Time decay 0.2–1.0. Takes `now` as parameter, never `Date.now()`.
- `packages/engine/src/actions/lifecycle.ts` — Pure urgency decay + next-action.
- `packages/engine/src/actions/dedup.ts` — Jaro-Winkler action fingerprinting.
- `packages/engine/src/clustering/reminder-detection.ts` — Pure reminder-collapse.
- `packages/ai/src/parsers/*.ts` — All Zod-validated pure parsers (synthesis, extraction, hypothesis, case-splitting, calibration, discovery-intelligence).
- `packages/ai/src/prompts/synthesis.ts` — 2,400+ line synthesis prompt covering time-neutral language, urgency, mood, action extraction, emoji. Aligns with good-case criteria.
- `packages/types/` — Interfaces only, zero runtime code, zero deps.
- `packages/engine/src/__tests__/clustering.test.ts` — Unit tests for scoring + entity boundaries.

#### REVISE

- `apps/web/src/lib/services/synthesis.ts` — Orchestration correct, but `aggregateFieldData` uses raw extracted data without Zod boundary validation. Low risk (parsers catch downstream), still worth adding.
- `apps/web/src/lib/services/cluster.ts` (lines 700–799, splitCoarseClusters) — Claude called for coarse-cluster splitting only in CALIBRATING/TRACKING phases; STABLE uses deterministic `discriminatorVocabulary`. This is correct for unit economics. BUT: frequency analysis (1287–1350) mixes stop-word filtering inline — worth extracting to engine for testability.

#### DELETE

- **None found.** Engine + AI are clean. No I/O leaks, no competing implementations.

#### MISSING

- **Clustering quality fixtures + regression tests.** Tests use synthetic `makeEmail`/`makeCase`. No real-inbox ground-truth labels. Nick would need to provide 5–10 annotated thread samples to unblock this.
- **Feedback act-on at steady state.** FeedbackEvents are recorded + counted. `maybeCreateDomainExclusionRule` auto-creates DOMAIN rules after 3+ EMAIL_EXCLUDE events (partial act-on). `applyCalibration` reads EMAIL_MOVE / CASE_MERGE / THUMBS_UP/DOWN for Claude-driven param tuning. BUT: corrections do NOT auto-adjust scores mid-sync. **Q16 in the interview unblocks this.**

#### Specific-question answers

1. **I/O leaks in `@denim/engine`?** CLEAN. No Prisma, no fetch, no env, no `Date.now()`, no console. Package boundary enforced.
2. **Gravity model state?** SINGLE, deterministic. No competing variants.
3. **Working case synthesis?** YES. Claude-driven, Zod-parsed, produces title/summary/actions/urgency/mood/emoji. Quality unmeasured (no fixture eval).
4. **FeedbackEvent wired into next sync?** PARTIALLY. Two consumers (auto-EXCLUSION at 3+ events, calibration tuning). No mid-sync weight adjustment. Q16 blocks further work.
5. **Tests validating clustering vs. real inbox?** NO. Synthetic data only.

---

### 15.3 Platform + security + UI inventory (full report)

#### 🚨 CRITICAL SECURITY FLAG (top of report)

**RLS status unknown.** `apps/web/prisma/schema.prisma` contains NO `@@ignore` comments, NO RLS annotations, NO evidence RLS is enabled. No RLS migration SQL files in the repo. CLAUDE.md mandates RLS on every table. Code is only *logically* scoped by `userId` / `schemaId` in queries — DB enforcement is unverified. **Action: verify in Supabase dashboard immediately. If missing, P0 before any paying user.**

#### KEEP

- `apps/web/src/lib/gmail/tokens.ts` (1–38) — AES-256-GCM encrypt/decrypt with IV + auth tag. Proper key management.
- `apps/web/src/lib/gmail/credentials/storage.ts` (64–210) — Token lifecycle: encrypt-before-write, optimistic-locked refresh, tombstone on `invalid_grant`. Zod-validated parse.
- `apps/web/src/lib/gmail/shared/scopes.ts` (line 10) — Hard-coded `gmail.readonly`. No `send`, no `compose`.
- `apps/web/src/lib/middleware/error-handler.ts` — Sanitized response to user, full context logged server-side.
- `apps/web/src/lib/logger.ts` — Structured JSON logs with timestamp/level/service/schemaId/userId/operation. Explicitly skips tokens + PII.
- `apps/web/src/lib/validation/interview.ts` — Zod input validation via `validateInput` helper.
- `apps/web/src/app/api/onboarding/start/route.ts` — Transactional outbox, no TOCTOU race.
- `apps/web/src/app/api/feed/route.ts` — Scoped to `userId` then `schemaId`.
- `apps/web/src/lib/inngest/cron.ts` — `cronDailyScans` event-driven (ready to swap to scheduled). Filters ACTIVE schemas, stale >23h, concurrency 1.
- `apps/web/.env.example` — Lists `TOKEN_ENCRYPTION_KEY`. No secrets in code.
- `packages/types/errors.ts` — Typed errors used throughout; no raw string errors.

#### REVISE

- `apps/web/src/lib/gmail/client.ts` — Metadata-only headers defined, but full file not verified end-to-end. **Action: grep for `format: "full"` in `lib/gmail/`.**
- `apps/web/src/lib/middleware/auth.ts` — Not examined. Verify no bypass paths.
- `apps/web/src/lib/gmail/credentials/service.ts` — Not examined. Verify 401→revoked triggers user-facing re-auth.
- `apps/web/prisma/schema.prisma` — Structure sound (Cascade deletes). Missing: RLS annotations + comment documenting the token-encryption story.

#### DELETE

- Potential: `apps/web/src/lib/gmail/dev-bypass.ts` (if it exists in production paths). Verify it's gated behind `BYPASS_AUTH` env + dev-only.

#### MISSING

- **RLS policies version-controlled.** See flag above.
- **Email body / attachment storage audit.** No `Email.body` field in schema (good). Need grep for `body`, `raw`, `mimeMessage` in services + extraction to confirm no full-email retention anywhere.
- **Rate-limit avoidance verification.** Inngest concurrency keys + 50-message batches look right, not load-tested.
- **Zod on every AI response.** Parsers exist; need to verify every Claude/Gemini call goes through one.
- **CASA Tier 2 roadmap doc.**
- **On-login sync auto-trigger.** Claimed in master plan; not found in code.

#### CASA Tier 2 readiness

**Traffic light: YELLOW — ready to begin, not ready to certify.** OAuth encryption production-grade. Logs sanitized. `gmail.readonly` locked. Zod on inputs. Scoping by `userId` consistent in spot-checked routes. **But:** RLS policies not in version control (must verify in Supabase); email body/attachment audit not done; no load test; no CASA2 roadmap doc. Before certification: (1) commit RLS to migrations, (2) audit extraction storage, (3) load-test rate limits, (4) engage Google Security Assessment.

#### Specific-question answers

1. **TOKEN_ENCRYPTION_KEY used before DB write?** YES — `lib/gmail/credentials/storage.ts:64-66`, `lib/gmail/tokens.ts:13-24`.
2. **RLS on every model?** UNKNOWN — critical gap. Verify in Supabase.
3. **Logs include userId/schemaId? Rogue console.log?** YES to context. No rogue console — only intentional output wrapper + test fixture.
4. **Gmail client metadata-only?** LIKELY YES — `METADATA_HEADERS` defined, batch fetches look right. Verify no `format: "full"` lurking.
5. **What UI screens exist?**
   - **Onboarding:** Interview → domain confirm → entity confirm → review → finalize. Polished, production layout. (But NOTE: per Onboarding inventory, Stage 1/2 review UI is missing — the "domain confirm" / "entity confirm" screens don't actually show discovered candidates yet.)
   - **Feed / cases:** Case feed with urgency sort, detail with emails + actions. Layout production-ready; clustering *quality* is the open work.
   - **Settings / topic edit:** `/authenticated/settings/topics` exists, parked for Phase 4.
   - **Design system page:** `/app/design-system/page.tsx` exists.
6. **Daily cron sync?** YES — `lib/inngest/cron.ts cronDailyScans`. Currently event-triggered (not scheduled). Ready to swap to `cron: "TZ=UTC 0 6 * * *"`.

---

### 15.4 Consolidated open questions (roll up of the three reports' sub-questions)

Beyond Round 3 Q13–Q18 in §14, the inventories surfaced:

1. **RLS verified in Supabase?** (P0 gate)
2. **Email body/attachment storage audited?** (CASA gate)
3. **Stage 2 regex vs. Gemini — honor spec or amend spec?**
4. **Agency placeholder quick-fix before next test run?**
5. **Good-case fixtures — can Nick provide 5–10 annotated threads?**
6. **Refactor OK for frequency analysis in `cluster.ts:1287-1350`?**
7. **Synthesis cost — acceptable, or want a deterministic-title fallback?**
8. **Daily cron actually scheduled yet, or still event-only?**
9. **Clustering quality bugs #120–123 — landed on main, or still on `feature/perf-quality-sprint`?**

---

## 16. Next actions

1. [ ] Nick answers Q14, Q16, Q18 + two clarifications (SLA strictness, review-screen cadence)
2. [ ] Subagents return inventory (in progress)
3. [ ] Claude drafts the final `ZEFRESH_DENIM/denim-master-plan.md` (replaces the current kernel)
4. [ ] Nick reviews + edits the draft
5. [ ] Master plan is committed + referenced from CLAUDE.md as canonical
6. [ ] Disorganized work styles get replaced by: every new PR opens with "which section of the master plan does this serve?"
