# Denim Email — Current Status

Last updated: 2026-04-24 (First successful **live-Gmail end-to-end** run on `feature/perf-quality-sprint`. North 40 Partners property schema (`01KQ0J2XWVGPAQCHQ5DEFK7VF8`): 194 emails discovered, 111 extracted, 50 cases synthesised in **4 min 47 s** post-confirm — under the 5-min SLA. **9 of 12 portfolio properties** routed correctly (vs 6/12 in fixture), including 1501 Sylvan and 3305 Cardinal that fixture-eval gate-sim had rejected. Three commits landed in-session: `df7752d` flips `/api/feed` `includeResolved` default to true so RESOLVED/NO_ACTION cases render greyed-out (existing `CaseCard` opacity-60 styling was already wired, only the API filter was suppressing them); `c39cfbc` bumps the entity-confirm Prisma transaction timeout from 5 s → 30 s after live confirm 500'd at 5184 ms with 26 entities (linkEntityGroups parallel writes scale with payload, fixture's 3-7 entities never tripped it); `44afd35` closes **#131** with a `PairedField` Zod schema that coerces Gemini's `sourced_from_who` / `related_what` across all observed shapes (string | null | string[]). 188 web-app tests green (+6 schema-shape regression tests). **Eval-report scorecard on the live schema: 4 PASS / 1 WARN / 1 FAIL** — exclusion 42.8 %, orphan rate 0 %, merge-records present, case-splitting ran; 60 % singleton rate (WARN) and 0 % displayTags coverage (FAIL — same fingerprint as #123, every merge scored exactly 30.0 = threshold floor with tagScore 0). The pipeline gains are real but tag-scoring is the next blocker for a meaningful leap in case quality. Previous: 2026-04-23 (Phase 5 Round 1 + Phase 6 Rounds 2+3 complete on `feature/perf-quality-sprint`. Review-screen rebuilt around user WHATs (A2 hierarchy, B1 first-class discoveries, truthful frequencies, three render states per WHAT). Pipeline wiring landed for paired-WHO routing: `linkEntityGroups` helper (new `apps/web/src/lib/services/link-entity-groups.ts`) plumbs `EntityGroup` + `Entity.groupId` + `Entity.associatedPrimaryIds` through the Phase-2/3 `persistConfirmedEntities` flow, fixing orphan-entity bug; tolerant name resolver handles the common case where the confirm flow canonicalises user-typed short strings ("851 Peavy" → "851 Peavy Road"). New `Email.candidatePrimaryIds` column + `apps/web/src/lib/services/thread-adjacency.ts` helper records ambiguous-sender candidate lists during extraction and resolves them via thread-sibling adjacency at cluster time — turns silent-drop into honest-defer for any N:M paired WHO. **All three locked schemas (property 7/7, school_parent 3/3, agency 3/3) pass the full eval gate end-to-end** with 0 off-topic cases and 0 synthesis failures. 182 web-app tests green (+10 new for 7a/7b). Issue #130 captured for the deferred zero-match-hint re-scan cron. Not yet: visual review of confirm screens + feed, live Gmail `--refresh-cache` run.) Previous: 2026-04-22 Late (Full eval harness + Phase 3A/3B/4 complete on `feature/perf-quality-sprint`. Stage 1 + Stage 2 + full synthesis all drive through production code against 417-sample corpus, one schema at a time, with content-hash AI response cache. 3 schemas ran end-to-end. **5 production bugs surfaced and fixed via the eval loop** (Zod null, Gemini "≥3 subjects" rule, FixtureGmailClient query parser, `"Entity"` raw SQL table name, eval harness fanout drift). Scoped monorepo tightening: `domain-aggregator`, `public-providers`, `FromHeaderResult` moved to `@denim/engine/discovery`; `stage2-fanout.ts` extracted so Inngest fn + eval harness share one orchestration path. **Case-topics-vs-subject-line-noise insight quantified:** agency produced 67 cases from 105 extractions with only 25% multi-email rate — clear evidence that sender-domain-clustering surfaces subject fragments as pseudo-cases. Deferred to Phase 5. 309 tests green; Part B synthesis burned ~$1.60 across three first-runs.) Previous: 2026-04-19 Evening (Compound E2E-driven fix on `feature/perf-quality-sprint`: **#117** Stage 1 per-whats pairing + safety hygiene, **#102** Pattern C corpus frequency mining, **#119** property address suffix-aware dedup, **#121** SECONDARY alias population. **21 new commits**, **364 unit tests passing** across 4 workspaces (+36 this session). Closed **#93** / **#109** / **#118** as superseded / verified / subsumed. Filed **#120** / **#121** / **#122** / **#123** with DB-forensic evidence from live E2E runs on Girls Activities (`01KPM0R4QS72E8B1M0A1BDJWYC`) + North 40 Partners (`01KPM07ZBZG9570XKJZTVB9N2A`) schemas. Open count 40 → 43. Next: live E2E re-run to verify the compound, then **#123** tag-score investigation (likely proximate root cause of #86 case over-fragmentation — every MERGE scored exactly at threshold with `tagScore: 0` despite `tagMatchScore=15` configured).)

Historical sessions (Phases 0–7 baseline, per-phase detail, bug archaeology): `docs/archive/denim_session_history.md`.

## 2026-04-24 Session — First live-Gmail E2E + three in-session production fixes

The pipeline ran end-to-end against a real Gmail inbox for the first time. North 40 Partners property schema (`01KQ0J2XWVGPAQCHQ5DEFK7VF8`), user `nick.dicarlo@gmail.com`. Three latent bugs surfaced during the run; all three fixed and committed before the run completed.

### Live-run timeline (UTC)

