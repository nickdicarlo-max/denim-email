# Case Engine Roadmap

Last updated: 2026-04-01

---

## In Progress

- [ ] UX overhaul (branch: feature/ux-overhaul)
  - **Phase 1: Performance + routing foundation** — READY TO BUILD (no designs needed)
    - Smart root redirect (`/` → `/feed` or `/onboarding` or `/welcome`)
    - New route structure (`/feed`, `/feed/[caseId]`, `/settings/topics/*`)
    - `loading.tsx` skeletons for instant perceived load
    - Bottom nav component (Feed / + Note / Settings)
    - Parallel data queries for feed performance
  - **Phase 2: Case Feed UX** — BLOCKED on Stitch designs
  - **Phase 3: New User Flow** — BLOCKED on Stitch designs
  - Phase 4: Notes & Settings
  - Phase 5: Calendar & Polish
- [ ] Stitch screen designs (user working on these — see `docs/stitch-screen-briefs.md`)

## Near-term

- [ ] Schema additions — UserNote, NotificationPreference models; User.stripe* billing fields
- [ ] Re-scan / incremental sync (new emails after initial scan)
  - Delta scan: query Gmail for emails newer than lastFullScanAt
  - Dedup against existing Email records (gmailMessageId uniqueness)
  - Re-synthesis for cases that receive new emails

## Product Features

- [ ] Chrome Extension side panel (Phase 6B)
  - chrome.identity for Google OAuth
  - Gmail context detection: "Organize this" from current email
  - Deep link from case detail to Gmail thread
  - Narrow viewport (400-500px) optimizations, swipe gestures
- [ ] Periodic scanning — automated scans at set times (7am, noon, 3pm, 6pm, 9pm) so users see actionable updates throughout the day
- [ ] Calendar sync for CaseActions
  - Progressive OAuth: request calendar.events scope only on first "Add to Calendar" tap
  - One-way sync: action → calendar event (never reads back)
  - RRULE for recurring events, "Synced" indicator on actions
  - Update/delete calendar events when action changes
- [ ] Email move / exclude corrections UI
- [ ] Case merge UI
- [ ] Entity resolution review — pause pipeline when emails have null entityId, show review UI, resume after user assigns entities
- [ ] Developer/admin dashboard — per-schema quality drill-down, email-level clustering debug, export metrics
- [ ] Case co-pilot (AI assistant for case context)
- [ ] Multi-schema support (user manages multiple case schemas)

## Quality & Testing

- [ ] Gravity model learning loop — feedback corrections adjust clustering weights, tag scores, entity confidence
- [ ] Playwright e2e tests for interview flow + case feed
- [ ] Graceful degradation tests: synthesis failure shows email subjects, quality failure hides metric bar, token refresh failure prompts re-auth, Gemini invalid JSON skips email

## Monetization

- [ ] Stripe integration (subscriptions, billing portal)
- [ ] Google Pay as Stripe payment method (seamless for Google-signed-in users)
- [ ] Pricing tiers / usage limits
- [ ] Free tier definition

## Production Readiness

- [ ] Remove `prompt: "consent"` from Google OAuth (production mode)
- [ ] Error monitoring (Sentry or similar)
- [ ] Production logging / observability
- [ ] CORS lockdown for production origins
- [ ] Rate limiting on AI-heavy endpoints
- [ ] Account deletion cascade (all user data)

## Security / Compliance

- [ ] SOC 2 Type I readiness
- [ ] Google CASA Tier 2 assessment
- [ ] CSP headers
- [ ] SRI for extension scripts

## Scale

- [ ] Redis caching for schema configs
- [ ] Inngest-routed AI calls with global concurrency limits
- [ ] Gmail batch API requests
- [ ] Per-user AI cost budgets
