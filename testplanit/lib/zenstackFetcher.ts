/**
 * Phase 14 CTX-03 — global ZenStack operationId fetcher.
 *
 * The ZenStack tanstack-query Provider (installed in app/providers.tsx) exposes
 * a single APIContext.fetch (FetchFn) that EVERY generated mutation/query hook
 * routes through — there is NO per-mutation fetch override (per-call `fetch` is
 * not part of ExtraMutationOptions; confirmed in 14-OPEN-QUESTIONS-RESOLVED.md
 * §3). So the only seam to stamp a per-logical-save correlation id onto every
 * request of a save is this module-level ref + global fetcher.
 *
 * `hooks/useOperationId.ts` writes the active operationId into
 * `operationIdRef.current` (via beginOperation/endOperation); this fetcher
 * reads that ref and attaches it as the `X-Operation-Id` request header. The
 * server reads + validates that header in extractAuditContextFromHeaders
 * (lib/auditContext.ts) → GucPayload → DataChangeLog.operation_id.
 *
 * Framework-free on purpose so it can be imported by both the React hook and
 * providers.tsx without pulling React into a non-component module.
 */

/** FetchFn signature matching ZenStack's APIContext.fetch. */
export type FetchFn = (url: string, options?: RequestInit) => Promise<Response>;

/**
 * Module-level (per-tab) singleton holding the operationId for the in-flight
 * logical save. `null` between saves → no header is attached. Written by
 * useOperationId.beginOperation()/endOperation(); read by operationIdFetcher.
 */
export const operationIdRef: { current: string | null } = { current: null };

/**
 * The single FetchFn the ZenStack Provider installs. When an operation is
 * active it stamps `X-Operation-Id`; otherwise it is a transparent passthrough
 * to the supplied base fetch (defaults to globalThis.fetch).
 */
export const operationIdFetcher: FetchFn = (url, options) => {
  const headers = new Headers(options?.headers);
  if (operationIdRef.current) {
    headers.set("X-Operation-Id", operationIdRef.current);
  }
  return globalThis.fetch(url, { ...options, headers });
};
