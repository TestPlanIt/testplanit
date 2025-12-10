import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  extractBearerToken,
  authenticateApiToken,
  hasBearerToken,
} from "./api-token-auth";
import { hashToken, generateApiToken } from "./api-tokens";

// Mock prisma
vi.mock("./prisma", () => ({
  prisma: {
    apiToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "./prisma";

describe("API Token Authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: update succeeds
    (prisma.apiToken.update as any).mockResolvedValue({});
  });

  const createMockRequest = (authHeader?: string): NextRequest => {
    const headers = new Headers();
    if (authHeader) {
      headers.set("authorization", authHeader);
    }
    return {
      headers,
    } as unknown as NextRequest;
  };

  describe("extractBearerToken", () => {
    it("extracts token from valid Bearer header", () => {
      const request = createMockRequest("Bearer tpi_test_token");
      const token = extractBearerToken(request);
      expect(token).toBe("tpi_test_token");
    });

    it("returns null when no Authorization header", () => {
      const request = createMockRequest();
      const token = extractBearerToken(request);
      expect(token).toBeNull();
    });

    it("returns null for non-Bearer auth schemes", () => {
      const request = createMockRequest("Basic dXNlcjpwYXNz");
      const token = extractBearerToken(request);
      expect(token).toBeNull();
    });

    it("returns null for Bearer without token (Headers strips trailing space)", () => {
      const request = createMockRequest("Bearer ");
      const token = extractBearerToken(request);
      // Note: Headers API normalizes "Bearer " to "Bearer", stripping trailing space
      // So "Bearer".startsWith("Bearer ") returns false, and we return null
      expect(token).toBeNull();
    });

    it("trims whitespace from token", () => {
      const request = createMockRequest("Bearer   tpi_test_token   ");
      const token = extractBearerToken(request);
      expect(token).toBe("tpi_test_token");
    });

    it("handles Bearer with lowercase", () => {
      const request = createMockRequest("bearer tpi_test_token");
      const token = extractBearerToken(request);
      // Should not match as Bearer is case-sensitive
      expect(token).toBeNull();
    });
  });

  describe("hasBearerToken", () => {
    it("returns true for valid tpi_ Bearer token", () => {
      const request = createMockRequest("Bearer tpi_some_token_value");
      expect(hasBearerToken(request)).toBe(true);
    });

    it("returns false when no Authorization header", () => {
      const request = createMockRequest();
      expect(hasBearerToken(request)).toBe(false);
    });

    it("returns false for Bearer without tpi_ prefix", () => {
      const request = createMockRequest("Bearer some_other_token");
      expect(hasBearerToken(request)).toBe(false);
    });

    it("returns false for non-Bearer auth", () => {
      const request = createMockRequest("Basic tpi_looks_like_token");
      expect(hasBearerToken(request)).toBe(false);
    });
  });

  describe("authenticateApiToken", () => {
    const createValidToken = () => {
      const { plaintext, hash } = generateApiToken();
      return { plaintext, hash };
    };

    it("returns NO_TOKEN error when no token provided", async () => {
      const request = createMockRequest();
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("NO_TOKEN");
      expect(result.error).toBe("No Bearer token provided");
    });

    it("returns INVALID_FORMAT error for malformed token", async () => {
      const request = createMockRequest("Bearer invalid_token_format");
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("INVALID_FORMAT");
      expect(result.error).toBe("Invalid token format");
    });

    it("returns INVALID_FORMAT error for token without prefix", async () => {
      const request = createMockRequest("Bearer " + "a".repeat(50));
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("INVALID_FORMAT");
    });

    it("returns INVALID_TOKEN error when token not found in database", async () => {
      (prisma.apiToken.findUnique as any).mockResolvedValue(null);

      const { plaintext } = createValidToken();
      const request = createMockRequest(`Bearer ${plaintext}`);
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("INVALID_TOKEN");
      expect(result.error).toBe("Invalid API token");
    });

    it("returns INACTIVE_TOKEN error when token is revoked", async () => {
      const { plaintext, hash } = createValidToken();

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id",
        token: hash,
        isActive: false,
        expiresAt: null,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: true,
          isDeleted: false,
          isApi: true,
        },
      });

      const request = createMockRequest(`Bearer ${plaintext}`);
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("INACTIVE_TOKEN");
      expect(result.error).toBe("API token has been revoked");
    });

    it("returns EXPIRED_TOKEN error when token is expired", async () => {
      const { plaintext, hash } = createValidToken();
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id",
        token: hash,
        isActive: true,
        expiresAt: expiredDate,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: true,
          isDeleted: false,
          isApi: true,
        },
      });

      const request = createMockRequest(`Bearer ${plaintext}`);
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("EXPIRED_TOKEN");
      expect(result.error).toBe("API token has expired");
    });

    it("returns INACTIVE_USER error when user is inactive", async () => {
      const { plaintext, hash } = createValidToken();

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id",
        token: hash,
        isActive: true,
        expiresAt: null,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: false,
          isDeleted: false,
          isApi: true,
        },
      });

      const request = createMockRequest(`Bearer ${plaintext}`);
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("INACTIVE_USER");
      expect(result.error).toBe("User account is inactive");
    });

    it("returns INACTIVE_USER error when user is deleted", async () => {
      const { plaintext, hash } = createValidToken();

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id",
        token: hash,
        isActive: true,
        expiresAt: null,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: true,
          isDeleted: true,
          isApi: true,
        },
      });

      const request = createMockRequest(`Bearer ${plaintext}`);
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("INACTIVE_USER");
      expect(result.error).toBe("User account is inactive");
    });

    it("returns API_ACCESS_DISABLED error when user has API access disabled", async () => {
      const { plaintext, hash } = createValidToken();

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id",
        token: hash,
        isActive: true,
        expiresAt: null,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: true,
          isDeleted: false,
          isApi: false,
        },
      });

      const request = createMockRequest(`Bearer ${plaintext}`);
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("API_ACCESS_DISABLED");
      expect(result.error).toBe("API access is disabled for this user");
    });

    it("authenticates successfully with valid active token", async () => {
      const { plaintext, hash } = createValidToken();

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id",
        token: hash,
        isActive: true,
        expiresAt: null,
        userId: "user-123",
        scopes: ["read", "write"],
        user: {
          id: "user-123",
          access: "ADMIN",
          isActive: true,
          isDeleted: false,
          isApi: true,
        },
      });

      const request = createMockRequest(`Bearer ${plaintext}`);
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(true);
      expect(result.userId).toBe("user-123");
      expect(result.access).toBe("ADMIN");
      expect(result.scopes).toEqual(["read", "write"]);
      expect(result.error).toBeUndefined();
      expect(result.errorCode).toBeUndefined();
    });

    it("authenticates successfully with non-expired token", async () => {
      const { plaintext, hash } = createValidToken();
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours from now

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id",
        token: hash,
        isActive: true,
        expiresAt: futureDate,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: true,
          isDeleted: false,
          isApi: true,
        },
      });

      const request = createMockRequest(`Bearer ${plaintext}`);
      const result = await authenticateApiToken(request);

      expect(result.authenticated).toBe(true);
    });

    it("updates lastUsedAt timestamp on successful auth", async () => {
      const { plaintext, hash } = createValidToken();

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id-123",
        token: hash,
        isActive: true,
        expiresAt: null,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: true,
          isDeleted: false,
          isApi: true,
        },
      });

      const headers = new Headers();
      headers.set("authorization", `Bearer ${plaintext}`);
      headers.set("x-forwarded-for", "192.168.1.1, 10.0.0.1");

      const request = {
        headers,
      } as unknown as NextRequest;

      await authenticateApiToken(request);

      // Give time for async update
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(prisma.apiToken.update).toHaveBeenCalledWith({
        where: { id: "token-id-123" },
        data: {
          lastUsedAt: expect.any(Date),
          lastUsedIp: "192.168.1.1",
        },
      });
    });

    it("uses x-real-ip header when x-forwarded-for is not available", async () => {
      const { plaintext, hash } = createValidToken();

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id-123",
        token: hash,
        isActive: true,
        expiresAt: null,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: true,
          isDeleted: false,
          isApi: true,
        },
      });

      const headers = new Headers();
      headers.set("authorization", `Bearer ${plaintext}`);
      headers.set("x-real-ip", "10.0.0.5");

      const request = {
        headers,
      } as unknown as NextRequest;

      await authenticateApiToken(request);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(prisma.apiToken.update).toHaveBeenCalledWith({
        where: { id: "token-id-123" },
        data: {
          lastUsedAt: expect.any(Date),
          lastUsedIp: "10.0.0.5",
        },
      });
    });

    it("uses 'unknown' when no IP headers are present", async () => {
      const { plaintext, hash } = createValidToken();

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id-123",
        token: hash,
        isActive: true,
        expiresAt: null,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: true,
          isDeleted: false,
          isApi: true,
        },
      });

      const request = createMockRequest(`Bearer ${plaintext}`);
      await authenticateApiToken(request);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(prisma.apiToken.update).toHaveBeenCalledWith({
        where: { id: "token-id-123" },
        data: {
          lastUsedAt: expect.any(Date),
          lastUsedIp: "unknown",
        },
      });
    });

    it("continues authentication even if lastUsedAt update fails", async () => {
      const { plaintext, hash } = createValidToken();

      (prisma.apiToken.findUnique as any).mockResolvedValue({
        id: "token-id",
        token: hash,
        isActive: true,
        expiresAt: null,
        userId: "user-123",
        scopes: [],
        user: {
          id: "user-123",
          access: "USER",
          isActive: true,
          isDeleted: false,
          isApi: true,
        },
      });

      // Make update fail
      (prisma.apiToken.update as any).mockRejectedValue(
        new Error("DB error")
      );

      const request = createMockRequest(`Bearer ${plaintext}`);
      const result = await authenticateApiToken(request);

      // Auth should still succeed
      expect(result.authenticated).toBe(true);
    });
  });
});
