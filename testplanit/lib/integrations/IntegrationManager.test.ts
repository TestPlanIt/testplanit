import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IntegrationManager } from "./IntegrationManager";
import { JiraAdapter } from "./adapters/JiraAdapter";
import { GitHubAdapter } from "./adapters/GitHubAdapter";
import { AzureDevOpsAdapter } from "./adapters/AzureDevOpsAdapter";
import { SimpleUrlAdapter } from "./adapters/SimpleUrlAdapter";

// Mock prisma
vi.mock("@/lib/prismaBase", () => ({
  prisma: {
    integration: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock encryption
vi.mock("@/utils/encryption", () => ({
  EncryptionService: {
    decrypt: vi.fn((encrypted: string) => encrypted),
  },
  getMasterKey: vi.fn(() => "test-master-key"),
}));

// Get the mocked prisma
import { prisma } from "@/lib/prismaBase";
import { EncryptionService } from "@/utils/encryption";

const mockPrisma = prisma as unknown as {
  integration: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

describe("IntegrationManager", () => {
  let manager: IntegrationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Get fresh instance and clear any cached state
    manager = IntegrationManager.getInstance();
    manager.clearAllAdapters();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = IntegrationManager.getInstance();
      const instance2 = IntegrationManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("getRegisteredTypes", () => {
    it("should return all registered adapter types", () => {
      const types = manager.getRegisteredTypes();

      expect(types).toContain("JIRA");
      expect(types).toContain("GITHUB");
      expect(types).toContain("AZURE_DEVOPS");
      expect(types).toContain("SIMPLE_URL");
      expect(types).toHaveLength(4);
    });
  });

  describe("isTypeRegistered", () => {
    it("should return true for registered types", () => {
      expect(manager.isTypeRegistered("JIRA")).toBe(true);
      expect(manager.isTypeRegistered("GITHUB")).toBe(true);
      expect(manager.isTypeRegistered("AZURE_DEVOPS")).toBe(true);
      expect(manager.isTypeRegistered("SIMPLE_URL")).toBe(true);
    });

    it("should return false for unregistered types", () => {
      expect(manager.isTypeRegistered("UNKNOWN" as any)).toBe(false);
    });
  });

  describe("registerAdapter", () => {
    it("should register a new adapter type", () => {
      class MockAdapter extends JiraAdapter {}

      // Register with a type that doesn't exist
      manager.registerAdapter("JIRA", MockAdapter);

      expect(manager.isTypeRegistered("JIRA")).toBe(true);
    });
  });

  describe("getAdapter", () => {
    it("should throw error when integration not found", async () => {
      mockPrisma.integration.findUnique.mockResolvedValue(null);

      await expect(manager.getAdapter("999")).rejects.toThrow(
        "Integration not found: 999"
      );
    });

    it("should throw error when integration is not active", async () => {
      mockPrisma.integration.findUnique.mockResolvedValue({
        id: 1,
        provider: "JIRA",
        status: "INACTIVE",
        userIntegrationAuths: [],
      });

      await expect(manager.getAdapter("1")).rejects.toThrow(
        "Integration is not active: 1"
      );
    });

    it("should throw error when no adapter registered for provider", async () => {
      mockPrisma.integration.findUnique.mockResolvedValue({
        id: 1,
        provider: "UNKNOWN_PROVIDER",
        status: "ACTIVE",
        userIntegrationAuths: [],
      });

      await expect(manager.getAdapter("1")).rejects.toThrow(
        "No adapter registered for integration provider: UNKNOWN_PROVIDER"
      );
    });

    it("should create and cache Jira adapter with API key auth", async () => {
      const mockIntegration = {
        id: 1,
        name: "Test Jira",
        provider: "JIRA",
        status: "ACTIVE",
        authType: "API_KEY",
        credentials: {
          email: "test@example.com",
          apiToken: "test-token",
        },
        settings: {
          baseUrl: "https://test.atlassian.net",
        },
        userIntegrationAuths: [],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      // Mock fetch for Jira authentication
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      global.fetch = mockFetch;

      const adapter = await manager.getAdapter("1");

      expect(adapter).toBeInstanceOf(JiraAdapter);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.atlassian.net/rest/api/3/myself",
        expect.any(Object)
      );

      // Should return cached adapter on subsequent calls
      const cachedAdapter = await manager.getAdapter("1");
      expect(cachedAdapter).toBe(adapter);
    });

    it("should create GitHub adapter with PAT auth", async () => {
      const mockIntegration = {
        id: 2,
        name: "Test GitHub",
        provider: "GITHUB",
        status: "ACTIVE",
        authType: "PERSONAL_ACCESS_TOKEN",
        credentials: {
          personalAccessToken: "ghp_test_token",
        },
        settings: {
          repository: "owner/repo",
        },
        userIntegrationAuths: [],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      global.fetch = mockFetch;

      const adapter = await manager.getAdapter("2");

      expect(adapter).toBeInstanceOf(GitHubAdapter);
    });

    it("should create Azure DevOps adapter", async () => {
      const mockIntegration = {
        id: 3,
        name: "Test Azure DevOps",
        provider: "AZURE_DEVOPS",
        status: "ACTIVE",
        authType: "PERSONAL_ACCESS_TOKEN",
        credentials: {
          personalAccessToken: "azure-pat-token",
        },
        settings: {
          organizationUrl: "https://dev.azure.com/testorg",
          project: "TestProject",
        },
        userIntegrationAuths: [],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      });
      global.fetch = mockFetch;

      const adapter = await manager.getAdapter("3");

      expect(adapter).toBeInstanceOf(AzureDevOpsAdapter);
    });

    it("should create adapter with OAuth authentication", async () => {
      // Set up Jira OAuth environment variables
      vi.stubEnv("JIRA_CLIENT_ID", "test-client-id");
      vi.stubEnv("JIRA_CLIENT_SECRET", "test-client-secret");
      vi.stubEnv("JIRA_REDIRECT_URI", "https://app.com/callback");

      const mockIntegration = {
        id: 4,
        name: "Test OAuth Jira",
        provider: "JIRA",
        status: "ACTIVE",
        authType: "OAUTH2",
        credentials: null,
        settings: {},
        userIntegrationAuths: [
          {
            isActive: true,
            accessToken: "encrypted-access-token",
            refreshToken: "encrypted-refresh-token",
            tokenExpiresAt: new Date(Date.now() + 3600000),
            updatedAt: new Date(),
          },
        ],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      // Mock EncryptionService to return decrypted tokens
      vi.mocked(EncryptionService.decrypt).mockReturnValue(
        "decrypted-access-token"
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([{ id: "cloud-123", url: "https://test.atlassian.net" }]),
      });
      global.fetch = mockFetch;

      const adapter = await manager.getAdapter("4");

      expect(adapter).toBeInstanceOf(JiraAdapter);
      expect(EncryptionService.decrypt).toHaveBeenCalled();

      // Clean up env vars
      vi.unstubAllEnvs();
    });

    it("should decrypt encrypted credentials", async () => {
      const mockIntegration = {
        id: 5,
        name: "Test Encrypted",
        provider: "JIRA",
        status: "ACTIVE",
        authType: "API_KEY",
        credentials: {
          encrypted: "encrypted-credentials-string",
        },
        settings: {
          baseUrl: "https://test.atlassian.net",
        },
        userIntegrationAuths: [],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      vi.mocked(EncryptionService.decrypt).mockReturnValue(
        JSON.stringify({
          email: "test@example.com",
          apiToken: "decrypted-token",
        })
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      global.fetch = mockFetch;

      await manager.getAdapter("5");

      expect(EncryptionService.decrypt).toHaveBeenCalledWith(
        "encrypted-credentials-string",
        "test-master-key"
      );
    });
  });

  describe("clearAdapter", () => {
    it("should clear specific adapter from cache", async () => {
      const mockIntegration = {
        id: 1,
        name: "Test Jira",
        provider: "JIRA",
        status: "ACTIVE",
        authType: "API_KEY",
        credentials: {
          email: "test@example.com",
          apiToken: "test-token",
        },
        settings: {
          baseUrl: "https://test.atlassian.net",
        },
        userIntegrationAuths: [],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      global.fetch = mockFetch;

      const adapter1 = await manager.getAdapter("1");
      manager.clearAdapter("1");

      // Next call should create a new adapter
      const adapter2 = await manager.getAdapter("1");
      expect(adapter2).not.toBe(adapter1);
    });
  });

  describe("clearAllAdapters", () => {
    it("should clear all cached adapters", async () => {
      const mockIntegration = {
        id: 1,
        name: "Test Jira",
        provider: "JIRA",
        status: "ACTIVE",
        authType: "API_KEY",
        credentials: {
          email: "test@example.com",
          apiToken: "test-token",
        },
        settings: {
          baseUrl: "https://test.atlassian.net",
        },
        userIntegrationAuths: [],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      global.fetch = mockFetch;

      const adapter1 = await manager.getAdapter("1");
      manager.clearAllAdapters();

      // Next call should create a new adapter
      const adapter2 = await manager.getAdapter("1");
      expect(adapter2).not.toBe(adapter1);
    });
  });

  describe("getCapabilities", () => {
    it("should return adapter capabilities", async () => {
      const mockIntegration = {
        id: 1,
        name: "Test Jira",
        provider: "JIRA",
        status: "ACTIVE",
        authType: "API_KEY",
        credentials: {
          email: "test@example.com",
          apiToken: "test-token",
        },
        settings: {
          baseUrl: "https://test.atlassian.net",
        },
        userIntegrationAuths: [],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      global.fetch = mockFetch;

      const capabilities = await manager.getCapabilities("1");

      expect(capabilities).toEqual({
        createIssue: true,
        updateIssue: true,
        linkIssue: true,
        syncIssue: true,
        searchIssues: true,
        webhooks: true,
        customFields: true,
        attachments: true,
      });
    });

    it("should return null when adapter not found", async () => {
      mockPrisma.integration.findUnique.mockResolvedValue(null);

      await expect(manager.getCapabilities("999")).rejects.toThrow(
        "Integration not found: 999"
      );
    });
  });

  describe("validateIntegration", () => {
    it("should return valid when integration is properly configured", async () => {
      const mockIntegration = {
        id: 1,
        name: "Test Jira",
        provider: "JIRA",
        status: "ACTIVE",
        authType: "API_KEY",
        credentials: {
          email: "test@example.com",
          apiToken: "test-token",
        },
        settings: {
          baseUrl: "https://test.atlassian.net",
        },
        userIntegrationAuths: [],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      global.fetch = mockFetch;

      const result = await manager.validateIntegration("1");

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should return invalid when integration not found", async () => {
      mockPrisma.integration.findUnique.mockResolvedValue(null);

      const result = await manager.validateIntegration("999");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Integration not found: 999");
    });

    it("should return invalid when authentication fails", async () => {
      const mockIntegration = {
        id: 1,
        name: "Test Jira",
        provider: "JIRA",
        status: "ACTIVE",
        authType: "API_KEY",
        credentials: {
          email: "test@example.com",
          apiToken: "invalid-token",
        },
        settings: {
          baseUrl: "https://test.atlassian.net",
        },
        userIntegrationAuths: [],
      };

      mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Unauthorized",
      });
      global.fetch = mockFetch;

      const result = await manager.validateIntegration("1");

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });
});
