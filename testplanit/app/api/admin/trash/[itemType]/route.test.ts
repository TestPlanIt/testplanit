import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockModel } = vi.hoisted(() => ({
  mockModel: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
}));

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

vi.mock("~/server/db", () => ({
  db: {
    user: mockModel,
    groups: mockModel,
    roles: mockModel,
    projects: mockModel,
    milestones: mockModel,
    milestoneTypes: mockModel,
    caseFields: mockModel,
    resultFields: mockModel,
    fieldOptions: mockModel,
    templates: mockModel,
    status: mockModel,
    workflows: mockModel,
    configCategories: mockModel,
    configVariants: mockModel,
    configurations: mockModel,
    tags: mockModel,
    repositories: mockModel,
    repositoryFolders: mockModel,
    repositoryCaseLink: mockModel,
    repositoryCases: mockModel,
    repositoryCaseVersions: mockModel,
    attachments: mockModel,
    steps: mockModel,
    sessions: mockModel,
    sessionResults: mockModel,
    testRuns: mockModel,
    testRunResults: mockModel,
    testRunStepResults: mockModel,
    issue: mockModel,
    appConfig: mockModel,
    codeRepository: mockModel,
    llmIntegration: mockModel,
    integration: mockModel,
    promptConfig: mockModel,
    caseExportTemplate: mockModel,
    sharedStepGroup: mockModel,
  },
}));

import { prisma } from "@/lib/prisma";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { getServerAuthSession } from "~/server/auth";

import { GET } from "./route";

const createMockRequest = (options: {
  authHeader?: string;
  searchParams?: Record<string, string>;
} = {}): NextRequest => {
  const headers = new Headers();
  if (options.authHeader) {
    headers.set("authorization", options.authHeader);
  }
  const params = new URLSearchParams(options.searchParams ?? {});
  return {
    method: "GET",
    headers,
    nextUrl: { searchParams: params },
    url: "http://localhost:3000/api/admin/trash/Projects",
  } as unknown as NextRequest;
};

const createMockContext = (itemType: string) => ({
  params: Promise.resolve({ itemType }),
});

const setupAdminSession = () => {
  (getServerAuthSession as any).mockResolvedValue({ user: { id: "admin-user-1" } });
  (prisma.user.findUnique as any).mockResolvedValue({ access: "ADMIN" });
};

describe("Admin Trash Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModel.count.mockResolvedValue(0);
    mockModel.findMany.mockResolvedValue([]);
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
      const response = await GET(request, createMockContext("Projects"));
      const _data = await response.json();

      expect(response.status).toBe(401);
    });

    it("returns 403 when authenticated as non-admin", async () => {
      (getServerAuthSession as any).mockResolvedValue({ user: { id: "user-1" } });
      (prisma.user.findUnique as any).mockResolvedValue({ access: "USER" });

      const request = createMockRequest();
      const response = await GET(request, createMockContext("Projects"));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Admin access required");
    });
  });

  describe("GET - retrieve soft-deleted items", () => {
    it("returns 404 for invalid itemType", async () => {
      setupAdminSession();

      const request = createMockRequest();
      const response = await GET(request, createMockContext("NonExistentModel"));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Invalid item type");
    });

    it("returns items and totalCount for valid itemType", async () => {
      setupAdminSession();
      mockModel.count.mockResolvedValue(2);
      mockModel.findMany.mockResolvedValue([
        { id: 1, name: "Deleted Project 1", isDeleted: true },
        { id: 2, name: "Deleted Project 2", isDeleted: true },
      ]);

      const request = createMockRequest();
      const response = await GET(request, createMockContext("Projects"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.totalCount).toBe(2);
      expect(data.items).toHaveLength(2);
    });

    it("queries with isDeleted: true filter", async () => {
      setupAdminSession();
      mockModel.count.mockResolvedValue(0);
      mockModel.findMany.mockResolvedValue([]);

      const request = createMockRequest();
      await GET(request, createMockContext("Projects"));

      expect(mockModel.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isDeleted: true }) })
      );
      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isDeleted: true }) })
      );
    });

    it("applies pagination with skip and take from searchParams", async () => {
      setupAdminSession();
      mockModel.count.mockResolvedValue(10);
      mockModel.findMany.mockResolvedValue([]);

      const request = createMockRequest({
        searchParams: { skip: "5", take: "3" },
      });
      await GET(request, createMockContext("Projects"));

      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 3 })
      );
    });

    it("applies default pagination when not specified", async () => {
      setupAdminSession();
      mockModel.count.mockResolvedValue(0);
      mockModel.findMany.mockResolvedValue([]);

      const request = createMockRequest();
      await GET(request, createMockContext("Projects"));

      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 })
      );
    });

    it("applies sort direction from searchParams", async () => {
      setupAdminSession();
      mockModel.count.mockResolvedValue(0);
      mockModel.findMany.mockResolvedValue([]);

      const request = createMockRequest({
        searchParams: { sortBy: "name", sortDir: "desc" },
      });
      await GET(request, createMockContext("Projects"));

      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: "desc" },
        })
      );
    });

    it("serializes bigint values to strings in response", async () => {
      setupAdminSession();
      mockModel.count.mockResolvedValue(1);
      mockModel.findMany.mockResolvedValue([
        { id: 1, bigintField: BigInt(9999999999999) },
      ]);

      const request = createMockRequest();
      const response = await GET(request, createMockContext("Projects"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(typeof data.items[0].bigintField).toBe("string");
    });

    it("returns 500 when database query fails", async () => {
      setupAdminSession();
      mockModel.count.mockRejectedValue(new Error("DB error"));

      const request = createMockRequest();
      const response = await GET(request, createMockContext("Projects"));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to fetch deleted Projects");
    });

    it("works with Tags itemType", async () => {
      setupAdminSession();
      mockModel.count.mockResolvedValue(1);
      mockModel.findMany.mockResolvedValue([{ id: 5, name: "Deleted Tag", isDeleted: true }]);

      const request = createMockRequest();
      const response = await GET(request, createMockContext("Tags"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.totalCount).toBe(1);
    });
  });
});
