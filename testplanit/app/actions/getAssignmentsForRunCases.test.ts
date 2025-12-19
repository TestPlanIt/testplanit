import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
const mockFindMany = vi.fn();

vi.mock("~/lib/prisma", () => ({
  prisma: {
    testRunCases: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}));

const mockGetServerAuthSession = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mockGetServerAuthSession(),
}));

import { getAssignmentsForRunCases } from "./getAssignmentsForRunCases";

describe("getAssignmentsForRunCases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-123" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("authentication", () => {
    it("should return error when not authenticated", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await getAssignmentsForRunCases({
        originalRunId: 1,
        repositoryCaseIds: [1, 2, 3],
      });

      expect(result).toEqual({
        success: false,
        error: "User not authenticated",
        data: [],
      });
    });

    it("should return error when user has no id", async () => {
      mockGetServerAuthSession.mockResolvedValue({ user: {} });

      const result = await getAssignmentsForRunCases({
        originalRunId: 1,
        repositoryCaseIds: [1, 2, 3],
      });

      expect(result).toEqual({
        success: false,
        error: "User not authenticated",
        data: [],
      });
    });
  });

  describe("input validation", () => {
    it("should return error for invalid originalRunId", async () => {
      const result = await getAssignmentsForRunCases({
        originalRunId: "invalid" as any,
        repositoryCaseIds: [1, 2, 3],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid input");
        expect(result.issues).toBeDefined();
      }
      expect(result.data).toEqual([]);
    });

    it("should return error for invalid repositoryCaseIds", async () => {
      const result = await getAssignmentsForRunCases({
        originalRunId: 1,
        repositoryCaseIds: "invalid" as any,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid input");
        expect(result.issues).toBeDefined();
      }
    });

    it("should return error for non-numeric array elements", async () => {
      const result = await getAssignmentsForRunCases({
        originalRunId: 1,
        repositoryCaseIds: ["a", "b", "c"] as any,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid input");
      }
    });
  });

  describe("successful queries", () => {
    it("should return assignments with mapped data", async () => {
      mockFindMany.mockResolvedValue([
        { repositoryCaseId: 1, assignedToId: "user-1" },
        { repositoryCaseId: 2, assignedToId: "user-2" },
        { repositoryCaseId: 3, assignedToId: null },
      ]);

      const result = await getAssignmentsForRunCases({
        originalRunId: 1,
        repositoryCaseIds: [1, 2, 3],
      });

      expect(result).toEqual({
        success: true,
        data: [
          { repositoryCaseId: 1, userId: "user-1" },
          { repositoryCaseId: 2, userId: "user-2" },
          { repositoryCaseId: 3, userId: null },
        ],
      });
    });

    it("should query with correct parameters", async () => {
      mockFindMany.mockResolvedValue([]);

      await getAssignmentsForRunCases({
        originalRunId: 42,
        repositoryCaseIds: [10, 20, 30],
      });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          testRunId: 42,
          repositoryCaseId: {
            in: [10, 20, 30],
          },
        },
        select: {
          repositoryCaseId: true,
          assignedToId: true,
        },
      });
    });

    it("should handle empty repositoryCaseIds array", async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await getAssignmentsForRunCases({
        originalRunId: 1,
        repositoryCaseIds: [],
      });

      expect(result).toEqual({
        success: true,
        data: [],
      });
    });

    it("should handle single repositoryCaseId", async () => {
      mockFindMany.mockResolvedValue([
        { repositoryCaseId: 1, assignedToId: "user-1" },
      ]);

      const result = await getAssignmentsForRunCases({
        originalRunId: 1,
        repositoryCaseIds: [1],
      });

      expect(result).toEqual({
        success: true,
        data: [{ repositoryCaseId: 1, userId: "user-1" }],
      });
    });
  });

  describe("error handling", () => {
    it("should return error on database failure", async () => {
      mockFindMany.mockRejectedValue(new Error("Database error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await getAssignmentsForRunCases({
        originalRunId: 1,
        repositoryCaseIds: [1, 2, 3],
      });

      expect(result).toEqual({
        success: false,
        error: "Failed to fetch assignments",
        data: [],
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error fetching assignments for run cases:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should handle large number of repositoryCaseIds", async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);
      mockFindMany.mockResolvedValue([]);

      const result = await getAssignmentsForRunCases({
        originalRunId: 1,
        repositoryCaseIds: largeArray,
      });

      expect(result.success).toBe(true);
      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          testRunId: 1,
          repositoryCaseId: {
            in: largeArray,
          },
        },
        select: {
          repositoryCaseId: true,
          assignedToId: true,
        },
      });
    });

    it("should handle zero originalRunId", async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await getAssignmentsForRunCases({
        originalRunId: 0,
        repositoryCaseIds: [1],
      });

      expect(result.success).toBe(true);
    });
  });
});
