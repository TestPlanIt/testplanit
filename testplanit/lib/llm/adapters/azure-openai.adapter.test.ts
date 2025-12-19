import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { AzureOpenAIAdapter } from "./azure-openai.adapter";
import type { LlmAdapterConfig, LlmRequest } from "../types";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const createTestConfig = (
  overrides: Partial<LlmAdapterConfig> = {}
): LlmAdapterConfig => ({
  integration: {
    id: 1,
    name: "Test Azure OpenAI",
    provider: "AZURE_OPENAI",
    status: "ACTIVE",
    credentials: {},
    settings: {
      deploymentName: "gpt-4",
      apiVersion: "2024-02-01",
    },
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  config: {
    id: 1,
    llmIntegrationId: 1,
    defaultModel: "gpt-4",
    availableModels: ["gpt-4"],
    maxTokensPerRequest: 4096,
    maxRequestsPerMinute: 60,
    maxRequestsPerDay: null,
    costPerInputToken: new Prisma.Decimal("0.00003"),
    costPerOutputToken: new Prisma.Decimal("0.00006"),
    monthlyBudget: null,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 30000,
    retryAttempts: 3,
    streamingEnabled: false,
    isDefault: false,
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  apiKey: "test-azure-api-key",
  baseUrl: "https://test-resource.openai.azure.com",
  ...overrides,
});

describe("AzureOpenAIAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create adapter with valid config", () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      expect(adapter.getProviderName()).toBe("Azure OpenAI");
    });

    it("should throw error when Azure endpoint is missing", () => {
      const config = createTestConfig({ baseUrl: "" });

      expect(() => new AzureOpenAIAdapter(config)).toThrow(
        "Azure endpoint and deployment name are required"
      );
    });

    it("should throw error when deployment name is missing", () => {
      const config = createTestConfig();
      config.integration.settings = {};

      expect(() => new AzureOpenAIAdapter(config)).toThrow(
        "Azure endpoint and deployment name are required"
      );
    });

    it("should use default API version when not provided", () => {
      const config = createTestConfig();
      config.integration.settings = { deploymentName: "gpt-4" };

      const adapter = new AzureOpenAIAdapter(config);
      expect(adapter.getProviderName()).toBe("Azure OpenAI");
    });
  });

  describe("getProviderName", () => {
    it("should return Azure OpenAI", () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      expect(adapter.getProviderName()).toBe("Azure OpenAI");
    });
  });

  describe("testConnection", () => {
    it("should return true when connection succeeds", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "test" } }],
        }),
      });

      const result = await adapter.testConnection();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("chat/completions"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "api-key": "test-azure-api-key",
          }),
        })
      );
    });

    it("should return true for 400 error (means endpoint works)", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      const result = await adapter.testConnection();

      expect(result).toBe(true);
    });

    it("should return false when connection fails", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });

    it("should return false for 401 unauthorized", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });
  });

  describe("getAvailableModels", () => {
    it("should return gpt-4 model info for gpt-4 deployment", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      const models = await adapter.getAvailableModels();

      expect(models).toHaveLength(1);
      expect(models[0]).toEqual({
        id: "gpt-4",
        name: "GPT-4 (Azure)",
        contextWindow: 8192,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.03,
        outputCostPer1k: 0.06,
        capabilities: ["text", "code"],
      });
    });

    it("should return gpt-4-turbo model info for gpt-4-turbo deployment", async () => {
      const config = createTestConfig();
      config.integration.settings = {
        deploymentName: "gpt-4-turbo",
        apiVersion: "2024-02-01",
      };
      const adapter = new AzureOpenAIAdapter(config);

      const models = await adapter.getAvailableModels();

      expect(models[0].id).toBe("gpt-4-turbo");
      expect(models[0].name).toBe("GPT-4 Turbo (Azure)");
      expect(models[0].contextWindow).toBe(128000);
      expect(models[0].capabilities).toContain("vision");
    });

    it("should return gpt-4o model info for gpt-4o deployment", async () => {
      const config = createTestConfig();
      config.integration.settings = {
        deploymentName: "gpt-4o",
        apiVersion: "2024-02-01",
      };
      const adapter = new AzureOpenAIAdapter(config);

      const models = await adapter.getAvailableModels();

      expect(models[0].id).toBe("gpt-4o");
      expect(models[0].name).toBe("GPT-4o (Azure)");
      expect(models[0].inputCostPer1k).toBe(0.005);
      expect(models[0].outputCostPer1k).toBe(0.015);
    });

    it("should return gpt-35-turbo model info", async () => {
      const config = createTestConfig();
      config.integration.settings = {
        deploymentName: "gpt-35-turbo",
        apiVersion: "2024-02-01",
      };
      const adapter = new AzureOpenAIAdapter(config);

      const models = await adapter.getAvailableModels();

      expect(models[0].id).toBe("gpt-35-turbo");
      expect(models[0].name).toBe("GPT-3.5 Turbo (Azure)");
      expect(models[0].contextWindow).toBe(4096);
    });

    it("should return gpt-35-turbo-16k model info", async () => {
      const config = createTestConfig();
      config.integration.settings = {
        deploymentName: "gpt-35-turbo-16k",
        apiVersion: "2024-02-01",
      };
      const adapter = new AzureOpenAIAdapter(config);

      const models = await adapter.getAvailableModels();

      expect(models[0].id).toBe("gpt-35-turbo-16k");
      expect(models[0].name).toBe("GPT-3.5 Turbo 16K (Azure)");
      expect(models[0].contextWindow).toBe(16384);
    });

    it("should return default info for unknown deployment", async () => {
      const config = createTestConfig();
      config.integration.settings = {
        deploymentName: "custom-deployment",
        apiVersion: "2024-02-01",
      };
      const adapter = new AzureOpenAIAdapter(config);

      const models = await adapter.getAvailableModels();

      expect(models[0].id).toBe("custom-deployment");
      expect(models[0].name).toBe("custom-deployment (Azure)");
      expect(models[0].contextWindow).toBe(4096);
      expect(models[0].capabilities).toEqual(["text"]);
    });
  });

  describe("chat", () => {
    it("should make successful chat request with Azure headers", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          model: "gpt-4",
          choices: [
            {
              message: { role: "assistant", content: "Azure response" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Azure response");

      // Verify Azure-specific headers
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers["api-key"]).toBe("test-azure-api-key");
      expect(fetchCall[1].headers["Authorization"]).toBeUndefined();
    });

    it("should include api-version in URL", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "gpt-4",
          choices: [
            {
              message: { content: "Response" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain("api-version=2024-02-01");
    });

    it("should handle Azure-specific error format", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            code: "401",
            message: "Access denied due to invalid subscription key",
          },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "AUTHENTICATION_ERROR",
        statusCode: 401,
      });
    });

    it("should use correct deployment URL", async () => {
      const config = createTestConfig();
      config.integration.settings = {
        deploymentName: "my-gpt4-deployment",
        apiVersion: "2024-02-01",
      };
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "gpt-4",
          choices: [
            {
              message: { content: "Response" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain(
        "https://test-resource.openai.azure.com/openai/deployments/my-gpt4-deployment"
      );
    });
  });

  describe("error extraction", () => {
    it("should extract message from Azure error format", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            message: "The request is invalid",
            type: "invalid_request_error",
          },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toThrow(
        "The request is invalid"
      );
    });

    it("should handle nested error message", async () => {
      const config = createTestConfig();
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          message: "Internal server error",
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "SERVER_ERROR",
      });
    });
  });

  describe("API version handling", () => {
    it("should use custom API version when provided", async () => {
      const config = createTestConfig();
      config.integration.settings = {
        deploymentName: "gpt-4",
        apiVersion: "2023-12-01-preview",
      };
      const adapter = new AzureOpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "test" } }] }),
      });

      await adapter.testConnection();

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain("api-version=2023-12-01-preview");
    });
  });

  describe("resource name extraction", () => {
    it("should extract resource name from Azure endpoint", () => {
      const config = createTestConfig();
      config.baseUrl = "https://my-custom-resource.openai.azure.com";

      const adapter = new AzureOpenAIAdapter(config);

      // The adapter should work with the resource name extracted from the URL
      expect(adapter.getProviderName()).toBe("Azure OpenAI");
    });
  });
});
