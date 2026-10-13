import type {
  LlmAdapterConfig,
  LlmModelInfo,
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  RateLimitInfo,
} from "../types";
import { contentImages, flattenToText } from "../content";
import { BaseLlmAdapter } from "./base.adapter";
import { stripTrailingSlashes } from "~/lib/utils/url";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  system?: string;
}

/**
 * A block in a Messages API response. Only `text` blocks carry `text`;
 * `thinking` / `redacted_thinking` / `tool_use` blocks do not.
 */
interface AnthropicResponseBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicResponseBlock[];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  message?: AnthropicResponse;
  index?: number;
  delta?: {
    type: string;
    text?: string;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Concatenate the `text` blocks of a response. Thinking-enabled models
 * (Claude Opus 5 and later) return a `thinking` block first, so the text is
 * not `content[0]`; no text blocks yields "" and callers read `finishReason`.
 */
export function extractTextContent(
  content: AnthropicResponseBlock[] | undefined
): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is AnthropicResponseBlock & { text: string } =>
        block?.type === "text" && typeof block.text === "string"
    )
    .map((block) => block.text)
    .join("");
}

export class AnthropicAdapter extends BaseLlmAdapter {
  private apiKey: string;
  private baseUrl: string;
  private anthropicVersion = "2023-06-01";

  constructor(config: LlmAdapterConfig) {
    super(config);
    this.apiKey = config.apiKey || "";
    // Strip trailing slashes so appending `/messages` can't produce a double
    // slash (e.g. a user-supplied `.../v1/` becoming `.../v1//messages`).
    // Mirrors the normalization the available-models route already does.
    this.baseUrl = stripTrailingSlashes(
      config.baseUrl || "https://api.anthropic.com/v1"
    );

    if (!this.apiKey) {
      throw this.createError(
        "Anthropic API key is required",
        "MISSING_API_KEY",
        401
      );
    }
  }

