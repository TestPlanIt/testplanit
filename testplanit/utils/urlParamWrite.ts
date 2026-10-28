// One shared overlay for every URL search-param write.
//
// App Router navigations are async: `router.replace` returns long before
// `window.location` moves. Two writers that each compose a new query string
// from their own read of the current URL therefore both see the pre-write
// value, and whichever lands second silently drops the first's param. The
// repository page alone has writers for `f`/`fz`, `columns`, `page`/`pageSize`,
// `node`, `view`, `case` and `selectedCase`, several of which fire together on
// landing, so the loser varies run to run.
//
// The overlay is the fix: a writer composes from the value this module last
// wrote, for as long as the browser still shows the URL that write was
// composed against. Once the router commits and `window.location` moves on,
// the overlay is spent and the next write composes from the real URL again.
//
// It is deliberately MODULE-scoped, not per-hook. The hazard is between
// components — `ColumnSelection` dropping a `view` written by the page it sits
// in — so a ref inside each caller would leave both of them composing from the
// same stale string and solve nothing.
//
// The pathname is part of the key: an overlay left behind by one page must
// never be applied to another page that happens to land on the same search
// string (two pages with no params both read ""), which would inject the old
// page's params into the new URL.

type PendingWrite = { path: string; from: string; to: string };

let pending: PendingWrite | null = null;

/**
 * Apply `mutate` to the freshest query string known for `path` and record the
 * result as pending. Returns the new search string without its leading `?`, or
 * `null` when the mutation changed nothing (the caller should not navigate).
 */
export function composeUrlSearch(
  path: string,
  currentSearch: string,
  mutate: (params: URLSearchParams) => void
): string | null {
  const base =
    pending && pending.path === path && pending.from === currentSearch
      ? pending.to
      : currentSearch;
  const query = new URLSearchParams(base);
  const before = query.toString();
  mutate(query);
  const after = query.toString();
  if (after === before) return null;
  pending = { path, from: currentSearch, to: after ? `?${after}` : "" };
  return after;
}

/**
 * Drop the overlay once the browser has moved off the URL it was composed
 * against. Keeping it past that point would let a later back-navigation that
 * happens to land on the same URL replay a write the user already undid.
 */
export function releaseUrlWriteOverlay(
  path: string,
  currentSearch: string
): void {
  if (!pending) return;
  if (pending.path !== path || pending.from !== currentSearch) {
    pending = null;
  }
}

/** Test seam: the overlay is module state and leaks between test cases. */
export function resetUrlWriteOverlay(): void {
  pending = null;
}
