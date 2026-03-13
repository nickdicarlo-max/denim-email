# Phase 2: Gmail Integration & Interview UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect Gmail via Supabase OAuth, build Gmail client service, sample scan for interview validation, and full Interview Cards 1-4 UI with design system integration.

**Architecture:** Supabase Auth handles Google OAuth (gmail.readonly scope requested in code). Gmail API calls use the provider_token from Supabase session. The interview UI is a multi-step form (Cards 1-4) built with React, using design tokens from `@denim/types/design-tokens.ts`. The sample scan fetches ~200 emails, classifies them lightweight, and feeds into `InterviewService.validateHypothesis()` which refines the AI hypothesis using real email data.

**Tech Stack:** Next.js 14 App Router, React 18, Tailwind CSS with design tokens, Supabase Auth, googleapis (Gmail API), Zod validation

---

## Task 1: Wire Design Tokens into Tailwind

**Files:**
- Modify: `apps/web/tailwind.config.ts`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/layout.tsx`

**Step 1: Update tailwind.config.ts to use design tokens**

```typescript
import type { Config } from "tailwindcss";
import { tailwindExtend } from "@denim/types/design-tokens";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      ...tailwindExtend,
      fontSize: {
        xs: ["11px", { lineHeight: "16px" }],
        sm: ["12px", { lineHeight: "16px" }],
        base: ["14px", { lineHeight: "20px" }],
        md: ["15px", { lineHeight: "22px" }],
        lg: ["17px", { lineHeight: "24px" }],
        xl: ["20px", { lineHeight: "28px" }],
      },
    },
  },
  plugins: [],
};
export default config;
```

**Step 2: Add DM Sans + JetBrains Mono fonts to globals.css**

Add Google Fonts import and base surface background:

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-surface text-primary font-sans antialiased;
  }
}
```

**Step 3: Update layout.tsx with font class**

Ensure the html element has the font-sans class applied (Tailwind will resolve to DM Sans via config).

**Step 4: Verify Tailwind config compiles**

Run: `pnpm --filter web dev`
Expected: Dev server starts without errors, page renders with DM Sans font and #F7F6F3 background.

**Step 5: Commit**

```bash
git add apps/web/tailwind.config.ts apps/web/src/app/globals.css apps/web/src/app/layout.tsx
git commit -m "feat: wire design tokens into Tailwind config, add DM Sans font"
```

---

## Task 2: Supabase Client Utilities

**Files:**
- Create: `apps/web/src/lib/supabase/server.ts`
- Create: `apps/web/src/lib/supabase/client.ts`

**Step 1: Create server-side Supabase client**

```typescript
// apps/web/src/lib/supabase/server.ts
import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client with service role key.
 * Use for admin operations (token storage, user management).
 * NEVER expose to client code.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase service role configuration");
  }
  return createClient(url, key);
}

/**
 * Server-side Supabase client authenticated as a specific user.
 * Pass the user's JWT from the Authorization header.
 */
export function createAuthenticatedClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
```

**Step 2: Create browser-side Supabase client**

```typescript
// apps/web/src/lib/supabase/client.ts
import { createClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client for auth flows and real-time subscriptions.
 * Uses anon key only. RLS enforces data access.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }
  return createClient(url, key);
}
```

**Step 3: Verify type-check passes**

Run: `pnpm --filter web tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/lib/supabase/server.ts apps/web/src/lib/supabase/client.ts
git commit -m "feat: add Supabase client utilities (server + browser)"
```

---

## Task 3: Gmail OAuth via Supabase Auth

**Files:**
- Create: `apps/web/src/app/api/auth/gmail/route.ts`
- Create: `apps/web/src/app/auth/callback/route.ts`
- Create: `apps/web/src/lib/gmail/tokens.ts`

**Step 1: Create Gmail OAuth initiation route**

This route returns the Supabase OAuth URL with gmail.readonly scope. The client redirects the user to this URL.

```typescript
// apps/web/src/app/api/auth/gmail/route.ts
import { createBrowserClient } from "@/lib/supabase/client";
import { NextResponse } from "next/server";

export async function GET() {
  // Note: In production this will be called from the client-side
  // using the browser Supabase client directly. This route exists
  // as a reference for the flow.
  return NextResponse.json({
    message: "Use Supabase client-side signInWithOAuth with gmail.readonly scope",
  });
}
```

