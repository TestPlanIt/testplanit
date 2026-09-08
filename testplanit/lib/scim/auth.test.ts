/**
 * Unit tests for the SCIM bearer middleware helper.
 *
 * Coverage surface:
 *
 *   1. No Authorization header -> "Missing Authorization header"
 *   2. Bearer with non-SCIM prefix -> "Invalid token format" AND no DB hit
 *   3. Bearer tps_* but no DB row -> "Token rejected"
 *   4. Bearer tps_* but expired -> "Token expired"
 *   5. Bearer tps_* but revoked -> "Token revoked"
 *   6. Bearer tps_* but inactive -> "Token inactive"
 *   7. Happy path with recent lastUsedAt -> ctx, throttled (no updateMany)
 *   8. Happy path with stale lastUsedAt -> ctx + updateMany fires once
 *   9. Happy path with null lastUsedAt -> ctx + updateMany fires once
 *  10. Probe-marker carve-out -> ctx, updateMany suppressed even when stale
 *  11. Content-Type assertion on every 401 (application/scim+json)
 *  12. Schemas envelope assertion on every 401
 *
 * Mock shape: vi.mock("~/lib/db") so the helper never touches a real DB.
 * NEXTAUTH_SECRET is saved and restored per the api-tokens.test.ts pattern
 * because hashToken reads it for the HMAC.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

vi.mock("~/lib/db", () => ({
  baseDb: {
    scimToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

vi.mock("./rate-limit", () => ({
  checkScimTokenRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 50,
    remaining: 49,
    resetAt: Math.floor(Date.now() / 1000) + 1,
    retryAfterSeconds: 1,
  }),
}));

import { baseDb } from "~/lib/db";
import { ScimAuthError, requireScimBearer } from "./auth";
import { checkScimTokenRateLimit } from "./rate-limit";

const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

const originalSecret = process.env.NEXTAUTH_SECRET;

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-scim-token-hashing";
});

afterAll(() => {
  if (originalSecret) {
    process.env.NEXTAUTH_SECRET = originalSecret;
  } else {
    delete process.env.NEXTAUTH_SECRET;
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Build a NextRequest with optional Authorization + extra headers + URL. */
function req(
  authHeader?: string,
  extraHeaders: Record<string, string> = {},
  url = "http://example.com/api/scim/v2/Users"
): NextRequest {
  const headers = new Headers();
  if (authHeader) {
    headers.set("authorization", authHeader);
  }
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers.set(k, v);
  }
  return new NextRequest(new URL(url), { headers });
}

/**
 * Run the helper expecting failure, return the caught ScimAuthError so the
 * test can assert against response.status, headers, and body.
 */
async function catchAuthError(request: NextRequest): Promise<ScimAuthError> {
  try {
    await requireScimBearer(request);
  } catch (err) {
    if (err instanceof ScimAuthError) {
      return err;
    }
    throw err;
  }
  throw new Error("Expected requireScimBearer to throw ScimAuthError");
}

