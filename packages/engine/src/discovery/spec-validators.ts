/**
 * Per-domain §5 alias-prohibition enforcement.
 *
 * Each `docs/domain-input-shapes/<domain>.md` §5 PRIMARY entity table
 * declares a set of "Aliases to NEVER GENERATE" rules. These rules are
 * written down but have historically never been enforced in code — that
 * gap is why "Bucknell" (alumni-newsletter fragment) kept leaking into
 * Property chip rows despite the spec explicitly forbidding it since
 * 2026-04-16.
 *
 * This module is the enforcement layer. It is called:
 *   1. Inside `scoreEntityCandidates` — a spec violation forces the
 *      candidate's score to −∞ (same class as platform-denylist).
 *   2. Inside `persistConfirmedEntities` as a last-chance gate — a
 *      user-confirmed entity that still violates spec §5 is rejected
 *      with a typed reason the UI can surface.
 *
 * Pure function. No I/O, no env, no AI.
 */

export type SchemaDomainName = "property" | "school_parent" | "agency";

export type SpecViolationCode =
  | "single_word_fragment"
  | "bare_number"
  | "generic_phrase"
  | "street_type_alone"
  | "generic_context_word"
  | "single_common_word"
  | "engagement_or_case_fragment";

export interface ValidationResult {
  valid: boolean;
  violationCode?: SpecViolationCode;
  rationale?: string;
}

/**
 * Per-property §5 forbidden aliases (property.md:137).
 * Single-word fragments of real addresses MUST NOT become PRIMARIES —
 * e.g., "Bucknell" (collides with Bucknell University / alumni), "Peavy"
 * (a surname / generic word), "Sylvan" (common street word).
 * Bare numbers like "3910" / "851" MUST NOT become PRIMARIES.
 * Generic phrases MUST NOT become PRIMARIES.
 */
const PROPERTY_GENERIC_PHRASES = new Set([
  "the house",
  "the place",
  "property",
  "properties",
  "building",
  "rental",
  "rentals",
  "unit",
]);

const PROPERTY_STREET_TYPES = new Set([
  "street",
  "st",
  "road",
  "rd",
  "avenue",
  "ave",
  "boulevard",
  "blvd",
  "drive",
  "dr",
  "lane",
  "ln",
  "court",
  "ct",
  "trail",
  "way",
  "point",
  "parkway",
  "pkwy",
]);

/**
 * Per-school §5 forbidden aliases (school_parent.md:146):
 * generic context words (`team`, `practice`, `lesson`, `game`,
 * `tournament`, `season`, `class`, `fall`, `spring`) on their own.
 */
const SCHOOL_GENERIC_CONTEXT_WORDS = new Set([
  "team",
  "teams",
  "practice",
  "practices",
  "lesson",
  "lessons",
  "class",
  "classes",
  "game",
  "games",
  "tournament",
  "tournaments",
  "season",
  "seasons",
  "fall",
  "spring",
  "summer",
  "winter",
  "school",
  "registration",
  "schedule",
  "parent",
  "coach",
  "teacher",
]);

/**
 * Per-agency §5 forbidden aliases (agency.md:132):
 * generic words (`client`, `company`, `account`) — these are category
 * nouns, not client company names.
 */
const AGENCY_GENERIC_WORDS = new Set([
  "client",
  "clients",
  "company",
  "companies",
  "account",
  "accounts",
  "customer",
  "vendor",
  "partner",
  "project",
  "projects",
]);

/**
 * Shared hint phrases that indicate an engagement / CASE rather than a
 * PRIMARY topic. Spans multiple domains — engagements are case-level
 * artifacts per master-plan time-durability test (principle #2).
 */
const ENGAGEMENT_INDICATORS = [
  /\b(meeting|session|review|call|demo)\s*#?\d+\b/i,
  /\b(v\d+)\s+(update|release|launch|draft)\b/i,
  /\b(kpi|q[1-4]|quarterly|annual)\s+(dashboard|report|review)\b/i,
  /\b(test\s+(sample|data|tape|file))\b/i,
  /\b(draft|proposal|deck|invoice|statement)\s*#?\d+\b/i,
  // Engagement-shaped trailing nouns — a name ending in an action/deliverable
  // word is almost always a CASE-level artifact (engagement, meeting,
  // deliverable) rather than a durable PRIMARY topic.
  /\b(demo|review|update|release|briefing|walkthrough|kickoff|standup)$/i,
  // "<adjective> Round" patterns (intermediate/final/initial/etc. round)
  /\b(intermediate|final|initial|interim|discovery|preliminary)\s+round\b/i,
];

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function isBareNumber(name: string): boolean {
  return /^\d+$/.test(name.trim());
}

function isStreetTypeAlone(name: string): boolean {
  const tokens = tokenize(name);
  // Single token that is itself a street type
  if (tokens.length === 1 && PROPERTY_STREET_TYPES.has(tokens[0])) return true;
  // Street-name + street-type WITHOUT a number (e.g. "Bucknell Drive")
  if (tokens.length === 2 && PROPERTY_STREET_TYPES.has(tokens[1]) && !/\d/.test(tokens[0])) {
    return true;
  }
  return false;
}

function looksLikeEngagement(name: string): boolean {
  return ENGAGEMENT_INDICATORS.some((re) => re.test(name));
}

