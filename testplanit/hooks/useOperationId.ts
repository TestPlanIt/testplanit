"use client";

import { useCallback } from "react";
import {
  type FetchFn,
  operationIdFetcher,
  operationIdRef,
} from "~/lib/zenstackFetcher";

/**
 * Phase 14 CTX-03 — client correlation source.
 *
 * `useOperationId` is the browser tier's only place that can group every
 * request belonging to one logical save (e.g. a case save = RepositoryCases +
 * CaseFieldValues + Steps writes). `beginOperation()` mints ONE
 * crypto.randomUUID per save and writes it into the shared module-level ref
 * (lib/zenstackFetcher.ts). The global ZenStack fetcher installed in
 * app/providers.tsx reads that ref and attaches it as the `X-Operation-Id`
 * header on EVERY generated mutation/query, so callers do NOT pass any
 * per-mutation fetch override (that seam does not exist — see
 * 14-OPEN-QUESTIONS-RESOLVED.md §3). `endOperation()` clears it after the save.
 *
 * Header name is exactly `X-Operation-Id`, matching the server read in
 * lib/auditContext.ts extractAuditContextFromHeaders.
 */
export function useOperationId() {
  // Mint a new operationId and store it in the shared ref the global fetcher
  // reads. Call once before the first request of a logical save; returns the id.
  const beginOperation = useCallback((): string => {
    const id = crypto.randomUUID();
    operationIdRef.current = id;
    return id;
  }, []);

  // Clear the operationId after the save completes so it cannot leak into a
  // later, unrelated request.
  const endOperation = useCallback(() => {
    operationIdRef.current = null;
  }, []);

  // Returns a FetchFn that stamps `X-Operation-Id` from the shared ref onto
  // every request, delegating to the supplied base fetch (defaults to the
  // global fetch). The global Provider fetcher (operationIdFetcher) already
  // does this for all ZenStack hooks; this wrapper is for any direct/manual
  // fetch a save handler issues outside the generated hooks.
  const withOperationId = useCallback((baseFetch?: FetchFn): FetchFn => {
    return (url, options) => {
      const headers = new Headers(options?.headers);
      if (operationIdRef.current) {
        headers.set("X-Operation-Id", operationIdRef.current);
      }
      return (baseFetch ?? globalThis.fetch)(url, { ...options, headers });
    };
  }, []);

  return { beginOperation, endOperation, withOperationId, operationIdRef };
}

// Re-export the global fetcher so providers.tsx can install it on the ZenStack
// Provider without reaching into the lib module separately.
export { operationIdFetcher };
