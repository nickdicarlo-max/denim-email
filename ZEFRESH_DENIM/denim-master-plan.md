# Denim Master Plan

**Status:** Canonical. Every PR, agent task, and design decision is measured against this document.
**Owner:** Nick DiCarlo
**Last major revision:** 2026-04-22 (replaces the pre-interview kernel)
**Companion docs:**
- `CLAUDE.md` — project primer (read first, every session)
- `docs/00_denim_current_status.md` — what's shipped / in-flight / deferred
- `docs/01_denim_lessons_learned.md` — 12 preventive patterns from shipped bugs
- `docs/domain-input-shapes/{property,school_parent,agency}.md` — locked domain specs
- `ZEFRESH_DENIM/eval-good-case-bad-case.md` — case-quality criteria
- `ZEFRESH_DENIM/eval-goodonboarding-badonboarding.md` — onboarding-quality criteria
- `ZEFRESH_DENIM/master-plan-interview-notes.md` — interview rationale + codebase inventory

---

## 1. Mission

Denim transforms unstructured email into organized, glanceable cases. Users give small hints; the system does the work. **Brand promise: simple, easy, quiet.** We reduce cognitive load — we do not add to notification hell, we do not act on the user's behalf, we do not optimize for engagement. We give users the information they need to make fast decisions, then get out of the way.

Commercial-grade SaaS from day one. CASA Tier 2 security target. 10,000–100,000 monthly subscribers as the long-horizon destination.

---

## 2. Target user

**ICP (Ideal Customer Profile):** Affluent professional who is also a parent, using Gmail or Google Workspace. Starts by organizing kids' activities and school email; expands organically into investments, home renovations, small projects run out of personal Gmail. Cares about outcome, not technology — does not want to hear about "AI," wants life organized with minimum effort, willing to pay to quiet the noise.

The developer of this project represents our ICP, and he has provided us a sample of emails in the folder 'denim_samples_indvidual' so we can do data analysis on the inbox to gather insight.  This inbox is just one user, other users email patterns could differ, but we can stress test ideas here.

**Scope for the first 12 months:**
- **Provider:** Gmail / Google Workspace only. Outlook is a post-10K-customer feature.
- **Geography:** United States only.
- **Topics per user:** 1 to start, 3–5 sweet spot, 3–10 for power users.
- **Platform:** Mobile-primary responsive web. Desktop secondary. **No native mobile app.**
- **Language:** English. Common Dialects of Spanishi spoken in the USA

Generalization to other personas (prosumers, small-business owners, general consumers) is a post-10K decision, not a day-one bet.

---

## 3. Success metrics

| Horizon | Metric | Target |
|---|---|---|
| 3–6 months | Paying subscribers | 100 – 1,000 |
| 3–6 months | Weekly active rate | ≥75% (below this = churn risk) |
| 3–6 months | Topic adoption (median) | 3–5 per paying user |
| 12 months | Gross margin after AI + infra | 30–70% |
| Ongoing | Onboarding completion rate | Cases waiting on first login; tune until this is >90% |
| Ongoing | Glance session duration | ~8 seconds per check-in |

**Unit-economics thesis:** During onboarding we can lean on AI to make smart judgements about the users email corpus using AI (Claude + Gemini) so we can make determinations that allow for Steady-state organization to be cheap because the gravity model is deterministic and Gemini synthesis is inexpensive.  Despite heavy use of AI during onboarding, helping the user discover value by seeing their own topics start to get organized very fast is critical. Each state handoff needs to be fast and clear and performant. **Margin improves the longer a subscriber stays.** Every architectural decision is evaluated against this bet.

---

## 4. Pricing

- SaaS, month-to-month, paid-only, no contract terms.
- Free trial: 7 or 30 days, tuned to measured onboarding AI cost.
- Target list price: **$5–$10/month**; absolute ceiling $15/month.
- **Instant unsubscribe. One-click account delete (including backups).** These are brand promises, not nice-to-haves.

