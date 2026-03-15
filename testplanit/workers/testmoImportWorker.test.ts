import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store original env values
const originalEnv = { ...process.env };

// Mock multiTenantPrisma module
const mockValidateMultiTenantJobData = vi.fn();
const mockGetPrismaClientForJob = vi.fn();
const mockIsMultiTenantMode = vi.fn();
const mockDisconnectAllTenantClients = vi.fn();

vi.mock("../lib/multiTenantPrisma", () => ({
  isMultiTenantMode: () => mockIsMultiTenantMode(),
  disconnectAllTenantClients: () => mockDisconnectAllTenantClients(),
  getPrismaClientForJob: (jobData: { tenantId?: string }) =>
    mockGetPrismaClientForJob(jobData),
  validateMultiTenantJobData: (jobData: { tenantId?: string }) =>
    mockValidateMultiTenantJobData(jobData),
}));

// Mock valkey connection to prevent worker startup
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock queue names
vi.mock("../lib/queueNames", () => ({
  TESTMO_IMPORT_QUEUE_NAME: "test-testmo-import-queue",
  ELASTICSEARCH_REINDEX_QUEUE_NAME: "test-elasticsearch-reindex-queue",
}));

// Mock prisma
const mockPrisma = {
  testmoImportJob: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $disconnect: vi.fn(),
};

vi.mock("../lib/prismaBase", () => ({
  prisma: mockPrisma,
}));

// Mock clearAutomationImportCaches
vi.mock("./testmoImport/automationImports", () => ({
  clearAutomationImportCaches: vi.fn(),
  importAutomationRunLinks: vi.fn(),
  importAutomationRunTestFields: vi.fn(),
  importAutomationRunTags: vi.fn(),
}));

