import fs from 'node:fs';
import path from 'node:path';

const SAMPLES_DIR = 'denim_samples_individual';

const KEYWORDS = [
  'invoice', 'scope', 'deliverable', 'review', 'deck',
  'proposal', 'contract', 'retainer', 'kickoff', 'status',
  'deadline', 'agreement', 'RFP', 'SOW', 'milestone',
  'feedback', 'approval', 'draft',
  'call', 'meeting', 'session', 'update', 'slides',
  'documents', 'demo', 'round', 'initiative', 'project',
];

const PUBLIC_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'hotmail.com',
  'aol.com', 'protonmail.com', 'proton.me', 'me.com', 'mac.com',
  'msn.com', 'live.com',
]);

// Exclude user's own domain (Nick's). Based on mail patterns.
const USER_DOMAIN = 'thecontrolsurface.com';

function extractDomain(fromHeader) {
  if (!fromHeader) return '';
  const m = fromHeader.match(/<([^>]+)>/);
  const addr = (m ? m[1] : fromHeader).trim().toLowerCase();
  const at = addr.indexOf('@');
  return at >= 0 ? addr.slice(at + 1).replace(/>$/, '') : '';
}

function subjectMatchesKeyword(subject) {
  const s = subject.toLowerCase();
  return KEYWORDS.some(kw => new RegExp(`\\b${kw.toLowerCase().replace(/\s+/g, '\\s+')}\\b`, 'i').test(s));
}

const files = fs.readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.json'));

const domainCounts = new Map(); // all emails (for comparison)
const filteredCounts = new Map(); // only keyword-matching emails

for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, f), 'utf8')); } catch { continue; }
  const headers = j.payload?.headers || [];
  const fromHdr = headers.find(h => h.name.toLowerCase() === 'from')?.value;
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
  const labels = j.labelIds || [];

  // Apply the Stage 1 filter: exclude promotions
  if (labels.includes('CATEGORY_PROMOTIONS')) continue;

  const domain = extractDomain(fromHdr);
  if (!domain) continue;

  // Stage 1 aggregation: drop generic providers and user's own domain
  if (PUBLIC_PROVIDERS.has(domain)) continue;
  if (domain === USER_DOMAIN) continue;

  domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);

  if (subjectMatchesKeyword(subject)) {
    filteredCounts.set(domain, (filteredCounts.get(domain) || 0) + 1);
  }
}

function top(n, map) {
  return [...map.entries()].sort((a,b) => b[1] - a[1]).slice(0, n);
}

console.log('=== Top 10 domains by RAW email count (no keyword filter, after dropping generics + user domain + promotions) ===');
for (const [d, n] of top(10, domainCounts)) console.log(`  ${n.toString().padStart(3)}  ${d}`);

console.log('\n=== Top 10 domains by KEYWORD-FILTERED count (this is what Stage 1 actually returns) ===');
for (const [d, n] of top(10, filteredCounts)) console.log(`  ${n.toString().padStart(3)}  ${d}`);

console.log('\n=== Where do portfolioproadvisors.com and stallionis.com rank? ===');
const sorted = top(50, filteredCounts);
const ppaRank = sorted.findIndex(([d]) => d === 'portfolioproadvisors.com');
const stRank = sorted.findIndex(([d]) => d === 'stallionis.com');
console.log(`  portfolioproadvisors.com: rank ${ppaRank >= 0 ? ppaRank + 1 : '>50'} (${filteredCounts.get('portfolioproadvisors.com') || 0} keyword-hits, ${domainCounts.get('portfolioproadvisors.com') || 0} total)`);
console.log(`  stallionis.com: rank ${stRank >= 0 ? stRank + 1 : '>50'} (${filteredCounts.get('stallionis.com') || 0} keyword-hits, ${domainCounts.get('stallionis.com') || 0} total)`);

console.log('\n=== Would they land in Stage 1 top-5? ===');
console.log(`  portfolioproadvisors.com in top 5: ${ppaRank >= 0 && ppaRank < 5 ? '✅ YES' : '❌ NO'}`);
console.log(`  stallionis.com in top 5: ${stRank >= 0 && stRank < 5 ? '✅ YES' : '❌ NO'}`);