---

## 5. MVP scope

### In scope for v1
- Gmail / Google Workspace OAuth (`gmail.readonly` scope only)
- Unlimited topics per user
- 3-stage onboarding per domain spec (<5s Stage 1, <6s Stage 2, <5min Stage 3 background)
- Locked schemas: `property`, `school_parent`, `agency`
- Next-up schemas in Phase 1: `construction`, `legal`, `general`
- Daily cron sync at 6am user-local + on-login auto-trigger
- Mobile-primary responsive web
- CASA Tier 2 authorization complete before public launch
- Per-topic per-user authoritative feedback rules (see §9)
- One-click account + data delete

### Out of scope (post-10K users or later)
- Email sending, reply drafting, any write to Gmail (likely never)
- Outlook / Microsoft 365 - TAM expansion
- Native mobile app - depends on user needs
- Team / shared inboxes - very low priority
- Full-text email search - nice to have
- AI chat / RAG over inbox - nice to have
- Write-to-calendar (considered v2), write-to-do-list, cross-device actions ("text spouse")
- Portal-bounce detection as a case type (deferred)
- Aggressive noise-exclusion filter as a distinct paid tier (deferred)

These are not "never." They are "not until the core loop is proven and paying."

---

## 6. Performance SLAs

| Stage | Wall-clock budget | Classification |
|---|---|---|
| Stage 1 — domain confirmation | **<5 seconds** | Commitment |
| Stage 2 — entity confirmation - entities are the topics inside of a schema and the peope associated with them | **<6 seconds** | Commitment |
| Stage 3 — deep scan (background) | **<5 minutes** | Commitment |
| First-topic end-to-end perceived time | **~2 min ideal, ≤5 min acceptable** | Target |
| Subsequent topic onboarding | **Background only — user never waits** | Commitment |
| Daily sync delivery | Cases ready by 6am user-local OR by the time the user next logs in | Commitment |
| Case card comprehension | <2 seconds to understand what it is | UX target |

**Definition of "commitment":** a breach produces a structured log with full context and a tracked alert. Two breaches of the same SLA in a rolling week promote it to a P0 incident.

**Rate-limit stance:** Gmail rate limits are **designed around**, not handled at runtime. If a design causes us to approach rate limits, redesign.  Exponential back off as part of a retry loop is OK, but design should consider rate limits.  Also consider Gemini and Claude API rate limits in the design.  Consider multiple user scenarios in scalability and rate limits.

Other Scalabilty notes in `docs/architecture/scalability.md`.
Other engineering and rate limite notes in `docs/architecture/engineering-practices.md`.

---

## 7. Architecture principles

**From `docs/domain-input-shapes/` (cross-domain preamble):**
1. **Asymmetric axes.** PRIMARY = WHATs (things managed). SECONDARY = WHOs (email-addressable interactors). WHO signal is cheap; WHAT signal is expensive.
2. **Time-durability.** A TOPIC PRIMARY exists without a date. A CASE is always date/event-tied. Test: *"Can this exist without a date attached?"*
3. **SECONDARY = email addresses, not names.** Routing uses `From:`/`To:`/`Cc:` only. A name in a body or signature is not a routing signal.
4. **Compounding-context inclusion.** No single signal confirms membership. Multiple signals must align.
5. **Validation feedback loop.** Seeded-WHO → discovered-PRIMARY → expanded-WHO. This loop is why Stages 1/2/3 exist as separate stages.
6. **Speed constraint on WHO discovery.** <10s via metadata + parallel + regex/string-math. No AI in the hot path.
7. **Grouping Signals & Compound Signals** user enters soccer + ziad allan using the grouping functionality. We discover that all emails from Ziad Allan come from noreply@teamsnap.com, we can then associate soccer = ziad allan = teamsnap.com domain. Consider compound signals to raise confidence of inclusion or exclusion.

**From `CLAUDE.md`:**

