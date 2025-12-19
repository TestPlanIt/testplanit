import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Create mock implementations that can be referenced in the hoisted mock
const mockPipelineInstance = {
  setex: vi.fn().mockReturnThis(),
  del: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
};

// Mock valkey connection - using inline object to avoid hoisting issues
vi.mock("../../valkey", () => {
  const mockValkey = {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
    pipeline: vi.fn().mockImplementation(() => ({
      setex: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
    scanStream: vi.fn(),
    disconnect: vi.fn(),
  };
  return {
    default: {
      duplicate: () => mockValkey,
    },
    __mockValkey: mockValkey, // Export for test access
  };
});

import { IssueCache } from "./IssueCache";

// Get the mock after import
let mockValkey: any;

describe("IssueCache", () => {
  let cache: IssueCache;

  const mockIssueData = {
    id: "ISSUE-123",
    key: "ISSUE-123",
    title: "Test Issue",
    description: "Test description",
    status: "Open",
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-01-16"),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Get the mock valkey from the mocked module
    const valkeyModule = await import("../../valkey");
    mockValkey = (valkeyModule as any).__mockValkey;
    cache = new IssueCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("get", () => {
    it("should return null when cache miss", async () => {
      mockValkey.get.mockResolvedValue(null);

      const result = await cache.get(1, "ISSUE-123");

      expect(result).toBeNull();
      expect(mockValkey.get).toHaveBeenCalledWith("issue:1:ISSUE-123");
    });

    it("should return parsed cached issue", async () => {
      const cachedData = {
        ...mockIssueData,
        integrationId: 1,
        cachedAt: new Date("2024-01-17").toISOString(),
        createdAt: mockIssueData.createdAt.toISOString(),
        updatedAt: mockIssueData.updatedAt.toISOString(),
      };
      mockValkey.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await cache.get(1, "ISSUE-123");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("ISSUE-123");
      expect(result?.title).toBe("Test Issue");
      expect(result?.createdAt).toBeInstanceOf(Date);
      expect(result?.updatedAt).toBeInstanceOf(Date);
      expect(result?.cachedAt).toBeInstanceOf(Date);
    });

    it("should delete corrupted cache and return null", async () => {
      mockValkey.get.mockResolvedValue("invalid json{");
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await cache.get(1, "ISSUE-123");

      expect(result).toBeNull();
      expect(mockValkey.del).toHaveBeenCalledWith("issue:1:ISSUE-123");

      consoleSpy.mockRestore();
    });
  });

  describe("set", () => {
    it("should cache issue with default TTL", async () => {
      await cache.set(1, "ISSUE-123", mockIssueData);

      expect(mockValkey.setex).toHaveBeenCalledWith(
        "issue:1:ISSUE-123",
        3600, // default TTL
        expect.any(String)
      );
    });

    it("should cache issue with custom TTL", async () => {
      await cache.set(1, "ISSUE-123", mockIssueData, 7200);

      expect(mockValkey.setex).toHaveBeenCalledWith(
        "issue:1:ISSUE-123",
        7200,
        expect.any(String)
      );
    });

    it("should include cachedAt timestamp", async () => {
      await cache.set(1, "ISSUE-123", mockIssueData);

      const cachedValue = mockValkey.setex.mock.calls[0][2];
      const parsed = JSON.parse(cachedValue);
      expect(parsed.cachedAt).toBeDefined();
      expect(parsed.integrationId).toBe(1);
    });
  });

  describe("getBulk", () => {
    it("should return empty array on cache miss", async () => {
      mockValkey.get.mockResolvedValue(null);

      const result = await cache.getBulk(1);

      expect(result).toEqual([]);
      expect(mockValkey.get).toHaveBeenCalledWith("issues:1:all");
    });

    it("should return empty array for specific project cache miss", async () => {
      mockValkey.get.mockResolvedValue(null);

      const result = await cache.getBulk(1, "PROJECT-1");

      expect(result).toEqual([]);
      expect(mockValkey.get).toHaveBeenCalledWith("issues:1:project:PROJECT-1");
    });

    it("should return parsed cached issues", async () => {
      const cachedData = [
        {
          ...mockIssueData,
          integrationId: 1,
          cachedAt: new Date().toISOString(),
          createdAt: mockIssueData.createdAt.toISOString(),
          updatedAt: mockIssueData.updatedAt.toISOString(),
        },
      ];
      mockValkey.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await cache.getBulk(1);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("ISSUE-123");
      expect(result[0].createdAt).toBeInstanceOf(Date);
    });

    it("should delete corrupted cache and return empty array", async () => {
      mockValkey.get.mockResolvedValue("invalid json{");
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await cache.getBulk(1);

      expect(result).toEqual([]);
      expect(mockValkey.del).toHaveBeenCalledWith("issues:1:all");

      consoleSpy.mockRestore();
    });
  });

  describe("setBulk", () => {
    it("should cache multiple issues", async () => {
      const issues = [mockIssueData, { ...mockIssueData, id: "ISSUE-456" }];

      await cache.setBulk(1, issues);

      expect(mockValkey.setex).toHaveBeenCalledWith(
        "issues:1:all",
        3600,
        expect.any(String)
      );
      // Pipeline is called for individual issues
      expect(mockValkey.pipeline).toHaveBeenCalled();
    });

    it("should cache for specific project", async () => {
      await cache.setBulk(1, [mockIssueData], "PROJECT-1");

      expect(mockValkey.setex).toHaveBeenCalledWith(
        "issues:1:project:PROJECT-1",
        3600,
        expect.any(String)
      );
    });

    it("should use custom TTL", async () => {
      await cache.setBulk(1, [mockIssueData], undefined, 7200);

      expect(mockValkey.setex).toHaveBeenCalledWith(
        "issues:1:all",
        7200,
        expect.any(String)
      );
    });
  });

  describe("invalidate", () => {
    it("should invalidate specific issue", async () => {
      await cache.invalidate(1, "ISSUE-123");

      expect(mockValkey.del).toHaveBeenCalledWith("issue:1:ISSUE-123");
    });
  });

  describe("invalidateProject", () => {
    it("should invalidate project bulk cache", async () => {
      await cache.invalidateProject(1, "PROJECT-1");

      expect(mockValkey.del).toHaveBeenCalledWith("issues:1:project:PROJECT-1");
    });
  });

  describe("getMetadata", () => {
    it("should return null on cache miss", async () => {
      mockValkey.get.mockResolvedValue(null);

      const result = await cache.getMetadata(1);

      expect(result).toBeNull();
      expect(mockValkey.get).toHaveBeenCalledWith("issue-metadata:1");
    });

    it("should return parsed metadata", async () => {
      const metadata = { field1: "value1", field2: 123 };
      mockValkey.get.mockResolvedValue(JSON.stringify(metadata));

      const result = await cache.getMetadata(1);

      expect(result).toEqual(metadata);
    });

    it("should delete corrupted metadata and return null", async () => {
      mockValkey.get.mockResolvedValue("invalid{json");
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await cache.getMetadata(1);

      expect(result).toBeNull();
      expect(mockValkey.del).toHaveBeenCalledWith("issue-metadata:1");

      consoleSpy.mockRestore();
    });
  });

  describe("setMetadata", () => {
    it("should cache metadata with default TTL", async () => {
      const metadata = { field1: "value1" };

      await cache.setMetadata(1, metadata);

      expect(mockValkey.setex).toHaveBeenCalledWith(
        "issue-metadata:1",
        7200, // default metadata TTL
        JSON.stringify(metadata)
      );
    });

    it("should cache metadata with custom TTL", async () => {
      const metadata = { field1: "value1" };

      await cache.setMetadata(1, metadata, 14400);

      expect(mockValkey.setex).toHaveBeenCalledWith(
        "issue-metadata:1",
        14400,
        JSON.stringify(metadata)
      );
    });
  });

  describe("getProjects", () => {
    it("should return null on cache miss", async () => {
      mockValkey.get.mockResolvedValue(null);

      const result = await cache.getProjects(1);

      expect(result).toBeNull();
      expect(mockValkey.get).toHaveBeenCalledWith("projects:1");
    });

    it("should return parsed projects", async () => {
      const projects = [
        { id: "1", key: "PROJ1", name: "Project 1" },
        { id: "2", key: "PROJ2", name: "Project 2" },
      ];
      mockValkey.get.mockResolvedValue(JSON.stringify(projects));

      const result = await cache.getProjects(1);

      expect(result).toEqual(projects);
    });

    it("should delete corrupted projects cache and return null", async () => {
      mockValkey.get.mockResolvedValue("invalid{");
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await cache.getProjects(1);

      expect(result).toBeNull();
      expect(mockValkey.del).toHaveBeenCalledWith("projects:1");

      consoleSpy.mockRestore();
    });
  });

  describe("setProjects", () => {
    it("should cache projects with default TTL", async () => {
      const projects = [{ id: "1", key: "PROJ1", name: "Project 1" }];

      await cache.setProjects(1, projects);

      expect(mockValkey.setex).toHaveBeenCalledWith(
        "projects:1",
        86400, // default projects TTL (24 hours)
        JSON.stringify(projects)
      );
    });

    it("should cache projects with custom TTL", async () => {
      const projects = [{ id: "1", key: "PROJ1", name: "Project 1" }];

      await cache.setProjects(1, projects, 43200);

      expect(mockValkey.setex).toHaveBeenCalledWith(
        "projects:1",
        43200,
        JSON.stringify(projects)
      );
    });
  });

  describe("getCacheTTL", () => {
    it("should return TTL for cached key", async () => {
      mockValkey.ttl.mockResolvedValue(1800);

      const result = await cache.getCacheTTL(1, "ISSUE-123");

      expect(result).toBe(1800);
      expect(mockValkey.ttl).toHaveBeenCalledWith("issue:1:ISSUE-123");
    });
  });

  describe("warmCache", () => {
    it("should fetch and cache issues", async () => {
      const fetchFn = vi.fn().mockResolvedValue([mockIssueData]);

      await cache.warmCache(1, fetchFn);

      expect(fetchFn).toHaveBeenCalled();
      expect(mockValkey.setex).toHaveBeenCalled();
    });

    it("should handle fetch errors gracefully", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("Fetch failed"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await cache.warmCache(1, fetchFn);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to warm cache:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should warm cache for specific project", async () => {
      const fetchFn = vi.fn().mockResolvedValue([mockIssueData]);

      await cache.warmCache(1, fetchFn, "PROJECT-1");

      expect(fetchFn).toHaveBeenCalled();
      expect(mockValkey.setex).toHaveBeenCalledWith(
        "issues:1:project:PROJECT-1",
        expect.any(Number),
        expect.any(String)
      );
    });
  });

  describe("close", () => {
    it("should disconnect from valkey", async () => {
      await cache.close();

      expect(mockValkey.disconnect).toHaveBeenCalled();
    });
  });
});
