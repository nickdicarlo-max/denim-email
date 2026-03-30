# Case Engine Roadmap

Last updated: 2026-03-25

---

## Near-term

- [ ] Card 4 UX improvements (group visualization, discovered entity assignment)
- [ ] Merge upgrade/major-deps-2026 branch to main
- [ ] Schema ACTIVE state transition (onboarding -> active, enables re-scan)
- [ ] Re-scan / incremental sync (new emails after initial scan)

## Product Features

- [ ] Chrome Extension side panel (Phase 6 per build plan)
- [ ] Case co-pilot (AI assistant for case context)
- [ ] Calendar sync for CaseActions
- [ ] Email move / exclude corrections UI
- [ ] Case merge UI
- [ ] Gravity Model Learning loop (feedback corrections adjust clustering weights, tag scores, entity confidence)
- [ ] Multi-schema support (user manages multiple case schemas)

## Monetization

- [ ] Stripe integration (subscriptions, billing portal)
- [ ] Google Pay as Stripe payment method (seamless for Google-signed-in users)
- [ ] Pricing tiers / usage limits
- [ ] Free tier definition

## Production Readiness

- [ ] Remove `prompt: "consent"` from Google OAuth (production mode)
- [ ] Playwright e2e tests for interview flow + case feed
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
