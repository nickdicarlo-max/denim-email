/**
 * Centralised Gmail auth-error detection.
 *
 * DEPRECATED — scheduled for removal in issue #105 step 4 when the UI
 * migrates from string-matching to the typed `CredentialFailure` JSON
 * carried on polling responses. Server-side code should prefer
 * `err instanceof GmailCredentialError` from `@denim/types`. This
 * helper remains for:
 *   1. Legacy Gmail API 401s thrown from `client.ts` as plain Errors
 *      that don't flow through the credentials module.
 *   2. UI components reading `phaseError` strings off polling responses
 *      until step 4 replaces that surface with the typed JSON column.
 *
 * Patterns:
 *   - "please reconnect" / "please connect gmail" — legacy messages from
 *     `gmail-tokens.ts` before the refactor.
 *   - "invalid authentication credentials" — Gmail API 401 wrap in
 *     `client.ts`.
 *   - "invalid_grant" — Google /token endpoint response for revoked
 *     refresh tokens.
 *   - "gmail_auth:" — the prefix the Inngest functions write onto
 *     `phaseError` when any of the above OR a `GmailCredentialError`
 *     is caught. Bridges the new typed errors to the legacy UI
 *     detection layer until step 4.
 */
export function matchesGmailAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("please reconnect") ||
    lower.includes("please connect gmail") ||
    lower.includes("invalid authentication credentials") ||
    lower.includes("invalid_grant") ||
    lower.includes("gmail_auth:")
  );
}
