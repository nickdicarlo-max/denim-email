import { prisma } from "@/lib/prisma";

export interface EnsureUserRowInput {
  userId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

/**
 * Idempotently ensure a `User` row exists for this Supabase user.
 *
 * Uses email-first upsert so a Google account re-auth (where Supabase
 * may rotate the userId) still resolves to the same app-level row.
 * Falls back to id-based upsert if no email is available.
 *
 * Called by:
 * - withAuth middleware on every authenticated request
 * - createTestUser integration test helper
 */
export async function ensureUserRow(input: EnsureUserRowInput): Promise<void> {
  const { userId, email, displayName = null, avatarUrl = null } = input;
  if (email) {
    await prisma.user.upsert({
      where: { email },
      create: { id: userId, email, displayName, avatarUrl },
      update: { id: userId, displayName, avatarUrl },
    });
  } else {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email, displayName, avatarUrl },
      update: {},
    });
  }
}
