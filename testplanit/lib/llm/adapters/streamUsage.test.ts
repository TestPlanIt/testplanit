import { Decimal } from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmAdapterConfig, LlmRequest, LlmStreamResponse } from "../types";
import { AnthropicAdapter } from "./anthropic.adapter";
import { AzureOpenAIAdapter } from "./azure-openai.adapter";
import { DeepSeekAdapter } from "./deepseek.adapter";
import { GeminiAdapter } from "./gemini.adapter";
import { OllamaAdapter } from "./ollama.adapter";
import { OpenAIAdapter } from "./openai.adapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const config = (
  provider: string,
  overrides: Partial<LlmAdapterConfig> = {}
): LlmAdapterConfig =>
  ({
    integration: {
      id: 1,
      name: "Test Integration",
      provider,
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
      defaultModel: "test-model",
      availableModels: ["test-model"],
      maxTokensPerRequest: 8192,
      costPerInputToken: new Decimal("0.000075"),
      costPerOutputToken: new Decimal("0.0003"),
      monthlyBudget: null,
      defaultTemperature: 0.7,
      defaultMaxTokens: 1000,
      timeout: 30000,
      retryAttempts: 3,
      streamingEnabled: true,
      isDefault: false,
      settings: null,
      budgetAlertResetAt: null,
      billingPeriodStartDay: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    apiKey: "test-api-key",
    ...overrides,
  }) as LlmAdapterConfig;

const request: LlmRequest = {
  messages: [{ role: "user", content: "Hello" }],
  userId: "user-123",
  feature: "test",
};

const streamOf = (lines: string[], contentType = "text/event-stream") => {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": contentType }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
  };
};

