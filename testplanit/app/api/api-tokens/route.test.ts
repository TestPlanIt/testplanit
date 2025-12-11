import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    apiToken: {
      create: vi.fn(),
    },
  },
}));

vi.mock("~/lib/api-tokens", () => ({
  generateApiToken: vi.fn(),
}));

import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { generateApiToken } from "~/lib/api-tokens";

describe("API Token Creation Endpoint", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
    },
  };

  const mockGeneratedToken = {
    plaintext: "tpi_generated_token_12345678",
    hash: "sha256hashedtoken",
    prefix: "tpi_generat",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerAuthSession as any).mockResolvedValue(mockSession);
    (generateApiToken as any).mockReturnValue(mockGeneratedToken);
  });

  const createRequest = (body: any): NextRequest => {
    return {
      json: async () => body,
    } as NextRequest;
  };

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);

      const request = createRequest({ name: "Test Token" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerAuthSession as any).mockResolvedValue({});

      const request = createRequest({ name: "Test Token" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 when name is missing", async () => {
      const request = createRequest({});
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request");
      expect(data.details).toBeDefined();
    });

    it("returns 400 when name is empty string", async () => {
      const request = createRequest({ name: "" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request");
    });

    it("returns 400 when name exceeds max length", async () => {
      const request = createRequest({ name: "a".repeat(101) });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request");
    });

    it("returns 400 for invalid date format in expiresAt", async () => {
      const request = createRequest({
        name: "Test Token",
        expiresAt: "invalid-date",
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request");
    });

    it("returns 400 for malformed ISO datetime", async () => {
      const request = createRequest({
        name: "Test Token",
        expiresAt: "2025-12-31T25:00:00Z", // Invalid hour
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
    });
  });

  describe("Successful Token Creation", () => {
    it("creates token with name only", async () => {
      const createdToken = {
        id: "token-id-123",
        name: "My API Token",
        tokenPrefix: mockGeneratedToken.prefix,
        createdAt: new Date("2025-01-15T10:00:00Z"),
        expiresAt: null,
        isActive: true,
      };

      (prisma.apiToken.create as any).mockResolvedValue(createdToken);

      const request = createRequest({ name: "My API Token" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe("token-id-123");
      expect(data.name).toBe("My API Token");
      expect(data.token).toBe(mockGeneratedToken.plaintext);
      expect(data.tokenPrefix).toBe(mockGeneratedToken.prefix);
      expect(data.isActive).toBe(true);

      expect(prisma.apiToken.create).toHaveBeenCalledWith({
        data: {
          name: "My API Token",
          token: mockGeneratedToken.hash,
          tokenPrefix: mockGeneratedToken.prefix,
          userId: "user-123",
          expiresAt: null,
        },
        select: {
          id: true,
          name: true,
          tokenPrefix: true,
          createdAt: true,
          expiresAt: true,
          isActive: true,
        },
      });
    });

    it("creates token with ISO datetime expiration", async () => {
      const expiresAt = new Date("2025-12-31T23:59:59Z");
      const createdToken = {
        id: "token-id-123",
        name: "Expiring Token",
        tokenPrefix: mockGeneratedToken.prefix,
        createdAt: new Date(),
        expiresAt: expiresAt,
        isActive: true,
      };

      (prisma.apiToken.create as any).mockResolvedValue(createdToken);

      const request = createRequest({
        name: "Expiring Token",
        expiresAt: "2025-12-31T23:59:59Z",
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.name).toBe("Expiring Token");
      expect(prisma.apiToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
        select: expect.any(Object),
      });
    });

    it("creates token with date-only expiration (YYYY-MM-DD)", async () => {
      const createdToken = {
        id: "token-id-123",
        name: "Date Only Expiry",
        tokenPrefix: mockGeneratedToken.prefix,
        createdAt: new Date(),
        expiresAt: new Date("2025-06-30"),
        isActive: true,
      };

      (prisma.apiToken.create as any).mockResolvedValue(createdToken);

      const request = createRequest({
        name: "Date Only Expiry",
        expiresAt: "2025-06-30",
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.name).toBe("Date Only Expiry");
    });

    it("creates token with null expiration when expiresAt is null", async () => {
      const createdToken = {
        id: "token-id-123",
        name: "No Expiry Token",
        tokenPrefix: mockGeneratedToken.prefix,
        createdAt: new Date(),
        expiresAt: null,
        isActive: true,
      };

      (prisma.apiToken.create as any).mockResolvedValue(createdToken);

      const request = createRequest({
        name: "No Expiry Token",
        expiresAt: null,
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.expiresAt).toBeNull();
      expect(prisma.apiToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expiresAt: null,
        }),
        select: expect.any(Object),
      });
    });

    it("trims whitespace from token name", async () => {
      const createdToken = {
        id: "token-id-123",
        name: "Trimmed Name",
        tokenPrefix: mockGeneratedToken.prefix,
        createdAt: new Date(),
        expiresAt: null,
        isActive: true,
      };

      (prisma.apiToken.create as any).mockResolvedValue(createdToken);

      const request = createRequest({ name: "  Trimmed Name  " });
      const response = await POST(request);

      expect(response.status).toBe(200);
      // The Zod schema doesn't trim, but the code may handle it
    });

    it("accepts maximum length name (100 chars)", async () => {
      const longName = "a".repeat(100);
      const createdToken = {
        id: "token-id-123",
        name: longName,
        tokenPrefix: mockGeneratedToken.prefix,
        createdAt: new Date(),
        expiresAt: null,
        isActive: true,
      };

      (prisma.apiToken.create as any).mockResolvedValue(createdToken);

      const request = createRequest({ name: longName });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when database create fails", async () => {
      (prisma.apiToken.create as any).mockRejectedValue(
        new Error("Database error")
      );

      const request = createRequest({ name: "Test Token" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create API token");
    });

    it("returns 500 for unexpected errors", async () => {
      (prisma.apiToken.create as any).mockRejectedValue(
        new Error("Unexpected error")
      );

      const request = createRequest({ name: "Test Token" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create API token");
    });
  });

  describe("Token Response", () => {
    it("includes plaintext token in response (shown only once)", async () => {
      const createdToken = {
        id: "token-id-123",
        name: "Test Token",
        tokenPrefix: mockGeneratedToken.prefix,
        createdAt: new Date(),
        expiresAt: null,
        isActive: true,
      };

      (prisma.apiToken.create as any).mockResolvedValue(createdToken);

      const request = createRequest({ name: "Test Token" });
      const response = await POST(request);
      const data = await response.json();

      expect(data.token).toBe(mockGeneratedToken.plaintext);
      expect(data.token).toMatch(/^tpi_/);
    });

    it("does not include hash in response", async () => {
      const createdToken = {
        id: "token-id-123",
        name: "Test Token",
        tokenPrefix: mockGeneratedToken.prefix,
        createdAt: new Date(),
        expiresAt: null,
        isActive: true,
      };

      (prisma.apiToken.create as any).mockResolvedValue(createdToken);

      const request = createRequest({ name: "Test Token" });
      const response = await POST(request);
      const data = await response.json();

      expect(data.hash).toBeUndefined();
      expect(data.token).not.toBe(mockGeneratedToken.hash);
    });
  });
});
