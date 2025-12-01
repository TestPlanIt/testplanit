import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { CustomLlmAdapter } from "./custom.adapter";
import type { LlmAdapterConfig, LlmRequest } from "../types";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const createTestConfig = (
  overrides: Partial<LlmAdapterConfig> = {},
  settingsOverrides: Record<string, unknown> = {}
): LlmAdapterConfig => ({
  integration: {
    id: 1,
    name: "Test Custom LLM",
    provider: "CUSTOM",
    status: "ACTIVE",
    credentials: {},
    settings: {
      endpoint: "https://custom-llm.example.com/v1/chat",
      apiKey: "test-api-key",
      ...settingsOverrides,
    },
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  config: {
    id: 1,
    llmIntegrationId: 1,
    defaultModel: "custom-model",
    availableModels: ["custom-model", "custom-model-v2"],
    maxTokensPerRequest: 4096,
    maxRequestsPerMinute: 60,
    maxRequestsPerDay: null,
    costPerInputToken: new Prisma.Decimal("0.00001"),
    costPerOutputToken: new Prisma.Decimal("0.00002"),
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
  apiKey: "test-api-key",
  baseUrl: "https://custom-llm.example.com/v1/chat",
  ...overrides,
});

describe("CustomLlmAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create adapter with valid config", () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      expect(adapter.getProviderName()).toBe("Test Custom LLM");
    });

    it("should throw error when endpoint is missing", () => {
      const config = createTestConfig(
        { baseUrl: undefined },
        { endpoint: undefined }
      );

      expect(() => new CustomLlmAdapter(config)).toThrow(
        "Custom API endpoint is required"
      );
    });

    it("should use baseUrl when settings endpoint is not provided", () => {
      const config = createTestConfig(
        { baseUrl: "https://api.example.com/chat" },
        { endpoint: undefined }
      );
      const adapter = new CustomLlmAdapter(config);

      expect(adapter.getProviderName()).toBe("Test Custom LLM");
    });

    it("should use settings endpoint over baseUrl", () => {
      const config = createTestConfig(
        { baseUrl: "https://base-url.example.com" },
        { endpoint: "https://settings-endpoint.example.com" }
      );
      const adapter = new CustomLlmAdapter(config);

      expect(adapter.getProviderName()).toBe("Test Custom LLM");
    });

    it("should use integration name as provider name", () => {
      const config = createTestConfig();
      config.integration.name = "My Custom Provider";
      const adapter = new CustomLlmAdapter(config);

      expect(adapter.getProviderName()).toBe("My Custom Provider");
    });

    it("should default to 'Custom LLM' when integration name is empty", () => {
      const config = createTestConfig();
      config.integration.name = "";
      const adapter = new CustomLlmAdapter(config);

      expect(adapter.getProviderName()).toBe("Custom LLM");
    });
  });

  describe("chat", () => {
    it("should make successful chat request with OpenAI-style response", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "custom-model",
          choices: [
            {
              message: { content: "Hello from custom LLM!" },
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

      expect(response.content).toBe("Hello from custom LLM!");
      expect(response.model).toBe("custom-model");
      expect(response.promptTokens).toBe(10);
      expect(response.completionTokens).toBe(20);
      expect(response.totalTokens).toBe(30);
      expect(response.finishReason).toBe("stop");
    });

    it("should handle simple content response format", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: "Simple response",
          usage: {
            input_tokens: 5,
            output_tokens: 10,
          },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Simple response");
      expect(response.promptTokens).toBe(5);
      expect(response.completionTokens).toBe(10);
    });

    it("should handle text response format", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: "Text response",
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Text response");
    });

    it("should handle response format with 'response' field", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: "Response field content",
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Response field content");
    });

    it("should use custom response mapping", async () => {
      const config = createTestConfig({}, {
        responseMapping: {
          content: "data.generated_text",
          promptTokens: "stats.input",
          completionTokens: "stats.output",
        },
      });
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { generated_text: "Mapped content" },
          stats: { input: 15, output: 25 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Mapped content");
      expect(response.promptTokens).toBe(15);
      expect(response.completionTokens).toBe(25);
    });

    it("should apply request field mappings", async () => {
      const config = createTestConfig({}, {
        requestFieldMappings: {
          max_tokens: "maxOutputTokens",
          temperature: "temp",
        },
      });
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: "Response",
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 500,
        temperature: 0.5,
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.maxOutputTokens).toBe(500);
      expect(body.temp).toBe(0.5);
    });

    it("should include custom headers from settings", async () => {
      const config = createTestConfig({}, {
        headers: {
          "X-Custom-Header": "custom-value",
          "X-Another-Header": "another-value",
        },
      });
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: "Response" }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers["X-Custom-Header"]).toBe("custom-value");
      expect(fetchCall[1].headers["X-Another-Header"]).toBe("another-value");
    });

    it("should use custom auth header and prefix", async () => {
      const config = createTestConfig({}, {
        authHeader: "X-API-Key",
        authPrefix: "Token",
      });
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: "Response" }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers["X-API-Key"]).toBe("Token test-api-key");
    });

    it("should handle 401 authentication error", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: { message: "Invalid API key" },
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

    it("should handle 429 rate limit error with retry-after header", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({
          "content-type": "application/json",
          "retry-after": "60",
        }),
        json: async () => ({
          error: { message: "Rate limit exceeded" },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429,
        retryable: true,
        details: { retryAfter: 60 },
      });
    });

    it("should handle 500 server error", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: "Internal server error",
        }),
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

    it("should handle 400 bad request error", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          message: "Invalid request format",
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        statusCode: 400,
      });
    });

    it("should handle 403 permission denied error", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: { message: "Access forbidden" },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        statusCode: 403,
      });
    });

    it("should handle 404 not found error", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          message: "Model not found",
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });

    it("should handle 502 bad gateway error", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "SERVER_ERROR",
        statusCode: 502,
        retryable: true,
      });
    });

    it("should handle 503 service unavailable error", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "SERVER_ERROR",
        statusCode: 503,
        retryable: true,
      });
    });

    it("should handle text/plain error response", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "Plain text error message",
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "SERVER_ERROR",
        message: "Plain text error message",
      });
    });

    it("should use custom error message path", async () => {
      const config = createTestConfig({}, {
        errorMessagePath: "errors.details.message",
      });
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          errors: {
            details: {
              message: "Custom error path message",
            },
          },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        message: "Custom error path message",
      });
    });

    it("should validate empty messages array", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      const request: LlmRequest = {
        messages: [],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toThrow(
        "Messages array cannot be empty"
      );
    });

    it("should handle timeout error", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "TIMEOUT",
        statusCode: 408,
        retryable: true,
      });
    });

    it("should apply request template", async () => {
      const config = createTestConfig({}, {
        requestTemplate: {
          custom_field: "custom_value",
          another_field: 123,
        },
      });
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: "Response" }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.custom_field).toBe("custom_value");
      expect(body.another_field).toBe(123);
    });
  });

  describe("chatStream", () => {
    it("should handle SSE stream response", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"delta":{"content":"Hello"}}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"delta":{"content":" World"}}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: [DONE]\n\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: { getReader: () => mockReader },
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const chunks: string[] = [];
      for await (const chunk of adapter.chatStream(request)) {
        if (chunk.delta) {
          chunks.push(chunk.delta);
        }
      }

      expect(chunks).toEqual(["Hello", " World"]);
      expect(mockReader.releaseLock).toHaveBeenCalled();
    });

    it("should handle NDJSON stream response", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"content":"Part 1"}\n{"content":"Part 2"}\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        body: { getReader: () => mockReader },
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const chunks: string[] = [];
      for await (const chunk of adapter.chatStream(request)) {
        if (chunk.delta) {
          chunks.push(chunk.delta);
        }
      }

      expect(chunks).toEqual(["Part 1", "Part 2"]);
    });

    it("should handle stream with OpenAI format delta", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"OpenAI style"}}]}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: [DONE]\n\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: { getReader: () => mockReader },
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const chunks: string[] = [];
      for await (const chunk of adapter.chatStream(request)) {
        if (chunk.delta) {
          chunks.push(chunk.delta);
        }
      }

      expect(chunks).toEqual(["OpenAI style"]);
    });

    it("should use custom stream response mapping", async () => {
      const config = createTestConfig({}, {
        streamResponseMapping: {
          delta: "generated.text",
        },
      });
      const adapter = new CustomLlmAdapter(config);

      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"generated":{"text":"Custom mapped"}}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: [DONE]\n\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: { getReader: () => mockReader },
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const chunks: string[] = [];
      for await (const chunk of adapter.chatStream(request)) {
        if (chunk.delta) {
          chunks.push(chunk.delta);
        }
      }

      expect(chunks).toEqual(["Custom mapped"]);
    });

    it("should throw error when response body is missing", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: null,
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const generator = adapter.chatStream(request);
      await expect(generator.next()).rejects.toMatchObject({
        code: "STREAM_ERROR",
        statusCode: 500,
      });
    });

    it("should handle stream error response", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "Stream error" }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const generator = adapter.chatStream(request);
      await expect(generator.next()).rejects.toMatchObject({
        code: "SERVER_ERROR",
        statusCode: 500,
      });
    });

    it("should skip invalid JSON in stream", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: invalid json\n\ndata: {"delta":{"content":"Valid"}}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: [DONE]\n\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: { getReader: () => mockReader },
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const chunks: string[] = [];
      for await (const chunk of adapter.chatStream(request)) {
        if (chunk.delta) {
          chunks.push(chunk.delta);
        }
      }

      expect(chunks).toEqual(["Valid"]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getAvailableModels", () => {
    it("should return configured models when no models endpoint", async () => {
      const config = createTestConfig({}, {
        models: [
          { id: "model-1", name: "Model One", contextWindow: 8192 },
          { id: "model-2", name: "Model Two", maxOutputTokens: 2048 },
        ],
      });
      const adapter = new CustomLlmAdapter(config);

      const models = await adapter.getAvailableModels();

      expect(models.length).toBe(2);
      expect(models[0].id).toBe("model-1");
      expect(models[0].name).toBe("Model One");
      expect(models[0].contextWindow).toBe(8192);
      expect(models[1].id).toBe("model-2");
      expect(models[1].maxOutputTokens).toBe(2048);
    });

    it("should fetch models from endpoint when provided", async () => {
      const config = createTestConfig({}, {
        modelsEndpoint: "https://api.example.com/models",
        modelsResponsePath: "data.models",
      });
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            models: [
              { id: "remote-model-1", name: "Remote Model 1" },
              { id: "remote-model-2", name: "Remote Model 2" },
            ],
          },
        }),
      });

      const models = await adapter.getAvailableModels();

      expect(models.length).toBe(2);
      expect(models[0].id).toBe("remote-model-1");
      expect(models[1].id).toBe("remote-model-2");
    });

    it("should use custom model field mappings", async () => {
      const config = createTestConfig({}, {
        modelsEndpoint: "https://api.example.com/models",
        modelFieldMappings: {
          id: "model_id",
          name: "display_name",
          contextWindow: "context_length",
          maxOutputTokens: "max_output",
        },
      });
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            {
              model_id: "mapped-id",
              display_name: "Mapped Name",
              context_length: 16384,
              max_output: 4096,
            },
          ],
        }),
      });

      const models = await adapter.getAvailableModels();

      expect(models[0].id).toBe("mapped-id");
      expect(models[0].name).toBe("Mapped Name");
      expect(models[0].contextWindow).toBe(16384);
      expect(models[0].maxOutputTokens).toBe(4096);
    });

    it("should fall back to configured models on fetch error", async () => {
      const config = createTestConfig({}, {
        modelsEndpoint: "https://api.example.com/models",
        models: [{ id: "fallback-model", name: "Fallback" }],
      });
      const adapter = new CustomLlmAdapter(config);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const models = await adapter.getAvailableModels();

      expect(models.length).toBe(1);
      expect(models[0].id).toBe("fallback-model");
      consoleSpy.mockRestore();
    });

    it("should handle models endpoint error response", async () => {
      const config = createTestConfig({}, {
        modelsEndpoint: "https://api.example.com/models",
        models: [{ id: "fallback-model", name: "Fallback" }],
      });
      const adapter = new CustomLlmAdapter(config);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const models = await adapter.getAvailableModels();

      expect(models.length).toBe(1);
      expect(models[0].id).toBe("fallback-model");
      consoleSpy.mockRestore();
    });

    it("should return empty array when no models configured and endpoint fails", async () => {
      const config = createTestConfig({}, {
        modelsEndpoint: "https://api.example.com/models",
      });
      const adapter = new CustomLlmAdapter(config);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const models = await adapter.getAvailableModels();

      expect(models).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe("isModelAvailable", () => {
    it("should return true for available model", async () => {
      const config = createTestConfig({}, {
        models: [{ id: "test-model", name: "Test" }],
      });
      const adapter = new CustomLlmAdapter(config);

      const result = await adapter.isModelAvailable("test-model");

      expect(result).toBe(true);
    });

    it("should return false for unavailable model", async () => {
      const config = createTestConfig({}, {
        models: [{ id: "test-model", name: "Test" }],
      });
      const adapter = new CustomLlmAdapter(config);

      const result = await adapter.isModelAvailable("nonexistent-model");

      expect(result).toBe(false);
    });
  });

  describe("getRateLimitInfo", () => {
    it("should return null (not implemented)", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      const result = await adapter.getRateLimitInfo();

      expect(result).toBeNull();
    });
  });

  describe("testConnection", () => {
    it("should return true when connection is successful (200)", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        status: 200,
      });

      const result = await adapter.testConnection();

      expect(result).toBe(true);
    });

    it("should return true when connection returns 400 (means API is reachable)", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        status: 400,
      });

      const result = await adapter.testConnection();

      expect(result).toBe(true);
    });

    it("should return false when connection fails", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        status: 500,
      });

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });

    it("should return false when fetch throws", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });
  });

  describe("extractErrorMessage", () => {
    it("should extract error from nested error.message", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: { message: "Nested error message" },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        message: "Nested error message",
      });
    });

    it("should extract error from top-level message", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          message: "Top level message",
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        message: "Top level message",
      });
    });

    it("should extract error from string error field", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: "String error",
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        message: "String error",
      });
    });

    it("should return default message for unknown error format", async () => {
      const config = createTestConfig();
      const adapter = new CustomLlmAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        message: "Unknown custom API error",
      });
    });
  });
});
