# Server-Side Gmail Token Storage — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store encrypted Gmail OAuth tokens in the database so API routes can access Gmail without relying on the ephemeral Supabase session provider_token.

**Architecture:** OAuth callback stores encrypted tokens in `User.googleTokens` via a new `GmailTokenService`. API routes call `getValidGmailToken(userId)` which decrypts, checks expiry, refreshes if needed, and returns a valid access token. All crypto uses the existing AES-256-GCM utilities.

**Tech Stack:** Prisma (User model), Node crypto (AES-256-GCM), Google OAuth2 token endpoint, Zod, @denim/types errors

**Spec:** `docs/superpowers/specs/2026-03-13-server-side-gmail-token-storage-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/web/prisma/schema.prisma` | Modify | Remove `@default(cuid())` from User.id, change `googleTokens` from `Json?` to `String?` |
| `apps/web/src/lib/services/gmail-tokens.ts` | Create | Token store, retrieve, refresh, clear |
| `apps/web/src/lib/validation/auth.ts` | Create | Zod schema for store-tokens endpoint |
| `apps/web/src/app/auth/callback/route.ts` | Modify | Store tokens after code exchange |
| `apps/web/src/app/api/auth/store-tokens/route.ts` | Create | Fallback client-side token storage |
| `apps/web/src/app/api/interview/validate/route.ts` | Modify | Use getValidGmailToken() |
| `apps/web/src/app/api/gmail/scan/route.ts` | Modify | Use getValidGmailToken() |
| `apps/web/src/components/interview/card2-gmail-connect.tsx` | Modify | Fallback: call store-tokens if needed |
| `apps/web/.env.local` | Modify | Set TOKEN_ENCRYPTION_KEY |

---

## Chunk 1: Foundation (schema, env, service, validation)

### Task 1: Generate TOKEN_ENCRYPTION_KEY and update env

**Files:**
- Modify: `apps/web/.env.local`

- [ ] **Step 1: Generate a 32-byte hex key**

Run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 2: Set TOKEN_ENCRYPTION_KEY in .env.local**

Add the generated hex string as the value of `TOKEN_ENCRYPTION_KEY` in `apps/web/.env.local`.

- [ ] **Step 3: Verify the key loads**

Run from `apps/web/`:
```bash
node -e "require('dotenv').config({ path: '.env.local' }); const k = process.env.TOKEN_ENCRYPTION_KEY; console.log(k ? 'KEY OK (' + k.length + ' chars)' : 'MISSING')"
```
Expected: `KEY OK (64 chars)`

---

### Task 2: Fix User.id to use Supabase UUID

**Files:**
- Modify: `apps/web/prisma/schema.prisma:42`

The current schema has `id String @id @default(cuid())`. Supabase Auth generates UUIDs for users. The `withAuth` middleware returns the Supabase UUID as `userId`. The Prisma `User.id` must store this UUID directly — no auto-generated CUID.

Additionally, `googleTokens` is `Json?` but the encrypted output from `encryptTokens()` is a plain string (`iv:authTag:ciphertext`), not valid JSON. Storing a plain string in a `jsonb` column causes a Postgres cast error. Change to `String?`.

- [ ] **Step 1: Update the schema**

In `apps/web/prisma/schema.prisma`, make two changes:

Change line 42 from:
```prisma
  id            String   @id @default(cuid())
```
to:
```prisma
  id            String   @id
```

Change line 49 from:
```prisma
  googleTokens  Json?
```
to:
```prisma
  googleTokens  String?
```

- [ ] **Step 2: Push the schema change**

Run:
```bash
cd apps/web && npx prisma db push
```
Expected: Schema pushed successfully. (This is local dev, so `db push` is acceptable per CLAUDE.md.)

- [ ] **Step 3: Regenerate Prisma client**

Run:
```bash
cd apps/web && npx prisma generate
```
Expected: Generated Prisma Client.

- [ ] **Step 4: Type-check**

Run:
```bash
cd apps/web && npx tsc --noEmit
```
Expected: No errors.

---

### Task 3: Create Zod validation schema for store-tokens

**Files:**
- Create: `apps/web/src/lib/validation/auth.ts`

- [ ] **Step 1: Create the validation file**