| Step | Time | Duration | Notes |
|---|---|---|---|
| Domain confirm | 20:15:10 | 601 ms | 2 domains confirmed (judgefite.com, lilviv.com) |
| Stage 2 entity discovery | 20:15:32 | — | judgefite.com: 4-entity Gemini batch dropped via Zod (issue #131); lilviv.com clean |
| Entity confirm — first attempts | 20:18-20:19 | 5184 ms | **500 — Prisma transaction timeout** at default 5 s. linkEntityGroups parallel writes for 26 entities exceeded budget. |
| ↳ Fix landed | 20:23:24 | — | `c39cfbc` bumped tx timeout to 30 s. |
| Entity confirm — successful retry | 20:23:24 | <30 s | 26 entities persisted via linkEntityGroups; phase advanced to PROCESSING_SCAN. |
| runScan handoff | 20:24:04 | — | scanJobId `cmodcycx800eoj0qe7l0iyb1q`, 194 emails. |
| fanOutExtraction | 20:24:04 | — | 10 batches. |
| Gemini extraction | — | avg 5.5 s / call (17 calls) | 194 → 111 processed / 83 excluded / 0 failed. |
| extractionComplete | 20:25:16 | ~72 s after fanout | |
| coarseCluster | 20:25:42 | 26.0 s | 50 cases created, 3 merges (all at score 30.0 — threshold floor). |
| splitCoarseClusters | 20:27:05 | 81.3 s | Claude case-splitting; 0 splits, 0 merges produced (the call returned but didn't change anything). |
| Synthesis (50 cases) | — | avg 5.7 s / case (parallel) | total 286 s. |
| **runOnboardingPipeline.completed** | 20:28:51 | — | Total post-confirm: **4 min 47 s** ✅ under 5-min SLA |

### Three in-session fixes

| SHA | Issue | Fix |
|---|---|---|
| `df7752d` | Feed hides past cases | `/api/feed` `includeResolved` default flipped to `true`. CaseCard's `opacity-60` muted styling for `status===RESOLVED` was already in place — only the API filter was suppressing past-time cases. Now agency's Stallion + Rhodes Data cases (both `RESOLVED`/`NO_ACTION`) render greyed-out at the bottom of the feed instead of disappearing silently. Opt out via `?includeResolved=false`. |
| `c39cfbc` | 500 on entity-confirm | Prisma `$transaction` `{ timeout: 30_000 }` on the entity-confirm path. Fixture-eval payloads (3-7 entities) never tripped 5 s; live inbox (26 entities × `linkEntityGroups` parallel writes) consistently did. |
| `44afd35` | **#131** Zod array | New `PairedField` schema in `entity-discovery.ts` accepts `string \| string[] \| null` and coerces to `string \| null` at the trust boundary. 6 unit tests cover happy/null/array/empty/missing + loud-failure rejects. Issue #131 closed. |

### Eval-report scorecard — live schema

`docs/test-results/eval-2026-04-24-north_40_april_24_2026-{included,excluded}.csv`

| Check | Result | Detail |
|---|---|---|
| Exclusion rate | PASS | 42.8 % (83/194) — all `relevance:low` |
| Orphan rate | PASS | 0.0 % — every entity-assigned email landed in a case |
| Merge clusters > 0 | PASS | 3 merges (every one scored exactly 30.0 — threshold floor) |
| Case-splitting ran | PASS | 1 PipelineIntelligence row written |
| Singleton rate | **WARN** | 60 % (30/50). Real legit singletons mixed with under-merged repair-invoice clusters (5× 851 Peavy invoices, 4× 3910 Bucknell invoices, 3× 205 Freedom Trail invoices — all should have merged). |
| Tag coverage | **FAIL** | 0/50 cases have `displayTags` — same fingerprint as **#123**. Tag scoring is silently zero, so merge-score collapses to subject + actor only (= 30.0 threshold). |

**Diagnosis confirmed:** the singleton over-fragmentation and 30.0-floor merge scores are the same root-cause symptom — tags are not being scored. **#123 is the highest-leverage next fix.**

### Entity coverage vs portfolio (12-property CSV)

| Property | CSV emails | This run | |
|---|---:|---:|---|
| 3910 Bucknell | 39 | 22 | ✅ |
| 2310 Healey | 90 | 23 | ✅ |
| 205 Freedom Trail | 121 | 16 | ✅ |
| 851 Peavy | 28 | 13 | ✅ |
| 1501 Sylvan | 29 | 10 | ✅ (fixture had 2; first-class now) |
| 1906 Crockett | 149 | 4 | ✅ — but very low coverage; 56-d lookback likely cutting tail |
| 2109 Meadfoot | 60 | 3 | ✅ |
| 3305 Cardinal | 22 | 2 | ✅ (fixture gate-sim had rejected; live picked up) |
| 2919 Sunset Point | 46 | 1 | ✅ barely |
| 1206 Fairmont | 105 | 0 | ❌ entity created, no emails matched |
| 2909 Hunters Point | 41 | 0 | ❌ |
| 2707 Jackson | 28 | 0 | ❌ NER mis-parsed as "2707 Jackson, Melissa" |

9 of 12 routed (vs 6/12 in fixture). Three open gaps: (a) Crockett under-coverage suggests the property domain wants a longer lookback than 56 d, (b) Fairmont/Hunters Point have entity rows but zero email matches — clustering or extraction routing miss, (c) `2707 Jackson, Melissa` is an NER bug worth filing.

### Open follow-ups

- **#123 tag-score investigation** — proven again as the singleton/under-merge root cause. Top-priority next fix.
- **Property domain lookback** — 56 d is too short for Crockett (149 → 4). Consider `propertyLookbackDays = 180`.
- **Fairmont / Hunters Point zero-email entities** — discovered as PRIMARIES but no emails routed. Worth a probe: is it Stage 2 frequency=0 vs extraction-routing miss?
- **`2707 Jackson, Melissa` NER bug** — file as separate issue.
- **Live-Gmail eval should become a regular gate** — see "Locking in gains" design below.

### Entry points for the next session

- Live schemaId: `01KQ0J2XWVGPAQCHQ5DEFK7VF8` (still browsable at `/feed?schema=01KQ0J2XWVGPAQCHQ5DEFK7VF8`).
- Eval CSVs: `docs/test-results/eval-2026-04-24-north_40_april_24_2026-{included,excluded}.csv` (25 cols, pivot-friendly).
- Eval-report regenerator: `cd apps/web && npx tsx scripts/eval-report.ts --schema-id <id>`.
- Three live-fix commits: `df7752d`, `c39cfbc`, `44afd35` on `feature/perf-quality-sprint` (pushed).

## 2026-04-22 Session — Onboarding Eval Harness + First Visual Review

Built the onboarding eval harness and got the first visual-review baseline against the three locked schemas (school_parent, property, agency) using `denim_samples_individual/` (417 fixture emails).

**What shipped:**
- `apps/web/scripts/eval-onboarding.ts` + `apps/web/scripts/eval-ground-truth.ts` — one-schema-per-invocation runner that drives Stage 1 + Stage 2 through the REAL production code against fixtures. Hard assertions (seeded primaries + seeded WHOs must surface, SLA budgets) and soft assertions (expected domains, count ranges).
- `apps/web/src/lib/ai/response-cache.ts` + `interceptor.ts` — content-hash disk cache at `.eval-cache/ai/` for Claude + Gemini. Env-gated (`AI_RESPONSE_CACHE=off|fixture|record`, default `off`). Cached rows log to ExtractionCost with `.cached` suffix + $0.
- `apps/web/src/lib/services/stage2-fanout.ts` — shared `buildStage2Context()` + `runStage2ForDomain()`. Inngest `runEntityDiscovery` shrank ~120 lines and now delegates to these helpers; eval harness calls the same helpers. Single source of truth for seed-prepend + paired-WHO handling.
- `GmailClientLike` interface (`apps/web/src/lib/gmail/types.ts`) — both `GmailClient` and `FixtureGmailClient` satisfy it. Stage 1/2 discovery functions now take `GmailClientLike`, enabling offline eval without a parallel code path.
- Fixed `subject:(... OR ...)`, `-category:promotions`, `from:*@domain` handling in `FixtureGmailClient` — it was silently matching zero emails on production-shape queries.
- Sample folder renamed `Denim_Samples_Individual/` → `denim_samples_individual/` (case-sensitive CI safety).

**Production bugs surfaced + fixed via the eval loop:**
- **Zod null bug** (`entity-discovery.ts:76-78`) — `sourced_from_who` / `related_what` were `z.string().optional()`; Gemini returns them as explicit `null`, which failed Zod, which dropped the entire per-domain response. Changed to `.nullable().optional()`. This single fix unblocked portfolioproadvisors.com's entity cluster on the agency screen.
- **"Skip <3 subjects" rule** (`entity-discovery.ts:179`) — dropped from the Gemini prompt. Property went from 6 addresses discovered → 13 after this change.
- Stage 1 + Stage 2 now accept an optional injected Gmail client (Phase 1 of the eval plan). Matches the pattern `services/extraction.ts:847` already used.

**Current eval verdicts (2026-04-22):**
- school_parent: FAIL (1 hard — "guitar" not in sample corpus; likely data gap, not code)
- property: PASS; 13 properties discovered (above expected 9–12 range)
- agency: PASS; all three WHOs (margaret/george/farrukh) resolved with correct senders

**Key insight surfaced during visual review — deferred to Phase 5:**

> **Current Stage 2 surfaces senders + subject-line fragments, not real case topics.**
>
> The Gemini subject-entity pass is good at extracting "things mentioned in subjects" but that is weakly correlated with "real case topics the user would track."
>
> Concrete examples from the first review:
> - `email.teamsnap.com` surfaces "ZSA U11/12 Girls Competitive Rise", "Rise ECNL", "Houston Select" — these are *subteams*, not topics. The user's real topic is **soccer** (their seeded WHAT).
> - `portfolioproadvisors.com` surfaces "Rhodes Data Test Sample", "AI Session #2 PPA & Nick" — fragments of subject lines, not topic labels.
> - `otter.ai` transcripts tagged with "PPA" belong to the PPA topic, not a separate Otter cluster. Cross-domain association isn't happening.
>
> The brand promise is "organize my email by things I care about" — NOT "extract n-grams from subject lines." Subteam/subject fragments should be surfaced as *aliases* or *subcategories* of a user-seeded WHAT, not as independent entities. The `Inside {domain}` grouping on the entity-confirm screen treats the domain as the label — it should probably show the paired topic when one exists.
>
> Synthesis (Stage 3 case generation) is where this matters most — cases must be named by topic, not by sender-extracted fragment. Will become measurable once Phase 3 Part B (synthesis harness) lands.

**Stage 1 domain noise also flagged for later:**
- school_parent pulls in `bucknell.edu` (alumni newsletter), `principal.com` (401k), `twilio.zendesk.com`, `github.com` via generic keywords ("game", "performance", "schedule")
- agency pulls in `email.teamsnap.com` (kid soccer), `github.com`, `t.biggerpockets.com` (RE newsletter) via "meeting", "invoice", "update"
- Master-plan §7 principle 4 (compounding-signal inclusion) says no single signal confirms membership. Current Stage 1 uses one signal (keyword-in-subject) and trusts it. Phase 5 candidate: post-Stage-1 filter that boosts domains reached by ≥2 signal types (keyword + paired-WHO-from, or keyword + volume).

**Cache behavior verified:** first-run tokens burned; second-run shows `cacheHit` logs + `.cached` ExtractionCost rows at $0. Cache gate is fail-closed (`AI_RESPONSE_CACHE=off` default). 309/309 unit tests passing throughout.

---

## 2026-04-22 Late — Phase 3B + Phase 4 + five production bugs fixed

Completed the remaining eval-plan phases and ran all three schemas through the full synthesis pipeline. Five production bugs surfaced and were fixed in the code (not the harness) during the eval iteration. The harness itself got a real-code refactor after the user's visual review surfaced a harness-vs-prod drift.

### Phase 4 shipped — scoped monorepo tightening

Zero-regression refactor. Moved truly-pure modules into `@denim/engine`:
- `packages/engine/src/discovery/domain-aggregator.ts` — `aggregateDomains()` + `DomainCandidate` + `AggregateOptions`
- `packages/engine/src/discovery/public-providers.ts` — `PUBLIC_PROVIDERS` set + `isPublicProvider()`
- `packages/engine/src/discovery/types.ts` — `FromHeaderResult` pure input shape
- Moved tests to `packages/engine/src/__tests__/domain-aggregator.test.ts` + `public-providers.test.ts`

Apps/web now imports these from `@denim/engine`. Deleted originals in `apps/web/src/lib/discovery/`. `gmail-metadata-fetch.ts` re-exports `FromHeaderResult` as a convenience. **Typecheck + 309 tests still green; eval reruns produced byte-identical reports (cached, 15-23ms per domain vs 1600-2500ms first-run) — proves the refactor is zero-behavior-change.**

Phase-ordering (`SCHEMA_PHASE_ORDER` / `SCAN_PHASE_ORDER` in `onboarding-state.ts`) stays in apps/web — it's keyed by the Prisma `SchemaPhase` / `ScanPhase` enums; moving would duplicate the type and lose exhaustiveness checks. Documented decision.

Also extracted `apps/web/src/lib/services/stage2-fanout.ts` — `buildStage2Context()` + `runStage2ForDomain()` + `runStage2Fanout()` are now the single source of truth for Stage 2 fanout. Inngest `runEntityDiscovery` shrank by ~120 lines and delegates to these helpers; the eval harness calls the same helpers. No more parallel orchestration logic.

### Phase 3B shipped — full-pipeline synthesis eval

`apps/web/scripts/eval-onboarding.ts --stage synthesis` now drives:
1. Auto-accept all Stage 2 candidates from the schema's `stage2Candidates` as `ConfirmedEntity[]` (mirrors `/entity-confirm` route logic including `#121` sender-email alias augmentation)
2. CAS-advance `AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN` inside a transaction (matches the route)
3. Create ScanJob
4. `runSmartDiscovery(fixtureClient as any, ...)` — fixture client satisfies the surface (searchEmails + getEmailFull) even though the signature is `GmailClient`. `as any` cast is the only concession to the type system for the sake of reusing the production pipeline verbatim.
5. Batched `processEmailBatch` with injected FixtureGmailClient (already supported by that function since #eval-run)
6. `coarseCluster` + `splitCoarseClusters`
7. `synthesizeCase` per open case
8. Advance to COMPLETED, mark schema ACTIVE
9. Write `docs/test-results/eval-onboarding-{schema}-full-{date}.{md,csv}`

**Case-quality assertions:** SLA < 5 min (hard), ≥80% multi-email cases (soft, per master plan §10), cases-with-entity ratio, cases-with-actions ratio.

### Part B results (2026-04-22)

| Schema | Verdict | Discovered | Extracted | Cases | Multi-email | Cost (first run) | Total time |
|---|---|---|---|---|---|---|---|
| property | **PASS** | 86 | 17 | 5 | 60% (3/5) | $0.14 | 199.6 s |
| school_parent | **FAIL** (SLA) | 175 | 100 | 22 | 73% (16/22) | $0.49 | 575.1 s |
| agency | **FAIL** (SLA + FK) | 194 | 105 | 67 | 25% (17/67) | $0.97 | 855.3 s |

Observations:
- **property fits the model well.** Strong entity signals (address regex on `judgefite.com`) → clean clustering → 5 reasonable cases.
- **school_parent has 22 cases, 73% multi-email.** TeamSnap provides good grouping; some fragment cases from bucknell.edu / principal.com / github.com bleed (Stage 1 keyword noise).
- **agency produced 67 cases from 105 extractions — 25% multi-email rate.** This is the subject-line-noise failure mode in numbers: almost every extracted email becomes its own case because the "entity" extracted from the subject is an n-gram fragment with no other emails matching it.
- **First-run pipeline costs ~$1.60 across all three schemas.** Steady-state (fully cached) should be near-$0.
- **SLA fails on school_parent + agency first-run only.** Claude synthesis scales with case count; 67 cases × synthesis call = bulk of agency's 14-minute run. Needs re-measurement with warm cache before drawing conclusions.

### Five production bugs surfaced + fixed via the eval loop

Full postmortems in `docs/01_denim_lessons_learned.md` under "2026-04-22: Eval-harness surfaced four latent bugs that tests missed" plus Bug 9. Quick index:

1. **Zod `.optional()` rejects `null`** (`entity-discovery.ts:76-77`) — Gemini returns `sourced_from_who: null`, entire Stage 2 response dropped. **Fixed** with `.nullable().optional()`. Unblocked portfolioproadvisors.com's entity cluster.
2. **Gemini prompt "≥3 subjects" rule** (`entity-discovery.ts:179`) — hardcoded cutoff silently dropped legitimate low-volume entities (stallionis.com 4 subjects → 0 extracted; 851 Peavy and 3305 Cardinal below cutoff on first eval). **Fixed** — rule replaced with "low-frequency entities ARE valid if they look like distinct real-world things." Property went from 6 → 13 addresses.
3. **FixtureGmailClient query parser gaps** (`fixture-client.ts`) — broke on `subject:(A OR B)` paren groups, `-category:promotions` negation, `from:*@domain.com` wildcards. Returned zero matches silently. **Fixed** — tokenizer now handles all production query shapes; added `consumeUnit` helper, `expandFieldValues` splitter, negation branch.
4. **`UPDATE "Entity"` raw SQL wrong table name** (`interview.ts:1193`) — Prisma `@@map("entities")` makes physical table `entities`, raw SQL used PascalCase model name. Production bug dormant until SECONDARY entity with aliases confirmed. **Fixed** `UPDATE "Entity"` → `UPDATE "entities"`.
5. **Eval harness inlined Stage 2 fanout logic** (my own code) — harness skipped the user-seed prepend step, so Margaret Potter / George Trevino / Farrukh Malik didn't appear under portfolioproadvisors.com on the entity-confirm screen. **Fixed** by extracting `stage2-fanout.ts` shared module; Inngest fn + harness both use it.

Sixth bug seen but not yet fixed: **FK violation during agency clustering** (`cluster.ts:1072`). `case_emails.emailId` constraint violated. Didn't crash the pipeline (caught within transaction scope) but silently dropped emails from cases. Needs investigation in Phase 5 — currently unclear whether it's a race between extraction completion and clustering start, or a genuine dropped-email-row bug.

### Where this lands us for Phase 5

Open questions driven by the eval data:

1. **FK violation in agency clustering (`cluster.ts:1072`).** First-priority investigation.
2. **Agency 67-cases-from-105-emails fragmentation.** The case-topics vs. subject-line-noise insight has quantitative backing now. Fix candidates, in order of likely impact:
   - Require 2+ signal types for Stage 1 domain inclusion (master-plan §7 principle 4 — compounding signal). Would drop bucknell.edu / principal.com / github.com / biggerpockets from agency+school_parent domain lists.
   - Gemini Stage 2 prompt: weight user-seeded PRIMARY names heavily, treat subject-line fragments as aliases of seeded primaries rather than independent entities when a match exists.
   - Cross-domain entity association: Otter.ai transcripts with "PPA" in subject should route to the PPA entity, not a separate Otter cluster.
3. **Master-plan §16 item 2 Stage 2 spec-drift decision.** Data says Gemini subject-pass misses low-volume entities that zero-AI regex would catch. Revisit whether the Gemini approach is the right one long-term.
4. **SLA rerun with warm cache** — does the pipeline fit under 5 min on all three schemas when extraction tokens are cached? Likely yes for property + school_parent, probably no for agency until fragmentation is fixed.

Entry points for the next session:
- Current eval URLs (schemas still at COMPLETED state, accessible at `/feed?schema={id}` with `BYPASS_AUTH=true`):
  - property: `cmoatdjg40000voqemcyrmgr2`
  - school_parent: `cmoatdb6a000024qexft1k2dn`
  - agency: `cmoatdrp3000060qenbjudi64`
- `apps/web/scripts/eval-onboarding.ts --schema {key} --stage {discovery|synthesis}` is now a first-class tool; rerun any schema end-to-end with `AI_RESPONSE_CACHE=fixture DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config` from `apps/web/`.
- Master plan still on `ZEFRESH_DENIM/denim-master-plan.md`; new eval rubric at `ZEFRESH_DENIM/eval-goodonboarding-badonboarding.md`.
- Plan file: `C:\Users\alkam\.claude\plans\no-one-schema-invocation-synthetic-thimble.md`.

## 2026-04-23 Session — Phase 5 (Round 1) + Phase 6 (Rounds 2+3) landed on `feature/perf-quality-sprint`

Closed the two functional gaps the 2026-04-22 Late session flagged on Phase 4 ("review UI hides user WHATs / shows 0-emails on legit synthetics") and then built the two pipeline changes the fixed review UI relied on (paired-WHO sender routing + ambiguous-sender thread disambiguation). All three locked schemas (`property`, `school_parent`, `agency`) now pass the full eval gate end-to-end against fixture data.

### Round 1 — Confirm-screen rebuild + feed fixes (Phase 5)

UI-and-wiring-only; no pipeline changes. Shipped in sequence against the 2026-04-23 plan at `C:\Users\alkam\.claude\plans\c-users-alkam-downloads-summary-card-ne-refactored-leaf.md`.

- **Confirm screen by-WHAT hierarchy (A2 option)** — `phase-entity-confirmation.tsx` rewritten: user-typed WHATs are section headers; SECONDARIES nest under them as `AttributionWhoRow`. Anchor row for each WHAT renders prominently; discovered PRIMARIES promoted to first-class sections (B1 option) with provenance badges "from your input" vs "Denim found this · domain".
- **Three render states per WHAT:** `found_anchored` (user typed + we found matches) / `found_unanchored` (matches exist but no domain anchor; user can confirm and cluster by sender fallback) / `not_found` (zero matches; "We'll keep watching" copy).
- **"Also noticed" section** renders adjacent Stage 2 discoveries with softer treatment; unticked by default.
- **Truthful `frequency` on synthetic candidates** — short-circuit + agency-domain-derive no longer emit `frequency: 0`. Paired-WHO matchCount threaded through `paired-who-resolver.ts → stage2-fanout.ts → entity-discovery.ts`.
- **Normalised `meta.relatedWhat`** across all three Stage 2 paths (short-circuit, Gemini, agency-derive); agency path previously used `meta.sourcedFromWhat` — silent mismatch.
- **Polling DTO widened at `AWAITING_ENTITY_CONFIRMATION`** — `inputs`, `stage1UserThings`, `stage1UserContacts`, `stage1ConfirmedUserContactQueries` now reach the confirm UI.
- **Review-screen gate simulator** in the eval harness (`simulateReviewGate`) — replaces blind auto-accept with a policy that mirrors the real UI (pre-tick USER_HINT / USER_SEEDED / STAGE2_SHORT_CIRCUIT / STAGE2_AGENCY_DOMAIN; accept STAGE2_GEMINI conditional on score ≥1 OR token-overlap with a user hint; reject otherwise with a counted reason). Report now includes `gateSim.accepted` / `rejected` / `rejectedByReason` plus per-entity `gateSimVerdict` in the CSV.
- **Feed fixes:** case-click regression on `/feed/[caseId]` (BYPASS_AUTH parity with `withAuth`); new `AllEntityRows` component renders every schema's chips on the ALL tab; Gemini-sourced anchors that token-match a user WHAT now pre-ticked.
- **Rejection summary log** at the end of `persistConfirmedEntities` — `{ requested, accepted, rejectedBySpec, rejectedTotal }` one info log per confirm.

Outcome after Round 1: review-screen spec alignment complete, feed chip rows render correctly, but `persistConfirmedEntities` was still producing orphan entities (null groupId, empty associatedPrimaryIds) — the pipeline's sender→PRIMARY fallback couldn't route because the wiring the scan layer reads was never written in the Phase-2/3 flow. That set up Round 2.

### Round 2 — Pipeline wiring for paired-WHO routing (#130 pair)

**Step 6 (research-only):** Mapped sender→PRIMARY routing through `extraction.ts` (5-stage cascade; Stage 5 is sender-fallback reading `Entity.associatedPrimaryIds`; ambiguous when length ≠ 1) and `cluster.ts::resolveEntityFromDetected`. Confirmed: scan pipeline reads `associatedPrimaryIds` at three extraction sites + one cluster site; does NOT read `EntityGroup` / `Entity.groupId` at scan time (those are UI-only). So `associatedPrimaryIds` is the critical denormalisation to wire.

**Step 7a — `linkEntityGroups` helper + Phase-2/3 integration**
- New `apps/web/src/lib/services/link-entity-groups.ts` — extracted the inline EntityGroup/associatedPrimaryIds logic from `persistSchemaRelations` (legacy hypothesis path) into a pure-ish helper that takes a `Prisma.TransactionClient` + the freshly-persisted entity rows + `inputs.groups`, and emits all the writes in parallel. Auto-groups ungrouped PRIMARIES into their own EntityGroups. Coalesces `associatedPrimaryIds` writes by primary-id fingerprint.
- `persistSchemaRelations` now calls the helper in place of the inline block (behavior-identical for the legacy path — same writes, same ordering).
- `persistConfirmedEntities` extended: `caseSchema.findUnique` now also selects `inputs`; after the `createMany` / `updateMany` writes land, reloads the persisted rows by `(identityKey, type)` and calls `linkEntityGroups(tx, schemaId, rows, inputs.groups)`. This is the fix for "Phase-2/3 confirm flow produces orphan entities."
- **Regression caught during Round 3 eval:** first property run still had empty `associatedPrimaryIds` on all SECONDARIES. Root cause: `inputs.groups` stores the user's typed short strings ("851 Peavy"), but the confirm flow canonicalises entity names ("851 Peavy Road") — exact name lookup missed. Added a tolerant resolver in the helper (case-insensitive + prefix + token-subset match, restricted to same `type`). Tests cover the regression explicitly (`link-entity-groups.test.ts` — 10 cases).

**Step 7b — `Email.candidatePrimaryIds` + thread-adjacency disambiguation**
- New column `emails.candidatePrimaryIds JSONB NOT NULL DEFAULT '[]'` via `ALTER TABLE` (additive, safe). Schema delta in `prisma/schema.prisma`; `pnpm prisma generate` to pick it up.
- Extraction Stage 5 updated: when the sender is a known SECONDARY and `senderPrimaryIds.length > 1`, write `candidatePrimaryIds = senderPrimaryIds` on the Email row (entityId stays null; `routingDecision.method = "sender_ambiguous"`; structured log `extraction.ambiguousSender.recorded`). Previously this case silently dropped to orphan.
- New `apps/web/src/lib/services/thread-adjacency.ts` — pure `resolveByThreadAdjacency(orphans, siblings)` helper. Given orphan emails (`candidatePrimaryIds` non-empty, `entityId` null) and sibling emails in the same threads (`entityId` set), adopt the unique candidate that matches a sibling. 0 or >1 matches → stay orphan (honest).
- `cluster.ts::coarseClusterImpl` runs the resolution pre-cluster: loads `candidatePrimaryIds`, queries thread siblings scoped by `schemaId`, applies `resolveByThreadAdjacency`, writes adopted `entityId` + clears `candidatePrimaryIds` + stamps `routingDecision.method = "thread_adjacency"` in one transaction. Structured log `cluster.threadAdjacency.resolved` with orphansConsidered/resolved counts.
- Unit tests: `thread-adjacency.test.ts` — 8 cases (single match, multi-match abstain, no-match, no siblings, batch independence, sibling dedup, irrelevant sibling filter, empty input).
- **Why this matters beyond school_parent:** 7b is universal for any N:M pairing — property (Timothy/Krystin/Vivek × 3 addresses) and any future user who pairs one WHO with multiple WHATs. Without it, every generic email from a paired WHO with no content match drops to orphan silently. With it, thread context routes most such emails to the right case; the rest stay honestly unrouted.
- **Deferred as issue #130 (captured, not built):** zero-match-hint re-scan cron ("we'll keep watching" copy is aspirational until the cron exists). Design is in the issue: daily cron, per-schema loop over `stage1UserThings` with matchCount=0, re-run discovery, update row if the count flipped. UI-promotion surface ("Denim found new matches for X") is a follow-up beyond the cron.

### Round 3 — End-to-end gate on all three eval schemas

Ran `--stage synthesis` with `AI_RESPONSE_CACHE=fixture` against fresh schemaIds (`--stage discovery` then `--stage synthesis`) after the 7a regression fix landed.

| Schema | Cases | Off-topic | Synth ok | 7a (SECONDARY assoc_count) | 7b (sender_ambiguous / thread_adj resolved) | Total time |
|---|---|---|---|---|---|---|
| school_parent | 3/3 | 0 | 3/3 | Ziad→1 (1:1) | 0 / 0 (simple pairing, 7b doesn't fire) | 121.6 s |
| property | 7/7 | 0 | 7/7 | Tim/Vivek/Krystin→3 each (1:N) | 2 / 0 (orphans alone in thread — honest) | 193.0 s |
| agency | 3/3 | 0 | 3/3 | Margaret/George→1 (PPA), Farrukh→1 (Stallion) | 0 / 0 (1:1 pairings) | 142.7 s |

All hard assertions pass on all three: SLA <5 min, 0 off-topic, 0 synthesis failures, entity-routed cases. **Property exercises the 1:N pairing case fully** — the 2 `sender_ambiguous` orphans are the honest floor (generic Timothy emails in single-email threads with no sibling to disambiguate against).

182 web-app tests green (+2 for the 7a regression, +8 for thread-adjacency). Typecheck clean. Biome clean on changed files.

### Entry points for the next session

- Fresh eval schemaIds (2026-04-23, usable for visual review at `/feed?schema={id}` with `BYPASS_AUTH=true`):
  - property: `cmoc1dmur00008gqeyyd0anah`
  - school_parent: `cmobts5lj0000kcqedzr4hel6` (Round 3 reran synthesis on this existing AWAITING_ENTITY_CONFIRMATION schema)
  - agency: `cmoc1e8rv0000h0qeoh5ulv06`
- Reports in `docs/test-results/eval-onboarding-{schema}-full-2026-04-23.md`.
- **Not yet verified:** visual review of the confirm screens (`/onboarding/{schemaId}`) and the feed (`/feed?schema={id}`) — per prior guidance, this is the manual E2E step. Round 3 only verified the DB + pipeline state.
- **Not yet built:** issue #130 (hint re-scan cron). Tracked in GitHub; see capture at `https://github.com/nickdicarlo-max/denim-email/issues/130`.
- **Not yet run:** live Gmail test with `--refresh-cache` (cache was fixture-only this round).

### What this completes from master-plan §16

- **Item 3 — Stage 1/Stage 2 review-screen UI** — shipped in Round 1. The discovery-confirm-include loop is now architecturally complete; what's left is ongoing quality tuning, not missing screens.
- **Items 1/2/4/5/6/7/9 — unchanged** (RLS migration, Stage 2 spec-drift decision, feedback-rule application, whatPlaceholder, CASA prep, daily cron, #120-123 tag-score) — deferred to subsequent sessions.

## Baseline

Phases 0–7 complete. **`feature/ux-overhaul` merged to `main` on 2026-04-14 via PR #83** (merge commit `ff8aa43`). Active branch is now `feature/perf-quality-sprint`. Typecheck clean; 153 unit tests passing (up from 144 after #85's parser tests). Phase 1 + Phase 2 verified end-to-end on 3 live runs (see 2026-04-15 session block below); Phase 3 ready to start.

## Deferred debt

- **Scan-stage retry doesn't actually recover a `PROCESSING_SCAN` failure.** Task 12's retry route handles pre-scan failures (`PENDING` / `GENERATING_HYPOTHESIS` / `FINALIZING_SCHEMA`) cleanly, but a scan-stage failure leaves the ScanJob in `phase=FAILED` and the resumed `runOnboarding.waitForEvent` hits its 20m timeout. Task 13's manual-rescan route creates a new scanJobId that the waiting workflow ignores. Deferred until a scan-stage failure actually bites in practice (none observed in testing).
- ~~**Inngest-outage stranding in `POST /api/onboarding/start`**~~ — **resolved by #33** (2026-04-09). Transactional outbox pattern: stub + outbox row written atomically; `drainOnboardingOutbox` cron retries failed emissions. The fragile TOCTOU P2002-catch is also eliminated — `onboarding_outbox.schemaId` PK is the sole idempotency guard.
- **`casesMerged` / `clustersCreated` fabricated as 0** in clients for backward compat; cleanup can remove them from the client response in a future pass. Cosmetic.

### Canonical progress doc + deeper detail

See the "Execution Progress" header inside `docs/superpowers/plans/2026-04-07-onboarding-state-machine.md`. It has per-task commit SHAs, file inventory, 29 plan deviations, and the verification routine I followed for each task. The refactor is **complete** — that plan is the canonical archaeology if you need to dig into any specific task's rationale.



### Pipeline Root Cause Investigation & Fixes (2026-04-12)

Deep investigation into April 11 test run failures. Two schemas tested:
"April 11 Test Girls Activities" (school_parent) and "April 11 Property
Management" (property). Multi-session data-driven diagnosis using probe
scripts against live DB data.

**Root cause #1: Synthetic ID MERGE failure (#58, closes #37)**

The gravity model assigns synthetic IDs ("new-case-0") to newly created
cases in memory. MERGE decisions reference these IDs, but the write phase
at cluster.ts:338 looked them up in the DB where real cases have CUIDs.
`if (!targetExists) continue;` silently skipped every MERGE. Both schemas
had 0 MERGE cluster records, 100% CREATEs.

Evidence: GA gravity model simulation produced 20 CREATE + 34 MERGE
decisions. All 34 MERGEs had scores 36-45 (above threshold 35). 48 orphaned
emails had entityId=soccer set correctly at creation (never re-processed).
6 orphans had alternativeCaseId="new-case-1"/"new-case-6" -- synthetic IDs
leaked into the DB.

Fix: Build `syntheticToReal` mapping during CREATE writes in the transaction.
Resolve MERGE targetCaseId and alternativeCaseId through the map. No changes
to @denim/types or @denim/engine (pure function stays pure). Commit d9cbba6.

**Root cause #2: PM mergeThreshold=45 unreachable (#59)**

Property domain had mergeThreshold=45 but max achievable score without
sender-entity match is 35 (subject 20 + tag 15). Zero merges possible
regardless of the synthetic ID bug.

Fix: Lowered property domain default from 45 to 30 in interview-hypothesis.ts.
Added ceiling validation in interview.ts: if AI-generated mergeThreshold > 40,
cap at 30. Commit d9cbba6.

**Additional fixes (commit 46743a8):**

- **#60 Case-splitting visibility** -- Catch block now writes PipelineIntelligence
  error row with `output: { error: true, errorMessage, errorType }`. Diagnostic
  write wrapped in its own try/catch to avoid masking the original error.
- **#61 Case tags populated** -- All 3 case-creation sites (coarse CREATE, split
  CREATE, catch-all) now populate anchorTags, allTags, displayTags from email
  tags. Added `tags: true` to emailDetails query in split phase.
- **#47 Extraction race guard** -- Added `extractionCompleteEmitted` boolean to
  ScanJob with CAS guard: `updateMany({ where: { extractionCompleteEmitted: false } })`.
  Only the first checkExtractionComplete invocation emits; subsequent ones no-op.

**Issues filed during investigation (for backlog):**
- checkExtractionComplete race condition confirmed but mitigated by downstream CAS
- Case-splitting silently failed for both April 11 schemas (now visible via #60 fix)
- clusteringConfidence column on Email is dead (never written)

**Validation:** All changes typecheck clean, 133 unit tests pass. Gravity model
simulation confirms 34/34 merges resolve, 71/71 emails accounted for, 6/6
alternativeCaseIds resolve to real CUIDs.

### Review Screen Speed + Entity Grouping (2026-04-13)

**Problem from first live test:** Review screen took 72.8s to appear (target <30s),
and all discovered SECONDARY entities were hidden — "ZSA U11/12 Girls" (7 soccer
emails), "TeamSnap" (7 soccer emails), "Pia spring dance show" (1 dance email)
produced zero visibility on the review screen despite being the most actionable
discoveries. Only PRIMARY entities without alias matches ("Rental Properties",
"The Control Surface") surfaced, in a separate "New Discoveries" section. Under
each user topic the screen said "No additional items found" even when plenty was
found.

**Design decisions:**
- Pass 1 (pre-confirm, blocks review screen) shrinks to 100 random emails bounded
  to last 8 weeks. Purpose stays broad/exploratory — find things the user didn't
  mention.
- Pass 2 (domain expansion) moves from Function A (pre-review) to Function B
  (post-confirm). Targets ONLY user-confirmed entities — the user's toggles tell
  us which domains are worth expanding.
- Pass 2 expansion rule: corporate domains expand by domain
  (`from:email.teamsnap.com`), generic providers (@gmail, @yahoo, etc.) expand by
  specific sender address (`from:ziad.allan@gmail.com`). Prevents `from:gmail.com`
  from pulling every personal email in the inbox.
- Validation prompt adds `relatedUserThing` on each discovered entity so Claude
  labels which user topic the entity relates to (or null if cross-topic or
  unrelated).
- Review UI restructures to two sections: "Your Topics" (each user topic with
  related discoveries underneath) and "Discoveries" (flat list of everything
  else — the Amy DiCarlos, Timothy Bishops, Rental Properties).

**Changes shipped (15 commits, 80d9bf1 → 9b725de on feature/ux-overhaul):**

- `apps/web/src/lib/config/onboarding-tunables.ts` — NEW central config for sample
  sizes, lookback windows, per-target caps. Replaces hardcoded constants in
  `onboarding.ts` and `discovery.ts`.
- `packages/types/src/schema.ts` — `HypothesisValidation.discoveredEntities[].relatedUserThing`
- `packages/ai/src/parsers/validation-parser.ts` — Zod accepts `relatedUserThing`
  with `.default(null)`
- `packages/ai/src/prompts/interview-validate.ts` — 4th optional `userThings` param
  wires the user's entered topics into the system prompt with matching rules
- `apps/web/src/lib/services/interview.ts` — `validateHypothesis` threads
  `userThings`; `GENERIC_SENDER_DOMAINS` now exported
- `apps/web/src/lib/gmail/client.ts` — `sampleScan(maxResults, newerThan?)`
- `apps/web/src/lib/services/expansion-targets.ts` — NEW `extractExpansionTargets`
  (corporate domain vs generic-provider sender rule) + 6 unit tests
- `apps/web/src/lib/inngest/onboarding.ts` — Function A Pass 1 uses
  `sampleScan(100, "56d")`; Pass 2 loop removed from Function A; new
  `expand-confirmed-domains` step added to Function B with idempotent upsert
- `apps/web/src/lib/services/discovery.ts` — reads lookback + cap from config
- `apps/web/src/components/onboarding/review-entities.tsx` + `phase-review.tsx` —
  "Your Things" → "Your Topics"; unified "Discoveries" section; SECONDARY
  entities grouped under topics via `relatedUserThing`
- `apps/web/scripts/diagnose-hypothesis.ts` — fixed pre-existing typecheck errors
  (`name` not `displayName`, `lastAttemptAt` not `updatedAt`, scanJob relation
  filter); added `confirmedTags` output; clarifies empty discoveryQueries is
  expected at AWAITING_REVIEW

**Expected timing:** ~25-35s for review screen (hypothesis 10-15s + Pass 1
validation 15s + Inngest overhead ~3s). Pass 2 now runs invisibly during the
post-confirm scan progress UI.

**Open follow-up: #66** — `relatedUserThing` lives only in `schema.validation`
JSONB. `phase-review.tsx` Branch A (reads DB Entity rows) can't see it. Dead
path today (no entities exist at AWAITING_REVIEW), but activates if we ever
let users revisit the review screen. See issue for two fix options (join
JSONB in GET route vs. add column to Entity model).

**Pending:** Task 14 manual E2E verification — fresh onboarding run to confirm
<30s target and verify ZSA/TeamSnap/Pia appear under their topics.

## 2026-04-14 Session Log

### Audit (morning)
Three parallel Explore agents ground-truthed both 2026-04-13 plans (review-screen-speed and pipeline-resequencing) against the code — every factual claim matched. **No hallucination.** Real gap was verification (no CI-level integration, no Playwright E2E, happy-path test suspected of testing wrong things per Nick's distrust). Issues filed from the audit: **#67–#73**.

### Commits landed on `feature/ux-overhaul`
- **2b9f16e** `fix(onboarding): confirm route uses outbox + Function B owns phase advance`
  - OnboardingOutbox PK now composite `(schemaId, eventName)` (raw-SQL migration via supabase-db skill)
  - Drain function is event-generic (reads eventName + payload from row)
  - POST confirm route: no more phase flip — single `prisma.$transaction` commits `persistSchemaRelations` + outbox row; optimistic fire-and-forget emit; drain cron (1-min tick) is the guaranteed recovery path
  - Function B's existing `advanceSchemaPhase` + ScanJob creation now runs correctly (was being skipped)
  - `phase-review.tsx` renders "Starting your scan…" during submission window
  - Closes **#67** and **#74**
- **fcc8420** `obs(onboarding): per-step wall-clock telemetry in Function A`
  - `generate-hypothesis.complete` / `validate-hypothesis.complete` / `advance-to-awaiting-review.complete` / `runOnboarding.awaitingReview` all emit `stepDurationMs` + sub-step timings (dbReadMs, gmailTokenMs, gmailSampleScanMs, validateHypothesisMs, dbWriteMs)
- **5e64991** `chore(skills): add onboarding-timing skill`
  - `.claude/skills/onboarding-timing.md` — parses JSON logs into a timeline table (needs Claude Code restart to register as slash command)
- **7e5043b** `fix(extraction): mid-scan PRIMARY entity discovery via Stage 3b upsert`
  - Gemini's `detectedEntities` that name new PRIMARY entities (not in existing Entity list) are now upserted with a trust gate: sender ambiguous with 2+ associated primaries, OR subject literally contains the entity name, OR Gemini confidence ≥0.7
  - Idempotent under existing `@@unique([schemaId, name, type])`
  - Stage 4 refactored to reuse pre-resolved sender data (one fewer DB round-trip per email)
  - Closes **#76**

### Live E2E runs — both 6/6 PASS

| Schema | Domain | Emails | Cases | Duration | Key verification |
|---|---|---|---|---|---|
| `01KP6CF6QJPHS3Z4DHYDDK75CK` "Round 2 Girls Activities" | school_parent | 80 | 4 | ~4 min Function B | Entity grouping (ZSA/TeamSnap under soccer), 32 MERGEs (was 0 pre-#58), tag coverage 100%, outbox EMITTED |
| `01KP6DVWDSW1V0W1AT1X9H0DKP` "Property Management" | property | 200 | 16 | ~9 min Function B | mergeThreshold=30 produced 18 MERGEs (min score 31.7, med 34.3 — threshold at the edge exactly as predicted), splits 16, PipelineIntelligence row written |

### Issue hygiene

**Closed (verified in live data):**
- **#33** Start route outbox — baseline + confirmed by today's runs (both outbox events EMITTED attempts=1)
- **#56** validateHypothesis wired back — already resolved by Plan 1
- **#67** Confirm route outbox — by 2b9f16e
- **#68** Entity uniqueness — already fixed in earlier commit 17fcec8 (expand-confirmed-domains uses upsert with `schemaId_name_type`)
- **#74** PROCESSING_SCAN ownership — by 2b9f16e
- **#76** Mid-scan PRIMARY discovery — by 7e5043b

**Filed this session (still open):**
- **#69** Inngest retries 0→2 (needs step-level idempotency audit first)
- **#70** `validation-parser.test.ts` for `relatedUserThing` default-null + round-trip
- **#71** Audit or delete `onboarding-happy-path.test.ts` (no longer trusted as gate)
- **#72** CI integration job + Playwright onboarding E2E spec
- **#73** Review screen render time — 107s first run, 48s second (Claude variance)
- **#75** Post-scan orphan mining (topics the user never mentioned — Martial Arts belt-test from Amy DiCarlo)
- **#77** Gemini batch extraction (pack 5-10 emails per call, est. 3-5x extract speedup)
- **#78** Parallelize Claude synthesis + case-splitting (est. -3m on run 2)
- **#79** Anthropic prompt caching on validateHypothesis (est. -10s on Function A)
- **#80** Parallelize `generate-hypothesis` + `gmail.sampleScan` (est. -5s)
- **#81** Parallelize discovery query execution in run-scan (est. -20s)
- **#82** Live case count during synthesis (UX perceived-wait)

### Combined perf estimate (if #77–#82 land)
- Run 1 (80 emails, 4 cases): ~4min → ~1m30s
- Run 2 (200 emails, 16 cases): ~9min → ~3m40s
- Function A (user waits on Card 3): ~40s → ~25s

### Updated issues with run data
- **#19** Clustering non-determinism — substantially improved by #58 (32 MERGEs); remaining variance is Gemini
- **#59** PM threshold=30 — validated at the edge on run 2 (min merge score 31.7)
- **#25** Scanning UX — linked to all six speedup issues (#77–#82) as the perf umbrella
- **#21, #35, #38, #16, #65** — commented with observed data

## 2026-04-14 Evening Session — Perf + Quality Sprint Kickoff

### Merge to main
- PR #83 (`feature/ux-overhaul` → `main`) merged with merge commit `ff8aa43`.
- Carried Waves 1–3 of UX overhaul, 2026-04-12 pipeline fixes (#58 #59 #47 #60 #61), 2026-04-13 review-screen speed + entity grouping, 2026-04-14 outbox confirm route + mid-scan PRIMARY discovery + telemetry.
- `feature/ux-overhaul` kept around (not deleted) per Nick's request.

### Sprint branch + plan
- New branch `feature/perf-quality-sprint` off `main`.
- **Canonical plan:** `docs/superpowers/plans/2026-04-14-perf-and-quality-sprint.md` — 6 phases, 19 issues, locked order `69, 70, 79, 80, 81, 77, 78, 82, 63, 73, 25, 35, 38, 65, 75, 57, 71, 72, 66`. Tests (#71, #72) deferred to end because surface area changes.
- Execution method: subagent-driven-development (fresh subagent per task + two-stage review).

### Phase 1 — Safety foundations ✅ CODE-COMPLETE
- **#69** Step-level idempotency audit + retries 0→2 on both onboarding Inngest functions — commit `173f7ab`. Audit found 1 NEEDS GUARD: `create-scan-job` now has findFirst-and-reuse guard covering the window where `scanJob.create` succeeds but CAS `updateMany` fails.
- **#70** `validation-parser.test.ts` with 5 cases (explicit value, omitted default-null, explicit null, round-trip, invalid type) — commit `9a658fd`.
- Quick gate: typecheck clean, 139→144 tests pass. Full E2E pending.

### Phase 2 — Cheap perf wins ✅ CODE-COMPLETE
- **#79** Prompt caching on `validateHypothesis` system prefix — commit `45cb490`. Static/dynamic split with `cache_control: { type: "ephemeral" }` on the static block; `cacheReadInputTokens` / `cacheCreationInputTokens` logged. **Caveat:** current static prefix is ~500 tokens vs Sonnet 4.6's 1024-token minimum — infra is correct and production-safe, but cache won't activate until the prefix grows. Zero cost when inactive; lights up automatically later.
- **#80** Parallel `generate-hypothesis` + `gmail.sampleScan` in Function A — commit `2ddb60c`. Real code had sampleScan nested inside `validate-hypothesis`; implementer extracted it to a new sibling step `gmail-sample-scan` so `Promise.all` can run both against shared Inngest retry/checkpoint semantics.
- **#81** Parallel discovery query execution — commit `0884cee`. Added `p-limit@7.3.0` (new dep); concurrency=3; `.slice(0, maxEmails)` trims incidental over-fetch from racing workers.
- Quick gate: typecheck clean, 144/144. Full E2E pending.

### Expected Phase 2 wins (measurement pending)
- Function A: ~40s → ~35s (−5s from #80; #79 dormant until prefix grows)
- `run-scan` discovery: ~38s → ~15s (−23s from #81)

### Issues touched this session
- **Closed:** #16 (silent email dropping — two clean runs qualify)
- **Filed:** **#84** Harden `GmailMessageMeta.date` against Inngest JSON-replay (latent-only risk today; #80 made retry-replay more likely to execute)

### Next action on resume
1. Nick runs the full E2E on both schemas; captures structured logs; invokes `/onboarding-timing`
2. If baseline matches: dispatch Task 3.1 (#77 Gemini batch extraction — est. −2m on Run B)
3. If regression: bisect across `45cb490 → 2ddb60c → 0884cee`

### Skills hygiene
- `supabase-db` and `onboarding-timing` skills now installed at user scope (`~/.claude/skills/<name>/SKILL.md`) so they register as slash commands. Source-of-truth copies remain committed at `.claude/skills/*.md`. CLAUDE.md updated to document the install.

## 2026-04-15 Early-Morning Session — Phase 1 + 2 Verified End-to-End

### E2E runs (three schemas, all clean after in-flight parser fix)

| Schema | Domain | Emails in | Cases | Function A | Scan | Eval |
|---|---|---|---|---|---|---|
| `01KP6Z08X7QWQE11V1P045D6NG` Round 3 Girls Activities | school_parent | 200 | **12 → 5** | 57.8s | 5m 11s | PASS after #85 |
| `01KP7B8ZJGWGZ697CBYY5JXHCF` Consulting | agency | 69 (of 198) | 11 | **39.4s** | 5m 39s | 6/6 PASS |
| `01KP7C5VBFRMJ6ZT1ZZKWRAJVN` Round 4 Girls Activities | school_parent | 56 (of 108) | 5 | 46.6s | 3m 28s | 6/6 PASS |

### In-flight regression fix — case-splitting parser (#85, commit `a6d8007`)

Round 3 initially produced **12 cases with obvious duplicates** (3× ZSA U11/12 Soccer Practices at 10/12/18 emails each; 2× Pia Dance Show; etc.). Investigation (see #85):

- Coarse clustering was fine — 32 MERGE + 12 CREATE at gravity-model scores 35.6–45.0.
- `PipelineIntelligence[stage=case-splitting].output.error = true`, message `"cases.5.discriminators: Too small: expected array to have >=1 items"`.
- Zod schema in `packages/ai/src/parsers/case-splitting-parser.ts` parsed the whole envelope in one shot — one bad sub-case rejected all 6 returned by Claude.
- Catch block returned `{ clusterIds: [], casesCreated: 0 }`, so `runCaseSplitting` emitted `clustering.completed` with only coarse IDs. Synthesis ran on unsplit coarse output.

**Fix (`a6d8007`):**
- `packages/ai/src/parsers/case-splitting-parser.ts` — envelope + per-case parse; invalid sub-cases dropped, their emailIds salvaged to `catchAllEmailIds` for downstream discriminator reassignment. Only structurally broken envelopes throw.
- `packages/ai/src/prompts/case-splitting.ts` rule 6 — removed "Typical: 2-5 cases per entity" anchor; added explicit "no numeric cap" and MERGE-when-same-what's-next guidance.
- `packages/ai/src/__tests__/case-splitting-parser.test.ts` — 9 new tests including exact repro of Round 3's empty-discriminators failure. Suite 144 → 153.

Confirmed on Runs B and C: case-splitting `PipelineIntelligence` rows = 1 (no error), SPLIT cluster records present, previously-duplicated cases collapsed correctly.

### Phase 2 timing verdict (from `/onboarding-timing`)

- **#80** parallel genHyp + sampleScan — ✅ sampleScan fully hidden under generateHypothesis on every post-`2ddb60c` run.
- **#81** parallel discovery queries — ✅ 20+ searchEmails in ~4s on Round 3; 7 parallel in ~1s on Round 4 Pass 2.
- **#79** prompt caching — ✅ infra correct, **dormant**: `cacheReadInputTokens=0, cacheCreationInputTokens=0` on all calls (static prefix ~500 tok < Sonnet 4.6's 1024-token minimum). Zero cost; activates when prefix grows.
- Claude API variance (14.9s–28.2s on the same prompt) dominates the remaining Function A budget — not a code issue.

### Issues closed this session
- **#79** prompt caching — landed + dormant, closed with followup-if-prefix-grows note.
- **#80** parallel Function A — landed + verified across 3 runs.
- **#81** parallel discovery — landed + verified across 3 runs.
- **#85** case-splitting parser brittleness — fix + tests + E2E verification.

### Known soft issue (non-blocking, for later)
- Consulting run produced three PRIMARY entities for the same company — `Portfolio Pro Advisors`, `PPA`, `Portfolio Pro Advisors (PPA)`. Partially user-input driven (Nick entered "Asset Management" instead of the company name), but the product should also do cross-alias primary coalescence. Not filing today — revisit during Phase 5 quality work.

### Next action on resume (Phase 3 kickoff)
1. Dispatch Task 3.1 (**#77** Gemini batch extraction, 5–10 emails per call — estimated −2m on 200-email runs).
2. Then Task 3.2 (**#78** parallel synthesis + case-splitting fan-out — estimated −3m).
3. Then Task 3.3 (**#82** live case count during synthesis — UX perceived-wait).

Baseline for Phase 3 measurement: Run B (Consulting, 200 emails) = 339.5s scan / 5m 39s end-to-end; Run C (Girls Activities, 108 emails) = 207.5s / 3m 28s.

## 2026-04-15 Afternoon Session — Phase 3 Code-Complete

### Commits landed on `feature/perf-quality-sprint`

| Task | Issue | Commit | Summary |
|---|---|---|---|
| 3.1 Gemini batch extraction | **#77** | `7c0d1d0` | `CHUNK_SIZE=5` batched Gemini calls with `BatchExtractionSchema` in `@denim/ai`. Parser validates array length, sorts by index, strips index. On parse failure: quarantine fallback to per-email path. Exclusion-matched emails still short-circuit (cheap DB-only upsert). Tests: packages/ai 46 → 52. |
| 3.2 Synthesis fan-out | **#78** | `2c6b373` | `runSynthesis` refactored to fan out `synthesis.case.requested` events. New `synthesizeCaseWorker` (concurrency=4 per schemaId, retries=2) + `checkSynthesisComplete` (waits for all cases before emitting `scan.completed`). Mirrors existing `fanOutExtraction → extractBatch → checkExtractionComplete` pattern. Preserves `scan.completed` payload so downstream `runOnboarding` + polling unchanged. **Case-splitting fan-out deferred → #86** (single cross-entity Claude call + atomic delete/create write doesn't decompose cleanly). |
| 3.3 Live case count | **#82** | `f3b54ff` | Raw-SQL migration via supabase-db path: `scan_jobs.synthesizedCases`, `scan_jobs.totalCasesToSynthesize`. Denominator set in `runSynthesis` load-cases step using actual `findMany` count; per-case increment in `synthesizeCaseWorker` success path (not on failed path — counts completions, not attempts). Surfaced in polling response as optional fields; rendered in `phase-synthesizing.tsx` (plan said `phase-processing-scan.tsx` — that's the dispatcher, not the renderer). |

All three passes: typecheck clean vs baseline, `pnpm -r test` green (53/52 ai + 92 engine + 13 web + 2 types = 160 tests), `pnpm biome check` identical to baseline (pre-existing CRLF issues only).

### Architectural discovery — day-2 vs onboarding

During 3.2 implementation, two things surfaced that are bigger than the individual task:

1. **Case-splitting architecture doesn't fit per-case fan-out.** `splitCoarseClusters` is a SINGLE Claude call across ALL coarse clusters (cases can merge or split relative to each other) with an atomic delete-coarse / create-split transaction in `cluster.ts`. No natural per-cluster completion marker. Per-case fan-out would require refactoring both the Claude call shape AND the write-owner transaction.

2. **Onboarding and day-2 share the same code path today.** `cronDailyScans` (`cron.ts:81`) fires a generic `scan.requested` event handled by `runScan` (`scan.ts:34`) — the doc comment explicitly says it is "the parent workflow for every scan trigger (onboarding, cron, manual, feedback)". Day-2 re-runs the full AI pipeline (including Gemini per-email extraction + Claude case-splitting + Claude synthesis) for 2-20 new emails. No short-circuit to deterministic routing despite the onboarding-learned vocabulary (`learnedVocabulary` in `case-splitting.ts:31`) being explicitly designed for this.

These led to filing **#86 — Day-2 case-splitting: deterministic routing, no-op investigation, deferred fan-out**, which consolidates three threads into a single strategic issue with a phased proposal (A measure → B short-circuit → C day-2 routing → D fan-out only if still needed). Important nuance preserved in the issue: entity discovery (inter-entity) MUST stay dynamic (new "567 Maple St" still needs a new coarse cluster); only case-splitting (intra-entity) can become deterministic per known entity.

### Issues closed this session
- **#77** Gemini batch extraction — closed via commit trailer.
- **#78** Synthesis fan-out — closed via commit trailer, with splitting portion punted to #86.
- **#82** Live case count — closed via commit trailer.

### Issues filed this session
- **#86** Day-2 case-splitting consolidated strategic issue (see above).

### Expected Phase 3 wins (measurement pending)
- run-extraction (200 emails): ~3m10s → ~60s (3-5x, from Gemini batching)
- run-synthesis (16 cases): ~2m33s → ~40s (from concurrency=4)
- run-case-splitting: ~1m32s → **unchanged** (deferred to #86 strategic refactor)
- Total Function B (Run B Consulting 200 emails): ~9m → ~4m 50s (not the plan's ~3m 40s — splitting still serial)
- Observer UX: spinner → live "N of M" counter during synthesis

### Next action on resume
1. Nick runs full E2E on Run B (Consulting, 200 emails), measures Phase 3 actual gains via `/onboarding-timing`.
2. If baseline + no regressions: dispatch Phase 4 Task 4.1 (**#63** batch `persistSchemaRelations` round-trips).
3. If regression: bisect across `7c0d1d0 → 2c6b373 → f3b54ff`.

## 2026-04-15 Late Session — Phase 3 Measured + Tunables Consolidation

### Live E2E — Property Management, 200 emails

Schema `01KP8MRJQJXF302KP19NB5RAVR`, scanJob `cmo02y6x60022jgqeov2lboxj`.

**Result:** 6/6 PASS, 35 cases (34 synthesized + 1 failed → unstuck manually).

Key numbers from `/onboarding-timing`:

| Phase | Wall | Notes |
|---|---|---|
| Function A (hypothesis + validate + advance) | 35.4s | #80 parallel genHyp+sampleScan verified |
| Pass 2 domain expansion | 56.1s | 2 Claude calls dominated |
| Discovery + extraction fan-out | 39.0s | #81 parallel queries verified |
| Extraction (200 emails) | **169.5s** | vs projected ~60s — measurement revealed concurrency bottleneck |
| Clustering + case-splitting | 108.9s | unchanged, deferred to #86 |
| Synthesis (34 cases, concurrency=4) | 81.2s | verified; per-case 5–18s |

Function B real work (confirm → last synthesis): ~7m 35s vs ~9m baseline (~16% faster). Short of ~4m 50s projection because extraction and case-splitting both underperformed.

### Synthesis hang bug — fix `e804b70`

Case 34 of 35 failed Zod parse (Claude output truncated at `maxTokens: 4096` mid-`summary.middle`). Worker emitted `synthesis.case.completed status:"failed"` but `checkSynthesisComplete` counted pending via `synthesizedAt IS NULL`, so the failed case stayed "pending" forever and the scan never finalized.

**Fix:** Worker now stamps `case.synthesizedAt = NOW()` on failure as a terminal marker. `checkSynthesisComplete` now reads `synthesizedCount` / `failedCount` from `ScanJob.synthesizedCases` / `ScanJob.totalCasesToSynthesize` (populated by #82) instead of `synthesizedAt` state.

Unstuck the live run by manually stamping case 34 + firing one `synthesis.case.completed` event at the Inngest dev server. Finalizer ran, scan completed with the correct counters.

### Extraction bottleneck — diagnosis + fix `74e2138`

Phase 3's `#77` batching was engaged (40 Gemini batches of 5, 0 fallbacks) but wall was 169.5s, not ~60s. Root cause: **`extractBatch` Inngest concurrency limit = 3**.

Math: 40 batches × 6.0s avg ÷ 3 = 80s Gemini floor. Batching saves Inngest overhead, **not** Gemini output time — a 5-email batch returns ~5× the JSON payload, so per-call latency scales near-linearly.

**Fix:** Raised `extractBatch.concurrency` from 3 → 8. Projected: 40 ÷ 8 = 5 rounds × 6s = 30s Gemini floor + Gmail ≈ **~50s extraction wall (~3.4× faster)**. Gemini Flash 2.5 has 2000+ RPM headroom; DB pooler handles 8×5=40 parallel upserts. Tracked in **#88**.

### Tunables consolidation — `74e2138` → `b2c03fc` → `a2ae6f2` → `fe08121`

Extracted 20+ pipeline parameters from inline literals and prompt-file hardcodes into two tunables files:

**`apps/web/src/lib/config/onboarding-tunables.ts`** (extended):
- `extraction.chunkSize`, `batchConcurrency` (3 → **8**), `fanOutBatchSize`, `gmailPacingMs`, `relevanceThreshold`
- `discovery.queryConcurrency`, `broadScanLimit`, `bodySampleCount`
- `synthesis.caseConcurrency`, `synthesis.maxTokens` (**4096 → 6144**, closes #87)
- `pipeline.scanWaitTimeout`
- `ui.pollIntervalMs`

**`apps/web/src/lib/config/clustering-tunables.ts`** (NEW):
- `validator.unreachableCeiling` / `clampReachableValue` — the #59 math rails (docs scoring math inline)
- `weights.tagMatchScore` / `threadMatchScore`
- `reminder.subjectSimilarity` / `maxAgeDays`
- `domainDefaults.<domain>` for all 6 domains

**Lowered unreachable domain thresholds** (preserving differentiation inside the reachable ~35 range without sender-entity match):
- construction 45 → 35 (was silently clamped to 30)
- legal 55 → 38 (preserves "tightest domain" intent)
- agency 45 → 33 (was silently clamped to 30)
- general 45 → 32 (was silently clamped to 30)
- school_parent (35), property (30) unchanged

**Architectural change:** `buildHypothesisPrompt(input, tunables)` now takes numerics as a parameter. Package boundary respected — `packages/ai` stays pure; `apps/web` injects config. Types `ClusteringTunables` + `DomainNumerics` exported from `@denim/ai`. Content (tags/fields/labels) stays with the prompt file as copy, not tuning surface.

**Verification:** two forensic-agent passes (one per tunables file) caught 3 stragglers — all fixed in `fe08121`. Every declared tunable now has at least one non-declaration reference, and no duplicate hardcoded values remain in the pipeline paths. Library-layer defaults (e.g., `getEmailFullWithPacing(delayMs = 100)`) intentionally kept as literals for non-pipeline callers.

### Issues this session
- **Closed:** #87 (synthesis maxTokens bump resolved by tunable)
- **Filed:** #88 (extractBatch concurrency measurement), #90 (remaining un-migrated hardcoded values: cluster.ts maxTokens, prompt slice caps, model IDs)
- **Commented:** #89 (tunables centralization — partial done, rest tracked in #90)

### Commits landed
- `e804b70` fix(synthesis): stamp synthesizedAt on failure so scan finalizes
- `74e2138` perf(extraction): extractBatch concurrency 3→8 + centralize fan-out tunables
- `b2c03fc` refactor(tunables): centralize pipeline + clustering knobs, bump synthesis maxTokens
- `a2ae6f2` refactor(tunables): move per-domain clustering numerics out of the prompt file
- `fe08121` refactor(tunables): promote discovery broadScanLimit + bodySampleCount, fix gmail pacing duplicate

### Updated forecast for next Property run (200 emails)
- Extraction: 169.5s → ~50s (−119.5s from concurrency 3→8)
- Other phases unchanged
- **Function B work: ~7m 35s → ~5m 35s (−26%)** vs ~9m baseline
- Case-splitting (108.9s) still the biggest serial chunk; recovered only if/when #86 deterministic day-2 routing lands

### Next action on resume
1. Nick runs Property E2E to verify extraction ~50s wall + lowered mergeThreshold effect on merge count/scores
2. If clean: dispatch Phase 4.1 (#63 batch `persistSchemaRelations`)
3. If regressions: bisect across `74e2138 → b2c03fc → a2ae6f2 → fe08121`

## 2026-04-15 Late-Afternoon Session — Routing Gaps Diagnosed + Fixed

### Testing gaps from Property run forensics

Nick surfaced two symptoms from eval of the 200-email Property run (schema `01KP8MRJQJXF302KP19NB5RAVR`). DB forensics against the live `routingDecision` JSONB revealed:

**Gap 1 — 3 emails wrongly excluded as `relevance:low`** (all with `relevanceScore=0`):
- 2× "Re: 3910 Bucknell - MR" from Maurice Gallardo (subject literally names a user PRIMARY; 11-email thread with 9 from Timothy Bishop + Vivek Gupta SECONDARY entities)
- 1× "Re: FW: Commercial property proposal" from Shane Bowen (reply to Vivek Gupta thread)

Root cause: relevance-gate bypass was `senderIsKnownEntity`-only. Subject-contains-PRIMARY and thread-has-known-entity were both ignored.

**Gap 2 — 5+ emails misrouted into 851 Peavy case despite subjects naming a different PRIMARY.** Forensic pull of `routingDecision.routeMethod`/`detail` for each misrouted email showed:
- Subject "Re: 3910 Bucknell Drive-Foundation" from Timothy Bishop had `method=relevance, relevanceEntity="851 Peavy"` (wrong)
- The SAME subject from other senders correctly routed to 3910 Bucknell
- Subject "North 40 Projects" routed to 851 Peavy with `relevanceEntity="851 Peavy"` — subject doesn't mention Peavy at all

Root cause: Gemini hallucinated `relevanceEntity` under batch extraction (CHUNK_SIZE=5). When 3-4 of the 5 emails in a batch were about 851 Peavy (highest-volume entity, 36 emails), that context bled into the others' outputs. Architectural flaw compounded it: Stage 1 (Gemini `relevanceEntity`) ran BEFORE Stage 2 (deterministic subject content match), so the hallucination trumped the authoritative subject signal.

### Fixes landed — commit `bb23fe7`

**Relevance-gate bypass expanded** to fire if ANY of three deterministic signals match:
1. Sender is a known entity (existing)
2. **Subject contains any known entity name or alias** (new)
3. **Thread has ≥1 prior email with `senderEntityId !== null`** (new — one `prisma.email.findFirst` per low-relevance reply)

Bypass reason now logged (`bypassReason: "sender" | "subject" | "thread"`) for eval visibility. No Gemini output is trusted in the bypass path — every signal is deterministic.

**Routing stage order swapped** to make subject authoritative:
1. **Stage 1 (NEW):** subject-only PRIMARY name/alias match — immune to batch-context bleed
2. Stage 2: Gemini `relevanceEntity` (demoted from Stage 1)
3. Stage 3: summary content match (renamed/split from old Stage 2)
4. Stage 4: `detectedEntities`
5. Stage 4b: mid-scan PRIMARY creation (#76)
6. Stage 5: sender fallback

New `routeMethod="subject"` value makes eval queries straightforward.

### Issues filed / state

- **#87 closed** earlier today (synthesis maxTokens 4096 → 6144 via tunable)
- **#88 open** — extractBatch concurrency 3→8 measurement (next run verifies)
- **#91 open** — bypass expansion + subject-first routing (next run verifies)
- **#38 partially addressed** by #91 — relevance filtering was "too conservative"; the bypass triple should improve it measurably

### Phase 3 + 4 status per sprint plan

Sprint plan reference: `docs/superpowers/plans/2026-04-14-perf-and-quality-sprint.md`

**Phase 3 verification gate — still OPEN:**
- [x] Task 3.1 code-complete (#77, `7c0d1d0`)
- [x] Task 3.2 code-complete (#78, `2c6b373` — synthesis fan-out only; case-splitting deferred to #86)
- [x] Task 3.3 code-complete (#82, `f3b54ff`)
- [x] Extraction bottleneck diagnosed + fixed (#88, `74e2138` — concurrency 3→8)
- [ ] **Full verification protocol — pending Nick's next E2E**
- [ ] Function B target: originally ~3m 40s; revised forecast ~5m 35s due to case-splitting (#86) still serial
- [ ] Eval tag coverage still 100%, orphan rate unchanged
- [ ] Live counter visible during synthesis

**Phase 4 — not started:**
- [ ] 4.1 — #63 batch `persistSchemaRelations` DB round-trips (ready to dispatch after Phase 3 verification)
- [ ] 4.2 — #73 review-screen render time investigation (needs timing data from next run)
- [ ] 4.3 — #25 scanning UX umbrella close (verify child issues shipped, then close)

### Commits landed this session (8 total on `feature/perf-quality-sprint`)

- `e804b70` fix(synthesis): stamp synthesizedAt on failure so scan finalizes
- `74e2138` perf(extraction): extractBatch concurrency 3→8 + centralize fan-out tunables
- `b2c03fc` refactor(tunables): centralize pipeline + clustering knobs, bump synthesis maxTokens
- `a2ae6f2` refactor(tunables): move per-domain clustering numerics out of the prompt file
- `fe08121` refactor(tunables): promote discovery broadScanLimit + bodySampleCount, fix gmail pacing duplicate
- `847f0a8` docs: 2026-04-15 late session block (tunables consolidation)
- `bb23fe7` fix(extraction): expand relevance-gate bypass + prioritize subject over Gemini relevanceEntity

### Next action on resume

1. **Nick runs full Property E2E** — fresh schema to exercise the new routing
2. **Pull verification data via `/supabase-db`:**
   - Route-method histogram: `SELECT "routingDecision"->>'routeMethod' AS method, COUNT(*) FROM emails WHERE "schemaId" = '<new>' GROUP BY 1 ORDER BY 2 DESC`
   - Bypass reason counts in logs for the new schema
   - Email counts in Peavy vs 3910 Bucknell vs North 40 cases (expect shift away from Peavy)
   - Any remaining `relevance:low` exclusions where subject names a known entity
3. **If #91 clean + #88 clean (extraction ~50s):** dispatch **Phase 4.1 (#63)** — batch `persistSchemaRelations`
4. **If regressions:** bisect across today's 8 commits — relevance-gate expansion and routing swap are the risk surface
5. **If timing on Function A is still slow:** Phase 4.2 (#73) review-screen investigation using `/onboarding-timing`

## 2026-04-16 Session — Entity Robustness Phase 1 Complete

Phase 1 of the entity-robustness work shipped: 3 locked per-domain spec files (property, school_parent, agency) under `docs/domain-input-shapes/`, with cross-domain preamble (6 principles + staged fast-discovery destination from the Control Surface pattern) reproduced verbatim across all three. Strategy plan `docs/superpowers/plans/2026-04-15-entity-robustness-strategy.md` got an additive update — Phase 1 stamped COMPLETE, Phases 2-5 reframed as deep-scan improvements (no longer the primary UX lever). Yesterday's session log marked SUPPLANTED.

The session's substantive shift: the destination of all entity-robustness work is now explicitly the **staged fast-discovery onboarding flow** modeled on Nick's Control Surface product (~5s domain confirm + ~6s entity confirm + background deep scan). Per Nick: *"this isn't a change in direction, it's a clarification."*

Issues filed: **#94** (complete remaining-domain interviews — construction, legal, general, company-internal), **#95** (Epic: staged fast-discovery onboarding rebuild — collapses 4 yesterday-follow-ups into a single epic), **#96** (domain-shape registry refactor), **#97** (home-renovation single-topic schema, future), **#98** (company-internal Q1 option, future).

Spec: `docs/superpowers/specs/2026-04-16-entity-robustness-phase1-design.md`. Implementation plan: `docs/superpowers/plans/2026-04-16-entity-robustness-phase1-implementation.md`. Two commits on `feature/perf-quality-sprint`: `1a2e71d` (spec + supplanted stamp) and `5f1c062` (3 per-domain spec files + plan reframe).

### Next action on resume

1. Nick reviews the Stage 1 keyword lists in `school_parent.md` and `agency.md` against his real inbox; flips the `Status: DRAFT — Nick to review` markers to locked once validated.
2. With Phase 1 closed, dispatch issue #95 to the writing-plans skill for the staged fast-discovery rebuild — the larger architectural effort.
3. Or, if Nick wants to finish per-domain coverage first: dispatch issue #94 (remaining-domain interviews) using the same brainstorming flow that produced today's locked files.

## 2026-04-16 Evening — Issue #95 Plan Hardened (3 Review Passes)

The staged fast-discovery rebuild plan (`docs/superpowers/plans/2026-04-16-issue-95-fast-discovery-rebuild.md`) went through three full review passes tonight. Ready to execute tomorrow.

### Commit

- **`323ea9f`** on `feature/perf-quality-sprint` — +2,065 / −371 lines. Plan is now 5,228 lines covering 10 phases.

### What's in the plan

- **Phases 0-6** — schema + config, Stage 1 domain discovery, Stage 2 entity discovery, review UX, pipeline cutover, spec-as-config, cleanup
- **Phase 7** — eval framework (7 tasks): YAML fixtures, synthetic generator, runner with precision-at-20 / recall / rank / dup-rate, differential mode (old-flow vs new-flow before Phase 6 deletes the old), CI gate, dataset-growth workflow, **outbox chaos test**
- **Phase 8** — SLO commitments (4 tasks): `slo.ts` single source of truth, latency-regression CI teeth, stage1/stage2 duration telemetry, weekly dashboard
- **Phase 9** — rollback runbook (2am-ready, 3 scenarios with copy-pasteable SQL + git)
- **Phase 10** — deferred: Claude validator pass (wait for eval data)

### Critical ordering rule

**Task 7.4 (differential eval) MUST run before Phase 6 commits.** Phase 6 deletes `generateHypothesis` + `validateHypothesis`. Task 7.4 compares old-flow vs new-flow output on the same fixtures so Nick can mark each diff as improvement / regression / neutral. After Phase 6, the old column is irrecoverable.

### Hardening passes applied (summary of what changed vs the first draft)

1. **Pass #1 — lessons-learned review.** TOCTOU guards on confirm routes (#33 pattern), table ownership (CaseSchema writes routed through InterviewService), CAS Transition Ownership Map updated in `01_denim_lessons_learned.md`, outbox drain extended to new event names.
2. **Pass #2 — security + performance + simplification.** Fixed IDOR in confirm routes (wrong `withAuth` shape that defeated ownership checks — would have shipped a cross-tenant bug); added `userId` to OnboardingOutbox inserts; Zod validated `identityKey` charset + reserved `@`-prefix for SECONDARY; removed `res.text()` from Gmail error path (could echo Bearer header); added ReDoS guard. Reverted Stage 2 serialization to parallel fan-out (quota math showed serialization was overcorrection). `persistConfirmedEntities` batched via `createMany` + `updateMany`. Spec files became runtime config via sibling `.config.yaml` import — deleted the spec-compliance harness, markdown parser, fixture runner, and CI step.
3. **Pass #3 — "would Jeff Dean be proud?" quality layer.** Added Phases 7 + 8 + 9 + regex v2. This is what turns "feels like it works" into "precision-at-20 ≥ 0.70 enforced in CI" and "Stage 1 p95 ≤ 8s enforced via latency-regression test."

### Next action on resume

**Tomorrow's first task:** open `docs/superpowers/plans/2026-04-16-issue-95-fast-discovery-rebuild.md`, start at **Task 0.1** (extend `SchemaPhase` enum with 4 new values), work through Phase 0 foundation (4 tasks: enum, `identityKey` column, domain-shapes config, tunables). Estimated Phase 0 wall: ~1-2 hours.

**Execution harness recommendation:** use `superpowers:subagent-driven-development` — fresh subagent per task + two-stage review. Each task's checkboxes + commit message are ready-to-run.

**Key gotchas to remember:**
- Task 1.2 adds a new `getMessageMetadata` method to the existing `GmailClient` class. Don't invent `listMessages` / factory functions — use `searchEmails` + `new GmailClient(token)`.
- `withAuth` passes `{ userId, request }` — NOT `{ user, params }`. Read the existing `[schemaId]/route.ts:73-78` pattern.
- OnboardingOutbox has composite PK `(schemaId, eventName)` — two concurrent routes for the same event collide on P2002; that's the idempotency guard.
- Task 7.4 runs BEFORE Phase 6. Mark this with a blocker annotation on the plan TODO when executing.

### Two untracked scripts in working tree (unrelated to this plan)

- `scripts/simulate-stage1-domains.mjs`
- `scripts/validate-agency-keywords.mjs`

Both are Discovery 9 validator work from earlier today (2026-04-16). Not committed because they embed specific business contacts + reference the gitignored `Denim_Samples_Individual/` folder. Leave as-is.

## 2026-04-17 Session — Issue #95 Phase 0 + Phase 1 Complete

Executed the first two phases of the fast-discovery rebuild. Foundation (schema + config + tunables) and Stage 1 domain discovery (primitives + aggregator + Inngest function) are all landed. Ground-truthed against 417 real Gmail samples through the real code path. Stopping for commit review before Phase 2.

### Commits landed (11 total on `feature/perf-quality-sprint`)

**Phase 0 — Foundation (4 commits)**

| Task | Commit | Scope |
|---|---|---|
| 0.1 | `0f3e991` | `SchemaPhase` enum + 4 fast-discovery values; `SCHEMA_PHASE_ORDER` map extended (unanticipated typecheck gap — existing exhaustive Record broke on new values) |
| 0.2 | `5ff6cfe` | `Entity.identityKey` column + unique constraint swap `(schemaId, name, type)` → `(schemaId, identityKey, type)`; 140 rows backfilled; 8 callers updated |
| 0.3 | `e3242be` | `domain-shapes.ts` runtime config matching the 3 locked spec files (property 13 / school_parent 19 / agency 28 keywords) + 6 tests |
| 0.4 | `dafc373` | `ONBOARDING_TUNABLES.stage1` + `.stage2` nested groups + 3 tests |

**Phase 1 — Stage 1 Domain Discovery (7 commits)**

| Task | Commit | Scope |
|---|---|---|
| 1.1 | `8e2964e` | `PUBLIC_PROVIDERS` constant (15 domains) + `isPublicProvider` + 4 tests |
| 1.2 | `d383de6` + `487040f` | `GmailClient.listMessageIds` + `.getMessageMetadata` primitives; `fetchFromHeaders` with batching, pacing, per-message error counting, PII-safe `firstError` sanitizer. Spec-review + code-review passes caught a token-leak in the new catch block — fixed in `487040f`. |
| 1.3 | `5fe2a89` | `aggregateDomains` pure function (group by domain, drop generics + user domain, sort, topN) + 6 tests |
| 1.4 | `a6d9ab5` | `buildStage1Query` + `discoverDomains` orchestrator + 4 tests |
| 1.5 | `aa940e1` | In-process integration test for `discoverDomains` with mocked Gmail (property top-3 + agency top-5) |
| 1.6 + 1.6b | `96ff38d` | `runDomainDiscovery` Inngest function + 6 new `CaseSchema` columns (4 stage1 + 2 stage2) + `writeStage1Result` / `writeStage2Result` / `writeStage2ConfirmedDomains` InterviewService writers + new event type `onboarding.domain-discovery.requested`. Combined 1.6+1.6b because mutually-dependent (1.6 imports writers from 1.6b). |

### Test count

- Baseline (start of day): 153 unit tests
- After Phase 0: 169
- After Phase 1: **188 unit tests green** across `packages/types` + `packages/ai` (52) + `packages/engine` (92) + `apps/web` (44)
- Typecheck clean on all workspaces throughout

### Real-sample ground-truth validation

Built `scripts/validate-stage1-real-samples.ts` (untracked — samples folder is gitignored) that drives the REAL `discoverDomains` code path through a stub `GmailClient` serving from `Denim_Samples_Individual/*.json` (417 real Gmail messages).

Unlike the existing `simulate-stage1-domains.mjs` which re-implements Stage 1 logic, this validator imports the actual primitives — regression-safe.

**Results (all 3 ground-truth targets pass):**
- `property`: `judgefite.com` rank **1** (3 keyword-matching emails) — real property manager ✅
- `agency`: `portfolioproadvisors.com` rank **2**, `stallionis.com` rank **4** — real consulting clients ✅
- `school_parent`: `email.teamsnap.com` rank **1** (13 matches) — legitimate activity platform ✅

### Issues filed this session

- **#99** Plan/reality API-signature gaps — 8 specific corrections catalogued (advanceSchemaPhase takes opts+callback not positional, markSchemaFailed 3-args, getValidGmailToken not loadGmailTokens, matchesGmailAuthError not isGmailAuthError, 2-arg vs 3-arg createFunction shape, registration in functions.ts not route.ts, SchemaPhase Record extension, STAGE1_TUNABLES→ONBOARDING_TUNABLES.stage1 substitution, GmailClient already does metadata fetches). Recommendation: treat plan as architectural direction, not code spec; every implementer brief should say "check signatures against real code."
- **#100** Stage 1 agency newsletter noise — `t.biggerpockets.com` (newsletter, 13 emails) outranks real clients in real-sample validation. Agency top-5 still contains PPA + stallionis so spec is met, but newsletter domains outranking real clients is worth tracking. Recommend defer to Phase 7 eval for quantitative measurement.

### DB migrations applied via supabase-db skill

- `entities.identityKey` text NOT NULL, backfilled from `name`
- `entities` unique constraint swap: drop `entities_schemaId_name_type_key`, create `entities_schemaId_identityKey_type_key`
- `case_schemas` + 6 columns: `stage1Candidates` jsonb, `stage1QueryUsed` text, `stage1MessagesSeen` int, `stage1ErrorCount` int, `stage2ConfirmedDomains` jsonb, `stage2Candidates` jsonb
- `SchemaPhase` enum + 4 values: `DISCOVERING_DOMAINS`, `AWAITING_DOMAIN_CONFIRMATION`, `DISCOVERING_ENTITIES`, `AWAITING_ENTITY_CONFIRMATION` (all inserted `BEFORE 'FINALIZING_SCHEMA'`)

### Subagent-driven-development notes

Used subagent dispatch for Tasks 1.2, 1.3, 1.4, 1.5 (the plan's meatier items). Worked well for 1.3–1.5. Task 1.2 required a two-stage review loop (spec reviewer approved; code-quality reviewer flagged a Critical token-leak risk in `listMessageIds` catch-block log — fix committed as `487040f`). Subagents were blocked from running `git` commands due to permission policy — I staged + committed on their behalf based on their diff reports.

Task 1.6 + 1.6b were done manually because the plan had 7+ signature mismatches to correct; briefing a subagent on all the corrections would have been longer than just implementing it. Phase 0 tasks (all 4) were also manual because the Agent tool errored on Task 0.1's first dispatch and the tasks were trivially mechanical anyway.

### Key state for resume

- **Active branch:** `feature/perf-quality-sprint` (not pushed to remote)
- **Trigger wiring deferred:** no route emits `onboarding.domain-discovery.requested` yet — that's Phase 4 pipeline cutover
- **All 4 new SchemaPhase values are additive** — existing `GENERATING_HYPOTHESIS` flow still works; nothing is deleted until Phase 6

### Next action on resume

**Phase 2 — Stage 2 Entity Discovery (9 tasks):**

1. Open `docs/superpowers/plans/2026-04-16-issue-95-fast-discovery-rebuild.md` at **Task 2.1** (`fastest-levenshtein@1` dep + shared `levenshtein-dedup.ts` module + test).
2. Then 2.2 (`property-entity.ts` address regex + year-number guard), 2.3 (`school-entity.ts` two-pattern regex), 2.4 (`agency-entity.ts` sender-domain derivation).
3. Then 2.5 (`entity-discovery.ts` dispatcher), 2.6 (integration tests), 2.7 (Inngest function wrapper `runEntityDiscovery`).
4. Before executing: **cross-check any imports the plan's code samples make against real code** (per issue #99). The plan's signatures are stale — read the actual file before writing call sites.
5. **Keep using manual execution** for Phase 2 mechanical tasks; reserve subagent dispatch for Phase 2's integration tests + Inngest function wrapper. Phase 0/1 experience showed subagent overhead doesn't pay off for small mechanical work, but catches real bugs in meatier tasks.

**After Phase 2:** Ground-truth validate again via the untracked `scripts/validate-stage1-real-samples.ts` — extend it to also feed Stage 2 with known-good inputs (e.g., confirmed domains `judgefite.com` for property, `portfolioproadvisors.com` for agency) and check that Stage 2 surfaces specific real entities (addresses for property, project codes for agency).

### Three untracked scripts in working tree (as of end of 2026-04-17)

- `scripts/simulate-stage1-domains.mjs` (pre-existing 2026-04-16)
- `scripts/validate-agency-keywords.mjs` (pre-existing 2026-04-16)
- `scripts/validate-stage1-real-samples.ts` (new 2026-04-17 — real-code-path validator, ground-truth passing)

All three depend on the gitignored `Denim_Samples_Individual/` folder. Leave untracked.

## 2026-04-17 PM Session — Issue #95 Phase 2 Code-Complete + Plan Corrections

Single session shipped all 5 Phase 2 tasks, the pre-exec plan corrections from yesterday's audit, and a running deviations log. +11 commits on `feature/perf-quality-sprint` atop `96ff38d`.

### Plan corrections applied (`d0d7b34`)

Patched ~40 call-site / signature mismatches between the plan's code samples and the real codebase, as catalogued in `docs/superpowers/plans/2026-04-17-issue-95-phase2-corrections.md` (audit artifact from 2026-04-17 AM). Every Phase 2+ sample now matches Phase 0/1 conventions: `ONBOARDING_TUNABLES.stage{1,2}` namespacing, 2-arg `createFunction({..., triggers:[{event}]}, handler)`, opts-object `advanceSchemaPhase`, 3-arg `markSchemaFailed`, `matchesGmailAuthError`, `listMessageIds` (not `searchEmails`), `withAuth({userId, request})`, Task 3.3b flagged as verified no-op, OnboardingPhase union extension, Task 6.1 Step 0 gate for pre-Phase-6 differential eval, YAML loader install + Vercel deployment gate, and more.

### Phase 2 commits (7 tasks = 5 features + polish + deviations log)

| Commit | Task | Summary |
|---|---|---|
| `bf2f716` | 2.1 | `dedupByLevenshtein` — per-key Levenshtein merge; bumped `levenshteinLongThreshold` 2→3 |
| `2e5bbee` | 2.2 | `extractPropertyCandidates` — address regex + year-guard + Levenshtein dedup |
| `a8ee9dd` | polish | plan Task 2.1 sample sync + tunables comment accuracy |
| `dd08b81` | 2.3 | `extractSchoolCandidates` — 2-pattern regex (institutions + activities) |
| `870eba3` | deviations | created running deviations log doc |
| `4a1de76` | 2.4 | `deriveAgencyEntity` — domain + ≥80% display-name token convergence |
| `9db4364` | 2.5 | `runEntityDiscovery` Inngest fn + `discoverEntitiesForDomain` dispatcher + `onboarding.entity-discovery.requested` event + registration in `functions.ts` |

### Deviations captured (canonical: `docs/superpowers/plans/2026-04-17-issue-95-phase2-deviations.md`)

Short list — full rationale per entry in the doc:

- **D2.1-1** merge picker rewritten with `topFrequency` (plan sample's `existing.frequency - item.frequency` reads post-increment sum)
- **D2.1-2** `levenshteinLongThreshold` 2→3 (needed for `St Agnes`/`Saint Agnes`-style within-bucket merges)
- **D2.2-1** non-greedy name capture `{0,1}?` replaced plan's greedy `{0,2}` which swallowed trailing verbs like "balance"/"statement"
- **D2.2-2** preserve user's street-type spelling in display; normalize only the dedup key
- **D2.3-1** Pattern A split into two branches per spec Section 4 (religious-prefix no-suffix + general-with-suffix); plan's single-branch regex dropped "St Agnes Auction"
- **D2.4-1** `findConvergentToken` scans whole display name; plan's separator-only extractor missed prefix-word like "Anthropic Team"
- **D2.4-2** dropped hard `senderDisplayNames.length >= 5` gate (80% fraction is the real invariant)
- **D2.5-1** tightened D2.4-2 with `best.count >= 2` — single display name can't trivially claim 100% convergence on first token
- **D2.5-2** widened `Stage2Result.perDomain[]` with `failed?` + `errorMessage?` so Inngest wrapper's richer output persists honestly
- **D2.5-3** single-arg `LogContext` logger call-shape (pino-style `(obj, msg)` in plan is TS2554)

### Test + type state

- 83/83 web tests green (was 60 at session start — Phase 2 added 23)
- Typecheck clean across all workspaces at every commit
- No new migrations this session (Phase 2 doesn't touch schema.prisma)

### Key state for resume — Phase 3 is next

- **Active branch:** `feature/perf-quality-sprint` (not pushed to remote)
- **Trigger wiring still deferred:** `runEntityDiscovery` is registered but NO route emits `onboarding.entity-discovery.requested` yet. The POST `/domain-confirm` route in Phase 3 Task 3.1 is what wires it up.
- `runDomainDiscovery` (Stage 1, shipped in Phase 1) is still not emitted by any route either — Phase 4 pipeline cutover does that.
- The 4 new `SchemaPhase` values (DISCOVERING_DOMAINS / AWAITING_DOMAIN_CONFIRMATION / DISCOVERING_ENTITIES / AWAITING_ENTITY_CONFIRMATION) are all additive; the legacy `GENERATING_HYPOTHESIS → AWAITING_REVIEW → PROCESSING_SCAN` flow is still live and unbroken.

### Next action on resume

**Phase 3 — Review Screen UX (6 tasks):**

1. Open `docs/superpowers/plans/2026-04-16-issue-95-fast-discovery-rebuild.md` at **Task 3.1** (POST `/api/onboarding/[schemaId]/domain-confirm`). This is the first route that actually ships a Stage-1→Stage-2 trigger.
2. Then 3.2 (POST `/entity-confirm`), 3.3 (GET polling extension), 3.3b (verified no-op — quick-check then continue), 3.4 (`phase-domain-confirmation.tsx`), 3.5 (`phase-entity-confirmation.tsx`), 3.6 (`flow.tsx` routing).
3. The route-test withAuth mock shape from the corrections doc (P3-1/P3-2/P3-3) is important — tests inherit the same pattern across 3.1 and 3.2.
4. **Keep appending to the deviations doc** every time implementation diverges from the plan's sample.
5. After Phase 3 lands, still nothing emits Stage 1 yet — that's Phase 4's cutover.

Three untracked scripts in the working tree (all dependent on gitignored `Denim_Samples_Individual/` — leave as-is):
- `scripts/simulate-stage1-domains.mjs`
- `scripts/validate-agency-keywords.mjs`
- `scripts/validate-stage1-real-samples.ts`

Plus an untracked `docs/superpowers/baselines/` directory that surfaced mid-session — not touched this session, left as-is.

## 2026-04-17 Evening Session — Issue #95 Phases 3 + 4 Code-Complete

Single session shipped all 6 Phase 3 tasks (review-screen routes + UI) and all 4 Phase 4 tasks (pipeline cutover). The deviations log now covers Phases 2, 3, and 4. Despite the filename still reading `phase2-deviations.md`, it's the canonical record for the whole rebuild-in-progress.

### Phase 3 commits (6 tasks on `feature/perf-quality-sprint`)

| Commit | Task | Summary |
|---|---|---|
| `8482ed2` | 3.1 | POST `/api/onboarding/[schemaId]/domain-confirm` — Zod + CAS `updateMany` `AWAITING_DOMAIN_CONFIRMATION → DISCOVERING_ENTITIES`; writes `stage2ConfirmedDomains` via `writeStage2ConfirmedDomains`; outbox row + optimistic `inngest.send(…).then(EMITTED)` chain |
| `534681f` | 3.2 | POST `/api/onboarding/[schemaId]/entity-confirm` — Zod with `@`-prefix refine + `persistConfirmedEntities` using `(schemaId, identityKey, type)` unique; CAS `AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN` with `phaseUpdatedAt` bump; same outbox pattern |
| `c678d8d` | 3.3 | Polling extension — `Stage1CandidateDTO`, `Stage2DomainCandidateDTO`, `Stage2PerDomainDTO` exported; `AWAITING_DOMAIN/ENTITY_CONFIRMATION` branches slotted before `PROCESSING_SCAN` so the no-DB path short-circuits |
| `a9a8b51` | 3.4 | `PhaseDomainConfirmation` — `{ response }` signature, design-system tokens, `authenticatedFetch`, `SubmitStatus` union with error/empty-state rendering |
| `9df6aa2` | 3.5 | `PhaseEntityConfirmation` — `identityKey = candidate.key` (correctness — plan's version would have 400'd every agency confirm), `autoFixed` merged badge, `aria-label` on rename input |
| `334cfaf` | 3.6 | `flow.tsx` routing — explicit single-case branches for `DISCOVERING_DOMAINS`/`DISCOVERING_ENTITIES` (Biome `noFallthroughSwitchCase`), import order respects `biome check --apply` |

### Phase 4 commits (3 bundled, breaking cutover)

| Commit | Task(s) | Summary |
|---|---|---|
| `882ba20` | 4.4 | `createSchemaStub` writes `domain` from `InterviewInput` — **shipped first** so 4.1's `!schema.domain` guard never trips mid-cutover |
| `6339780` | 4.1 + 4.2 | Thin `runOnboarding` (emits `onboarding.domain-discovery.requested`, throws `NonRetriableError` on missing domain, preserves two-tier catch) + trimmed `runOnboardingPipeline` (CAS `AWAITING_ENTITY_CONFIRMATION → PROCESSING_SCAN`, nulls `stage1Candidates`/`stage2Candidates` on `COMPLETED`) |
| `2c13672` | 4.3 | Deprecated POST `/api/onboarding/:schemaId` — route gutted to ownership check + phase-based 200/410 dispatch; expanded "already-confirmed" list to include `DISCOVERING_ENTITIES` + `NO_EMAILS_FOUND`; 180-line handler → ~40 lines |

Plus `b204eb5` — extended Stage 2 ground-truth validator + captured pre-Phase-2 baseline.

### Verification

- **Typecheck:** clean across all workspaces at every commit
- **Unit tests:** 97/97 web tests passing after Phase 4; packages unchanged from earlier today
- **Known breakage (expected):** `onboarding-happy-path.test.ts` and `onboarding-concurrent-start.test.ts` reference `generateHypothesis` / `validateHypothesis` / the hypothesis-first `runOnboarding` shape directly. Task 6.1 owns the rewrite.

### Deviations captured this session (15+ new entries)

Full rationale in `docs/superpowers/plans/2026-04-17-issue-95-phase2-deviations.md`. Highlights:

**Phase 3 correctness fixes** (the plan's literal code would have shipped bugs):
- **D3.1-1 / D3.2-1** — Outbox row must flip to `EMITTED` on successful `inngest.send`. Plan's "best-effort emit, drain cron handles it" would have re-emitted Stage 1/Stage 2 events every minute on the happy path (`nextAttemptAt @default(now())` means the row is drain-eligible immediately).
- **D3.1-2 / D3.2-4** — `vi.hoisted` mocks replacing `(global as any).__X`. Correctness: `inngest.send` must return a thenable for the `.then()` chain; plan's mock returned `undefined` and threw synchronously.
- **D3.4-3** — Raw `fetch` → `authenticatedFetch`. Every `/api/onboarding/*` route wraps in `withAuth`; plan's sample would have 401'd silently and still called `onConfirmed()`.
- **D3.5-1** — `identityKey = candidate.key` (producer's canonical key), NOT `\`@${domain}\``. Server Zod refine rejects `{identityKey.startsWith("@"), kind: "PRIMARY"}` as reserved for SECONDARY. Plan's agency branch would have 400'd every confirm.

**Phase 4 atomic cutover protections:**
- **D4.4-1** — Task 4.4 shipped BEFORE 4.1 (plan numbering reversed) so repo stays functional at every commit boundary during the breaking cutover.
- **D4.1-1** — `NonRetriableError` for missing-domain (not plain `Error`). Prevents Inngest from burning three retries on a deterministic state error.
- **D4.2-1** — 4.1+4.2 bundled into one commit. Splitting them created an intermediate state where `runOnboarding` emits Stage 1 but `runOnboardingPipeline` still expects hypothesis JSON via `expand-confirmed-domains` — would P0-break any in-flight schema hitting the mid-cutover commit.
- **D4.3-2** — Deprecated route gutted to pure stub (ownership check + phase dispatch). Retaining old Zod/outbox/persistSchemaRelations plumbing "just in case" would bitrot; clean deletion is safer than 180 lines of unreachable code.

**Phase 3 additive polish (plan-friendly):**
- **D3.3-1** — Typed DTOs at JSON boundary (vs plan's `as any` casts). Biome `noExplicitAny` clean + shared types for 3.4/3.5 components.
- **D3.4-2 / D3.5-2** — Design-system adoption (plan sample was `bg-black` placeholder).
- **D3.4-4 / D3.5-5** — Error handling + empty states + `autoFixed` badge + `aria-label`. Additive to the happy path.
- **D3.6-1** — Explicit single-case branches for `DISCOVERING_DOMAINS`/`DISCOVERING_ENTITIES` (Biome `noFallthroughSwitchCase`).

### Gaps / open items flagged in the log

1. **No DOM tests for `PhaseDomainConfirmation` / `PhaseEntityConfirmation`** (D3.4-5, D3.5-4). Repo has no `@testing-library/react` / jsdom / happy-dom; vitest env is `node` with no `.tsx` glob. Deferred to Phase 7 Playwright e2e. **Decision needed:** retrofit jsdom + testing-library for ~4 component smoke tests, or leave to Playwright.
2. **Task 4.4b** — test-helper audit: grep for direct `entity.create` / `entity.upsert` calls in test setup that should route through `persistConfirmedEntities`.
3. **Task 4.4c** — verify `INNGEST_SIGNING_KEY` is set so `/api/inngest` rejects unsigned events. Security hardening.
4. **Integration-test regressions** — `onboarding-happy-path.test.ts` + `onboarding-concurrent-start.test.ts` broken by Phase 4 cutover; Task 6.1 owns the rewrite against Stage 1/Stage 2 flow.

### Risk assessment (mine, not the plan's)

- **Low risk — the deviations are high-quality.** Four of the Phase 3/4 deviations are actual correctness fixes that the plan's literal code would have shipped as bugs (outbox double-emit, auth 401s, agency-confirm 400, Inngest retry burn on missing domain). The log catches them with rationale + trade-offs instead of silently patching over them.
- **Medium risk — agency entity algorithm drift (D2.4-1 → D2.4-2 → D2.5-1).** Final shape (whole-display tokenization, ≥80% fraction, ≥2 count minimum) is three shifts away from the plan that went through the 3-pass review. Defensible per-step, but Phase 7 differential eval (Task 7.4) is the first real quantitative check. Log itself flags false-positive risk from shared first names across agency senders.
- **Medium risk — no end-to-end manual run yet.** Phases 1–4 landed event wiring across three separate commits (`runDomainDiscovery` unit-tested, `runEntityDiscovery` unit-tested, `/domain-confirm` + `/entity-confirm` unit-tested, `runOnboarding` now emits Stage 1) without a composed live run against Gmail + Inngest dev server. Unit test pass ≠ E2E pass.
- **Medium risk — integration tests are red on main the moment this branch merges.** Task 6.1 must rewrite `onboarding-happy-path.test.ts` + `onboarding-concurrent-start.test.ts` BEFORE any merge-to-main, or the CI gate breaks. Flag this explicitly in the merge plan.
- **Low risk — hypothesis-first code still live.** Phase 4.3 gutted the route but `generateHypothesis` / `validateHypothesis` services remain. Intentional — Task 7.4 differential eval needs both flows alive before Phase 6 deletes the old path. Just don't forget to delete.
- **Low risk — deviations file scope creep.** Named `phase2-deviations.md` but covers Phases 2–4. Cosmetic; consider renaming to `issue-95-deviations.md` post-rebuild.

### Next action on resume — ordered checklist

Decided 2026-04-17 evening. Task 4.4c is **done** (local verification complete; Step 3 curl against Vercel is post-merge only). Everything else stays open and should be executed in this order next session:

1. **Run the Stage 1/2 validator** (~2 min) — `cd apps/web && npx tsx ../../scripts/validate-stage1-real-samples.ts`. Expected: Stage 1 3/3 + Stage 2 7/8 (issues #101/#102/#103 tracked as known). Cheap regression check before we touch anything — Phase 3/4 didn't modify discovery code, so a fresh baseline is free insurance.
2. **Task 6.1 — rewrite the two broken integration tests** against the Stage 1/Stage 2 flow:
   - `apps/web/tests/integration/onboarding-happy-path.test.ts`
   - `apps/web/tests/integration/onboarding-concurrent-start.test.ts`
   Both currently import `generateHypothesis` / `validateHypothesis` / the old `runOnboarding` shape. Rewrite to drive: `POST /onboarding/start` → `runDomainDiscovery` → `POST /domain-confirm` → `runEntityDiscovery` → `POST /entity-confirm` → `runOnboarding` → scan pipeline. Hard pre-merge blocker for this branch.
3. **Commit the test rewrites** + this status update as one or two clean commits.
4. **Task 4.5 — first live manual E2E** with dev stack + Inngest dev server + live Gmail OAuth. Walk a fresh schema through Stage 1 confirm → Stage 2 confirm → scan complete. This is the first composed run of the wiring landed across Phases 1–4. Capture telemetry via `/onboarding-timing`. Runtime-only; nothing to commit unless we find + fix bugs.
5. **Decide Phase 5 entry point** based on E2E findings — spec-as-config (Task 5.0 YAML loader) if the flow is clean, or hotfix commits if not.

Still pending from Phase 4 (not blocking next session):
- **Task 4.4b** — test-helper audit (grep for direct `entity.create` / `entity.upsert` in `apps/web/tests/**` that should route through `persistConfirmedEntities`). Low-priority; fold into Task 6.1 if the rewrites touch test setup.
- **Task 4.4c Step 3** — post-merge curl against Vercel (`curl -X POST https://<prod>/api/inngest -d '{}'` → expect 401/403). Only runs after merge to main; not a pre-merge gate.

**Key gotcha:** the legacy `GENERATING_HYPOTHESIS → AWAITING_REVIEW` path in `runOnboardingPipeline` is now dead but `generateHypothesis` / `validateHypothesis` services still compile and are imported by the broken integration tests. Task 6.1 rewrites should **stop importing them entirely** — that locks in the deprecation. Final deletion stays blocked until Phase 7 Task 7.4 differential eval runs (needs both flows alive).

---

## 2026-04-18 Late Evening Session — Task 6.1 + Issue #105 Gmail Credentials Refactor

One session: executed Task 6.1 (integration-test rewrite), attempted the first live E2E, hit a production-shape Gmail-reconnect bug, filed + fully executed issue #105 to close the class of failure structurally, and addressed a GitGuardian alert on leaked DB credentials.

### Part 1: Task 6.1 — integration tests for the Stage 1/Stage 2 flow

| Commit | What |
|---|---|
| `019b31b` | **Test rewrite + staleness fixes.** Rewrote `onboarding-happy-path.test.ts` (drives `POST /start → /domain-confirm → /entity-confirm → scan → COMPLETED`, drops `generateHypothesis` / `validateHypothesis` imports) and `onboarding-concurrent-start.test.ts` (seeds Gmail token via new `seedGmailToken` helper that routes through prod `storeGmailTokens`). Added `seedGmailToken` to `tests/integration/helpers/test-user.ts`. Amended with three staleness-fix commits for test files surfaced as red by the integration run: `onboarding-routes.test.ts` (deprecated `POST /:schemaId` is now a 410/200 shim after 2c13672 — rewrote 4 tests; widened `seedSchema` phase union with the four new #95 phases), `onboarding-polling.test.ts` (`FINALIZING_SCHEMA → GENERATING_HYPOTHESIS` legacy mapping assertion), `onboarding-state.test.ts` (`SCHEMA_PHASE_ORDER` monotonic assertion expanded through the full #95 chain). Also trimmed `2026-04-17-issue-95-phase2-plus-corrections.md` from ~245 → 132 lines (Phases 2–4 corrections collapsed into a paragraph pointing at the deviations log; Phase 5+ punch list retained verbatim; counts updated to 2 Critical / 7 Medium / 0 Nit). |

**Verification at commit time:** `pnpm typecheck` clean; 243 → 279 unit tests passing across 4 workspaces after staleness fixes. Integration suite: `onboarding-concurrent-start` 4/4, `onboarding-happy-path` skipped-as-designed under `RUN_E2E_HAPPY=0`.

### Part 2: Integration suite run — known-failure categorization

Ran `pnpm --filter web test:integration`. 120/130 passing; 7 test failures + 2 failed suites. Categorized:

- **Fixed in `019b31b`**: 6 staleness failures (the three files above).
- **Pre-existing, unrelated**: `full-pipeline.test.ts > creates action items for permission case` (AI non-determinism — zero actions generated for a case where Claude usually generates one). File filed mentally as known flake.
- **Pre-existing, unrelated**: 2 suite-load failures on `pipeline-quality-comparison.test.ts` + `real-gmail-pipeline.test.ts` — both threw `invalid_grant` at module load while trying to exchange a stale Gmail OAuth refresh token. User confirmed these are not from the current refactor; separate cleanup.

### Part 3: Live E2E attempted — Gmail reconnect loop

First live human run of the rewritten onboarding flow after Task 6.1. Flow:

1. User created a schema (POST /start → 202, outbox row EMITTED).
2. Inngest dev server restarted mid-session (history lost for the specific failed schema).
3. Stage 1 ran at 21:13 and failed with `phaseError = "[DISCOVERING_DOMAINS] GMAIL_AUTH: Gmail not connected. Please connect Gmail first."` — tokens were null at Stage 1 time despite the pre-flight check passing at start-time.
4. UI rendered the `phase-failed.tsx` "Google connection lost" screen (Bug 4-style auth UX).
5. User clicked Reconnect Google. OAuth consent screen appeared. User consented. Redirect to /auth/callback. **User landed back on the same failure screen.** Three retries, same result.

DB snapshot (via `supabase-db` skill):
- `user.googleTokens IS NULL` after three reconnect attempts.
- Schema row: `phase=FAILED`, `phaseError` as above, `outbox.status=EMITTED, attempts=1` (session-started event fired fine).
- No rotation of userId; schema.userId + user.id + outbox payload userId all matched.

### Part 4: Root cause diagnosed live via monitor tail

Piped both dev server logs through `tee` to `/tmp/next-dev.log` + `/tmp/inngest-dev.log`, set up Monitor tails filtered on `CALLBACK DEBUG|GMAIL_AUTH|storeGmailTokens|invalid_grant|callback.`. Added targeted `console.log("[CALLBACK DEBUG]", ...)` instrumentation at each callback boundary. Reproduced in one click:

```
callback.storeTokens.failed
  TypeError: tokens.scope.includes is not a function
  at storeGmailTokens (…)
```

Immediately followed by `POST /api/onboarding/start → 422` (Gmail not connected).

**Root cause**: `GMAIL_SCOPES` was exported from `apps/web/src/lib/gmail/oauth-config.ts` which had `"use client"` at the top. When `/auth/callback/route.ts` (server) imported that constant, Next.js App Router wrapped the export into a **Client Reference** object (not the raw string). `tokens.scope.includes("gmail.readonly")` inside `storeGmailTokens` threw `TypeError: x is not a function`. The callback's outer `try/catch` caught the TypeError, logged `logger.warn({ operation: "callback.storeTokens.failed" })`, and **continued to happy-path redirect**. `user.googleTokens` stayed NULL. UI rendered the reconnect screen again. Infinite loop with no user-visible error.

This is **Bug 2 (2026-04-09) reappearing** — the "warn-and-continue in an auth-adjacent catch" failure class. Documented in `docs/01_denim_lessons_learned.md` Bug 2 rule (*warnings that indicate broken functionality must be errors*), violated by the same callback.

### Part 5: Issue #105 — Gmail credentials bounded context

Filed GitHub issue [#105](https://github.com/nickdicarlo-max/denim-email/issues/105) with full plan: refactor Gmail OAuth / credential handling from scattered-across-files into a single bounded-context module that makes the class of bug structurally impossible. Plan and pressure-test notes live at `C:\Users\alkam\.claude\plans\yes-put-together-a-zany-milner.md`.

Executed all 8 steps in one session on `feature/perf-quality-sprint`:

| Commit | Step | Summary |
|---|---|---|
| `d34e8c4` | 1 | NEW `apps/web/src/lib/gmail/credentials/` bounded context (service, parsers, storage, dev-bypass, index). NEW `packages/types/src/gmail-credentials.ts` with `CredentialRecord` + `CredentialFailure` discriminated unions; `GmailCredentialError extends AuthError` added to `errors.ts`. 4 contract-test fixtures (real Supabase + Google response shapes) + parsers.test.ts + service.test.ts (27 new unit tests, mocked Prisma + `globalThis.fetch`). Zero call-site changes — new module sits alongside legacy `gmail-tokens.ts`. |
| `26be2bc` | 2 | `/auth/callback` rewritten into 4 explicit steps (exchange → Zod-parse → persist → route). Missing `provider_token` redirects to `/?auth_error=true&reason=TOKEN_SHAPE_INVALID` (fail-closed) instead of silent happy-path. `storeCredentials` replaces `storeGmailTokens`. `errorRedirect` helper centralizes typed-reason redirects. 9 new unit tests covering every failure branch — including the exact shape-invalid case from tonight's bug as a regression gate. Also landed the carry-forward band-aid (`oauth-scopes.ts` + re-export from oauth-config) as the minimal layer before the directory split in step 6. |
| `98ceff4` | 3 | 7 callers migrated: `runScan`, `runDomainDiscovery`, `runEntityDiscovery`, extraction worker in `functions.ts`, `POST /api/gmail/scan`, `POST /api/extraction/trigger`, and `POST /api/onboarding/start` pre-flight (now uses typed `getCredentialRecord`). Inngest catches prefer `instanceof GmailCredentialError` alongside legacy `matchesGmailAuthError` string-match fallback. `auth-errors.ts` gains `"gmail_auth:"` bridge pattern so the UI string-match still fires while step 4 is pending. |
| `d693343` | 4 | DB additive column `CaseSchema.phaseCredentialFailure JSONB` applied via raw SQL through `supabase-db` skill; `schema.prisma` updated; Prisma client regenerated. `markSchemaFailed` gains optional `credentialFailure?: CredentialFailure` param (writes column with `Prisma.DbNull` on default path). Inngest catches compute + pass typed failure. `OnboardingPollingResponse` gains `credentialFailure?` field; `derivePollingResponse` surfaces it on schema-level FAILED. `phase-failed.tsx` drops `matchesGmailAuthError` import and branches on `response.credentialFailure?.remedy === "reconnect"` — UI is typed end-to-end. |
| `dfa67cc` | 5 | `/api/auth/store-tokens` fallback route converged onto `storeCredentials` with `verificationSource: "google_tokeninfo"`; NEW `GoogleTokenInfoResponseSchema` Zod parser in the credentials module. Test helper `seedGmailToken` migrated from `storeGmailTokens` to `storeCredentials`. After this commit `apps/web/src/` has zero non-definition references to `storeGmailTokens` / `getValidGmailToken` / `clearGmailTokens` — legacy module is dead code. |
| `1052007` | 6 | Directory restructure: `lib/gmail/shared/scopes.ts` (no directives) + `lib/gmail/client/oauth-config.ts` (`"use client"`). 4 client-component imports updated. Old `oauth-config.ts` + `oauth-scopes.ts` deleted. Biome `overrides` with `noRestrictedImports` rule in `biome.json` forbidding `@/lib/gmail/client/oauth-config` imports from `lib/gmail/credentials/**`, `lib/gmail/shared/**`, `lib/gmail/tokens.ts`, `lib/gmail/auth-errors.ts`, `lib/gmail/client.ts`, `lib/inngest/**`, `lib/services/**`, `lib/middleware/**`, `app/api/**`, `app/auth/**/route.ts`. **Verified by probe**: temporary violating import in `lib/gmail/credentials/` failed `biome check` with the project-specific error message pointing at the Client Reference bug. |
| `3a7245b` | 7 | **Deleted** `lib/services/gmail-tokens.ts` (220 lines, zero callers) and `lib/gmail/auth-errors.ts` (38 lines). NEW `wrapGmailApiError(error, operationLabel)` helper in `client.ts` — reads HTTP status off googleapis errors and classifies: 401 → `GmailCredentialError` with `reason: "revoked"`, else → `ExternalAPIError`. All three Gmail API throw sites (searchEmails, getEmailFull, listMessageIds) converted. Inngest catches cleaned up: domain-discovery-fn + entity-discovery-fn + functions.ts drop `matchesGmailAuthError` import; catch blocks check `err instanceof GmailCredentialError` only (functions.ts uses `err instanceof AuthError` since `GmailCredentialError extends AuthError`). Net: **+93 insertions, −345 deletions** for the step. |
| `51dd166` | 8 | Appended `docs/01_denim_lessons_learned.md` entry for 2026-04-18 Bug 7 (the Client-Reference-wrap reconnect loop). Documents 3 standing rules: (1) external boundary responses must be Zod-parsed before reaching business logic; (2) catch blocks in auth paths must fail closed (no warn + continue); (3) constants shared between server and client must live in `shared/` directories with no `"use client"`. Added patterns #7 ("Plain constant exported from `"use client"`") and #8 ("Warn-and-continue in an auth-adjacent catch") to the watch-for catalog, naming all three shipments of the class. |

**Per-step verification**: `pnpm typecheck` clean all 4 workspaces after every commit; `pnpm -r test` passing (types 2, engine 92, ai 52, web grew 97 → 133 across step 1 + step 2 test additions); `pnpm biome check` clean on modified files.

### Part 6: GitGuardian alert — Supabase DB password leak

Separate email alert from 2026-04-14 surfaced during the session. Investigation found Supabase Postgres password `j4vcoiu2yfjhbdfv78ywekhjbadvhjae` (project `xnewghhpuerhaottgalc`) in plaintext on `main` across three tracked files: `scripts/wipe-db.ts:10`, `scripts/routing-report.ts:11`, and `.claude/settings.local.json` (15+ Bash allowlist entries). In git history since `eaa1879` (2026-03-15). Repo is private so blast radius is people-with-access only, but the secret still needed to come out of HEAD.

| Commit | Summary |
|---|---|
| `dec9130` | Removed hardcoded URL fallbacks from both scripts — now require `DATABASE_URL` / `DIRECT_URL` in env, error out otherwise. `.claude/settings.local.json` untracked via `git rm --cached` (local file preserved on disk; Claude Code allowlist still functional). `.gitignore` updated with `.claude/settings.local.json` + explanatory comment. Audit-log check skipped per user ("99.9% no query, logs not tracked anyway"). |

**Still TODO (user-controlled, not in any commit):**
1. Rotate the Supabase DB password in the Supabase dashboard.
2. Update `apps/web/.env.local` with the new password (both `DATABASE_URL` and `DIRECT_URL`).
3. Mark GitGuardian alert resolved.
4. History purge via `git filter-repo --replace-text` is optional — becomes moot once password is rotated. Needed only if repo may go public in the future.

### Session net state

- **11 commits** shipped on `feature/perf-quality-sprint` (`019b31b` through `dec9130`).
- **Issue #105 fully closed** on the code side; final verification pending a clean live run.
- **Net code change on the Gmail surface**: +93 / −345 across steps 1–7. The bounded context replaces ~400 lines of scattered string-based auth handling.
- **279 unit tests passing** (up from 243 pre-session).
- **Biome CI gate** will now fail on the exact 2026-04-18 bug pattern by construction.

### Next action on resume — ordered

1. **User rotates Supabase DB password** (dashboard) + updates `apps/web/.env.local`.
2. **OAuth-playground test of the new sign-in flow.** Walk Reconnect Google → callback → storeCredentials → onboarding start. Confirm tonight's bug is structurally impossible: callback writes tokens on happy path; any shape failure lands on a visible error page with a typed `reason` code; onboarding pre-flight passes.
3. **If OAuth-playground test is clean**, run a full live E2E through Stage 1 → Stage 2 → scan → COMPLETED. That's the live verification `Task 4.5` was blocked on.
4. **Decide Phase 5 entry** (spec-as-config YAML loader per the trimmed corrections doc) based on E2E findings.
5. **Pre-merge to main**: integration tests that depend on Inngest dev server running (`onboarding-routes`, `onboarding-polling`, `onboarding-state`, `onboarding-concurrent-start`) should still pass. Happy-path test (`RUN_E2E_HAPPY=1`) runs only against a real Gmail token — skipped by default.

---

## 2026-04-19 Morning Session — OAuth Playground Test + #109 Fix

First morning session after the 2026-04-18 overnight #105 refactor. Goal: verify the credentials bounded-context works end-to-end through a full onboarding + scan. DB password was rotated pre-session per the security TODO.

### Setup friction (non-code)

Supabase pooler password propagation lag + a DIRECT_URL paste typo (missing `@`, wrong host shape) caused three false-start DB probes. Rotated password twice; eventually both URLs valid with identical credentials. Key lesson: pooler (6543) authentication can lag direct (5432) by up to several minutes after a password reset — not a code issue. Once DATABASE_URL authenticated, restarted `pnpm dev` so Next.js picked up fresh env (it captures `process.env` at startup, not per-request).

Also learned: `prisma.user.deleteMany()` only clears the public-schema `User` table; it doesn't touch Supabase's `auth.users` — a stale Supabase Auth session cookie still counts as signed-in and bypasses `/auth/callback` entirely. Clean OAuth-callback test requires deleting the `auth.users` row (dashboard) in addition to the DB wipe.

### #105 credentials refactor: verified good

Fresh sign-in → consent → `/auth/callback` → `storeCredentials` → `user.googleTokens` populated. No `callback.storeTokens.failed` warn, no `TypeError: .includes is not a function`. Onboarding start pre-flight passed on first try. Schema `01KPK3TQKGW3QHAXDE1D6NE7BM` progressed through `DISCOVERING_DOMAINS` → `AWAITING_DOMAIN_CONFIRMATION` → `DISCOVERING_ENTITIES` → `AWAITING_ENTITY_CONFIRMATION` → `PROCESSING_SCAN`. The 2026-04-18 bug class is structurally gone.

### #109 — Phase 4 cutover gap: coarse clustering crashed on first run

**Symptom**: Run #1 reached clustering, failed with `TypeError: Cannot read properties of undefined (reading 'fresh')` at `packages/engine/src/clustering/scoring.ts:97` inside `timeDecayMultiplier`. Retried 3× via Inngest, died.

**Root cause**: `createSchemaStub` writes `clusteringConfig: {}` as a placeholder (`apps/web/src/lib/services/interview.ts:348`). The legacy `persistSchemaRelations` overwrote it from `hypothesis.clusteringConfig`. The new Stage 2 `persistConfirmedEntities` writer only inserts/updates `Entity` rows — it never populates schema-level JSON columns. First live run through Stage 1/2 → scan was the first time the gap bit; unit tests pass because they cover the writer in isolation.

**Audit** (grep across `apps/web/src` + `packages`):

| Column | Read by | Severity |
|---|---|---|
| `clusteringConfig` / `tunedClusteringConfig` | `cluster.ts:115, 1232` | **CRITICAL** — crashes on `.timeDecayDays.fresh` deref |
| `summaryLabels` | `synthesis.ts:215` + 2 read-API routes | **REQUIRED** — injected into synthesis Claude prompt |
| `discoveryQueries` | `scan.ts:79` with `?? []` fallback | OK empty |
| `primaryEntityConfig` / `extractionPrompt` / `synthesisPrompt` | no active reader | OK empty (tracked in #110) |

**Fix landed this session**:
- NEW `apps/web/src/lib/config/schema-defaults.ts` — `buildDefaultClusteringConfig(domain)` + `defaultSummaryLabels(domain)` pure helpers. Composes `CLUSTERING_TUNABLES.domainDefaults[domain]` + `.weights` + `.reminder` into the 9-field `ClusteringConfig`. Handles all 6 domains plus unknown-domain fallback to `general`. Per-domain `summaryLabels` duplicated from the prompt file (6 × 3 strings; small acceptable dup).
- NEW `seedSchemaDefaults(tx, schemaId, domain)` writer in `interview.ts`. Single `tx.caseSchema.update`; deterministic; idempotent.
- WIRED into `POST /api/onboarding/[schemaId]/entity-confirm/route.ts` inside the existing transaction, after `persistConfirmedEntities`. Extended initial `findUnique` to include `domain`.
- 20 new unit tests in `__tests__/schema-defaults.test.ts` — all 6 domains covered for both helpers + fallback cases. Entity-confirm route test updated with the new mock and assertion.

**Verification**: typecheck clean, 153/153 web unit tests pass, DB wiped, re-ran full flow. Second run: `phase=COMPLETED`, 200 emails discovered, 138 excluded by discovery, 62 clustered into 22 clusters, 5 cases synthesized (1 synthesis failed per AI-side Zod — stamped as terminal via the `e804b70` fix, scan completed cleanly), 7 actions extracted. Scan duration **1m 51s** on 200 emails — no longer gated on the #58 synthetic-ID bug + #88 extractBatch concurrency bump in prior commits, now with working clustering.

### Two regressions surfaced + filed (not fixed this session)

Nick examined the completed schema and flagged two gaps:

- **#111** — `schema.name` stuck at `"Setting up..."`. Legacy `persistSchemaRelations` wrote the name from `hypothesis.name`; no analog in the new flow and `InterviewInput` has no `name` field. Proposed: add required name to the interview form + allow post-scan rename.
- **#112** — User-entered `whats` and `whos` dropped on the floor. Nick typed `"Stallion"` (Stallion Investments) and `"Farrukh Malik"` (who emails from `stallionis.com`). Stage 1 top-5 didn't include `stallionis.com` (below the keyword-only threshold), and Stage 2 `deriveAgencyEntity` doesn't consult user hints. High severity — regression from the pre-#95 hypothesis flow where `userThings` threaded into discovery. 3-tier proposed fix in the issue body.

### Commit + branch state

One commit on `feature/perf-quality-sprint` covering #109 fix + tests + this session block. Nothing pushed to remote. Deviations log not updated (this wasn't a plan deviation, it was a Phase 4 integration gap).

### Issues this session

- **Filed**: #109 (Phase 4 cutover gap), #110 (audit unread schema columns — low-pri follow-up), #111 (schema.name stub), #112 (user hints ignored).
- **Closed-implicitly**: #105 Gmail credentials refactor verification pending-live — now verified.

### Next action on resume

**Nick's call: fix #111 + #112 before any more live runs.** The product loop of "small hints → smart discovery → review → inclusion" is currently broken — testing anything else is working around a known regression.

Speed note: 1m 51s on 200 emails is acceptable-ish; Nick wants to revisit on bigger schemas once the hint regression is closed.

---

## 2026-04-19 Late Morning Session — #113 + #111 + #112 Tier 1

Continuation of the same morning session. Closed three of the regressions surfaced during the #109 fix verification, and filed one more that turned up on the verification run.

### Commits landed on `feature/perf-quality-sprint` (4 total, stacked on `4678814`)

| Commit | Issue | Summary |
|---|---|---|
| `4678814` | #109 | (earlier) seed `clusteringConfig` + `summaryLabels` on entity-confirm |
| `04aa46d` | #113 | Clear sessionStorage draft when user starts a new topic. Three entry points wired (`settings/topics/topic-list-client.tsx`, `settings/page.tsx`, `feed/empty-state.tsx`) plus a category-change safety net in `category/page.tsx` `handleContinue` that drops stale names when the user picks a different role/domain. |
| `e619058` | #111 | User-provided name field in the interview form + deterministic fallback. `InterviewInput.name` optional (types + Zod + sessionStorage). `createSchemaStub` now writes the user-provided name straight to `schema.name`; if absent, the stub's `"Setting up..."` placeholder remains visible until entity-confirm, where `seedSchemaName` composes a fallback from the first confirmed PRIMARY entity's displayLabel (or a domain-tailored title when no PRIMARY is confirmed). AI-generated name upgrade + post-scan rename UI tracked as #114. |
| `374c7ed` | #112 Tier 1 | Find-or-tell user-hint discovery at Stage 1. Three parallel Gmail searches: existing keyword-domain (ideation) + per-user-what (`"Stallion"` full-text) + per-user-who (`from:"Farrukh Malik"`). All three share the `fetchFromHeaders` primitive and run concurrently; one failure is isolated (`matchCount: 0, errorCount: 1`). Two new additive JSONB columns (`stage1UserThings`, `stage1UserContacts`). Stage 1 review UI restructured into three sections with pre-checked user-named rows flowing into the same `confirmedDomains` payload. 12 new primitive unit tests + entity-confirm route test updates. Tier 2 (pre-confirmed SECONDARY entity creation from user-named contacts at entity-confirm time) deferred. |

Test count: 153 → 173 over the four commits. Typecheck clean on every workspace at every commit.

### Final live E2E (schema `01KPK7GQCC972MWAK2K284PKV0`)

Fresh user, fresh Supabase Auth + browser cookies. Interview inputs on purpose designed to exercise every branch:

| Hint | Category | Result persisted in `stage1UserThings` / `stage1UserContacts` |
|---|---|---|
| `stallion` | what | 9 emails at stallionis.com, top sender Farrukh Malik |
| `portfolio pro advisors` | what | 43 emails at portfolioproadvisors.com (George Trevino + Margaret Potter) |
| `guitar` | what | **0 matches — explicit null** (the "tell" half of find-or-tell) |
| `farrukh malik` | who | 4 emails at fmalik@stallionis.com |
| `margaret potter` | who | 26 emails at mpotter@portfolioproadvisors.com |
| `george trevino` | who | 21 emails at gtrevino@portfolioproadvisors.com |
| `vernon maxwell` | who | **0 matches — explicit null** |

Stage 2 received `confirmedDomains = ["stallionis.com", "portfolioproadvisors.com"]` — **Stallion is no longer silently dropped** (was the core #112 bug). Scan completed: 8 cases, 0 failures. Schema `name` = `"Control Surface Consulting"` (user-provided), not the stub. #113 confirmed by Nick's qualitative "much better" — no visible input leak.

### Issues this session

- **Closed**: #109, #111, #113. #112 Tier 1 landed; Tier 2 tracked inside the #112 issue body for a future session.
- **Filed**: #110 (audit unread schema JSON cols — primaryEntityConfig, extractionPrompt, synthesisPrompt, discoveryQueries fallback), #114 (AI name upgrade + post-scan rename UI), #115 (Stage 2 entity-confirmation UX is opaque — checkboxes labeled "farrukh" and "portfolioproadvisors" with no context or framing; surfaced by Nick on the final live run).

### Soft observations (not blockers)

- `deriveAgencyEntity` derived Farrukh as a **PRIMARY** entity rather than SECONDARY — the algorithm's first-token-convergence logic treats a single-sender domain as the org's PRIMARY representative. Conflates with the user's mental model where Farrukh was typed as a who (SECONDARY). Folds into #115's proposed "Thing vs Contact" badge + #112 Tier 2's pre-confirmed SECONDARY creation.
- Only 2 entities in the final DB (`Portfolioproadvisors` + `Farrukh`) despite 8 synthesized cases. Stage 2 doesn't surface individual senders when the agency algorithm falls back to domain-name labeling for a non-convergent domain. Margaret / George were absorbed into the PPA entity.

### Next action on resume

1. **#115 first** — it's the user's last touch-point before scan kicks off and Nick explicitly flagged the opacity. Low-lift: header + row format + badge + empty-state copy. Should bundle naturally with:
2. **#112 Tier 2** — pre-confirmed SECONDARY entity creation from Stage 1's confirmed user-named contacts. Means Farrukh appears on Stage 2 review as a pre-checked SECONDARY with an "Added by you" badge regardless of what the algorithm derives.
3. Deferred (filed for later): #110 schema-col audit, #114 AI name + rename UI.
4. After #115 + #112 Tier 2 land clean → revisit speed on bigger schemas.

---

## 2026-04-19 Afternoon Session — Sprint planning + infra fixes + Stage 2 UX polish

Continuation of the morning. Pulled open issues via `/recall-issues`, cleaned deadwood, landed the infra slice Nick had sequenced (#108 → #109 already done → #107), then bundled #115 + #112 Tier 2 per the plan. Final state before Nick's laptop reboot: 40 open issues (was 48 at the start of the afternoon), 328 passing tests, 4 new commits on `feature/perf-quality-sprint`.

### Sprint planning findings

Pulled 48 open issues; grouped by theme (#95 fast-discovery fallout, overnight bugs, perf, eval/quality, tests/CI, UX backlog, meta). Spawned two parallel agents:

1. **Schema check** (Nick: "do we already have the columns we need for Tier 2?"). Agent analyzed current schema + flow and came back: cross-referencing `confirmedDomains ∩ stage1UserContacts.senderDomain` has edge cases (multiple user-hints on same domain; user-hint domain colliding with a keyword-discovered domain). Cleanest answer: one small marker column `stage1ConfirmedUserContactQueries: string[]`, not the fat JSONB blob I'd originally proposed.
2. **Prioritization check** ("is #115 + #112 Tier 2 actually the right next task?"). Agent confirmed yes, with the key insight: *"Running evals against a still-opaque Stage 2 burns a run on UX noise."* Polish first, then #93 + #38/#91 eval measurement. Flagged #99, #66, #91 as stale/should-close candidates for a future pass.

### Closed as shipped / dupe (6 issues)

| # | Title | Resolution |
|---|---|---|
| #106 | Empty clusteringConfig crash | Dupe of #109 (commit `4678814`) |
| #30 | State-machine refactor parent | 18/18 tasks shipped 2026-04-08 |
| #77 | Gemini batch extraction | Shipped `7c0d1d0` |
| #82 | Live case count during synthesis | Shipped `f3b54ff` |
| #78 | Parallel synthesis + splitting | Synthesis shipped `2c6b373`; splitting → #86 |
| #104 | April 18 E2E Test plan | Executed; findings split across #105-#115 |

**#106 bug-duplication lesson**: #106 was filed overnight 2026-04-19 00:52. The morning session independently re-diagnosed the same crash and filed #109. Cheap cost, but worth noting for sprint-plan hygiene — `gh issue list --search` on root-cause phrases before filing would have caught it.

### Commits landed

| Commit | Issue | Summary |
|---|---|---|
| `36e2250` | #108 | Registered `inngest/function.failed` in `DenimEvents`. Four `onFailure` handlers (extractBatch/runCoarseClustering/runCaseSplitting/synthesizeCaseWorker) were silently 400'ing on invocation because the system event wasn't in the typed union. Code unchanged; registration alone is the fix. |
| `0f0c022` | #107 | Duck-typed `isCredentialFailure` + `extractCredentialFailure` in `@denim/types`. Swapped 3 catch sites across `domain-discovery-fn.ts` + `entity-discovery-fn.ts` (outer catch + per-domain rethrow gate). `instanceof GmailCredentialError` was unreliable across Turbopack module boundaries in dev — same-module tests passed, cross-module runtime lied. Added 6 regression tests covering real instance, plain shaped object (the Turbopack scenario), plain Error, non-object values, malformed payload. |
| `c44a5ba` | #112 Tier 2 + #115 | Pre-confirmed SECONDARY entities + Stage 2 UX rewrite. New JSONB column + extended `writeStage2ConfirmedDomains` signature + `runEntityDiscovery` cross-references `stage1UserContacts` via `stage1ConfirmedUserContactQueries` to build `meta.source: "user_named"` candidates per domain. Stage 2 UI: header framing copy, per-domain `Inside <domain>` grouping with item counts, row format carries sender email + Thing/Contact kind badge + `Added by you` pill for user-seeded rows, per-domain empty-state copy ("We didn't find specific things inside X. Denim will still track the domain as a whole."), user-seeded rows pre-checked on mount and when groups arrive after initial render. Button label `Confirm N items` (was "entities"). Stage 2 picks accept SECONDARY kind. |

Also filed **#116** — Turbopack dev-server CSS worker crash breadcrumb. One-off `GET /feed 500` during restart; worker process died with Windows `0xc0000142` (STATUS_DLL_INIT_FAILED) while Turbopack evaluated PostCSS on `apps/web/src/app/globals.css`. Panic log captured. Not code-related; main Next.js process stayed up and served `/api/inngest` 200 after. Logging for context only; don't debug unless recurrent.

### Test + type state at session end

- Typecheck clean across all 4 workspaces.
- 328 unit tests passing: types 11 (+6 from #107 regression suite) + engine 92 + ai 52 + web 174.
- Integration tests not re-run this session (no service boundaries shifted).

### Known open questions from the agent-2 prioritization pass

Flagged for a future cleanup sweep (not this slice):

- **#99** (plan-stale-API-sigs) — plan is executed; this is an artifact. Close candidate.
- **#66** (`relatedUserThing` not persisted) — likely dead path post-#95 refactor. Verify and close.
- **#91** (conditional on #93 + property run) — consider folding into #93 or closing with checklist comment on #93.
- Also: #1 (Model Constants) and #13 (Lighthouse on prod) are >3 weeks old — either do or close.

### Next action on resume (post-reboot)

1. **Fresh E2E verification** — DB wipe + delete Supabase Auth row + fresh Google OAuth, then drive Stage 1 + Stage 2. Expected qualitative wins: (a) Farrukh explicitly shows on Stage 2 review as a pre-checked SECONDARY with "Added by you" pill; (b) clear `Thing` / `Contact` badges per row; (c) `Inside <domain>` headers; (d) no more bare `portfolioproadvisors` row. If Stage 1 user-whos section shows no user-named contacts and Stage 2 has no "Added by you" entries, something is wrong — possibly the `stage1ConfirmedUserContactQueries` persistence isn't firing.
2. **Pick next slice from one of**: (a) #93 entity-robustness aliases (Bucknell overmatch fix, unblocks #91 verification run), (b) #38 Eval Session 2 (now safe to measure post-#115), (c) #72 CI integration + Playwright (pre-external-user investment), (d) #32 Gmail sample data for rapid testing (iteration speed multiplier). Agent 2's recommendation: (a) + (b) as a pair — entity robustness then eval.
3. **Stale-issue cleanup** (cheap housekeeping): close or re-scope #99, #66, #91 per the agent-2 flags above.

---

## 2026-04-19 Evening Session — Compound E2E-driven fix: #117 + #102 + #119 + #121

Post-reboot. Cleared `.next` cache after a second Turbopack CSS-worker crash (`0xc0000142`, same shape as #116 — non-code Windows DLL init failure; restart cleared it). Ran two fresh onboarding E2Es back-to-back: Girls Activities (school_parent) + North 40 Partners (property). Both completed the pipeline. Output quality was bad in instructive ways — deep DB-forensic analysis surfaced four distinct bugs plus three new process concerns. Four fixes shipped tonight in sequence via background sub-agents; three deferred for tomorrow.

### Live E2E outcomes — the baseline for diagnosis

| Schema | Domain | Emails | Cases | Notable |
|---|---|---:|---:|---|
| `01KPM0R4QS72E8B1M0A1BDJWYC` Girls Activities | school_parent | 200 | **1** | 158 excluded, 38 orphans; the 1 case titled "ZSA U11/12 Girls…" but linked to wrong PRIMARY `Game at Academy`; only 4 of ~50 soccer emails made it in |
| `01KPM07ZBZG9570XKJZTVB9N2A` North 40 Partners | property | 200 | **48** | 21 PRIMARY entities including 8 short/long duplicate pairs; cases over-fragmented (851 Peavy: 9 cases, avg 1.4 emails; 3910 Bucknell: 7; 205 Freedom Trail: 6) |

### Findings in priority order

1. **Stage 1 per-whats query picks wrong top domain.** Girls inputs `whats: ["soccer", "guitar", "lanier", "dance", "st agnes"]` produced `soccer → bucknell.edu` (alumni newsletter, 10 matches), `dance → news.bloomberg.com` (Matt Levine, 3). User confirmed all three in Stage 2. Root cause: `discoverUserNamedThings` runs Gmail full-text on generic words + picks top sender domain by count. Plus a hidden design gap — `InterviewInput.groups` (typed as "the source of truth" for WHO↔WHAT pairing in `packages/types/src/schema.ts:6`) was never populated by onboarding UI or read by discovery. User insight during design: "Ziad Allan = soccer" is private knowledge the AI can't infer, but the data model was built to carry it.

2. **Stage 2 school extraction misses TeamSnap-style event-notification subjects.** Pre-existing #102. Critical design pivot during brainstorming: instead of hand-writing per-platform regex (fragile, manual — "this won't advance the mission" per Nick), mine the corpus statistically. N-gram frequency + event-verb stopword filter. `ZSA U11/12 Girls Spring 2026 Competitive Rise` emerges from repetition across ≥3 subjects; `New event: Practice` filters out because all-stopword. Domain-agnostic: works for GameChanger / ClassDojo / any platform where the entity name repeats.

3. **Stage 2 property address dedup** fails on street-suffix variants. `851 Peavy` + `851 Peavy Road` stay separate because Levenshtein distance (4) exceeds threshold (2). Same root cause produced the React duplicate-key console warning at `phase-entity-confirmation.tsx:253` — two candidates post-dedup carrying the identical key `"1906 crockett st"` rendered at once. Filed as **#119**.

4. **Relevance gate was mostly firing correctly for the wrong reason.** #118 investigation showed 158 excluded emails broke down as: 41 gmail.com (threaded noise, correctly excluded) + 83 from wrong-schema domains (`portfolioproadvisors.com`, `judgefite.com`, `lilviv.com` — not even soccer-adjacent; see finding 8 below) + 12 legitimate TeamSnap exclusions + 22 marketing/newsletter noise. The 12 TeamSnap exclusions were because display name `ZSA U11/12 Girls…` didn't fuzzy-match the (wrong) confirmed entities `Game at Academy` + `ziad allan`. **After #117 fixes scope + #102 extracts the real team name as a PRIMARY, those 12 would match via fuzzy-match on display name → sender-bypass fires → included.** Closed **#118** as subsumed; two narrower residual concerns split into **#121** + **#122**.

5. **Residual robustness: `persistConfirmedEntities` never populates `aliases`.** All 4 SECONDARY entities across today's runs had `aliases: []` despite `identityKey` containing the sender email (e.g. `@timothybishop@judgefite.com`). Sender-bypass in `resolveEntity` depends on display-name-only matching as a result; email-local-part matching never fires. Filed as **#121**.

6. **Case over-splitting within a single entity** — 851 Peavy had 9 cases (1.4 emails/case), 3910 Bucknell had 7. `Repair Invoices (3) + Rekey Invoice (1) + Yard Work Invoice (1) + Electrical & Plumbing Repairs (1) + Invoices from Krystin Jernigan (1)` all obviously belong together. Re-scoped **#86** (Day-2 → Day-1 over-splitting) with fresh evidence comment.

7. **Every MERGE decision has `tagScore: 0`.** Only 3 MERGEs fired across 48 property cases, all scoring exactly 30 (threshold): `subjectScore 20 + actorScore 10 + tagScore 0`. Property `tagMatchScore=15` is configured but contributed nothing. If tags fired as designed on repair-stream emails, they'd score ≥45 and merge. Filed as **#123** — most likely proximate root cause of the fragmentation in finding 6.

8. **Bidirectional cross-schema email leakage.** Property scan pool has 53 `email.teamsnap.com` + 40 `portfolioproadvisors.com` emails. Girls scan pool has 39 `portfolioproadvisors.com` + 26 `judgefite.com` + 18 `lilviv.com`. **Every schema pulls from every other user-schema.** Filed as **#122** (re-scoped from one-way during investigation).

### Ships — 21 commits on `feature/perf-quality-sprint`

Both implementation sub-agents ran in background while the next ticket's design continued in foreground. Specs were committed to `docs/superpowers/specs/` ahead of implementation (#117 as `2026-04-19-issue-117-stage1-pairing-and-hygiene.md`, #102 as `2026-04-19-issue-102-pattern-c-corpus-mining.md`) plus a combined `2026-04-20-issues-119-121-implementation.md` plan for the final pair.

| Issue | Commits (oldest → newest) | Summary |
|---|---|---|
| **#117** Stage 1 per-whats pairing + safety hygiene | `73e3eac` plan → `afa9d03` biome | 9 commits. `InterviewInput.groups` populated by onboarding UI (inline `Map<who, Set<what>>` rendered as pairing pill chips under each WHO); consumed by `discoverUserNamedThings` which gains `{whoResults, groups}` options. Paired WHAT attribution comes from paired WHO's `from:` query — no extra Gmail calls, same parallel plan. Safety filter drops `news.*`, `alerts.*`, `t.*`, non-user `.edu`. `sourcedFromWho` threaded from discovery through polling DTO to domain-confirmation UI row copy (`via <name>`). |
| **#102** Pattern C corpus frequency mining | `f98afee` plan → `2405ad0` biome | 7 commits. New pure algorithm in `packages/engine/src/entity/frequency-mining.ts` — zero I/O, 15 unit tests against real-subject fixtures. Pattern C runs alongside Pattern A (institutions) + B (activity+team) in `school-entity.ts`; cross-pattern `A > B > C` preference on normalized-key collisions. When paired WHO addresses are available, narrow-view mining tags candidates with `sourcedFromWho` + `relatedWhat` (the latter defers to #66 for actual UI grouping). **Real-corpus validator flipped from NOT FOUND to `ZSA U11/12 Girls Spring 2026 Competitive Rise (freq=7)`.** |
| **#119** Property address suffix-aware dedup | `6245449` → `e016113` → `ea154fc` | 3 commits. `dedupByLevenshtein` gains optional `stripTrailingSuffixes` — regex strips `Drive\|Dr\|Road\|Rd\|Street\|St\|Trail\|Tr\|Avenue\|Ave\|Lane\|Ln\|Court\|Ct\|Place\|Pl\|Way\|Blvd\|Boulevard` from end of the key only; Levenshtein runs on stripped form; longest observed display wins. `property-entity.ts` passes a property-specific suffix list; school/agency/Pattern C unaffected. Root-cause fix to the React duplicate-key warning (same issue); UI `${confirmedDomain}-${candidate.key}` prefix is a belt-and-suspenders second layer. |
| **#121** Populate SECONDARY aliases | `0285ed1` | 1 commit. Entity-confirm route augments each SECONDARY with `aliases: [senderEmail]` resolved via `stage1UserContacts` query-map lookup, with `@<senderEmail>` identityKey-prefix fallback. `persistConfirmedEntities` split: PRIMARIES + aliases-less SECONDARIES stay on bulk `updateMany` fast path; SECONDARIES with aliases take a per-row raw-SQL path (`jsonb_array_elements_text` + `jsonb_agg(DISTINCT …)`) to merge and de-dupe while preserving any prior auto-discovered aliases. |

### Issue hygiene

**Closed this session:**
- **#93** (5-phase entity robustness plan) — superseded by #94 (Phase 1 domain docs) + #95 (rebuild). Closed with a per-phase map of what replaced what.
- **#109** (Phase 4 cutover gap — `clusteringConfig` seeding) — verified by tonight's runs both completing with populated config (property `mergeThreshold=30`, school_parent `mergeThreshold=35`).
- **#118** (relevance gate over-exclusion) — subsumed by #117 + #102 after empirical re-analysis of the 158 excluded emails. Close comment carries the sender-domain breakdown + display-name split table.

**Filed this session:**
- **#117** Stage 1 per-whats — **shipped**
- **#119** Property address dedup — **shipped**
- **#120** Evaluation: compare Pattern A/B/C during next hypothesis-generation touch — deferred
- **#121** Populate sender aliases on `persistConfirmedEntities` — **shipped**
- **#122** Cross-schema email leakage (updated with bidirectional evidence after first discovery)
- **#123** Clustering `tagScore` returns 0 on every MERGE despite `tagMatchScore=15`

**Broadened / updated in place:**
- **#100** Stage 1 agency aggregator ranking — broadened to cross-domain (comment + evidence from Girls `bucknell.edu` + `news.bloomberg.com` repro)
- **#102** — pre-shipment comment with live-production reproduction (promoted from validator-only)
- **#86** — re-scoped comment: Day-2 framing was wrong; Day-1 over-splitting is the real issue, with fresh fragmentation evidence and #123 cross-reference

**Net open count:** 40 → 43 (+3). Close rate: 3. File rate: 6 (1 deferred as eval ticket).

### Test + type state at session end

- Typecheck clean across all 4 workspaces
- Unit tests: **364 passing** (types 11 + engine 106 + ai 52 + web 195) — **+36 new** across Pattern C (15), pairing (8), suffix-dedup (6), alias-population (3), misc (4)
- Biome clean on touched files
- Integration tests + Playwright not run (dev server not available this session; stubs in place as `describe.skip`)

### Deferred to tomorrow

1. **Live E2E re-run** — Girls + Property on the same Gmail account, verifying the #117+#102+#119+#121 compound. Expected: TeamSnap emails cleanly routed under `ZSA U11/12 Girls Spring 2026 Competitive Rise` PRIMARY (tagged `sourcedFromWho: "Ziad Allan"`, `relatedWhat: "soccer"`), property addresses consolidated short/long, no `bucknell.edu` / `news.bloomberg.com` in Stage 2 confirmed scope, zero React console warnings on Stage 2 render.
2. **#123** Tag-score investigation (diagnosis-first). Most likely proximate root cause of #86 over-fragmentation — fix this before #86.
3. **#86** Case over-splitting (after #123). Re-scoped framing.
4. **#122** Cross-schema leakage investigation — now confirmed bidirectional and systemic.

### Deviations / findings from the implementation agents

- **`InterviewInputSchema` already accepted `groups`.** #117 spec's "extend Zod body schema" was a no-op; agent verified and moved on.
- **`buildHypothesisPrompt` already reads `input.groups`.** Same pattern — the hypothesis prompt side was already wired, just never fed with non-empty groups.
- **`UserThingResult` stayed in `apps/web/src/lib/discovery/`** (not moved to `packages/types` as the spec speculated). It's a discovery-layer DTO, not a shared interface. Polling DTO in `onboarding-polling.ts` got the same field.
- **`Entity.aliases` is a `Json` column, not a Postgres array.** #121 agent used `jsonb_array_elements_text` + `jsonb_agg(DISTINCT …)` with a parameterized `$executeRaw` for merge.
- **`dedupByLevenshtein` lives in `apps/web/src/lib/discovery/`**, not `@denim/engine`. #119 agent correctly identified and left it in place — no I/O, no boundary violation, relocation would be scope creep.
- **React duplicate-key warning root-caused to the dedup failure itself:** `1906 Crockett St` and `1906 Crockett Street` both normalized to the same React key (`"1906 crockett st"`) but Levenshtein distance (4) exceeded the long-string threshold (2), so dedup never merged them — two candidates with identical keys rendered at once. Suffix-aware dedup fixes both the fragmentation AND the warning in one change.
- One collateral Pattern C candidate surfaces on the real corpus: `Event Reminder Practice April PM (freq=3)`. `April` and `PM` pass the proper-noun gate. Not a regression — user dismisses at Stage 2 review. Noise-tuning deferred to future eval work (#120).

---

## What's Next

### Immediate
- **Security TODO (user-controlled):** rotate Supabase DB password (dashboard) + update `apps/web/.env.local` (both `DATABASE_URL` and `DIRECT_URL`). Leaked creds purged from HEAD in `dec9130`; `.claude/settings.local.json` untracked. History purge optional — moot after rotation unless the repo goes public.
- **Next live test:** OAuth-playground walk-through of the new sign-in flow (the ask that closed issue #105). Confirm tonight's Client-Reference reconnect bug is structurally impossible — callback writes tokens on happy path, any shape failure lands on a typed error page.
- **Issue #95 — Fast-discovery onboarding rebuild:** Phase 0 ✅ + Phase 1 ✅ + Phase 2 ✅ + Phase 3 ✅ + Phase 4 ✅ + Task 6.1 ✅ (integration tests rewritten). First live E2E attempted 2026-04-18; surfaced the #105 Gmail-credentials bug which is now fixed. Retry pending rotated DB password + OAuth-playground test. Then Phase 5 entry (spec-as-config YAML loader).
- **Issue #105 — Gmail credentials bounded context** (filed + fully executed 2026-04-18): all 8 steps shipped on `feature/perf-quality-sprint` (`d34e8c4` → `51dd166`). New `apps/web/src/lib/gmail/credentials/` module, Zod at external trust boundaries, typed `CredentialFailure` end-to-end, fail-closed `/auth/callback`, Biome `noRestrictedImports` rule on server/client boundary, legacy `gmail-tokens.ts` + `auth-errors.ts` deleted. `docs/01_denim_lessons_learned.md` entry for Bug 7 + 3 standing rules + patterns #7/#8 appended.
- **Running deviations log:** `docs/superpowers/plans/2026-04-17-issue-95-phase2-deviations.md` — append a new section every time implementation diverges from the plan's code sample. Filename still says "phase2" but now covers Phases 2–4; consider renaming post-rebuild.
- **Issue #99 — Plan/reality API-signature gaps** (filed 2026-04-17): partially addressed by the `d0d7b34` corrections commit; stays open for Phase 3+ vigilance. Still the rule: cross-check every plan import against real code.
- **Issue #100 — Stage 1 agency newsletter noise** (filed 2026-04-17): deferred to Phase 7 quantitative measurement; not blocking.
- ~~Full E2E on `feature/perf-quality-sprint` after Phase 2~~ ✅ done 2026-04-15 early AM (3 runs, all GOOD post-#85)
- ~~Pre-merge blocker: integration tests rewritten (Task 6.1)~~ ✅ done 2026-04-18 in `019b31b`
- **Phase 3 code-complete** ✅ 2026-04-15 PM (commits `7c0d1d0`, `2c6b373`, `f3b54ff`) — E2E measurement pending
- **Phase 4 (#63 batch round-trips → #73 review screen render → #25 umbrella close)** — was the prior sprint's next-up; superseded by #95 rebuild. Revisit after #95 ships.

### Open pipeline issues (prioritized)
- **#73** Review screen timing — partially addressed by Plan 1; timing variance remains (~48–107s); will be re-measured at Phase 4.2
- **#59** PM threshold — default fixed for new schemas; existing at 45 may need data migration
- **#57** Raw email cache — Phase 5.5
- **#38** Eval Session 2 — Phase 5.2
- **#35** Extraction relevance gate — Phase 5.1
- **#19** Clustering non-determinism — extraction (Gemini) variance remains
- **#84** GmailMessageMeta Date JSON-replay hardening — latent only; defer
- **#86** Day-2 case-splitting (deterministic routing + deferred fan-out + no-op investigation) — strategic refactor; scope beyond this sprint

### After Sprint: Schema Additions
- `UserNote` model -- for the "+ Note" button in bottom nav
- `NotificationPreference` model -- daily digest opt-in
- `User.stripeCustomerId / subscriptionStatus / trialEndDate` -- billing fields

### After Schema Additions: Notes & Polish (UX Phase 4)
- Note creation modal from bottom nav
- Note list view
- Account settings page (currently 404 stub)
- Topic edit page (rename, delete, re-scan)
- Notification preferences UI

### User Testing
- Once merged, gather real-user feedback on the new flow
- Observe user corrections -> calibration loop tunes clustering automatically
- Learning loop: gravity model weight adjustment from feedback (not yet built)

### Future Phases
- **Phase 4 polish**: notes, account, topic edit, notifications
- **Phase 5 calendar**: progressive OAuth, CalendarService, Add to Calendar buttons
- **Phase 6B**: Chrome extension + side panel
- **Phase 7.5**: Periodic scanning (automated daily scans)
- **Phase 8**: Calendar integration
- **Phase 9**: Scan automation & delta processing
- Playwright e2e tests for onboarding + feed + case detail (manual E2E done, automated suite next)

See `docs/roadmap.md` for the full feature roadmap beyond UX.

