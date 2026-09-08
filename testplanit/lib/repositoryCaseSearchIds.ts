/**
 * The Elasticsearch id set that both repository read paths accept:
 * `POST /api/projects/[projectId]/cases/query` (the table page) and
 * `POST /api/repository-cases/view-options` (the facet counts). Both routes
 * treat the array as an id SCOPE, so they must agree on what a search snapshot
 * is — a page and the counts drawn next to it are read from the same request
 * body, and a set one route accepts but the other silently reshapes produces a
 * table and a chip bar that disagree.
 *
 * The array is client-supplied and can be very large, which is what makes it
 * worth normalizing in one place rather than per route.
 */

/**
 * Elasticsearch's default `index.max_result_window`: the client can never
 * resolve more than 10,000 ids, so anything beyond that is a malformed or
 * hostile body rather than a real search snapshot.
 */
export const ES_MAX_RESULT_WINDOW = 10000;

/**
 * Keep safe positive integers, drop everything else, preserve the relevance
 * order the ids arrived in, and cap the set at the ES result window.
 *
 * The result is always a subset of the input, so an EMPTY result means "this
 * search matches nothing" — never "no search filter". Callers must keep an
 * absent field (`undefined`) distinct from an empty array.
 */
export function sanitizeSearchCaseIds(ids: readonly unknown[]): number[] {
  const seen = new Set<number>();
  const sanitized: number[] = [];
  for (const id of ids) {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    sanitized.push(id);
    if (sanitized.length >= ES_MAX_RESULT_WINDOW) break;
  }
  return sanitized;
}
