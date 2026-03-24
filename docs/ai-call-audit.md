# AI Call Audit — Pipeline API Map

Last updated: 2026-03-24

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
- **Parser:** ⚠️ Raw `JSON.parse` — NO Zod validation
- **Input:** Domain, entity groups, top 30 senders, social graph clusters (10 co-recipients each), 15 body samples (300-char), existing queries
- **Output:** relevantQueries, excludeDomains, reasoning
- **Today's date:** NO
- **Truncation:** 30 senders, 10 co-recipients, 300-char body, 15 body samples max
- **Issues:**
  - **Missing Zod validation** — malformed AI response crashes or fails silently
  - No today's date

### 4. Email Extraction (`gemini-2.5-flash`, thinking disabled)
- **Where:** `apps/web/src/lib/services/extraction.ts` → `extractEmail`
- **Prompt:** `packages/ai/src/prompts/extraction.ts` → `buildExtractionPrompt(email, schema)`
- **Parser:** `packages/ai/src/parsers/extraction-parser.ts` (Zod ✓)
- **Input:** Full email (subject, sender, date, FULL body, isReply) + schema context (tags, entities with aliases and [USER-INPUT]/[DISCOVERED] labels, entity groups with scoring rubric, fields, exclusion patterns)
- **Output:** summary, tags, extractedData, detectedEntities, relevanceScore (0-1), relevanceEntity
- **Today's date:** NO ⚠️
- **Truncation:** None (full email body sent)
- **Issues:**
  - **No today's date** — Gemini can't distinguish recent from old emails when assessing relevance
  - Full body with no limit could hit token limits on very long emails

### 5. Case Splitting (`claude-sonnet-4-6`)
- **Where:** `apps/web/src/lib/services/cluster.ts` → `aiCaseSplit`
- **Prompt:** `packages/ai/src/prompts/case-splitting.ts` → `buildCaseSplittingPrompt(input)`
- **Parser:** `packages/ai/src/parsers/case-splitting-parser.ts` (Zod ✓)
- **Input:** Domain, coarse clusters (entityName, emailCount, top 20 freq words, 30 email samples with id/subject/summary), correction history (20), learned vocabulary
- **Output:** cases (title, discriminators, emailIds, reasoning), catchAllEmailIds
- **Today's date:** NO ⚠️
- **Truncation:** 20 freq words, 30 email samples, 20 corrections
- **Issues:**
  - **No today's date** — Claude can't distinguish past events from upcoming when deciding how to group
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
  - **Frequency tables are hardcoded empty `{}`** (cluster.ts ~line 1124) — prompt has section for them but data never passed
  - Correction payload spread without sanitization

### 7. Case Synthesis (`claude-sonnet-4-6`)
- **Where:** `apps/web/src/lib/services/synthesis.ts` → `synthesizeCase`
- **Prompt:** `packages/ai/src/prompts/synthesis.ts` → `buildSynthesisPrompt(emails, schema, today)`
- **Parser:** `packages/ai/src/parsers/synthesis-parser.ts` (Zod ✓)
- **Input:** All case emails (id, subject, sender, date, summary, tags, isReply) + schema context (summaryLabels, tags, entities, fields) + today's date
- **Output:** title (60 chars), 3-part summary, displayTags (0-5), primaryActor, actions (with dates/types/amounts), status, urgency
- **Today's date:** YES ✓
- **Truncation:** None (all emails)
- **Issues:** None — best-configured call

### NOT USED: Clustering Intelligence
- **Files:** `packages/ai/src/prompts/clustering-intelligence.ts`, `packages/ai/src/parsers/clustering-intelligence-parser.ts`
- Exported but never imported by any service. Was designed for pre-cluster AI review but pipeline uses coarse clustering + AI case splitting instead.

## Summary Table

| # | Stage | Model | Today's Date? | Input Truncation | Zod Parser? |
|---|---|---|---|---|---|
| 1 | Interview Hypothesis | claude-sonnet-4-6 | NO | None | ✓ |
| 2 | Interview Validation | claude-sonnet-4-6 | NO | 100 samples, 120-char snippets | ✓ |
| 3 | Discovery Intelligence | claude-sonnet-4-6 | NO | 30 senders, 10 co-recip, 300-char body | ⚠️ NO |
| 4 | Email Extraction | gemini-2.5-flash | NO ⚠️ | None (full body) | ✓ |
| 5 | Case Splitting | claude-sonnet-4-6 | NO ⚠️ | 20 words, 30 samples, 20 corrections | ✓ |
| 6 | Clustering Calibration | claude-sonnet-4-6 | NO | 50 corrections, freq tables empty | ✓ |
| 7 | Case Synthesis | claude-sonnet-4-6 | YES ✓ | None (all emails) | ✓ |

## Prioritized Issues

### HIGH
1. **Extraction (call 4) missing today's date** — Gemini scores relevance without knowing what "now" is

### MEDIUM
2. **Case Splitting (call 5) missing today's date** — Claude groups past/future events without temporal context
3. **Discovery Intelligence (call 3) missing Zod validation** — runtime safety gap

### LOW
4. **Calibration (call 6) empty frequency tables** — learning loop gets incomplete data
5. **Extraction sends full body** — potential token limit issue on very long emails