The actual OAuth flow happens client-side:
```typescript
// Used in Card 2 component:
const supabase = createBrowserClient();
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    scopes: "https://www.googleapis.com/auth/gmail.readonly",
    redirectTo: `${window.location.origin}/auth/callback`,
  },
});
// data.url -> redirect user
```

**Step 2: Create auth callback route**

```typescript
// apps/web/src/app/auth/callback/route.ts
import { createAuthenticatedClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = createAuthenticatedClient("");
    // Exchange the code for a session
    // The supabase client handles this automatically when using
    // the code exchange flow
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}
```

**Step 3: Create token encryption utilities**

```typescript
// apps/web/src/lib/gmail/tokens.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY not set");
  }
  // Key must be 32 bytes for aes-256
  return Buffer.from(key, "hex");
}

export function encryptTokens(tokens: Record<string, unknown>): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(tokens);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptTokens(encrypted: string): Record<string, unknown> {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, data] = encrypted.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}
```

**Step 4: Verify type-check passes**

Run: `pnpm --filter web tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/api/auth/gmail/route.ts apps/web/src/app/auth/callback/route.ts apps/web/src/lib/gmail/tokens.ts
git commit -m "feat: Gmail OAuth via Supabase Auth + token encryption"
```

---

## Task 4: Gmail Client Service

**Files:**
- Create: `apps/web/src/lib/gmail/client.ts`
- Create: `apps/web/src/lib/gmail/types.ts`
- Modify: `apps/web/package.json` (add googleapis dependency)

**Step 1: Install googleapis**

Run: `pnpm --filter web add googleapis`

**Step 2: Create Gmail types**

```typescript
// apps/web/src/lib/gmail/types.ts
export interface GmailMessageMeta {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  senderEmail: string;
  senderDomain: string;
  senderDisplayName: string;
  recipients: string[];
  date: Date;
  snippet: string;
  isReply: boolean;
  labels: string[];
}

export interface GmailMessageFull extends GmailMessageMeta {
  body: string;
  attachmentIds: string[];
  attachmentCount: number;
}

export interface ScanDiscovery {
  domain: string;
  count: number;
  senders: string[];
  label: string;
}
```

**Step 3: Create Gmail client service**

