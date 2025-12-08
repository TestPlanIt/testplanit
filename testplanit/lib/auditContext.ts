import { AsyncLocalStorage } from "async_hooks";
import type { NextRequest } from "next/server";

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
}

/**
 * AsyncLocalStorage instance for audit context.
 * This allows us to access request context from anywhere in the call stack
 * without explicitly passing it through function parameters.
 */
export const auditContextStorage = new AsyncLocalStorage<AuditContext>();

/**
 * Get the current audit context from AsyncLocalStorage.
 * If not in AsyncLocalStorage context, falls back to global context.
 * Returns undefined if not within a request context.
 */
export function getAuditContext(): AuditContext | undefined {
  // First try AsyncLocalStorage
  const stored = auditContextStorage.getStore();
  if (stored) {
    return stored;
  }

  // Fall back to global context (set by API routes)
  return globalFallbackContext;
}

/**
 * Run a function within an audit context.
 * Used by middleware to establish the context for a request.
 */
export function runWithAuditContext<T>(
  context: AuditContext,
  fn: () => T
): T {
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
 * Global fallback context for when AsyncLocalStorage is not available.
 * This is used in API routes where we can't wrap the entire request
 * in a runWithAuditContext call.
 * Note: This is a simple fallback and may not be perfectly isolated
 * across concurrent requests, but provides basic context for audit logs.
 */
let globalFallbackContext: AuditContext | undefined;

/**
 * Set the audit context directly (fallback for when AsyncLocalStorage isn't available).
 * Used in API routes that can't use runWithAuditContext.
 */
export function setAuditContext(context: AuditContext): void {
  // First try to update existing AsyncLocalStorage context
  const current = auditContextStorage.getStore();
  if (current) {
    Object.assign(current, context);
  } else {
    // Fall back to global context for API routes
    globalFallbackContext = context;
  }
}

/**
 * Get the fallback context when AsyncLocalStorage context is not available.
 */
export function getFallbackContext(): AuditContext | undefined {
  return globalFallbackContext;
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
export function extractAuditContextFromHeaders(headersList: Headers): AuditContext {
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
export function extractAuditContextFromRequest(request: NextRequest): AuditContext {
  return extractAuditContextFromHeaders(request.headers);
}
