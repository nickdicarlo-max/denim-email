/**
 * Dev-only bypass for local testing without a real Gmail token.
 *
 * Isolated to one file (vs. buried inside service logic) so that:
 *   - The bypass surface is obvious to anyone auditing auth code
 *   - The bypass can never be silently dropped during refactors
 *   - Production builds that never set `BYPASS_AUTH` cost exactly one env read
 *
 * When `BYPASS_AUTH=true`:
 *   - `DEV_GMAIL_TOKEN` must also be set; returns it as the access token.
 *   - If the token env var is missing, throws loudly — this is a dev
 *     misconfiguration, not a credential problem, so we surface a plain
 *     Error (not a typed GmailCredentialError) to make the bad config
 *     impossible to miss.
 */
export interface DevBypassResult {
  bypass: boolean;
  token?: string;
}

export function readDevBypass(): DevBypassResult {
  if (process.env.BYPASS_AUTH !== "true") {
    return { bypass: false };
  }
  const token = process.env.DEV_GMAIL_TOKEN;
  if (!token) {
    throw new Error("BYPASS_AUTH=true but DEV_GMAIL_TOKEN is not set — dev bypass misconfigured");
  }
  return { bypass: true, token };
}
