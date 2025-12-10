import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Mock dependencies
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateApiToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/queues", () => ({
  getAllQueues: vi.fn(),
}));

vi.mock("@/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn(),
  isMultiTenantMode: vi.fn(),
}));

import { getServerAuthSession } from "~/server/auth";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { prisma } from "@/lib/prisma";
import { getAllQueues } from "@/lib/queues";

// Import the route handler after mocks are set up
import { GET } from "./route";

describe("Admin Queue Routes - API Token Authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for queues
    (getAllQueues as any).mockReturnValue({
      forecastQueue: {
        getJobCounts: vi.fn().mockResolvedValue({
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        }),
        getJobs: vi.fn().mockResolvedValue([]),
        isPaused: vi.fn().mockResolvedValue(false),
      },
      notificationQueue: null,
      emailQueue: null,
      syncQueue: null,
      testmoImportQueue: null,
      elasticsearchReindexQueue: null,
    });
  });

  const createMockRequest = (options: {
    authHeader?: string;
    method?: string;
  } = {}): NextRequest => {
    const headers = new Headers();
    if (options.authHeader) {
      headers.set("authorization", options.authHeader);
    }

    return {
      method: options.method || "GET",
      headers,
      nextUrl: {
        searchParams: new URLSearchParams(),
      },
      url: "http://localhost:3000/api/admin/queues",
    } as unknown as NextRequest;
  };

  describe("Session Authentication", () => {
    it("allows access with valid admin session", async () => {
      (getServerAuthSession as any).mockResolvedValue({
        user: { id: "user-123" },
      });

      // The route always looks up access from DB since session doesn't include it
      (prisma.user.findUnique as any).mockResolvedValue({
        access: "ADMIN",
      });

      const request = createMockRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it("allows access when session user is admin after DB lookup", async () => {
      (getServerAuthSession as any).mockResolvedValue({
        user: { id: "user-123" }, // No access field in session
      });

      (prisma.user.findUnique as any).mockResolvedValue({
        access: "ADMIN",
      });

      const request = createMockRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" },
        select: { access: true },
      });
    });

    it("denies access for non-admin session user", async () => {
      (getServerAuthSession as any).mockResolvedValue({
        user: { id: "user-123" },
      });

      (prisma.user.findUnique as any).mockResolvedValue({
        access: "USER",
      });

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Admin access required");
    });
  });

  describe("API Token Authentication", () => {
    it("allows access with valid admin API token when no session", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: "user-456",
        access: "ADMIN",
        scopes: [],
      });

      const request = createMockRequest({
        authHeader: "Bearer tpi_test_token",
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(authenticateApiToken).toHaveBeenCalledWith(request);
    });

    it("allows access with valid admin API token when session has no user", async () => {
      (getServerAuthSession as any).mockResolvedValue({});
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: "user-456",
        access: "ADMIN",
        scopes: [],
      });

      const request = createMockRequest({
        authHeader: "Bearer tpi_test_token",
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it("returns 401 for invalid API token when no session", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "Invalid API token",
        errorCode: "INVALID_TOKEN",
      });

      const request = createMockRequest({
        authHeader: "Bearer tpi_invalid_token",
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid API token");
      expect(data.code).toBe("INVALID_TOKEN");
    });

    it("returns 401 for expired API token", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "API token has expired",
        errorCode: "EXPIRED_TOKEN",
      });

      const request = createMockRequest({
        authHeader: "Bearer tpi_expired_token",
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("API token has expired");
      expect(data.code).toBe("EXPIRED_TOKEN");
    });

    it("returns 401 for revoked API token", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "API token has been revoked",
        errorCode: "INACTIVE_TOKEN",
      });

      const request = createMockRequest({
        authHeader: "Bearer tpi_revoked_token",
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("API token has been revoked");
    });

    it("denies access for valid API token with non-admin user", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: "user-456",
        access: "USER",
        scopes: [],
      });

      const request = createMockRequest({
        authHeader: "Bearer tpi_user_token",
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Admin access required");
    });

    it("looks up user access when API token has no access field", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: "user-456",
        // No access field
        scopes: [],
      });

      (prisma.user.findUnique as any).mockResolvedValue({
        access: "ADMIN",
      });

      const request = createMockRequest({
        authHeader: "Bearer tpi_token_without_access",
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-456" },
        select: { access: true },
      });
    });
  });

  describe("Authentication Priority", () => {
    it("prefers session auth over API token when session exists", async () => {
      (getServerAuthSession as any).mockResolvedValue({
        user: { id: "session-user", access: "ADMIN" },
      });

      const request = createMockRequest({
        authHeader: "Bearer tpi_some_token",
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      // API token auth should NOT be called when session exists
      expect(authenticateApiToken).not.toHaveBeenCalled();
    });

    it("falls back to API token when session has no user", async () => {
      (getServerAuthSession as any).mockResolvedValue({
        // Session exists but no user
      });
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: "api-user",
        access: "ADMIN",
        scopes: [],
      });

      const request = createMockRequest({
        authHeader: "Bearer tpi_api_token",
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(authenticateApiToken).toHaveBeenCalled();
    });
  });

  describe("Unauthorized Access", () => {
    it("returns 401 when no session and no API token", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "No Bearer token provided",
        errorCode: "NO_TOKEN",
      });

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("No Bearer token provided");
    });
  });
});

