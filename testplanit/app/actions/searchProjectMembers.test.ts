import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock getProjectEffectiveMembers first
const mockGetProjectEffectiveMembers = vi.fn();
vi.mock("./getProjectEffectiveMembers", () => ({
  getProjectEffectiveMembers: (...args: any[]) =>
    mockGetProjectEffectiveMembers(...args),
}));

// Mock the Prisma client methods
const mockFindMany = vi.fn();
const mockCount = vi.fn();

// Mock @prisma/client with a proper class constructor
vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class MockPrismaClient {
      user = {
        findMany: (...args: any[]) => mockFindMany(...args),
        count: (...args: any[]) => mockCount(...args),
      };
    },
  };
});

// Import after mocks are set up
import { searchProjectMembers } from "./searchProjectMembers";

describe("searchProjectMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockGetProjectEffectiveMembers.mockResolvedValue([]);
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("empty results", () => {
    it("should return empty results when no effective members exist", async () => {
      mockGetProjectEffectiveMembers.mockResolvedValue([]);

      const result = await searchProjectMembers(1, "", 0, 10);

      expect(result).toEqual({ results: [], total: 0 });
    });
  });

  describe("successful queries", () => {
    const mockUsers = [
      { id: "user-1", name: "Alice", email: "alice@test.com", image: null },
      { id: "user-2", name: "Bob", email: "bob@test.com", image: "/avatar.jpg" },
    ];

    beforeEach(() => {
      mockGetProjectEffectiveMembers.mockResolvedValue([
        "user-1",
        "user-2",
        "user-3",
      ]);
      mockFindMany.mockResolvedValue(mockUsers);
      mockCount.mockResolvedValue(2);
    });

    it("should return paginated users", async () => {
      const result = await searchProjectMembers(1, "", 0, 10);

      expect(result.results).toEqual(mockUsers);
      expect(result.total).toBe(2);
    });

    it("should pass correct pagination parameters", async () => {
      await searchProjectMembers(1, "", 2, 20);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 40, // page 2 * pageSize 20
          take: 20,
        })
      );
    });

    it("should filter by effective member IDs", async () => {
      await searchProjectMembers(1, "", 0, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["user-1", "user-2", "user-3"] },
            isDeleted: false,
          }),
        })
      );
    });

    it("should order by name ascending", async () => {
      await searchProjectMembers(1, "", 0, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: "asc" },
        })
      );
    });

    it("should select correct user fields", async () => {
      await searchProjectMembers(1, "", 0, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        })
      );
    });
  });

  describe("search filtering", () => {
    beforeEach(() => {
      mockGetProjectEffectiveMembers.mockResolvedValue(["user-1", "user-2"]);
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);
    });

    it("should add search filter when query is provided", async () => {
      await searchProjectMembers(1, "alice", 0, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: "alice", mode: "insensitive" } },
              { email: { contains: "alice", mode: "insensitive" } },
            ],
          }),
        })
      );
    });

    it("should trim search query whitespace", async () => {
      await searchProjectMembers(1, "  bob  ", 0, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: "bob", mode: "insensitive" } },
              { email: { contains: "bob", mode: "insensitive" } },
            ],
          }),
        })
      );
    });

    it("should not add OR filter for empty query", async () => {
      await searchProjectMembers(1, "", 0, 10);

      const callArg = mockFindMany.mock.calls[0][0];
      expect(callArg.where.OR).toBeUndefined();
    });

    it("should not add OR filter for whitespace-only query", async () => {
      await searchProjectMembers(1, "   ", 0, 10);

      const callArg = mockFindMany.mock.calls[0][0];
      expect(callArg.where.OR).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should return empty results on error from getProjectEffectiveMembers", async () => {
      mockGetProjectEffectiveMembers.mockRejectedValue(
        new Error("Database error")
      );
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await searchProjectMembers(1, "", 0, 10);

      expect(result).toEqual({ results: [], total: 0 });
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error searching project members:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should return empty results on error from findMany", async () => {
      mockGetProjectEffectiveMembers.mockResolvedValue(["user-1"]);
      mockFindMany.mockRejectedValue(new Error("Query failed"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await searchProjectMembers(1, "", 0, 10);

      expect(result).toEqual({ results: [], total: 0 });

      consoleSpy.mockRestore();
    });

    it("should return empty results on error from count", async () => {
      mockGetProjectEffectiveMembers.mockResolvedValue(["user-1"]);
      mockFindMany.mockResolvedValue([{ id: "user-1", name: "Test" }]);
      mockCount.mockRejectedValue(new Error("Count failed"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await searchProjectMembers(1, "", 0, 10);

      expect(result).toEqual({ results: [], total: 0 });

      consoleSpy.mockRestore();
    });
  });

  describe("pagination edge cases", () => {
    beforeEach(() => {
      mockGetProjectEffectiveMembers.mockResolvedValue(["user-1"]);
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);
    });

    it("should handle first page (page 0)", async () => {
      await searchProjectMembers(1, "", 0, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        })
      );
    });

    it("should handle large page numbers", async () => {
      await searchProjectMembers(1, "", 100, 25);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 2500,
          take: 25,
        })
      );
    });

    it("should handle page size of 1", async () => {
      await searchProjectMembers(1, "", 5, 1);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 1,
        })
      );
    });
  });
});
