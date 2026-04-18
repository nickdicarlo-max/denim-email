import type { DenimEvents } from "@denim/types";
import { Inngest } from "inngest";

/**
 * Inngest client (issue #95 Task 4.4c — H1 security hardening).
 *
 * `signingKey` is passed explicitly so an unsigned event can't drive
 * onboarding.domain-discovery.requested / onboarding.entity-discovery.requested
 * (or any other Denim function) by hitting /api/inngest directly. The SDK
 * would fall back to reading `INNGEST_SIGNING_KEY` from env implicitly; the
 * explicit pass here is belt-and-braces — one grep reveals where signing is
 * enforced, and `process.env.INNGEST_SIGNING_KEY` returns `undefined` if the
 * var isn't set so the SDK's built-in dev-mode relaxation still applies
 * (local `inngest dev` loop keeps working).
 */
export const inngest = new Inngest({
  id: "case-engine",
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

// Re-export the typed client for use in function definitions
export type { DenimEvents };
