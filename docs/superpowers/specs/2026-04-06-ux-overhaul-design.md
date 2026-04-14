# UX Overhaul Design Spec

**Date:** 2026-04-06
**Branch:** `feature/ux-overhaul`
**Spec source:** `docs/stitch-design-specs.md` (canonical product spec)
**Design system:** `DESIGN.md` (The Digital Curator — visual tokens)

---

## 1. What This Changes

Rearchitect the Denim frontend from a developer-facing dashboard into a mobile-first product experience. The backend pipeline, Prisma schema, and Inngest jobs are untouched. This is a UI/routing/API-layer change only.

**Before:** Single-page interview state machine (`/interview`), per-schema case feed (`/dashboard/[schemaId]/cases`), no bottom nav, developer dashboard aesthetic.

**After:** 5-step onboarding flow with separate routes (`/onboarding/*`), cross-topic case feed (`/feed`), persistent bottom navigation (Feed / +Note / Settings), editorial "Digital Curator" design.

---

## 2. Route Architecture

### New Routes

| Route | Screen | Type | Auth |
|---|---|---|---|
| `/` | Landing page | Server | No |
| `/onboarding/category` | O1: Pick a Category | Client | Yes |
| `/onboarding/names` | O2: Things + People | Client | Yes |
| `/onboarding/connect` | O3: Connect Gmail | Client | Yes |
| `/onboarding/scanning` | O4: Scanning Your Inbox | Client | Yes |
| `/onboarding/review` | O5: Review What We Found | Client | Yes |
| `/feed` | R1: Case Feed | Server+Client | Yes |
| `/feed/[caseId]` | R3: Case Detail | Server+Client | Yes |
| `/settings` | S1: Settings Hub | Client | Yes |
| `/settings/topics` | S2: Topic List | Server+Client | Yes |

### Routes to Remove (after migration verified)

| Old Route | Replaced By |
|---|---|
| `/interview` | `/onboarding/*` (5 routes) |
| `/dashboard` | `/feed` (smart redirect) |
| `/dashboard/[schemaId]` | `/settings/topics` (schema management) |
| `/dashboard/[schemaId]/cases` | `/feed` (cross-topic) |
| `/dashboard/[schemaId]/cases/[caseId]` | `/feed/[caseId]` |

### Auth Redirect Logic (`/`)

```
Authenticated + has schemas → /feed
Authenticated + no schemas → /onboarding/category
Unauthenticated → landing page
```

---

## 3. Onboarding Flow

### State Persistence Across Routes

Each onboarding route reads/writes to `sessionStorage` under namespaced keys:

```
denim_onboarding_category  → { role, domain }
denim_onboarding_names     → { whats: string[], whos: string[] }
denim_onboarding_schemaId  → string (set after hypothesis generation)
```

If a user navigates to `/onboarding/names` without category data, redirect to `/onboarding/category`.

### O1: Pick a Category (`/onboarding/category`)

- 6 category cards (emoji + label + description), full width stacked
- "Something Else" shows text input: "Describe what you track in a sentence." Free text stored as `customDescription` and passed to hypothesis generation. Domain is set to `general`.
- On select + Continue → save to sessionStorage → navigate to `/onboarding/names`
- **Data written:** `{ role, domain, customDescription? }` to sessionStorage
- **Data consumed by pipeline:** Role determines `DOMAIN_CONFIGS` entry → generates `clusteringConfig`, `summaryLabels`, `secondaryEntityConfig`, `SchemaTag` rows, `ExtractedFieldDef` rows

### O2: Things + People (`/onboarding/names`)

- Context badge at top showing selected category (tappable → back to O1)
- **Section 1: Things (required)** — text input + accent-colored chips. Min 1 to proceed.
- **Section 2: People (optional)** — text input + teal-toned chips. 0 is fine.
- No entity groups. No goals. Flat lists only.
- On Continue → save to sessionStorage → navigate to `/onboarding/connect`
- **Data written:** `{ whats: string[], whos: string[] }` to sessionStorage
- **Data consumed by pipeline:** WHATs → `Entity` rows (PRIMARY). WHOs → `Entity` rows (SECONDARY). AI generates aliases, discovery queries, entity type labels.

