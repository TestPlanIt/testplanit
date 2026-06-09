/**
 * SCIM bearer authentication middleware helper.
 *
 * Exposes a single entry point -- `requireScimBearer` -- that every
 * `/scim/v2/*` route handler calls explicitly to validate an inbound
 * `Authorization: Bearer tps_*` header, resolve the matching ScimToken
 * row, and short-circuit on any of the four token-status failure modes
 * (expired / revoked / inactive / not found) with a SCIM-compliant 401
 * error envelope.
 *
 * Design constraints:
 *
 *   - The `tps_*` prefix branch fires BEFORE any database lookup. A token
 *     starting with anything other than `tps_` (e.g. an `ApiToken` value
 *     prefixed with `tpi_`) is rejected immediately without ever touching
 *     the ScimToken table. This keeps the SCIM and API-token namespaces
 *     fully isolated -- the two surfaces share only primitive helpers
 *     (`extractBearerToken`, `hashToken`) and never share control flow.
 *
 *   - On failure, the helper throws a `ScimAuthError` carrying a prebuilt
 *     `NextResponse` from the shared `scimError` envelope helper. Route
 *     handlers catch with a one-line `instanceof` check and return
 *     `err.response` verbatim -- no per-route envelope assembly.
 *
 *   - `lastUsedAt` / `lastUsedIp` writes are throttled to a 60-second
 *     window via `SCIM_LAST_USED_THROTTLE_MS`. The update is fire-and-
 *     forget (`void ... .catch(console.error)`) so bearer-auth never
 *     blocks on telemetry, and the WHERE clause carries a race-safe
 *     `lastUsedAt < (now - window) OR lastUsedAt IS NULL` guard so
 *     concurrent requests cannot double-write.
 *
 *   - Server-side internal probes (the admin "Test SCIM" action that
 *     calls discovery endpoints with the just-decrypted token) set the
 *     `X-SCIM-Probe: 1` header and originate from loopback. When both
 *     conditions hold the throttled update is suppressed so the probe
 *     does not tick `lastUsedAt` for the real human-driven token.
 *
 *   - All 401 detail strings are English literals; server-side error
 *     diagnostics intentionally do not flow through next-intl so they
 *     stay grep-friendly across support tickets and log aggregators.
 */

import { NextRequest, NextResponse } from "next/server";

import { hashToken } from "~/lib/api-tokens";
import { extractBearerToken } from "~/lib/api-token-auth";
import { updateAuditContext } from "~/lib/auditContext";
import { prisma } from "~/lib/prisma";
import { scimError } from "~/lib/scim/errors";
import {
  SCIM_LAST_USED_THROTTLE_MS,
  SCIM_TOKEN_PREFIX,
} from "~/lib/scim/constants";
import { checkScimTokenRateLimit } from "./rate-limit";

/**
 * Sentinel exception thrown by `requireScimBearer` on any auth failure.
 *
 * Carries a prebuilt SCIM 401 `NextResponse` (already shaped by the shared
 * `scimError` helper with the correct schemas envelope, status string, and
 * `application/scim+json` Content-Type). Route handlers catch with a single
 * `instanceof ScimAuthError` check and return `err.response` directly.
 */
export class ScimAuthError extends Error {
  constructor(public readonly response: NextResponse) {
    super("SCIM bearer auth failed");
    this.name = "ScimAuthError";
  }
}

/**
 * Successful bearer validation result. The route handler stamps these onto
 * the audit-log frame so downstream mutations attribute correctly to the
 * SCIM system user and the originating token.
 */
export interface ScimAuthContext {
  tokenId: string;
  systemUserId: string;
}

/** Hosts that count as a loopback origin for the probe-marker carve-out. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Returns true when the request looks like the server-side admin probe:
 * the `X-SCIM-Probe: 1` header is set AND the request URL resolves to a
 * loopback host. Both halves are required -- the header alone would let
 * an external caller suppress lastUsedAt telemetry by spoofing it.
 */
