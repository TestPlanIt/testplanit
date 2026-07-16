import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmAdapterConfig, LlmRequest } from "../types";
import { AnthropicAdapter } from "./anthropic.adapter";

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
    deletedAt: null,
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
    costPerInputToken: new Decimal("0.003"),
    costPerOutputToken: new Decimal("0.015"),
    monthlyBudget: null,
    billingPeriodStartDay: 1,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 30000,
    retryAttempts: 3,
    streamingEnabled: false,
    isDefault: false,
    settings: null,
    alertThresholdsFired: null,
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
      expect(adapter.getLastTestConnectionError()).toContain(
        "Network error reaching"
      );
      expect(adapter.getLastTestConnectionError()).toContain("Network error");
    });

    it("should capture the provider message on a non-2xx/400 response", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      // Real-world LiteLLM proxy response: the key can list models but isn't
      // authorized for the selected one.
      mockFetch.mockResolvedValueOnce({
        status: 403,
        statusText: "Forbidden",
        text: async () =>
          JSON.stringify({
            error: {
              message:
                "User not allowed to access model. Tried to access claude-haiku-4-5",
              type: "key_model_access_denied",
              code: "403",
            },
          }),
      });

      const result = await adapter.testConnection();
      expect(result).toBe(false);
      expect(adapter.getLastTestConnectionError()).toBe(
        "403 Forbidden: User not allowed to access model. Tried to access claude-haiku-4-5"
      );
    });
  });

  describe("getAvailableModels", () => {
    it("should return default Claude models", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      const models = await adapter.getAvailableModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models.map((m) => m.id)).toContain("claude-3-5-sonnet-20241022");
      expect(models.map((m) => m.id)).toContain("claude-haiku-4-5-20251001");
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

      const result = await adapter.isModelAvailable(
        "claude-3-5-sonnet-20241022"
      );
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

  describe("temperature deprecation handling", () => {
    it("should retry without temperature when model returns deprecation error", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      // First call fails with temperature deprecation
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            message: "`temperature` is deprecated for this model.",
          },
        }),
      });

      // Retry without temperature succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg_456",
          content: [{ type: "text", text: "Hello from Opus 4.7" }],
          model: "claude-opus-4-7",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 15 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        model: "claude-opus-4-7",
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Hello from Opus 4.7");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First call includes temperature
      const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(firstBody.temperature).toBeDefined();

      // Retry call does NOT include temperature
      const retryBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(retryBody.temperature).toBeUndefined();
    });

    it("should skip temperature on subsequent requests after learning a model doesn't support it", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      // First request: fails then retries
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            message: "`temperature` is deprecated for this model.",
          },
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "First response" }],
          model: "claude-opus-4-7",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        model: "claude-opus-4-7",
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second request: should skip temperature entirely (no retry needed)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Second response" }],
          model: "claude-opus-4-7",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      });

      const response2 = await adapter.chat(request);

      expect(response2.content).toBe("Second response");
      expect(mockFetch).toHaveBeenCalledTimes(3); // Only 1 additional call, no retry

      // The third call should NOT include temperature
      const thirdBody = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(thirdBody.temperature).toBeUndefined();
    });

    it("should not retry for non-temperature errors", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: { message: "Invalid model specified" },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });

      // Should NOT retry
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("model capabilities — persisted via probe", () => {
    it("skips temperature when settings.modelCapabilities marks it unsupported", async () => {
      const config = createTestConfig({
        config: {
          ...createTestConfig().config,
          settings: {
            modelCapabilities: {
              "claude-opus-4-7": {
                unsupportedParams: ["temperature"],
                probedAt: "2026-04-30T00:00:00.000Z",
              },
            },
          },
        },
      });
      const adapter = new AnthropicAdapter(config);

      // Single response — no retry needed since temperature is omitted up-front
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg_x",
          content: [{ type: "text", text: "Pre-probed response" }],
          model: "claude-opus-4-7",
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 10 },
        }),
      });

      await adapter.chat({
        messages: [{ role: "user", content: "Hi" }],
        model: "claude-opus-4-7",
        userId: "user-123",
        feature: "test",
      });

      // Exactly one HTTP call, no retry — and no temperature on the wire
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBeUndefined();
    });

    it("still sends temperature when stored unsupportedParams entry doesn't include it", async () => {
      const config = createTestConfig({
        config: {
          ...createTestConfig().config,
          settings: {
            modelCapabilities: {
              "claude-3-5-sonnet-20241022": {
                unsupportedParams: [],
                probedAt: "2026-04-30T00:00:00.000Z",
              },
            },
          },
        },
      });
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg_x",
          content: [{ type: "text", text: "ok" }],
          model: "claude-3-5-sonnet-20241022",
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 5 },
        }),
      });

      await adapter.chat({
        messages: [{ role: "user", content: "Hi" }],
        model: "claude-3-5-sonnet-20241022",
        userId: "user-123",
        feature: "test",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.7);
    });
  });

  describe("probeModelCapabilities", () => {
    it("returns unsupportedParams=['temperature'] when probe hits the deprecation error", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            message: "`temperature` is deprecated for this model.",
          },
        }),
      });

      const result = await adapter.probeModelCapabilities("claude-opus-4-7");

      expect(result.unsupportedParams).toEqual(["temperature"]);
      expect(result.probedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Probe sent temperature so the error path was actually exercised
      const probeBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(probeBody.temperature).toBe(1);
      expect(probeBody.max_tokens).toBe(1);
    });

    it("returns empty unsupportedParams when the probe succeeds", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg_probe",
          content: [{ type: "text", text: "pong" }],
          model: "claude-3-5-sonnet-20241022",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      });

      const result = await adapter.probeModelCapabilities(
        "claude-3-5-sonnet-20241022"
      );

      expect(result.unsupportedParams).toEqual([]);
    });

    it("re-throws non-deprecation errors so the admin sees the real failure", async () => {
      const config = createTestConfig();
      const adapter = new AnthropicAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: { message: "Invalid API key" },
        }),
      });

      await expect(
        adapter.probeModelCapabilities("claude-3-5-sonnet-20241022")
      ).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
    });
  });
});
