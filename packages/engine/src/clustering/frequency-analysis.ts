/**
 * Frequency analysis for coarse clusters.
 * Pure functions, zero I/O, no side effects.
 */

import type { FrequencyWord, FrequencyTable } from "@denim/types";

/** Input email for frequency analysis. */
export interface FrequencyEmailInput {
  id: string;
  subject: string;
  summary: string;
}

/** A coarse cluster to analyze. */
export interface CoarseClusterInput {
  clusterId: string;
  entityName: string;
  emails: FrequencyEmailInput[];
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "at", "by", "with", "from",
  "about", "into", "through", "during", "before", "after", "above",
  "below", "between", "out", "off", "over", "under", "again", "further",
  "then", "once", "here", "there", "where", "when", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "as", "until", "while", "up", "down", "and", "but",
  "or", "if", "this", "that", "these", "those", "it", "its", "he", "she",
  "they", "we", "you", "i", "me", "my", "your", "his", "her", "their",
  "our", "what", "which", "who", "whom", "re", "fw", "fwd", "am", "pm",
  "also", "get", "got", "new", "one", "two", "many", "much", "well",
  "still", "back", "even", "like", "let", "us",
]);

const MAX_WORDS_PER_CLUSTER = 30;
const HIGH_FREQUENCY_THRESHOLD = 0.9;
const CROSS_ENTITY_THRESHOLD = 0.5;
const CROSS_ENTITY_PENALTY = 0.5;
const CO_OCCURRENCE_THRESHOLD = 0.7;

/**
 * Tokenize text into lowercase alphanumeric words,
 * filtering stop words, single-char words, and pure numbers.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(
      (token) =>
        token.length > 1 &&
        !STOP_WORDS.has(token) &&
        !/^\d+$/.test(token),
    );
}

interface WordStats {
  emailIds: Set<string>;
  subjectCount: number;
  summaryCount: number;
}

/**
 * Analyze word frequencies across coarse clusters to find discriminating terms.
 *
 * Algorithm:
 * 1. Per cluster: tokenize subjects (weight 2.0) and summaries (weight 1.0),
 *    compute per-word frequency, filter common/trivial words.
 * 2. Cross-entity: penalize words appearing in >50% of clusters.
 * 3. Co-occurrence: for each word, find words in >70% of the same emails.
 * 4. Score: frequency * sourceWeight * crossEntityPenalty. Top 30 per cluster.
 */
export function analyzeWordFrequencies(
  clusters: CoarseClusterInput[],
): FrequencyTable[] {
  const clusterCount = clusters.length;

  // Step 1: Build per-cluster word stats
  const clusterWordStats = clusters.map((cluster) => {
    const stats = new Map<string, WordStats>();
    const emailCount = cluster.emails.length;

    for (const email of cluster.emails) {
      const subjectWords = new Set(tokenize(email.subject));
      const summaryWords = new Set(tokenize(email.summary));

      const allWords = new Set([...subjectWords, ...summaryWords]);

      for (const word of allWords) {
        let entry = stats.get(word);
        if (!entry) {
          entry = { emailIds: new Set(), subjectCount: 0, summaryCount: 0 };
          stats.set(word, entry);
        }
        entry.emailIds.add(email.id);
        if (subjectWords.has(word)) entry.subjectCount++;
        if (summaryWords.has(word)) entry.summaryCount++;
      }
    }

    // Filter out words appearing in >90% of the cluster's emails
    for (const [word, entry] of stats) {
      if (emailCount > 0 && entry.emailIds.size / emailCount > HIGH_FREQUENCY_THRESHOLD) {
        stats.delete(word);
      }
    }

    return { cluster, stats, emailCount };
  });

  // Step 2: Cross-entity filtering — find words present in >50% of clusters
  const wordClusterCounts = new Map<string, number>();
  for (const { stats } of clusterWordStats) {
    for (const word of stats.keys()) {
      wordClusterCounts.set(word, (wordClusterCounts.get(word) ?? 0) + 1);
    }
  }

  const penalizedWords = new Set<string>();
  if (clusterCount > 1) {
    for (const [word, count] of wordClusterCounts) {
      if (count / clusterCount > CROSS_ENTITY_THRESHOLD) {
        penalizedWords.add(word);
      }
    }
  }

  // Steps 3-4: Build FrequencyTable for each cluster
  return clusterWordStats.map(({ cluster, stats, emailCount }) => {
    // Build email-to-words index for co-occurrence
    const emailToWords = new Map<string, Set<string>>();
    for (const [word, entry] of stats) {
      for (const emailId of entry.emailIds) {
        let words = emailToWords.get(emailId);
        if (!words) {
          words = new Set();
          emailToWords.set(emailId, words);
        }
        words.add(word);
      }
    }

    const words: FrequencyWord[] = [];

    for (const [word, entry] of stats) {
      const frequency = emailCount > 0 ? entry.emailIds.size / emailCount : 0;
      const emailIds = Array.from(entry.emailIds);

      // Source weight: 2.0 if majority of occurrences come from subjects, 1.0 otherwise
      const totalOccurrences = entry.subjectCount + entry.summaryCount;
      const sourceWeight =
        totalOccurrences > 0 && entry.subjectCount / totalOccurrences > 0.5
          ? 2.0
          : 1.0;

      const crossEntityPenalty = penalizedWords.has(word)
        ? CROSS_ENTITY_PENALTY
        : 1.0;

      const weightedScore = frequency * sourceWeight * crossEntityPenalty;

      // Co-occurrence: words appearing in >70% of the same emails as this word
      const coOccursWith: string[] = [];
      const coOccurrenceCounts = new Map<string, number>();
      for (const emailId of entry.emailIds) {
        const emailWords = emailToWords.get(emailId);
        if (emailWords) {
          for (const otherWord of emailWords) {
            if (otherWord !== word) {
              coOccurrenceCounts.set(
                otherWord,
                (coOccurrenceCounts.get(otherWord) ?? 0) + 1,
              );
            }
          }
        }
      }
      const wordEmailCount = entry.emailIds.size;
      for (const [otherWord, count] of coOccurrenceCounts) {
        if (wordEmailCount > 0 && count / wordEmailCount >= CO_OCCURRENCE_THRESHOLD) {
          coOccursWith.push(otherWord);
        }
      }

      words.push({
        word,
        frequency,
        weightedScore,
        emailIds,
        coOccursWith,
      });
    }

    // Sort by weightedScore descending, take top 30
    words.sort((a, b) => b.weightedScore - a.weightedScore);
    const topWords = words.slice(0, MAX_WORDS_PER_CLUSTER);

    return {
      clusterId: cluster.clusterId,
      entityName: cluster.entityName,
      emailCount,
      words: topWords,
    };
  });
}
