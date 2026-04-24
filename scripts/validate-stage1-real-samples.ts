/**
 * Stage 1 + Stage 2 Real-Samples Validator (issue #95)
 *
 * Drives the REAL production code paths (`discoverDomains` + `discoverEntitiesForDomain`)
 * imported from apps/web through a stub GmailClient that serves from
 * `denim_samples_individual/*.json`. Unlike `simulate-stage1-domains.mjs` which
 * re-implements Stage 1, this script catches regressions in the actual pipeline
 * (aggregator, public-providers filter, topN slicing, query builder, Stage 2
 * dispatcher, per-domain algorithms, Levenshtein dedup).
 *
 * Usage:
 *   cd apps/web && npx tsx ../../scripts/validate-stage1-real-samples.ts
 *   (Must run from apps/web cwd so tsconfig `@/*` paths resolve.)
 *
 * Stage 1 ground-truth checks:
 *   - property: judgefite.com should land in top 3
 *   - agency:   portfolioproadvisors.com top-2, stallionis.com top-5
 *   - school_parent: email.teamsnap.com should be discovered
 *
 * Stage 2 ground-truth checks (run against the real Stage 2 dispatcher):
 *   - property × judgefite.com           → 5 distinct address entities
 *   - agency   × portfolioproadvisors.com → 1 entity keyed by domain
 *   - agency   × stallionis.com          → 1 entity keyed by domain
 *   - school_parent × email.teamsnap.com  → ZSA team entity (activity-pattern match)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOMAIN_SHAPES,
  type DomainName,
} from "../apps/web/src/lib/config/domain-shapes";
import { discoverDomains } from "../apps/web/src/lib/discovery/domain-discovery";
import { discoverEntitiesForDomain } from "../apps/web/src/lib/discovery/entity-discovery";

// Resolve SAMPLES_DIR relative to this script file so the validator works
// regardless of the caller's cwd (repo root OR apps/web — tsconfig-path
// resolution requires apps/web cwd, but samples live at repo root).
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.resolve(SCRIPT_DIR, "..", "denim_samples_individual");
const USER_DOMAIN = "thecontrolsurface.com";

interface Sample {
  id: string;
  from: string;
  subject: string;
  labelIds: string[];
  internalDate: number; // ms since epoch
}

function loadSamples(): Sample[] {
  const files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".json"));
  const out: Sample[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(
        fs.readFileSync(path.join(SAMPLES_DIR, f), "utf8"),
      );
      const headers: Array<{ name: string; value: string }> =
        j.payload?.headers ?? [];
      const get = (n: string) =>
        headers.find((h) => h.name.toLowerCase() === n)?.value ?? "";
      out.push({
        id: String(j.id),
        from: get("from"),
        subject: get("subject"),
        labelIds: j.labelIds ?? [],
        internalDate: Number(j.internalDate ?? 0),
      });
    } catch {
      // malformed JSON — skip
    }
  }
  return out;
}

function makeStubGmail(samples: Sample[], domain: DomainName) {
  const shape = DOMAIN_SHAPES[domain];
  const keywordRegexes = shape.stage1Keywords.map(
    (kw) => new RegExp(`\\b${kw.toLowerCase().replace(/\s+/g, "\\s+")}\\b`, "i"),
  );
  const byId = new Map<string, Sample>();
  for (const s of samples) byId.set(s.id, s);

  return {
    listMessageIds: async (query: string, limit: number): Promise<string[]> => {
      // Parse lookback days from the real Stage 1 query (newer_than:Nd).
      const lookbackMatch = query.match(/newer_than:(\d+)d/);
      const lookbackDays = lookbackMatch ? Number(lookbackMatch[1]) : 365;
      const cutoff = Date.now() - lookbackDays * 86_400_000;

      const ids: string[] = [];
      for (const s of samples) {
        if (s.labelIds.includes("CATEGORY_PROMOTIONS")) continue;
        if (s.internalDate < cutoff) continue;
        const subjLower = s.subject.toLowerCase();
        if (!keywordRegexes.some((re) => re.test(subjLower))) continue;
        ids.push(s.id);
        if (ids.length >= limit) break;
      }
      return ids;
    },

    getMessageMetadata: async (
      messageId: string,
    ): Promise<{
      id: string;
      payload: { headers: Array<{ name: string; value: string }> };
    }> => {
      const s = byId.get(messageId);
      if (!s) throw new Error(`Unknown message ID: ${messageId}`);
      return {
        id: messageId,
        payload: {
          headers: [{ name: "From", value: s.from }],
        },
      };
    },
  };
}

async function runDomain(
  samples: Sample[],
  domain: DomainName,
): Promise<Array<{ domain: string; count: number }>> {
  const stub = makeStubGmail(samples, domain);
  const result = await discoverDomains({
    gmailClient: stub,
    domain,
    userDomain: USER_DOMAIN,
  });

  console.log(`\n=== Domain: ${domain} (topN=${DOMAIN_SHAPES[domain].stage1TopN}) ===`);
  console.log(`Messages passed to aggregator: ${result.messagesSeen}`);
  console.log(`Error count: ${result.errorCount}`);
  console.log(`Query: ${result.queryUsed.slice(0, 120)}${result.queryUsed.length > 120 ? "…" : ""}`);
  console.log(`Candidates:`);
  for (let i = 0; i < result.candidates.length; i++) {
    const c = result.candidates[i];
    console.log(
      `  ${(i + 1).toString().padStart(2)}. ${c.count.toString().padStart(3)}  ${c.domain}`,
    );
  }
  return result.candidates;
}

function rank(
  candidates: Array<{ domain: string; count: number }>,
  target: string,
): number {
  return candidates.findIndex((c) => c.domain === target);
}

/**
 * STAGE 2 GROUND TRUTH
 *
 * Hand-labeled expectations derived from the 417-sample corpus on 2026-04-17.
 * Each entry pairs a (domain, confirmedDomain) Stage-1 output with the entities
 * Phase 2 Stage 2 code should extract when fed subjects from that domain.
 *
 * Phase 2 implementers: your Stage 2 code must produce at least the entities
 * listed in `expectedEntities` (by `identityKey` match or `displayMatch` regex).
 * Extra entities are fine. Missing any expected entity is a regression.
 *
 * Evidence for each expectation is commented inline — all subjects are real
 * strings from the sample corpus.
 */
