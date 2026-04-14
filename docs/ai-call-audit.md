# AI Call Audit — Pipeline API Map

Last updated: 2026-03-31

## Complete AI Call Map

### 1. Interview Hypothesis (`claude-sonnet-4-6`)
- **Where:** `apps/web/src/lib/services/interview.ts` → `generateHypothesis`
- **Prompt:** `packages/ai/src/prompts/interview-hypothesis.ts` → `buildHypothesisPrompt(input)`
- **Parser:** `packages/ai/src/parsers/hypothesis-parser.ts` (Zod ✓)
- **Input:** User role, domain, entity groups (whats/whos), shared WHOs, goals
- **Output:** Full SchemaHypothesis (entities, tags, fields, clusteringConfig, discoveryQueries, exclusionPatterns)
- **Today's date:** NO
- **Truncation:** None
- **Issues:** None critical. Domain configs are hardcoded but cover the main use cases.

### 2. Interview Validation (`claude-sonnet-4-6`)
- **Where:** `apps/web/src/lib/services/interview.ts` → `validateHypothesis`
- **Prompt:** `packages/ai/src/prompts/interview-validate.ts` → `buildValidationPrompt(hypothesis, emailSamples)`
- **Parser:** `packages/ai/src/parsers/validation-parser.ts` (Zod ✓)
- **Input:** Hypothesis + 100 email samples (subject, senderDomain, senderName, 120-char snippet)
- **Output:** confirmedEntities, discoveredEntities (with emailCount), suggestedTags, noisePatterns, confidenceScore
- **Today's date:** NO
- **Truncation:** 100 samples, 120-char snippets
- **Issues:**
  - `confidenceScore` is ungrounded (Claude invents a float) — handling in UX design
  - No date → can't assess temporal relevance of discovered entities

### 3. Discovery Intelligence (`claude-sonnet-4-6`)
- **Where:** `apps/web/src/lib/services/discovery.ts` → `generateSmartQueries`
- **Prompt:** `packages/ai/src/prompts/discovery-intelligence.ts` → `buildDiscoveryIntelligencePrompt(input)`
- **Parser:** `packages/ai/src/parsers/discovery-intelligence-parser.ts` (Zod ✓, fixed 2026-03-24)
- **Input:** Domain, entity groups, top 30 senders, social graph clusters (10 co-recipients each), 15 body samples (300-char), existing queries
- **Output:** relevantQueries, excludeDomains, reasoning
- **Today's date:** NO
- **Truncation:** 30 senders, 10 co-recipients, 300-char body, 15 body samples max
- **Issues:**
  - ~~Missing Zod validation~~ — FIXED: full Zod parser created and used (discovery.ts line 305)
  - No today's date (low priority — discovery doesn't need temporal assessment)