7. **Zero I/O in packages.** `@denim/engine` and `@denim/ai` are pure. Services layer owns all I/O.
8. **Metadata-first.** Rich metadata on the initial fetch; rarely re-fetch from Gmail.
9. **Feedback as first-class data.** Every correction is an event with downstream consequences.
10. **Interview-generated configuration.** No domain-specific `if/else` inside services.
11. **Defense in depth.** RLS + Zod + encrypted tokens + scoped queries + typed errors.
12. **Pairing principle.** Entity rules ship paired with UI copy. Mismatched copy silently undoes the rules.
13. **Proose Code Efficiency** When individual code files get too long (>600 lines), propose architectural shifts for maintainabilityy and context window protection.

**From `docs/01_denim_lessons_learned.md`:**

13. **Single-writer CAS ownership.** Each `from → to` transition has exactly one owner function. Direct `updateMany` on a CAS-owned column is banned. "Rewind" is never a valid reason — create a new row with ABANDONED/ARCHIVED status instead.
14. **Idempotent Inngest steps.** Any DB write inside `step.run` uses `upsert` with a composite unique constraint, not `create`.
15. **Server/client module boundary.** Values shared between server and client live in `shared/` directories with no `"use client"` directive. Biome's `noRestrictedImports` enforces this.
16. **Duck-typed error classification.** Every `@denim/*` error class ships an `isThing(value)` / `extractThing(err)` helper. Cross-module catch blocks use the helper, never `instanceof`.
17. **External-boundary Zod parsing.** Every response from Supabase, Google OAuth, Gmail, Claude, Gemini is Zod-parsed on entry.
18. **Fail closed in auth paths.** Every catch in an auth-adjacent try block ends in an error redirect with a typed reason code. `warn` + continue in an auth path is banned.

These 18 principles are the checklist a PR is reviewed against. See `docs/01_denim_lessons_learned.md §Patterns to watch for` for the 12 concrete grep checks.

---

## 8. Security & privacy

**Security is paramount throughout development. It is not a phase.**

### User-facing promise (plain English)
- We never train AI on your data.
- The system is designed to only pay attention to the emails you want us to organize and ignore the emails you don't want us to organize.
- We store email metadata and AI-generated summaries to build your cases. We will also use OCR on attachments to help build cases, provide information useful to you.  We endeavor to store the least amount of data to provide you the service you are paying for, and nothing more.
- No ads or ad targeting using your data.
- Your OAuth tokens are encrypted at rest.
- Gmail access is **read-only**. We will never send on your behalf.
- One-click account delete: everything, including backups, goes.
- Month-to-month, instant unsubscribe, no contract terms.

### Engineering non-negotiables
- OAuth tokens encrypted at rest via `TOKEN_ENCRYPTION_KEY` (AES-256-GCM). Never logged.
- Gmail scope: `gmail.readonly` only at launch. No `send`, no `compose`, no `modify`. Calendar write is a v2 consideration only.
- Supabase RLS on every table. Policies version-controlled in Prisma migrations. Every query scoped by `userId` via `schemaId`.
- Zod validation on every API route input and every AI response.
- Service role key server-only.
- Structured JSON logs include `{timestamp, level, service, schemaId, userId, operation, duration}`. Token values, email bodies, and PII never logged.
- No `console.log` in production paths.

### CASA Tier 2 — launch-gating
Google will not let us launch without CASA Tier 2 certification. Budget 6–12 weeks and $15K–$75K for the assessment. Every feature's acceptance criteria include a security review at PR time, not at audit time.

---

## 9. Feedback loop — user corrections are authoritative

The feedback loop is not a soft signal. **The user's correction is an absolute command to the system.**

| User action | System response on next sync |
|---|---|
| *"This email doesn't belong in this case"* (no target) | Email is **excluded** from clustering for this topic. Per-user, per-topic exclusion rule persisted. Future emails matching the same routing signature are evaluated against the rule. |
| *"This email belongs in case X"* (explicit target) | Positive routing rule written: future emails matching the same routing signature route to case X. Deterministic, immediate, overrides gravity-model scoring. |

