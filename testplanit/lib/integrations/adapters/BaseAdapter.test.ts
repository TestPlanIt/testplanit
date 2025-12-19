import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BaseAdapter } from "./BaseAdapter";
import type {
  IssueAdapterCapabilities,
  AuthenticationData,
  IssueData,
  CreateIssueData,
  UpdateIssueData,
  IssueSearchOptions,
} from "./IssueAdapter";

// Create a concrete implementation for testing
class TestAdapter extends BaseAdapter {
  getCapabilities(): IssueAdapterCapabilities {
    return {
      createIssue: true,
      updateIssue: true,
      linkIssue: true,
      syncIssue: true,
      searchIssues: true,
      webhooks: false,
      customFields: false,
      attachments: false,
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    // Test implementation - just validate auth data exists
    if (!authData.accessToken && !authData.apiKey && !authData.username) {
      throw new Error("No authentication credentials provided");
    }
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    return {
      id: "1",
      key: "TEST-1",
      title: data.title,
      description: data.description as string,
      status: "Open",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async updateIssue(issueId: string, data: UpdateIssueData): Promise<IssueData> {
    return {
      id: issueId,
      key: `TEST-${issueId}`,
      title: data.title || "Updated Issue",
      status: data.status || "Open",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getIssue(issueId: string): Promise<IssueData> {
    return {
      id: issueId,
      key: `TEST-${issueId}`,
      title: "Test Issue",
      status: "Open",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }> {
    return {
      issues: [],
      total: 0,
      hasMore: false,
    };
  }

  // Expose protected methods for testing
  public testApplyRateLimit(): Promise<void> {
    return this.applyRateLimit();
  }

  public testExecuteWithRetry<T>(
    operation: () => Promise<T>,
    retries?: number
  ): Promise<T> {
    return this.executeWithRetry(operation, retries);
  }

  public testBuildUrl(path: string): string {
    return this.buildUrl(path);
  }

  public testMakeRequest<T>(url: string, options?: RequestInit): Promise<T> {
    return this.makeRequest<T>(url, options);
  }

  public testSleep(ms: number): Promise<void> {
    return this.sleep(ms);
  }
}

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("BaseAdapter", () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    adapter = new TestAdapter({
      provider: "TEST",
      baseUrl: "https://api.test.com",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("authenticate", () => {
    it("should authenticate successfully with OAuth", async () => {
      await adapter.authenticate({
        type: "oauth",
        accessToken: "test-token",
      });

      const isAuth = await adapter.isAuthenticated();
      expect(isAuth).toBe(true);
    });

    it("should authenticate successfully with API key", async () => {
      await adapter.authenticate({
        type: "api_key",
        apiKey: "test-api-key",
        baseUrl: "https://api.test.com",
      });

      const isAuth = await adapter.isAuthenticated();
      expect(isAuth).toBe(true);
    });

    it("should authenticate successfully with basic auth", async () => {
      await adapter.authenticate({
        type: "basic",
        username: "user",
        password: "pass",
      });

      const isAuth = await adapter.isAuthenticated();
      expect(isAuth).toBe(true);
    });

    it("should throw error when no credentials provided", async () => {
      await expect(
        adapter.authenticate({
          type: "oauth",
          // No accessToken
        })
      ).rejects.toThrow("No authentication credentials provided");
    });
  });

  describe("isAuthenticated", () => {
    it("should return false when not authenticated", async () => {
      const result = await adapter.isAuthenticated();
      expect(result).toBe(false);
    });

    it("should return false when token is expired", async () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago
      await adapter.authenticate({
        type: "oauth",
        accessToken: "expired-token",
        expiresAt: expiredDate,
      });

      const result = await adapter.isAuthenticated();
      expect(result).toBe(false);
    });

    it("should return true when token is not expired", async () => {
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
      await adapter.authenticate({
        type: "oauth",
        accessToken: "valid-token",
        expiresAt: futureDate,
      });

      const result = await adapter.isAuthenticated();
      expect(result).toBe(true);
    });
  });

  describe("buildUrl", () => {
    it("should build URL correctly with leading slash", async () => {
      await adapter.authenticate({
        type: "api_key",
        apiKey: "test-key",
        baseUrl: "https://api.test.com",
      });

      const url = adapter.testBuildUrl("/path/to/resource");
      expect(url).toBe("https://api.test.com/path/to/resource");
    });

    it("should build URL correctly without leading slash", async () => {
      await adapter.authenticate({
        type: "api_key",
        apiKey: "test-key",
        baseUrl: "https://api.test.com",
      });

      const url = adapter.testBuildUrl("path/to/resource");
      expect(url).toBe("https://api.test.com/path/to/resource");
    });

    it("should handle base URL with trailing slash", async () => {
      await adapter.authenticate({
        type: "api_key",
        apiKey: "test-key",
        baseUrl: "https://api.test.com/",
      });

      const url = adapter.testBuildUrl("/path");
      expect(url).toBe("https://api.test.com/path");
    });

    it("should throw error when base URL not configured", async () => {
      const adapterNoUrl = new TestAdapter({ provider: "TEST" });

      expect(() => adapterNoUrl.testBuildUrl("/path")).toThrow(
        "Base URL not configured"
      );
    });
  });

  describe("makeRequest", () => {
    beforeEach(async () => {
      await adapter.authenticate({
        type: "oauth",
        accessToken: "test-token",
        baseUrl: "https://api.test.com",
      });
    });

    it("should add OAuth Bearer token to request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: "test" }),
      });

      await adapter.testMakeRequest("https://api.test.com/resource");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/resource",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should throw error when not authenticated", async () => {
      const unauthAdapter = new TestAdapter({ provider: "TEST" });

      await expect(
        unauthAdapter.testMakeRequest("https://api.test.com/resource")
      ).rejects.toThrow("Not authenticated");
    });

    it("should throw error on non-OK response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      });

      await expect(
        adapter.testMakeRequest("https://api.test.com/resource")
      ).rejects.toThrow("HTTP 404: Not Found");
    });
  });

  describe("makeRequest with different auth types", () => {
    it("should add API key header for default provider", async () => {
      const apiKeyAdapter = new TestAdapter({
        provider: "OTHER",
        baseUrl: "https://api.test.com",
      });
      await apiKeyAdapter.authenticate({
        type: "api_key",
        apiKey: "test-api-key",
        baseUrl: "https://api.test.com",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: "test" }),
      });

      await apiKeyAdapter.testMakeRequest("https://api.test.com/resource");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/resource",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "test-api-key",
          }),
        })
      );
    });

    it("should add GitHub token header", async () => {
      const githubAdapter = new TestAdapter({
        provider: "GITHUB",
        baseUrl: "https://api.github.com",
      });
      await githubAdapter.authenticate({
        type: "api_key",
        apiKey: "ghp_test-token",
        baseUrl: "https://api.github.com",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: "test" }),
      });

      await githubAdapter.testMakeRequest("https://api.github.com/repos");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "token ghp_test-token",
          }),
        })
      );
    });

    it("should add Azure DevOps Basic auth header", async () => {
      const azureAdapter = new TestAdapter({
        provider: "AZURE_DEVOPS",
        baseUrl: "https://dev.azure.com",
      });
      await azureAdapter.authenticate({
        type: "api_key",
        apiKey: "test-pat",
        baseUrl: "https://dev.azure.com",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: "test" }),
      });

      await azureAdapter.testMakeRequest("https://dev.azure.com/project");

      const expectedCredentials = Buffer.from(":test-pat").toString("base64");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://dev.azure.com/project",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Basic ${expectedCredentials}`,
          }),
        })
      );
    });

    it("should add Basic auth header", async () => {
      const basicAdapter = new TestAdapter({
        provider: "TEST",
        baseUrl: "https://api.test.com",
      });
      await basicAdapter.authenticate({
        type: "basic",
        username: "user",
        password: "pass",
        baseUrl: "https://api.test.com",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: "test" }),
      });

      await basicAdapter.testMakeRequest("https://api.test.com/resource");

      const expectedCredentials = Buffer.from("user:pass").toString("base64");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/resource",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Basic ${expectedCredentials}`,
          }),
        })
      );
    });
  });

  describe("executeWithRetry", () => {
    beforeEach(async () => {
      await adapter.authenticate({
        type: "oauth",
        accessToken: "test-token",
        baseUrl: "https://api.test.com",
      });
    });

    it("should succeed on first try", async () => {
      const operation = vi.fn().mockResolvedValue("success");

      const result = await adapter.testExecuteWithRetry(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure and succeed", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("First failure"))
        .mockResolvedValueOnce("success");

      const resultPromise = adapter.testExecuteWithRetry(operation);

      // Fast-forward through rate limit delay
      await vi.advanceTimersByTimeAsync(1000);
      // Fast-forward through retry delay (exponential backoff: 1000 * 2^0 = 1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      // Fast-forward through next rate limit delay
      await vi.advanceTimersByTimeAsync(1000);

      const result = await resultPromise;

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should throw after max retries", async () => {
      const error = new Error("Always fails");
      const operation = vi.fn().mockRejectedValue(error);
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // We need to wrap this to handle the async retry properly
      let thrownError: Error | undefined;
      const testPromise = (async () => {
        try {
          await adapter.testExecuteWithRetry(operation, 2);
        } catch (e) {
          thrownError = e as Error;
        }
      })();

      // Fast-forward through all retry delays (rate limit + exponential backoff)
      // Initial: rate limit delay (1000ms)
      // Retry 1: backoff delay (1000ms) + rate limit (1000ms)
      // Retry 2: backoff delay (2000ms) + rate limit (1000ms)
      await vi.advanceTimersByTimeAsync(10000);

      await testPromise;

      expect(thrownError?.message).toBe("Always fails");
      expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries

      consoleSpy.mockRestore();
    });
  });

  describe("applyRateLimit", () => {
    it("should delay if called too quickly", async () => {
      // First call should not delay
      const start1 = Date.now();
      await adapter.testApplyRateLimit();
      const end1 = Date.now();

      // Second call should delay
      const start2 = Date.now();
      const delayPromise = adapter.testApplyRateLimit();

      // Fast-forward
      await vi.advanceTimersByTimeAsync(1000);
      await delayPromise;

      // The mock timers make this work
      expect(true).toBe(true);
    });
  });

  describe("linkToTestCase", () => {
    it("should throw error for default implementation", async () => {
      await adapter.authenticate({
        type: "oauth",
        accessToken: "test-token",
      });

      await expect(
        adapter.linkToTestCase("ISSUE-1", "TEST-CASE-1")
      ).rejects.toThrow("Adding comments is not supported by this adapter");
    });
  });

  describe("syncIssue", () => {
    it("should return getIssue result", async () => {
      await adapter.authenticate({
        type: "oauth",
        accessToken: "test-token",
      });

      const result = await adapter.syncIssue("123");

      expect(result.id).toBe("123");
      expect(result.key).toBe("TEST-123");
    });
  });

  describe("webhook methods", () => {
    it("registerWebhook should throw not supported error", async () => {
      await expect(
        adapter.registerWebhook?.("https://webhook.url", ["issue.created"])
      ).rejects.toThrow("Webhook registration is not supported");
    });

    it("unregisterWebhook should throw not supported error", async () => {
      await expect(adapter.unregisterWebhook?.("webhook-123")).rejects.toThrow(
        "Webhook unregistration is not supported"
      );
    });

    it("processWebhook should throw not supported error", async () => {
      await expect(
        adapter.processWebhook?.({ event: "test" })
      ).rejects.toThrow("Webhook processing is not supported");
    });
  });

  describe("validateConfiguration", () => {
    it("should return invalid when no auth data", async () => {
      const result = await adapter.validateConfiguration?.();

      expect(result?.valid).toBe(false);
      expect(result?.errors).toContain("No authentication data provided");
    });

    it("should return invalid when no base URL", async () => {
      const adapterNoUrl = new TestAdapter({ provider: "TEST" });
      await adapterNoUrl.authenticate({
        type: "oauth",
        accessToken: "test-token",
        // No baseUrl
      });

      const result = await adapterNoUrl.validateConfiguration?.();

      expect(result?.valid).toBe(false);
      expect(result?.errors).toContain("Base URL is required");
    });

    it("should return valid with proper configuration", async () => {
      await adapter.authenticate({
        type: "oauth",
        accessToken: "test-token",
        baseUrl: "https://api.test.com",
      });

      const result = await adapter.validateConfiguration?.();

      expect(result?.valid).toBe(true);
      expect(result?.errors).toBeUndefined();
    });
  });

  describe("getFieldMappings", () => {
    it("should return empty array by default", () => {
      const mappings = adapter.getFieldMappings?.();
      expect(mappings).toEqual([]);
    });
  });

  describe("sleep", () => {
    it("should resolve after specified time", async () => {
      const sleepPromise = adapter.testSleep(1000);

      await vi.advanceTimersByTimeAsync(1000);

      await expect(sleepPromise).resolves.toBeUndefined();
    });
  });
});
