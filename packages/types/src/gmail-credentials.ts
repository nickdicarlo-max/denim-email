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
  | "decrypt_failed";

export type CredentialRemedy = "reconnect" | "retry";

export interface CredentialFailure {
  reason: CredentialFailureReason;
  remedy: CredentialRemedy;
}

/**
 * Remedy is derived from reason so callers can't construct mismatched
 * pairs. All five current reasons map to `reconnect` — the user needs to
 * redo OAuth. `retry` is reserved for future transient failure modes
 * (e.g. Google /token temporary 5xx) that don't require re-consent.
 */
export function remedyFor(reason: CredentialFailureReason): CredentialRemedy {
  switch (reason) {
    case "absent":
    case "scope_insufficient":
    case "revoked":
    case "refresh_failed":
    case "decrypt_failed":
      return "reconnect";
  }
}

export function credentialFailure(reason: CredentialFailureReason): CredentialFailure {
  return { reason, remedy: remedyFor(reason) };
}