```typescript
// apps/web/src/lib/gmail/client.ts
import { logger } from "@/lib/logger";
import { ExternalAPIError } from "@denim/types";
import { google } from "googleapis";
import type { GmailMessageFull, GmailMessageMeta, ScanDiscovery } from "./types";

/**
 * Gmail client service.
 * Wraps the Gmail API with typed methods and structured logging.
 * Uses OAuth2 tokens from Supabase provider_token.
 */
export class GmailClient {
  private gmail;

  constructor(accessToken: string) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: "v1", auth: oauth2Client });
  }

  /**
   * Search emails by Gmail query string.
   * Returns message metadata (no body).
   */
  async searchEmails(query: string, maxResults = 50): Promise<GmailMessageMeta[]> {
    const start = Date.now();
    logger.info({ service: "gmail", operation: "searchEmails", query, maxResults });

    const { data } = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });

    const messageIds = data.messages?.map((m) => m.id).filter(Boolean) as string[] ?? [];
    if (messageIds.length === 0) return [];

    // Fetch metadata in batches of 50
    const results: GmailMessageMeta[] = [];
    for (let i = 0; i < messageIds.length; i += 50) {
      const batch = messageIds.slice(i, i + 50);
      const metadataPromises = batch.map((id) =>
        this.gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Cc", "Subject", "Date", "In-Reply-To"],
        }),
      );
      const responses = await Promise.allSettled(metadataPromises);
      for (const response of responses) {
        if (response.status === "fulfilled") {
          const msg = response.value.data;
          results.push(this.parseMessageMeta(msg));
        }
      }
    }

    logger.info({
      service: "gmail",
      operation: "searchEmails.complete",
      durationMs: Date.now() - start,
      resultCount: results.length,
    });

    return results;
  }

  /**
   * Get full message including body (for extraction pipeline).
   */
  async getEmailFull(messageId: string): Promise<GmailMessageFull> {
    const { data } = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const meta = this.parseMessageMeta(data);
    const body = this.extractBody(data.payload);
    const attachmentIds = this.extractAttachmentIds(data.payload);

    return {
      ...meta,
      body,
      attachmentIds,
      attachmentCount: attachmentIds.length,
    };
  }

  /**
   * Fetch recent emails and group by sender domain.
   * Used during interview sample scan.
   */
  async sampleScan(maxResults = 200): Promise<{
    messages: GmailMessageMeta[];
    discoveries: ScanDiscovery[];
  }> {
    const start = Date.now();
    logger.info({ service: "gmail", operation: "sampleScan", maxResults });

    const messages = await this.searchEmails("", maxResults);

    // Group by sender domain
    const domainMap = new Map<string, { count: number; senders: Set<string> }>();
    for (const msg of messages) {
      const entry = domainMap.get(msg.senderDomain) ?? { count: 0, senders: new Set() };
      entry.count++;
      entry.senders.add(msg.senderDisplayName || msg.senderEmail);
      domainMap.set(msg.senderDomain, entry);
    }

    const discoveries: ScanDiscovery[] = Array.from(domainMap.entries())
      .map(([domain, data]) => ({
        domain,
        count: data.count,
        senders: Array.from(data.senders),
        label: domain,
      }))
      .sort((a, b) => b.count - a.count);

    logger.info({
      service: "gmail",
      operation: "sampleScan.complete",
      durationMs: Date.now() - start,
      messageCount: messages.length,
      uniqueDomains: discoveries.length,
    });

    return { messages, discoveries };
  }

  private parseMessageMeta(msg: any): GmailMessageMeta {
    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string): string =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

    const from = getHeader("From");
    const { email, displayName } = this.parseEmailAddress(from);
    const domain = email.split("@")[1] ?? "";
    const inReplyTo = getHeader("In-Reply-To");

    return {
      id: msg.id ?? "",
      threadId: msg.threadId ?? "",
      subject: getHeader("Subject"),
      sender: from,
      senderEmail: email,
      senderDomain: domain,
      senderDisplayName: displayName,
      recipients: this.parseRecipients(getHeader("To"), getHeader("Cc")),
      date: new Date(getHeader("Date")),
      snippet: msg.snippet ?? "",
      isReply: !!inReplyTo,
      labels: msg.labelIds ?? [],
    };
  }

  private parseEmailAddress(raw: string): { email: string; displayName: string } {
    // "John Doe <john@example.com>" -> { email: "john@example.com", displayName: "John Doe" }
    const match = raw.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      return { displayName: match[1].replace(/"/g, "").trim(), email: match[2] };
    }
    return { email: raw.trim(), displayName: "" };
  }

  private parseRecipients(to: string, cc: string): string[] {
    const all = [to, cc].filter(Boolean).join(", ");
    return all.split(",").map((r) => {
      const { email } = this.parseEmailAddress(r.trim());
      return email;
    }).filter(Boolean);
  }

  private extractBody(payload: any): string {
    if (!payload) return "";

    // Simple text body
    if (payload.mimeType === "text/plain" && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64url").toString("utf-8");
    }

    // Multipart: recurse
    if (payload.parts) {
      // Prefer text/plain, fallback to text/html
      const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
      if (textPart?.body?.data) {
        return Buffer.from(textPart.body.data, "base64url").toString("utf-8");
      }
      const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
      if (htmlPart?.body?.data) {
        return Buffer.from(htmlPart.body.data, "base64url").toString("utf-8");
      }
      // Nested multipart
      for (const part of payload.parts) {
        const body = this.extractBody(part);
        if (body) return body;
      }
    }

    return "";
  }

  private extractAttachmentIds(payload: any): string[] {
    const ids: string[] = [];
    if (!payload) return ids;

    if (payload.body?.attachmentId) {
      ids.push(payload.body.attachmentId);
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        ids.push(...this.extractAttachmentIds(part));
      }
    }
    return ids;
  }
}
```

**Step 4: Verify type-check passes**

Run: `pnpm --filter web tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/lib/gmail/client.ts apps/web/src/lib/gmail/types.ts apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat: Gmail client service with search, metadata fetch, sample scan"
```

---

## Task 5: InterviewService.validateHypothesis

**Files:**
- Modify: `apps/web/src/lib/services/interview.ts`
- Create: `packages/ai/src/prompts/interview-validate.ts`
- Create: `packages/ai/src/parsers/validation-parser.ts`
- Modify: `packages/ai/src/index.ts`
- Modify: `packages/types/src/schema.ts` (add ValidatedHypothesis type if not present)