### O3: Connect Gmail (`/onboarding/connect`)

- Large "Connect Gmail" CTA button
- 3 trust signals below (read-only, encrypted, topic-scoped)
- On connect → OAuth redirect → callback stores tokens → triggers hypothesis generation
- On hypothesis complete → **auto-trigger full pipeline** (scan + extract + cluster + synthesize)
- Navigate to `/onboarding/scanning`
- **Pipeline trigger:** After hypothesis, emit `scan.emails.discovered` to start Inngest pipeline. Set `CaseSchema.status = ONBOARDING`.

### O4: Scanning Your Inbox (`/onboarding/scanning`)

- Progress bar + "Found N relevant emails" counter
- Discovered senders streaming in (staggered fade-in animation)
- Subject pattern chips appearing
- Polls `/api/schemas/[schemaId]/status` every 2s for pipeline progress
- **Enhancement needed:** Add discovered entity names to poll response so they can stream in. Currently `ScanJob` has aggregate counts but not individual discovery names.
- Auto-transitions to O5 when `ScanJob.status = COMPLETED`
- No skip button

### O5: Review What We Found (`/onboarding/review`)

- **Section 1:** For each user-entered Thing, show a card with:
  - Thing name (bold)
  - Auto-detected aliases below with email counts
  - "Not right? Separate" link per alias
