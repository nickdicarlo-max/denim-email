# Case Merging — Experiment Findings & Lessons Learned

Date: 2026-04-01

## Background

The gravity model clusters emails into cases using deterministic scoring:
```
finalScore = (threadScore + subjectScore + tagScore + actorScore) x timeDecay
if finalScore >= mergeThreshold → MERGE, else → CREATE
```

Prior to this work, the model had no `tagScore` — it relied solely on threadId, subject similarity (Jaro-Winkler), and sender entity matching. This experiment tested whether adding tag-based scoring and/or AI-suggested parameter tuning could improve clustering quality.

## The Three Approaches Tested

### Set A: Gravity model with default params (baseline)
The existing deterministic model. No tag scoring.

### Set B: AI intelligence groups (gold standard)
Claude reads all extracted emails and groups them by content comprehension. Expensive (one Claude call per schema) but represents the "ideal" clustering.

### Set C: AI-calibrated gravity model
Claude suggests parameter overrides (mergeThreshold, subjectMatchScore, etc.) based on email patterns. Gravity model re-run with those overrides.

### Set D: Gravity model with tag scoring (new feature)
Same gravity model but with `tagMatchScore` added — Jaccard similarity of extracted tag sets between email and case.

## Experiment Results

Tested across 7 schemas (5 school_parent, 2 property), 50-170 emails each.

### Agreement with AI groups (higher = better)

| Schema | Emails | A (baseline) | C (AI-tuned) | D (tags) | C delta | D delta |
|---|---|---|---|---|---|---|
| March 23 Soccer | 50 | 39.8% | 39.8% | **52.7%** | 0.0pp | **+12.9pp** |
| Girls Activities 2 | 56 | 56.3% | 56.3% | **61.0%** | 0.0pp | **+4.7pp** |
| Girls Activities Mar 21 | 51 | 56.8% | **65.6%** | **60.9%** | +8.9pp | **+4.1pp** |
| Kids Activities | 48 | 75.1% | 70.5% | 66.3% | -4.5pp | -8.7pp |
| Soccer/StAgnes/etc | 51 | 62.3% | 58.4% | 59.0% | -3.9pp | -3.3pp |
| North 40 Property | 170 | 87.0% | 87.0% | 87.0% | 0.0pp | 0.0pp |
| Property Management | 82 | 88.1% | 88.1% | 88.1% | 0.0pp | 0.0pp |

### Case counts

| Schema | A (baseline) | B (AI ideal) | C (AI-tuned) | D (tags) |
|---|---|---|---|---|
| March 23 Soccer | 39 | 3 | 38 | **18** |
| Girls Activities 2 | 45 | 9 | 44 | **21** |
| Girls Activities Mar 21 | 41 | 8 | 23 | **16** |
| Kids Activities | 20 | 8 | 12 | 15 |
| Soccer/StAgnes/etc | 25 | 7 | 16 | 15 |
| North 40 Property | 74 | 12 | 68 | 74 |
| Property Management | 23 | 9 | 23 | 23 |

## Key Findings

### 1. The gravity model had ZERO merges before tag scoring

The first three schemas (39, 45, 41 cases) had literally zero MERGE decisions. Every email created its own case. Root cause: TeamSnap and similar platforms create new Gmail threads for each notification. With no shared threadId, the model falls back to subject similarity + sender affinity = max 30 points, below the 35 threshold.

Tag scoring added 27-30 merges per schema, cutting case counts roughly in half.

### 2. AI parameter tuning (Set C) adds marginal value

Across 7 schemas, Set C improved agreement in only 1, hurt in 2, and had no effect in 4. The most common AI suggestion — increasing `timeDecayFreshDays` from 60 to 90 — has zero effect because time decay isn't the bottleneck. Claude can't meaningfully reason about Jaro-Winkler thresholds or Jaccard similarities.

**Recommendation: Don't wire clustering intelligence into the pipeline as a parameter tuning step.**

### 3. Tag scoring helps most when the gravity model was completely failing

The three schemas where tag scoring helped most (March 23 Soccer, Girls Activities 2, Girls Activities Mar 21) all had zero merges in baseline. Tag scoring enabled the first merges.

The two schemas where tag scoring slightly hurt (Kids Activities, Soccer/StAgnes) already had merges working — tag scoring over-merged by adding points for generic shared tags like "Schedule".

### 4. Property schemas are unaffected by tag scoring

