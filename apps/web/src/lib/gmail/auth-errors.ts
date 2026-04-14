/**
 * Centralised Gmail auth-error detection.
 *
 * These patterns originate from:
 *   - gmail-tokens.ts — throws AuthError with "please reconnect" or "please connect gmail"
 *   - client.ts — wraps Gmail API 401s as "invalid authentication credentials"
 *   - Google token endpoint — returns "invalid_grant" for revoked tokens
 */
export function matchesGmailAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("please reconnect") ||
    lower.includes("please connect gmail") ||
    lower.includes("invalid authentication credentials") ||
    lower.includes("invalid_grant")
  );
}