describe("Admin Route Authentication Pattern", () => {
  // Test the checkAdminAuth helper pattern used across admin routes

  type AuthResult = {
    error?: NextResponse;
    userId?: string;
  };

  // Simulates the checkAdminAuth function pattern
  const checkAdminAuth = async (
    getSession: () => Promise<{ user?: { id: string; access?: string } } | null>,
    authenticateToken: (
      req: NextRequest
    ) => Promise<{
      authenticated: boolean;
      userId?: string;
      access?: string;
      error?: string;
      errorCode?: string;
    }>,
    getUserAccess: (userId: string) => Promise<string | undefined>,
    request: NextRequest
  ): Promise<AuthResult> => {
    const session = await getSession();
    let userId = session?.user?.id;
    let userAccess: string | undefined;

    if (!userId) {
      const apiAuth = await authenticateToken(request);
      if (!apiAuth.authenticated) {
        return {
          error: NextResponse.json(
            { error: apiAuth.error, code: apiAuth.errorCode },
            { status: 401 }
          ),
        };
      }
      userId = apiAuth.userId;
      userAccess = apiAuth.access;
    }

    if (!userId) {
      return {
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    if (!userAccess) {
      userAccess = await getUserAccess(userId);
    }

    if (userAccess !== "ADMIN") {
      return {
        error: NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        ),
      };
    }

    return { userId };
  };

  const createMockRequest = (authHeader?: string): NextRequest => {
    const headers = new Headers();
    if (authHeader) {
      headers.set("authorization", authHeader);
    }
    return { headers } as unknown as NextRequest;
  };

  it("returns userId for valid admin session", async () => {
    const result = await checkAdminAuth(
      async () => ({ user: { id: "admin-user" } }),
      async () => ({ authenticated: false }),
      async () => "ADMIN", // Session user's access level from DB lookup
      createMockRequest()
    );

    expect(result.error).toBeUndefined();
    expect(result.userId).toBe("admin-user");
  });

  it("returns userId for valid admin API token", async () => {
    const result = await checkAdminAuth(
      async () => null,
      async () => ({ authenticated: true, userId: "api-admin", access: "ADMIN" }),
      async () => undefined,
      createMockRequest("Bearer tpi_token")
    );

    expect(result.error).toBeUndefined();
    expect(result.userId).toBe("api-admin");
  });

  it("returns 401 error for failed API token auth", async () => {
    const result = await checkAdminAuth(
      async () => null,
      async () => ({
        authenticated: false,
        error: "Invalid token",
        errorCode: "INVALID_TOKEN",
      }),
      async () => undefined,
      createMockRequest("Bearer tpi_bad_token")
    );

    expect(result.error).toBeDefined();
    const json = await result.error!.json();
    expect(json.error).toBe("Invalid token");
    expect(json.code).toBe("INVALID_TOKEN");
  });

  it("returns 403 error for non-admin user", async () => {
    const result = await checkAdminAuth(
      async () => ({ user: { id: "regular-user" } }),
      async () => ({ authenticated: false }),
      async () => "USER",
      createMockRequest()
    );

    expect(result.error).toBeDefined();
    const json = await result.error!.json();
    expect(json.error).toBe("Admin access required");
  });

  it("looks up user access when not in session or token", async () => {
    const getUserAccess = vi.fn().mockResolvedValue("ADMIN");

    const result = await checkAdminAuth(
      async () => ({ user: { id: "user-no-access" } }),
      async () => ({ authenticated: false }),
      getUserAccess,
      createMockRequest()
    );

    expect(getUserAccess).toHaveBeenCalledWith("user-no-access");
    expect(result.error).toBeUndefined();
    expect(result.userId).toBe("user-no-access");
  });

  it("uses access from API token without DB lookup", async () => {
    const getUserAccess = vi.fn().mockResolvedValue("ADMIN");

    const result = await checkAdminAuth(
      async () => null,
      async () => ({ authenticated: true, userId: "api-user", access: "ADMIN" }),
      getUserAccess,
      createMockRequest("Bearer tpi_token")
    );

    // Should not call getUserAccess since access came from token
    expect(getUserAccess).not.toHaveBeenCalled();
    expect(result.userId).toBe("api-user");
  });
});
