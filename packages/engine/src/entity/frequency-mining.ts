/**
 * Corpus n-gram frequency mining for Stage 2 entity extraction (issue #102).
 *
 * Pure algorithm — no I/O, no `Date.now()`, no `console.*`, no env reads.
 *
 * Given a set of email subjects (from one Stage-1-confirmed domain, or
 * narrowed to a paired WHO's senderEmail), return the longest proper-noun
 * phrases that repeat across ≥ `minFrequency` distinct subjects. Event-verb
 * stopwords (`game`, `practice`, `event`, ...) are filtered so noise like
 * `"New event: Practice"` doesn't register as a candidate entity.
 *
 * Complements Patterns A + B in `apps/web/src/lib/discovery/school-entity.ts`
 * for activity-platform notifications (TeamSnap, GameChanger, ClassDojo) where
 * the team name repeats but the surface form matches neither institution nor
 * activity regex (e.g. `"ZSA U11/12 Girls Spring 2026 Competitive Rise"`).
 *
 * Algorithm (spec § Algorithm):
 *   1. Cap each subject to 200 chars.
 *   2. Tokenize on whitespace + punctuation `: ) ( ] [ , ; ! ? " | . -` and the
 *      literal `vs.` separator. Preserve token case.
 *   3. Drop tokens of 1-2 chars unless all-uppercase.
 *   4. Generate n-grams per subject for n ∈ [2, maxNgramTokens].
 *   5. Drop n-grams that are all-stopword OR contain no proper-noun token.
 *   6. Count *distinct subjects* each n-gram appeared in.
 *   7. Maximal prune: drop G if superstring G' has the same distinct-subject
 *      count (keeps the longest form).
 *   8. Rank (count DESC, length DESC); keep count ≥ minFrequency; top-K.
 */

/**
 * Event-verb / stopword set: these words are relevance signals (good for
 * Stage 1 keyword filters) but not entity candidates. Case-insensitive.
 */
export const SCHOOL_EVENT_STOPWORDS: ReadonlySet<string> = new Set([
  "new",
  "game",
  "practice",
  "event",
  "reminder",
  "updated",
  "cancelled",
  "canceled",
  "vs",
  "rsvp",
  "reply",
  "fwd",
  "re",
  "for",
  "the",
  "and",
  "or",
  "a",
  "an",
  "to",
  "from",
  "at",
  "on",
  "in",
  "of",
]);

export interface FrequencyCandidate {
  /** The n-gram phrase as it appeared (casing preserved). */
  phrase: string;
  /** Number of distinct subjects the phrase appeared in. */
  frequency: number;
  /** Indices into the input `subjects` array where the phrase appeared. */
  subjectIndices: number[];
}

export interface MineOptions {
  /** Minimum distinct-subject count to surface (default 3). */
  minFrequency?: number;
  /** Upper bound on n-gram length in tokens (default 8). */
  maxNgramTokens?: number;
  /** Override stopword set (default SCHOOL_EVENT_STOPWORDS). */
  stopWords?: ReadonlySet<string>;
  /** Return top-K ranked candidates (default 20). */
  topK?: number;
}

const DEFAULT_MIN_FREQUENCY = 3;
const DEFAULT_MAX_NGRAM_TOKENS = 8;
const DEFAULT_TOP_K = 20;
const MAX_SUBJECT_LEN = 200;

// Punctuation characters that split tokens. Preserve alphanumeric inner
// punctuation like `U11/12` (slash kept inside token) but split on list
// delimiters, quotes, brackets, and end punctuation.
const SPLIT_CHARS = /[\s:(),;!?"[\]|.-]+/;

/**
 * Tokenize a subject into display tokens.
 *  - Strip the literal `vs.` separator (kept as its own word boundary).
 *  - Split on whitespace + punctuation.
 *  - Drop tokens of ≤2 chars unless all-uppercase (keeps `ZSA`, drops `of`).
 */
function tokenize(subject: string): string[] {
  // Replace `vs.` / `vs ` (word-bounded) with a space so it splits cleanly.
  const cleaned = subject.replace(/\bvs\.?\b/gi, " ");
  const raw = cleaned.split(SPLIT_CHARS);
  const out: string[] = [];
  for (const tok of raw) {
    if (tok.length === 0) continue;
    if (tok.length <= 2) {
      // Keep short tokens only if all-uppercase (acronyms).
      if (tok === tok.toUpperCase() && /[A-Z]/.test(tok)) {
        out.push(tok);
      }
      continue;
    }
    out.push(tok);
  }
  return out;
}

/**
 * Has at least one proper-noun-shaped token: capitalized 3+ char word,
 * all-caps abbreviation, or digit sequence of length ≥2.
 */
function hasProperNounToken(tokens: readonly string[]): boolean {
  for (const tok of tokens) {
    // All-caps abbreviation (any length where every letter is uppercase)
    if (tok === tok.toUpperCase() && /[A-Z]/.test(tok)) return true;
    // Capitalized word of 3+ chars (Title-case like `Girls`, `Competitive`)
    if (tok.length >= 3 && /^[A-Z][a-zA-Z]/.test(tok)) return true;
    // Digit sequence of length ≥2 (e.g. `2026`, `12`)
    if (/^\d{2,}/.test(tok)) return true;
    // Mixed alphanumeric like `U11/12` — starts with letter, contains digit
    if (/[A-Za-z]/.test(tok) && /\d/.test(tok) && tok.length >= 2) return true;
  }
  return false;
}

/**
 * True if every token (case-insensitive) is in the stopword set.
 */
function isAllStopwords(tokens: readonly string[], stopWords: ReadonlySet<string>): boolean {
  for (const tok of tokens) {
    if (!stopWords.has(tok.toLowerCase())) return false;
  }
  return true;
}

/**
 * Return all n-grams of lengths `[2, maxN]` from `tokens`, as arrays.
 * Each n-gram preserves original token case.
 */
function* generateNgrams(tokens: readonly string[], maxN: number): Generator<string[]> {
  const upper = Math.min(maxN, tokens.length);
  for (let n = 2; n <= upper; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      yield tokens.slice(i, i + n);
    }
  }
}

