/**
 * Similarity scoring utilities for duplicate test case detection.
 *
 * Provides Jaro-Winkler string similarity, Jaccard set overlap,
 * weighted multi-signal score combination, and confidence bucket derivation.
 */

export const FIELD_WEIGHTS = {
  name: 0.5,
  steps: 0.3,
  tags: 0.1,
  fields: 0.1,
} as const;

export type ConfidenceBucket = "HIGH" | "MEDIUM" | "LOW";

/**
 * Computes the Levenshtein edit distance between two strings.
 * Uses single-row DP for memory efficiency.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Computes normalized Levenshtein similarity ratio between two strings.
 * Both inputs are lowercased and trimmed before comparison.
 *
 * Returns 1.0 for identical strings, 0.0 for completely different strings.
 * The ratio is: 1 - (editDistance / maxLength).
 */
export function levenshteinRatio(s1: string, s2: string): number {
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Computes Jaro-Winkler similarity between two strings.
 * Both inputs are lowercased before comparison.
 *
 * Returns 1.0 for two empty strings (identical).
 * Returns 0.0 if one string is empty and the other is not.
 */
export function jaroWinkler(s1: string, s2: string): number {
  const a = s1.toLowerCase();
  const b = s2.toLowerCase();

  const len1 = a.length;
  const len2 = b.length;

  // Both empty = identical
  if (len1 === 0 && len2 === 0) return 1.0;
  // One empty = completely different
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const maxWindow = Math.max(matchWindow, 0);

  const aMatched = new Array<boolean>(len1).fill(false);
  const bMatched = new Array<boolean>(len2).fill(false);

  let matches = 0;

  // Find matching characters within the match window
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - maxWindow);
    const end = Math.min(i + maxWindow + 1, len2);

    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  // Count transpositions
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  // Winkler bonus: add up to 4 common prefix characters
  let prefixLength = 0;
  const maxPrefix = Math.min(4, Math.min(len1, len2));
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) prefixLength++;
    else break;
  }

  return jaro + prefixLength * 0.1 * (1 - jaro);
}

/**
 * Computes Jaccard similarity coefficient between two string arrays.
 *
 * Returns 1.0 if both arrays are empty (identical empty sets).
 * Returns 0.0 if one array is empty and the other is not.
 */
export function jaccardSimilarity(setA: string[], setB: string[]): number {
  if (setA.length === 0 && setB.length === 0) return 1.0;
  if (setA.length === 0 || setB.length === 0) return 0.0;

  const a = new Set(setA);
  const b = new Set(setB);

  let intersectionSize = 0;
  for (const item of a) {
    if (b.has(item)) intersectionSize++;
  }

  const unionSize = a.size + b.size - intersectionSize;

  return intersectionSize / unionSize;
}

/**
 * Combines multiple similarity signals into a single weighted score.
 * Weights: name=0.5, steps=0.3, tags=0.1, fields=0.1
 */
export function combineScores(signals: {
  name: number;
  steps: number;
  tags: number;
  fields: number;
}): number {
  return (
    signals.name * FIELD_WEIGHTS.name +
    signals.steps * FIELD_WEIGHTS.steps +
    signals.tags * FIELD_WEIGHTS.tags +
    signals.fields * FIELD_WEIGHTS.fields
  );
}

/**
 * Maps a combined score to a confidence bucket.
 *
 * Returns null for scores below 0.70 (not surfaced to users).
 */
export function scoreToConfidence(score: number): ConfidenceBucket | null {
  if (score >= 0.90) return "HIGH";
  if (score >= 0.80) return "MEDIUM";
  if (score >= 0.70) return "LOW";
  return null;
}

/**
 * Compares two test steps for fuzzy equality using levenshteinRatio.
 *
 * Uses an asymmetric empty-field rule: if either side has an empty
 * expectedResult (after trimming), only step text similarity is checked.
 * When both sides have expectedResult, the average of step text similarity
 * and expectedResult similarity must meet the threshold.
 *
 * Default threshold is 0.85 (locked decision from CONTEXT.md).
 */
export function stepsEqual(
  a: { step: string; expectedResult: string },
  b: { step: string; expectedResult: string },
  threshold = 0.85,
): boolean {
  const stepSim = levenshteinRatio(a.step, b.step);
  const aHasER = a.expectedResult.trim().length > 0;
  const bHasER = b.expectedResult.trim().length > 0;
  if (!aHasER || !bHasER) {
    return stepSim >= threshold;
  }
  const erSim = levenshteinRatio(a.expectedResult, b.expectedResult);
  return (stepSim + erSim) / 2 >= threshold;
}

/**
 * Generic O(m*n) dynamic programming Longest Common Subsequence.
 *
 * Accepts a custom equality predicate so fuzzy matching (e.g. stepsEqual)
 * can drive sequence identification rather than strict equality.
 *
 * Returns matched index pairs from backtracking so callers know exactly
 * which positions in each array correspond to each other.
 */
export function lcs<T>(
  a: T[],
  b: T[],
  eq: (x: T, y: T) => boolean,
): Array<{ aIdx: number; bIdx: number }> {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return [];
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = eq(a[i - 1]!, b[j - 1]!)
        ? dp[i - 1]![j - 1]! + 1
        : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const result: Array<{ aIdx: number; bIdx: number }> = [];
  let i = m,
    j = n;
  while (i > 0 && j > 0) {
    if (eq(a[i - 1]!, b[j - 1]!)) {
      result.unshift({ aIdx: i - 1, bIdx: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}
