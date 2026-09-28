/**
 * Mirror the selected folder into the URL's `node` param in place, and only
 * when the value actually changes.
 *
 * The write bypasses the router on purpose (a folder click is intra-page
 * state, not a navigation), but Next.js still treats every external
 * `history.replaceState` as a navigation and discards whatever router
 * navigation is in flight: the pagination, column and auto-select writes on
 * this page. A discarded write only gets retried when the search params
 * change, so a redundant write that leaves the URL as it was drops those
 * params for good. Skipping it keeps the retry path alive.
 *
 * Returns whether the URL was written.
 */
export function syncNodeUrlParam(folderId: number | null): boolean {
  const url = new URL(window.location.href);
  const current = url.searchParams.get("node");
  const next = folderId === null ? null : String(folderId);
  if (current === next) return false;
  if (next === null) {
    url.searchParams.delete("node");
  } else {
    url.searchParams.set("node", next);
  }
  window.history.replaceState({}, "", url.toString());
  return true;
}
