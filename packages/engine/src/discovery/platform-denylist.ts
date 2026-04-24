/**
 * Domains we never treat as candidate PRIMARY/SECONDARY domains, regardless
 * of how many of a user's WHO/WHAT hints happen to hit them. These are
 * transactional-email platforms, marketing-email platforms, and SaaS product
 * notifications — not domain-specific content the user would track.
 *
 * Veto semantics: a hit on a denylist domain contributes a negative signal
 * that forces the candidate's score to −∞ inside `scoreDomainCandidates`,
 * regardless of how many positive signals it collected. User-triggered
 * overrides (e.g. the user actually works at GitHub) are handled at the
 * review screen, not here.
 *
 * Keep narrow. Every entry should be a domain whose outbound mail is
 * ~100% platform-generated rather than human correspondence.
 */

export const PLATFORM_DENYLIST: ReadonlySet<string> = new Set([
  // Transactional / relay platforms
  "sendgrid.net",
  "amazonses.com",
  "postmarkapp.com",
  "mailgun.org",

  // Newsletter / marketing platforms
  "mailchimp.com",
  "constantcontact.com",
  "substack.com",
  "sendinblue.com",
  "hubspotemail.net",

  // Dev / SaaS product notifications
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "twilio.com",
  "stripe.com",
  "intercom.io",
  "zendesk.com",
  "notifications.slack.com",

  // Sports / media platforms that look domain-specific but blast marketing
  "flosports.tv",
  "flosports.com",
]);

export function isPlatformDomain(domain: string): boolean {
  return PLATFORM_DENYLIST.has(domain.toLowerCase());
}
