import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_REFRESH_EXPIRED_CACHES } from "./repoCacheWorker";

// Create mock prisma instance
const mockPrisma = {
  projectCodeRepositoryConfig: {
    findMany: vi.fn(),
  },
  $disconnect: vi.fn(),
};

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock the multiTenantPrisma module to return our mock prisma client
vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// Mock repoFileCache
const mockGetFiles = vi.fn();
vi.mock("../lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {
    getFiles: (...args: any[]) => mockGetFiles(...args),
  },
}));

// Mock refreshRepoCache
const mockRefreshRepoCache = vi.fn();
vi.mock("../lib/services/repoCacheRefreshService", () => ({
  refreshRepoCache: (...args: any[]) => mockRefreshRepoCache(...args),
}));

// Mock queue names
vi.mock("../lib/queueNames", () => ({
  REPO_CACHE_QUEUE_NAME: "test-repo-cache-queue",
}));

const mockConfigs = [
  { id: 101, projectId: 1, cacheTtlDays: 7 },
  { id: 102, projectId: 2, cacheTtlDays: 3 },
];

describe("RepoCacheWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.INSTANCE_TENANT_ID;
  });

  describe(`${JOB_REFRESH_EXPIRED_CACHES} job`, () => {
    it("should skip configs where cache is still valid (files exist)", async () => {
      mockPrisma.projectCodeRepositoryConfig.findMany.mockResolvedValue(
        mockConfigs
      );
      // Return valid files for both configs
      mockGetFiles.mockResolvedValue([
        { path: "src/main.ts", content: "...", size: 100 },
      ]);

      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-1",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: {},
      } as Job;

      const result = await processor(mockJob);

      expect(mockRefreshRepoCache).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: "completed", skippedCount: 2, successCount: 0, failCount: 0 });
    });

    it("should refresh cache when files are empty (cache expired)", async () => {
      mockPrisma.projectCodeRepositoryConfig.findMany.mockResolvedValue([
        mockConfigs[0],
      ]);
      // Return empty array - cache expired
      mockGetFiles.mockResolvedValue([]);
      mockRefreshRepoCache.mockResolvedValue({
        success: true,
        fileCount: 42,
        contentCached: 10,
      });

      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-2",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: {},
      } as Job;

      const result = await processor(mockJob);

      expect(mockRefreshRepoCache).toHaveBeenCalledWith(101, mockPrisma);
      expect(result).toMatchObject({
        status: "completed",
        successCount: 1,
        skippedCount: 0,
        failCount: 0,
      });
    });

    it("should count as failed when refresh returns success: false", async () => {
      mockPrisma.projectCodeRepositoryConfig.findMany.mockResolvedValue([
        mockConfigs[0],
      ]);
      mockGetFiles.mockResolvedValue([]);
      mockRefreshRepoCache.mockResolvedValue({
        success: false,
        error: "Git authentication failed",
      });

      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-3",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: {},
      } as Job;

      const result = await processor(mockJob);

      expect(mockRefreshRepoCache).toHaveBeenCalledWith(101, mockPrisma);
      expect(result).toMatchObject({
        status: "completed",
        failCount: 1,
        successCount: 0,
      });
    });

    it("should continue processing other configs when one throws an exception", async () => {
      mockPrisma.projectCodeRepositoryConfig.findMany.mockResolvedValue(
        mockConfigs
      );
      // First config throws, second is expired and succeeds
      mockGetFiles
        .mockRejectedValueOnce(new Error("Cache read error"))
        .mockResolvedValueOnce([]);
      mockRefreshRepoCache.mockResolvedValue({
        success: true,
        fileCount: 5,
        contentCached: 5,
      });

      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-4",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: {},
      } as Job;

      const result = await processor(mockJob);

      // Second config should still be processed
      expect(mockRefreshRepoCache).toHaveBeenCalledWith(102, mockPrisma);
      expect(result).toMatchObject({
        status: "completed",
        failCount: 1,
        successCount: 1,
      });
    });

    it("should handle a mix of valid, expired, and failed configs", async () => {
      mockPrisma.projectCodeRepositoryConfig.findMany.mockResolvedValue([
        { id: 101, projectId: 1, cacheTtlDays: 7 },
        { id: 102, projectId: 2, cacheTtlDays: 3 },
        { id: 103, projectId: 3, cacheTtlDays: 1 },
      ]);
      // 101: valid cache, 102: expired + success, 103: expired + fail
      mockGetFiles
        .mockResolvedValueOnce([{ path: "file.ts", content: "", size: 1 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockRefreshRepoCache
        .mockResolvedValueOnce({ success: true, fileCount: 3, contentCached: 2 })
        .mockResolvedValueOnce({ success: false, error: "Token expired" });

      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-5",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: {},
      } as Job;

      const result = await processor(mockJob);

      expect(result).toMatchObject({
        status: "completed",
        successCount: 1,
        skippedCount: 1,
        failCount: 1,
      });
    });

    it("should handle no cache-enabled configs", async () => {
      mockPrisma.projectCodeRepositoryConfig.findMany.mockResolvedValue([]);

      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-6",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: {},
      } as Job;

      const result = await processor(mockJob);

      expect(mockGetFiles).not.toHaveBeenCalled();
      expect(mockRefreshRepoCache).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: "completed",
        successCount: 0,
        skippedCount: 0,
        failCount: 0,
      });
    });
  });

  describe("INSTANCE_TENANT_ID restoration", () => {
    it("should restore INSTANCE_TENANT_ID to previous value after job completes", async () => {
      process.env.INSTANCE_TENANT_ID = "original-tenant";

      mockPrisma.projectCodeRepositoryConfig.findMany.mockResolvedValue([
        mockConfigs[0],
      ]);
      mockGetFiles.mockResolvedValue([]);
      mockRefreshRepoCache.mockResolvedValue({
        success: true,
        fileCount: 1,
        contentCached: 1,
      });

      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-7",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: { tenantId: "new-tenant" },
      } as Job;

      await processor(mockJob);

      expect(process.env.INSTANCE_TENANT_ID).toBe("original-tenant");
    });

    it("should delete INSTANCE_TENANT_ID after job when it was not set before", async () => {
      // Ensure it's not set
      delete process.env.INSTANCE_TENANT_ID;

      mockPrisma.projectCodeRepositoryConfig.findMany.mockResolvedValue([]);

      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-8",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: { tenantId: "some-tenant" },
      } as Job;

      await processor(mockJob);

      expect(process.env.INSTANCE_TENANT_ID).toBeUndefined();
    });

    it("should restore INSTANCE_TENANT_ID even when an exception is thrown", async () => {
      process.env.INSTANCE_TENANT_ID = "original-tenant";

      mockPrisma.projectCodeRepositoryConfig.findMany.mockRejectedValue(
        new Error("DB connection failed")
      );

      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-9",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: { tenantId: "new-tenant" },
      } as Job;

      await expect(processor(mockJob)).rejects.toThrow("DB connection failed");

      // INSTANCE_TENANT_ID should be restored even after error
      expect(process.env.INSTANCE_TENANT_ID).toBe("original-tenant");
    });
  });

  describe("unknown job type", () => {
    it("should throw an error for unknown job types", async () => {
      const { processor } = await import("./repoCacheWorker");

      const mockJob = {
        id: "job-99",
        name: "unknown-job-type",
        data: {},
      } as Job;

      await expect(processor(mockJob)).rejects.toThrow(
        "Unknown job type: unknown-job-type"
      );
    });
  });
});