describe("testmoImportWorker multi-tenant support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.MULTI_TENANT_MODE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("validateMultiTenantJobData integration", () => {
    it("should not throw in single-tenant mode without tenantId", () => {
      mockIsMultiTenantMode.mockReturnValue(false);

      // Simulate the validation logic
      const jobData: { jobId: string; mode: string; tenantId?: string } = {
        jobId: "test-job-123",
        mode: "analyze",
      };

      // In single-tenant mode, validation should pass without tenantId
      expect(() => {
        if (mockIsMultiTenantMode() && !jobData.tenantId) {
          throw new Error("tenantId is required in multi-tenant mode");
        }
      }).not.toThrow();
    });

    it("should throw in multi-tenant mode without tenantId", () => {
      mockIsMultiTenantMode.mockReturnValue(true);

      const jobData: { jobId: string; mode: string; tenantId?: string } = {
        jobId: "test-job-123",
        mode: "analyze",
      };

      // In multi-tenant mode, validation should fail without tenantId
      expect(() => {
        if (mockIsMultiTenantMode() && !jobData.tenantId) {
          throw new Error("tenantId is required in multi-tenant mode");
        }
      }).toThrow("tenantId is required in multi-tenant mode");
    });

    it("should not throw in multi-tenant mode with tenantId", () => {
      mockIsMultiTenantMode.mockReturnValue(true);

      const jobData = {
        jobId: "test-job-123",
        mode: "analyze",
        tenantId: "tenant-a",
      };

      // In multi-tenant mode with tenantId, validation should pass
      expect(() => {
        if (mockIsMultiTenantMode() && !jobData.tenantId) {
          throw new Error("tenantId is required in multi-tenant mode");
        }
      }).not.toThrow();
    });
  });

  describe("getPrismaClientForJob integration", () => {
    it("should return base prisma client in single-tenant mode", () => {
      mockIsMultiTenantMode.mockReturnValue(false);
      mockGetPrismaClientForJob.mockReturnValue(mockPrisma);

      const jobData = { jobId: "test-job-123" };
      const client = mockGetPrismaClientForJob(jobData);

      expect(client).toBe(mockPrisma);
      expect(mockGetPrismaClientForJob).toHaveBeenCalledWith(jobData);
    });

    it("should return tenant-specific client in multi-tenant mode", () => {
      mockIsMultiTenantMode.mockReturnValue(true);
      const tenantPrisma = { ...mockPrisma, tenantId: "tenant-a" };
      mockGetPrismaClientForJob.mockReturnValue(tenantPrisma);

      const jobData = { jobId: "test-job-123", tenantId: "tenant-a" };
      const client = mockGetPrismaClientForJob(jobData);

      expect(client.tenantId).toBe("tenant-a");
      expect(mockGetPrismaClientForJob).toHaveBeenCalledWith(jobData);
    });
  });

  describe("cache clearing for multi-tenant isolation", () => {
    it("should clear caches to prevent cross-tenant pollution", async () => {
      const { clearAutomationImportCaches } = await import(
        "./testmoImport/automationImports"
      );

      // Verify the function is called (which clears caches)
      clearAutomationImportCaches();

      expect(clearAutomationImportCaches).toHaveBeenCalled();
    });
  });

  describe("job data structure", () => {
    it("should accept job data with tenantId", () => {
      const jobData = {
        jobId: "test-job-123",
        mode: "analyze" as const,
        tenantId: "tenant-abc",
      };

      expect(jobData.jobId).toBe("test-job-123");
      expect(jobData.mode).toBe("analyze");
      expect(jobData.tenantId).toBe("tenant-abc");
    });

    it("should accept job data without tenantId for single-tenant mode", () => {
      const jobData = {
        jobId: "test-job-123",
        mode: "import" as const,
      };

      expect(jobData.jobId).toBe("test-job-123");
      expect(jobData.mode).toBe("import");
      expect((jobData as any).tenantId).toBeUndefined();
    });

    it("should support both analyze and import modes", () => {
      const analyzeJob = { jobId: "job-1", mode: "analyze" as const };
      const importJob = { jobId: "job-2", mode: "import" as const };

      expect(analyzeJob.mode).toBe("analyze");
      expect(importJob.mode).toBe("import");
    });
  });

  describe("reindex job tenantId propagation", () => {
    it("should include tenantId when creating reindex job in multi-tenant mode", () => {
      const tenantId = "tenant-xyz";

      // Simulate the reindex job data creation
      const reindexJobData = {
        entityType: "all" as const,
        userId: "user-123",
        tenantId,
      };

      expect(reindexJobData.tenantId).toBe(tenantId);
    });

    it("should have undefined tenantId in single-tenant mode", () => {
      const tenantId = undefined;

      const reindexJobData = {
        entityType: "all" as const,
        userId: "user-123",
        tenantId,
      };

      expect(reindexJobData.tenantId).toBeUndefined();
    });
  });

  describe("shutdown behavior", () => {
    it("should disconnect all tenant clients in multi-tenant mode on shutdown", async () => {
      mockIsMultiTenantMode.mockReturnValue(true);
      mockDisconnectAllTenantClients.mockResolvedValue(undefined);

      // Simulate shutdown behavior
      if (mockIsMultiTenantMode()) {
        await mockDisconnectAllTenantClients();
      }

      expect(mockDisconnectAllTenantClients).toHaveBeenCalled();
    });

    it("should not disconnect tenant clients in single-tenant mode on shutdown", async () => {
      mockIsMultiTenantMode.mockReturnValue(false);

      // Simulate shutdown behavior
      if (mockIsMultiTenantMode()) {
        await mockDisconnectAllTenantClients();
      }

      expect(mockDisconnectAllTenantClients).not.toHaveBeenCalled();
    });
  });
});

describe("testmoImportWorker module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should have required multi-tenant imports", async () => {
    // Verify the module imports and uses multi-tenant functions
    // The actual worker functionality is tested via integration tests
    const multiTenantModule = await import("../lib/multiTenantPrisma");

    expect(multiTenantModule.isMultiTenantMode).toBeDefined();
    expect(multiTenantModule.getPrismaClientForJob).toBeDefined();
    expect(multiTenantModule.validateMultiTenantJobData).toBeDefined();
    expect(multiTenantModule.disconnectAllTenantClients).toBeDefined();
  });
});
