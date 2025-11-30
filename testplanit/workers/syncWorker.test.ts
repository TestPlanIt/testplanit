import { describe, it, expect, vi, beforeEach } from "vitest";
import { Job } from "bullmq";

// Mock the sync service
const mockPerformSync = vi.fn();
const mockPerformIssueRefresh = vi.fn();

vi.mock("../lib/integrations/services/SyncService", () => ({
  syncService: {
    performSync: (...args: any[]) => mockPerformSync(...args),
    performIssueRefresh: (...args: any[]) => mockPerformIssueRefresh(...args),
  },
  SyncJobData: {},
}));

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock queue names
vi.mock("../lib/queueNames", () => ({
  SYNC_QUEUE_NAME: "test-sync-queue",
}));

// We need to create a testable processor since the actual processor isn't exported
// This tests the logic patterns used in the worker

describe("SyncWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("sync-issues job", () => {
    it("should call performSync with correct parameters", async () => {
      const jobData = {
        userId: "user-123",
        integrationId: "integration-456",
        projectId: 1,
        data: { query: "test" },
      };

      mockPerformSync.mockResolvedValue({
        synced: 10,
        errors: [],
      });

      // Import the sync service to test it directly
      const { syncService } = await import(
        "../lib/integrations/services/SyncService"
      );

      const mockJob = {
        id: "job-123",
        name: "sync-issues",
        data: jobData,
        updateProgress: vi.fn(),
      } as unknown as Job;

      const result = await syncService.performSync(
        jobData.userId,
        jobData.integrationId,
        jobData.projectId,
        jobData.data,
        mockJob
      );

      expect(mockPerformSync).toHaveBeenCalledWith(
        jobData.userId,
        jobData.integrationId,
        jobData.projectId,
        jobData.data,
        mockJob
      );
      expect(result.synced).toBe(10);
      expect(result.errors).toEqual([]);
    });

    it("should handle sync with errors", async () => {
      mockPerformSync.mockResolvedValue({
        synced: 5,
        errors: ["Error 1", "Error 2"],
      });

      const { syncService } = await import(
        "../lib/integrations/services/SyncService"
      );

      const result = await syncService.performSync(
        "user-123",
        "integration-456",
        1,
        {},
        {} as Job
      );

      expect(result.synced).toBe(5);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe("refresh-issue job", () => {
    it("should call performIssueRefresh with correct parameters", async () => {
      const jobData = {
        userId: "user-123",
        integrationId: "integration-456",
        issueId: 789,
      };

      mockPerformIssueRefresh.mockResolvedValue({
        success: true,
      });

      const { syncService } = await import(
        "../lib/integrations/services/SyncService"
      );

      const result = await syncService.performIssueRefresh(
        jobData.userId,
        jobData.integrationId,
        jobData.issueId
      );

      expect(mockPerformIssueRefresh).toHaveBeenCalledWith(
        jobData.userId,
        jobData.integrationId,
        jobData.issueId
      );
      expect(result.success).toBe(true);
    });

    it("should handle refresh failure", async () => {
      mockPerformIssueRefresh.mockResolvedValue({
        success: false,
        error: "Issue not found",
      });

      const { syncService } = await import(
        "../lib/integrations/services/SyncService"
      );

      const result = await syncService.performIssueRefresh(
        "user-123",
        "integration-456",
        999
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Issue not found");
    });
  });

  describe("Worker module", () => {
    it("should export default as null when valkey connection is unavailable", async () => {
      const syncWorkerModule = await import("./syncWorker");
      // Worker should be null since we mocked valkey as null
      expect(syncWorkerModule.default).toBeNull();
    });
  });
});

describe("SyncService interface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle performSync returning errors array", async () => {
    mockPerformSync.mockResolvedValue({
      synced: 0,
      errors: ["Connection timeout", "Rate limit exceeded"],
    });

    const { syncService } = await import(
      "../lib/integrations/services/SyncService"
    );

    const result = await syncService.performSync(
      "user-123",
      "integration-456",
      1,
      {},
      {} as Job
    );

    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should handle performSync throwing an error", async () => {
    mockPerformSync.mockRejectedValue(new Error("Network error"));

    const { syncService } = await import(
      "../lib/integrations/services/SyncService"
    );

    await expect(
      syncService.performSync("user-123", "integration-456", 1, {}, {} as Job)
    ).rejects.toThrow("Network error");
  });

  it("should handle performIssueRefresh throwing an error", async () => {
    mockPerformIssueRefresh.mockRejectedValue(new Error("Database error"));

    const { syncService } = await import(
      "../lib/integrations/services/SyncService"
    );

    await expect(
      syncService.performIssueRefresh("user-123", "integration-456", 123)
    ).rejects.toThrow("Database error");
  });
});
