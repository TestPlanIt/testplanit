import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    appConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("~/services/elasticsearchService", () => ({
  getElasticsearchClient: vi.fn(),
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditSystemConfigChange: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { auditSystemConfigChange } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { getElasticsearchClient } from "~/services/elasticsearchService";

import { GET, POST, PUT } from "./route";

const createMockRequest = (options: {
  method?: string;
  authHeader?: string;
  body?: any;
} = {}): NextRequest => {
  const headers = new Headers();
  if (options.authHeader) {
    headers.set("authorization", options.authHeader);
  }
  return {
    method: options.method || "GET",
    headers,
    json: async () => options.body ?? {},
    nextUrl: { searchParams: new URLSearchParams() },
    url: "http://localhost:3000/api/admin/elasticsearch/settings",
  } as unknown as NextRequest;
};

const setupAdminSession = () => {
  (getServerAuthSession as any).mockResolvedValue({ user: { id: "admin-user-1" } });
  (prisma.user.findUnique as any).mockResolvedValue({ access: "ADMIN" });
};

describe("Admin Elasticsearch Settings Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auditSystemConfigChange as any).mockResolvedValue(undefined);
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated (no session, invalid token)", async () => {
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

    it("returns 403 when authenticated as non-admin", async () => {
      (getServerAuthSession as any).mockResolvedValue({ user: { id: "user-1" } });
      (prisma.user.findUnique as any).mockResolvedValue({ access: "USER" });

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Admin access required");
    });

    it("allows access with valid admin API token when no session", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: "api-admin",
        access: "ADMIN",
        scopes: [],
      });
      (prisma.appConfig.findUnique as any).mockResolvedValue(null);

      const request = createMockRequest({ authHeader: "Bearer tpi_test_token" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(authenticateApiToken).toHaveBeenCalledWith(request);
    });
  });

  describe("GET - retrieve replica settings", () => {
    it("returns numberOfReplicas from config when found", async () => {
      setupAdminSession();
      (prisma.appConfig.findUnique as any).mockResolvedValue({
        key: "elasticsearch_replicas",
        value: 2,
      });

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.numberOfReplicas).toBe(2);
    });

    it("returns 0 when config not found", async () => {
      setupAdminSession();
      (prisma.appConfig.findUnique as any).mockResolvedValue(null);

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.numberOfReplicas).toBe(0);
    });
  });

  describe("POST - save replica settings", () => {
    it("saves valid numberOfReplicas and returns success", async () => {
      setupAdminSession();
      (prisma.appConfig.findUnique as any).mockResolvedValue(null);
      (prisma.appConfig.upsert as any).mockResolvedValue({});

      const request = createMockRequest({ body: { numberOfReplicas: 3 } });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.numberOfReplicas).toBe(3);
    });

    it("returns 400 for invalid numberOfReplicas (negative)", async () => {
      setupAdminSession();

      const request = createMockRequest({ body: { numberOfReplicas: -1 } });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid number of replicas");
    });

    it("returns 400 for numberOfReplicas greater than 10", async () => {
      setupAdminSession();

      const request = createMockRequest({ body: { numberOfReplicas: 11 } });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid number of replicas");
    });

    it("returns 400 when numberOfReplicas is not a number", async () => {
      setupAdminSession();

      const request = createMockRequest({ body: { numberOfReplicas: "two" } });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid number of replicas");
    });

    it("triggers audit log on successful save", async () => {
      setupAdminSession();
      (prisma.appConfig.findUnique as any).mockResolvedValue({ value: 1 });
      (prisma.appConfig.upsert as any).mockResolvedValue({});

      const request = createMockRequest({ body: { numberOfReplicas: 2 } });
      await POST(request);

      expect(auditSystemConfigChange).toHaveBeenCalledWith(
        "elasticsearch_replicas",
        1,
        2
      );
    });

    it("upserts config with new value", async () => {
      setupAdminSession();
      (prisma.appConfig.findUnique as any).mockResolvedValue(null);
      (prisma.appConfig.upsert as any).mockResolvedValue({});

      const request = createMockRequest({ body: { numberOfReplicas: 5 } });
      await POST(request);

      expect(prisma.appConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "elasticsearch_replicas" },
          update: { value: 5 },
          create: { key: "elasticsearch_replicas", value: 5 },
        })
      );
    });
  });

  describe("PUT - update existing indices", () => {
    it("returns 503 when Elasticsearch client is null", async () => {
      setupAdminSession();
      (getElasticsearchClient as any).mockReturnValue(null);

      const request = createMockRequest({ body: { numberOfReplicas: 1 } });
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toContain("Elasticsearch is not configured");
    });

    it("returns 400 for invalid numberOfReplicas", async () => {
      setupAdminSession();

      const request = createMockRequest({ body: { numberOfReplicas: 15 } });
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid number of replicas");
    });

    it("updates indices and returns cluster health when ES client available", async () => {
      setupAdminSession();
      const mockEsClient = {
        indices: {
          putSettings: vi.fn().mockResolvedValue({}),
        },
        cluster: {
          health: vi.fn().mockResolvedValue({ status: "green" }),
        },
      };
      (getElasticsearchClient as any).mockReturnValue(mockEsClient);

      const request = createMockRequest({ body: { numberOfReplicas: 1 } });
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.numberOfReplicas).toBe(1);
      expect(data.clusterHealth).toBe("green");
    });

    it("returns 500 when ES indices update fails", async () => {
      setupAdminSession();
      const mockEsClient = {
        indices: {
          putSettings: vi.fn().mockRejectedValue(new Error("ES error")),
        },
        cluster: {
          health: vi.fn(),
        },
      };
      (getElasticsearchClient as any).mockReturnValue(mockEsClient);

      const request = createMockRequest({ body: { numberOfReplicas: 1 } });
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to update Elasticsearch indices");
    });
  });
});
