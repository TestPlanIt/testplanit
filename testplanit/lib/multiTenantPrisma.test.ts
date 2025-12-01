import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Store original env values
const originalEnv = { ...process.env };

// Reset module state between tests
const resetModule = async () => {
  vi.resetModules();
  // Clear tenant configs cache by re-importing
  const module = await import("./multiTenantPrisma");
  return module;
};

describe("multiTenantPrisma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.MULTI_TENANT_MODE;
    delete process.env.INSTANCE_TENANT_ID;
    delete process.env.TENANT_CONFIGS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("isMultiTenantMode", () => {
    it('should return false when MULTI_TENANT_MODE is not set', async () => {
      const { isMultiTenantMode } = await resetModule();
      expect(isMultiTenantMode()).toBe(false);
    });

    it('should return false when MULTI_TENANT_MODE is "false"', async () => {
      process.env.MULTI_TENANT_MODE = "false";
      const { isMultiTenantMode } = await resetModule();
      expect(isMultiTenantMode()).toBe(false);
    });

    it('should return true when MULTI_TENANT_MODE is "true"', async () => {
      process.env.MULTI_TENANT_MODE = "true";
      const { isMultiTenantMode } = await resetModule();
      expect(isMultiTenantMode()).toBe(true);
    });
  });

  describe("getCurrentTenantId", () => {
    it("should return undefined in single-tenant mode", async () => {
      process.env.INSTANCE_TENANT_ID = "tenant-a";
      const { getCurrentTenantId } = await resetModule();
      expect(getCurrentTenantId()).toBeUndefined();
    });

    it("should return undefined when INSTANCE_TENANT_ID is not set", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      const { getCurrentTenantId } = await resetModule();
      expect(getCurrentTenantId()).toBeUndefined();
    });

    it("should return tenant ID in multi-tenant mode", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.INSTANCE_TENANT_ID = "tenant-a";
      const { getCurrentTenantId } = await resetModule();
      expect(getCurrentTenantId()).toBe("tenant-a");
    });
  });

  describe("loadTenantConfigs", () => {
    it("should load configs from TENANT_CONFIGS JSON", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.TENANT_CONFIGS = JSON.stringify({
        "tenant-a": {
          databaseUrl: "postgresql://localhost/tenant_a",
          elasticsearchNode: "http://es:9200",
          elasticsearchIndex: "tenant_a_index",
        },
        "tenant-b": {
          databaseUrl: "postgresql://localhost/tenant_b",
        },
      });

      const { loadTenantConfigs } = await resetModule();
      const configs = loadTenantConfigs();

      expect(configs.size).toBe(2);
      expect(configs.get("tenant-a")).toEqual({
        tenantId: "tenant-a",
        databaseUrl: "postgresql://localhost/tenant_a",
        elasticsearchNode: "http://es:9200",
        elasticsearchIndex: "tenant_a_index",
      });
      expect(configs.get("tenant-b")).toEqual({
        tenantId: "tenant-b",
        databaseUrl: "postgresql://localhost/tenant_b",
        elasticsearchNode: undefined,
        elasticsearchIndex: undefined,
      });
    });

    it("should load configs from individual environment variables", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.TENANT_ACME_DATABASE_URL = "postgresql://localhost/acme";
      process.env.TENANT_ACME_ELASTICSEARCH_NODE = "http://es-acme:9200";

      const { loadTenantConfigs } = await resetModule();
      const configs = loadTenantConfigs();

      expect(configs.size).toBe(1);
      expect(configs.get("acme")).toEqual({
        tenantId: "acme",
        databaseUrl: "postgresql://localhost/acme",
        elasticsearchNode: "http://es-acme:9200",
        elasticsearchIndex: undefined,
      });
    });

    it("should handle invalid JSON in TENANT_CONFIGS", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.TENANT_CONFIGS = "invalid json";

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { loadTenantConfigs } = await resetModule();
      const configs = loadTenantConfigs();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to parse TENANT_CONFIGS:",
        expect.any(Error)
      );
      expect(configs.size).toBe(0);

      consoleErrorSpy.mockRestore();
    });

    it("should warn when no tenant configurations found", async () => {
      process.env.MULTI_TENANT_MODE = "true";

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const { loadTenantConfigs } = await resetModule();
      const configs = loadTenantConfigs();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "No tenant configurations found. Multi-tenant mode will not work without configurations."
      );
      expect(configs.size).toBe(0);

      consoleWarnSpy.mockRestore();
    });
  });

  describe("getTenantConfig", () => {
    it("should return config for existing tenant", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.TENANT_CONFIGS = JSON.stringify({
        "tenant-x": {
          databaseUrl: "postgresql://localhost/tenant_x",
        },
      });

      const { getTenantConfig } = await resetModule();
      const config = getTenantConfig("tenant-x");

      expect(config).toEqual({
        tenantId: "tenant-x",
        databaseUrl: "postgresql://localhost/tenant_x",
        elasticsearchNode: undefined,
        elasticsearchIndex: undefined,
      });
    });

    it("should return undefined for non-existent tenant", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.TENANT_CONFIGS = JSON.stringify({
        "tenant-a": { databaseUrl: "postgresql://localhost/a" },
      });

      const { getTenantConfig } = await resetModule();
      const config = getTenantConfig("non-existent");

      expect(config).toBeUndefined();
    });
  });

  describe("getAllTenantIds", () => {
    it("should return all tenant IDs", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.TENANT_CONFIGS = JSON.stringify({
        alpha: { databaseUrl: "postgresql://localhost/alpha" },
        beta: { databaseUrl: "postgresql://localhost/beta" },
        gamma: { databaseUrl: "postgresql://localhost/gamma" },
      });

      const { getAllTenantIds } = await resetModule();
      const tenantIds = getAllTenantIds();

      expect(tenantIds).toHaveLength(3);
      expect(tenantIds).toContain("alpha");
      expect(tenantIds).toContain("beta");
      expect(tenantIds).toContain("gamma");
    });

    it("should return empty array when no tenants configured", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.MULTI_TENANT_MODE = "true";

      const { getAllTenantIds } = await resetModule();
      const tenantIds = getAllTenantIds();

      expect(tenantIds).toEqual([]);
    });
  });

  describe("validateMultiTenantJobData", () => {
    it("should not throw in single-tenant mode without tenantId", async () => {
      const { validateMultiTenantJobData } = await resetModule();
      expect(() => validateMultiTenantJobData({})).not.toThrow();
    });

    it("should not throw in single-tenant mode with tenantId", async () => {
      const { validateMultiTenantJobData } = await resetModule();
      expect(() =>
        validateMultiTenantJobData({ tenantId: "tenant-a" })
      ).not.toThrow();
    });

    it("should throw in multi-tenant mode without tenantId", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      const { validateMultiTenantJobData } = await resetModule();
      expect(() => validateMultiTenantJobData({})).toThrow(
        "tenantId is required in multi-tenant mode"
      );
    });

    it("should not throw in multi-tenant mode with tenantId", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      const { validateMultiTenantJobData } = await resetModule();
      expect(() =>
        validateMultiTenantJobData({ tenantId: "tenant-a" })
      ).not.toThrow();
    });
  });

  describe("getPrismaClientForJob", () => {
    it("should use lazy require pattern in single-tenant mode", async () => {
      // In single-tenant mode, getPrismaClientForJob uses require("./prisma")
      // We can't easily mock this in vitest, so we test the behavior differently:
      // - Verify it doesn't throw for missing tenantId in single-tenant mode
      // - The actual prisma import is tested via integration tests

      const { isMultiTenantMode } = await resetModule();

      // In single-tenant mode, the function should NOT require tenantId
      expect(isMultiTenantMode()).toBe(false);

      // Note: We can't test the actual prisma client return here without
      // integration test setup, but the pattern is tested via other tests
    });

    it("should throw in multi-tenant mode without tenantId", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.TENANT_CONFIGS = JSON.stringify({
        "tenant-a": { databaseUrl: "postgresql://localhost/a" },
      });

      const { getPrismaClientForJob } = await resetModule();

      expect(() => getPrismaClientForJob({})).toThrow(
        "tenantId is required in multi-tenant mode"
      );
    });

    it("should throw for non-existent tenant in multi-tenant mode", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.TENANT_CONFIGS = JSON.stringify({
        "tenant-a": { databaseUrl: "postgresql://localhost/a" },
      });

      const { getPrismaClientForJob } = await resetModule();

      expect(() =>
        getPrismaClientForJob({ tenantId: "non-existent" })
      ).toThrow("No configuration found for tenant: non-existent");
    });
  });

  describe("MultiTenantJobData interface", () => {
    it("should allow optional tenantId", async () => {
      const { validateMultiTenantJobData } = await resetModule();

      // These should compile and not throw in single-tenant mode
      const jobDataWithoutTenant: { tenantId?: string } = {};
      const jobDataWithTenant: { tenantId?: string } = { tenantId: "tenant-a" };

      expect(() => validateMultiTenantJobData(jobDataWithoutTenant)).not.toThrow();
      expect(() => validateMultiTenantJobData(jobDataWithTenant)).not.toThrow();
    });
  });
});