**Design invariants:**
- Rules are **per-schema** (per-topic), **per-user**, **deterministic**, effective on the next sync.
- Rules are stored rows, not model weights. Auditable, explainable to the user, and cheap to compute.
- The gravity model is informed by the rules but never overrides them.
- **Routing signature for MVP:** sender address (for individuals) or sender domain (for corporate domains) + subject-tag-set. Thread-ID-based rules added if the sender-based version misclassifies in practice. Full spec to land in a dedicated design doc before implementation.

**Current state (2026-04-22):** `FeedbackEvent` is logged and an auto-`EMAIL_EXCLUSION` rule fires after 3+ corrections. That's a down-payment. The MVP gap to close: (a) single-correction authority, (b) positive-routing rules with explicit targets, (c) per-topic rule application on every sync.

---

## 10. Case quality bar

### Good-case definition (from `ZEFRESH_DENIM/eval-good-case-bad-case.md`)
- Topic coherence — all emails in the case are about the same thing.
- Future-oriented — the case is about events that still require action, not history.
- Real action — the case surfaces something the user needs to do, not informational noise.
- Time cadence — large gaps in email arrival usually indicate a different topic.

### Bad-case signals
- Mixed practices, games, and unrelated info in one case.
- Newsletter or marketing contamination.
- Irrelevant senders included because of a keyword match.

### Tolerance & response
- **Moderate tolerance.** A few stray emails in a case is acceptable.
- **Borderline split/merge decisions are acceptable** — different users will have different preferences; the feedback loop tunes to the individual.
- **The feedback loop is the answer to quality variance.** It is not a "nice to have" — it is the structural reason we can ship imperfect first-pass clustering and still deliver on the brand promise.
-- During Onboarding OR during regular day to day use, inclusion of an off topic email is considered a failure signal of the filtering.

---

## 11. Information hierarchy (case card)

When a user glances at a case for 4 seconds, they see — in order:

1. **What it is** — case title, understandable in <2 seconds.
2. **Next action + deadline** — the thing to do, when.
3. **Where + when** — event location and time, with clickable map where applicable.

If a user has to click, tap, or scroll to know what to do about a case, the hierarchy has failed. A rich visual design already exists — use it as the source of truth.  Ask the partner for design files when ready.

---

## 12. Topic constraints

**Locked Phase 1 schemas** (specs in `docs/domain-input-shapes/`):
- `property` — street-addressed / named properties; tenants, vendors, HOAs.
- `school_parent` — schools, activities, coaches, teachers, youth sports and arts.
- `agency` — external client companies for consultants and agencies.

**Next-up Phase 1 schemas:** `construction`, `legal`, `general`.

**Post-Phase-1 candidates** (in priority order from consumer research):
- Healthcare / caregiver-for-family
- Household services (owner-occupier variant of property)
- Travel
- Tax-year management
- Subscriptions / recurring invoices

**Explicitly NOT schemas — filter, do not organize:**
- Retail promotions and e-commerce
- SaaS system alerts
- Newsletters and content bloat

**Topic smell test** (enforced at onboarding):
- Must pass the time-durability test — the PRIMARY exists without a date.
- Must be entity-anchored — "all my work emails" fails; "Anthropic client work" passes.
- Single-sender "topics" are not topics — this is life admin, not relationship management.

---

## 13. Failure behavior

**Universal rule: errors are loud to developers, quiet to users.**

| Failure | Developer sees | User sees |
|---|---|---|
| Any | Structured log with full context (`schemaId`, `userId`, `operation`, stack) | Correct result after silent retry/degrade, OR plain-English action-oriented message |
| AI extraction miss on 1–2 emails | Logged at `info`, continue | Nothing — non-fatal |
| Gmail rate limit | P0 alert, design review | Should never see — we design around this |
| OAuth token expired/revoked | Typed `GmailCredentialError` → UI reconnect prompt | "We need you to reconnect Google" with one-click button |
| Inngest retry exhausted | `inngest/function.failed` → terminal status write | "We're having trouble with that right now — try again later" |
| Any unhandled exception in user-facing path | Typed error response with `reason` code | Plain-English message, never a stack trace or error code |