Property emails share generic tags ("Financial", "Maintenance", "Tenant") across unrelated cases (different properties). Tag Jaccard similarity is high between all property emails regardless of which property they're about. The discriminating signal for property cases is the **address in the subject line**, not tags.

### 5. The gravity model structurally cannot match AI groupings

Even with tag scoring at 25, the best agreement was 61% (vs AI's ideal groupings). The gravity model fundamentally cannot read email content and understand that "New event: Practice" and "Event Reminder: Practice, February 4, 6:00 PM" are about the same thing. It can only match on threadId, subject string similarity, sender identity, and tag overlap.

Case splitting (the post-clustering AI pass) is what bridges this gap. Tag scoring gets the model closer to reasonable coarse clusters; case splitting refines them.

## What Claude Actually Uses to Group Emails

Analysis of AI grouping features across all schemas revealed a consistent hierarchy:

### Level 1: Entity (primary partition)
Every AI group has 88-100% entity purity. Entity already works in the gravity model.

### Level 2: Tags (sub-entity split)
Within the same entity, tags discriminate ~70% of sub-groups:
- Soccer: "Practice" tag vs "Game/Match" tag
- St Agnes: "Schedule" tag vs "Payment" tag
- Lanier: "Schedule" tag vs "Payment" tag

Tags fail when they're too generic (e.g., "Financial" on every property email).

### Level 3: Subject keywords (remaining splits)
The hardest sub-entity splits rely on specific tokens in the subject:
- Property: address tokens ("3910 Bucknell", "851 Peavy")
- Same-tag splits: activity keywords ("practice" vs "foundation repair")

This is NOT Jaro-Winkler similarity — it's keyword overlap. The gravity model's subject scoring uses Jaro-Winkler on the full subject string, which fails because "New event: Practice" and "Event Reminder: Practice, February 4" have low full-string similarity even though they share the keyword "practice."

## Decision: Ship tagMatchScore at 15

At `tagMatchScore: 15`:
- Tag Jaccard of 0.5 contributes 7.5 points — only triggers merges when combined with actor affinity (10) AND subject similarity
- Prevents the over-merging seen at 25 in the Kids Activities schema
- Still enables merges in zero-merge schemas (tag 7.5 + actor 10 + subject ~10 = 27.5, plus time decay could push over 35 for very similar emails)

This is the shipped default as of 2026-04-01.

## What NOT to Build

1. **Clustering intelligence as a pipeline step** — AI parameter tuning doesn't help enough to justify the cost and latency. The prompt and test scripts are useful as diagnostic tools, not production pipeline steps.

2. **Discriminator-weighted tag scoring** — Tags like "Practice" should score higher than "Schedule" because they're more discriminating. This is what the calibration step's discriminator vocabulary is for. Don't build it into the gravity model yet — wait for user feedback data.

3. **Subject keyword matching** — Replacing Jaro-Winkler with keyword overlap would help property cases (address matching) but risks over-merging elsewhere. Case splitting already handles this.

## What IS Built (for future reference)

| Artifact | Location | Purpose |
|---|---|---|
| `tagScore()` function | `packages/engine/src/clustering/scoring.ts` | Jaccard tag similarity scoring |
| `tagMatchScore` config param | `packages/types/src/schema.ts` (ClusteringConfig) | Configurable tag weight |
| `tags` on ClusterCaseInput | `packages/types/src/schema.ts` | Cases track their tag set |
| `tagScore` in ScoreBreakdown | `packages/types/src/schema.ts` | Audit trail for tag scoring |
| Clustering intelligence prompt | `packages/ai/src/prompts/clustering-intelligence.ts` | Rewritten with real formula, today param |
| Intelligence parser | `packages/ai/src/parsers/clustering-intelligence-parser.ts` | Fixed field names |
| Experiment script | `scripts/test-clustering-intelligence.ts` | A/B/C/D comparison runner |
| Feature analysis script | `scripts/analyze-ai-groups.ts` | Analyzes what features AI uses per group |
| Experiment results | `pipeline_intelligence` table (stage: `clustering-intelligence-experiment-v2`) | Stored per schema |

## Future Work: When to Revisit

- **When calibration runs accumulate feedback** — discriminator vocabulary can weight tags by informativeness, making tag scoring smarter without changing the gravity model
- **When a new domain type has poor clustering** — run the experiment scripts to diagnose whether the problem is tag quality, subject similarity, or a structural limitation
- **If case splitting becomes a bottleneck** — tag scoring at higher weights could reduce the number of coarse clusters that need AI splitting, saving Claude calls
