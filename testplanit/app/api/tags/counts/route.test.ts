import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

// The route drives the counts from a single tag-side `tags.findMany` that
// hydrates each tag's linked caseTags / sessions / testRuns (filtered by the
// nested `where`); counts are array lengths derived in memory.
vi.mock("~/lib/db", () => ({
  baseDb: {
    tags: {
      findMany: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";

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

// Build a tag row shaped like the route's `select`, with the requested number
// of linked rows so the in-memory length counts come out as asserted.
const tagRow = (
  id: number,
  caseTags: number,
  sessions: number,
  testRuns: number
) => ({
  id,
  caseTags: Array.from({ length: caseTags }, (_, i) => ({ caseId: i })),
  sessions: Array.from({ length: sessions }, (_, i) => ({ id: i })),
  testRuns: Array.from({ length: testRuns }, (_, i) => ({ id: i })),
});

const findManyArg = () => (baseDb.tags.findMany as any).mock.calls[0][0];

describe("Tags Counts Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (baseDb.tags.findMany as any).mockResolvedValue([]);
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
      (baseDb.tags.findMany as any).mockResolvedValue([tagRow(1, 5, 3, 7)]);

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
      (baseDb.tags.findMany as any).mockResolvedValue([
        tagRow(1, 5, 2, 1),
        tagRow(2, 10, 4, 3),
      ]);

      const request = createMockRequest({ tagIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toEqual({
        repositoryCases: 5,
        sessions: 2,
        testRuns: 1,
      });
      expect(data.counts[2]).toEqual({
        repositoryCases: 10,
        sessions: 4,
        testRuns: 3,
      });
    });

    it("returns zero counts for requested tagIds with no links", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      // Tag 2 isn't returned by findMany (not found / no links).
      (baseDb.tags.findMany as any).mockResolvedValue([tagRow(1, 3, 0, 0)]);

      const request = createMockRequest({ tagIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(data.counts[2]).toEqual({
        repositoryCases: 0,
        sessions: 0,
        testRuns: 0,
      });
    });

    it("queries tags by the requested ids", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ tagIds: [42] });
      await POST(request);

      expect(findManyArg().where).toEqual({ id: { in: [42] } });
    });

    it("filters out deleted items in every linked relation", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ tagIds: [1] });
      await POST(request);

      const { select } = findManyArg();
      expect(select.caseTags.where.case.isDeleted).toBe(false);
      expect(select.sessions.where.isDeleted).toBe(false);
      expect(select.testRuns.where.isDeleted).toBe(false);
    });
  });

  describe("Project access filtering", () => {
    it("does not add project access filter for ADMIN users", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ tagIds: [1] });
      await POST(request);

      // Admin: projectAccessWhere is empty {}. No `project` key in the nested
      // relation filters.
      const { select } = findManyArg();
      expect(select.caseTags.where.case).not.toHaveProperty("project");
      expect(select.sessions.where).not.toHaveProperty("project");
      expect(select.testRuns.where).not.toHaveProperty("project");
    });

    it("adds project access filter for non-admin users", async () => {
      (getServerSession as any).mockResolvedValue(mockUserSession);

      const request = createMockRequest({ tagIds: [1] });
      await POST(request);

      const { select } = findManyArg();
      expect(select.caseTags.where.case).toHaveProperty("project");
      expect(select.sessions.where).toHaveProperty("project");
      expect(select.testRuns.where).toHaveProperty("project");
    });
  });

  describe("Error handling", () => {
    it("returns 500 when database query fails", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (baseDb.tags.findMany as any).mockRejectedValue(new Error("DB error"));

      const request = createMockRequest({ tagIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch counts");
    });
  });
});
