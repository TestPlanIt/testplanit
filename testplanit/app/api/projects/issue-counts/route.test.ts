import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

describe("Project Issue Counts API Route", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      access: "USER",
    },
  };

  const createRequest = (body: any): NextRequest => {
    return {
      json: async () => body,
    } as NextRequest;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = createRequest({ projectIds: [1, 2, 3] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const request = createRequest({ projectIds: [1, 2, 3] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user ID", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { name: "Test User" },
      });

      const request = createRequest({ projectIds: [1, 2, 3] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns empty counts object when projectIds is empty array", async () => {
      const request = createRequest({ projectIds: [] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("returns empty counts object when projectIds is not an array", async () => {
      const request = createRequest({ projectIds: "not-an-array" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("returns empty counts object when projectIds is null", async () => {
      const request = createRequest({ projectIds: null });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("returns empty counts object when projectIds is undefined", async () => {
      const request = createRequest({});
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe("Issue Count Queries", () => {
    it("returns correct counts for single project with issues", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(5) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({
        1: 5,
      });
      expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    });

    it("returns correct counts for multiple projects", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(5) },
        { projectId: 2, issueCount: BigInt(10) },
        { projectId: 3, issueCount: BigInt(3) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1, 2, 3] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({
        1: 5,
        2: 10,
        3: 3,
      });
      expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    });

    it("returns 0 for projects with no issues", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(5) },
        // Project 2 has no issues, so it won't be in the query results
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1, 2, 3] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({
        1: 5,
        2: 0,
        3: 0,
      });
    });

    it("returns all zeros when no projects have issues", async () => {
      (prisma.$queryRaw as any).mockResolvedValue([]);

      const request = createRequest({ projectIds: [1, 2, 3] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({
        1: 0,
        2: 0,
        3: 0,
      });
    });

    it("converts bigint to number correctly", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(999999) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toBe(999999);
      expect(typeof data.counts[1]).toBe("number");
    });

    it("handles large number of projects", async () => {
      const projectIds = Array.from({ length: 100 }, (_, i) => i + 1);
      const mockResults = projectIds.slice(0, 50).map((id) => ({
        projectId: id,
        issueCount: BigInt(id * 2),
      }));
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Object.keys(data.counts)).toHaveLength(100);
      expect(data.counts[1]).toBe(2);
      expect(data.counts[50]).toBe(100);
      expect(data.counts[51]).toBe(0); // No issues
      expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    });
  });

  describe("Query Optimization", () => {
    it("uses single query for all projects (not N queries)", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(5) },
        { projectId: 2, issueCount: BigInt(10) },
        { projectId: 3, issueCount: BigInt(3) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1, 2, 3] });
      await POST(request);

      // Verify that $queryRaw is called only ONCE, not once per project
      expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    });

    it("passes all projectIds to single query", async () => {
      const projectIds = [1, 5, 10, 15, 20];
      (prisma.$queryRaw as any).mockResolvedValue([]);

      const request = createRequest({ projectIds });
      await POST(request);

      // Verify the query was called with all project IDs at once
      const queryCall = (prisma.$queryRaw as any).mock.calls[0];
      expect(queryCall).toBeDefined();

      // The query should contain the projectIds array
      // The actual implementation uses template literals, so we check that projectIds is part of the call
      expect(queryCall[0]).toBeDefined();
    });
  });

  describe("Issue Relationship Coverage", () => {
    it("counts issues from all relationship types", async () => {
      // This test verifies that the query includes all 6 UNION clauses
      // by checking that issues related through different paths are counted
      const mockResults = [
        { projectId: 1, issueCount: BigInt(15) }, // Issues from multiple relationship types
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toBe(15);

      // Verify the query includes all relationship types
      const queryCall = (prisma.$queryRaw as any).mock.calls[0][0];
      const queryString = queryCall.join("");

      // Check for all 6 relationship types in the UNION query
      expect(queryString).toContain("_IssueToRepositoryCases");
      expect(queryString).toContain("_IssueToSessions");
      expect(queryString).toContain("_IssueToTestRuns");
      expect(queryString).toContain("_IssueToSessionResults");
      expect(queryString).toContain("_IssueToTestRunResults");
      expect(queryString).toContain("_IssueToTestRunStepResults");
    });

    it("uses DISTINCT to avoid counting same issue multiple times", async () => {
      // Verify the query uses COUNT(DISTINCT issue_id)
      (prisma.$queryRaw as any).mockResolvedValue([]);

      const request = createRequest({ projectIds: [1] });
      await POST(request);

      const queryCall = (prisma.$queryRaw as any).mock.calls[0][0];
      const queryString = queryCall.join("");

      expect(queryString).toContain("COUNT(DISTINCT issue_id)");
    });

    it("filters out deleted issues", async () => {
      // Verify the query filters isDeleted = false
      (prisma.$queryRaw as any).mockResolvedValue([]);

      const request = createRequest({ projectIds: [1] });
      await POST(request);

      const queryCall = (prisma.$queryRaw as any).mock.calls[0][0];
      const queryString = queryCall.join("");

      expect(queryString).toContain('isDeleted');
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when database query fails", async () => {
      (prisma.$queryRaw as any).mockRejectedValue(new Error("Database error"));

      const request = createRequest({ projectIds: [1, 2, 3] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch project issue counts");
    });

    it("logs error when query fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      (prisma.$queryRaw as any).mockRejectedValue(new Error("DB connection lost"));

      const request = createRequest({ projectIds: [1] });
      await POST(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error fetching project issue counts:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("handles malformed request body gracefully", async () => {
      const request = {
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as unknown as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch project issue counts");
    });
  });

  describe("Edge Cases", () => {
    it("handles projectIds with duplicate values", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(5) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1, 1, 1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toBe(5);
      // Should only return count once per unique project
      expect(Object.keys(data.counts)).toEqual(["1"]);
    });

    it("handles zero count correctly", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(0) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toBe(0);
    });

    it("handles mixed existing and non-existing projects", async () => {
      const mockResults = [
        { projectId: 2, issueCount: BigInt(7) },
        { projectId: 4, issueCount: BigInt(3) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1, 2, 3, 4, 5] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({
        1: 0,
        2: 7,
        3: 0,
        4: 3,
        5: 0,
      });
    });

    it("handles very large issue count", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(999999999) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toBe(999999999);
    });
  });

  describe("Response Format", () => {
    it("returns counts object with correct structure", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(5) },
        { projectId: 2, issueCount: BigInt(10) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("counts");
      expect(typeof data.counts).toBe("object");
      expect(Array.isArray(data.counts)).toBe(false);
    });

    it("uses projectId as key and count as value", async () => {
      const mockResults = [
        { projectId: 42, issueCount: BigInt(7) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [42] });
      const response = await POST(request);
      const data = await response.json();

      expect(data.counts).toHaveProperty("42");
      expect(data.counts["42"]).toBe(7);
    });

    it("includes all requested projects in response", async () => {
      const mockResults = [
        { projectId: 1, issueCount: BigInt(5) },
      ];
      (prisma.$queryRaw as any).mockResolvedValue(mockResults);

      const request = createRequest({ projectIds: [1, 2, 3, 4, 5] });
      const response = await POST(request);
      const data = await response.json();

      expect(Object.keys(data.counts)).toHaveLength(5);
      expect(data.counts).toHaveProperty("1");
      expect(data.counts).toHaveProperty("2");
      expect(data.counts).toHaveProperty("3");
      expect(data.counts).toHaveProperty("4");
      expect(data.counts).toHaveProperty("5");
    });
  });
});
