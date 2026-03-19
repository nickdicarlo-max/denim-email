---
name: supabase-db
description: Run SQL queries, wipe data, inspect tables, and manage the Supabase PostgreSQL database for denim-email. Use when the user asks to query the DB, check row counts, wipe data, debug data issues, or run any database operation.
user_invocable: true
---

# Supabase Database Operations

> **Project-specific skill** — these connection details, URLs, and workarounds are specific to the denim-email Supabase instance. Do not apply to other projects.

This project uses Supabase PostgreSQL via Prisma ORM. The MCP Supabase plugin is NOT connected — it will return permission errors. All DB access goes through Prisma or raw SQL via the pooled connection.

## Critical Rules

1. **Always run from `apps/web/`** — Prisma client and dotenv are installed there, not at project root.
2. **Always use the pooler URL** (port 6543) — the direct URL (port 5432) is blocked/unreachable from this machine.
3. **Never use `prisma db push`** — it hangs on this setup. Use raw SQL via `$queryRawUnsafe()` or `$executeRawUnsafe()` for schema changes, or apply migrations.
4. **Table names are snake_case in SQL** but PascalCase in Prisma (e.g., `case_schemas` in SQL = `prisma.caseSchema`).

## Command Template

All database commands follow this pattern — run from **project root**:

```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && node -e "
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// YOUR QUERY HERE

prisma.\$disconnect();
" 2>&1
```

## Common Operations

### Query: Count rows in a table
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && node -e "
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.caseSchema.count().then(n => { console.log('CaseSchema count:', n); return prisma.\$disconnect(); });
" 2>&1
```

### Query: Run raw SQL
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && node -e "
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$queryRaw\`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename\`
  .then(r => { console.log(JSON.stringify(r, null, 2)); return prisma.\$disconnect(); })
  .catch(e => { console.error('FAILED:', e.message); process.exit(1); });
" 2>&1
```

### Query: Inspect a schema with relations
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && node -e "
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.caseSchema.findMany({
  include: { entities: true, tags: true, entityGroups: { include: { entities: true } } }
}).then(r => { console.log(JSON.stringify(r, null, 2)); return prisma.\$disconnect(); })
  .catch(e => { console.error('FAILED:', e.message); process.exit(1); });
" 2>&1
```

### Query: Row counts across all tables
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && node -e "
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function counts() {
  const tables = ['user','caseSchema','entity','entityGroup','schemaTag','extractedFieldDef','exclusionRule','email','emailAttachment','case_','caseEmail','caseAction','cluster','scanJob','extractionCost','feedbackEvent','qualitySnapshot'];
  for (const t of tables) {
    const model = t === 'case_' ? 'case' : t;
    try {
      const n = await prisma[model].count();
      console.log('  ' + model + ': ' + n);
    } catch(e) { console.log('  ' + model + ': ERROR ' + e.message.slice(0,50)); }
  }
  await prisma.\$disconnect();
}
counts();
" 2>&1
```

### Wipe: Delete all data (FK-safe order)
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && node -e "
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function wipe() {
  console.log('Wiping all data in FK-safe order...');
  const tables = [
    ['CaseAction', () => prisma.caseAction.deleteMany()],
    ['CaseEmail', () => prisma.caseEmail.deleteMany()],
    ['Cluster', () => prisma.cluster.deleteMany()],
    ['Case', () => prisma.case.deleteMany()],
    ['ExtractionCost', () => prisma.extractionCost.deleteMany()],
    ['EmailAttachment', () => prisma.emailAttachment.deleteMany()],
    ['Email', () => prisma.email.deleteMany()],
    ['FeedbackEvent', () => prisma.feedbackEvent.deleteMany()],
    ['QualitySnapshot', () => prisma.qualitySnapshot.deleteMany()],
    ['ScanJob', () => prisma.scanJob.deleteMany()],
    ['ExclusionRule', () => prisma.exclusionRule.deleteMany()],
    ['ExtractedFieldDef', () => prisma.extractedFieldDef.deleteMany()],
    ['SchemaTag', () => prisma.schemaTag.deleteMany()],
    ['Entity', () => prisma.entity.deleteMany()],
    ['EntityGroup', () => prisma.entityGroup.deleteMany()],
    ['CaseSchema', () => prisma.caseSchema.deleteMany()],
    ['User', () => prisma.user.deleteMany()],
  ];
  for (const [name, fn] of tables) {
    const r = await fn();
    console.log('  ' + name + ': ' + r.count + ' deleted');
  }
  console.log('Done. All tables empty.');
  await prisma.\$disconnect();
}
wipe().catch(e => { console.error(e); process.exit(1); });
" 2>&1
```

### Migrate: Generate Prisma client after schema changes
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email && pnpm --filter web prisma generate
```

### Schema Push: Apply schema changes (use raw SQL instead of db push)
Instead of `prisma db push` (which hangs), apply schema changes via raw SQL:
```bash
cd C:/Users/alkam/Documents/NDSoftware/denim-email/apps/web && node -e "
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$executeRawUnsafe('ALTER TABLE entities ADD COLUMN IF NOT EXISTS new_col TEXT')
  .then(r => { console.log('Done:', r); return prisma.\$disconnect(); })
  .catch(e => { console.error('FAILED:', e.message); process.exit(1); });
" 2>&1
```

## Table Reference (FK-safe delete order)

Delete children before parents:
1. CaseAction, CaseEmail, Cluster
2. Case
3. ExtractionCost, EmailAttachment
4. Email
5. FeedbackEvent, QualitySnapshot, ScanJob
6. ExclusionRule, ExtractedFieldDef
7. SchemaTag, Entity
8. EntityGroup
9. CaseSchema
10. User

## Troubleshooting

- **"Can't reach database server at port 5432"** — You're using the direct URL. Switch to the pooler URL (port 6543) from `DATABASE_URL` in `apps/web/.env.local`.
- **"Cannot find module 'dotenv'"** — You're not running from `apps/web/`. Always `cd` there first.
- **"Cannot find module '@prisma/client'"** — Run `pnpm --filter web prisma generate` first.
- **`prisma db push` hangs** — Known issue. Use raw SQL via `$executeRawUnsafe()` or apply migrations.
- **Module resolution errors with tsx** — Use `node -e` with `require()` instead of `npx tsx`. The tsx resolver has path issues in this monorepo layout.