interface Stage2Expectation {
  domain: DomainName;
  confirmedDomain: string;
  expectedEntities: Array<{
    /** Dedup identity key (the value that should land in `Entity.identityKey`). */
    identityKey?: string;
    /** Or a display-string regex — useful when the algorithm may derive different labels. */
    displayMatch?: RegExp;
    /** Minimum expected frequency across the domain's subjects. */
    minFrequency?: number;
    /** Human-readable why-this-matters. */
    evidence: string;
  }>;
  algorithmHint: string;
}

const STAGE2_EXPECTED: Stage2Expectation[] = [
  {
    domain: "property",
    confirmedDomain: "judgefite.com",
    algorithmHint:
      "subject-regex address extractor. Candidate.key is `normalizeAddressKey`-ed (lowercased + street-type collapsed, e.g., 'Drive' → 'dr'). Matching uses displayMatch regex to tolerate both 'Dr' and 'Drive' variants that land in separate buckets when users mix street-type spelling.",
    expectedEntities: [
      {
        displayMatch: /3910\s+Bucknell/i,
        minFrequency: 4,
        evidence:
          "5 subjects contain '3910 Bucknell' / '3910 Bucknell Drive' (invoice, MR, Plumbing×2, Garage Invoice). Majority uses 'Drive' spelling so the 'dr' bucket wins on frequency.",
      },
      {
        displayMatch: /205\s+Freedom\s+Trail/i,
        minFrequency: 5,
        evidence:
          "6 subjects contain '205 Freedom Trail' (Plumbing, Water Heater ×4, Re: Plumbing). Unambiguous — single bucket.",
      },
      {
        displayMatch: /2310\s+Healey/i,
        minFrequency: 2,
        evidence:
          "4 subjects split 2-2 between 'Drive' and no-Drive variants → two buckets of freq=2 each. minFrequency relaxed to 2.",
      },
      {
        displayMatch: /3305\s+Cardinal/i,
        minFrequency: 1,
        evidence: "1 subject: '3305 Cardinal - Lease Expiring July 31, 2026'.",
      },
      {
        displayMatch: /851\s+Peavy/i,
        minFrequency: 1,
        evidence:
          "1 subject: '851 Peavy Road-Invoices'. Regex also ensures we catch the Road/no-Road bucket whichever wins.",
      },
    ],
  },
  {
    domain: "agency",
    confirmedDomain: "portfolioproadvisors.com",
    algorithmHint:
      "sender-derive: one PRIMARY entity per confirmed domain. Candidate.key = authoritativeDomain (bare domain, no '@'). Display label derived from domain (e.g., 'Portfolio Pro Advisors') or from ≥80% display-name token convergence.",
    expectedEntities: [
      {
        identityKey: "portfolioproadvisors.com",
        displayMatch: /portfolio\s*pro\s*advisors|PPA/i,
        evidence:
          "15 emails from portfolioproadvisors.com. Subjects name 'PPA' directly (e.g., 'PPA | Nick AI Initiative', 'AI Session #2 PPA & Nick'). Agency algorithm derives display from domain, not subject regex.",
      },
    ],
  },
  {
    domain: "agency",
    confirmedDomain: "stallionis.com",
    algorithmHint:
      "sender-derive: one PRIMARY entity per confirmed domain. Candidate.key = authoritativeDomain (bare domain, no '@').",
    expectedEntities: [
      {
        identityKey: "stallionis.com",
        displayMatch: /stallion/i,
        evidence:
          "4 emails: 'Few documents', 'V7 Update - Teams Call', 'Stallion slides', 'Guest Speaker Talk - James — AI — What It Means For Stallion'. Display label should reference 'Stallion'.",
      },
    ],
  },
  {
    domain: "school_parent",
    confirmedDomain: "email.teamsnap.com",
    algorithmHint:
      "school-three-pattern (#102): (A) institution regex (religious-prefix or suffix-bearing), (B) activity regex (e.g., 'U11 Soccer', 'FRC Robotics'), (C) corpus frequency mining. Pattern C surfaces the repeating proper-noun phrase 'ZSA U11/12 Girls Spring 2026 Competitive Rise' from 10+ subjects. Pre-#102 this fixture was scaffolded to fail (A/B don't match TeamSnap event-notification subjects); with Pattern C it should now pass.",
    expectedEntities: [
      {
        displayMatch: /ZSA.*U11.*Girls/,
        minFrequency: 5,
        evidence:
          "10+ subjects contain 'ZSA U11/12 Girls Spring 2026 Competitive Rise' (Updated event ×5, New game ×2). Pattern C (#102) catches repeating proper-noun n-grams.",
      },
    ],
  },
];

