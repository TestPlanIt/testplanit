/**
 * Fuzzy tag matching utilities for auto-tag suggestions.
 *
 * After the LLM suggests tags for entities, we compare them against
 * the project's existing tags to identify matches (exact or fuzzy)
 * and prevent near-duplicate tag creation.
 */

/**
 * Normalize a tag name to its canonical comparison form.
 * Trims whitespace and lowercases.
 */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Simple Levenshtein distance between two strings.
 * Standard dynamic programming approach — no external dependencies.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Optimize for trivial cases
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row DP to save memory
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n]!;
}

interface MatchResult {
  tagName: string;
  isExisting: boolean;
  matchedExistingTag?: string;
}

/**
 * Match AI-suggested tags against existing project tags using exact and fuzzy matching.
 *
 * Algorithm:
 * 1. Build normalized map of existing project tags
 * 2. For each AI suggestion (deduplicated):
 *    a. Skip if entity already has this tag
 *    b. Exact case-insensitive match -> existing
 *    c. Fuzzy match (substring or Levenshtein) -> existing
 *    d. No match -> new tag
 *
 * @param aiSuggestedTags - Raw tag names from LLM response
 * @param existingProjectTags - All non-deleted tags in the project
 * @param entityExistingTagNames - Tags already applied to this entity
 */
export function matchTagSuggestions(
  aiSuggestedTags: string[],
  existingProjectTags: string[],
  entityExistingTagNames: string[],
): MatchResult[] {
  // Build normalized map: normalizedName -> originalName
  const existingMap = new Map<string, string>();
  for (const tag of existingProjectTags) {
    existingMap.set(normalizeTagName(tag), tag);
  }

  // Normalize entity's existing tags for comparison
  const entityTagsNormalized = new Set(
    entityExistingTagNames.map(normalizeTagName),
  );

  // Track seen normalized suggestions to deduplicate
  const seenNormalized = new Set<string>();
  const results: MatchResult[] = [];

  for (const suggestion of aiSuggestedTags) {
    const trimmed = suggestion.trim();
    if (!trimmed) continue;

    const normalized = normalizeTagName(trimmed);

    // Deduplicate
    if (seenNormalized.has(normalized)) continue;
    seenNormalized.add(normalized);

    // Check if entity already has this tag (exact or via existing match)
    // We check against both the normalized suggestion itself and potential matches
    if (entityTagsNormalized.has(normalized)) continue;

    // 1. Exact match (case-insensitive)
    const exactMatch = existingMap.get(normalized);
    if (exactMatch !== undefined) {
      // Also check if the matched existing tag is already on the entity
      if (entityTagsNormalized.has(normalizeTagName(exactMatch))) continue;
      results.push({
        tagName: trimmed,
        isExisting: true,
        matchedExistingTag: exactMatch,
      });
      continue;
    }

    // 2. Fuzzy match
    let bestMatch: string | undefined;
    let bestScore = Infinity;

    for (const [existingNorm, existingOrig] of existingMap) {
      // Skip if entity already has this existing tag
      if (entityTagsNormalized.has(existingNorm)) continue;

      // Substring match: one is contained in the other
      if (existingNorm.includes(normalized) || normalized.includes(existingNorm)) {
        // Prefer shorter distance (closer match)
        const distance = levenshteinDistance(normalized, existingNorm);
        if (distance < bestScore) {
          bestScore = distance;
          bestMatch = existingOrig;
        }
        continue;
      }

      // Levenshtein distance for short tags (<= 10 chars)
      if (normalized.length <= 10 || existingNorm.length <= 10) {
        const distance = levenshteinDistance(normalized, existingNorm);
        if (distance <= 2 && distance < bestScore) {
          bestScore = distance;
          bestMatch = existingOrig;
        }
      }
    }

    if (bestMatch !== undefined) {
      results.push({
        tagName: trimmed,
        isExisting: true,
        matchedExistingTag: bestMatch,
      });
    } else {
      results.push({
        tagName: trimmed,
        isExisting: false,
      });
    }
  }

  return results;
}
