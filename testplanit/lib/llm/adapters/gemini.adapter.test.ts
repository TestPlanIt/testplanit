import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmAdapterConfig, LlmRequest } from "../types";
import { GeminiAdapter } from "./gemini.adapter";

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
    settings: null,
    isDeleted: false,
    deletedAt: null,
    deletedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  config: {
    id: 1,
    llmIntegrationId: 1,
    defaultModel: "gemini-1.5-flash",
    availableModels: ["gemini-1.5-flash", "gemini-1.5-pro"],
    maxTokensPerRequest: 8192,
    costPerInputToken: new Decimal("0.000075"),
    costPerOutputToken: new Decimal("0.0003"),
    monthlyBudget: null,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 30000,
    retryAttempts: 3,
    streamingEnabled: false,
    isDefault: false,
    settings: null,
    budgetAlertResetAt: null,
    billingPeriodStartDay: 1,
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

  describe("chatStream", () => {
    const streamChunk = (text: string, finishReason?: string) =>
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason }],
      })}`;

    const encoder = new TextEncoder();

    const streamResponse = (reads: Array<string | Uint8Array>) => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const read of reads) {
            controller.enqueue(
              typeof read === "string" ? encoder.encode(read) : read
            );
          }
          controller.close();
        },
      }),
    });

    const collect = async (reads: Array<string | Uint8Array>) => {
      mockFetch.mockResolvedValueOnce(streamResponse(reads));
      const adapter = new GeminiAdapter(createTestConfig());
      const deltas: string[] = [];
      let finishReason: string | undefined;
      for await (const chunk of adapter.chatStream({
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      })) {
        deltas.push(chunk.delta);
        finishReason = chunk.finishReason ?? finishReason;
      }
      return { text: deltas.join(""), finishReason };
    };

    it("keeps a line that is split across two network reads", async () => {
      const line = streamChunk("split across reads");
      const cut = Math.floor(line.length / 2);

      const { text } = await collect([
        `${streamChunk("Hello ")}\n\n${line.slice(0, cut)}`,
        `${line.slice(cut)}\n\n${streamChunk("!")}\n\n`,
      ]);

      expect(text).toBe("Hello split across reads!");
    });

    it("parses a final line that has no trailing newline", async () => {
      const { text, finishReason } = await collect([
        `${streamChunk("Hello ")}\n\n`,
        streamChunk("world", "STOP"),
      ]);

      expect(text).toBe("Hello world");
      expect(finishReason).toBe("stop");
    });

    it("yields the same text wherever the network splits the stream", async () => {
      const payload = encoder.encode(
        [
          streamChunk("Héllo "),
          streamChunk("世界 "),
          streamChunk("🎉 done", "STOP"),
        ].join("\n\n") + "\n\n"
      );
      const expected = "Héllo 世界 🎉 done";

      for (let cut = 1; cut < payload.length; cut++) {
        const { text, finishReason } = await collect([
          payload.slice(0, cut),
          payload.slice(cut),
        ]);
        expect(text, `split at byte ${cut}`).toBe(expected);
        expect(finishReason, `split at byte ${cut}`).toBe("stop");
      }
    });

    it("yields the same text when the stream arrives one byte at a time", async () => {
      const payload = encoder.encode(
        `${streamChunk("Héllo ")}\n\n${streamChunk("世界", "STOP")}\n\n`
      );

      const { text, finishReason } = await collect(
        Array.from(payload, (byte) => Uint8Array.of(byte))
      );

      expect(text).toBe("Héllo 世界");
      expect(finishReason).toBe("stop");
    });

    it("handles CRLF line endings", async () => {
      const { text } = await collect([
        `${streamChunk("Hello ")}\r\n\r\n${streamChunk("world")}\r\n\r\n`,
      ]);

      expect(text).toBe("Hello world");
    });

    it("skips malformed and non-data lines without losing the rest", async () => {
      const { text } = await collect([
        [
          ": keep-alive comment",
          "event: message",
          "data: {not json",
          streamChunk("kept"),
          "data: ",
          streamChunk(" too"),
        ].join("\n") + "\n",
      ]);

      expect(text).toBe("kept too");
    });

    it("leaves thought parts out of the streamed text", async () => {
      const line = `data: ${JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "internal reasoning", thought: true },
                { text: "the answer" },
              ],
            },
          },
        ],
      })}`;

      const { text } = await collect([`${line}\n\n`]);

      expect(text).toBe("the answer");
    });

    it("maps a truncated stream's finish reason", async () => {
      const { finishReason } = await collect([
        `${streamChunk("cut off", "MAX_TOKENS")}\n\n`,
      ]);

      expect(finishReason).toBe("length");
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

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await adapter.testConnection();
      expect(result).toBe(false);
      expect(adapter.getLastTestConnectionError()).toBe("401: Unauthorized");
      consoleSpy.mockRestore();
    });

    it("should not leak the API key into the recorded error", async () => {
      const config = createTestConfig();
      const adapter = new GeminiAdapter(config);

      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await adapter.testConnection();
      expect(result).toBe(false);

      const recorded = adapter.getLastTestConnectionError();
      expect(recorded).toContain("Network error reaching");
      // Gemini passes the key as a ?key= query param — it must never appear
      // in the surfaced error message.
      expect(recorded).not.toContain("test-gemini-api-key");
      expect(recorded).not.toContain("key=");
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
