import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock next-auth/jwt
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

// Mock next-intl/middleware
vi.mock("next-intl/middleware", () => ({
  default: vi.fn(() => vi.fn(() => ({ type: "next" }))),
}));

// Mock i18n/navigation
vi.mock("./i18n/navigation", () => ({
  locales: ["en-US"],
  defaultLocale: "en-US",
}));

import { getToken } from "next-auth/jwt";
import middlewareWithPreferences from "./proxy";

const mockGetToken = getToken as ReturnType<typeof vi.fn>;

// Helper to create a mock NextRequest
function createMockRequest(
  url: string,
  headers: Record<string, string> = {}
): NextRequest {
  const request = new NextRequest(new URL(url, "http://localhost:3000"), {
    headers: new Headers(headers),
  });
  return request;
}

describe("External API Access Control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = "test-secret";
  });

  afterEach(() => {
    delete process.env.NEXTAUTH_SECRET;
  });

  describe("isExternalApiRequest detection", () => {
    it("should treat requests with sec-fetch-site: same-origin as browser requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/model/users", {
        "sec-fetch-site": "same-origin",
      });

      const response = await middlewareWithPreferences(request);

      // Should allow the request (not return 403)
      expect(response.status).not.toBe(403);
    });

    it("should treat requests with sec-fetch-site: same-site as browser requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/model/users", {
        "sec-fetch-site": "same-site",
      });

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should treat requests with matching origin header as browser requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/model/users", {
        origin: "http://localhost:3000",
        host: "localhost:3000",
      });

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should treat requests with matching referer header as browser requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/model/users", {
        referer: "http://localhost:3000/dashboard",
        host: "localhost:3000",
      });

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should treat requests without browser headers as external API requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      // No browser-specific headers - simulates curl/Postman/external script
      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("External API access not enabled for this account");
    });
  });

  describe("API access rules", () => {
    it("should allow ADMIN users for external API requests regardless of isApi flag", async () => {
      mockGetToken.mockResolvedValue({
        sub: "admin-123",
        access: "ADMIN",
        isApi: false, // Even with isApi: false
      });

      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should allow users with isApi: true for external API requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: true,
      });

      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should block users with isApi: false for external API requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });

    it("should block users with undefined isApi for external API requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        // isApi not set - simulates old JWT tokens
      });

      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });

    it("should allow PROJECTADMIN users with isApi: true for external API requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "projectadmin-123",
        access: "PROJECTADMIN",
        isApi: true,
      });

      const request = createMockRequest("/api/model/projects", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should block PROJECTADMIN users with isApi: false for external API requests", async () => {
      mockGetToken.mockResolvedValue({
        sub: "projectadmin-123",
        access: "PROJECTADMIN",
        isApi: false,
      });

      const request = createMockRequest("/api/model/projects", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });
  });

  describe("Auth routes exemption", () => {
    it("should not apply API access control to /api/auth routes", async () => {
      // No token - but auth routes should be accessible
      mockGetToken.mockResolvedValue(null);

      const request = createMockRequest("/api/auth/signin", {});

      const response = await middlewareWithPreferences(request);

      // Should not block auth routes
      expect(response.status).not.toBe(403);
    });

    it("should not apply API access control to /api/auth/callback routes", async () => {
      mockGetToken.mockResolvedValue(null);

      const request = createMockRequest("/api/auth/callback/google", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });
  });

  describe("Unauthenticated requests", () => {
    it("should pass through unauthenticated API requests to route handler", async () => {
      mockGetToken.mockResolvedValue(null);

      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      // Should not block at proxy level - let route handler return 401
      expect(response.status).not.toBe(403);
    });
  });

  describe("Different API endpoints", () => {
    it("should apply access control to /api/model routes", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/model/projects", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });

    it("should apply access control to /api/search routes", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/search", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });

    it("should apply access control to nested API routes", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/projects/123/cases/bulk-edit", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });
  });
});
