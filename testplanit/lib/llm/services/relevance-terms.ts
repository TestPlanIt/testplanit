/**
 * Term extraction and path relevance scoring shared by the code-context
 * service and the Impact engine. Plain module: no DB or server-only imports.
 */

/** Words too generic to be useful for relevance scoring. */
export const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "that",
  "this",
  "it",
  "its",
  "click",
  "enter",
  "verify",
  "check",
  "then",
  "when",
  "given",
  "user",
  "page",
  "test",
  "into",
]);

/**
 * Extract meaningful terms from free text for relevance scoring.
 * Splits on non-alphanumeric, lowercases, removes stop words and short tokens.
 */
export function extractTerms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 3 && !STOP_WORDS.has(t))
  );
}

/**
 * Score a file path by how many case-derived terms appear in its segments.
 * e.g. "tests/e2e/login-page.spec.ts" scores higher if "login" is in terms.
 */
export function scoreFileRelevance(
  filePath: string,
  terms: Set<string>
): number {
  if (terms.size === 0) return 0;
  const segments = filePath
    .toLowerCase()
    .split(/[\/.\-_]+/)
    .filter((s) => s.length > 2);
  return segments.filter((s) => terms.has(s)).length;
}
