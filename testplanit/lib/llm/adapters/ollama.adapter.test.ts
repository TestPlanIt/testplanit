import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { OllamaAdapter } from "./ollama.adapter";
import type { LlmAdapterConfig, LlmRequest } from "../types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const createTestConfig = (
  overrides: Partial<LlmAdapterConfig> = {}
): LlmAdapterConfig => ({
  integration: {
    id: 1,
    name: "Test Integration",
    provider: "OLLAMA",
    status: "ACTIVE",
    credentials: {},
    settings: { keepAlive: "10m" },
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  config: {
    id: 1,
    llmIntegrationId: 1,
    defaultModel: "llama3",
    availableModels: ["llama3", "mistral", "codellama"],
    maxTokensPerRequest: 4096,
    maxRequestsPerMinute: 60,
    maxRequestsPerDay: null,
    costPerInputToken: new Prisma.Decimal("0"),
    costPerOutputToken: new Prisma.Decimal("0"),
    monthlyBudget: null,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 120000,
    retryAttempts: 3,
    streamingEnabled: false,
    isDefault: false,
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  baseUrl: "http://localhost:11434",
  ...overrides,
});

describe("OllamaAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create adapter with valid config", () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);
      expect(adapter.getProviderName()).toBe("Ollama");
    });

    it("should use default localhost URL when not provided", () => {
      const config = createTestConfig({ baseUrl: undefined });
      const adapter = new OllamaAdapter(config);
      expect(adapter.getProviderName()).toBe("Ollama");
    });

    it("should not require API key (Ollama is local)", () => {
      const config = createTestConfig({ apiKey: undefined });
      const adapter = new OllamaAdapter(config);
      expect(adapter.getProviderName()).toBe("Ollama");
    });
  });

  describe("chat", () => {
    it("should make successful chat request", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "llama3",
          created_at: "2024-01-15T10:00:00Z",
          message: { role: "assistant", content: "Hello! I'm Llama." },
          done: true,
          prompt_eval_count: 10,
          eval_count: 15,
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Hello! I'm Llama.");
      expect(response.model).toBe("llama3");
      expect(response.promptTokens).toBe(10);
      expect(response.completionTokens).toBe(15);
      expect(response.totalTokens).toBe(25);
      expect(response.finishReason).toBe("stop");
    });

    it("should send request to /api/chat endpoint", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "llama3",
          message: { content: "Response" },
          done: true,
          prompt_eval_count: 10,
          eval_count: 10,
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchUrl = mockFetch.mock.calls[0][0];
      expect(fetchUrl).toBe("http://localhost:11434/api/chat");
    });

    it("should include keep_alive setting", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "llama3",
          message: { content: "Response" },
          done: true,
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.keep_alive).toBe("10m");
    });

    it("should handle response field instead of message", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "llama3",
          response: "Direct response text",
          done: true,
          prompt_eval_count: 5,
          eval_count: 10,
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);
      expect(response.content).toBe("Direct response text");
    });

    it("should handle 404 model not found error", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "model 'unknown-model' not found" }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        model: "unknown-model",
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "MODEL_NOT_FOUND",
        statusCode: 404,
      });
    });

    it("should handle server errors", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "Internal server error" }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "SERVER_ERROR",
        statusCode: 500,
        retryable: true,
      });
    });

    it("should set done: false to error finish reason", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "llama3",
          message: { content: "Incomplete" },
          done: false,
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);
      expect(response.finishReason).toBe("error");
    });
  });

  describe("testConnection", () => {
    it("should return true when Ollama is running", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const result = await adapter.testConnection();
      expect(result).toBe(true);
    });

    it("should return false when Ollama is not running", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await adapter.testConnection();
      expect(result).toBe(false);
    });
  });

  describe("getAvailableModels", () => {
    it("should fetch local models from /api/tags", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            {
              name: "llama3:latest",
              modified_at: "2024-01-15T10:00:00Z",
              size: 4700000000,
              digest: "abc123",
              details: {
                format: "gguf",
                family: "llama",
                families: ["llama"],
                parameter_size: "8B",
                quantization_level: "Q4_0",
              },
            },
            {
              name: "mistral:latest",
              modified_at: "2024-01-14T10:00:00Z",
              size: 4100000000,
              digest: "def456",
              details: {
                format: "gguf",
                family: "mistral",
                families: ["mistral"],
                parameter_size: "7B",
                quantization_level: "Q4_0",
              },
            },
          ],
        }),
      });

      const models = await adapter.getAvailableModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe("llama3:latest");
      expect(models[1].id).toBe("mistral:latest");
    });

    it("should return empty array on error", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const models = await adapter.getAvailableModels();

      expect(models).toEqual([]);
      consoleSpy.mockRestore();
    });

    it("should map known models with correct context window", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            {
              name: "mixtral:latest",
              size: 26000000000,
              digest: "xyz",
              details: { parameter_size: "8x7B" },
            },
          ],
        }),
      });

      const models = await adapter.getAvailableModels();

      expect(models[0].contextWindow).toBe(32768);
    });
  });

  describe("isModelAvailable", () => {
    it("should return true for installed model", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "llama3:latest", size: 4700000000, digest: "abc" }],
        }),
      });

      const result = await adapter.isModelAvailable("llama3:latest");
      expect(result).toBe(true);
    });

    it("should return false for uninstalled model", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "llama3:latest", size: 4700000000, digest: "abc" }],
        }),
      });

      const result = await adapter.isModelAvailable("gpt-4");
      expect(result).toBe(false);
    });
  });

  describe("deleteModel", () => {
    it("should delete a model", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(adapter.deleteModel("llama3:latest")).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/delete",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ name: "llama3:latest" }),
        })
      );
    });
  });

  describe("getRateLimitInfo", () => {
    it("should return null (local model has no rate limits)", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      const result = await adapter.getRateLimitInfo();
      expect(result).toBeNull();
    });
  });

  describe("model info mapping", () => {
    it("should format model size correctly", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: "small:latest", size: 1024, digest: "a" },
            { name: "medium:latest", size: 1048576, digest: "b" },
            { name: "large:latest", size: 4700000000, digest: "c" },
          ],
        }),
      });

      const models = await adapter.getAvailableModels();

      expect(models[0].name).toContain("KB");
      expect(models[1].name).toContain("MB");
      expect(models[2].name).toContain("GB");
    });

    it("should set zero cost for local models", async () => {
      const config = createTestConfig();
      const adapter = new OllamaAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "llama3:latest", size: 4700000000, digest: "abc" }],
        }),
      });

      const models = await adapter.getAvailableModels();

      expect(models[0].inputCostPer1k).toBe(0);
      expect(models[0].outputCostPer1k).toBe(0);
    });
  });
});
