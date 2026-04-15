---
name: supabase-db
description: Run SQL queries, wipe data, inspect tables, and manage the Supabase PostgreSQL database for denim-email. Use when the user asks to query the DB, check row counts, wipe data, debug data issues, or run any database operation.
user_invocable: true
---

# Supabase Database Operations

> **Project-specific skill** — these connection details, URLs, and workarounds are specific to the denim-email Supabase instance. Do not apply to other projects.

This project uses Supabase PostgreSQL via **Prisma 7 with driver adapters**. The MCP Supabase plugin is NOT connected — it will return permission errors. All DB access goes through Prisma or raw SQL via the pooled connection.

## Critical Rules

1. **Always run from `apps/web/`** — Prisma client and dotenv are installed there, not at project root.
2. **Always use the pooler URL** (port 6543 via `DIRECT_URL` env var) — the direct URL (port 5432) is blocked from this machine.
3. **Never use `prisma db push`** — it hangs on this setup. Apply schema changes via raw SQL with `$executeRawUnsafe()` instead.
4. **Table names are snake_case in SQL** but PascalCase in Prisma (e.g., `case_schemas` in SQL = `prisma.caseSchema`). Join table: `case_emails` in SQL, `prisma.caseEmail` in Prisma.
5. **Prisma 7 needs the PrismaPg driver adapter** — `new PrismaClient()` alone fails with `Cannot find module '.prisma/client/default'`. Always construct with `{ adapter: new PrismaPg({...}) }`.
6. **`node -e` + `require('@prisma/client')` does NOT work** here — use `npx tsx <<'SCRIPT' … SCRIPT` heredoc with ESM imports instead.
7. **Output via `process.stderr.write()`** — stdout is sometimes swallowed inside tsx on Windows.

## Command Template

All database commands follow this pattern — run from **project root**:

```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && npx tsx <<'SCRIPT' 2>&1
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });

// YOUR QUERY HERE — prefer Prisma typed API, fall back to $queryRawUnsafe for joins

await p.$disconnect();
SCRIPT
```

## Common Operations

### Query: typed API (preferred for single-table reads)

```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && npx tsx <<'SCRIPT' 2>&1
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });

const n = await p.caseSchema.count();
process.stderr.write(`CaseSchema count: ${n}\n`);

await p.$disconnect();
SCRIPT
```

### Query: raw SQL with joins (use snake_case table names)

```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && npx tsx <<'SCRIPT' 2>&1
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });

// Use snake_case table names: case_emails, case_schemas, scan_jobs, etc.
// Use double-quoted camelCase COLUMN names: "schemaId", "caseId", "senderDisplayName", etc.
const rows = await p.$queryRawUnsafe(`
  SELECT e.id, e.subject, c.title
  FROM emails e
  LEFT JOIN case_emails ce ON ce."emailId" = e.id
  LEFT JOIN cases c ON c.id = ce."caseId"
  WHERE e."schemaId" = $1
  LIMIT 10
`, '<SCHEMA_ID>');
process.stderr.write(JSON.stringify(rows, null, 2) + '\n');

await p.$disconnect();
SCRIPT
```

### Query: list all tables (useful when memory of names is stale)

```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && npx tsx <<'SCRIPT' 2>&1
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const rows = await p.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
process.stderr.write(JSON.stringify(rows) + '\n');
await p.$disconnect();
SCRIPT
```

### Wipe: delete all data (FK-safe order)

```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && npx tsx <<'SCRIPT' 2>&1
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const tables = [
  ['CaseAction', () => p.caseAction.deleteMany()],
  ['CaseEmail',  () => p.caseEmail.deleteMany()],
  ['Cluster',    () => p.cluster.deleteMany()],
  ['Case',       () => p.case.deleteMany()],
  ['ExtractionCost',   () => p.extractionCost.deleteMany()],
  ['EmailAttachment',  () => p.emailAttachment.deleteMany()],
  ['Email',            () => p.email.deleteMany()],
  ['FeedbackEvent',    () => p.feedbackEvent.deleteMany()],
  ['QualitySnapshot',  () => p.qualitySnapshot.deleteMany()],
  ['ScanFailure',      () => p.scanFailure.deleteMany()],
  ['PipelineIntelligence', () => p.pipelineIntelligence.deleteMany()],
  ['ScanJob',          () => p.scanJob.deleteMany()],
  ['ExclusionRule',    () => p.exclusionRule.deleteMany()],
  ['ExtractedFieldDef',() => p.extractedFieldDef.deleteMany()],
  ['SchemaTag',        () => p.schemaTag.deleteMany()],
  ['Entity',           () => p.entity.deleteMany()],
  ['EntityGroup',      () => p.entityGroup.deleteMany()],
  ['OnboardingOutbox', () => p.onboardingOutbox.deleteMany()],
  ['CaseSchema',       () => p.caseSchema.deleteMany()],
  ['User',             () => p.user.deleteMany()],
] as const;
for (const [name, fn] of tables) {
  const r = await fn();
  process.stderr.write(`  ${name}: ${r.count} deleted\n`);
}
process.stderr.write('Done. All tables empty.\n');
await p.$disconnect();
SCRIPT
```

### Schema Push: apply a DDL change (use raw SQL, not `prisma db push`)

```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && npx tsx <<'SCRIPT' 2>&1
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const p = new PrismaClient({ adapter });
const r = await p.$executeRawUnsafe(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS new_col TEXT`);
process.stderr.write(`Done: ${r}\n`);
await p.$disconnect();
SCRIPT
```

Then regenerate the client so the new field is typed:
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && pnpm --filter web prisma generate
```

## Table Reference (FK-safe delete order)

Delete children before parents:
1. CaseAction, CaseEmail, Cluster
2. Case
3. ExtractionCost, EmailAttachment
4. Email
5. FeedbackEvent, QualitySnapshot, ScanFailure, PipelineIntelligence, ScanJob
6. ExclusionRule, ExtractedFieldDef
7. SchemaTag, Entity
8. EntityGroup
9. OnboardingOutbox
10. CaseSchema
11. User

## Column naming gotchas (SQL)

- Tables: `snake_case` (`case_emails`, `scan_jobs`, `onboarding_outbox`)
- Columns: `camelCase` wrapped in double quotes (`"schemaId"`, `"caseId"`, `"senderDisplayName"`, `"routingDecision"`)
- JSONB access: `"routingDecision"->>'method'` for text, `->'detectedEntities'` for nested JSON

## Troubleshooting

- **`Cannot find module '.prisma/client/default'`** — you used `node -e` + `require()`. Switch to the `npx tsx <<'SCRIPT'` template above.
- **`relation "caseEmails" does not exist`** — you used Prisma's camelCase model name in raw SQL. Use `case_emails` (snake_case plural) instead.
- **`Can't reach database server at port 5432`** — you pointed at the direct URL. Use `DIRECT_URL` from `apps/web/.env.local` (which resolves to the pooler, port 6543).
- **`Cannot find module 'dotenv'`** — you're not running from `apps/web/`. Always `cd` there first.
- **`Cannot find module '@prisma/client'`** — run `pnpm --filter web prisma generate` first.
- **Interactive `prisma db push` hangs** — known issue on this setup. Use `$executeRawUnsafe()` or a migration.