  /**
   * Build the Messages API body. Consults `modelSupportsTemperature` on every
   * call so a retry after a temperature rejection leaves the field out.
   */
  private buildAnthropicRequest(
    request: LlmRequest,
    stream: boolean
  ): AnthropicRequest {
    const { systemMessage, userMessages } = this.extractMessages(
      request.messages
    );

    const model = request.model || this.getDefaultModel();
    const anthropicRequest: AnthropicRequest = {
      model,
      messages: userMessages,
      max_tokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
      stream,
    };

    if (this.modelSupportsTemperature(model)) {
      anthropicRequest.temperature =
        request.temperature ?? this.config.config.defaultTemperature;
    }

    if (systemMessage) {
      anthropicRequest.system = systemMessage;
    }

    return anthropicRequest;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.validateRequest(request);

    const model = request.model || this.getDefaultModel();
    const timeout = request.timeout ?? this.getTimeout();

    try {
      // The runtime fallback for integrations that haven't been probed yet —
      // a probed result lives in LlmProviderConfig.settings.modelCapabilities
      // and makes buildAnthropicRequest skip the param on the first try.
      return await this.withTemperatureFallback(model, () =>
        this.executeChat(this.buildAnthropicRequest(request, false), timeout)
      );
    } catch (error: any) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw this.createError("Request timeout", "TIMEOUT", 408, false);
      }
      throw error;
    }
  }

  async *chatStream(
    request: LlmRequest
  ): AsyncGenerator<LlmStreamResponse, void, unknown> {
    this.validateRequest(request);

    const model = request.model || this.getDefaultModel();

    // Use request timeout if provided, otherwise fall back to config timeout.
    // timeout === 0 means no timeout (e.g. streaming where the full duration is unknown).
    // Use safeFetchLongRunning to bypass undici's 5-min body timeout.
    const timeout = request.timeout ?? this.getTimeout();
    const response = await this.withTemperatureFallback(model, () =>
      this.fetchAnthropicMessage(
        this.buildAnthropicRequest(request, true),
        timeout
      )
    );

    const reader = response.body?.getReader();
    if (!reader) {
      throw this.createError(
        "Failed to get response stream",
        "STREAM_ERROR",
        500
      );
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let currentModel = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);

            try {
              const event = JSON.parse(data) as AnthropicStreamEvent;

              if (event.type === "message_start" && event.message) {
                currentModel = event.message.model;
              } else if (
                event.type === "content_block_delta" &&
                event.delta?.type === "text_delta" &&
                event.delta.text
              ) {
                yield {
                  delta: event.delta.text,
                  model: currentModel,
                  finishReason: undefined,
                };
              } else if (
                event.type === "message_delta" &&
                event.delta?.stop_reason
              ) {
                // stop_reason comes in message_delta, not content_block_delta — yield
                // a zero-delta chunk so callers can detect truncation, etc.
                yield {
                  delta: "",
                  model: currentModel,
                  finishReason: this.mapStopReason(event.delta.stop_reason),
                };
              } else if (event.type === "message_stop") {
                return;
              }
            } catch (e) {
              console.error("Failed to parse stream chunk:", e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async getAvailableModels(): Promise<LlmModelInfo[]> {
    return this.getDefaultModels();
  }

  async isModelAvailable(modelId: string): Promise<boolean> {
    const models = await this.getAvailableModels();
    return models.some((m) => m.id === modelId);
  }

  async getRateLimitInfo(): Promise<RateLimitInfo | null> {
    return null;
  }

  async testConnection(): Promise<boolean> {
    this.lastTestConnectionError = undefined;
    const url = `${this.baseUrl}/messages`;
    try {
      // Send a minimal chat request to the same endpoint used by actual calls.
      // This catches misconfigurations like a missing /v1 path segment.
      const response = await this.safeFetch(url, {
        method: "POST",
        headers: this.getAnthropicHeaders(),
        body: JSON.stringify({
          model: this.getDefaultModel(),
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10000),
      });

      // 200 = success, 400 = bad request (but endpoint is reachable and authenticated)
      if (response.status === 200 || response.status === 400) {
        return true;
      }

      // Capture the real reason (status + provider message) so the admin UI
      // can show it instead of a generic "failed to connect". A proxy like
      // LiteLLM, for example, returns 401/403 here when the key isn't
      // authorized for the selected model.
      const body = await response.text().catch(() => "");
      this.lastTestConnectionError = this.summarizeHttpError(
        response.status,
        response.statusText,
        body
      );
      return false;
    } catch (error: any) {
      this.lastTestConnectionError = this.describeConnectionError(url, error);
      return false;
    }
  }

  getProviderName(): string {
    return "Anthropic";
  }

  protected extractErrorMessage(error: any): string {
    if (error?.error?.message) {
      return error.error.message;
    }
    if (error?.message) {
      return error.message;
    }
    return "Unknown Anthropic error";
  }

  private isCustomEndpoint(): boolean {
    if (!this.baseUrl) return false;
    try {
      const url = new URL(this.baseUrl);
      return url.hostname !== "api.anthropic.com";
    } catch {
      return true;
    }
  }

  private getAnthropicHeaders(): Record<string, string> {
    const headers = this.getHeaders();
    headers["anthropic-version"] = this.anthropicVersion;

    if (this.isCustomEndpoint()) {
      // LiteLLM and other proxies expect Bearer auth
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    } else {
      headers["x-api-key"] = this.apiKey;
    }

    return headers;
  }

  /**
   * Execute a non-streaming chat request and return the parsed response.
   */
  private async executeChat(
    anthropicRequest: AnthropicRequest,
    timeout: number
  ): Promise<LlmResponse> {
    const response = await this.safeFetchLongRunning(
      `${this.baseUrl}/messages`,
      {
        method: "POST",
        headers: this.getAnthropicHeaders(),
        body: JSON.stringify(anthropicRequest),
        signal: AbortSignal.timeout(timeout),
      }
    );

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = (await response.json()) as AnthropicResponse;

    return {
      content: extractTextContent(data.content),
      model: data.model,
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      finishReason: this.mapStopReason(data.stop_reason),
    };
  }

  /**
   * Fetch from the Anthropic messages endpoint, throwing on non-OK responses.
   * Used by chatStream to separate the fetch from the stream reading.
   */
  private async fetchAnthropicMessage(
    anthropicRequest: AnthropicRequest,
    timeout: number
  ): Promise<Response> {
    const response = await this.safeFetchLongRunning(
      `${this.baseUrl}/messages`,
      {
        method: "POST",
        headers: this.getAnthropicHeaders(),
        body: JSON.stringify(anthropicRequest),
        signal: timeout > 0 ? AbortSignal.timeout(timeout) : undefined,
      }
    );

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return response;
  }

  /**
   * Minimal Messages API request carrying a non-default temperature. Other
   * params (`top_p`, `top_k`) are not probed today — neither is sent by the
   * adapter — but the structure leaves room to extend.
   */
  protected async sendTemperatureProbe(model: string): Promise<void> {
    const probeRequest: AnthropicRequest = {
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      temperature: BaseLlmAdapter.PROBE_TEMPERATURE,
      stream: false,
    };

    // Use fetchAnthropicMessage rather than executeChat: we only care
    // whether the request was accepted, not about the response content.
    // executeChat assumes a text block exists, which can blow up on
    // adaptive-thinking models (the response may have an empty content
    // array or only a thinking block when max_tokens=1).
    // 10s is plenty for a 1-token probe; ignore the configured timeout
    // since this runs from the admin UI where users expect quick feedback.
    const response = await this.fetchAnthropicMessage(probeRequest, 10000);
    // Drain the body so the connection can be released. We don't parse it,
    // and we ignore any error here — a missing/broken body shouldn't fail
    // the probe (mock responses in tests, for instance, don't implement text()).
    try {
      await response.text();
    } catch {
      // ignore
    }
  }

  private extractMessages(messages: LlmRequest["messages"]): {
    systemMessage: string | null;
    userMessages: AnthropicMessage[];
  } {
    let systemMessage: string | null = null;
    const userMessages: AnthropicMessage[] = [];

    for (const message of messages) {
      if (message.role === "system") {
        // The top-level `system` field is text-only by API contract.
        const text = flattenToText(message.content);
        systemMessage = systemMessage ? `${systemMessage}\n\n${text}` : text;
      } else if (message.role === "user" || message.role === "assistant") {
        userMessages.push({
          role: message.role,
          content: this.toAnthropicContent(message.content),
        });
      }
    }

    return { systemMessage, userMessages };
  }

  private toAnthropicContent(
    content: LlmRequest["messages"][number]["content"]
  ): string | AnthropicContentBlock[] {
    if (typeof content === "string") return content;
    if (contentImages(content).length === 0) return flattenToText(content);
    return content.map((part): AnthropicContentBlock =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: part.mimeType,
              data: part.base64,
            },
          }
    );
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const contentType = response.headers.get("content-type");
    let errorData: any;

    if (contentType?.includes("application/json")) {
      errorData = await response.json();
    } else {
      errorData = { error: { message: await response.text() } };
    }

    const message = this.extractErrorMessage(errorData);

    switch (response.status) {
      case 400:
        throw this.createError(message, "BAD_REQUEST", 400);
      case 401:
        throw this.createError(message, "AUTHENTICATION_ERROR", 401);
      case 403:
        throw this.createError(message, "PERMISSION_DENIED", 403);
      case 404:
        throw this.createError(message, "NOT_FOUND", 404);
      case 429:
        const retryAfter = response.headers.get("retry-after");
        throw this.createError(message, "RATE_LIMIT_EXCEEDED", 429, true, {
          retryAfter: retryAfter ? parseInt(retryAfter) : undefined,
        });
      case 500:
      case 502:
      case 503:
        throw this.createError(message, "SERVER_ERROR", response.status, true);
      default:
        throw this.createError(message, "UNKNOWN_ERROR", response.status);
    }
  }

  private mapStopReason(
    reason: string
  ): "stop" | "length" | "content_filter" | "error" {
    switch (reason) {
      case "end_turn":
      case "stop_sequence":
        return "stop";
      case "max_tokens":
        return "length";
      case "refusal":
        return "content_filter";
      default:
        return "error";
    }
  }

  private mapModelInfo(modelId: string): LlmModelInfo {
    // Costs are per 1K tokens (divide $/1M by 1000)
    const modelConfigs: Record<string, Partial<LlmModelInfo>> = {
      "claude-opus-4-7": {
        name: "Claude Opus 4.7",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        inputCostPer1k: 0.005,
        outputCostPer1k: 0.025,
        capabilities: ["text", "code", "vision"],
      },
      "claude-opus-4-6": {
        name: "Claude Opus 4.6",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        inputCostPer1k: 0.005,
        outputCostPer1k: 0.025,
        capabilities: ["text", "code", "vision"],
      },
      "claude-sonnet-4-6": {
        name: "Claude Sonnet 4.6",
        contextWindow: 1000000,
        maxOutputTokens: 64000,
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.015,
        capabilities: ["text", "code", "vision"],
      },
      "claude-haiku-4-5-20251001": {
        name: "Claude Haiku 4.5",
        contextWindow: 200000,
        maxOutputTokens: 64000,
        inputCostPer1k: 0.001,
        outputCostPer1k: 0.005,
        capabilities: ["text", "code", "vision"],
      },
      // Legacy models
      "claude-3-5-sonnet-20241022": {
        name: "Claude 3.5 Sonnet",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.015,
        capabilities: ["text", "code", "vision"],
        deprecated: true,
      },
      "claude-3-5-haiku-20241022": {
        name: "Claude 3.5 Haiku (Retired)",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCostPer1k: 0.0008,
        outputCostPer1k: 0.004,
        capabilities: ["text", "code", "vision"],
        deprecated: true,
      },
      "claude-3-opus-20240229": {
        name: "Claude 3 Opus",
        contextWindow: 200000,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.015,
        outputCostPer1k: 0.075,
        capabilities: ["text", "code", "vision"],
        deprecated: true,
      },
    };

    const config = modelConfigs[modelId] || {
      name: modelId,
      contextWindow: 200000,
      maxOutputTokens: 64000,
      capabilities: ["text", "code", "vision"],
    };

    return {
      id: modelId,
      name: config.name || modelId,
      contextWindow: config.contextWindow || 100000,
      maxOutputTokens: config.maxOutputTokens || 4096,
      inputCostPer1k: config.inputCostPer1k,
      outputCostPer1k: config.outputCostPer1k,
      capabilities: config.capabilities,
    };
  }

  private getDefaultModels(): LlmModelInfo[] {
    return [
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "claude-3-5-sonnet-20241022",
    ].map((id) => this.mapModelInfo(id));
  }
}