**Specific failure modes (from interview):**
- 50K-email inbox in 56-day window: topic-at-a-time moderates this; lookback cap reserved as an option.
- Wrong discovered entity: review screens at Stage 1 and Stage 2 are the mitigation. Discovery surfaces things the user didn't mention so the product helps them organize over time.
- New topic 6 months in (kid picks up a new activity): supported as "add to topic" or "new topic"; not a special case.

---

## 14. Development process

Governing principle: **Do the correct thing, not the easy thing.** Be transparent about tradeoffs. No "just for now" shortcuts that become permanent. 

### Agent rules
1. **Understand before acting.** Every non-trivial task begins with the relevant §14C reading. If you cannot articulate the problem in your own words, you are not ready to write code.
2. **No shortcuts that create debt.** If the spec says "zero AI in Stage 2," don't ship Gemini-in-Stage-2 without formal spec amendment. If a CAS helper owns a transition, don't `updateMany` around it. Shortcuts cost the project days of E2E debugging — the lessons-learned log is the receipt.
3. **Transparency is required.** When something is messy, say so. When you make a judgment call not covered by the spec, flag it. When the easy path and the correct path diverge, surface the choice.
4. **Security is foundational.** Every change passes the §8 checklist before it's considered done.
5. **Read `docs/01_denim_lessons_learned.md` before any non-trivial PR.** The "Patterns to watch for" section is mandatory preflight.
6. **Test helpers may not do work the production path doesn't.** Any DB operation run in both test and production lives in a shared function.

### Default posture
- **Propose → approve → execute** for: architectural calls, spec amendments, new AI calls, new dependencies, anything security-touching, anything that rewrites a CAS transition owner.
- **Execute-within-guardrails** for: bounded, spec-aligned, pattern-following code changes inside an approved plan.
- **When in doubt, propose.**

### Definition of done
A task is done when:
1. Code compiles.
2. Typecheck clean.
3. Affected unit and integration tests pass.
4. You can verify the code runs and accomplishes the task while avoiding regression on other functionality already validated
5. Manual verification  by the user completed if the change touches user-facing flow or user data.
5. Commit message or PR body explains the *why*.
6. No new violations of the 18 architecture principles or 12 preventive patterns.

### Mandatory agent reading (§14C)
| Doc | Purpose | When |
|---|---|---|
| `CLAUDE.md` | Stack, structure, non-negotiables | Every session start |
| `docs/00_denim_current_status.md` | Shipped / in-flight / deferred | Before proposing new work |
| `docs/01_denim_lessons_learned.md` | 12 preventive patterns + CAS Ownership Map | Before any PR touching Inngest, auth, CAS, credentials, schemas, or AI orchestration |
| `docs/domain-input-shapes/*.md` | 6 principles + per-domain specs | Before any onboarding, discovery, or entity work |
| `docs/architecture/engineering-practices.md` | Table ownership, idempotency, naming | Before writing any service |
| Active plan under `docs/superpowers/plans/` | Sprint context | If working on an open issue |
| This master plan | Mission, constraints, success criteria | Before any design-scale call |

---

## 15. Governance

- **This document is canonical.** When this document and any other doc conflict, this one wins until explicitly revised. Ask the use when conflicts are uncovered.
- **Revisions are explicit.** Changes to this doc are discussed, reviewed, and dated. No silent edits.
- **Every PR answers:** *"Which section of the master plan does this serve?"* If the answer is "none," the PR needs either a master-plan revision or a rewrite.
- **Every sprint plan under `docs/superpowers/plans/`** cross-references the master-plan sections it implements.

---

## 16. Known gaps and open work