function isProbeMarker(request: NextRequest): boolean {
  if (request.headers.get("x-scim-probe") !== "1") {
    return false;
  }
  try {
    const hostname = new URL(request.url).hostname;
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Validate a SCIM bearer token from the incoming request and return the
 * `{ tokenId, systemUserId }` context for downstream audit attribution.
 *
 * Throws `ScimAuthError` on any failure; the carried response is a 401
 * SCIM error envelope (`application/scim+json`) with one of these English
 * detail strings -- enumerable here for grep-ability:
 *
 *   - "Missing Authorization header"
 *   - "Invalid token format"
 *   - "Token rejected"
 *   - "Token expired"
 *   - "Token revoked"
 *   - "Token inactive"
 *
 * Status precedence on a found row is expired -> revoked -> inactive so
 * each end-state has a distinct, diagnosable detail.
 *
 * The `lastUsedAt` / `lastUsedIp` update is throttled to 60 seconds via
 * `SCIM_LAST_USED_THROTTLE_MS` and fired race-safely with `updateMany`
 * carrying a `lastUsedAt < (now - window) OR lastUsedAt IS NULL` guard.
 * The probe-marker carve-out suppresses the update entirely when the
 * request is a server-side probe.
 */
export async function requireScimBearer(
  request: NextRequest
): Promise<ScimAuthContext> {
  const raw = extractBearerToken(request);
  if (!raw) {
    throw new ScimAuthError(
      scimError(401, null, "Missing Authorization header")
    );
  }

  // Prefix branch happens BEFORE any database lookup so a `tpi_*` API
  // token (or any non-SCIM-prefixed value) is rejected without touching
  // the ScimToken table. Do NOT fall through to a shared lookup -- the
  // SCIM and API-token namespaces must stay isolated.
  if (!raw.startsWith(SCIM_TOKEN_PREFIX)) {
    throw new ScimAuthError(scimError(401, null, "Invalid token format"));
  }

  const tokenHash = hashToken(raw);
  const row = await prisma.scimToken.findUnique({
    where: { token: tokenHash },
    select: {
      id: true,
      systemUserId: true,
      isActive: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });

  if (!row) {
    throw new ScimAuthError(scimError(401, null, "Token rejected"));
  }
  if (row.expiresAt && row.expiresAt < new Date()) {
    throw new ScimAuthError(scimError(401, null, "Token expired"));
  }
  if (row.revokedAt) {
    throw new ScimAuthError(scimError(401, null, "Token revoked"));
  }
  if (!row.isActive) {
    throw new ScimAuthError(scimError(401, null, "Token inactive"));
  }

  // Per-token rate-limit gate fires AFTER token validation succeeds so the
  // 429 response never accidentally signals token validity for an unknown
  // bearer. The check returns fail-open on Valkey outages -- a transient
  // infrastructure failure must not brick the SCIM surface.
  const rateCheck = await checkScimTokenRateLimit(row.id);
  if (!rateCheck.allowed) {
    const response = scimError(429, null, "Rate limit exceeded");
    response.headers.set("Retry-After", String(rateCheck.retryAfterSeconds));
    response.headers.set("X-RateLimit-Limit", String(rateCheck.limit));
    response.headers.set("X-RateLimit-Remaining", "0");
    response.headers.set("X-RateLimit-Reset", String(rateCheck.resetAt));
    throw new ScimAuthError(response);
  }

  // Throttled lastUsedAt / lastUsedIp telemetry. Fire-and-forget so the
  // auth path never blocks on the write; race-safe WHERE clause so two
  // concurrent requests cannot both bump the row.
  const now = new Date();
  const stale =
    !row.lastUsedAt ||
    now.getTime() - row.lastUsedAt.getTime() >= SCIM_LAST_USED_THROTTLE_MS;
  if (stale && !isProbeMarker(request)) {
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const cutoff = new Date(now.getTime() - SCIM_LAST_USED_THROTTLE_MS);
    void prisma.scimToken
      .updateMany({
        where: {
          id: row.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }],
        },
        data: { lastUsedAt: now, lastUsedIp: clientIp },
      })
      .catch((err) => {
        console.error("[scim/auth] Failed to update lastUsedAt:", err);
      });
  }

  // Stamp the authenticating token id onto the ALS audit frame so that
  // captureAuditEvent() — called by the SCIM service layer mid-transaction
  // — derives metadata.source === "scim" and hand-stamps metadata.scimTokenId
  // on every audit row this request produces. Without this, SCIM-driven User
  // and Groups mutations write AuditLog rows with no source/scimTokenId,
  // making them invisible to the /admin/scim conflict-log query.
  updateAuditContext({ scimTokenId: row.id });

  return { tokenId: row.id, systemUserId: row.systemUserId };
}
