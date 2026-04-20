/**
 * Typed model of the Gmail credential surface — wire-serializable.
 *
 * Two orthogonal types on purpose:
 * - `CredentialRecord` is what is persisted (the answer to "what's in the DB?").
 *   Pre-flight + UI remedy logic read it.
 * - `CredentialFailure` is the remedy-classified reason an operation FAILED
 *   (the answer to "why did getAccessToken throw, and what should the UI do?").
 *   Returned on `GmailCredentialError` and surfaced in the polling response.
 *
 * Callers never branch on a conflated union. `getCredentialRecord` returns a
 * `CredentialRecord`; `getAccessToken` returns a string or throws a typed
 * error carrying a `CredentialFailure`.
 */

export type CredentialRecord =
  | { type: "absent" }
  | {
      type: "present";
      hasRefreshToken: boolean;
      grantedScopes: readonly string[];
      /** ISO 8601 timestamp — serializable. */
      expiresAt: string;
    };

export type CredentialFailureReason =
  | "absent"
  | "scope_insufficient"
  | "revoked"
  | "refresh_failed"
  | "decrypt_failed"
  // #124: auth.users id rotated (manual Supabase Auth dashboard delete, or
  // Supabase recycling) while a public.users row with the same email survived.
  // `prisma.user.upsert where:{id}` misses → falls to `create` → P2002 on the
  // email unique constraint. User-level OAuth recovery does NOT fix this —
  // the stale public.users row has to be reconciled by an operator.
  | "account_conflict";

export type CredentialRemedy = "reconnect" | "retry" | "contact_support";

export interface CredentialFailure {
  reason: CredentialFailureReason;
  remedy: CredentialRemedy;
}

/**
 * Remedy is derived from reason so callers can't construct mismatched
 * pairs. Most reasons map to `reconnect` — the user needs to redo OAuth.
 * `retry` is reserved for future transient failure modes (e.g. Google
 * /token temporary 5xx) that don't require re-consent.
 * `contact_support` is for states where neither OAuth nor retry helps —
 * currently only `account_conflict` (#124), which requires operator-side
 * reconciliation of a stale public.users row.
 */
export function remedyFor(reason: CredentialFailureReason): CredentialRemedy {
  switch (reason) {
    case "absent":
    case "scope_insufficient":
    case "revoked":
    case "refresh_failed":
    case "decrypt_failed":
      return "reconnect";
    case "account_conflict":
      return "contact_support";
  }
}

export function credentialFailure(reason: CredentialFailureReason): CredentialFailure {
  return { reason, remedy: remedyFor(reason) };
}

/**
 * Shape guard for `CredentialFailure`. Used by `extractCredentialFailure`
 * to duck-type-check thrown errors instead of relying on `instanceof
 * GmailCredentialError`, which is unreliable across workspace-package
 * boundaries in Next.js dev mode: Turbopack can load `@denim/types` as
 * two distinct module instances (one class per import chunk) and the
 * identity check silently returns false. See #107.
 */
export function isCredentialFailure(value: unknown): value is CredentialFailure {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { reason?: unknown; remedy?: unknown };
  return typeof v.reason === "string" && typeof v.remedy === "string";
}

/**
 * Extract a typed `CredentialFailure` from any thrown value. Resilient
 * to Turbopack workspace-package class duplication in dev mode where
 * `err instanceof GmailCredentialError` returns false even though the
 * error WAS constructed as one. Prefer this over `instanceof` in every
 * Inngest catch block that pulls `credentialFailure` off an error.
 */
export function extractCredentialFailure(err: unknown): CredentialFailure | undefined {
  if (err && typeof err === "object" && "credentialFailure" in err) {
    const cf = (err as { credentialFailure: unknown }).credentialFailure;
    if (isCredentialFailure(cf)) return cf;
  }
  return undefined;
}
