/**
 * Stage 1 + Stage 2 Real-Samples Validator (issue #95)
 *
 * Drives the REAL `discoverDomains` code path (imported from apps/web) through
 * a stub GmailClient that serves from `Denim_Samples_Individual/*.json`.
 * Unlike `simulate-stage1-domains.mjs` which re-implements the Stage 1 logic,
 * this script catches regressions in the actual pipeline (aggregator,
 * public-providers filter, topN slicing, query builder).
 *
 * Stage 2 section is scaffolded (see STAGE2_EXPECTED below). It runs when the
 * Stage 2 primitives land in `apps/web/src/lib/discovery/entity-discovery.ts`;
 * until then it prints the ground-truth expectations as a reference so Phase 2
 * implementers know the target to hit.
 *
 * Usage:
 *   npx tsx scripts/validate-stage1-real-samples.ts
 *
 * Stage 1 ground-truth checks:
 *   - property: judgefite.com should land in top 3
 *   - agency:   portfolioproadvisors.com top-2, stallionis.com top-5
 *
 * Stage 2 ground-truth checks (run once Phase 2 code lands):
 *   - property × judgefite.com  → 5 distinct addresses
 *   - agency   × portfolioproadvisors.com → 1 entity derived from domain
 *   - school_parent × email.teamsnap.com  → ZSA team entity
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOMAIN_SHAPES,
  type DomainName,
} from "../apps/web/src/lib/config/domain-shapes";
import { discoverDomains } from "../apps/web/src/lib/discovery/domain-discovery";

// Resolve SAMPLES_DIR relative to this script file so the validator works
// regardless of the caller's cwd (repo root OR apps/web — tsconfig-path
// resolution requires apps/web cwd, but samples live at repo root).
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.resolve(SCRIPT_DIR, "..", "Denim_Samples_Individual");
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
    // biome-ignore lint/suspicious/noExplicitAny: stub GmailClient for offline validation
    gmailClient: stub as any,
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
      "subject-regex address extractor: `\\b(\\d{3,5})\\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)\\b` with year-number guard (2000-2030 excluded)",
    expectedEntities: [
      {
        identityKey: "3910 Bucknell",
        minFrequency: 4,
        evidence:
          "5 subjects contain '3910 Bucknell' / '3910 Bucknell Drive' (invoice, MR, Plumbing×2, Garage Invoice). Dedup should fold Drive/no-Drive variants.",
      },
      {
        identityKey: "205 Freedom Trail",
        minFrequency: 5,
        evidence:
          "6 subjects contain '205 Freedom Trail' (Plumbing, Water Heater ×4, Re: Plumbing).",
      },
      {
        identityKey: "2310 Healey",
        minFrequency: 3,
        evidence:
          "4 subjects contain '2310 Healey' / '2310 Healey Drive' (Secondary Damages×2, Tenant Not Vacated×2).",
      },
      {
        identityKey: "3305 Cardinal",
        minFrequency: 1,
        evidence: "1 subject: '3305 Cardinal - Lease Expiring July 31, 2026'.",
      },
      {
        identityKey: "851 Peavy",
        minFrequency: 1,
        evidence: "1 subject: '851 Peavy Road-Invoices'.",
      },
    ],
  },
  {
    domain: "agency",
    confirmedDomain: "portfolioproadvisors.com",
    algorithmHint:
      "sender-derive: one PRIMARY entity per confirmed domain. identityKey = '@portfolioproadvisors.com'. Display label derived from domain (e.g., 'Portfolio Pro Advisors').",
    expectedEntities: [
      {
        identityKey: "@portfolioproadvisors.com",
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
      "sender-derive: one PRIMARY entity per confirmed domain. identityKey = '@stallionis.com'.",
    expectedEntities: [
      {
        identityKey: "@stallionis.com",
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
      "two-pattern regex: (a) institution/team name, (b) activity keyword. Team name appears in 'Updated <team> Event' and 'New game: <team> vs. <opponent>' subjects.",
    expectedEntities: [
      {
        displayMatch: /ZSA.*U11.*Girls/,
        minFrequency: 5,
        evidence:
          "10+ subjects contain 'ZSA U11/12 Girls Spring 2026 Competitive Rise' (Updated event ×5, New game ×2, implicit in practice reminders).",
      },
    ],
  },
];

/**
 * Stage 2 validation.
 *
 * Today Phase 2 code doesn't exist yet — this function attempts a dynamic
 * import of the Stage 2 entity-discovery module. On import failure it prints
 * the ground-truth expectations so Phase 2 implementers see the target.
 * Once Phase 2 lands, it will run Stage 2 against each expectation's samples
 * and report pass/fail per expected entity.
 */