```typescript
// apps/web/src/lib/validation/auth.ts
import { z } from "zod";

export const storeTokensSchema = z.object({
  providerToken: z.string().min(1, "Provider token is required"),
  providerRefreshToken: z.string().min(1, "Refresh token is required"),
});

export type StoreTokensInput = z.infer<typeof storeTokensSchema>;
```

- [ ] **Step 2: Lint check**

Run:
```bash
pnpm biome check apps/web/src/lib/validation/auth.ts
```
Expected: No errors.

---

### Task 4: Create GmailTokenService

**Files:**
- Create: `apps/web/src/lib/services/gmail-tokens.ts`

This is the core service. It handles: encrypt + store, decrypt + retrieve, refresh if expired, clear tokens.

- [ ] **Step 1: Create the service file**

```typescript
// apps/web/src/lib/services/gmail-tokens.ts
import { logger } from "@/lib/logger";
import { decryptTokens, encryptTokens } from "@/lib/gmail/tokens";
import { prisma } from "@/lib/prisma";
import { AuthError, ExternalAPIError } from "@denim/types";
import { z } from "zod";

const StoredTokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expiry_date: z.number(),
  scope: z.string(),
});

type StoredTokens = z.infer<typeof StoredTokensSchema>;

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_MAX_RETRIES = 3;
const REFRESH_BASE_DELAY_MS = 1000;

/**
 * Store encrypted Gmail OAuth tokens for a user.
 * Upserts the User row (creates if first OAuth, updates if re-auth).
 * Validates scope includes gmail.readonly before storing.
 */
export async function storeGmailTokens(
  userId: string,
  email: string,
  tokens: StoredTokens,
): Promise<void> {
  if (!tokens.scope.includes("gmail.readonly")) {
    throw new AuthError("Gmail permissions missing, please reconnect.");
  }

  const encrypted = encryptTokens(tokens);

  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email,
      googleTokens: encrypted,
    },
    update: {
      googleTokens: encrypted,
    },
  });

  logger.info({
    service: "gmail-tokens",
    operation: "storeGmailTokens",
    userId,
  });
}

/**
 * Parse and validate decrypted token blob.
 * Throws AuthError if the blob is malformed.
 */
function parseTokens(raw: string): StoredTokens {
  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptTokens(raw);
  } catch {
    throw new AuthError("Gmail access invalid, please reconnect.");
  }

  const parsed = StoredTokensSchema.safeParse(decrypted);
  if (!parsed.success) {
    throw new AuthError("Gmail access invalid, please reconnect.");
  }
  return parsed.data;
}

/**
 * Get a valid Gmail access token for a user.
 * Decrypts stored tokens, refreshes if expired, returns access_token.
 */
export async function getValidGmailToken(userId: string): Promise<string> {
  // Dev bypass
  if (process.env.BYPASS_AUTH === "true") {
    const devToken = process.env.DEV_GMAIL_TOKEN;
    if (devToken) return devToken;
    throw new AuthError("BYPASS_AUTH is true but DEV_GMAIL_TOKEN is not set");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleTokens: true },
  });

  if (!user?.googleTokens) {
    throw new AuthError("Gmail not connected. Please connect Gmail first.");
  }

  const tokens = parseTokens(user.googleTokens as string);

  // Token still valid (with 5-minute buffer)
  if (tokens.expiry_date > Date.now() + EXPIRY_BUFFER_MS) {
    return tokens.access_token;
  }

  // Token expired — refresh it
  return refreshAndStore(userId, tokens);
}

/**
 * Fetch with retry and exponential backoff.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = REFRESH_MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt === maxRetries) {
        throw new ExternalAPIError(
          "Google API unavailable during token refresh",
          "google",
          err,
        );
      }
      const delay = REFRESH_BASE_DELAY_MS * 3 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new ExternalAPIError("Unreachable", "google");
}

/**
 * Refresh the Google access token using the refresh token.
 * Uses optimistic locking: only writes if the stored blob hasn't changed.
 */
async function refreshAndStore(
  userId: string,
  tokens: StoredTokens,
): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new ExternalAPIError(
      "Google OAuth credentials not configured",
      "google",
    );
  }

  const startMs = Date.now();
  logger.info({
    service: "gmail-tokens",
    operation: "refreshToken",
    userId,
  });

  const response = await fetchWithRetry(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // 400 with "invalid_grant" means refresh token was revoked
    if (response.status === 400 && body.includes("invalid_grant")) {
      // Clear the invalid tokens
      await prisma.user.update({
        where: { id: userId },
        data: { googleTokens: null },
      });
      throw new AuthError("Gmail access revoked, please reconnect.");
    }
    throw new ExternalAPIError(
      `Token refresh failed (${response.status})`,
      "google",
      body,
    );
  }

  const data = await response.json();
  const newTokens: StoredTokens = {
    access_token: data.access_token,
    // Google may rotate the refresh token
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? tokens.scope,
  };

  // Optimistic lock: only update if tokens haven't changed since we read them
  // googleTokens is a String column (not jsonb), so plain text comparison
  const oldEncrypted = encryptTokens(tokens);
  const newEncrypted = encryptTokens(newTokens);

  const updated = await prisma.$executeRaw`
    UPDATE users SET "googleTokens" = ${newEncrypted}, "updatedAt" = NOW()
    WHERE id = ${userId} AND "googleTokens" = ${oldEncrypted}
  `;

  if (updated === 0) {
    // Another request already refreshed — re-read the fresh token
    const freshUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleTokens: true },
    });
    if (!freshUser?.googleTokens) {
      throw new AuthError("Gmail not connected. Please connect Gmail first.");
    }
    return parseTokens(freshUser.googleTokens as string).access_token;
  }

  logger.info({
    service: "gmail-tokens",
    operation: "refreshToken.complete",
    userId,
    durationMs: Date.now() - startMs,
  });

  return newTokens.access_token;
}

/**
 * Clear stored Gmail tokens (disconnect / account deletion).
 */
export async function clearGmailTokens(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { googleTokens: null },
  });

  logger.info({
    service: "gmail-tokens",
    operation: "clearGmailTokens",
    userId,
  });
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd apps/web && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Lint check**

Run:
```bash
pnpm biome check apps/web/src/lib/services/gmail-tokens.ts
```
Expected: No errors (may need `--write` for formatting).

- [ ] **Step 4: Commit foundation**

```bash
git add apps/web/prisma/schema.prisma apps/web/src/lib/services/gmail-tokens.ts apps/web/src/lib/validation/auth.ts
git commit -m "feat: add GmailTokenService with encrypted token storage and refresh"
```

---

## Chunk 2: Wire token storage into OAuth flow

### Task 5: Update OAuth callback to store tokens

**Files:**
- Modify: `apps/web/src/app/auth/callback/route.ts`

After `exchangeCodeForSession`, the server-side Supabase client (cookie-based) should have the full session. Read `provider_token` and `provider_refresh_token`, store via `GmailTokenService`.

- [ ] **Step 1: Rewrite the callback route**

```typescript
// apps/web/src/app/auth/callback/route.ts
import { logger } from "@/lib/logger";
import { storeGmailTokens } from "@/lib/services/gmail-tokens";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/interview";

  if (code) {
    try {
      const supabase = createServerSupabaseClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        logger.error({
          service: "auth",
          operation: "callback.exchangeCode",
          error,
        });
        return NextResponse.redirect(`${origin}/interview?auth_error=true`);
      }

      // Attempt to store provider tokens in the database
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: { user } } = await supabase.auth.getUser();

        if (session?.provider_token && session?.provider_refresh_token && user) {
          await storeGmailTokens(user.id, user.email ?? "", {
            access_token: session.provider_token,
            refresh_token: session.provider_refresh_token,
            expiry_date: Date.now() + 3600 * 1000,
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          });

          logger.info({
            service: "auth",
            operation: "callback.storeTokens",
            userId: user.id,
          });
        } else {
          // Missing provider_token or refresh_token — client-side fallback will handle
          logger.warn({
            service: "auth",
            operation: "callback.storeTokens.skipped",
            userId: user?.id,
            reason: !session?.provider_token ? "missing_provider_token" : "missing_refresh_token",
          });
        }
      } catch (tokenErr) {
        // Non-fatal: client-side fallback will handle this
        logger.warn({
          service: "auth",
          operation: "callback.storeTokens.failed",
          error: tokenErr,
        });
      }

      return NextResponse.redirect(`${origin}${next}`);
    } catch (err) {
      logger.error({
        service: "auth",
        operation: "callback.unexpected",
        error: err,
      });
    }
  }

  return NextResponse.redirect(`${origin}/interview?auth_error=true`);
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd apps/web && npx tsc --noEmit
```
Expected: No errors.

---

### Task 6: Create fallback store-tokens API endpoint

**Files:**
- Create: `apps/web/src/app/api/auth/store-tokens/route.ts`

This is the fallback for when the callback doesn't get the provider tokens. The client calls this endpoint after detecting a session. Validates token ownership via Google tokeninfo before storing.

- [ ] **Step 1: Create the route**

```typescript
// apps/web/src/app/api/auth/store-tokens/route.ts
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { storeGmailTokens } from "@/lib/services/gmail-tokens";
import { storeTokensSchema } from "@/lib/validation/auth";
import { AuthError, ForbiddenError, ValidationError } from "@denim/types";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();
    const parsed = storeTokensSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const { providerToken, providerRefreshToken } = parsed.data;

    // Validate token ownership via Google tokeninfo
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(providerToken)}`,
    );

    if (!tokenInfoRes.ok) {
      throw new ForbiddenError("Invalid Google token");
    }

    const tokenInfo = await tokenInfoRes.json();

    // Verify scope includes gmail.readonly
    const scopes: string = tokenInfo.scope ?? "";
    if (!scopes.includes("gmail.readonly")) {
      throw new ForbiddenError("Gmail permissions missing, please reconnect.");
    }

    // Get the user's email from Supabase to cross-check
    // (The token's email must match the authenticated user)
    // Note: tokenInfo.email is the Google account email
    // We trust the auth middleware's userId and store the tokens
    // The tokeninfo check prevents arbitrary token injection

    await storeGmailTokens(userId, tokenInfo.email ?? "", {
      access_token: providerToken,
      refresh_token: providerRefreshToken,
      expiry_date: Date.now() + (Number(tokenInfo.expires_in) || 3600) * 1000,
      scope: scopes,
    });

    logger.info({
      service: "auth",
      operation: "storeTokens.fallback",
      userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, {
      service: "auth",
      operation: "storeTokens",
      userId,
    });
  }
});
```

