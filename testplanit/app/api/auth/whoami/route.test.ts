import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies BEFORE importing the route handler.
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateApiToken: vi.fn(),
  // Helpers from plan 05-01 — pass through to the real predicate semantics.
  isReadOnly: (scopes: string[] | undefined) =>
    Array.isArray(scopes) && scopes.includes("mode:read"),
  isMcpClient: (scopes: string[] | undefined) =>
    Array.isArray(scopes) && scopes.includes("client:mcp"),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  enrichFromApiAuth: vi.fn(),
  // withAuditContext is the HOF wrapper around the inner handler — return
  // the handler unchanged so tests invoke handler logic directly.
  withAuditContext: <T extends (...args: any[]) => any>(handler: T): T =>
    handler,
}));

import { authenticateApiToken } from "~/lib/api-token-auth";
import { enrichFromApiAuth } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";

// Importing the route AFTER mocks are registered so the route picks up mocks.
import { GET } from "./route";

const createMockRequest = (authHeader?: string): NextRequest => {
  const headers = new Headers();
  if (authHeader) {
    headers.set("authorization", authHeader);
  }
  return {
    method: "GET",
    headers,
    nextUrl: { searchParams: new URLSearchParams() },
    url: "http://localhost:3000/api/auth/whoami",
  } as unknown as NextRequest;
};

const sessionUser = {
  id: "u_session",
  name: "Sess User",
  email: "session@example.com",
};

const bearerUser = {
  id: "u_bearer",
  name: "Bearer User",
  email: "bearer@example.com",
};

