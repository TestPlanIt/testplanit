import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    projects: {
      findUnique: vi.fn(),
    },
    repositoryFolders: {
      findMany: vi.fn(),
    },
    repositoryCases: {
      findMany: vi.fn(),
    },
    testRunCases: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/app/actions/getUserAccessibleProjects", () => ({
  getUserAccessibleProjects: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { getUserAccessibleProjects } from "~/app/actions/getUserAccessibleProjects";
import { prisma } from "~/lib/prisma";

describe("Folder Stats API Route", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      access: "USER",
    },
  };

  const mockProject = {
    id: 1,
    name: "Test Project",
    isDeleted: false,
  };

  const mockFolders = [
    { id: 10, parentId: null },
    { id: 20, parentId: 10 },
    { id: 30, parentId: 10 },
  ];

  const mockCases = [
    { folderId: 10 },
    { folderId: 10 },
    { folderId: 20 },
  ];

  const createRequest = (
    projectId: string = "1",
    searchParams: Record<string, string> = {}
  ): [NextRequest, { params: Promise<{ projectId: string }> }] => {
    const url = new URL(
      `http://localhost/api/projects/${projectId}/folders/stats`
    );
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
    const request = {
      nextUrl: url,
    } as unknown as NextRequest;
    return [request, { params: Promise.resolve({ projectId }) }];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
    (prisma.projects.findUnique as any).mockResolvedValue(mockProject);
    (getUserAccessibleProjects as any).mockResolvedValue([{ projectId: 1 }]);
    (prisma.repositoryFolders.findMany as any).mockResolvedValue(mockFolders);
    (prisma.repositoryCases.findMany as any).mockResolvedValue(mockCases);
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user ID", async () => {
      (getServerSession as any).mockResolvedValue({ user: {} });

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 for invalid (non-numeric) project ID", async () => {
      const [request, context] = createRequest("not-a-number");
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid project ID");
    });
  });

  describe("Not Found", () => {
    it("returns 404 when project does not exist", async () => {
      (prisma.projects.findUnique as any).mockResolvedValue(null);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Project not found");
    });
  });

  describe("Access Control", () => {
    it("returns 403 when user does not have project access", async () => {
      (getUserAccessibleProjects as any).mockResolvedValue([]);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });
  });

  describe("Successful GET", () => {
    it("returns folder stats array with directCaseCount and totalCaseCount", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("stats");
      expect(Array.isArray(data.stats)).toBe(true);

      const folder10 = data.stats.find((s: any) => s.folderId === 10);
      expect(folder10).toBeDefined();
      expect(folder10).toHaveProperty("directCaseCount");
      expect(folder10).toHaveProperty("totalCaseCount");
    });

    it("calculates direct and total case counts correctly", async () => {
      // folder 10 has 2 direct cases, folders 20 and 30 are children of 10
      // folder 20 has 1 direct case
      // folder 30 has 0 direct cases
      // totalCaseCount for folder 10 = 2 (direct) + 1 (from 20) + 0 (from 30) = 3
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);

      const folder10 = data.stats.find((s: any) => s.folderId === 10);
      const folder20 = data.stats.find((s: any) => s.folderId === 20);
      const folder30 = data.stats.find((s: any) => s.folderId === 30);

      expect(folder10.directCaseCount).toBe(2);
      expect(folder10.totalCaseCount).toBe(3);
      expect(folder20.directCaseCount).toBe(1);
      expect(folder20.totalCaseCount).toBe(1);
      expect(folder30.directCaseCount).toBe(0);
      expect(folder30.totalCaseCount).toBe(0);
    });

    it("returns all folders in the stats array", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.stats).toHaveLength(3);
    });
  });

  describe("Optional runId parameter", () => {
    it("uses testRunCases query when runId is provided", async () => {
      (prisma.testRunCases.findMany as any).mockResolvedValue([
        { repositoryCase: { folderId: 20 } },
      ]);

      const [request, context] = createRequest("1", { runId: "5" });
      const response = await GET(request, context);
      const _data = await response.json();

      expect(response.status).toBe(200);
      expect(prisma.testRunCases.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ testRunId: 5 }),
        })
      );
      expect(prisma.repositoryCases.findMany).not.toHaveBeenCalled();
    });

    it("uses repositoryCases query when no runId is provided", async () => {
      const [request, context] = createRequest("1");
      const response = await GET(request, context);

      expect(response.status).toBe(200);
      expect(prisma.repositoryCases.findMany).toHaveBeenCalled();
      expect(prisma.testRunCases.findMany).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when database query fails", async () => {
      (prisma.repositoryFolders.findMany as any).mockRejectedValue(
        new Error("DB Error")
      );

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Internal server error");
    });
  });
});
