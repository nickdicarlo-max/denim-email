/**
 * Test user helpers — creates and cleans up a user in both Supabase Auth
 * and the Prisma `users` table.
 */
import { createClient } from "@supabase/supabase-js";
import { storeCredentials } from "@/lib/gmail/credentials";
import { prisma } from "@/lib/prisma";
import { ensureUserRow } from "@/lib/services/user";

const TEST_EMAIL = "integration-test@denim-email.test";
const TEST_PASSWORD = "test-integration-password-2026";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestUser {
  userId: string;
  accessToken: string;
}

/**
 * Create (or re-use) the integration test user.
 * Uses the admin API to bypass email validation (allows .test TLD).
 * Returns the Supabase user ID and an access token for API calls.
 */
export async function createTestUser(): Promise<TestUser> {
  const admin = getAdminClient();

  let userId: string;
  let accessToken: string;

  // Try to list existing users with this email first
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === TEST_EMAIL);

  if (existing) {
    // User exists — generate a new session via admin API
    userId = existing.id;
  } else {
    // Create user via admin API (bypasses email validation, auto-confirms)
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error(`Failed to create test user: ${createError?.message}`);
    }
    userId = created.user.id;
  }

  // Sign in to get an access token
  const { data: signIn, error: signInError } = await admin.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (signInError || !signIn.user || !signIn.session) {
    throw new Error(`Failed to sign in test user: ${signInError?.message}`);
  }
  accessToken = signIn.session.access_token;

  // Upsert the User row via shared service (same code path as withAuth middleware)
  await ensureUserRow({
    userId,
    email: TEST_EMAIL,
    displayName: "Integration Test User",
  });

  return { userId, accessToken };
}

/**
 * Seed an encrypted Gmail token pair on the test user so routes that gate on
 * `user.googleTokens` (e.g. POST /api/onboarding/start's pre-flight check)
 * succeed without a real OAuth dance.
 *
 * Routes through production `storeCredentials` (issue #105 credentials
 * bounded-context module) so test setup exercises the same trust-boundary
 * validation + encryption path as prod OAuth callback. Per Bug 5 lesson:
 * test helpers must not re-implement prod DB writes.
 *
 * Token values are stubs — downstream Gmail API calls will fail if
 * exercised. Tests that only gate on token presence (idempotency,
 * validation) are fine; tests that need real Gmail access (happy path
 * with RUN_E2E_HAPPY=1) should overwrite with a real OAuth playground
 * token.
 */
export async function seedGmailToken(userId: string): Promise<void> {
  await storeCredentials({
    userId,
    email: TEST_EMAIL,
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresInSeconds: 3600,
    grantedScopes: "https://www.googleapis.com/auth/gmail.readonly",
    verificationSource: "google_tokeninfo",
  });
}

/**
 * Clean up all test data. Cascade deletes on CaseSchema handle child tables.
 * ExtractionCost rows are orphan-safe (no FK to CaseSchema), so delete explicitly.
 */
export async function cleanupTestUser(userId: string): Promise<void> {
  const admin = getAdminClient();

  // 1. Find all schemas for this user (to clean ExtractionCost)
  const schemas = await prisma.caseSchema.findMany({
    where: { userId },
    select: {
      id: true,
      emails: { select: { id: true } },
    },
  });

  const emailIds = schemas.flatMap((s) => s.emails.map((e) => e.id));

  // 2. Delete ExtractionCost rows (no cascade from CaseSchema)
  if (emailIds.length > 0) {
    await prisma.extractionCost.deleteMany({
      where: { emailId: { in: emailIds } },
    });
  }

  // 3. Delete CaseSchemas (cascades: entities, tags, fields, emails, cases, clusters, etc.)
  await prisma.caseSchema.deleteMany({ where: { userId } });

  // 4. Delete the User row
  await prisma.user.deleteMany({ where: { id: userId } });

  // 5. Delete from Supabase Auth
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.warn(`Warning: failed to delete Supabase auth user: ${error.message}`);
  }
}