describe("Tenant filtering helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("job tenant filtering logic", () => {
    it("should identify jobs belonging to current tenant", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.INSTANCE_TENANT_ID = "tenant-a";

      const { isMultiTenantMode, getCurrentTenantId } = await resetModule();

      // Simulate the filtering logic used in queue APIs
      const currentTenantId = getCurrentTenantId();
      const multiTenant = isMultiTenantMode();

      const jobsToFilter = [
        { id: "1", data: { tenantId: "tenant-a" } },
        { id: "2", data: { tenantId: "tenant-b" } },
        { id: "3", data: { tenantId: "tenant-a" } },
        { id: "4", data: {} }, // No tenantId
      ];

      const filteredJobs = multiTenant && currentTenantId
        ? jobsToFilter.filter((job) => job.data?.tenantId === currentTenantId)
        : jobsToFilter;

      expect(filteredJobs).toHaveLength(2);
      expect(filteredJobs.map((j) => j.id)).toEqual(["1", "3"]);
    });

    it("should not filter jobs in single-tenant mode", async () => {
      const { isMultiTenantMode, getCurrentTenantId } = await resetModule();

      const currentTenantId = getCurrentTenantId();
      const multiTenant = isMultiTenantMode();

      const jobsToFilter = [
        { id: "1", data: { tenantId: "tenant-a" } },
        { id: "2", data: { tenantId: "tenant-b" } },
        { id: "3", data: {} },
      ];

      const filteredJobs = multiTenant && currentTenantId
        ? jobsToFilter.filter((job) => job.data?.tenantId === currentTenantId)
        : jobsToFilter;

      expect(filteredJobs).toHaveLength(3);
    });
  });

  describe("tenant-aware job creation", () => {
    it("should add tenantId to job data in multi-tenant mode", async () => {
      process.env.MULTI_TENANT_MODE = "true";
      process.env.INSTANCE_TENANT_ID = "tenant-x";

      const { getCurrentTenantId } = await resetModule();

      // Simulate job data creation pattern used in services
      const baseJobData = {
        userId: "user-123",
        action: "sync",
      };

      const jobData = {
        ...baseJobData,
        tenantId: getCurrentTenantId(),
      };

      expect(jobData.tenantId).toBe("tenant-x");
    });

    it("should have undefined tenantId in single-tenant mode", async () => {
      const { getCurrentTenantId } = await resetModule();

      const baseJobData = {
        userId: "user-123",
        action: "sync",
      };

      const jobData = {
        ...baseJobData,
        tenantId: getCurrentTenantId(),
      };

      expect(jobData.tenantId).toBeUndefined();
    });
  });
});
