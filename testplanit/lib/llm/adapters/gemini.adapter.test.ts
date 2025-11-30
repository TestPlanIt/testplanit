import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { GeminiAdapter } from "./gemini.adapter";
import type { LlmAdapterConfig, LlmRequest } from "../types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const createTestConfig = (
  overrides: Partial<LlmAdapterConfig> = {}
): LlmAdapterConfig => ({
  integration: {
    id: 1,
    name: "Test Integration",
    provider: "GEMINI",
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
    defaultModel: "gemini-1.5-flash",
    availableModels: ["gemini-1.5-flash", "gemini-1.5-pro"],
    maxTokensPerRequest: 8192,
    maxRequestsPerMinute: 60,
    maxRequestsPerDay: null,
    costPerInputToken: new Prisma.Decimal("0.000075"),
    costPerOutputToken: new Prisma.Decimal("0.0003"),
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
  apiKey: "test-gemini-api-key",
  ...overrides,
});

describe("GeminiAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create adapter with valid config", () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);
      expect(adapter.getProviderName()).toBe("Google Gemini");
    });

    it("should throw error when API key is missing", () => {
      const config = createTestConfig({ apiKey: "" });
      expect(() => new GeminiAdapter(config)).toThrow(
        "Google Gemini API key is required"
      );
    });

    it("should use default model from config", () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);
      expect(adapter.getDefaultModel()).toBe("gemini-1.5-flash");
    });
  });

  describe("chat", () => {
    it("should make successful chat request", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Hello! I'm Gemini." }],
                role: "model",
              },
              finishReason: "STOP",
              index: 0,
              safetyRatings: [],
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 15,
            totalTokenCount: 25,
          },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Hello! I'm Gemini.");
      expect(response.model).toBe("gemini-1.5-flash");
      expect(response.promptTokens).toBe(10);
      expect(response.completionTokens).toBe(15);
      expect(response.finishReason).toBe("stop");
    });

    it("should include API key in URL", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: "Response" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 10,
            totalTokenCount: 20,
          },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchUrl = mockFetch.mock.calls[0][0];
      expect(fetchUrl).toContain("key=test-gemini-api-key");
    });

    it("should convert messages to Gemini format", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: "Response" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 10,
            totalTokenCount: 20,
          },
        }),
      });

      const request: LlmRequest = {
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
          { role: "user", content: "How are you?" },
        ],
        userId: "user-123",
        feature: "test",
      };

      await adapter.chat(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.contents).toHaveLength(3);
      expect(body.contents[0].role).toBe("user");
      expect(body.contents[1].role).toBe("model"); // assistant becomes model
      expect(body.contents[2].role).toBe("user");
    });

    it("should prepend system message to first user message", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: "Response" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 20,
            candidatesTokenCount: 10,
            totalTokenCount: 30,
          },
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

      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].parts[0].text).toContain(
        "You are a helpful assistant"
      );
      expect(body.contents[0].parts[0].text).toContain("Hello");
    });

    it("should handle SAFETY finish reason as error", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: null,
              finishReason: "SAFETY",
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 0,
            totalTokenCount: 10,
          },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "CONTENT_BLOCKED",
      });
    });

    it("should handle no candidates response", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [],
          usageMetadata: { promptTokenCount: 10 },
        }),
      });

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "NO_CANDIDATES",
      });
    });

    it("should map MAX_TOKENS to length finish reason", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: "Truncated response" }] },
              finishReason: "MAX_TOKENS",
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 100,
            totalTokenCount: 110,
          },
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
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const result = await adapter.testConnection();
      expect(result).toBe(true);
    });

    it("should return false on error", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await adapter.testConnection();
      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe("getAvailableModels", () => {
    it("should fetch models from API", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            {
              name: "models/gemini-1.5-pro",
              displayName: "Gemini 1.5 Pro",
              inputTokenLimit: 2097152,
              outputTokenLimit: 8192,
            },
            {
              name: "models/gemini-1.5-flash",
              displayName: "Gemini 1.5 Flash",
              inputTokenLimit: 1048576,
              outputTokenLimit: 8192,
            },
          ],
        }),
      });

      const models = await adapter.getAvailableModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe("gemini-1.5-pro");
      expect(models[0].contextWindow).toBe(2097152);
    });

    it("should return default models on API error", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const models = await adapter.getAvailableModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models.map((m) => m.id)).toContain("gemini-1.5-flash");
      consoleSpy.mockRestore();
    });
  });

  describe("isModelAvailable", () => {
    it("should check if model is available", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "models/gemini-1.5-flash" }],
        }),
      });

      const result = await adapter.isModelAvailable("gemini-1.5-flash");
      expect(result).toBe(true);
    });
  });

  describe("getRateLimitInfo", () => {
    it("should return null", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      const result = await adapter.getRateLimitInfo();
      expect(result).toBeNull();
    });
  });
});
