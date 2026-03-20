import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    repositoryCases: {
      count: vi.fn(),
    },
    sessions: {
      count: vi.fn(),
    },
    testRuns: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@prisma/client", () => ({
  ProjectAccessType: {
    NO_ACCESS: "NO_ACCESS",
    VIEW: "VIEW",
    EDIT: "EDIT",
    GLOBAL_ROLE: "GLOBAL_ROLE",
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

import { POST } from "./route";

const createMockRequest = (body: any): Request => {
  return {
    json: async () => body,
  } as unknown as Request;
};

const mockAdminSession = {
  user: {
    id: "admin-1",
    name: "Admin User",
    access: "ADMIN",
  },
};

const mockUserSession = {
  user: {
    id: "user-1",
    name: "Regular User",
    access: "USER",
  },
};

describe("Tags Counts Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.repositoryCases.count as any).mockResolvedValue(0);
    (prisma.sessions.count as any).mockResolvedValue(0);
    (prisma.testRuns.count as any).mockResolvedValue(0);
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = createMockRequest({ tagIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user id", async () => {
      (getServerSession as any).mockResolvedValue({ user: {} });

      const request = createMockRequest({ tagIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns empty counts when tagIds is empty array", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ tagIds: [] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
    });

    it("returns empty counts when tagIds is not an array", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ tagIds: "not-an-array" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
    });

    it("returns empty counts when tagIds is null", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ tagIds: null });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
    });
  });

  describe("POST - tag count aggregation", () => {
    it("returns counts for each tagId with repositoryCases, sessions, testRuns", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (prisma.repositoryCases.count as any).mockResolvedValue(5);
      (prisma.sessions.count as any).mockResolvedValue(3);
      (prisma.testRuns.count as any).mockResolvedValue(7);

      const request = createMockRequest({ tagIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toEqual({
        repositoryCases: 5,
        sessions: 3,
        testRuns: 7,
      });
    });

    it("returns counts for multiple tagIds", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (prisma.repositoryCases.count as any)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(10);
      (prisma.sessions.count as any)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(4);
      (prisma.testRuns.count as any)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3);

      const request = createMockRequest({ tagIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toEqual({ repositoryCases: 5, sessions: 2, testRuns: 1 });
      expect(data.counts[2]).toEqual({ repositoryCases: 10, sessions: 4, testRuns: 3 });
    });

    it("filters by tagId when counting entities", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (prisma.repositoryCases.count as any).mockResolvedValue(3);
      (prisma.sessions.count as any).mockResolvedValue(0);
      (prisma.testRuns.count as any).mockResolvedValue(0);

      const request = createMockRequest({ tagIds: [42] });
      await POST(request);

      expect(prisma.repositoryCases.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tags: { some: { id: 42 } },
          }),
        })
      );
    });

    it("filters out deleted items", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ tagIds: [1] });
      await POST(request);

      expect(prisma.repositoryCases.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isDeleted: false }),
        })
      );
      expect(prisma.sessions.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isDeleted: false }),
        })
      );
      expect(prisma.testRuns.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isDeleted: false }),
        })
      );
    });
  });

  describe("Project access filtering", () => {
    it("does not add project access filter for ADMIN users", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ tagIds: [1] });
      await POST(request);

      // Admin: projectAccessWhere is empty {}. No project filter in call.
      const callArg = (prisma.repositoryCases.count as any).mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty("project");
    });

    it("adds project access filter for non-admin users", async () => {
      (getServerSession as any).mockResolvedValue(mockUserSession);

      const request = createMockRequest({ tagIds: [1] });
      await POST(request);

      const callArg = (prisma.repositoryCases.count as any).mock.calls[0][0];
      expect(callArg.where).toHaveProperty("project");
    });
  });

  describe("Error handling", () => {
    it("returns 500 when database query fails", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (prisma.repositoryCases.count as any).mockRejectedValue(new Error("DB error"));

      const request = createMockRequest({ tagIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch counts");
    });
  });
});