**Step 1: Add ValidatedHypothesis type to @denim/types**

Check if `ValidatedHypothesis` already exists in `packages/types/src/schema.ts`. If not, add:

```typescript
export interface HypothesisValidation {
  confirmedEntities: string[];      // Entity names confirmed by email scan
  discoveredEntities: EntitySuggestion[]; // New entities found in email
  confirmedTags: string[];          // Tags that matched email content
  suggestedTags: TagSuggestion[];   // New tags suggested by scan data
  noisePatterns: string[];          // Sender domains that are likely noise (noreply, newsletter)
  sampleEmailCount: number;
  scanDurationMs: number;
  confidenceScore: number;          // 0-1, how well hypothesis matches real email
}
```

**Step 2: Build validation prompt in @denim/ai**

```typescript
// packages/ai/src/prompts/interview-validate.ts
import type { GmailMessageMeta, SchemaHypothesis } from "@denim/types";

export interface ValidationPromptResult {
  system: string;
  user: string;
}

export function buildValidationPrompt(
  hypothesis: SchemaHypothesis,
  emailSamples: { subject: string; senderDomain: string; senderName: string; snippet: string }[],
): ValidationPromptResult {
  // ... prompt that asks Claude to compare hypothesis against real email samples
  // Returns refined entity list, tag confirmations, discovered patterns
}
```

**Step 3: Build validation parser**

```typescript
// packages/ai/src/parsers/validation-parser.ts
// Zod schema to parse validation response
```

**Step 4: Add validateHypothesis to InterviewService**

```typescript
// In apps/web/src/lib/services/interview.ts
export async function validateHypothesis(
  hypothesis: SchemaHypothesis,
  emailSamples: GmailMessageMeta[],
  options?: { userId?: string },
): Promise<HypothesisValidation> {
  // 1. Build validation prompt with hypothesis + email samples
  // 2. Call Claude
  // 3. Parse response
  // 4. Return validation result
}
```

**Step 5: Export new modules from @denim/ai**

Update `packages/ai/src/index.ts` barrel exports.

**Step 6: Verify type-check passes**

Run: `pnpm -r tsc --noEmit`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/types/src/schema.ts packages/ai/src/prompts/interview-validate.ts packages/ai/src/parsers/validation-parser.ts packages/ai/src/index.ts apps/web/src/lib/services/interview.ts
git commit -m "feat: InterviewService.validateHypothesis with scan-based validation"
```

---

## Task 6: InterviewService.finalizeSchema

**Files:**
- Modify: `apps/web/src/lib/services/interview.ts`

**Step 1: Add finalizeSchema method**

```typescript
export async function finalizeSchema(
  hypothesis: SchemaHypothesis,
  validation: HypothesisValidation,
  userConfirmations: {
    confirmedEntities: string[];
    removedEntities: string[];
    confirmedTags: string[];
    removedTags: string[];
    addedEntities?: string[];
    addedTags?: string[];
  },
  options: { userId: string },
): Promise<string> {
  // 1. Merge hypothesis + validation + user confirmations
  // 2. Create CaseSchema row (status: ONBOARDING)
  // 3. Create Entity rows for confirmed entities
  // 4. Create SchemaTag rows for confirmed tags
  // 5. Create ExtractedFieldDef rows
  // 6. Return schemaId
}
```

**Step 2: Verify type-check passes**

Run: `pnpm --filter web tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/lib/services/interview.ts
git commit -m "feat: InterviewService.finalizeSchema persists schema to database"
```

---

## Task 7: API Routes for Interview Flow

**Files:**
- Create: `apps/web/src/app/api/interview/validate/route.ts`
- Create: `apps/web/src/app/api/interview/finalize/route.ts`
- Create: `apps/web/src/app/api/gmail/scan/route.ts`

**Step 1: POST /api/interview/validate**

Accepts: `{ hypothesis: SchemaHypothesis }` (Gmail token from session)
Calls: GmailClient.sampleScan() + InterviewService.validateHypothesis()
Returns: `{ data: HypothesisValidation }`

**Step 2: POST /api/interview/finalize**

Accepts: `{ hypothesis, validation, confirmations }`
Calls: InterviewService.finalizeSchema()
Returns: `{ data: { schemaId: string } }`

**Step 3: GET /api/gmail/scan**

Accepts: query params for scan options
Calls: GmailClient.sampleScan()
Returns: `{ data: { messages, discoveries } }`

All routes use `withAuth` wrapper.

**Step 4: Verify type-check passes**

Run: `pnpm --filter web tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/api/interview/validate/route.ts apps/web/src/app/api/interview/finalize/route.ts apps/web/src/app/api/gmail/scan/route.ts
git commit -m "feat: API routes for interview validate, finalize, and Gmail scan"
```

---

## Task 8: Shared UI Components

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/input.tsx`
- Create: `apps/web/src/components/ui/tag.tsx`
- Create: `apps/web/src/components/ui/entity-chip.tsx`
- Create: `apps/web/src/components/ui/progress-dots.tsx`
- Create: `apps/web/src/components/ui/card-shell.tsx`

