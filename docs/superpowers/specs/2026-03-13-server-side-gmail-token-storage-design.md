# Server-Side Gmail Token Storage

## Problem

The validate and scan API routes need Google's `provider_token` to call the Gmail API. Currently they extract it from the Supabase session via `getSession()`, but this doesn't reliably return the `provider_token` when called server-side with just a JWT. The token lives only in the client-side session and is never persisted.

This blocks the entire interview flow at the scan step (Card 3).

## Design

### Token Lifecycle

1. User completes Google OAuth via Supabase (`signInWithOAuth`)
2. Supabase exchanges the auth code and stores the session (with `provider_token` and `provider_refresh_token`)
3. **New**: On callback, store both tokens encrypted in `User.googleTokens` (Prisma)
4. API routes that need Gmail look up the stored token by userId
5. If the stored `access_token` is expired, refresh it using the `refresh_token` + Google client credentials
6. Re-encrypt and update the DB with the refreshed token

### User ID Alignment

The Prisma `User.id` uses `@default(cuid())` but `withAuth` returns the Supabase `auth.users.id` (a UUID). These are different identifier spaces. The schema must be updated so `User.id` stores the Supabase UUID directly:

```prisma
model User {
  id  String  @id   // Supabase auth.users.id (UUID), no auto-generate
  ...
}
```

The callback route creates the User row using the Supabase UUID as the id (upsert pattern). This is a **schema migration** that must happen before any User rows are created.

### Token Storage Schema

The `User.googleTokens` field already exists in the Prisma schema as `Json?`. The encrypted JSON payload:

```json
{
  "access_token": "ya29.xxx",
  "refresh_token": "1//xxx",
  "expiry_date": 1710345600000,
  "scope": "https://www.googleapis.com/auth/gmail.readonly"
}
```

Encrypted at rest using AES-256-GCM via the existing `encryptTokens()`/`decryptTokens()` utilities in `apps/web/src/lib/gmail/tokens.ts`. Encryption key from `TOKEN_ENCRYPTION_KEY` env var.

### Table Ownership

Per the Single Writer Principle, `GmailTokenService` is the sole writer for `User.googleTokens`. Add to the ownership map:

| Field | Write Owner | Notes |
|-------|-------------|-------|
| `User.googleTokens` | GmailTokenService | Callback and refresh both go through the service |

The callback route and any fallback paths call `GmailTokenService.storeGmailTokens()` — they do not write directly.

### Components

#### 1. Gmail Token Service (`apps/web/src/lib/services/gmail-tokens.ts`)

Single-writer for `User.googleTokens`.

**`storeGmailTokens(userId, tokens)`**
- Accepts `{ access_token, refresh_token, expiry_date, scope }`
- Validates scope includes `gmail.readonly`
- Encrypts via `encryptTokens()`
- Upserts to `User.googleTokens` via Prisma (also upserts User row with Supabase UUID)

**`getValidGmailToken(userId): Promise<string>`**
- Reads `User.googleTokens` from DB
- Decrypts via `decryptTokens()` — wraps crypto errors in `AuthError("Gmail access invalid, please reconnect")`
- If `expiry_date` is in the future (with 5-minute buffer): return `access_token`
- If expired: call Google OAuth2 token endpoint with `refresh_token`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Compute `expiry_date` from the response's `expires_in` field: `Date.now() + expires_in * 1000`
- If refresh response includes a new `refresh_token` (Google token rotation), store the new one
- Store refreshed tokens, return new `access_token`
- If refresh fails (revoked grant): throw `AuthError("Gmail access revoked, please reconnect")`
- If Google API unreachable: throw `ExternalAPIError` after 3 retries with backoff

**`clearGmailTokens(userId)`**
- Sets `User.googleTokens` to null (for disconnect/revoke/account deletion flows)

**Dev bypass**: When `BYPASS_AUTH=true`, `getValidGmailToken("dev-user-id")` returns a mock token or reads from `DEV_GMAIL_TOKEN` env var, so the scan step works in local dev without real OAuth.

#### 2. Typed Error Mapping

| Scenario | Error Class | Message |
|----------|-------------|---------|
| No stored tokens | `AuthError` (401) | "Gmail not connected. Please connect Gmail first." |
| Decryption fails (key rotated) | `AuthError` (401) | "Gmail access invalid, please reconnect." |
| Refresh token revoked | `AuthError` (401) | "Gmail access revoked, please reconnect." |
| Scope missing gmail.readonly | `AuthError` (401) | "Gmail permissions missing, please reconnect." |
| Google API unreachable during refresh | `ExternalAPIError` (502) | "Google API unavailable, please try again." |
| TOKEN_ENCRYPTION_KEY missing | `Error` (startup crash) | "TOKEN_ENCRYPTION_KEY not set" |

#### 3. OAuth Callback Enhancement (`/auth/callback`)