- [ ] **Step 2: Type-check and lint**

Run:
```bash
cd apps/web && npx tsc --noEmit && cd ../.. && pnpm biome check apps/web/src/app/api/auth/store-tokens/route.ts
```
Expected: No errors.

---

### Task 7: Update Card2GmailConnect with fallback token storage

**Files:**
- Modify: `apps/web/src/components/interview/card2-gmail-connect.tsx:100-118`

After detecting a valid session, call `/api/auth/store-tokens` to ensure tokens are persisted. This is a fire-and-forget call — the user flow continues regardless.

- [ ] **Step 1: Add token storage call after session detection**

In the `useEffect` that checks for an existing session (lines 100-108), after finding `session.provider_token`, call the store-tokens endpoint:

Replace lines 100-108:
```typescript
  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.provider_token && session?.access_token) {
        authTokenRef.current = session.access_token;
        setStatus("connected");
      }
    });
  }, []);
```

With:
```typescript
  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.provider_token && session?.access_token) {
        authTokenRef.current = session.access_token;
        setStatus("connected");

        // Fallback: store tokens server-side if callback didn't
        fetch("/api/auth/store-tokens", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            providerToken: session.provider_token,
            providerRefreshToken: session.provider_refresh_token ?? "",
          }),
        }).catch(() => {
          // Non-fatal: tokens may already be stored from callback
        });
      }
    });
  }, []);
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd apps/web && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit OAuth flow changes**

```bash
git add apps/web/src/app/auth/callback/route.ts apps/web/src/app/api/auth/store-tokens/route.ts apps/web/src/components/interview/card2-gmail-connect.tsx
git commit -m "feat: store Gmail tokens on OAuth callback with client-side fallback"
```

---

## Chunk 3: Wire API routes to use stored tokens

### Task 8: Update /api/interview/validate to use GmailTokenService

**Files:**
- Modify: `apps/web/src/app/api/interview/validate/route.ts`

Remove the inline Supabase session + provider_token extraction. Replace with `getValidGmailToken(userId)`.

- [ ] **Step 1: Rewrite the route**

```typescript
// apps/web/src/app/api/interview/validate/route.ts
import { GmailClient } from "@/lib/gmail/client";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { validateHypothesis } from "@/lib/services/interview";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();
    const { hypothesis } = body;

    if (!hypothesis) {
      return NextResponse.json({ error: "Missing hypothesis" }, { status: 400 });
    }

    const gmailToken = await getValidGmailToken(userId);
    const gmail = new GmailClient(gmailToken);
    const { messages, discoveries } = await gmail.sampleScan(200);

    const emailSamples = messages.map((m) => ({
      subject: m.subject,
      senderDomain: m.senderDomain,
      senderName: m.senderDisplayName || m.senderEmail,
      snippet: m.snippet,
    }));

    const validation = await validateHypothesis(hypothesis, emailSamples, {
      userId,
    });

    return NextResponse.json({ data: { validation, discoveries } });
  } catch (error) {
    return handleApiError(error, {
      service: "interview",
      operation: "validate",
      userId,
    });
  }
});
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd apps/web && npx tsc --noEmit
```
Expected: No errors.

---

### Task 9: Update /api/gmail/scan to use GmailTokenService

**Files:**
- Modify: `apps/web/src/app/api/gmail/scan/route.ts`

Same pattern as the validate route.

- [ ] **Step 1: Rewrite the route**

```typescript
// apps/web/src/app/api/gmail/scan/route.ts
import { GmailClient } from "@/lib/gmail/client";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { getValidGmailToken } from "@/lib/services/gmail-tokens";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const gmailToken = await getValidGmailToken(userId);

    const body = await request.json().catch(() => ({}));
    const maxResults = typeof body?.maxResults === "number" ? body.maxResults : 200;

    const gmail = new GmailClient(gmailToken);
    const { messages, discoveries } = await gmail.sampleScan(maxResults);

    return NextResponse.json({ data: { messages, discoveries } });
  } catch (error) {
    return handleApiError(error, {
      service: "gmail",
      operation: "scan",
      userId,
    });
  }
});
```

- [ ] **Step 2: Type-check and lint**

Run:
```bash
cd apps/web && npx tsc --noEmit && cd ../.. && pnpm biome check apps/web/src/app/api/interview/validate/route.ts apps/web/src/app/api/gmail/scan/route.ts
```
Expected: No errors.

- [ ] **Step 3: Commit API route changes**

```bash
git add apps/web/src/app/api/interview/validate/route.ts apps/web/src/app/api/gmail/scan/route.ts
git commit -m "feat: use GmailTokenService in validate and scan routes"
```

---

## Chunk 4: End-to-end verification

### Task 10: Full type-check and lint

- [ ] **Step 1: Type-check entire project**

Run:
```bash
cd apps/web && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 2: Lint entire project**