Not aspirational roadmap — a concrete punch-list surfaced by the codebase inventory (2026-04-22). See `ZEFRESH_DENIM/master-plan-interview-notes.md §15` for full detail.

1. **[P0 / CASA] RLS policies are not version-controlled.** Must be committed as Prisma migrations and verified against live Supabase. Blocker for any paying user. Use skills/supabase-db
2. **[Strategic] Stage 2 spec drift.** Commit #129 replaced the locked zero-AI regex+Levenshtein Stage 2 with Gemini subject-pass. Decide: restore spec or formally amend. Both cannot be "locked" simultaneously.
3. ~~**[P0 feature] Stage 1 and Stage 2 review-screen UI is missing.**~~ **Shipped 2026-04-23 (Phase 5 Round 1 + Round 2 7a/7b on `feature/perf-quality-sprint`).** Confirm screen (`phase-entity-confirmation.tsx`) is rebuilt by-WHAT (A2 hierarchy, B1 first-class discoveries, three render states per WHAT — found-anchored / found-unanchored / not-found, truthful frequencies on synthetic candidates). Pipeline wiring landed so the Phase-2/3 confirm flow no longer produces orphan entities: `linkEntityGroups` helper plumbs `EntityGroup` + `Entity.groupId` + `Entity.associatedPrimaryIds`; new `Email.candidatePrimaryIds` column + thread-adjacency helper defer ambiguous-sender routing to cluster time instead of silent drop. All three locked schemas pass the full eval gate end-to-end. See `docs/00_denim_current_status.md` 2026-04-23 entry. Residual work captured as issue #130 (zero-match-hint re-scan cron).
4. **[Feature] Feedback-loop rule application.** Engine-level work to turn the authoritative-corrections model (§9) into stored per-topic rules applied on every sync.
5. **[Quick fix] `agency.whatPlaceholder`** still reads "Acme Corp rebrand" in `domain-config.ts` — should be company names per spec. Known to mislead users.
6. **[CASA prep] Email-body / attachment-storage audit.** Confirm no `format: "full"` paths retain body bytes.
7. **[Latency]** Daily cron currently event-driven; swap to `cron: "TZ=UTC 0 6 * * *"` before GA. On-login auto-trigger not yet in code.
8. **[Quality]** ~~No real-inbox fixtures for clustering regression testing.~~ **Partially addressed.** The 417-email `denim_samples_individual/` fixture corpus + `apps/web/scripts/eval-onboarding.ts` harness now drive the full three-schema end-to-end regression (Stage 1 + Stage 2 + synthesis through the production code path, with content-hash AI cache). All three locked schemas currently PASS on fixture data (2026-04-23). Still to do: (a) live Gmail re-run with `--refresh-cache` to validate outside the fixture, (b) 5–10 annotated multi-thread cases for clustering-specific assertions (case-merge vs case-split regressions), (c) visual review of the confirm screens against fixture state.
9. **[Clustering bugs #120–123]** Tag-score investigation in progress on `feature/perf-quality-sprint`.
10. **[Feature — captured, not built] Zero-match-hint re-scan cron.** Issue #130. The confirm screen's "⚠ Not found in the last 8 weeks. We'll keep watching." copy (shipped 2026-04-23) is aspirational until a daily cron re-runs discovery for `stage1UserThings` rows with `matchCount === 0`. Design is in the issue; untested against fixtures (cron's 0→N transition can't be meaningfully e2e-tested against the static `FixtureGmailClient` corpus — unit tests plus live Gmail validation are the intended gate).

---

## 17. What this document is not

- It is not a roadmap. Roadmaps belong in `docs/00_denim_current_status.md` and active sprint plans.
- It is not a design doc. We have a DESIGN.MD. Specific feature designs belong in `ZEFRESH_DENIM/plans/`.
- It is not a list of todos. Todos belong in GitHub Issues.
- It is the **constitution** — the constraints and principles that every design, roadmap, and todo is evaluated against.