After `exchangeCodeForSession(code)`:
- Read the session via `getSession()` on the server-side cookie-based client
- Extract `provider_token`, `provider_refresh_token`
- Get `user` from `getUser()`
- If provider tokens present: call `storeGmailTokens(user.id, { access_token: provider_token, refresh_token: provider_refresh_token, expiry_date: Date.now() + 3600 * 1000, scope })` — initial expiry is approximate; the refresh path uses `expires_in` from Google for accuracy
- Replace `console.error` with structured logger
- On storage failure: log warning but still redirect (tokens can be stored via fallback)

The callback route uses `createServerSupabaseClient()` which has cookie access, so `getSession()` should return the full session including provider tokens immediately after code exchange.

#### 4. Client-Side Fallback (Card2GmailConnect)

If the callback didn't store tokens (Supabase edge case where `getSession()` on the server doesn't return provider tokens):

- Card2GmailConnect already reads `session.provider_token` client-side
- After detecting session, call `POST /api/auth/store-tokens` with provider tokens
- This is a **fallback only** — the callback is the primary storage path

**Security for the fallback endpoint**: The endpoint validates the submitted token by calling Google's tokeninfo endpoint (`https://oauth2.googleapis.com/tokeninfo?access_token=...`) before storing. This verifies: (a) the token is a real Google token, (b) its `email` matches the authenticated user's email, (c) its scope includes `gmail.readonly`. If any check fails, return 403. This prevents token injection.

#### 5. Store-Tokens API Endpoint (`/api/auth/store-tokens`)

Fallback endpoint for client-side token persistence.

- `POST` with Zod-validated body: `{ providerToken: string, providerRefreshToken: string }`
- Zod schema defined in `apps/web/src/lib/validation/auth.ts`
- Protected by `withAuth` (requires valid Supabase JWT)
- **Server-side token validation**: Before storing, call Google tokeninfo to verify the token belongs to the authenticated user and has correct scope
- Calls `storeGmailTokens(userId, ...)`
- Returns 200 on success, 403 on token validation failure

#### 6. API Route Updates

**`/api/interview/validate`** and **`/api/gmail/scan`**:
- Remove the inline `getSession()` + `provider_token` extraction
- Replace with `const gmailToken = await getValidGmailToken(userId)`
- Pass `gmailToken` to `new GmailClient(gmailToken)`
- Catch `AuthError` -> 401, `ExternalAPIError` -> 502

#### 7. Environment Setup

- Generate `TOKEN_ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Set in `.env.local`
- Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (needed for refresh)

### Concurrent Refresh Safety

If two API requests both observe an expired token simultaneously, both will attempt a refresh. Mitigation: optimistic locking. `getValidGmailToken` reads the encrypted blob, refreshes, then does a conditional update: `UPDATE users SET google_tokens = $new WHERE id = $userId AND google_tokens = $old`. If the update affects 0 rows (another request already refreshed), re-read the token from DB and use the already-refreshed value. This avoids advisory locks while preventing double-refresh overwrites.

### Security

- Tokens encrypted at rest with AES-256-GCM (existing utility)
- `TOKEN_ENCRYPTION_KEY` never committed, only in env vars
- Refresh tokens are long-lived secrets — same encryption treatment
- Service role key used only server-side for token storage
- Provider tokens never logged (existing logging policy)
- Token refresh is server-side only — client never sees the Google token after initial storage
- Fallback store-tokens endpoint validates token ownership via Google tokeninfo before storage
- Account deletion (`clearGmailTokens`) called as part of User deletion cascade

### Zod Validation

New schema in `apps/web/src/lib/validation/auth.ts`:

```typescript
import { z } from "zod";

export const storeTokensSchema = z.object({
  providerToken: z.string().min(1),
  providerRefreshToken: z.string().min(1),
});
```

### Testing

**Automated (with demo account `ndsoftwarecasatest@gmail.com`)**:
- Integration test: store tokens, retrieve, verify decryption roundtrip
- Integration test: call validate endpoint with stored tokens, verify Gmail API response
- Unit test: encryption/decryption roundtrip with mock data
- Unit test: expiry check logic (mock Date.now)
- Unit test: refresh flow (mock Google token endpoint)

**Manual**:
- Full OAuth flow: sign in, verify tokens stored in DB
- Wait for token expiry (or manually expire), verify refresh works
- Revoke Google access, verify graceful error

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/prisma/schema.prisma` | Modify | Change User.id to plain `@id` (no cuid default) |
| `apps/web/src/lib/services/gmail-tokens.ts` | Create | Token storage, retrieval, refresh |
| `apps/web/src/lib/validation/auth.ts` | Create | Zod schema for store-tokens endpoint |
| `apps/web/src/app/auth/callback/route.ts` | Modify | Store tokens after code exchange, structured logging |
| `apps/web/src/app/api/auth/store-tokens/route.ts` | Create | Fallback client-side token storage with validation |
| `apps/web/src/app/api/interview/validate/route.ts` | Modify | Use `getValidGmailToken()` |
| `apps/web/src/app/api/gmail/scan/route.ts` | Modify | Use `getValidGmailToken()` |
| `apps/web/src/components/interview/card2-gmail-connect.tsx` | Modify | Fallback: store tokens if callback didn't |
| `apps/web/.env.local` | Modify | Add TOKEN_ENCRYPTION_KEY |
