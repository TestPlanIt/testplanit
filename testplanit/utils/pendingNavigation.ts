import { stripBasePath } from "~/lib/basePath";

// A page that mirrors its state into the URL keeps writing while it settles.
// The router runs one navigation at a time, so a write issued after the person
// has started moving to another page replaces that move and leaves them where
// they were. This module remembers a move that has started and not yet landed,
// so same-page writers can stand down until it does.

type PendingNavigation = { from: string; to: string; at: number };

const STALE_AFTER_MS = 15_000;

let pending: PendingNavigation | null = null;

/** Record a router navigation as it starts. Called from `instrumentation-client`. */
export function notePendingNavigation(url: string, now = Date.now()): void {
  if (typeof window === "undefined") return;
  let to: string;
  try {
    to = stripBasePath(new URL(url, window.location.href).pathname);
  } catch {
    return;
  }
  pending = { from: stripBasePath(window.location.pathname), to, at: now };
}

/**
 * Whether a navigation to another page has started and the browser is still on
 * the page it started from. A move that never lands (a redirect back, a failed
 * request) stops counting after a few seconds so the page's writers resume.
 */
export function isLeavingPage(now = Date.now()): boolean {
  if (!pending || typeof window === "undefined") return false;
  if (
    pending.to === pending.from ||
    stripBasePath(window.location.pathname) !== pending.from ||
    now - pending.at > STALE_AFTER_MS
  ) {
    pending = null;
    return false;
  }
  return true;
}

/** Test seam: the record is module state and leaks between test cases. */
export function resetPendingNavigation(): void {
  pending = null;
}