function validateProperty(name: string): ValidationResult {
  const raw = name.trim();
  if (raw.length === 0) {
    return { valid: false, violationCode: "single_word_fragment", rationale: "empty name" };
  }
  if (isBareNumber(raw)) {
    return { valid: false, violationCode: "bare_number", rationale: `"${raw}" is just digits` };
  }
  const lower = raw.toLowerCase();
  if (PROPERTY_GENERIC_PHRASES.has(lower)) {
    return {
      valid: false,
      violationCode: "generic_phrase",
      rationale: `"${raw}" is a generic phrase`,
    };
  }
  if (isStreetTypeAlone(raw)) {
    return {
      valid: false,
      violationCode: "street_type_alone",
      rationale: `"${raw}" lacks a house number — spec §5 forbids street-type-alone aliases`,
    };
  }
  const tokens = tokenize(raw);
  // Single-word fragment with no digit — e.g. "Bucknell", "Peavy", "Sylvan"
  if (tokens.length === 1 && !/\d/.test(raw)) {
    return {
      valid: false,
      violationCode: "single_word_fragment",
      rationale: `"${raw}" is a single-word fragment (property.md §5)`,
    };
  }
  if (looksLikeEngagement(raw)) {
    return {
      valid: false,
      violationCode: "engagement_or_case_fragment",
      rationale: `"${raw}" looks like an engagement / case, not a PRIMARY`,
    };
  }
  return { valid: true };
}

function validateSchoolParent(name: string): ValidationResult {
  const raw = name.trim();
  if (raw.length === 0) {
    return { valid: false, violationCode: "single_word_fragment", rationale: "empty name" };
  }
  const lower = raw.toLowerCase();
  const tokens = tokenize(raw);
  if (tokens.length === 1 && SCHOOL_GENERIC_CONTEXT_WORDS.has(tokens[0])) {
    return {
      valid: false,
      violationCode: "generic_context_word",
      rationale: `"${raw}" is a generic context word (school_parent.md §5)`,
    };
  }
  // Multi-word entirely composed of generic context words
  if (tokens.length > 1 && tokens.every((t) => SCHOOL_GENERIC_CONTEXT_WORDS.has(t))) {
    return {
      valid: false,
      violationCode: "generic_context_word",
      rationale: `"${raw}" is composed entirely of generic context words`,
    };
  }
  if (isBareNumber(raw)) {
    return { valid: false, violationCode: "bare_number", rationale: `"${raw}" is just digits` };
  }
  if (looksLikeEngagement(raw)) {
    return {
      valid: false,
      violationCode: "engagement_or_case_fragment",
      rationale: `"${raw}" looks like an engagement / event, not a durable PRIMARY`,
    };
  }
  // Pure year references ("FALL 2025", "Spring 2026") — caught by seasonal + year check
  if (/^(fall|spring|summer|winter)\s+\d{4}$/i.test(lower)) {
    return {
      valid: false,
      violationCode: "engagement_or_case_fragment",
      rationale: `"${raw}" is a seasonal date descriptor`,
    };
  }
  return { valid: true };
}

function validateAgency(name: string): ValidationResult {
  const raw = name.trim();
  if (raw.length === 0) {
    return { valid: false, violationCode: "single_word_fragment", rationale: "empty name" };
  }
  const lower = raw.toLowerCase();
  const tokens = tokenize(raw);
  if (tokens.length === 1 && AGENCY_GENERIC_WORDS.has(tokens[0])) {
    return {
      valid: false,
      violationCode: "generic_context_word",
      rationale: `"${raw}" is a generic agency word (agency.md §5)`,
    };
  }
  // Single common-word fragments — person first-names, single product/brand
  // words. "Nick", "PPA" (acronym alone), "Pro" (from "Portfolio Pro Advisors").
  // We can't enumerate every first name, but we can require that single-word
  // client names must (a) contain a digit, OR (b) be ≥4 characters AND not
  // a common first-name noise marker. For phase 1 of the rule, enforce:
  // single-word entries ≤3 characters (PPA, Nic) are rejected — too short
  // to be unambiguous client names.
  if (tokens.length === 1 && tokens[0].length <= 3) {
    return {
      valid: false,
      violationCode: "single_common_word",
      rationale: `"${raw}" is too short — single-word fragments (≤3 chars) ambiguous for agency PRIMARIES`,
    };
  }
  if (isBareNumber(raw)) {
    return { valid: false, violationCode: "bare_number", rationale: `"${raw}" is just digits` };
  }
  if (looksLikeEngagement(raw)) {
    return {
      valid: false,
      violationCode: "engagement_or_case_fragment",
      rationale: `"${raw}" looks like an engagement (project/meeting/deliverable), not a client PRIMARY`,
    };
  }
  return { valid: true };
}

/**
 * Validate an entity candidate's name against the per-domain §5
 * alias-prohibition rules. Returns `{valid:true}` when the name is
 * acceptable; `{valid:false, violationCode, rationale}` when the name
 * matches a forbidden shape.
 */
export function validateEntityAgainstSpec(args: {
  name: string;
  schemaDomain: SchemaDomainName;
}): ValidationResult {
  switch (args.schemaDomain) {
    case "property":
      return validateProperty(args.name);
    case "school_parent":
      return validateSchoolParent(args.name);
    case "agency":
      return validateAgency(args.name);
  }
}