interface NgramAccumulator {
  phrase: string;
  tokens: string[];
  // Use Set for O(1) dedup of subject-index membership during counting.
  subjectIndexSet: Set<number>;
}

/**
 * Mine frequent proper-noun n-grams from a subject corpus.
 *
 * Pure function. Deterministic given identical inputs. Empty array for
 * corpora that produce no candidate at or above `minFrequency`.
 */
export function mineFrequentPhrases(
  subjects: ReadonlyArray<{ subject: string; frequency?: number }>,
  options?: MineOptions,
): FrequencyCandidate[] {
  const minFrequency = options?.minFrequency ?? DEFAULT_MIN_FREQUENCY;
  const maxNgramTokens = options?.maxNgramTokens ?? DEFAULT_MAX_NGRAM_TOKENS;
  const stopWords = options?.stopWords ?? SCHOOL_EVENT_STOPWORDS;
  const topK = options?.topK ?? DEFAULT_TOP_K;

  if (subjects.length === 0) return [];

  // Pass 1: build per-n-gram accumulators keyed by the canonical phrase
  // string (tokens joined by single space, original case preserved).
  const byPhrase = new Map<string, NgramAccumulator>();

  for (let i = 0; i < subjects.length; i++) {
    const raw = subjects[i].subject;
    if (!raw) continue;
    const capped = raw.length > MAX_SUBJECT_LEN ? raw.slice(0, MAX_SUBJECT_LEN) : raw;
    const tokens = tokenize(capped);
    if (tokens.length < 2) continue;

    // Per-subject dedup so one subject can't inflate the count of the same
    // n-gram twice (e.g. a phrase repeated within a long subject).
    const seenThisSubject = new Set<string>();

    for (const ngramTokens of generateNgrams(tokens, maxNgramTokens)) {
      const phrase = ngramTokens.join(" ");
      if (seenThisSubject.has(phrase)) continue;
      seenThisSubject.add(phrase);

      if (isAllStopwords(ngramTokens, stopWords)) continue;
      if (!hasProperNounToken(ngramTokens)) continue;

      let acc = byPhrase.get(phrase);
      if (!acc) {
        acc = { phrase, tokens: ngramTokens, subjectIndexSet: new Set() };
        byPhrase.set(phrase, acc);
      }
      acc.subjectIndexSet.add(i);
    }
  }

  // Pass 2: materialize and filter below threshold.
  const surviving: FrequencyCandidate[] = [];
  for (const acc of byPhrase.values()) {
    const frequency = acc.subjectIndexSet.size;
    if (frequency < minFrequency) continue;
    surviving.push({
      phrase: acc.phrase,
      frequency,
      subjectIndices: [...acc.subjectIndexSet].sort((a, b) => a - b),
    });
  }

  if (surviving.length === 0) return [];

  // Pass 3: maximal prune. Drop G if any strict superstring G' has the same
  // distinct-subject frequency. "Superstring" here means the token sequence
  // of G' contains G's token sequence as a contiguous sub-sequence.
  // We compare by phrase strings (which are token-joined) using simple
  // substring inclusion bounded by word boundaries (space-delimited).
  const phrases = surviving.map((s) => s.phrase);
  const kept: FrequencyCandidate[] = [];
  for (let i = 0; i < surviving.length; i++) {
    const g = surviving[i];
    let dominated = false;
    for (let j = 0; j < surviving.length; j++) {
      if (i === j) continue;
      const gp = surviving[j];
      if (gp.phrase.length <= g.phrase.length) continue;
      if (gp.frequency !== g.frequency) continue;
      // word-bounded substring match: check " " + gp + " " contains
      // " " + g + " " (pad both with spaces to enforce whole-token match).
      const needle = ` ${g.phrase} `;
      const haystack = ` ${gp.phrase} `;
      if (haystack.indexOf(needle) !== -1) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push(g);
  }

  // Pass 4: rank and slice.
  kept.sort((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    return b.phrase.length - a.phrase.length;
  });

  // Hold onto `phrases` (read but unused after dedup) to keep call-site
  // reviewers aware of its role — biome will flag if truly unused.
  void phrases;

  return kept.slice(0, topK);
}