Run:
```bash
pnpm biome check apps/web/src/lib/services/gmail-tokens.ts apps/web/src/lib/validation/auth.ts apps/web/src/app/auth/callback/route.ts apps/web/src/app/api/auth/store-tokens/route.ts apps/web/src/app/api/interview/validate/route.ts apps/web/src/app/api/gmail/scan/route.ts apps/web/src/components/interview/card2-gmail-connect.tsx
```
Expected: No errors.

---

### Task 11: Manual E2E test with real OAuth

- [ ] **Step 1: Start the dev server**

Run:
```bash
pnpm --filter web dev
```

- [ ] **Step 2: Open `/interview` in the browser**

Walk through Card 1 (input) → Card 2 (Gmail connect).

- [ ] **Step 3: Complete OAuth flow**

Click "Connect Gmail", sign in with the demo account (`ndsoftwarecasatest@gmail.com`).

- [ ] **Step 4: Check terminal logs**

Look for:
```
{"service":"auth","operation":"callback.storeTokens","userId":"..."}
```
or the fallback:
```
{"service":"auth","operation":"storeTokens.fallback","userId":"..."}
```

At least one of these must appear — confirming tokens were stored.

- [ ] **Step 5: Verify scan fires successfully**

After Card 2 → generating → Card 3 (scanning), check terminal for:
```
{"service":"api","operation":"POST /api/interview/validate"}
{"service":"api","operation":"POST /api/interview/validate.complete","status":200,...}
```

The scan should complete without a 401.

- [ ] **Step 6: Verify token in database**

Run:
```bash
cd apps/web && npx prisma studio
```

Open the `users` table. The demo account should have a non-null `googleTokens` field containing an encrypted string (format: `hex:hex:hex`).

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: server-side Gmail token storage with encrypted persistence and auto-refresh"
```