Build reusable UI primitives using Tailwind classes derived from design tokens. Reference `reference/interview-prototype.jsx` for visual patterns and `docs/design-system.md` for specs.

Key component specs:
- **Button**: primary (bg-accent text-inverse), secondary (bg-card border), ghost (transparent text-accent-text). All have rounded-md, font-semibold, min 44px touch target.
- **Input**: bg-card, border-border, rounded-md, text-base. Focus: border-accent with ring.
- **Tag**: pill shape (rounded-full), bg-accent-soft/text-accent-text for normal, bg-warning-soft/text-warning-text for actionable. Size variants: sm, md.
- **EntityChip**: rounded-full, entity-primary-bg/entity-primary colors for PRIMARY, entity-secondary-bg/entity-secondary for SECONDARY. Remove button (x icon).
- **ProgressDots**: horizontal dots, current dot is wider (24px), uses accent color. 4 dots total.
- **CardShell**: bg-card rounded-lg shadow-md p-4. Used as the outer wrapper for each interview card.

**Step 1: Create all component files**

Each component is a small React component using Tailwind classes. No inline styles. Mobile-first (375px min width per design system).

**Step 2: Verify components render**

Run: `pnpm --filter web dev`
Create a temporary test page at `apps/web/src/app/test/page.tsx` that renders all components. Verify visually.