### 4. Email Extraction (`gemini-2.5-flash`, thinking disabled)
- **Where:** `apps/web/src/lib/services/extraction.ts` → `extractEmail`
- **Prompt:** `packages/ai/src/prompts/extraction.ts` → `buildExtractionPrompt(email, schema)`
- **Parser:** `packages/ai/src/parsers/extraction-parser.ts` (Zod ✓)
- **Input:** Full email (subject, sender, date, FULL body, isReply) + schema context (tags, entities with aliases and [USER-INPUT]/[DISCOVERED] labels, entity groups with scoring rubric, fields, exclusion patterns)
- **Output:** summary, tags, extractedData, detectedEntities, relevanceScore (0-1), relevanceEntity
- **Today's date:** YES ✓ (fixed 2026-03-24, commit d844bd6)
- **Truncation:** Body capped at 8000 chars (fixed 2026-03-31)
- **Issues:**
  - ~~No today's date~~ — FIXED: `TODAY'S DATE: ${today}` included in system prompt
  - ~~Full body with no limit~~ — FIXED (2026-03-31): body capped at 8000 chars with truncation note
  - ~~Missing time-neutral language directive~~ — FIXED (2026-03-31): summaries must use absolute dates
  - ~~Signature noise~~ — FIXED (2026-03-31): Rule 7 ignores signatures/footers for entity detection
  - Attachment section placeholder added (ready for OCR, `ExtractionInput.attachments` optional field)

### 5. Case Splitting (`claude-sonnet-4-6`)
- **Where:** `apps/web/src/lib/services/cluster.ts` → `aiCaseSplit`
- **Prompt:** `packages/ai/src/prompts/case-splitting.ts` → `buildCaseSplittingPrompt(input)`
- **Parser:** `packages/ai/src/parsers/case-splitting-parser.ts` (Zod ✓)
- **Input:** Domain, coarse clusters (entityName, emailCount, top 20 freq words, 30 email samples with id/subject/summary), correction history (20), learned vocabulary
- **Output:** cases (title, discriminators, emailIds, reasoning), catchAllEmailIds
- **Today's date:** YES ✓ (fixed 2026-03-24, commit d844bd6)
- **Truncation:** 20 freq words, 30 email samples, 20 corrections
- **Issues:**
  - ~~No today's date~~ — FIXED: `today` passed from cluster.ts line 644
  - ✅ Fixed 2026-03-24: `assignRemainingEmails` now covers all emails, not just samples
  - ✅ Fixed 2026-03-24: Anti-fragmentation rules strengthened in prompt

### 6. Clustering Calibration (`claude-sonnet-4-6`)
- **Where:** `apps/web/src/lib/services/cluster.ts` → `applyCalibration`
- **Prompt:** `packages/ai/src/prompts/clustering-calibration.ts` → `buildClusteringCalibrationPrompt(input)`
- **Parser:** `packages/ai/src/parsers/clustering-calibration-parser.ts` (Zod ✓)
- **Input:** Current gravity model config, coarse cluster stats (entityName, emailCount, casesSplit), last 50 corrections, learned vocabulary
- **Output:** tunedConfig (mergeThreshold, scores, timeDecay), discriminatorVocabulary, reasoning
- **Today's date:** NO
- **Truncation:** 50 corrections
- **Issues:**
  - ~~Frequency tables are hardcoded empty `{}`~~ — FIXED (cluster.ts lines 1125-1188): real word frequency tables now computed from case emails with case assignment info, top 20 per entity
  - ~~Correction payload spread without sanitization~~ — FIXED (2026-03-31): corrections enriched with case titles, typed fields (no raw spread)
  - ~~No parameter bounds~~ — FIXED (2026-03-31): prompt has incremental adjustment rules + hard bounds; service clamps values as defense-in-depth
  - ~~Speculative drift on first run~~ — FIXED (2026-03-31): zero-correction guidance returns current params unchanged, focuses on discriminator vocabulary

### 7. Case Synthesis (`claude-sonnet-4-6`)
- **Where:** `apps/web/src/lib/services/synthesis.ts` → `synthesizeCase`
- **Prompt:** `packages/ai/src/prompts/synthesis.ts` → `buildSynthesisPrompt(emails, schema, today)`
- **Parser:** `packages/ai/src/parsers/synthesis-parser.ts` (Zod ✓)
- **Input:** All case emails (id, subject, sender, date, summary, tags, isReply) + schema context (summaryLabels, tags, entities, fields) + today's date
- **Output:** title (60 chars), emoji, mood, 3-part summary, displayTags (0-5), primaryActor, actions (with dates/types/amounts), status, urgency
- **Today's date:** YES ✓
- **Truncation:** Capped at 30 most recent emails (fixed 2026-03-31)
- **Issues:**
  - ~~No mood assessment~~ — FIXED (2026-03-31): mood field added (CELEBRATORY/POSITIVE/NEUTRAL/URGENT/NEGATIVE) to prompt, parser, type, and service write
  - ~~Time-neutral language missing~~ — FIXED (2026-03-31): absolute dates enforced in summaries and action titles
  - ~~No email cap~~ — FIXED (2026-03-31): capped at 30 most recent with truncation note
  - ~~summary.end lacks temporal anchor~~ — FIXED (2026-03-31): "As of [date]:" pattern in end section
  - ~~eventEndTime rarely populated~~ — FIXED (2026-03-31): explicit extraction guidance for duration/end times
  - ~~Action titles use relative dates~~ — FIXED (2026-03-31): titles must include day+date+time

### NOT USED: Clustering Intelligence
- **Files:** `packages/ai/src/prompts/clustering-intelligence.ts`, `packages/ai/src/parsers/clustering-intelligence-parser.ts`
- Exported but never imported by any service. Was designed for pre-cluster AI review but pipeline uses coarse clustering + AI case splitting instead.

## Summary Table

| # | Stage | Model | Today's Date? | Input Truncation | Zod Parser? |
|---|---|---|---|---|---|
| 1 | Interview Hypothesis | claude-sonnet-4-6 | NO | None | ✓ |
| 2 | Interview Validation | claude-sonnet-4-6 | NO | 100 samples, 120-char snippets | ✓ |
| 3 | Discovery Intelligence | claude-sonnet-4-6 | NO | 30 senders, 10 co-recip, 300-char body | ✓ (fixed) |
| 4 | Email Extraction | gemini-2.5-flash | YES ✓ (fixed) | 8000 char body cap ✓ (fixed) | ✓ |
| 5 | Case Splitting | claude-sonnet-4-6 | YES ✓ (fixed) | 20 words, 30 samples, 20 corrections | ✓ |
| 6 | Clustering Calibration | claude-sonnet-4-6 | NO | 50 corrections, freq tables ✓, bounds ✓ (fixed) | ✓ |
| 7 | Case Synthesis | claude-sonnet-4-6 | YES ✓ | 30 email cap ✓ (fixed), mood ✓ | ✓ |

## Resolved Issues (fixed in commit d844bd6, 2026-03-24)

1. ~~**Extraction (call 4) missing today's date**~~ — FIXED: `TODAY'S DATE: ${today}` in system prompt
2. ~~**Case Splitting (call 5) missing today's date**~~ — FIXED: `today` passed from cluster.ts
3. ~~**Discovery Intelligence (call 3) missing Zod validation**~~ — FIXED: full Zod parser created
4. ~~**Calibration (call 6) empty frequency tables**~~ — FIXED: real word frequency tables computed from case emails

## Remaining Issues

### ALL PREVIOUS ISSUES RESOLVED (2026-03-31)

1. ~~**Post-synthesis expiry only checks EVENT actions**~~ — FIXED: `computeCaseDecay` checks all action types (TASK, PAYMENT, DEADLINE, RESPONSE, EVENT)
2. ~~**No deterministic status decay**~~ — FIXED: `computeCaseDecay` + daily Inngest cron (6 AM ET) + read-time freshness in API
3. ~~**Time-neutral language missing from synthesis prompt**~~ — FIXED: absolute dates enforced in summaries and action titles
4. ~~**Time-neutral language missing from extraction summaries**~~ — FIXED: extraction summaries must use absolute dates
5. ~~**Extraction sends full body**~~ — FIXED: body capped at 8000 chars

### NEW (low priority)
6. **Interview hypothesis/validation have no today's date** — low impact since they don't assess temporal relevance
7. **Discovery intelligence has no today's date** — low impact since discovery doesn't need temporal assessment
8. **Validation `confidenceScore` is ungrounded** — Claude invents a float; handling in UX design