describe("GET /api/auth/whoami — identity probe (SRV-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Unauthenticated", () => {
    it("returns 401 when there is No auth (no session, no Bearer)", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "No Bearer token provided",
        errorCode: "NO_TOKEN",
      });

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.code).toBe("NO_TOKEN");
      expect(data.error).toBe("No Bearer token provided");
    });
  });

  describe("Session authentication", () => {
    it("returns 200 with the canonical 6-field shape for a Valid session", async () => {
      (getServerAuthSession as any).mockResolvedValue({
        user: { id: sessionUser.id, email: sessionUser.email },
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: sessionUser.id,
        name: sessionUser.name,
        email: sessionUser.email,
      });

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        id: sessionUser.id,
        name: sessionUser.name,
        email: sessionUser.email,
        scopes: [],
        readOnly: false,
        isAgent: false,
      });
      // Bearer auth must NOT be invoked when a session is present.
      expect(authenticateApiToken).not.toHaveBeenCalled();
      // Session-authed callers do not have token scopes — enrichFromApiAuth
      // must NOT be called on this branch (T-05-03 mitigation).
      expect(enrichFromApiAuth).not.toHaveBeenCalled();
    });
  });

  describe("Bearer authentication", () => {
    it("returns 200 for a Valid Bearer with empty scopes (TOK-06 regression)", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: bearerUser.id,
        scopes: [],
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: bearerUser.id,
        name: bearerUser.name,
        email: bearerUser.email,
      });

      const response = await GET(
        createMockRequest("Bearer tpi_valid_no_scopes")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        id: bearerUser.id,
        name: bearerUser.name,
        email: bearerUser.email,
        scopes: [],
        readOnly: false,
        isAgent: false,
      });
      expect(enrichFromApiAuth).toHaveBeenCalledTimes(1);
      expect(enrichFromApiAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: bearerUser.id,
          scopes: [],
        })
      );
    });

    it("returns readOnly: true when Bearer scopes include mode:read", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: bearerUser.id,
        scopes: ["mode:read"],
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: bearerUser.id,
        name: bearerUser.name,
        email: bearerUser.email,
      });

      const response = await GET(
        createMockRequest("Bearer tpi_read_only_token")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.scopes).toEqual(["mode:read"]);
      expect(data.readOnly).toBe(true);
      expect(data.isAgent).toBe(false);
      expect(enrichFromApiAuth).toHaveBeenCalledTimes(1);
    });

    it("returns isAgent: true when Bearer scopes include client:mcp", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: bearerUser.id,
        scopes: ["client:mcp"],
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: bearerUser.id,
        name: bearerUser.name,
        email: bearerUser.email,
      });

      const response = await GET(
        createMockRequest("Bearer tpi_mcp_client_token")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.scopes).toEqual(["client:mcp"]);
      expect(data.readOnly).toBe(false);
      expect(data.isAgent).toBe(true);
      expect(enrichFromApiAuth).toHaveBeenCalledTimes(1);
    });

    it("returns both readOnly and isAgent: true when both scopes are present", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: bearerUser.id,
        scopes: ["mode:read", "client:mcp"],
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: bearerUser.id,
        name: bearerUser.name,
        email: bearerUser.email,
      });

      const response = await GET(
        createMockRequest("Bearer tpi_read_only_mcp_token")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.scopes).toEqual(["mode:read", "client:mcp"]);
      expect(data.readOnly).toBe(true);
      expect(data.isAgent).toBe(true);
      expect(enrichFromApiAuth).toHaveBeenCalledTimes(1);
    });

    it("preserves the original errorCode for an Invalid Bearer (T-05-01)", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "Invalid API token",
        errorCode: "INVALID_TOKEN",
      });

      const response = await GET(createMockRequest("Bearer tpi_invalid_token"));
      const data = await response.json();

      expect(response.status).toBe(401);
      // The errorCode MUST be propagated verbatim — no downgrade.
      expect(data.code).toBe("INVALID_TOKEN");
      expect(data.error).toBe("Invalid API token");
      // Failed auth must NOT enrich the ALS frame with a userId.
      expect(enrichFromApiAuth).not.toHaveBeenCalled();
    });

    it("preserves the original errorCode for an EXPIRED_TOKEN Bearer", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "API token has expired",
        errorCode: "EXPIRED_TOKEN",
      });

      const response = await GET(createMockRequest("Bearer tpi_expired_token"));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.code).toBe("EXPIRED_TOKEN");
      expect(data.error).toBe("API token has expired");
    });
  });

  describe("Information disclosure (T-05-06)", () => {
    it("response body has exactly the canonical 6-field shape — no token field, no internal fields", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: bearerUser.id,
        scopes: ["mode:read"],
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: bearerUser.id,
        name: bearerUser.name,
        email: bearerUser.email,
      });

      const response = await GET(
        createMockRequest("Bearer tpi_read_only_token")
      );
      const data = await response.json();

      // The body must contain ONLY the 6 canonical fields. Sort to make the
      // key-set comparison order-independent.
      expect(Object.keys(data).sort()).toEqual(
        ["email", "id", "isAgent", "name", "readOnly", "scopes"].sort()
      );
      // Spot-check that none of the sensitive / internal fields leaked.
      expect(data).not.toHaveProperty("token");
      expect(data).not.toHaveProperty("tokenPrefix");
      expect(data).not.toHaveProperty("tokenHash");
      expect(data).not.toHaveProperty("tenantId");
      expect(data).not.toHaveProperty("isApi");
      expect(data).not.toHaveProperty("isActive");
    });
  });

  describe("enrichFromApiAuth invariants", () => {
    it("does NOT call enrichFromApiAuth on the session-auth path", async () => {
      (getServerAuthSession as any).mockResolvedValue({
        user: { id: sessionUser.id, email: sessionUser.email },
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: sessionUser.id,
        name: sessionUser.name,
        email: sessionUser.email,
      });

      await GET(createMockRequest());

      expect(enrichFromApiAuth).not.toHaveBeenCalled();
    });

    it("calls enrichFromApiAuth exactly once on every successful Bearer-auth path", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: bearerUser.id,
        scopes: ["mode:read", "client:mcp"],
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: bearerUser.id,
        name: bearerUser.name,
        email: bearerUser.email,
      });

      await GET(createMockRequest("Bearer tpi_some_valid_token"));

      expect(enrichFromApiAuth).toHaveBeenCalledTimes(1);
      expect(enrichFromApiAuth).toHaveBeenCalledWith({
        userId: bearerUser.id,
        scopes: ["mode:read", "client:mcp"],
      });
    });
  });
});