- **Section 2:** New discoveries (entities found that don't match user input):
  - Name + email count
  - "Add" / "Add to [Thing]" / "Not now" buttons
- **Section 3:** Topic name (pre-filled, editable)
- "Show me my cases!" CTA → finalizes schema → redirects to `/feed`
- **Data source:** `Entity` rows for this schema (join on `autoDetected`, `confidence`, `emailCount`). `CaseSchema.name` for topic name.
- **API:** `POST /api/interview/finalize` (existing, may need minor adjustments for flat input shape)

---

## 4. Returning User Experience

### Global: Bottom Navigation

Persistent on every authenticated route. Three items:

| Label | Icon | Route | Notes |
|---|---|---|---|
| Feed | `dynamic_feed` | `/feed` | Primary screen |
| + Note | `add_circle` | (modal/sheet) | Creates user note (future: `UserNote` table) |
| Settings | `settings` | `/settings` | Topic management |

Implemented as a layout component in `/app/(authenticated)/layout.tsx`.

### R1: Case Feed (`/feed`)

**The primary screen.** All returning users land here.

**Header (sticky):** "Denim" wordmark left, user avatar right.

**Filter bar (horizontally scrollable):**
- "All" chip (default, always first, filled accent when active)
- One chip per user-created topic, using the **topic's actual name** from `CaseSchema.name` (e.g., "Girls Activities Test 2", "Property - 1501 Sylvan") -- NOT generic category labels
- When a topic is selected, entity sub-chips appear below with case counts (e.g., "Soccer (24)", "Dance (12)")
- Selected chip is filled accent color. Unselected is muted surface.

**Default view is ALL cases from ALL topics, unfiltered.** Topic chips narrow the view.

**Filtering must be instantaneous (client-side):**
- The API returns ALL active cases across all topics in a single load (most users have <100 active cases)
- Topic/entity chip taps filter the already-loaded data client-side -- no network round-trip
- Urgency grouping is computed client-side from the loaded data
- "Load more" pagination only needed for users with 100+ active cases (rare at MVP scale)

**Case cards grouped by urgency tier:**
1. "Focus Now" -- IMMINENT urgency
2. "This Week" -- THIS_WEEK urgency
3. "Upcoming" -- UPCOMING urgency
4. Past/resolved -- collapsed behind "Show past cases" toggle

**Empty states (3 variants):**
- Pipeline running: "Your cases are being prepared..."
- All caught up: "All caught up! Nothing needs your attention."
- No topics: "Welcome to Denim." + CTA to `/onboarding/category`

**API: `GET /api/feed`**
- Returns ALL active cases across all user schemas in one response (no pagination by default)
- Includes schema metadata per case: `schemaId`, `schemaName` (the user's topic name)
- Includes entity list per schema for sub-chip rendering
- Sorted by urgency tier then lastEmailDate desc
- Excludes IRRELEVANT urgency
- Optional `includeResolved=true` param for "Show past cases"
- Optional `cursor` + `limit` for large accounts (100+ cases)

### R2: Case Card (component)

**5 lines maximum. Scannable in 2 seconds.**

```
Line 1: [emoji] Entity Name              [mood] [unread dot]
Line 2: Case Title (truncated to 1 line)
Line 3: Context line (domain-aware, muted)
Line 4: ☐ Top action item                    [+N more]
Line 5:                          Mar 15 – 16d active
```

**Line 3 (context) varies by domain:**
- Kids/School: event date + time + location
- Property: vendor + cost + deadline
- Fallback: due date + cost if present

**Left border colors:**
1. Gold (`#D4A373`) = celebratory mood (overrides urgency)
2. Red (`#E27D60`) = imminent/urgent
3. Amber (`#D97706`) = this week
4. Green (`#186967`) = upcoming
5. Gray (`#E4E2DF`) = no action / resolved

**Interactions:** Tap card → case detail. Tap checkbox → mark action done (API call).

### R3: Case Detail (`/feed/[caseId]`)

7 sections, server-rendered with client interactions:

1. **Header** — emoji, entity, title, mood, status, attribution, dates, staleness warning
2. **3-part summary** — domain-specific labels from `CaseSchema.summaryLabels`
3. **Key details** — dynamic grid from `Case.aggregatedData` + `ExtractedFieldDef`
4. **Tags** — 2-3 accent pills from `Case.displayTags`
5. **Actions** — full list with type icons, checkboxes, due dates, reminder counts
6. **Emails** — expandable rows with reply/attachment indicators
7. **Feedback** — thumbs up/down, correction options, alternative case suggestion

### R4: Loading Skeleton (component)

Shimmer placeholder matching exact card dimensions. Used in feed while data loads.

---

## 5. Settings

### S1: Settings Hub (`/settings`)

3 tappable rows: My Topics, Add a Topic, Account.

### S2: Topic List (`/settings/topics`)

Card per schema showing: emoji + name, stats (entities/cases/emails), active since date, edit/delete buttons.

"Saved for later" prompt if onboarding discoveries were deferred.

---

## 6. New API Endpoints

### `GET /api/feed`

Cross-topic case feed. Returns ALL active cases in one response for instant client-side filtering.

**Query params:**
- `includeResolved` (default false) -- for "Show past cases" toggle
- `cursor` (optional) -- pagination for large accounts (100+ cases)
- `limit` (optional, default: no limit for active cases) -- only used with cursor

Note: `schemaId` and `entityId` filtering happens **client-side** on the already-loaded data. The API does not accept these as query params -- this ensures instant filter switching without network round-trips.

**Response:**
```typescript
{
  data: {
    cases: FeedCaseData[],  // all active cases across all topics
    schemas: {
      id: string,
      name: string,           // user's topic name (e.g., "Girls Activities Test 2")
      domain: string,         // category for domain-aware rendering
      caseCount: number,
      entities: { id: string, name: string, caseCount: number }[],
    }[],
  }
}
```

`FeedCaseData` extends the current `CaseCardData` with `schemaId`, `schemaName`, and `schemaDomain` so the client can filter and render domain-aware context without additional lookups.

**Query:** Join `Case` -> `CaseSchema` -> `User`, filter by userId, exclude IRRELEVANT urgency, order by urgency tier then lastEmailDate desc.

### `GET /api/schemas/[schemaId]/status` Enhancement

Add `recentDiscoveries` field to the poll response:

```typescript
{
  // existing fields...
  recentDiscoveries: {
    entities: { name: string, emailCount: number }[],   // last 10 discovered
    subjectPatterns: string[],                            // common subject keywords
  }
}
```

Source: query `Entity` rows where `autoDetected = true` and `createdAt > scanJob.startedAt`.

---

## 7. Components to Create

| Component | Location | Purpose |
|---|---|---|
| `BottomNav` | `components/nav/bottom-nav.tsx` | Persistent 3-item bottom navigation |
| `AuthLayout` | `app/(authenticated)/layout.tsx` | Wraps all auth'd routes with bottom nav |
| `DomainContextLine` | `components/cases/domain-context-line.tsx` | Domain-aware line 3 for case cards |
| `OnboardingProgress` | `components/onboarding/progress.tsx` | Step indicator for onboarding |
| `ScanStream` | `components/onboarding/scan-stream.tsx` | Streaming discoveries for O4 |
| `ReviewEntities` | `components/onboarding/review-entities.tsx` | Entity review cards for O5 |
| `FeedHeader` | `components/feed/feed-header.tsx` | Sticky header with wordmark + avatar |
| `TopicChips` | `components/feed/topic-chips.tsx` | Scrollable topic filter chips |
| `UrgencySection` | `components/feed/urgency-section.tsx` | Tier label + card group |
| `FeedEmptyState` | `components/feed/empty-state.tsx` | 3-variant empty state |
| `CaseDetailView` | `components/cases/case-detail-view.tsx` | Full 7-section case detail |
| `ActionCheckbox` | `components/cases/action-checkbox.tsx` | Tappable action item with API call |
| `EmailRow` | `components/cases/email-row.tsx` | Expandable email row |
| `FeedbackSection` | `components/cases/feedback-section.tsx` | Thumbs + correction options |

---

## 8. Components to Remove (after migration)

| Component | Reason |
|---|---|
| `dashboard/schema-card.tsx` | Replaced by settings/topics |
| `dashboard/schema-card-list.tsx` | Replaced by settings/topics |
| `dashboard/scan-progress.tsx` | Replaced by O4 scan stream |
| `dashboard/scan-trigger.tsx` | Moved to settings/topics |
| `cases/metric-bar.tsx` | Removed per spec (no quality bar in feed) |
| `cases/clustering-debug.tsx` | Dev tool, not user-facing |

---

## 9. Data Model Changes

### No schema changes required

All data needed by the new screens already exists in the Prisma schema. Specifically:
- `Case.emoji`, `Case.mood` — exist, used for card line 1
- `Case.aggregatedData` + `ExtractedFieldDef` — exist, used for R3 key details
- `CaseAction.eventStartTime`, `eventLocation`, `amount` — exist, used for domain context line
- `CaseAction.reminderCount` — exists, used for reminder indicator
- `Entity.autoDetected`, `aliases`, `emailCount` — exist, used for O5 review
- `CaseSchema.summaryLabels` — exists, used for R3 summary section labels

### Future addition (not blocking)

`UserNote` table for the "+ Note" bottom nav action. This is logged for future implementation — the button can show a "Coming soon" state or a simple modal for now.

---

## 10. Onboarding Data Flow (Simplified)

Current `card1-input.tsx` collects: role, domain, whats, whos, groups, sharedWhos, goals.

New flow collects: role, domain (O1) → whats, whos (O2). That's it.

**What's removed from user input:**
- Entity groups (AI/scan can infer)
- Goals (hardcode reasonable defaults per domain)
- Shared WHOs (all WHOs are shared by default)

**Impact on `InterviewService`:**
- `generateHypothesis()` receives `{ role, domain, whats, whos }` instead of full input
- No `groups` parameter → don't create `EntityGroup` rows during hypothesis
- No `goals` parameter → use domain defaults for `ExtractedFieldDef.showOnCard` and action priorities
- The `onNext` contract from O2 is simpler: `{ role, domain, whats, whos }`

**Impact on `useInterviewFlow` hook:**
- Replace with per-route sessionStorage reads. The state machine is no longer needed because each route is its own step.
- Hypothesis generation moves to O3 (after Gmail connect, before scan).
- Finalization moves to O5 (after review).

---

## 11. Testing Strategy

### Preserved (no changes needed)

All 10 unit test files (81 tests) in `@denim/types`, `@denim/ai`, `@denim/engine` are unaffected. They test pure functions with no UI dependency.

The `exclusion.test.ts` service unit test is also unaffected.

### Preserved but may need adaptation

**Integration tests (11 files, ~50 tests):**

These test the pipeline services (extraction, clustering, synthesis, feedback, interview). The pipeline is unchanged, but two integration tests touch the interview input shape:

| Test File | Impact | Action |
|---|---|---|
| `interview.test.ts` | Uses `InterviewInput` with groups/goals | Update test fixtures to use flat `{ role, domain, whats, whos }` |
| `entity-groups.test.ts` | Tests group creation during interview | Keep test but verify groups are created by AI/scan, not user input |
| All other integration tests | No impact | No changes |

### New tests needed

| Test | Type | What |
|---|---|---|
| `/api/feed` endpoint | Integration | Cross-topic query, filtering, pagination, urgency grouping |
| O1→O5 onboarding flow | E2E (Playwright) | Full onboarding with OAuth mock, pipeline mock |
| Case card interactions | E2E (Playwright) | Tap checkbox marks action done, card navigates to detail |
| Bottom nav routing | E2E (Playwright) | Feed/Settings navigation works |

### E2E test update

Current `home.test.ts` checks title "Case Engine". Update to check for "Denim" branding + auth redirect behavior.

---

## 12. Implementation Waves

### Wave 1: Foundation + Onboarding (O1-O5)

**Files:** 5 new page routes, onboarding components, sessionStorage persistence, simplified `InterviewService` input.

**Verification:** Complete onboarding flow creates a valid `CaseSchema` with entities, tags, and triggers the pipeline. Existing integration tests pass with updated fixtures.

### Wave 2: Feed + Case Detail (R1-R4)

**Files:** New `/api/feed` endpoint, feed page, case card rewrite, case detail rewrite, bottom nav, auth layout.

**Verification:** Feed shows cases from all topics. Case detail displays all 7 sections. Action checkbox works. Existing case data renders correctly.

### Wave 3: Settings + Cleanup

**Files:** Settings hub, topic list, old route removal, test updates, E2E tests.

**Verification:** Can add second topic via settings. Can delete topic. Old routes removed without breaking. All tests pass.

---

## 13. Files Changed Summary

| Category | Files | Action |
|---|---|---|
| New pages | 7 (5 onboarding + feed + feed/[caseId]) | Create |
| New pages (settings) | 2 | Create |
| New API | 1 (`/api/feed`) | Create |
| API update | 1 (`/api/schemas/[schemaId]/status`) | Modify |
| New components | ~14 | Create |
| Updated components | ~6 (case-card, filter-tabs, etc.) | Modify |
| Layout | 1 (authenticated layout with bottom nav) | Create |
| Service | 1 (InterviewService input simplification) | Modify |
| Hook | 1 (useInterviewFlow → remove, replace with per-route) | Remove |
| Tests (update) | 2 integration tests | Modify fixtures |
| Tests (new) | 1 integration + 3-4 E2E | Create |
| Old pages (remove) | 5 (interview, dashboard/*) | Delete (Wave 3) |
| Old components (remove) | ~6 | Delete (Wave 3) |
