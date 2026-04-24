import { headers as nextHeaders } from "next/headers";
import type { NextRequest } from "next/server";
import {
  type AuditContext,
  extractAuditContextFromHeaders,
  runWithAuditContext,
  updateAuditContext,
} from "~/lib/auditContext";

/**
 * Next.js-specific audit-context HOFs.
 *
 * This file transitively imports `next/headers`, which is NOT present in
 * the workers Docker image (Next.js deps are stripped to save ~900MB).
 * Runtime-agnostic enqueue helpers (`enqueueWithAuditContext`,
 * `ActorContextJobData`, `EnqueueSystemOptions`) live in
 * `./auditContextEnqueue.ts` — workers and other non-Next.js contexts
 * MUST import from there, never from this file.
 */

/**
 * HOF that wraps an API route handler in an AsyncLocalStorage frame
 * seeded with ipAddress/userAgent/requestId extracted from the request.
 *
 * Identity enrichment (userId/userEmail/userName) happens later via
 * the NextAuth `session` callback calling `updateAuditContext` — no
 * per-route change is needed for identity. Bearer-token routes must
 * call `enrichFromApiAuth(apiAuth)` after token validation (Plan 02 B1).
 *
 * Per Phase 64 D-01.
 */
export function withAuditContext<
  H extends (req: NextRequest, ...rest: any[]) => Promise<Response>,
>(handler: H): H {
  const wrapped = (async (req: NextRequest, ...rest: unknown[]) => {
    const ctx: AuditContext = extractAuditContextFromHeaders(req.headers);
    return runWithAuditContext(ctx, () => handler(req, ...(rest as any)));
  }) as H;
  return wrapped;
}

/**
 * HOF that wraps a Next.js server action in an AsyncLocalStorage frame.
 *
 * Uses `await headers()` from next/headers (Next.js 16 server-action-safe)
 * and generates a fresh requestId per action invocation (per D-07 —
 * server actions are their own POSTs from the client and do not share
 * a requestId with the page render that triggered them).
 *
 * Per Phase 64 D-05.
 */
export function withActionAuditContext<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const headersList = await nextHeaders();
    // next/headers returns ReadonlyHeaders which is structurally compatible
    // with Headers for the extractor's purposes.
    const ctx: AuditContext = extractAuditContextFromHeaders(
      headersList as unknown as Headers
    );
    return runWithAuditContext(ctx, () => fn(...args));
  };
}

/**
 * Enrich the current ALS frame with identity fields from a Bearer-token
 * (`tpi_...`) API-auth result. This is a tiny wrapper around
 * `updateAuditContext` that exists so all Bearer-authed routes use a
 * single, greppable export name.
 *
 * Per Phase 64 B1: called from the 6 Bearer-token-authed audit-emitting
 * routes after `authenticateApiToken` resolves. No-op when ALS is empty
 * (updateAuditContext itself is a no-op in that case).
 */
export function enrichFromApiAuth(apiAuth: {
  userId: string;
  userEmail?: string;
  userName?: string;
}): void {
  updateAuditContext({
    userId: apiAuth.userId,
    userEmail: apiAuth.userEmail,
    userName: apiAuth.userName,
  });
}
