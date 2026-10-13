import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the sync service
const mockPerformSync = vi.fn();
const mockPerformIssueRefresh = vi.fn();
const mockPerformProjectImport = vi.fn();

vi.mock("../lib/integrations/services/SyncService", () => ({
  syncService: {
    performSync: (...args: any[]) => mockPerformSync(...args),
    performIssueRefresh: (...args: any[]) => mockPerformIssueRefresh(...args),
    performProjectImport: (...args: any[]) => mockPerformProjectImport(...args),
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

// Mock multi-tenant db helpers so `processor` can run in single-tenant mode
// without touching a real Prisma client (`getDbClientForJob` otherwise lazily
// requires `./rawDb`).
const mockGetDbClientForJob = vi.fn();
vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: (...args: any[]) => mockGetDbClientForJob(...args),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// Mock audit logging so processor's captureAuditEvent call is observable
// without hitting a real DB.
const mockCaptureAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mockCaptureAuditEvent(...args),
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
        integrationId: 456,
        projectId: "1",
        data: { forceRefresh: true },
      };

      mockPerformSync.mockResolvedValue({
        synced: 10,
        errors: [],
      });

      // Import the sync service to test it directly
      const { syncService } =
        await import("../lib/integrations/services/SyncService");

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

      const { syncService } =
        await import("../lib/integrations/services/SyncService");

      const result = await syncService.performSync(
        "user-123",
        456,
        "1",
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
        integrationId: 456,
        issueId: "789",
      };

      mockPerformIssueRefresh.mockResolvedValue({
        success: true,
      });

      const { syncService } =
        await import("../lib/integrations/services/SyncService");

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

      const { syncService } =
        await import("../lib/integrations/services/SyncService");

      const result = await syncService.performIssueRefresh(
        "user-123",
        456,
        "999"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Issue not found");
    });
  });

  describe("import-project-issues job (#501/28-05)", () => {
    beforeEach(() => {
      mockGetDbClientForJob.mockReturnValue({});
    });

    it("forwards issueTypeIds and pagedToCompletion from the job payload to performProjectImport", async () => {
      mockPerformProjectImport.mockResolvedValue({
        imported: 10,
        matched: 10,
        skipped: 0,
        cappedAt: 10,
        reachedCap: false,
        errors: [],
        cancelled: false,
      });

      const { processor } = await import("./syncWorker");

      const jobData = {
        userId: "user-1",
        integrationId: 5,
        action: "sync" as const,
        data: {
          integrationProjectId: "ip-1",
          issueTypeIds: ["10001", "10002"],
          pagedToCompletion: true,
        },
      };
      const mockJob = {
        id: "job-1",
        name: "import-project-issues",
        data: jobData,
        updateProgress: vi.fn(),
      } as unknown as Job;

      await processor(mockJob);

      expect(mockPerformProjectImport).toHaveBeenCalledWith(
        5,
        "ip-1",
        expect.objectContaining({
          issueTypeIds: ["10001", "10002"],
          pagedToCompletion: true,
        }),
        mockJob,
        expect.anything()
      );
    });

    it("audits a cancelled run as cancelled, not as a success and not as an error", async () => {
      mockPerformProjectImport.mockResolvedValue({
        imported: 100,
        matched: 100,
        skipped: 0,
        cappedAt: 100,
        reachedCap: false,
        errors: [],
        cancelled: true,
      });

      const { processor } = await import("./syncWorker");

      const jobData = {
        userId: "user-1",
        integrationId: 5,
        action: "sync" as const,
        data: { integrationProjectId: "ip-1", pagedToCompletion: true },
      };
      const mockJob = {
        id: "job-1",
        name: "import-project-issues",
        data: jobData,
        updateProgress: vi.fn(),
      } as unknown as Job;

      await processor(mockJob);

      expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ cancelled: true }),
        })
      );
    });

    it("leaves a recency-mode job's forwarded options and audit metadata unchanged", async () => {
      mockPerformProjectImport.mockResolvedValue({
        imported: 42,
        matched: 42,
        skipped: 3,
        cappedAt: 200,
        reachedCap: false,
        errors: [],
        cancelled: false,
      });

      const { processor } = await import("./syncWorker");

      const jobData = {
        userId: "user-1",
        integrationId: 5,
        action: "sync" as const,
        data: { integrationProjectId: "ip-1", updatedWithinDays: 90, cap: 200 },
      };
      const mockJob = {
        id: "job-1",
        name: "import-project-issues",
        data: jobData,
        updateProgress: vi.fn(),
      } as unknown as Job;

      await processor(mockJob);

      expect(mockPerformProjectImport).toHaveBeenCalledWith(
        5,
        "ip-1",
        {
          updatedWithinDays: 90,
          cap: 200,
          issueTypeIds: undefined,
          pagedToCompletion: undefined,
        },
        mockJob,
        expect.anything()
      );
      expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            importedCount: 42,
            skippedCount: 3,
            reachedCap: false,
            cancelled: false,
          }),
        })
      );
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

    const { syncService } =
      await import("../lib/integrations/services/SyncService");

    const result = await syncService.performSync(
      "user-123",
      456,
      "1",
      {},
      {} as Job
    );

    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should handle performSync throwing an error", async () => {
    mockPerformSync.mockRejectedValue(new Error("Network error"));

    const { syncService } =
      await import("../lib/integrations/services/SyncService");

    await expect(
      syncService.performSync("user-123", 456, "1", {}, {} as Job)
    ).rejects.toThrow("Network error");
  });

  it("should handle performIssueRefresh throwing an error", async () => {
    mockPerformIssueRefresh.mockRejectedValue(new Error("Database error"));

    const { syncService } =
      await import("../lib/integrations/services/SyncService");

    await expect(
      syncService.performIssueRefresh("user-123", 456, "123")
    ).rejects.toThrow("Database error");
  });
});
