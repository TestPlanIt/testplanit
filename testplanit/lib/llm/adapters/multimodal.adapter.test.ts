/**
 * Cross-adapter contract tests for multimodal (`LlmContentPart[]`) message
 * content: every provider adapter must translate mixed text+image content to
 * its own wire shape — or flatten to text when it (or its configuration)
 * cannot send images — without ever crashing on a parts array.
 *
 * Kept in one file (rather than spread across the per-adapter test files) so
 * the whole contract is reviewable in one place; per-adapter behavior beyond
 * message translation stays in the per-adapter files.
 */
import { Decimal } from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmAdapterConfig, LlmContentPart, LlmRequest } from "../types";
import { AnthropicAdapter } from "./anthropic.adapter";
import { AzureOpenAIAdapter } from "./azure-openai.adapter";
import { CustomLlmAdapter } from "./custom.adapter";
import { GeminiAdapter } from "./gemini.adapter";
import { OllamaAdapter } from "./ollama.adapter";
import { OpenAIAdapter } from "./openai.adapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const PNG = "iVBORw0KGgo=";
const JPEG = "/9j/4AAQSkZJRg==";

const mixedContent: LlmContentPart[] = [
  { type: "text", text: "Describe the screenshot." },
  { type: "image", mimeType: "image/png", base64: PNG, filename: "login.png" },
];

const makeConfig = (
  provider: string,
  overrides: Partial<LlmAdapterConfig> = {}
): LlmAdapterConfig => ({
  integration: {
    id: 1,
    name: "Test Integration",
    provider,
    status: "ACTIVE",
    credentials: {},
    settings: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as LlmAdapterConfig["integration"],
  config: {
    id: 1,
    llmIntegrationId: 1,
    defaultModel: "test-model",
    availableModels: {},
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
  } as unknown as LlmAdapterConfig["config"],
  apiKey: "test-api-key",
  ...overrides,
});

const makeRequest = (
  content: LlmRequest["messages"][number]["content"],
  extra: Partial<LlmRequest> = {}
): LlmRequest => ({
  messages: [
    { role: "system", content: "You are a test-case generator." },
    { role: "user", content },
  ],
  userId: "user-1",
  feature: "test_case_generation",
  ...extra,
});

/** The JSON body of the first (and only) fetch call. */
const sentBody = () => JSON.parse(mockFetch.mock.calls[0][1].body);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AnthropicAdapter multimodal", () => {
  const respond = () =>
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        model: "claude-test",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

  it("sends image parts as base64 source blocks and hoists system text", async () => {
    const adapter = new AnthropicAdapter(makeConfig("ANTHROPIC"));
    respond();
    await adapter.chat(makeRequest(mixedContent));

    const body = sentBody();
    expect(body.system).toBe("You are a test-case generator.");
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Describe the screenshot." },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: PNG,
            },
          },
        ],
      },
    ]);
  });

  it("collapses an image-free parts array back to a plain string", async () => {
    const adapter = new AnthropicAdapter(makeConfig("ANTHROPIC"));
    respond();
    await adapter.chat(
      makeRequest([
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ])
    );

    expect(sentBody().messages[0].content).toBe("line one\nline two");
  });
});

describe("OpenAIAdapter multimodal", () => {
  const respond = () =>
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 0,
        model: "gpt-test",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

  it("sends image parts as image_url data URIs and keeps system flat", async () => {
    const adapter = new OpenAIAdapter(makeConfig("OPENAI"));
    respond();
    await adapter.chat(makeRequest(mixedContent));

    const body = sentBody();
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are a test-case generator.",
    });
    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Describe the screenshot." },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${PNG}` },
        },
      ],
    });
  });

  it("keeps plain-string content untouched (pre-multimodal wire shape)", async () => {
    const adapter = new OpenAIAdapter(makeConfig("OPENAI"));
    respond();
    await adapter.chat(makeRequest("plain question"));

    expect(sentBody().messages[1]).toEqual({
      role: "user",
      content: "plain question",
    });
  });

  it("Azure subclass inherits the translation", async () => {
    const adapter = new AzureOpenAIAdapter(
      makeConfig("AZURE_OPENAI", {
        baseUrl: "https://example.openai.azure.com",
        integration: {
          ...makeConfig("AZURE_OPENAI").integration,
          settings: { deploymentName: "gpt-4o" },
        },
      })
    );
    respond();
    await adapter.chat(makeRequest(mixedContent));

    const body = sentBody();
    expect(body.messages[1].content[1].type).toBe("image_url");
    expect(body.messages[1].content[1].image_url.url).toContain(
      "data:image/png;base64,"
    );
  });
});

