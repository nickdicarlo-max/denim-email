/**
 * Ground-truth expectations for the three locked onboarding schemas,
 * derived from `ZEFRESH_DENIM/eval-goodonboarding-badonboarding.md`.
 *
 * The eval harness reads this file to seed interview inputs AND to assert
 * discovery output. Hard assertions (every seeded primary + seeded WHO must
 * surface) are PASS/FAIL; soft assertions (expected-discovery sets, property
 * count ranges) report ratios.
 */

import type { EntityGroupInput, InterviewInput } from "@denim/types";
import type { DomainName } from "@/lib/config/domain-shapes";

export type EvalSchemaKey = "school_parent" | "property" | "agency";

export interface HardAssertion {
  /** Free-text description of the assertion for reports. */
  label: string;
  /** Kind of thing we're checking — for grouped reporting. */
  kind: "seeded-primary" | "seeded-who" | "sla";
}

export interface SoftExpectation {
  label: string;
  /** Predicate evaluated against a candidate list; returns a count/ratio. */
  kind: "expected-domain" | "expected-entity" | "count-range";
}

export interface EvalSchemaConfig {
  schemaKey: EvalSchemaKey;
  domain: DomainName;
  /** Interview input passed into `createSchemaStub({ inputs: ... })`. */
  interview: InterviewInput;
  /**
   * Free-text primaries the user typed. The harness asserts each surfaces
   * in Stage 2 entity candidates (hard) or Stage 1 user-named-things (also hard).
   */
  seededPrimaries: string[];
  /**
   * Free-text WHOs the user typed. The harness asserts each surfaces on
   * the Stage 1 Your-Contacts list (seen in stage1UserContacts) or in Stage 2
   * per-domain seeds.
   */
  seededWhos: string[];
  /**
   * Domains the discovery pass should surface (TeamSnap for school_parent,
   * @judgefite.com for property, etc). Soft — reports ratio.
   */
  expectedDomains: string[];
  /**
   * Primaries the system is expected to discover from the corpus that the
   * user did NOT seed. Soft — reports ratio.
   */
  expectedDiscoveries: string[];
  /**
   * Optional count range for "how many properties should Stage 2 find for
   * the judgefite.com domain" style expectations. Soft — reports actual count.
   */
  countRange?: { label: string; min: number; max: number };
}

/**
 * Synthetic user ID used by the eval harness. Matches the userId the auth
 * middleware synthesises when BYPASS_AUTH=true — so the user can run the
 * dev server with BYPASS_AUTH=true and review the produced schemas at
 * `/onboarding/{schemaId}` without needing a real Supabase session.
 *
 * Intentionally a single ID across all three schemas; the wipe helper
 * scopes deletion by `{ userId, domain }` so running one schema doesn't
 * clobber the other two.
 */
export function evalUserId(_key: EvalSchemaKey): string {
  return "dev-user-id";
}

/**
 * Fixed `today` date for eval runs. Four prompt builders inject today's
 * date when not provided — pinning it here keeps the AI response cache
 * stable across calendar days.
 */
export const EVAL_TODAY = "2026-04-22";

const SCHOOL_PARENT_GROUPS: EntityGroupInput[] = [
  { whats: ["soccer"], whos: ["ziad allan"] },
  { whats: ["lanier", "stagnes", "st agnes"], whos: ["amy dicarlo"] },
  { whats: ["dance"], whos: [] },
  { whats: ["guitar"], whos: [] },
];

const PROPERTY_GROUPS: EntityGroupInput[] = [
  {
    whats: ["851 Peavy", "3910 Bucknell", "2310 Healey"],
    whos: ["Timothy Bishop", "Vivek Gupta", "Krystin Jernigan"],
  },
];

const AGENCY_GROUPS: EntityGroupInput[] = [
  {
    whats: ["Portfolio Pro Advisors"],
    whos: ["Margaret Potter", "George Trevino"],
  },
  {
    whats: ["Stallion"],
    whos: ["Farrukh Malik"],
  },
];

export const EVAL_SCHEMAS: Record<EvalSchemaKey, EvalSchemaConfig> = {
  school_parent: {
    schemaKey: "school_parent",
    domain: "school_parent",
    interview: {
      role: "parent",
      domain: "school_parent",
      whats: SCHOOL_PARENT_GROUPS.flatMap((g) => g.whats),
      whos: SCHOOL_PARENT_GROUPS.flatMap((g) => g.whos),
      groups: SCHOOL_PARENT_GROUPS,
      sharedWhos: [],
      goals: ["Organize kids' activities and school email into cases I can act on in the morning."],
      name: "School & Activities",
    },
    seededPrimaries: ["soccer", "dance", "lanier", "stagnes", "st agnes", "guitar"],
    seededWhos: ["ziad allan", "amy dicarlo"],
    expectedDomains: ["email.teamsnap.com"],
    expectedDiscoveries: ["martial arts", "belt test"],
  },

  property: {
    schemaKey: "property",
    domain: "property",
    interview: {
      role: "property owner",
      domain: "property",
      whats: PROPERTY_GROUPS.flatMap((g) => g.whats),
      whos: PROPERTY_GROUPS.flatMap((g) => g.whos),
      groups: PROPERTY_GROUPS,
      sharedWhos: [],
      goals: ["Keep the rental-property inbox organized by address."],
      name: "Rental Properties",
    },
    seededPrimaries: ["851 Peavy", "3910 Bucknell", "2310 Healey"],
    seededWhos: ["Timothy Bishop", "Vivek Gupta", "Krystin Jernigan"],
    expectedDomains: ["judgefite.com"],
    expectedDiscoveries: [],
    countRange: { label: "properties discovered", min: 9, max: 12 },
  },

  agency: {
    schemaKey: "agency",
    domain: "agency",
    interview: {
      role: "consultant",
      domain: "agency",
      whats: AGENCY_GROUPS.flatMap((g) => g.whats),
      whos: AGENCY_GROUPS.flatMap((g) => g.whos),
      groups: AGENCY_GROUPS,
      sharedWhos: [],
      goals: ["Organize consulting-client email by company and project."],
      name: "Consulting Clients",
    },
    seededPrimaries: ["Portfolio Pro Advisors", "Stallion"],
    seededWhos: ["Margaret Potter", "George Trevino", "Farrukh Malik"],
    expectedDomains: ["portfolioproadvisors.com", "stallionis.com"],
    expectedDiscoveries: [],
  },
};

export function getEvalConfig(key: string): EvalSchemaConfig {
  if (!(key in EVAL_SCHEMAS)) {
    throw new Error(
      `Unknown eval schema: ${key}. Must be one of: ${Object.keys(EVAL_SCHEMAS).join(", ")}`,
    );
  }
  return EVAL_SCHEMAS[key as EvalSchemaKey];
}
