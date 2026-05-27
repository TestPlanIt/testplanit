import { AsyncLocalStorage } from "async_hooks";
import type { NextRequest } from "next/server";

// Re-export the client-safe constants so existing server-side imports keep
// working unchanged. Client/edge code should import from
// `auditContextConstants` directly to avoid pulling AsyncLocalStorage into
// browser bundles.
export { SYSTEM_ACTOR_ID, type SystemActor } from "~/lib/auditContextConstants";

/**
 * Context for audit logging, propagated through the request lifecycle
 * using AsyncLocalStorage to avoid passing context through all functions.
 */
export interface AuditContext {
  /** IP address of the client making the request */
  ipAddress?: string;
  /** User agent string from the request headers */
  userAgent?: string;
  /** Unique request ID for correlation across logs */
  requestId?: string;
  /** Authenticated user ID (set after auth) */
  userId?: string;
  /** Authenticated user email (set after auth) */
  userEmail?: string;
  /** Authenticated user name (set after auth) */
  userName?: string;
  /**
   * Reason string stamped when a job/event has no originating human actor
   * (scheduled jobs, worker-to-worker fan-outs, infrastructure tasks).
   * Phase 64 D-14 / W5 Option A: propagated via the ALS frame so downstream
   * captureAuditEvent merges it into event.metadata automatically.
   */
  systemReason?: string;
  /**
   * tokenScopes — scopes from the authenticating ApiToken, if any.
   * Empty/undefined for session-authed requests (cookie auth).
   * Set by enrichFromApiAuth() after token validation in Bearer-authed routes.
   * Used by captureAuditEvent to derive metadata.source ("mcp" | "api") —
   * unforgeable by request-time headers because attribution lives with the token.
   */
  tokenScopes?: string[];
  /**
   * Suppression hatch for backfill scripts and migrations that mutate domain
   * entities without producing outbound webhook events. webhookEvents.emit()
   * short-circuits when this flag is true. Audit emission is unaffected.
   * Defaults to undefined (= no suppression) so existing callers are unchanged.
   */
  suppressWebhooks?: boolean;
  /**
   * Suppression hatch for the generic entity-audit helpers (auditCreate/
   * auditUpdate/auditDelete and the auditBulk* variants) emitted by the
   * lib/prisma.ts `$extends` hooks. The ZenStack RPC route sets this for
   * mutations it audits canonically via its own post-RPC shim, so the
   * `$extends` hook does not double-emit a (partial, `select:{id:true}`-shaped)
   * generic row on that path. Specialized helpers (auditRoleChange,
   * auditSsoConfigChange, etc.) are intentionally NOT gated. Defaults to
   * undefined (= no suppression); non-RPC paths (workers, custom routes,
   * direct prisma) leave it unset so the hooks audit normally.
   */
  suppressEntityAudit?: boolean;
}

/**
 * AsyncLocalStorage instance for audit context.
 * This allows us to access request context from anywhere in the call stack
 * without explicitly passing it through function parameters.
 */
export const auditContextStorage = new AsyncLocalStorage<AuditContext>();

/**
 * Get the current audit context from AsyncLocalStorage.
 * Returns undefined if not within a request context.
 */
export function getAuditContext(): AuditContext | undefined {
  return auditContextStorage.getStore();
}

/**
 * Run a function within an audit context.
 * Used by middleware to establish the context for a request.
 */
export function runWithAuditContext<T>(context: AuditContext, fn: () => T): T {
  return auditContextStorage.run(context, fn);
}

/**
 * Update the current audit context with additional information.
 * Typically used after authentication to add user details.
 */
export function updateAuditContext(updates: Partial<AuditContext>): void {
  const current = auditContextStorage.getStore();
  if (current) {
    Object.assign(current, updates);
  }
}

/**
 * Generate a unique request ID for correlation.
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Extract the client IP address from request headers.
 * Handles various proxy headers in order of priority.
 */
export function extractIpAddress(headersList: Headers): string | undefined {
  // Check common proxy headers in order of priority
  const xForwardedFor = headersList.get("x-forwarded-for");
  if (xForwardedFor) {
    // x-forwarded-for can contain multiple IPs; take the first (client) IP
    return xForwardedFor.split(",")[0]?.trim();
  }

  const xRealIp = headersList.get("x-real-ip");
  if (xRealIp) {
    return xRealIp.trim();
  }

  const cfConnectingIp = headersList.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  return undefined;
}

/**
 * Extract audit context from request headers.
 * Works with both standard Headers and Next.js ReadonlyHeaders.
 */
export function extractAuditContextFromHeaders(
  headersList: Headers
): AuditContext {
  return {
    ipAddress: extractIpAddress(headersList),
    userAgent: headersList.get("user-agent") || undefined,
    requestId: generateRequestId(),
  };
}

/**
 * Extract audit context from a NextRequest object.
 * Useful in API route handlers.
 */
export function extractAuditContextFromRequest(
  request: NextRequest
): AuditContext {
  return extractAuditContextFromHeaders(request.headers);
}
