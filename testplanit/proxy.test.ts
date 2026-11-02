import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Mock lib/session-cache (used for the isApi short-TTL re-check, so tests
// don't hit a real DB/Valkey connection)
vi.mock("~/lib/session-cache", () => ({
  getCachedSessionUser: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import { getCachedSessionUser } from "~/lib/session-cache";
import middlewareWithPreferences from "./proxy";

const mockGetToken = getToken as ReturnType<typeof vi.fn>;
const mockGetCachedSessionUser = getCachedSessionUser as ReturnType<
  typeof vi.fn
>;

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
    // Default: no cached user (cache miss / DB unreachable) — matches
    // pre-fix behavior of trusting token.isApi alone, so existing tests
    // don't need to know about the cache re-check.
    mockGetCachedSessionUser.mockResolvedValue(null);
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
      expect(body.error).toBe(
        "External API access not enabled for this account"
      );
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

  describe("Version route exemption", () => {
    it("passes /api/version through without reading the session", async () => {
      const request = createMockRequest("/api/version", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(200);
      expect(mockGetToken).not.toHaveBeenCalled();
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

      const request = createMockRequest(
        "/api/projects/123/cases/bulk-edit",
        {}
      );

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });
  });

  describe("Share route exemption", () => {
    it("should not apply API access control to /api/share routes (unauthenticated)", async () => {
      mockGetToken.mockResolvedValue(null);

      const request = createMockRequest("/api/share/abc123/report", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should not apply API access control to /api/share routes (authenticated non-API user)", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/share/abc123/report", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should not apply API access control to /api/share metadata routes", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/share/abc123", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("no longer exempts requests carrying x-shared-report-bypass (forgeable header)", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      // The internal share-replay fetch carries no cookies, so it never
      // reaches this branch; a cookie-bearing request with the header is a
      // forgery attempt and gets the normal external-API treatment.
      const request = createMockRequest("/api/reports/automation-trends", {
        "x-shared-report-bypass": "true",
      });

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });

    it("should still block non-share API routes without the bypass header", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/reports/automation-trends", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });
  });

  describe("OAuth integration route exemption", () => {
    it("should not apply API access control to the Jira OAuth callback route", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      // Simulates the real-world redirect: Atlassian navigates the user's
      // browser back to us with no same-origin signals at all.
      const request = createMockRequest(
        "/api/integrations/oauth/jira/callback?code=abc&state=xyz",
        {}
      );

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should not apply API access control to the OAuth auth (redirect-out) route", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest(
        "/api/integrations/oauth/github/auth",
        {}
      );

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
    });

    it("should still block unrelated routes nested under /api/integrations", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });

      const request = createMockRequest("/api/integrations/jira/test-info", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });
  });

  describe("isApi short-TTL cache re-check", () => {
    it("should allow a request when the JWT's isApi is stale but the cache reflects a fresh grant", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false, // stale — baked in before the admin enabled API access
      });
      mockGetCachedSessionUser.mockResolvedValue({ isApi: true });

      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
      expect(mockGetCachedSessionUser).toHaveBeenCalledWith("user-123");
    });

    it("should still block when both the JWT and the cache say isApi is false", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });
      mockGetCachedSessionUser.mockResolvedValue({ isApi: false });

      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });

    it("should not consult the cache when the JWT already grants isApi", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: true,
      });

      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).not.toBe(403);
      expect(mockGetCachedSessionUser).not.toHaveBeenCalled();
    });

    it("should still block when the cache lookup misses (e.g. DB unreachable)", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        isApi: false,
      });
      mockGetCachedSessionUser.mockResolvedValue(null);

      const request = createMockRequest("/api/model/users", {});

      const response = await middlewareWithPreferences(request);

      expect(response.status).toBe(403);
    });
  });
  describe("Stale session cookie on page routes", () => {
    const pageHeaders = { "sec-fetch-site": "same-origin" };

    it("redirects to the localized sign-in with a reason and clears the cookie when the password changed since the token was issued", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        passwordChangedAt: null, // issued before the user's first-ever change
      });
      mockGetCachedSessionUser.mockResolvedValue({
        authMethod: "INTERNAL",
        passwordChangedAt: "2026-06-01T00:00:00.000Z",
        isActive: true,
      });

      const response = await middlewareWithPreferences(
        createMockRequest("/en-US/users/profile/user-123", pageHeaders)
      );

      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/en-US/signin");
      expect(location.searchParams.get("error")).toBe("SessionEnded");
      // Never clear the cookie here: this request's cookie may be older than
      // the one the browser now holds.
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("redirects a deactivated user whatever their auth method", async () => {
      mockGetToken.mockResolvedValue({ sub: "user-123", access: "USER" });
      mockGetCachedSessionUser.mockResolvedValue({
        authMethod: "SSO",
        passwordChangedAt: null,
        isActive: false,
      });

      const response = await middlewareWithPreferences(
        createMockRequest("/en-US/projects", pageHeaders)
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/en-US/signin"
      );
    });

    it("passes through when the token carries the current timestamp", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        passwordChangedAt: "2026-06-01T00:00:00.000Z",
      });
      mockGetCachedSessionUser.mockResolvedValue({
        authMethod: "INTERNAL",
        passwordChangedAt: "2026-06-01T00:00:00.000Z",
        isActive: true,
      });

      const response = await middlewareWithPreferences(
        createMockRequest("/en-US/projects", pageHeaders)
      );

      expect(response.status).not.toBe(307);
    });

    it("ignores password timestamps for SSO-only users", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        passwordChangedAt: null,
      });
      mockGetCachedSessionUser.mockResolvedValue({
        authMethod: "SSO",
        passwordChangedAt: "2026-06-01T00:00:00.000Z",
        isActive: true,
      });

      const response = await middlewareWithPreferences(
        createMockRequest("/en-US/projects", pageHeaders)
      );

      expect(response.status).not.toBe(307);
    });

    it("passes through on a cache miss and never runs the check on public routes", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        passwordChangedAt: null,
      });
      mockGetCachedSessionUser.mockResolvedValue(null);

      let response = await middlewareWithPreferences(
        createMockRequest("/en-US/projects", pageHeaders)
      );
      expect(response.status).not.toBe(307);

      mockGetCachedSessionUser.mockClear();
      response = await middlewareWithPreferences(
        createMockRequest("/en-US/share/some-token", pageHeaders)
      );
      expect(mockGetCachedSessionUser).not.toHaveBeenCalled();
    });
  });
  describe("Signed-in visitor on the sign-in page", () => {
    const pageHeaders = { "sec-fetch-site": "same-origin" };
    const liveUser = {
      authMethod: "INTERNAL",
      passwordChangedAt: null,
      isActive: true,
    };

    beforeEach(() => {
      process.env.NEXTAUTH_URL = "http://localhost:3000";
    });

    afterEach(() => {
      delete process.env.NEXTAUTH_URL;
    });

    it("sends a signed-in visitor to the localized home page", async () => {
      mockGetToken.mockResolvedValue({ sub: "user-123", access: "USER" });
      mockGetCachedSessionUser.mockResolvedValue(liveUser);

      const response = await middlewareWithPreferences(
        createMockRequest("/en-US/signin", pageHeaders)
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/en-US/"
      );
    });

    it("honours a same-origin callbackUrl", async () => {
      mockGetToken.mockResolvedValue({ sub: "user-123", access: "USER" });
      mockGetCachedSessionUser.mockResolvedValue(liveUser);

      const response = await middlewareWithPreferences(
        createMockRequest(
          "/en-US/signin?callbackUrl=%2Fen-US%2Fprojects%2Frepository%2F1",
          pageHeaders
        )
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/en-US/projects/repository/1"
      );
    });

    it("ignores an off-site callbackUrl and goes home instead", async () => {
      mockGetToken.mockResolvedValue({ sub: "user-123", access: "USER" });
      mockGetCachedSessionUser.mockResolvedValue(liveUser);

      const response = await middlewareWithPreferences(
        createMockRequest(
          "/en-US/signin?callbackUrl=https%3A%2F%2Fevil.example%2Fphish",
          pageHeaders
        )
      );

      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.origin).toBe("http://localhost:3000");
      expect(location.pathname).toBe("/en-US/");
    });

    it("sends a session the server no longer honours back with the reason, without touching the cookie", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        passwordChangedAt: null,
      });
      mockGetCachedSessionUser.mockResolvedValue({
        ...liveUser,
        passwordChangedAt: "2026-06-01T00:00:00.000Z",
      });

      const response = await middlewareWithPreferences(
        createMockRequest("/en-US/signin", pageHeaders)
      );

      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/en-US/signin");
      expect(location.searchParams.get("error")).toBe("SessionEnded");
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("renders the page for an ended session that already carries the reason", async () => {
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        passwordChangedAt: null,
      });
      mockGetCachedSessionUser.mockResolvedValue({
        ...liveUser,
        passwordChangedAt: "2026-06-01T00:00:00.000Z",
      });

      const response = await middlewareWithPreferences(
        createMockRequest("/en-US/signin?error=SessionEnded", pageHeaders)
      );

      expect(response.status).not.toBe(307);
    });

    it("sends a browser that still holds a VALID cookie home even if it arrives with error=SessionEnded", async () => {
      // A raced request with an older cookie triggered the redirect, but the
      // browser followed it with the newer cookie it already had.
      mockGetToken.mockResolvedValue({
        sub: "user-123",
        access: "USER",
        passwordChangedAt: "2026-06-01T00:00:00.000Z",
      });
      mockGetCachedSessionUser.mockResolvedValue({
        ...liveUser,
        passwordChangedAt: "2026-06-01T00:00:00.000Z",
      });

      const response = await middlewareWithPreferences(
        createMockRequest("/en-US/signin?error=SessionEnded", pageHeaders)
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/en-US/"
      );
    });

    it("lets an anonymous visitor through", async () => {
      mockGetToken.mockResolvedValue(null);

      const response = await middlewareWithPreferences(
        createMockRequest("/en-US/signin", pageHeaders)
      );

      expect(response.status).not.toBe(307);
    });

    it("still shows the page for NextAuth error redirects", async () => {
      mockGetToken.mockResolvedValue({ sub: "user-123", access: "USER" });

      const response = await middlewareWithPreferences(
        createMockRequest(
          "/en-US/signin?error=OAuthAccountNotLinked",
          pageHeaders
        )
      );

      expect(response.status).not.toBe(307);
      expect(mockGetToken).not.toHaveBeenCalled();
    });
  });
});
