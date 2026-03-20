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
  },
}));

vi.mock("~/services/elasticsearchService", () => ({
  getElasticsearchClient: vi.fn(),
}));

vi.mock("@/lib/queues", () => ({
  getElasticsearchReindexQueue: vi.fn(),
}));

vi.mock("@/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn(),
}));

vi.mock("~/workers/elasticsearchReindexWorker", () => ({}));

import { prisma } from "@/lib/prisma";
import { getElasticsearchReindexQueue } from "@/lib/queues";
import { getCurrentTenantId } from "@/lib/multiTenantPrisma";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { getServerAuthSession } from "~/server/auth";
import { getElasticsearchClient } from "~/services/elasticsearchService";

import { GET, POST } from "./route";

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
    method: options.method || "POST",
    headers,
    json: async () => options.body ?? {},
    nextUrl: { searchParams: new URLSearchParams() },
    url: "http://localhost:3000/api/admin/elasticsearch/reindex",
  } as unknown as NextRequest;
};

const setupAdminSession = () => {
  (getServerAuthSession as any).mockResolvedValue({ user: { id: "admin-user-1" } });
  (prisma.user.findUnique as any).mockResolvedValue({ access: "ADMIN" });
};

describe("Admin Elasticsearch Reindex Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentTenantId as any).mockReturnValue(null);
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
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("No Bearer token provided");
    });

    it("returns 403 when authenticated as non-admin", async () => {
      (getServerAuthSession as any).mockResolvedValue({ user: { id: "user-1" } });
      (prisma.user.findUnique as any).mockResolvedValue({ access: "USER" });

      const request = createMockRequest();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Admin access required");
    });
  });

  describe("POST - trigger reindex", () => {
    it("returns 503 when Elasticsearch client is null", async () => {
      setupAdminSession();
      (getElasticsearchClient as any).mockReturnValue(null);

      const request = createMockRequest({ body: { entityType: "all" } });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toContain("Elasticsearch is not configured");
    });

    it("returns 503 when reindex queue is not available", async () => {
      setupAdminSession();
      (getElasticsearchClient as any).mockReturnValue({});
      (getElasticsearchReindexQueue as any).mockReturnValue(null);

      const request = createMockRequest({ body: { entityType: "all" } });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toContain("Background job queue is not available");
    });

    it("queues reindex job and returns jobId on success", async () => {
      setupAdminSession();
      (getElasticsearchClient as any).mockReturnValue({});
      const mockJob = { id: "job-abc-123" };
      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };
      (getElasticsearchReindexQueue as any).mockReturnValue(mockQueue);

      const request = createMockRequest({ body: { entityType: "all" } });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.jobId).toBe("job-abc-123");
      expect(data.message).toContain("queued");
    });

    it("passes entityType and projectId to the queue job", async () => {
      setupAdminSession();
      (getElasticsearchClient as any).mockReturnValue({});
      const mockQueue = {
        add: vi.fn().mockResolvedValue({ id: "job-1" }),
      };
      (getElasticsearchReindexQueue as any).mockReturnValue(mockQueue);

      const request = createMockRequest({
        body: { entityType: "repositoryCases", projectId: 42 },
      });
      await POST(request);

      expect(mockQueue.add).toHaveBeenCalledWith(
        "reindex",
        expect.objectContaining({
          entityType: "repositoryCases",
          projectId: 42,
          userId: "admin-user-1",
        })
      );
    });

    it("defaults entityType to 'all' when not provided", async () => {
      setupAdminSession();
      (getElasticsearchClient as any).mockReturnValue({});
      const mockQueue = {
        add: vi.fn().mockResolvedValue({ id: "job-2" }),
      };
      (getElasticsearchReindexQueue as any).mockReturnValue(mockQueue);

      const request = createMockRequest({ body: {} });
      await POST(request);

      expect(mockQueue.add).toHaveBeenCalledWith(
        "reindex",
        expect.objectContaining({ entityType: "all" })
      );
    });
  });

  describe("GET - check Elasticsearch status", () => {
    it("returns 401 when unauthenticated", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "No Bearer token provided",
        errorCode: "NO_TOKEN",
      });

      const request = createMockRequest({ method: "GET" });
      const response = await GET(request);
      const _data = await response.json();

      expect(response.status).toBe(401);
    });

    it("returns available: false when ES client is null", async () => {
      setupAdminSession();
      (getElasticsearchClient as any).mockReturnValue(null);

      const request = createMockRequest({ method: "GET" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.available).toBe(false);
    });

    it("returns available with health and indices when ES is up", async () => {
      setupAdminSession();
      const mockEsClient = {
        cluster: {
          health: vi.fn().mockResolvedValue({
            status: "green",
            number_of_nodes: 1,
          }),
        },
        cat: {
          indices: vi.fn().mockResolvedValue([
            {
              index: "testplanit-repository-cases",
              "docs.count": "100",
              "store.size": "1mb",
              health: "green",
            },
          ]),
        },
      };
      (getElasticsearchClient as any).mockReturnValue(mockEsClient);

      const request = createMockRequest({ method: "GET" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.available).toBe(true);
      expect(data.health).toBe("green");
      expect(Array.isArray(data.indices)).toBe(true);
    });

    it("returns available: false when ES is not responding", async () => {
      setupAdminSession();
      const mockEsClient = {
        cluster: {
          health: vi.fn().mockRejectedValue(new Error("Connection refused")),
        },
      };
      (getElasticsearchClient as any).mockReturnValue(mockEsClient);

      const request = createMockRequest({ method: "GET" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.available).toBe(false);
    });
  });
});
