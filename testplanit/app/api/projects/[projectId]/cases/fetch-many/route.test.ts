import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    projects: {
      findFirst: vi.fn(),
    },
    repositoryCases: {
      findMany: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

describe("Fetch Many Cases API Route", () => {
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

  const mockCases = [
    {
      id: 1,
      name: "Test Case 1",
      projectId: 1,
      isDeleted: false,
      isArchived: false,
      attachments: [],
      template: null,
      state: null,
      folder: null,
      creator: null,
      project: null,
      caseFieldValues: [],
      tags: [],
      issues: [],
      steps: [],
    },
    {
      id: 2,
      name: "Test Case 2",
      projectId: 1,
      isDeleted: false,
      isArchived: false,
      attachments: [],
      template: null,
      state: null,
      folder: null,
      creator: null,
      project: null,
      caseFieldValues: [],
      tags: [],
      issues: [],
      steps: [],
    },
  ];

  const createRequest = (
    body: any,
    projectId: string = "1"
  ): [NextRequest, { params: Promise<{ projectId: string }> }] => {
    const request = {
      json: async () => body,
    } as NextRequest;
    return [request, { params: Promise.resolve({ projectId }) }];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
    (prisma.projects.findFirst as any).mockResolvedValue(mockProject);
    (prisma.repositoryCases.findMany as any).mockResolvedValue(mockCases);
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const [request, context] = createRequest({ caseIds: [1, 2] });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user ID", async () => {
      (getServerSession as any).mockResolvedValue({ user: { name: "No ID" } });

      const [request, context] = createRequest({ caseIds: [1, 2] });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 for invalid (non-numeric) project ID", async () => {
      const [request, context] = createRequest({ caseIds: [1, 2] }, "abc");
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid project ID");
    });

    it("returns 400 when caseIds is missing", async () => {
      const [request, context] = createRequest({});
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });

    it("returns 400 when caseIds is not an array", async () => {
      const [request, context] = createRequest({ caseIds: "not-an-array" });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });

    it("returns 400 when caseIds contains non-numbers", async () => {
      const [request, context] = createRequest({ caseIds: ["a", "b"] });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });
  });

  describe("Project Access", () => {
    it("returns 404 when project not found or no access", async () => {
      (prisma.projects.findFirst as any).mockResolvedValue(null);

      const [request, context] = createRequest({ caseIds: [1, 2] });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Project not found or access denied");
    });

    it("uses simplified query for admin users", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { ...mockSession.user, access: "ADMIN" },
      });

      const [request, context] = createRequest({ caseIds: [1] });
      await POST(request, context);

      expect(prisma.projects.findFirst).toHaveBeenCalledWith({
        where: { id: 1, isDeleted: false },
      });
    });

    it("uses access-restricted query for non-admin users", async () => {
      const [request, context] = createRequest({ caseIds: [1] });
      await POST(request, context);

      const callArgs = (prisma.projects.findFirst as any).mock.calls[0][0];
      expect(callArgs.where).toHaveProperty("OR");
    });
  });

  describe("Successful Fetch", () => {
    it("returns cases and totalCount on success", async () => {
      const [request, context] = createRequest({ caseIds: [1, 2] });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("cases");
      expect(data).toHaveProperty("totalCount");
      expect(data.totalCount).toBe(2);
      expect(data.cases).toHaveLength(2);
    });

    it("maintains original order of caseIds in results", async () => {
      (prisma.repositoryCases.findMany as any).mockResolvedValue([
        { ...mockCases[1] }, // id: 2
        { ...mockCases[0] }, // id: 1
      ]);

      const [request, context] = createRequest({ caseIds: [1, 2] });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should be ordered by caseIds [1, 2], so id:1 first
      expect(data.cases[0].id).toBe(1);
      expect(data.cases[1].id).toBe(2);
    });

    it("serializes BigInt attachment sizes to strings", async () => {
      const casesWithAttachments = [
        {
          ...mockCases[0],
          attachments: [
            {
              id: 1,
              name: "file.txt",
              size: BigInt(1024),
              url: "/api/storage/file.txt",
            },
          ],
        },
      ];
      (prisma.repositoryCases.findMany as any).mockResolvedValue(
        casesWithAttachments
      );

      const [request, context] = createRequest({ caseIds: [1] });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.cases[0].attachments[0].size).toBe("1024");
    });

    it("applies pagination when skip and take are provided", async () => {
      const [request, context] = createRequest({
        caseIds: [1, 2],
        skip: 0,
        take: 1,
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      // totalCount is the full caseIds length
      expect(data.totalCount).toBe(2);
      // findMany was called with only the first caseId (after slice)
      const findManyCalls = (prisma.repositoryCases.findMany as any).mock.calls;
      expect(findManyCalls[0][0].where.id.in).toEqual([1]);
    });

    it("fetches all cases when no pagination is provided", async () => {
      const [request, context] = createRequest({ caseIds: [1, 2] });
      const response = await POST(request, context);

      expect(response.status).toBe(200);
      const findManyCalls = (prisma.repositoryCases.findMany as any).mock.calls;
      expect(findManyCalls[0][0].where.id.in).toEqual([1, 2]);
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when database query fails", async () => {
      (prisma.repositoryCases.findMany as any).mockRejectedValue(
        new Error("DB Error")
      );

      const [request, context] = createRequest({ caseIds: [1, 2] });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch cases");
    });
  });
});
