import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
const mockAggregate = vi.fn();
const mockCreate = vi.fn();

vi.mock("~/lib/prisma", () => ({
  prisma: {
    testRunCases: {
      aggregate: (...args: any[]) => mockAggregate(...args),
      create: (...args: any[]) => mockCreate(...args),
    },
  },
}));

const mockGetServerAuthSession = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mockGetServerAuthSession(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { getMaxOrderInTestRun, addToTestRun } from "./test-run";

describe("test-run actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-123" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getMaxOrderInTestRun", () => {
    it("should return error when not authenticated", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await getMaxOrderInTestRun(1);

      expect(result).toEqual({
        success: false,
        error: "User not authenticated",
        data: 0,
      });
    });

    it("should return error when user has no id", async () => {
      mockGetServerAuthSession.mockResolvedValue({ user: {} });

      const result = await getMaxOrderInTestRun(1);

      expect(result).toEqual({
        success: false,
        error: "User not authenticated",
        data: 0,
      });
    });

    it("should return max order value", async () => {
      mockAggregate.mockResolvedValue({
        _max: { order: 42 },
      });

      const result = await getMaxOrderInTestRun(123);

      expect(result).toEqual({
        success: true,
        data: 42,
      });
      expect(mockAggregate).toHaveBeenCalledWith({
        where: { testRunId: 123 },
        _max: { order: true },
      });
    });

    it("should return 0 when no cases exist", async () => {
      mockAggregate.mockResolvedValue({
        _max: { order: null },
      });

      const result = await getMaxOrderInTestRun(1);

      expect(result).toEqual({
        success: true,
        data: 0,
      });
    });

    it("should return error on database failure", async () => {
      mockAggregate.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await getMaxOrderInTestRun(1);

      expect(result).toEqual({
        success: false,
        error: "Failed to get max order",
        data: 0,
      });

      consoleSpy.mockRestore();
    });
  });

  describe("addToTestRun", () => {
    it("should return error when not authenticated", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await addToTestRun(1, 100, 1);

      expect(result).toEqual({
        success: false,
        error: "User not authenticated",
      });
    });

    it("should return error when user has no id", async () => {
      mockGetServerAuthSession.mockResolvedValue({ user: {} });

      const result = await addToTestRun(1, 100, 1);

      expect(result).toEqual({
        success: false,
        error: "User not authenticated",
      });
    });

    it("should create test run case with correct data", async () => {
      const mockResult = {
        id: 1,
        testRunId: 123,
        repositoryCaseId: 456,
        order: 5,
      };
      mockCreate.mockResolvedValue(mockResult);

      const result = await addToTestRun(123, 456, 5);

      expect(result).toEqual({
        success: true,
        data: mockResult,
      });
      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          testRunId: 123,
          repositoryCaseId: 456,
          order: 5,
        },
      });
    });

    it("should handle order 0", async () => {
      mockCreate.mockResolvedValue({
        id: 1,
        testRunId: 1,
        repositoryCaseId: 1,
        order: 0,
      });

      const result = await addToTestRun(1, 1, 0);

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ order: 0 }),
      });
    });

    it("should handle large order values", async () => {
      mockCreate.mockResolvedValue({
        id: 1,
        testRunId: 1,
        repositoryCaseId: 1,
        order: 99999,
      });

      const result = await addToTestRun(1, 1, 99999);

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ order: 99999 }),
      });
    });

    it("should return error on database failure", async () => {
      mockCreate.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await addToTestRun(1, 100, 1);

      expect(result).toEqual({
        success: false,
        error: "Failed to add test case to test run",
      });

      consoleSpy.mockRestore();
    });

    it("should return error on unique constraint violation", async () => {
      const error = new Error("Unique constraint failed");
      mockCreate.mockRejectedValue(error);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await addToTestRun(1, 100, 1);

      expect(result.success).toBe(false);

      consoleSpy.mockRestore();
    });
  });
});
