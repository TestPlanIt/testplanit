import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmAdapterConfig, LlmRequest } from "../types";
import { OpenAIAdapter } from "./openai.adapter";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const createTestConfig = (
  overrides: Partial<LlmAdapterConfig> = {}
): LlmAdapterConfig => ({
  integration: {
    id: 1,
    name: "Test Integration",
    provider: "OPENAI",
    status: "ACTIVE",
    credentials: {},
    settings: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  config: {
    id: 1,
    llmIntegrationId: 1,
    defaultModel: "gpt-4",
    availableModels: ["gpt-4", "gpt-3.5-turbo"],
    maxTokensPerRequest: 4096,
    maxRequestsPerMinute: 60,
    maxRequestsPerDay: null,
    costPerInputToken: new Decimal("0.00003"),
    costPerOutputToken: new Decimal("0.00006"),
    monthlyBudget: null,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 30000,
    retryAttempts: 3,
    streamingEnabled: false,
    isDefault: false,
    settings: null,
    alertThresholdsFired: null,
    billingPeriodStartDay: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  apiKey: "test-api-key",
  baseUrl: "https://api.openai.com/v1",
  ...overrides,
});

describe("OpenAIAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create adapter with valid config", () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      expect(adapter.getProviderName()).toBe("OpenAI");
    });

    it("should throw error when API key is missing", () => {
      const config = createTestConfig({ apiKey: "" });

      expect(() => new OpenAIAdapter(config)).toThrow(
        "OpenAI API key is required"
      );
    });

    it("should throw error when API key is undefined", () => {
      const config = createTestConfig({ apiKey: undefined });

      expect(() => new OpenAIAdapter(config)).toThrow(
        "OpenAI API key is required"
      );
    });

    it("should use default base URL when not provided", () => {
      const config = createTestConfig({ baseUrl: undefined });
      const adapter = new OpenAIAdapter(config);

      // Adapter should be created successfully with default URL
      expect(adapter.getProviderName()).toBe("OpenAI");
    });
  });

  describe("chat", () => {
    it("should make successful chat request", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          object: "chat.completion",
          created: 1234567890,
          model: "gpt-4",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hello! How can I help?" },
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

      expect(response.content).toBe("Hello! How can I help?");
      expect(response.model).toBe("gpt-4");
      expect(response.promptTokens).toBe(10);
      expect(response.completionTokens).toBe(20);
      expect(response.totalTokens).toBe(30);
      expect(response.finishReason).toBe("stop");

      // Verify the fetch call
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
          }),
        })
      );
    });

    it("should use custom model when provided", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "gpt-3.5-turbo",
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
        model: "gpt-3.5-turbo",
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe("gpt-3.5-turbo");
    });

    it("should handle 401 authentication error", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

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

    it("should handle 429 rate limit error", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

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
      });
    });

    it("should handle 500 server error", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: { message: "Internal server error" },
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

    it("should validate empty messages array", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      const request: LlmRequest = {
        messages: [],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toThrow(
        "Messages array cannot be empty"
      );
    });
  });

  describe("temperature rejection handling", () => {
    const liteLlmRejection = () => ({
      ok: false,
      status: 400,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        error: {
          message:
            "litellm.UnsupportedParamsError: us.anthropic.claude-opus-5 does not support temperature=0.7. Only temperature=1 is supported. To drop unsupported params, set `litellm.drop_params = True`.",
          type: "invalid_request_error",
          code: "400",
        },
      }),
    });

    const okCompletion = (text: string) => ({
      ok: true,
      json: async () => ({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "claude-opus-5",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });

    it("retries without temperature when the proxy rejects it, then remembers the model", async () => {
      const adapter = new OpenAIAdapter(createTestConfig());

      mockFetch.mockResolvedValueOnce(liteLlmRejection());
      mockFetch.mockResolvedValueOnce(okCompletion("first"));

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        model: "claude-opus-5-via-openai",
        userId: "user-123",
        feature: "test",
      };

      const first = await adapter.chat(request);
      expect(first.content).toBe("first");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body).temperature).toBe(0.7);
      expect(
        JSON.parse(mockFetch.mock.calls[1][1].body).temperature
      ).toBeUndefined();

      // A fresh adapter for the same provider+model skips the param outright
      mockFetch.mockResolvedValueOnce(okCompletion("second"));
      const second = await new OpenAIAdapter(createTestConfig()).chat(request);
      expect(second.content).toBe("second");
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(
        JSON.parse(mockFetch.mock.calls[2][1].body).temperature
      ).toBeUndefined();
    });

    it("does not retry other 400s", async () => {
      const adapter = new OpenAIAdapter(createTestConfig());

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: { message: "Invalid model specified" } }),
      });

      await expect(
        adapter.chat({
          messages: [{ role: "user", content: "Hello" }],
          model: "gpt-4-bad-request",
          userId: "user-123",
          feature: "test",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("skips temperature up-front when the persisted probe marks it unsupported", async () => {
      const base = createTestConfig();
      const adapter = new OpenAIAdapter({
        ...base,
        config: {
          ...base.config,
          settings: {
            modelCapabilities: {
              "gpt-probed": {
                unsupportedParams: ["temperature"],
                probedAt: "2026-09-28T00:00:00.000Z",
              },
            },
          },
        },
      });

      mockFetch.mockResolvedValueOnce(okCompletion("ok"));
      await adapter.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-probed",
        userId: "user-123",
        feature: "test",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(mockFetch.mock.calls[0][1].body).temperature
      ).toBeUndefined();
    });

    it("probeModelCapabilities reports temperature as unsupported on a proxy rejection", async () => {
      const adapter = new OpenAIAdapter(createTestConfig());

      mockFetch.mockResolvedValueOnce(liteLlmRejection());

      const result = await adapter.probeModelCapabilities(
        "claude-opus-5-probe"
      );

      expect(result.unsupportedParams).toEqual(["temperature"]);
      const probeBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(probeBody.temperature).toBe(0.5);
      expect(probeBody.max_completion_tokens).toBe(1);
      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://api.openai.com/v1/chat/completions"
      );
    });

    it("probeModelCapabilities returns [] when the model accepts temperature", async () => {
      const adapter = new OpenAIAdapter(createTestConfig());

      mockFetch.mockResolvedValueOnce({
        ...okCompletion("pong"),
        text: async () => "",
      });

      const result = await adapter.probeModelCapabilities("gpt-4");

      expect(result.unsupportedParams).toEqual([]);
    });

    it("probeModelCapabilities re-throws unrelated failures", async () => {
      const adapter = new OpenAIAdapter(createTestConfig());

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: { message: "Invalid API key" } }),
      });

      await expect(
        adapter.probeModelCapabilities("gpt-4")
      ).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
    });
  });

  describe("testConnection", () => {
    it("should return true when connection is successful", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const result = await adapter.testConnection();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        })
      );
    });

    it("should return false when connection fails", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      // Suppress console.error for this test
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await adapter.testConnection();

      expect(result).toBe(false);
      expect(adapter.getLastTestConnectionError()).toBe("401: Unauthorized");
      consoleSpy.mockRestore();
    });

    it("should return false when fetch throws", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await adapter.testConnection();

      expect(result).toBe(false);
      // The reason is recorded, with the URL redacted (no query/credentials).
      expect(adapter.getLastTestConnectionError()).toBe(
        "Network error reaching https://api.openai.com/v1/models: Network error"
      );
      consoleSpy.mockRestore();
    });
  });

  describe("getAvailableModels", () => {
    it("should return filtered GPT models", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: "gpt-4" },
            { id: "gpt-3.5-turbo" },
            { id: "text-davinci-003" }, // Should be filtered out
            { id: "gpt-4o" },
          ],
        }),
      });

      const models = await adapter.getAvailableModels();

      expect(models.length).toBe(3);
      expect(models.map((m) => m.id)).toContain("gpt-4");
      expect(models.map((m) => m.id)).toContain("gpt-3.5-turbo");
      expect(models.map((m) => m.id)).toContain("gpt-4o");
      expect(models.map((m) => m.id)).not.toContain("text-davinci-003");
    });

    it("should return default models on error", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const models = await adapter.getAvailableModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models.map((m) => m.id)).toContain("gpt-4o");
      consoleSpy.mockRestore();
    });
  });

  describe("isModelAvailable", () => {
    it("should return true for available model", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-4" }, { id: "gpt-3.5-turbo" }],
        }),
      });

      const result = await adapter.isModelAvailable("gpt-4");

      expect(result).toBe(true);
    });

    it("should return false for unavailable model", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-4" }],
        }),
      });

      const result = await adapter.isModelAvailable("gpt-5");

      expect(result).toBe(false);
    });
  });

  describe("getRateLimitInfo", () => {
    it("should return null (not implemented)", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      const result = await adapter.getRateLimitInfo();

      expect(result).toBeNull();
    });
  });

  describe("getProviderName", () => {
    it("should return OpenAI", () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      expect(adapter.getProviderName()).toBe("OpenAI");
    });
  });

  describe("model info mapping", () => {
    it("should return correct info for gpt-4", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-4" }] }),
      });

      const models = await adapter.getAvailableModels();
      const gpt4 = models.find((m) => m.id === "gpt-4");

      expect(gpt4).toBeDefined();
      expect(gpt4?.name).toBe("GPT-4");
      expect(gpt4?.contextWindow).toBe(8192);
      expect(gpt4?.capabilities).toContain("text");
      expect(gpt4?.capabilities).toContain("code");
    });

    it("should return correct info for gpt-4o", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-4o" }] }),
      });

      const models = await adapter.getAvailableModels();
      const gpt4o = models.find((m) => m.id === "gpt-4o");

      expect(gpt4o).toBeDefined();
      expect(gpt4o?.name).toBe("GPT-4o");
      expect(gpt4o?.contextWindow).toBe(128000);
      expect(gpt4o?.capabilities).toContain("vision");
    });

    it("should return default info for unknown models", async () => {
      const config = createTestConfig();
      const adapter = new OpenAIAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-future-model" }] }),
      });

      const models = await adapter.getAvailableModels();
      const unknownModel = models.find((m) => m.id === "gpt-future-model");

      expect(unknownModel).toBeDefined();
      expect(unknownModel?.name).toBe("gpt-future-model");
      expect(unknownModel?.contextWindow).toBe(4096);
    });
  });
});

describe("OpenAIAdapter non-string message content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const completion = (
    message: Record<string, unknown>,
    finish_reason: string
  ) => ({
    ok: true,
    json: async () => ({
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-5",
      choices: [
        { index: 0, message: { role: "assistant", ...message }, finish_reason },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    }),
  });

  const request: LlmRequest = {
    messages: [{ role: "user", content: "Hello" }],
    userId: "user-123",
    feature: "test",
  };

  it("returns empty content and content_filter for a refusal with null content", async () => {
    const adapter = new OpenAIAdapter(createTestConfig());
    mockFetch.mockResolvedValueOnce(
      completion({ content: null, refusal: "I can't help with that." }, "stop")
    );

    const response = await adapter.chat(request);

    expect(response.content).toBe("");
    expect(response.finishReason).toBe("content_filter");
  });

  it("returns empty content and length when the completion has no content field", async () => {
    const adapter = new OpenAIAdapter(createTestConfig());
    mockFetch.mockResolvedValueOnce(completion({}, "length"));

    const response = await adapter.chat(request);

    expect(response.content).toBe("");
    expect(response.finishReason).toBe("length");
  });
});
