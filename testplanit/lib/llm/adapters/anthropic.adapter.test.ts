import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { AnthropicAdapter } from "./anthropic.adapter";
import type { LlmAdapterConfig, LlmRequest } from "../types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const createTestConfig = (
  overrides: Partial<LlmAdapterConfig> = {}
): LlmAdapterConfig => ({
  integration: {
    id: 1,
    name: "Test Integration",
    provider: "ANTHROPIC",
    status: "ACTIVE",
    credentials: {},
    settings: null,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  config: {
    id: 1,
    llmIntegrationId: 1,
    defaultModel: "claude-3-5-sonnet-20241022",
    availableModels: ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
    maxTokensPerRequest: 4096,
    maxRequestsPerMinute: 60,
    maxRequestsPerDay: null,
    costPerInputToken: new Prisma.Decimal("0.003"),
    costPerOutputToken: new Prisma.Decimal("0.015"),
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
  apiKey: "test-anthropic-api-key",
  baseUrl: "https://api.anthropic.com/v1",
  ...overrides,
});

describe("AnthropicAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create adapter with valid config", () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);
      expect(adapter.getProviderName()).toBe("Anthropic");
    });

    it("should throw error when API key is missing", () => {
      const config = createTestConfig({ apiKey: "" });
      expect(() => new AnthropicAdapter(config)).toThrow(
        "Anthropic API key is required"
      );
    });

    it("should use default base URL when not provided", () => {
      const config = createTestConfig({ baseUrl: undefined });
      const adapter = new AnthropicAdapter(config);
      expect(adapter.getProviderName()).toBe("Anthropic");
    });
  });

  describe("chat", () => {
    it("should make successful chat request", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg_123",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Hello! I'm Claude." }],
          model: "claude-3-5-sonnet-20241022",
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 15 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Hello! I'm Claude.");
      expect(response.model).toBe("claude-3-5-sonnet-20241022");
      expect(response.promptTokens).toBe(10);
      expect(response.completionTokens).toBe(15);
      expect(response.totalTokens).toBe(25);
      expect(response.finishReason).toBe("stop");
    });

    it("should extract system message separately", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg_123",
          content: [{ type: "text", text: "Response" }],
          model: "claude-3-5-sonnet-20241022",
          stop_reason: "end_turn",
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
      });

      const request: LlmRequest = {
        messages: [
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "Hello" },
        ],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.system).toBe("You are a helpful assistant");
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
    });

    it("should include x-api-key and anthropic-version headers", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Response" }],
          model: "claude-3-5-sonnet-20241022",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers["x-api-key"]).toBe("test-anthropic-api-key");
      expect(fetchCall[1].headers["anthropic-version"]).toBe("2023-06-01");
    });

    it("should handle 401 authentication error", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: { message: "Invalid API key" } }),
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
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({
          "content-type": "application/json",
          "retry-after": "30",
        }),
        json: async () => ({ error: { message: "Rate limit exceeded" } }),
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

    it("should map stop_sequence to stop finish reason", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Response" }],
          model: "claude-3-5-sonnet-20241022",
          stop_reason: "stop_sequence",
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);
      expect(response.finishReason).toBe("stop");
    });

    it("should map max_tokens to length finish reason", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Response" }],
          model: "claude-3-5-sonnet-20241022",
          stop_reason: "max_tokens",
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);
      expect(response.finishReason).toBe("length");
    });
  });

  describe("testConnection", () => {
    it("should return true on successful connection", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        status: 200,
      });

      const result = await adapter.testConnection();
      expect(result).toBe(true);
    });

    it("should return true even on 400 (means API is reachable)", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        status: 400,
      });

      const result = await adapter.testConnection();
      expect(result).toBe(true);
    });

    it("should return false on network error", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await adapter.testConnection();
      expect(result).toBe(false);
    });
  });

  describe("getAvailableModels", () => {
    it("should return default Claude models", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      const models = await adapter.getAvailableModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models.map((m) => m.id)).toContain("claude-3-5-sonnet-20241022");
      expect(models.map((m) => m.id)).toContain("claude-3-haiku-20240307");
    });

    it("should return correct model info for Claude 3.5 Sonnet", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      const models = await adapter.getAvailableModels();
      const sonnet = models.find((m) => m.id === "claude-3-5-sonnet-20241022");

      expect(sonnet).toBeDefined();
      expect(sonnet?.name).toBe("Claude 3.5 Sonnet");
      expect(sonnet?.contextWindow).toBe(200000);
      expect(sonnet?.capabilities).toContain("vision");
    });
  });

  describe("isModelAvailable", () => {
    it("should return true for available model", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      const result = await adapter.isModelAvailable("claude-3-5-sonnet-20241022");
      expect(result).toBe(true);
    });

    it("should return false for unavailable model", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      const result = await adapter.isModelAvailable("claude-5-future");
      expect(result).toBe(false);
    });
  });

  describe("getRateLimitInfo", () => {
    it("should return null", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      const result = await adapter.getRateLimitInfo();
      expect(result).toBeNull();
    });
  });
});
