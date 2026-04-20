/**
 * Integration test stub for #117 Stage 1 pairing.
 *
 * Deferred — full integration run requires a live dev server + Inngest dev
 * server (per `docs/superpowers/specs/2026-04-19-issue-117-stage1-pairing-and-hygiene.md`
 * § Integration test). The skeleton below documents the expected assertions
 * so the live E2E run on the Girls Activities Gmail account has a concrete
 * target shape to compare against.
 *
 * Run plan (manual, post-merge):
 *   1. Seed a CaseSchema stub with `inputs.groups = [{ whats: ["soccer"],
 *      whos: ["Ziad Allan"] }]`.
 *   2. Trigger `onboarding.domain-discovery.requested`.
 *   3. Await `phase === AWAITING_DOMAIN_CONFIRMATION`.
 *   4. Assert `stage1UserThings[0].topDomain === "email.teamsnap.com"`.
 *   5. Assert `stage1UserThings[0].sourcedFromWho === "Ziad Allan"`.
 *   6. Assert `stage1UserThings[0].topDomain !== "bucknell.edu"` and the
 *      `.edu` safety filter kept Bucknell out even on the unpaired fallback.
 */
import { describe, it } from "vitest";

describe.skip("#117 Stage 1 with paired groups — integration", () => {
  it("paired WHAT sources topDomain from WHO's from: result", () => {
    // TODO: wire up Prisma + Inngest fixtures; mock Gmail to return the
    // 2026-04-19 fixture. See unit tests in
    // `src/lib/discovery/__tests__/user-hints-discovery.test.ts` for the
    // pairing contract being exercised here.
  });
});