describe("requireScimBearer", () => {
  it("throws Missing Authorization header when no Authorization header is set", async () => {
    const err = await catchAuthError(req());

    expect(err.response.status).toBe(401);
    expect(err.response.headers.get("Content-Type")).toBe(
      "application/scim+json"
    );

    const body = await err.response.json();
    expect(body.detail).toBe("Missing Authorization header");
    expect(body.status).toBe("401");
    expect(body.schemas[0]).toBe(SCIM_ERROR_SCHEMA);
    expect(baseDb.scimToken.findUnique).not.toHaveBeenCalled();
  });

  it("throws Invalid token format for a Bearer value lacking the tps_ prefix and never hits the DB", async () => {
    const err = await catchAuthError(req("Bearer tpi_some_api_token_value"));

    expect(err.response.status).toBe(401);
    expect(err.response.headers.get("Content-Type")).toBe(
      "application/scim+json"
    );

    const body = await err.response.json();
    expect(body.detail).toBe("Invalid token format");
    expect(body.schemas[0]).toBe(SCIM_ERROR_SCHEMA);
    // Namespace-isolation invariant: prefix branch fires before any DB
    // lookup so a tpi_* API token never touches the ScimToken table.
    expect(baseDb.scimToken.findUnique).not.toHaveBeenCalled();
  });

  it("throws Token rejected when findUnique returns null for a tps_ token", async () => {
    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce(null);

    const err = await catchAuthError(req("Bearer tps_unknown_token_value"));

    expect(err.response.status).toBe(401);
    expect(err.response.headers.get("Content-Type")).toBe(
      "application/scim+json"
    );

    const body = await err.response.json();
    expect(body.detail).toBe("Token rejected");
    expect(body.schemas[0]).toBe(SCIM_ERROR_SCHEMA);
    expect(baseDb.scimToken.findUnique).toHaveBeenCalledTimes(1);
  });

  it("throws Token expired when the row's expiresAt is in the past", async () => {
    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
      id: "tk_expired",
      systemUserId: "system-scim-user",
      isActive: true,
      expiresAt: new Date(Date.now() - 60_000),
      revokedAt: null,
      lastUsedAt: null,
    } as never);

    const err = await catchAuthError(req("Bearer tps_expired_token_value"));

    expect(err.response.status).toBe(401);
    expect(err.response.headers.get("Content-Type")).toBe(
      "application/scim+json"
    );

    const body = await err.response.json();
    expect(body.detail).toBe("Token expired");
    expect(body.schemas[0]).toBe(SCIM_ERROR_SCHEMA);
    expect(baseDb.scimToken.updateMany).not.toHaveBeenCalled();
  });

  it("throws Token revoked when revokedAt is set (and expiresAt is null)", async () => {
    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
      id: "tk_revoked",
      systemUserId: "system-scim-user",
      isActive: true,
      expiresAt: null,
      revokedAt: new Date(Date.now() - 86_400_000),
      lastUsedAt: null,
    } as never);

    const err = await catchAuthError(req("Bearer tps_revoked_token_value"));

    expect(err.response.status).toBe(401);
    const body = await err.response.json();
    expect(body.detail).toBe("Token revoked");
    expect(body.schemas[0]).toBe(SCIM_ERROR_SCHEMA);
    expect(baseDb.scimToken.updateMany).not.toHaveBeenCalled();
  });

  it("throws Token inactive when isActive is false without revokedAt or expiresAt", async () => {
    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
      id: "tk_inactive",
      systemUserId: "system-scim-user",
      isActive: false,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    } as never);

    const err = await catchAuthError(req("Bearer tps_inactive_token_value"));

    expect(err.response.status).toBe(401);
    const body = await err.response.json();
    expect(body.detail).toBe("Token inactive");
    expect(body.schemas[0]).toBe(SCIM_ERROR_SCHEMA);
    expect(baseDb.scimToken.updateMany).not.toHaveBeenCalled();
  });

  it("returns the auth context for a valid token and skips updateMany when lastUsedAt is recent", async () => {
    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
      id: "tk_recent",
      systemUserId: "system-scim-user",
      isActive: true,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: new Date(Date.now() - 30_000),
    } as never);

    const ctx = await requireScimBearer(req("Bearer tps_recent_token_value"));
    expect(ctx).toEqual({
      tokenId: "tk_recent",
      systemUserId: "system-scim-user",
    });

    // wait one microtask for any fire-and-forget; should still be zero.
    await new Promise(setImmediate);
    expect(baseDb.scimToken.updateMany).not.toHaveBeenCalled();
  });

  it("stamps scimTokenId onto the ALS audit frame so captureAuditEvent derives metadata.source=scim", async () => {
    const { runWithAuditContext, getAuditContext } =
      await import("~/lib/auditContext");

    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
      id: "tk_audit_frame",
      systemUserId: "system-scim-user",
      isActive: true,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: new Date(Date.now() - 30_000),
    } as never);

    let frameDuringAuth: { scimTokenId?: string } | undefined;
    await runWithAuditContext({ requestId: "req_test" }, async () => {
      await requireScimBearer(req("Bearer tps_audit_frame_token_value"));
      frameDuringAuth = getAuditContext();
    });

    expect(frameDuringAuth?.scimTokenId).toBe("tk_audit_frame");
  });

  it("fires the throttled updateMany when lastUsedAt is older than the throttle window", async () => {
    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
      id: "tk_stale",
      systemUserId: "system-scim-user",
      isActive: true,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: new Date(Date.now() - 90_000),
    } as never);

    const ctx = await requireScimBearer(
      req("Bearer tps_stale_token_value", {
        "x-forwarded-for": "203.0.113.7, 70.41.3.18",
      })
    );
    expect(ctx).toEqual({
      tokenId: "tk_stale",
      systemUserId: "system-scim-user",
    });

    await new Promise(setImmediate);
    expect(baseDb.scimToken.updateMany).toHaveBeenCalledTimes(1);

    const call = vi.mocked(baseDb.scimToken.updateMany).mock.calls[0]![0]! as {
      where: { id: string; OR: Array<{ lastUsedAt: null | { lt: Date } }> };
      data: { lastUsedAt: Date; lastUsedIp: string };
    };
    expect(call.where.id).toBe("tk_stale");
    // race-safe guard: OR(lastUsedAt IS NULL, lastUsedAt < cutoff)
    expect(Array.isArray(call.where.OR)).toBe(true);
    expect(call.where.OR).toHaveLength(2);
    expect(call.where.OR[0]).toEqual({ lastUsedAt: null });
    const cutoffEntry = call.where.OR[1]!.lastUsedAt as { lt: Date };
    expect(cutoffEntry.lt).toBeInstanceOf(Date);
    // first hop of x-forwarded-for is recorded as lastUsedIp.
    expect(call.data.lastUsedIp).toBe("203.0.113.7");
    expect(call.data.lastUsedAt).toBeInstanceOf(Date);
  });

  it("fires the throttled updateMany when lastUsedAt is null", async () => {
    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
      id: "tk_null_lastused",
      systemUserId: "system-scim-user",
      isActive: true,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    } as never);

    const ctx = await requireScimBearer(req("Bearer tps_null_lastused_value"));
    expect(ctx).toEqual({
      tokenId: "tk_null_lastused",
      systemUserId: "system-scim-user",
    });

    await new Promise(setImmediate);
    expect(baseDb.scimToken.updateMany).toHaveBeenCalledTimes(1);
    const call = vi.mocked(baseDb.scimToken.updateMany).mock.calls[0]![0]! as {
      data: { lastUsedIp: string };
    };
    // No x-forwarded-for / x-real-ip on this request -> "unknown".
    expect(call.data.lastUsedIp).toBe("unknown");
  });

  it("suppresses the throttled updateMany when the probe-marker header is set AND the origin is loopback", async () => {
    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
      id: "tk_probe",
      systemUserId: "system-scim-user",
      isActive: true,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: new Date(Date.now() - 120_000),
    } as never);

    const ctx = await requireScimBearer(
      req(
        "Bearer tps_probe_token_value",
        { "x-scim-probe": "1" },
        "http://localhost/api/scim/v2/ServiceProviderConfig"
      )
    );
    expect(ctx).toEqual({
      tokenId: "tk_probe",
      systemUserId: "system-scim-user",
    });

    await new Promise(setImmediate);
    // Carve-out: probe path does not tick lastUsedAt.
    expect(baseDb.scimToken.updateMany).not.toHaveBeenCalled();
  });

  describe("rate-limit gate", () => {
    beforeEach(() => {
      vi.mocked(checkScimTokenRateLimit).mockReset();
      vi.mocked(checkScimTokenRateLimit).mockResolvedValue({
        allowed: true,
        limit: 50,
        remaining: 49,
        resetAt: Math.floor(Date.now() / 1000) + 1,
        retryAfterSeconds: 1,
      });
    });

    it("F1: throws 429 with SCIM envelope when rate limit is exceeded", async () => {
      vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
        id: "tk_rl1",
        systemUserId: "system-scim-user",
        isActive: true,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      } as never);
      vi.mocked(checkScimTokenRateLimit).mockResolvedValueOnce({
        allowed: false,
        limit: 50,
        remaining: 0,
        resetAt: 1_750_000_000,
        retryAfterSeconds: 1,
      });

      const err = await catchAuthError(req("Bearer tps_rl1_token_value"));
      expect(err.response.status).toBe(429);
      expect(err.response.headers.get("Content-Type")).toBe(
        "application/scim+json"
      );

      const body = await err.response.json();
      expect(body.schemas[0]).toBe(SCIM_ERROR_SCHEMA);
      expect(body.status).toBe("429");
      expect(body.detail).toBe("Rate limit exceeded");
    });

    it("F2: 429 response includes Retry-After + X-RateLimit-Limit/Remaining/Reset headers", async () => {
      vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
        id: "tk_rl2",
        systemUserId: "system-scim-user",
        isActive: true,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      } as never);
      vi.mocked(checkScimTokenRateLimit).mockResolvedValueOnce({
        allowed: false,
        limit: 50,
        remaining: 0,
        resetAt: 1_750_000_000,
        retryAfterSeconds: 1,
      });

      const err = await catchAuthError(req("Bearer tps_rl2_token_value"));
      expect(err.response.headers.get("Retry-After")).toBe("1");
      expect(err.response.headers.get("X-RateLimit-Limit")).toBe("50");
      expect(err.response.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(err.response.headers.get("X-RateLimit-Reset")).toBe("1750000000");
    });

    it("F3: rate-limit check fires AFTER the isActive check (inactive token returns 401, not 429)", async () => {
      vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
        id: "tk_rl3",
        systemUserId: "system-scim-user",
        isActive: false,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      } as never);
      // Set the rate-limit mock to "blocked" — but auth should short-circuit
      // on isActive=false before reaching the rate gate.
      vi.mocked(checkScimTokenRateLimit).mockResolvedValueOnce({
        allowed: false,
        limit: 50,
        remaining: 0,
        resetAt: 1_750_000_000,
        retryAfterSeconds: 1,
      });

      const err = await catchAuthError(req("Bearer tps_rl3_token_value"));
      expect(err.response.status).toBe(401);
      const body = await err.response.json();
      expect(body.detail).toBe("Token inactive");

      expect(checkScimTokenRateLimit).not.toHaveBeenCalled();
    });

    it("F4: allowed=true proceeds normally and returns ScimAuthContext", async () => {
      vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
        id: "tk_rl4",
        systemUserId: "system-scim-user",
        isActive: true,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: new Date(Date.now() - 30_000),
      } as never);
      vi.mocked(checkScimTokenRateLimit).mockResolvedValueOnce({
        allowed: true,
        limit: 50,
        remaining: 49,
        resetAt: 1_750_000_000,
        retryAfterSeconds: 1,
      });

      const ctx = await requireScimBearer(req("Bearer tps_rl4_token_value"));
      expect(ctx).toEqual({
        tokenId: "tk_rl4",
        systemUserId: "system-scim-user",
      });
      expect(checkScimTokenRateLimit).toHaveBeenCalledWith("tk_rl4");
    });
  });

  it("still fires updateMany when X-SCIM-Probe is set but the origin is NOT loopback", async () => {
    // Defense check: the header alone must not suppress telemetry. An
    // external caller cannot mask their activity by spoofing the marker.
    vi.mocked(baseDb.scimToken.findUnique).mockResolvedValueOnce({
      id: "tk_spoof",
      systemUserId: "system-scim-user",
      isActive: true,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: new Date(Date.now() - 120_000),
    } as never);

    const ctx = await requireScimBearer(
      req(
        "Bearer tps_spoof_token_value",
        { "x-scim-probe": "1" },
        "https://scim.example.com/api/scim/v2/ServiceProviderConfig"
      )
    );
    expect(ctx).toEqual({
      tokenId: "tk_spoof",
      systemUserId: "system-scim-user",
    });

    await new Promise(setImmediate);
    expect(baseDb.scimToken.updateMany).toHaveBeenCalledTimes(1);
  });
});
