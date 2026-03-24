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
