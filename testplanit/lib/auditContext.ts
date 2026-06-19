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
  /**
   * Per-logical-operation correlation id (Phase 14 CTX-03). Generated once per
   * logical save action by the browser (crypto.randomUUID) and sent on every
   * ZenStack mutation in that save via the X-Operation-Id header, so the three
   * writes of a single case save share one id. Populated from a validated
   * X-Operation-Id header (non-UUID values are dropped). Flows into the GUC
   * payload (lib/audit/gucContext.ts) → DataChangeLog.operation_id.
   */
  operationId?: string;
  /** Authenticated user ID (set after auth) */
  userId?: string;
  /** Authenticated user email (set after auth) */
  userEmail?: string;
  /** Authenticated user name (set after auth) */
  userName?: string;
  /**
   * Subject snapshot for child-only operations — those whose owning root row is
   * NOT itself written, so the trigger has no row to read the name/project from
   * (e.g. recording a test result writes TestRunResults but not the TestRuns
   * row). The originating route sets these on the frame; buildGucPayload carries
   * them into the GUC and the trigger uses them as the entity_name/project_id
   * fallback. Leave unset for normal operations — the trigger reads the name/
   * project straight off the written root row, which is more robust (it handles
   * bulk operations row-by-row).
   */
  subjectEntityName?: string;
  subjectProjectId?: number | string;
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
   * scimTokenId — id of the authenticating SCIM bearer token (tps_*), if any.
   * Set by the SCIM bearer middleware after a valid tps_ token validates.
   * Consumed by captureAuditEvent to derive metadata.source === "scim" and
   * to hand-stamp metadata.scimTokenId on audit rows for per-token discrimination.
   * Undefined for session/cookie-authed and ApiToken-authed requests.
   */
  scimTokenId?: string;
  /**
   * scimGroupId — id of the SCIM/admin group whose mapping or membership
   * triggered an access recompute; stamped onto access-change audit rows so
   * each flip names the triggering group.
   * Set by the recompute caller before invoking recomputeUserAccess so the
   * generic role-change hook picks it up from the ALS frame automatically.
   * Undefined outside of SCIM group-mapping recompute flows.
   */
  scimGroupId?: string;
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
   * generic row on that path. The generic helpers consult it themselves; the
   * bespoke security/config hooks (apiToken, appConfig, ssoProvider) instead
   * check `isEntityAuditSuppressed()` at their own call sites in lib/prisma.ts,
   * since on the RPC path the shim now emits their canonical semantic row
   * (API_KEY_*, SYSTEM_CONFIG_CHANGED, SSO_CONFIG_CHANGED). The underlying
   * specialized helpers (auditRoleChange, auditSsoConfigChange,
   * auditSystemConfigChange) remain ungated so admin routes that call them
   * directly off the RPC path still audit. Defaults to undefined (= no
   * suppression); non-RPC paths (workers, custom routes, direct prisma) leave
   * it unset so the hooks audit normally.
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
 * Canonical UUID (any version) matcher. Used to validate the client-supplied
 * X-Operation-Id header before it can reach the JSON-serialized
 * app.audit_context GUC payload — input validation (threat T-14-03-02) that
 * prevents arbitrary header strings from being injected into the GUC.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extract audit context from request headers.
 * Works with both standard Headers and Next.js ReadonlyHeaders.
 */
export function extractAuditContextFromHeaders(
  headersList: Headers
): AuditContext {
  // Phase 14 CTX-03: read the per-logical-save correlation id supplied by the
  // browser. Validate it as a UUID so garbage / injection attempts never reach
  // the audit_context GUC — non-UUID values become undefined.
  const rawOperationId = headersList.get("x-operation-id");
  const operationId =
    rawOperationId && UUID_REGEX.test(rawOperationId)
      ? rawOperationId
      : undefined;

  return {
    ipAddress: extractIpAddress(headersList),
    userAgent: headersList.get("user-agent") || undefined,
    requestId: generateRequestId(),
    operationId,
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
