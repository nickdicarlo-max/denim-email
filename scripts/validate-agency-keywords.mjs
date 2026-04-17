import fs from 'node:fs';
import path from 'node:path';

const SAMPLES_DIR = 'Denim_Samples_Individual';

const TARGET_SENDERS = [
  'mpotter@portfolioproadvisors.com',
  'gtrevino@portfolioproadvisors.com',
  'fmalik@stallionis.com',
];

// Agency Stage 1 keywords from docs/domain-input-shapes/agency.md Section 3
const KEYWORDS = [
  'invoice', 'scope', 'deliverable', 'review', 'deck',
  'proposal', 'contract', 'retainer', 'kickoff', 'status',
  'deadline', 'agreement', 'RFP', 'SOW', 'milestone',
  'feedback', 'approval', 'draft',
  // Added 2026-04-16 post-validation
  'call', 'meeting', 'session', 'update', 'slides',
  'documents', 'demo', 'round', 'initiative', 'project',
];

function decodeBody(part) {
  if (!part?.body?.data) return '';
  const data = part.body.data;
  if (Array.isArray(data)) {
    return Buffer.from(data).toString('utf8');
  }
  if (typeof data === 'string') {
    return Buffer.from(data, 'base64').toString('utf8');
  }
  return '';
}

function getBodyText(payload) {
  let text = '';
  const walk = (p) => {
    if (!p) return;
    if (p.parts) {
      for (const sp of p.parts) walk(sp);
    } else {
      text += '\n' + decodeBody(p);
    }
  };
  walk(payload);
  return text;
}

function extractSenderEmail(fromHeader) {
  if (!fromHeader) return '';
  const m = fromHeader.match(/<([^>]+)>/);
  return (m ? m[1] : fromHeader).trim().toLowerCase();
}

const files = fs.readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.json'));
console.log(`Scanning ${files.length} emails...\n`);

const perSender = new Map();
for (const s of TARGET_SENDERS) perSender.set(s, []);

for (const f of files) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, f), 'utf8'));
  } catch {
    continue;
  }
  const headers = j.payload?.headers || [];
  const fromHdr = headers.find(h => h.name.toLowerCase() === 'from')?.value;
  const sender = extractSenderEmail(fromHdr);
  if (!TARGET_SENDERS.includes(sender)) continue;
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
  const body = getBodyText(j.payload);
  perSender.get(sender).push({ file: f, subject, body, snippet: j.snippet || '' });
}

// Report
for (const [sender, emails] of perSender) {
  console.log(`\n=== ${sender}: ${emails.length} emails ===`);
  if (emails.length === 0) continue;

  // Subject-level keyword hits (this is what Stage 1 Gmail query actually does)
  const subjectHits = new Map();
  for (const kw of KEYWORDS) subjectHits.set(kw, []);
  let subjectMatchCount = 0;
  for (const e of emails) {
    const subjLow = e.subject.toLowerCase();
    let hit = false;
    for (const kw of KEYWORDS) {
      // Gmail subject: operator does case-insensitive word match; simulate with word boundary
      const kwLow = kw.toLowerCase();
      const re = new RegExp(`\\b${kwLow.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (re.test(subjLow)) {
        subjectHits.get(kw).push(e.subject);
        hit = true;
      }
    }
    if (hit) subjectMatchCount++;
  }
  console.log(`  Subject-keyword Stage 1 match: ${subjectMatchCount}/${emails.length} (${(100*subjectMatchCount/emails.length).toFixed(0)}%)`);
  console.log(`  Per-keyword subject hits:`);
  const sorted = [...subjectHits.entries()].sort((a,b) => b[1].length - a[1].length);
  for (const [kw, hits] of sorted) {
    if (hits.length) console.log(`    ${kw.padEnd(12)}: ${hits.length}`);
  }

  // Body-level keyword hits (useful context; Gmail query doesn't use body but tells us what's in these emails)
  const bodyHits = new Map();
  for (const kw of KEYWORDS) bodyHits.set(kw, 0);
  for (const e of emails) {
    const bodyLow = e.body.toLowerCase();
    for (const kw of KEYWORDS) {
      const kwLow = kw.toLowerCase();
      const re = new RegExp(`\\b${kwLow.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (re.test(bodyLow)) bodyHits.set(kw, bodyHits.get(kw) + 1);
    }
  }
  const bodyTotal = [...bodyHits.values()].reduce((a,b) => Math.max(a,b), 0);
  console.log(`  Body keyword context (any keyword appearing): top 5:`);
  const bodySorted = [...bodyHits.entries()].sort((a,b) => b[1] - a[1]).slice(0, 5);
  for (const [kw, n] of bodySorted) {
    if (n) console.log(`    ${kw.padEnd(12)}: ${n}`);
  }

  // Sample missed subjects (first 10 that had NO keyword hit — to eyeball what we're missing)
  const missed = emails.filter(e => {
    const subjLow = e.subject.toLowerCase();
    return !KEYWORDS.some(kw => new RegExp(`\\b${kw.toLowerCase().replace(/\s+/g, '\\s+')}\\b`, 'i').test(subjLow));
  });
  if (missed.length) {
    console.log(`  ${missed.length} subjects did NOT match any agency keyword. First ${Math.min(missed.length, 10)}:`);
    for (const e of missed.slice(0, 10)) console.log(`    "${e.subject}"`);
  }
}

// Aggregate Stage-1 recall across all 3 senders
let grandTotal = 0, grandHit = 0;
for (const emails of perSender.values()) {
  for (const e of emails) {
    grandTotal++;
    const subjLow = e.subject.toLowerCase();
    if (KEYWORDS.some(kw => new RegExp(`\\b${kw.toLowerCase().replace(/\s+/g, '\\s+')}\\b`, 'i').test(subjLow))) grandHit++;
  }
}
console.log(`\n=== Aggregate Stage-1 recall across 3 known-agency senders: ${grandHit}/${grandTotal} (${(100*grandHit/grandTotal).toFixed(0)}%) ===`);