async function runStage2(samples: Sample[]): Promise<void> {
  console.log(`\n=== Stage 2 ground-truth validation ===`);

  // biome-ignore lint/suspicious/noExplicitAny: dynamic import for module that may not yet exist
  let mod: any;
  try {
    mod = await import(
      // @ts-expect-error — path intentionally resolved at runtime; may not exist yet
      "../apps/web/src/lib/discovery/entity-discovery"
    );
  } catch {
    console.log(
      `\n  ⏳ Stage 2 not yet implemented. Target entity-discovery module:`,
    );
    console.log(`     apps/web/src/lib/discovery/entity-discovery.ts`);
    console.log(`\n  Ground-truth expectations (${STAGE2_EXPECTED.length} fixtures):\n`);
    for (const fx of STAGE2_EXPECTED) {
      console.log(
        `  • ${fx.domain} × ${fx.confirmedDomain} [${fx.algorithmHint.split(":")[0]}]`,
      );
      for (const e of fx.expectedEntities) {
        const target = e.identityKey ?? `(regex: ${e.displayMatch?.source})`;
        const freq = e.minFrequency ? ` ≥${e.minFrequency}×` : "";
        console.log(`      → ${target}${freq}`);
      }
    }
    console.log(
      `\n  When Phase 2 lands, this validator will run each fixture through the real dispatcher`,
    );
    console.log(
      `  and assert every expected entity appears with at least minFrequency occurrences.`,
    );
    return;
  }

  // Phase 2 code is present — run it.
  if (typeof mod.discoverEntities !== "function") {
    console.log(
      `  ❌ entity-discovery module exists but exports no 'discoverEntities' — skipping.`,
    );
    return;
  }

  let totalChecks = 0;
  let totalPass = 0;
  for (const fx of STAGE2_EXPECTED) {
    const domainSubjects = samples
      .filter((s) => {
        const m = s.from.match(/<([^>]+)>/) ?? s.from.match(/([^\s<>]+@[^\s<>]+)/);
        if (!m) return false;
        const at = m[1].indexOf("@");
        if (at < 0) return false;
        return m[1].slice(at + 1).toLowerCase() === fx.confirmedDomain;
      })
      .map((s) => ({ subject: s.subject, frequency: 1 }));

    console.log(
      `\n  ${fx.domain} × ${fx.confirmedDomain} (${domainSubjects.length} subjects):`,
    );
    let result: Array<{ identityKey?: string; displayString: string; frequency: number }>;
    try {
      result = await mod.discoverEntities({
        domain: fx.domain,
        confirmedDomain: fx.confirmedDomain,
        subjects: domainSubjects,
      });
    } catch (err) {
      console.log(`    ❌ discoverEntities threw: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const expected of fx.expectedEntities) {
      totalChecks++;
      const found = result.find((r) => {
        if (expected.identityKey && r.identityKey === expected.identityKey) return true;
        if (expected.displayMatch && expected.displayMatch.test(r.displayString)) return true;
        return false;
      });
      const freqOK =
        !expected.minFrequency || (found?.frequency ?? 0) >= expected.minFrequency;
      const mark = found && freqOK ? "✅" : "❌";
      if (found && freqOK) totalPass++;
      const target = expected.identityKey ?? `/${expected.displayMatch?.source}/`;
      console.log(
        `    ${mark} ${target}${expected.minFrequency ? ` (≥${expected.minFrequency}×)` : ""} ${found ? `→ found freq=${found.frequency}` : "→ NOT FOUND"}`,
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
