// Generic email-provider domains that should never be treated as
// client domains, activity-platform domains, or school/vendor domains
// in Stage 1 aggregation. Ported from The Control Surface constants.ts:559.

export const PUBLIC_PROVIDERS: ReadonlySet<string> = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "msn.com",
  "live.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "zoho.com",
  "gmx.com",
]);

export function isPublicProvider(domain: string): boolean {
  return PUBLIC_PROVIDERS.has(domain.toLowerCase());
}
