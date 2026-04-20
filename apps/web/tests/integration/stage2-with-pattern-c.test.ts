/**
 * Integration test stub for #102 Stage 2 Pattern C corpus mining.
 *
 * Deferred — full integration run requires a mocked Gmail client that can
 * feed pre-canned subject lists through the Stage 2 pipeline without
 * hitting live Gmail. Matches the #117 `stage1-with-groups.test.ts`
 * pattern; unlocks once the mocked-Gmail integration runner lands.
 *
 * Run plan (manual, post-merge):
 *   1. Seed a CaseSchema stub with:
 *        inputs.groups = [{ whats: ["soccer"], whos: ["Ziad Allan"] }]
 *        stage1UserContacts = [{ query: "Ziad Allan",
 *                                 senderEmail: "donotreply@email.teamsnap.com",
 *                                 senderDomain: "email.teamsnap.com",
 *                                 matchCount: 50,
 *                                 errorCount: 0 }]
 *        stage2ConfirmedDomains = ["email.teamsnap.com"]
 *   2. Trigger `onboarding.entity-discovery.requested`.
 *   3. Await `phase === AWAITING_ENTITY_CONFIRMATION`.
 *   4. Assert stage2 candidates include the ZSA team phrase with
 *        pattern: "C", sourcedFromWho: "Ziad Allan", relatedWhat: "soccer".
 *   5. Assert the candidate's frequency is ≥ 3 (distinct subjects).
 *   6. Regression: Property Management flow with groups=[] produces the
 *      same candidate set as pre-#102 (Pattern C runs full-view only;
 *      property extractor ignores senderEmail, no new candidates).
 *
 * See unit tests in
 * `src/lib/discovery/__tests__/school-entity.test.ts` for the Pattern C
 * contract being exercised here.
 */
import { describe, it } from "vitest";

describe.skip("#102 Stage 2 with Pattern C — integration", () => {
  it("paired WHO surfaces ZSA team with sourcedFromWho + relatedWhat tags", () => {
    // TODO: wire up Prisma + Inngest fixtures; mock Gmail to return the
    // 2026-04-19 TeamSnap fixture. Unit coverage already embeds the
    // algorithm-level assertions on literal subject fixtures.
  });

  it("unpaired schema (property) runs Pattern C full-view only with zero regression", () => {
    // TODO: property fixture should produce identical candidates pre- vs
    // post-#102 given the same subject corpus. Pattern C may surface
    // address-shaped n-grams but dedup should collapse them against
    // property-pattern entries on the same normalized key.
  });
});
