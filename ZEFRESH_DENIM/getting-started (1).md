# Getting Started: Project Setup

## Your Current State

Local folder: `Documents/NDSoftware/denim-email/`
Files already in place: CLAUDE.md, .gitignore, docs/, prisma/, getting_started.md, README.md

## 1. Create the GitHub Repo and Connect

```bash
cd ~/Documents/NDSoftware/denim-email

# Initialize git if not already done
git init

# Create the new repo on GitHub (pick one method):

# Option A: GitHub CLI (if you have gh installed)
gh repo create nickdicarlo-max/denim-email --public --source=. --remote=origin

# Option B: Create on github.com first, then connect
#   1. Go to github.com/new
#   2. Name: denim-email
#   3. Don't initialize with README (you already have one)
#   4. Then run:
git remote add origin https://github.com/nickdicarlo-max/denim-email.git

# Push what you have
git add .
git commit -m "Initial project documentation and design specs"
git branch -M main
git push -u origin main
```

## 2. Verify Your File Structure

Before starting Claude Code, confirm your docs/ folder has all the design files:

```
denim-email/
  CLAUDE.md                     # Claude Code project context (repo root)
  README.md                     # Repo readme
  .gitignore                    # Already configured for the stack
  getting_started.md            # This file
  docs/
    build-plan.md               # 9-phase build plan with acceptance criteria
    schema-design-notes.md      # Database design decisions
    interview-to-schema-mapping.md  # Interview inputs -> schema fields
    alignment-audit.md          # Cross-reference audit
    design-system.md            # Design principles and component patterns
    design-tokens.ts            # Design tokens (copied to packages/types/tokens.ts in Phase 0)
    prototypes/                 # (optional) UI prototypes for reference
      case-engine-prototype.jsx
      interview-prototype.jsx
    case-schema-template.xlsx   # Scenario planning spreadsheet
  prisma/
    schema.prisma               # Database schema (will move to apps/web/prisma/ during Phase 0)
```

If any docs are missing from docs/, copy them in now before starting Phase 0.

## 3. Open Claude Code

```bash
cd ~/Documents/NDSoftware/denim-email
claude
```

## 4. Phase 0 Prompt

Paste this into Claude Code:

---

Read CLAUDE.md first (architecture, engineering practices, scalability, security).
Then read docs/build-plan.md Phase 0 carefully, including the "Post-Phase 0: Supabase Setup" and "Database Migration Note" sections.

Execute all Phase 0 tasks (0.1 through 0.20) from the build plan. The repo already has documentation files in docs/ and a prisma/schema.prisma file. Build the application structure around what exists.

Key points:
- This is not a throwaway prototype. Set up engineering infrastructure properly.
- Three packages: @denim/types (interfaces), @denim/engine (pure logic), @denim/ai (prompts/parsers). All with ZERO I/O.
- Auth middleware (withAuth), structured logger, CORS, error handler -- build these as reusable infrastructure in Phase 0. Every subsequent phase depends on them.
- Event registry (packages/types/events.ts) defines all Inngest event types upfront.
- Vitest, Playwright, Biome, and GitHub Actions CI must all be configured and passing.

Do NOT set up Supabase Auth yet (we need credentials first).
Do NOT install AI SDKs yet (Phase 1).

After all Phase 0 tasks, verify every item in the Phase 0 Acceptance Criteria section of build-plan.md.

Commit as "Phase 0: Project scaffolding" and push to origin main.

---

## 5. After Phase 0: Set Up Supabase

Follow the "Post-Phase 0: Supabase Setup" section in docs/build-plan.md:

1. Create Supabase project, get credentials
2. Add all env vars to apps/web/.env.local
3. Run `pnpm --filter web prisma db push` to create tables
4. **Enable RLS on ALL tables** (see build plan for specific policies)
5. Enable Google OAuth provider in Supabase Auth dashboard
6. Verify auth flow works

**Do not proceed to Phase 1 without RLS enabled and tested.**

## 6. Phase 1 Prompt

After Supabase is connected, RLS enabled, and tables created:

---

Read docs/build-plan.md Phase 1 and docs/interview-to-schema-mapping.md carefully.

Execute all Phase 1 tasks (1.1 through 1.7) from the build plan. This is the most important phase. The core question: can our AI interview produce a CaseSchema good enough to cluster emails effectively?

Key points:
- The prompt template and Zod parser live in packages/ai (pure, no I/O). The API call lives in apps/web/src/lib/services/ (I/O layer). Do not mix these.
- Use the AI client wrapper from Phase 0 (src/lib/ai/client.ts) for Claude calls. Never call the API directly.
- Use the structured logger from Phase 0 for all service logging.
- Use withAuth middleware on the API route.
- Write parser unit tests BEFORE running the evaluation script.
- The build plan has the full TypeScript interfaces for SchemaHypothesis -- implement them exactly.

After parser tests pass, run the evaluation script (task 1.7) and show me the results from docs/test-results/phase1-schema-quality.md so we can evaluate schema quality together.

Do NOT build the interview UI yet. Do NOT build Gmail integration yet.

---

## 7. Subsequent Phase Prompts

For Phases 2-9, follow this pattern:

---

Read docs/build-plan.md Phase [N]. Execute all tasks for this phase.

Follow all cross-cutting requirements from the build plan:
- Use structured logger for all service methods
- Use withAuth on all API routes
- Validate all inputs with Zod
- Use AI client wrapper for all external API calls
- Write integration tests as specified in the phase
- Use Inngest concurrency keys on all background jobs
- Follow single writer principle (see CLAUDE.md table ownership map)

After completing all tasks, verify every item in the phase's Acceptance Criteria.

---

## Notes

- CLAUDE.md stays at repo root. Claude Code reads it automatically every session.
- docs/build-plan.md is the SINGLE SOURCE OF TRUTH for phase tasks. These prompts reference it rather than duplicating it.
- Update CLAUDE.md "Current Status" section as you complete each phase.
- Each phase should be its own commit with a descriptive message.
- Test results in docs/test-results/ get committed as documentation.
- .env.local files are never committed.