const sse = (events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`);

const collect = async (
  stream: AsyncGenerator<LlmStreamResponse, void, unknown>
) => {
  const chunks: LlmStreamResponse[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return {
    chunks,
    text: chunks.map((chunk) => chunk.delta).join(""),
    usage: chunks.findLast((chunk) => chunk.usage)?.usage,
  };
};

const sentBody = () => JSON.parse(mockFetch.mock.calls.at(-1)![1].body);

describe("usage reported on streamed responses", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("Anthropic", () => {
    const events = (withUsage: boolean) =>
      sse([
        {
          type: "message_start",
          message: {
            model: "claude-test",
            usage: withUsage
              ? { input_tokens: 42, output_tokens: 1 }
              : undefined,
          },
        },
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello" },
        },
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: " world" },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: withUsage ? { output_tokens: 17 } : undefined,
        },
        { type: "message_stop" },
      ]);

    it("reports the input tokens from the start event and the final output tokens", async () => {
      mockFetch.mockResolvedValue(streamOf(events(true)));

      const result = await collect(
        new AnthropicAdapter(config("ANTHROPIC")).chatStream(request)
      );

      expect(result.text).toBe("Hello world");
      expect(result.usage).toEqual({ promptTokens: 42, completionTokens: 17 });
      expect(result.chunks.at(-1)?.finishReason).toBe("stop");
    });

    it("reports no usage when the provider sends none", async () => {
      mockFetch.mockResolvedValue(streamOf(events(false)));

      const result = await collect(
        new AnthropicAdapter(config("ANTHROPIC")).chatStream(request)
      );

      expect(result.text).toBe("Hello world");
      expect(result.usage).toBeUndefined();
    });
  });

  describe("Ollama", () => {
    const ndjson = (chunks: unknown[]) =>
      streamOf(
        chunks.map((chunk) => `${JSON.stringify(chunk)}\n`),
        "application/x-ndjson"
      );

    it("reports the counts from the final chunk even when it has no text", async () => {
      mockFetch.mockResolvedValue(
        ndjson([
          { model: "llama", message: { content: "Hello" }, done: false },
          { model: "llama", message: { content: " world" }, done: false },
          {
            model: "llama",
            message: { content: "" },
            done: true,
            prompt_eval_count: 30,
            eval_count: 12,
          },
        ])
      );

      const result = await collect(
        new OllamaAdapter(config("OLLAMA")).chatStream(request)
      );

      expect(result.text).toBe("Hello world");
      expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 12 });
      expect(result.chunks.at(-1)?.finishReason).toBe("stop");
    });

    it("keeps the final chunk's text when it also carries the counts", async () => {
      mockFetch.mockResolvedValue(
        ndjson([
          { model: "llama", message: { content: "Hello" }, done: false },
          {
            model: "llama",
            message: { content: "!" },
            done: true,
            prompt_eval_count: 30,
            eval_count: 12,
          },
        ])
      );

      const result = await collect(
        new OllamaAdapter(config("OLLAMA")).chatStream(request)
      );

      expect(result.text).toBe("Hello!");
      expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 12 });
    });

    it("yields nothing extra when the final chunk has neither text nor counts", async () => {
      mockFetch.mockResolvedValue(
        ndjson([
          { model: "llama", message: { content: "Hello" }, done: false },
          { model: "llama", message: { content: "" }, done: true },
        ])
      );

      const result = await collect(
        new OllamaAdapter(config("OLLAMA")).chatStream(request)
      );

      expect(result.chunks).toHaveLength(1);
      expect(result.usage).toBeUndefined();
    });
  });

  describe("Gemini", () => {
    const part = (text: string, usage?: object, finishReason?: string) => ({
      candidates: [{ content: { parts: [{ text }] }, finishReason }],
      usageMetadata: usage,
    });

    it("reports the last usage metadata on the stream", async () => {
      mockFetch.mockResolvedValue(
        streamOf(
          sse([
            part("Hello", { promptTokenCount: 9, candidatesTokenCount: 1 }),
            part(
              " world",
              { promptTokenCount: 9, candidatesTokenCount: 6 },
              "STOP"
            ),
          ])
        )
      );

      const result = await collect(
        new GeminiAdapter(config("GEMINI")).chatStream(request)
      );

      expect(result.text).toBe("Hello world");
      expect(result.usage).toEqual({ promptTokens: 9, completionTokens: 6 });
    });

    it("reports no usage when the chunks carry no metadata", async () => {
      mockFetch.mockResolvedValue(streamOf(sse([part("Hello")])));

      const result = await collect(
        new GeminiAdapter(config("GEMINI")).chatStream(request)
      );

      expect(result.usage).toBeUndefined();
    });
  });

  describe("OpenAI-compatible", () => {
    const completion = (withUsage: boolean) =>
      streamOf([
        ...sse([
          {
            model: "gpt-test",
            choices: [
              { index: 0, delta: { content: "Hello" }, finish_reason: null },
            ],
          },
          {
            model: "gpt-test",
            choices: [
              { index: 0, delta: { content: " world" }, finish_reason: null },
            ],
          },
          {
            model: "gpt-test",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          },
          ...(withUsage
            ? [
                {
                  model: "gpt-test",
                  choices: [],
                  usage: { prompt_tokens: 21, completion_tokens: 8 },
                },
              ]
            : []),
        ]),
        "data: [DONE]\n\n",
      ]);

    it("asks OpenAI for usage and reports the final usage chunk", async () => {
      mockFetch.mockResolvedValue(completion(true));

      const result = await collect(
        new OpenAIAdapter(config("OPENAI")).chatStream(request)
      );

      expect(sentBody().stream_options).toEqual({ include_usage: true });
      expect(result.text).toBe("Hello world");
      expect(result.usage).toEqual({ promptTokens: 21, completionTokens: 8 });
      expect(
        result.chunks.find((chunk) => chunk.finishReason)?.finishReason
      ).toBe("stop");
    });

    it("asks DeepSeek's own endpoint for usage", async () => {
      mockFetch.mockResolvedValue(completion(true));

      const result = await collect(
        new DeepSeekAdapter(config("DEEPSEEK")).chatStream(request)
      );

      expect(sentBody().stream_options).toEqual({ include_usage: true });
      expect(result.usage).toEqual({ promptTokens: 21, completionTokens: 8 });
    });

    it("does not send the option to a proxy, which may reject it", async () => {
      mockFetch.mockResolvedValue(completion(false));

      const result = await collect(
        new OpenAIAdapter(
          config("OPENAI", { baseUrl: "https://llm-proxy.example.test/v1" })
        ).chatStream(request)
      );

      expect(sentBody()).not.toHaveProperty("stream_options");
      expect(result.text).toBe("Hello world");
      expect(result.usage).toBeUndefined();
    });

    it("still reports usage a proxy volunteers", async () => {
      mockFetch.mockResolvedValue(completion(true));

      const result = await collect(
        new OpenAIAdapter(
          config("OPENAI", { baseUrl: "https://llm-proxy.example.test/v1" })
        ).chatStream(request)
      );

      expect(result.usage).toEqual({ promptTokens: 21, completionTokens: 8 });
    });

    it("does not send the option to Azure OpenAI", async () => {
      mockFetch.mockResolvedValue(completion(false));
      const base = config("AZURE_OPENAI", {
        baseUrl: "https://example.openai.azure.com",
      });
      const azureConfig = {
        ...base,
        integration: {
          ...base.integration,
          settings: { deploymentName: "test-model" },
        },
      } as LlmAdapterConfig;

      await collect(new AzureOpenAIAdapter(azureConfig).chatStream(request));

      expect(sentBody()).not.toHaveProperty("stream_options");
    });

    it("never sends the option on a non-streamed request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: "gpt-test",
          choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      });

      await new OpenAIAdapter(config("OPENAI")).chat(request);

      expect(sentBody()).not.toHaveProperty("stream_options");
    });
  });
});