/**
 * Build a Stage-2-flavored stub GmailClient for a specific confirmed domain.
 * The real dispatcher issues `from:*@<confirmedDomain> newer_than:Nd` and
 * calls `getMessageMetadata(id, ["Subject", "From"])`. The stub filters
 * samples by sender domain (case-insensitive, exact match) and serves both
 * headers verbatim. Lookback parsing mirrors Stage 1's stub for consistency,
 * but Stage 2 emails are almost always inside the lookback so this is mostly
 * belt-and-suspenders.
 */
function makeStage2StubGmail(samples: Sample[], confirmedDomain: string) {
  const target = confirmedDomain.toLowerCase();
  const byId = new Map<string, Sample>();
  for (const s of samples) byId.set(s.id, s);

  function senderDomain(from: string): string {
    const m = from.match(/<([^>]+)>/) ?? from.match(/([^\s<>]+@[^\s<>]+)/);
    if (!m) return "";
    const at = m[1].indexOf("@");
    return at < 0 ? "" : m[1].slice(at + 1).toLowerCase();
  }

  return {
    listMessageIds: async (query: string, limit: number): Promise<string[]> => {
      const lookbackMatch = query.match(/newer_than:(\d+)d/);
      const lookbackDays = lookbackMatch ? Number(lookbackMatch[1]) : 365;
      const cutoff = Date.now() - lookbackDays * 86_400_000;

      const ids: string[] = [];
      for (const s of samples) {
        if (s.internalDate < cutoff) continue;
        if (senderDomain(s.from) !== target) continue;
        ids.push(s.id);
        if (ids.length >= limit) break;
      }
      return ids;
    },

    getMessageMetadata: async (
      messageId: string,
    ): Promise<{
      id: string;
      payload: { headers: Array<{ name: string; value: string }> };
    }> => {
      const s = byId.get(messageId);
      if (!s) throw new Error(`Unknown message ID: ${messageId}`);
      return {
        id: messageId,
        payload: {
          headers: [
            { name: "Subject", value: s.subject },
            { name: "From", value: s.from },
          ],
        },
      };
    },
  };
}

/**
 * Run each STAGE2_EXPECTED fixture through the real `discoverEntitiesForDomain`
 * dispatcher. Matching checks candidate.key against expected.identityKey, and/or
 * candidate.displayString against expected.displayMatch. minFrequency, when set,
 * asserts candidate.frequency ≥ minFrequency.
 */