**Step 3: Remove test page, commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat: shared UI components (Button, Input, Tag, EntityChip, ProgressDots, CardShell)"
```

---

## Task 9: Interview Card 1 — Role Selection & Name Entry

**Files:**
- Create: `apps/web/src/components/interview/card1-input.tsx`
- Create: `apps/web/src/components/interview/domain-config.ts`

**Reference:** `reference/interview-prototype.jsx` Card1 component (lines 635-800+)

Card 1 has two steps:
1. **Role selection** — 6 role options (parent, property, construction, legal, agency, other). Tapping one sets the domain.
2. **Name entry** — "What" names (primary entities) and "Who" names (secondary entities), plus goal selection. Domain-specific labels and placeholders.

**Step 1: Create domain config (static data)**

```typescript
// apps/web/src/components/interview/domain-config.ts
// Export ROLE_OPTIONS and DOMAIN_CONFIGS matching the prototype
// Use design token Tailwind classes instead of inline T.* values
```

**Step 2: Create Card1 component**

```typescript
// apps/web/src/components/interview/card1-input.tsx
// React component with:
// - Step 1: Role selection grid (vertical list of role options)
// - Step 2: What/Who name entry with add/remove, goal checkboxes
// - Role badge that allows going back to step 1
// - "Continue" button enabled when at least 1 "what" name entered
// Props: onNext(data: InterviewInput)
```

Uses shared UI components from Task 8.

**Step 3: Verify Card 1 renders correctly**

Run: `pnpm --filter web dev`
Expected: Card 1 shows role selection, transitions to name entry, can add/remove names.

**Step 4: Commit**

```bash
git add apps/web/src/components/interview/
git commit -m "feat: Interview Card 1 — role selection + name entry"
```

---

## Task 10: Interview Card 2 — Gmail Connect

**Files:**
- Create: `apps/web/src/components/interview/card2-gmail-connect.tsx`

**Reference:** `reference/interview-prototype.jsx` Card2 component

Card 2 handles Gmail OAuth connection:
- Shows a "Connect Gmail" button with shield icon and privacy reassurance
- Lists what we will and won't do with email access
- On click: initiates Supabase OAuth flow with gmail.readonly scope
- After successful auth: shows connected state, transitions to Card 3
- Handles error states (user denied, OAuth error)

**Step 1: Create Card2 component**

```typescript
// apps/web/src/components/interview/card2-gmail-connect.tsx
// Props: onNext(), onBack()
// Uses createBrowserClient() for Supabase OAuth
// States: idle, connecting, connected, error
```

Key UI elements:
- Shield icon + "Your email stays private" header
- Permission list: "We read email metadata (sender, subject, date)" / "We never store email content" / "Read-only access — we can never send email"
- Primary button: "Connect Gmail"
- Loading state during OAuth redirect

**Step 2: Verify OAuth flow**

Run: `pnpm --filter web dev`, navigate to Card 2, click Connect Gmail.
Expected: Redirects to Google OAuth, returns to callback, session contains provider_token.

**Step 3: Commit**

```bash
git add apps/web/src/components/interview/card2-gmail-connect.tsx
git commit -m "feat: Interview Card 2 — Gmail OAuth connect"
```

---

## Task 11: Interview Card 3 — Sample Scan & Validation

**Files:**
- Create: `apps/web/src/components/interview/card3-scan.tsx`
- Create: `apps/web/src/hooks/use-interview-scan.ts`

**Reference:** `reference/interview-prototype.jsx` Card3 component

Card 3 runs the sample scan and validates the hypothesis:
1. **Scanning phase**: Shows progress bar, real-time sender domain discovery (e.g., "Found 34 emails from vailmountainschool.org")
2. **Validation phase**: Calls /api/interview/validate, shows "Refining your schema..."
3. **Complete**: Auto-transitions to Card 4

**Step 1: Create scan hook**

```typescript
// apps/web/src/hooks/use-interview-scan.ts
// Custom hook that:
// 1. Calls /api/gmail/scan
// 2. Calls /api/interview/validate with hypothesis + scan results
// 3. Tracks state: scanning -> validating -> complete | error
// Returns: { status, progress, discoveries, validation, error }
```

**Step 2: Create Card3 component**

```typescript
// apps/web/src/components/interview/card3-scan.tsx
// Props: hypothesis: SchemaHypothesis, onNext(validation: HypothesisValidation), onBack()
// Shows: progress animation, discovered domains rolling in, sparkle icon for AI processing
```

Key UI elements from prototype:
- Animated progress bar
- Domain discovery list (domain name + email count, appears one by one)
- "Analyzing your email patterns..." status text
- Auto-advance to Card 4 when validation complete

**Step 3: Verify scan flow**

Run: `pnpm --filter web dev`, connect Gmail, watch scan progress.
Expected: Scan completes, shows discoveries, transitions to Card 4.

**Step 4: Commit**

```bash
git add apps/web/src/components/interview/card3-scan.tsx apps/web/src/hooks/use-interview-scan.ts
git commit -m "feat: Interview Card 3 — sample scan with real-time discovery"
```

---

## Task 12: Interview Card 4 — Hypothesis Review & Finalize

**Files:**
- Create: `apps/web/src/components/interview/card4-review.tsx`

**Reference:** `reference/interview-prototype.jsx` Card4 component

Card 4 shows the AI-generated hypothesis with validation results. User can:
- Review and toggle tags (enable/disable)
- Review entities (confirm, remove, edit, add new)
- See extracted field definitions
- See clustering config highlights (human-readable)
- Approve and finalize schema

**Step 1: Create Card4 component**

```typescript
// apps/web/src/components/interview/card4-review.tsx
// Props: hypothesis: SchemaHypothesis, validation: HypothesisValidation, onFinalize(confirmations), onBack()
// Sections:
// 1. Schema name (editable)
// 2. Primary entity type description
// 3. Entities (primary + secondary, with confirm/remove/add)
// 4. Tags (toggleable, actionable highlighted)
// 5. Extracted fields (show which appear on card)
// 6. Clustering rationale (human-readable summary)
// 7. "Looks good, start organizing!" button
```

Uses Tag, EntityChip, Button, Input, CardShell components.

**Step 2: Verify Card 4 renders with fixture data**

Run: `pnpm --filter web dev`, navigate through Cards 1-3 (or use fixture data directly).
Expected: Card 4 shows hypothesis details, tags toggle, entities editable.

**Step 3: Commit**

```bash
git add apps/web/src/components/interview/card4-review.tsx
git commit -m "feat: Interview Card 4 — hypothesis review + finalize"
```

---

## Task 13: Interview Flow Page (Full Orchestration)

**Files:**
- Create: `apps/web/src/app/interview/page.tsx`
- Create: `apps/web/src/hooks/use-interview-flow.ts`

**Step 1: Create interview flow hook**

```typescript
// apps/web/src/hooks/use-interview-flow.ts
// Manages the full interview state machine:
// States: input -> generating -> gmail_connect -> scanning -> review -> finalizing -> complete
// Holds: interviewInput, hypothesis, validation, schemaId
// Actions: submitInput, connectGmail, startScan, finalize
```

**Step 2: Create interview page**

```typescript
// apps/web/src/app/interview/page.tsx
"use client";
// Renders Card 1-4 based on current step
// Handles transitions between cards
// Shows error states with retry
// On finalize: calls /api/interview/finalize, redirects to cases feed (placeholder)
```

**Step 3: Verify full flow**

Run: `pnpm --filter web dev`, go to /interview
Expected: Full Card 1 → Card 2 → Card 3 → Card 4 → finalize works end-to-end.

**Step 4: Commit**

```bash
git add apps/web/src/app/interview/page.tsx apps/web/src/hooks/use-interview-flow.ts
git commit -m "feat: full interview flow page orchestrating Cards 1-4"
```

---

## Task 14: Lint, Type-Check, Test

**Files:**
- All modified files

**Step 1: Run Biome**

Run: `pnpm biome check . --apply`
Expected: All files pass lint and format.

**Step 2: Run type-check**

Run: `pnpm -r tsc --noEmit`
Expected: PASS

**Step 3: Run existing tests**

Run: `pnpm -r test`
Expected: All 8 parser tests still pass, no regressions.

**Step 4: Run dev server and verify**

Run: `pnpm --filter web dev`
Expected: Server starts, /interview renders, full flow works.

**Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: lint and type-check fixes for Phase 2"
```

