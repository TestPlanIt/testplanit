"use client";

/**
 * Drop-in stand-in for `new EventSource(url)` that defers opening the real
 * connection until the browser next goes idle (bounded by a fallback timeout).
 *
 * Each long-lived SSE stream holds one of the browser's ~6 HTTP/1.1
 * connections-per-origin for its whole lifetime. When a page mounts several at
 * once they can claim connection slots ahead of the page's own data fetches,
 * and across two tabs of the same origin the pool saturates — starving the
 * document/data requests until a stream tab closes (the milestones
 * detail-plus-list load hang). A wake-up arriving a second late is
 * imperceptible, so we let the page's fetches take slots first and open the
 * stream once the main thread is idle.
 *
 * Only the EventSource surface the app actually uses is proxied — `onmessage`,
 * `onerror`, `close()`. Handlers assigned before the connection opens take
 * effect when it does (they're read at dispatch time), so assignment order and
 * later reassignment both work; `close()` before then cancels the pending open
 * so nothing ever connects.
 */
export interface DeferredEventSource {
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close(): void;
}

// Backstop so a page that never idles still connects promptly; the plain
// setTimeout is the fallback for the rare browser without requestIdleCallback.
const IDLE_TIMEOUT_MS = 2000;
const FALLBACK_DELAY_MS = 1000;

type IdleCapableGlobal = typeof globalThis & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function createDeferredEventSource(url: string): DeferredEventSource {
  const handlers: {
    onmessage: ((ev: MessageEvent) => void) | null;
    onerror: ((ev: Event) => void) | null;
  } = { onmessage: null, onerror: null };

  let es: EventSource | null = null;
  let closed = false;
  let idleHandle: number | undefined;
  let timerHandle: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    idleHandle = undefined;
    timerHandle = undefined;
    if (closed) return;
    es = new EventSource(url);
    // Read the latest handler at dispatch time so a handler assigned after
    // open() (or reassigned later) still takes effect.
    es.onmessage = (ev) => handlers.onmessage?.(ev);
    es.onerror = (ev) => handlers.onerror?.(ev);
  };

  const g = globalThis as IdleCapableGlobal;
  if (typeof g.requestIdleCallback === "function") {
    idleHandle = g.requestIdleCallback(open, { timeout: IDLE_TIMEOUT_MS });
  } else {
    timerHandle = setTimeout(open, FALLBACK_DELAY_MS);
  }

  return {
    get onmessage() {
      return handlers.onmessage;
    },
    set onmessage(fn) {
      handlers.onmessage = fn;
    },
    get onerror() {
      return handlers.onerror;
    },
    set onerror(fn) {
      handlers.onerror = fn;
    },
    close() {
      closed = true;
      if (
        idleHandle !== undefined &&
        typeof g.cancelIdleCallback === "function"
      ) {
        g.cancelIdleCallback(idleHandle);
      }
      if (timerHandle !== undefined) clearTimeout(timerHandle);
      if (es) {
        try {
          es.close();
        } catch {
          /* swallow — already closed */
        }
        es = null;
      }
    },
  };
}
