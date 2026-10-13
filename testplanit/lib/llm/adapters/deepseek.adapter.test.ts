import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmAdapterConfig, LlmRequest } from "../types";
import { DeepSeekAdapter } from "./deepseek.adapter";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const createTestConfig = (
  overrides: Partial<LlmAdapterConfig> = {}
): LlmAdapterConfig => ({
  integration: {
    id: 1,
    name: "Test DeepSeek",
    provider: "DEEPSEEK",
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
    defaultModel: "deepseek-v4-flash",
    availableModels: ["deepseek-v4-flash"],
    maxTokensPerRequest: 65536,
    maxRequestsPerMinute: 60,
    maxRequestsPerDay: null,
    costPerInputToken: new Decimal("0.00044"),
    costPerOutputToken: new Decimal("0.00132"),
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
  apiKey: "test-deepseek-key",
  ...overrides,
});

const baseRequest: LlmRequest = {
  messages: [{ role: "user", content: "Hello" }],
  userId: "user-123",
  feature: "test",
};

const completion = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  json: async () => ({
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "deepseek-v4-flash",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "The answer",
          reasoning_content: "Let me think about this...",
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    ...overrides,
  }),
});

const sentBody = (): Record<string, unknown> =>
  JSON.parse(mockFetch.mock.calls[0][1].body as string);

