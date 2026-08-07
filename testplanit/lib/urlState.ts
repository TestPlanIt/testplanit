"use client";

import { useSyncExternalStore } from "react";

/**
 * Same-route URL-state plumbing.
 *
 * Under cacheComponents/partialPrefetching a `router.replace` is a real RSC
 * navigation: while it is in flight the router can swap the page segment to
 * its loading fallback, unmounting dialogs and table state. Same-route state
 * mirrors (pagination, columns, filters, selected tree node, ...) must
 * therefore go through the native History API instead.
 *
 * The native API has two sharp edges this module rounds off:
 *
 * 1. `useSearchParams` does NOT observe raw `history.replaceState` calls, so
 *    reactive consumers (filter chips, view selectors) never re-render.
 *    `commitUrlSearch` dispatches an event and `useLocationSearch` subscribes
 *    to it (plus popstate), giving readers a reactive view of
 *    `window.location.search` without involving the router.
 * 2. Passing a fresh state object to `replaceState` wipes the Next router's
 *    own entry in `history.state`, after which the next router operation
 *    degrades to a full-document MPA navigation. `commitUrlSearch` always
 *    carries `window.history.state` forward.
 */

const URL_STATE_EVENT = "app:url-state";

/** Replace the current URL without a router navigation and notify readers. */
export function commitUrlSearch(url: string | URL): void {
  window.history.replaceState(window.history.state, "", url.toString());
  window.dispatchEvent(new Event(URL_STATE_EVENT));
}

/**
 * Push a new history entry without a router navigation and notify readers.
 * For same-route state where Back should step through changes (e.g. tabs).
 */
export function pushUrlSearch(url: string | URL): void {
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new Event(URL_STATE_EVENT));
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(URL_STATE_EVENT, onStoreChange);
  window.addEventListener("popstate", onStoreChange);
  return () => {
    window.removeEventListener(URL_STATE_EVENT, onStoreChange);
    window.removeEventListener("popstate", onStoreChange);
  };
}

function getSnapshot(): string {
  return window.location.search;
}

// Server render (and the hydration pass) sees an empty query; readers pick up
// the real value in the first client render after mount.
function getServerSnapshot(): string {
  return "";
}

/**
 * Reactive `window.location.search`, updated by `commitUrlSearch` writes and
 * browser history traversal. Use this instead of `useSearchParams` for params
 * written through `commitUrlSearch`.
 */
export function useLocationSearch(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