---

## Task 15: Update Status Document

**Files:**
- Modify: `docs/00_denim_current_status.md`

**Step 1: Update status doc**

Update Phase 2 as completed, list all delivered components:
- Design tokens integrated into Tailwind
- Supabase client utilities
- Gmail OAuth via Supabase Auth
- Gmail client service (search, metadata, sample scan)
- Token encryption
- InterviewService.validateHypothesis
- InterviewService.finalizeSchema
- API routes (validate, finalize, scan)
- Full Interview Cards 1-4 UI with design system
- Interview flow page

Set "Next Step" to Phase 3: Extraction Pipeline.

**Step 2: Commit**

```bash
git add docs/00_denim_current_status.md
git commit -m "docs: update status for Phase 2 completion"
```

---

## Task Dependencies

```
Task 1 (Tailwind)           ─── independent
Task 2 (Supabase clients)   ─── independent
Task 3 (Gmail OAuth)        ─── depends on Task 2
Task 4 (Gmail client)       ─── independent
Task 5 (validateHypothesis) ─── depends on Task 4 (uses GmailMessageMeta type)
Task 6 (finalizeSchema)     ─── depends on Task 5
Task 7 (API routes)         ─── depends on Tasks 3, 4, 5, 6
Task 8 (UI components)      ─── depends on Task 1
Task 9 (Card 1)             ─── depends on Task 8
Task 10 (Card 2)            ─── depends on Tasks 2, 8
Task 11 (Card 3)            ─── depends on Tasks 7, 8
Task 12 (Card 4)            ─── depends on Tasks 7, 8
Task 13 (Flow page)         ─── depends on Tasks 9, 10, 11, 12
Task 14 (Lint/test)         ─── depends on all above
Task 15 (Status doc)        ─── depends on Task 14
```

**Parallelizable groups:**
- **Group A** (Tasks 1, 2, 4): Foundation — can all run in parallel
- **Group B** (Tasks 3, 5, 8): Depends on Group A — can run in parallel after Group A
- **Group C** (Tasks 6, 9, 10): Depends on parts of Group B
- **Group D** (Tasks 7, 11, 12): API routes + scan/review cards
- **Group E** (Task 13): Flow orchestration
- **Group F** (Tasks 14, 15): Final verification