const sseResponse = (chunks: unknown[]) => {
  const encoder = new TextEncoder();
  const lines = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n`)
    .concat("data: [DONE]\n");
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
  };
};

describe("DeepSeekAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("identifies itself as DeepSeek and defaults to the official base URL", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      expect(adapter.getProviderName()).toBe("DeepSeek");

      mockFetch.mockResolvedValueOnce(completion());
      await adapter.chat(baseRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.deepseek.com/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-deepseek-key",
          }),
        })
      );
    });

    it("honours a custom base URL and strips a trailing slash", async () => {
      const adapter = new DeepSeekAdapter(
        createTestConfig({ baseUrl: "https://litellm.example.com/v1/" })
      );
      mockFetch.mockResolvedValueOnce(completion());
      await adapter.chat(baseRequest);

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://litellm.example.com/v1/chat/completions"
      );
    });

    it("throws a provider-specific error when the API key is missing", () => {
      expect(
        () => new DeepSeekAdapter(createTestConfig({ apiKey: "" }))
      ).toThrow("DeepSeek API key is required");
    });
  });

  describe("request body", () => {
    it("sends max_tokens (not max_completion_tokens) and no thinking key by default", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce(completion());

      await adapter.chat({ ...baseRequest, maxTokens: 2048 });

      const body = sentBody();
      expect(body.model).toBe("deepseek-v4-flash");
      expect(body.max_tokens).toBe(2048);
      expect(body).not.toHaveProperty("max_completion_tokens");
      expect(body).not.toHaveProperty("thinking");
      expect(body.temperature).toBe(0.7);
      expect(body.stream).toBe(false);
    });

    it("falls back to the configured default max tokens", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce(completion());

      await adapter.chat(baseRequest);

      expect(sentBody().max_tokens).toBe(1000);
    });

    it("disables thinking when the caller asks for it", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce(completion());

      await adapter.chat({ ...baseRequest, disableThinking: true });

      expect(sentBody().thinking).toEqual({ type: "disabled" });
    });

    it("maps a positive thinking budget to low reasoning effort", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce(completion());

      await adapter.chat({ ...baseRequest, thinkingBudget: 512 });

      expect(sentBody().thinking).toEqual({
        type: "enabled",
        reasoning_effort: "low",
      });
    });

    it("treats a zero thinking budget as disabled, even if disableThinking is unset", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce(completion());

      await adapter.chat({ ...baseRequest, thinkingBudget: 0 });

      expect(sentBody().thinking).toEqual({ type: "disabled" });
    });

    it("inherits the OpenAI image_url translation for image parts", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce(completion());

      await adapter.chat({
        ...baseRequest,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this" },
              { type: "image", mimeType: "image/png", base64: "AAAA" },
            ],
          },
        ],
      });

      const [message] = sentBody().messages as Array<{
        content: Array<Record<string, unknown>>;
      }>;
      expect(message.content[1]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/png;base64,AAAA" },
      });
    });
  });

  describe("chat", () => {
    it("returns the final answer and ignores reasoning_content", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce(completion());

      const response = await adapter.chat(baseRequest);

      expect(response.content).toBe("The answer");
      expect(response.model).toBe("deepseek-v4-flash");
      expect(response.promptTokens).toBe(10);
      expect(response.completionTokens).toBe(20);
      expect(response.totalTokens).toBe(30);
      expect(response.finishReason).toBe("stop");
    });

    it("returns an empty string when the answer was cut off during reasoning", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce(
        completion({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                reasoning_content: "Still thinking",
              },
              finish_reason: "length",
            },
          ],
        })
      );

      const response = await adapter.chat(baseRequest);

      expect(response.content).toBe("");
      expect(response.finishReason).toBe("length");
    });

    it("surfaces DeepSeek's error envelope", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            message: "Authentication Fails",
            type: "authentication_error",
          },
        }),
      });

      await expect(adapter.chat(baseRequest)).rejects.toMatchObject({
        message: "Authentication Fails",
        code: "AUTHENTICATION_ERROR",
        statusCode: 401,
      });
    });
  });

  describe("chatStream", () => {
    it("skips reasoning-only deltas and yields answer deltas plus the finish reason", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      const chunk = (
        delta: Record<string, unknown>,
        finish: string | null
      ) => ({
        id: "c",
        object: "chat.completion.chunk",
        created: 1,
        model: "deepseek-v4-flash",
        choices: [{ index: 0, delta, finish_reason: finish }],
      });
      mockFetch.mockResolvedValueOnce(
        sseResponse([
          chunk({ role: "assistant", reasoning_content: "Thinking" }, null),
          chunk({ reasoning_content: " more", content: null }, null),
          chunk({ content: "Hel" }, null),
          chunk({ content: "lo" }, null),
          chunk({}, "stop"),
        ])
      );

      const received: Array<{ delta: string; finishReason?: string }> = [];
      for await (const part of adapter.chatStream(baseRequest)) {
        received.push({ delta: part.delta, finishReason: part.finishReason });
      }

      expect(received).toEqual([
        { delta: "Hel", finishReason: undefined },
        { delta: "lo", finishReason: undefined },
        { delta: "", finishReason: "stop" },
      ]);
      expect(sentBody().stream).toBe(true);
      expect(sentBody().max_tokens).toBe(1000);
    });
  });

  describe("getAvailableModels", () => {
    it("lists every model the API returns, without the gpt filter", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object: "list",
          data: [
            { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
            { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
            { id: "deepseek-chat", object: "model", owned_by: "deepseek" },
            {
              id: "deepseek-v5-preview",
              object: "model",
              owned_by: "deepseek",
            },
          ],
        }),
      });

      const models = await adapter.getAvailableModels();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.deepseek.com/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-deepseek-key",
          }),
        })
      );
      expect(models.map((m) => m.id)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "deepseek-chat",
        "deepseek-v5-preview",
      ]);
      expect(models[0]).toMatchObject({
        name: "DeepSeek V4 Flash",
        contextWindow: 1_000_000,
      });
      expect(models[2].deprecated).toBe(true);
      // Unknown ids still resolve with conservative defaults.
      expect(models[3]).toMatchObject({
        name: "deepseek-v5-preview",
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
      });
    });

    it("falls back to the built-in V4 list when the request fails", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const models = await adapter.getAvailableModels();

      expect(models.map((m) => m.id)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-pro",
      ]);
    });

    it("reports model availability through the fetched list", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: "deepseek-v4-pro" }],
        }),
      });

      expect(await adapter.isModelAvailable("deepseek-v4-pro")).toBe(true);
      expect(await adapter.isModelAvailable("deepseek-v4-flash")).toBe(false);
    });
  });

  describe("testConnection", () => {
    it("probes GET /models with the bearer key", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      expect(await adapter.testConnection()).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.deepseek.com/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-deepseek-key",
          }),
        })
      );
      expect(adapter.getLastTestConnectionError()).toBeUndefined();
    });

    it("records the provider's reason when the probe is rejected", async () => {
      const adapter = new DeepSeekAdapter(createTestConfig());
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () =>
          JSON.stringify({ error: { message: "Authentication Fails" } }),
      });

      expect(await adapter.testConnection()).toBe(false);
      expect(adapter.getLastTestConnectionError()).toBe(
        "401 Unauthorized: Authentication Fails"
      );
    });
  });
});