describe("GeminiAdapter multimodal", () => {
  const respond = () =>
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: "ok" }], role: "model" },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }),
    });

  it("sends images as inline_data parts after the text part", async () => {
    const adapter = new GeminiAdapter(makeConfig("GEMINI"));
    respond();
    await adapter.chat(makeRequest(mixedContent));

    const body = sentBody();
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].parts).toEqual([
      {
        text: "You are a test-case generator.\n\nDescribe the screenshot.",
      },
      { inline_data: { mime_type: "image/png", data: PNG } },
    ]);
  });

  it("prepends system text as its own part when the user message is image-only", async () => {
    const adapter = new GeminiAdapter(makeConfig("GEMINI"));
    respond();
    await adapter.chat(
      makeRequest([
        {
          type: "image",
          mimeType: "image/jpeg",
          base64: JPEG,
          filename: "shot.jpg",
        },
      ])
    );

    const body = sentBody();
    // Regression: the old code mutated parts[0].text and would have produced
    // "undefined" — or thrown — when the first part is an image.
    expect(body.contents[0].parts).toEqual([
      { text: "You are a test-case generator." },
      { inline_data: { mime_type: "image/jpeg", data: JPEG } },
    ]);
  });
});

describe("OllamaAdapter multimodal", () => {
  const respond = () =>
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: "llava",
        created_at: "2026-01-01T00:00:00Z",
        message: { role: "assistant", content: "ok" },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    });

  it("flattens content to text and carries images as a sibling base64 array", async () => {
    const adapter = new OllamaAdapter(makeConfig("OLLAMA"));
    respond();
    await adapter.chat(makeRequest(mixedContent));

    const body = sentBody();
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "Describe the screenshot.\n[image: login.png]",
      images: [PNG],
    });
    // Image-free messages must not gain an images key at all.
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are a test-case generator.",
    });
  });
});

describe("CustomLlmAdapter multimodal", () => {
  const settingsBase = { endpoint: "https://custom.example.com/v1/chat" };

  const respond = () =>
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: "ok" }),
    });

  it("flattens images to text markers by default (unknown API shape)", async () => {
    const adapter = new CustomLlmAdapter(
      makeConfig("CUSTOM_LLM", {
        integration: {
          ...makeConfig("CUSTOM_LLM").integration,
          settings: settingsBase,
        },
      })
    );
    respond();
    await adapter.chat(makeRequest(mixedContent));

    expect(sentBody().messages[1]).toEqual({
      role: "user",
      content: "Describe the screenshot.\n[image: login.png]",
    });
  });

  it("emits OpenAI-style image_url parts when visionSupport is opted in", async () => {
    const adapter = new CustomLlmAdapter(
      makeConfig("CUSTOM_LLM", {
        integration: {
          ...makeConfig("CUSTOM_LLM").integration,
          settings: { ...settingsBase, visionSupport: true },
        },
      })
    );
    respond();
    await adapter.chat(makeRequest(mixedContent));

    expect(sentBody().messages[1].content).toEqual([
      { type: "text", text: "Describe the screenshot." },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${PNG}` },
      },
    ]);
  });
});

describe("empty parts guard", () => {
  it("rejects a message whose content is an empty parts array", async () => {
    const adapter = new OpenAIAdapter(makeConfig("OPENAI"));
    await expect(adapter.chat(makeRequest([]))).rejects.toThrow(
      "Message content parts cannot be empty"
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
