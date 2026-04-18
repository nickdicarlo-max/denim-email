import type { SchemaHypothesis } from "@denim/types";
import { GENERIC_SENDER_DOMAINS } from "./interview";

/**
 * An expansion target tells Pass 2 what Gmail query to run to find more
 * emails tied to a confirmed secondary entity.
 *
 *   - `domain`: expand the whole domain with `from:${value}` — safe for
 *     corporate/org domains like "email.teamsnap.com" where every sender
 *     at that domain is organizationally related.
 *   - `sender`: expand a single address with `from:${value}` — required
 *     for generic-provider senders like `jane@gmail.com`, where expanding
 *     the domain would pull every personal email in the inbox.
 */
export type ExpansionTarget = { type: "domain"; value: string } | { type: "sender"; value: string };

/**
 * Extract expansion targets from an enriched hypothesis. For each
 * SECONDARY entity, walk its aliases and emit one target per alias
 * email address:
 *   - If the domain is a generic consumer provider (gmail.com, yahoo.com,
 *     outlook.com, etc. — see GENERIC_SENDER_DOMAINS), emit a sender
 *     target keyed on the full address.
 *   - Otherwise, emit a domain target keyed on the domain part.
 *
 * Aliases without an `@` (plain display-name aliases like "coach ziad")
 * are skipped — they can't be Gmail-queried.
 *
 * Results are deduplicated by (type, value).
 */
export function extractExpansionTargets(hypothesis: SchemaHypothesis): ExpansionTarget[] {
  const seen = new Set<string>();
  const targets: ExpansionTarget[] = [];

  for (const entity of hypothesis.entities) {
    if (entity.type !== "SECONDARY") continue;

    for (const alias of entity.aliases) {
      const atIdx = alias.lastIndexOf("@");
      if (atIdx < 0) continue;

      const email = alias.toLowerCase().trim();
      const domain = email.slice(atIdx + 1);
      if (!domain || domain.includes(" ")) continue;

      if (GENERIC_SENDER_DOMAINS.has(domain)) {
        const key = `sender:${email}`;
        if (!seen.has(key)) {
          seen.add(key);
          targets.push({ type: "sender", value: email });
        }
      } else {
        const key = `domain:${domain}`;
        if (!seen.has(key)) {
          seen.add(key);
          targets.push({ type: "domain", value: domain });
        }
      }
    }
  }

  return targets;
}
