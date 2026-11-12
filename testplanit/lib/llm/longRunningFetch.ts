import { Agent } from "undici";

/**
 * How long a long-running request may go without response headers, or without
 * further body data, before it is cut off. The runtime's own fetch allows 5
 * minutes, which a large prompt on a slow local model can exceed.
 *
 * This is a ceiling on silence, not on duration: the caller's AbortSignal
 * still sets the overall limit, and a stream that keeps sending data can run
 * longer than this.
 */
export const LONG_RUNNING_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function createIdleTimeoutDispatcher(idleTimeoutMs: number): Agent {
  return new Agent({
    headersTimeout: idleTimeoutMs,
    bodyTimeout: idleTimeoutMs,
  });
}

let longRunningDispatcher: Agent | undefined;

/**
 * fetch() with the idle limits raised to LONG_RUNNING_IDLE_TIMEOUT_MS.
 *
 * The runtime's fetch only accepts a dispatcher from an undici version it can
 * drive, so longRunningFetch.test.ts sends a real request through this.
 */
export function fetchLongRunning(
  url: string,
  init?: RequestInit
): Promise<Response> {
  longRunningDispatcher ??= createIdleTimeoutDispatcher(
    LONG_RUNNING_IDLE_TIMEOUT_MS
  );
  return fetch(url, {
    ...init,
    dispatcher: longRunningDispatcher,
  } as RequestInit);
}