async function runStage2(samples: Sample[]): Promise<void> {
  console.log(`\n=== Stage 2 ground-truth validation ===`);

  let totalChecks = 0;
  let totalPass = 0;
  for (const fx of STAGE2_EXPECTED) {
    const stub = makeStage2StubGmail(samples, fx.confirmedDomain);
    const subjectsInSamples = samples.filter(
      (s) => {
        const m = s.from.match(/<([^>]+)>/) ?? s.from.match(/([^\s<>]+@[^\s<>]+)/);
        if (!m) return false;
        const at = m[1].indexOf("@");
        return at >= 0 && m[1].slice(at + 1).toLowerCase() === fx.confirmedDomain;
      },
    ).length;

    console.log(
      `\n  ${fx.domain} × ${fx.confirmedDomain} (${subjectsInSamples} subjects in corpus):`,
    );

    let result: Awaited<ReturnType<typeof discoverEntitiesForDomain>>;
    try {
      result = await discoverEntitiesForDomain({
        gmailClient: stub,
        schemaDomain: fx.domain,
        confirmedDomain: fx.confirmedDomain,
      });
    } catch (err) {
      console.log(
        `    ❌ discoverEntitiesForDomain threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    console.log(
      `    algorithm=${result.algorithm}, subjectsScanned=${result.subjectsScanned}, errors=${result.errorCount}, candidates=${result.candidates.length}`,
    );
    if (result.candidates.length > 0) {
      console.log(`    produced candidates:`);
      for (const c of result.candidates) {
        console.log(
          `      - key="${c.key}" display="${c.displayString}" freq=${c.frequency}`,
        );
      }
    }

    for (const expected of fx.expectedEntities) {
      totalChecks++;
      const found = result.candidates.find((c) => {
        if (expected.identityKey && c.key === expected.identityKey) return true;
        if (expected.displayMatch && expected.displayMatch.test(c.displayString)) return true;
        return false;
      });
      const freqOK =
        !expected.minFrequency || (found?.frequency ?? 0) >= expected.minFrequency;
      const mark = found && freqOK ? "✅" : "❌";
      if (found && freqOK) totalPass++;
      const target = expected.identityKey ?? `/${expected.displayMatch?.source}/`;
      const detail = found
        ? `→ found key="${found.key}" display="${found.displayString}" freq=${found.frequency}`
        : `→ NOT FOUND`;
      console.log(
        `    ${mark} ${target}${expected.minFrequency ? ` (≥${expected.minFrequency}×)` : ""} ${detail}`,
      );
    }
  }

  console.log(`\n  Stage 2 total: ${totalPass}/${totalChecks} expectations met.`);
}

async function main() {
  const samples = loadSamples();
  const withinLookback = samples.filter(
    (s) => s.internalDate >= Date.now() - 365 * 86_400_000,
  );
  console.log(
    `Loaded ${samples.length} samples from ${SAMPLES_DIR} (${withinLookback.length} within 365d lookback)`,
  );

  const propertyTop = await runDomain(samples, "property");
  const agencyTop = await runDomain(samples, "agency");
  await runDomain(samples, "school_parent");

  // Stage 1 ground-truth assertions
  console.log(`\n=== Stage 1 ground-truth checks ===`);

  const jfRank = rank(propertyTop, "judgefite.com");
  const jfMark =
    jfRank >= 0 && jfRank < DOMAIN_SHAPES.property.stage1TopN ? "✅" : "❌";
  console.log(
    `${jfMark} property: judgefite.com rank = ${jfRank >= 0 ? jfRank + 1 : "NOT FOUND"} (target: top ${DOMAIN_SHAPES.property.stage1TopN})`,
  );

  const ppaRank = rank(agencyTop, "portfolioproadvisors.com");
  const ppaMark =
    ppaRank >= 0 && ppaRank < DOMAIN_SHAPES.agency.stage1TopN ? "✅" : "❌";
  console.log(
    `${ppaMark} agency:   portfolioproadvisors.com rank = ${ppaRank >= 0 ? ppaRank + 1 : "NOT FOUND"} (target: top ${DOMAIN_SHAPES.agency.stage1TopN})`,
  );

  const stRank = rank(agencyTop, "stallionis.com");
  const stMark =
    stRank >= 0 && stRank < DOMAIN_SHAPES.agency.stage1TopN ? "✅" : "❌";
  console.log(
    `${stMark} agency:   stallionis.com rank = ${stRank >= 0 ? stRank + 1 : "NOT FOUND"} (target: top ${DOMAIN_SHAPES.agency.stage1TopN})`,
  );

  // Stage 2 ground-truth (scaffolded — runs once Phase 2 lands)
  await runStage2(samples);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
