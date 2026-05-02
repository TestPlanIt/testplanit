import type {
  LlmAdapterConfig,
  LlmModelInfo,
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  ModelCapabilities,
  RateLimitInfo,
} from "../types";
import { BaseLlmAdapter } from "./base.adapter";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
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

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
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

export class AnthropicAdapter extends BaseLlmAdapter {
  private apiKey: string;
  private baseUrl: string;
  private anthropicVersion = "2023-06-01";

  /**
   * Models discovered at runtime to not support the temperature parameter.
   * Populated on first failed request — avoids redundant retries.
   */
  private static modelsWithoutTemperature = new Set<string>();

  constructor(config: LlmAdapterConfig) {
    super(config);
    this.apiKey = config.apiKey || "";
    this.baseUrl = config.baseUrl || "https://api.anthropic.com/v1";

    if (!this.apiKey) {
      throw this.createError(
        "Anthropic API key is required",
        "MISSING_API_KEY",
        401
      );
    }
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.validateRequest(request);

    const { systemMessage, userMessages } = this.extractMessages(
      request.messages
    );

    const model = request.model || this.getDefaultModel();
    const anthropicRequest: AnthropicRequest = {
      model,
      messages: userMessages,
      max_tokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
      stream: false,
    };

    if (this.modelSupportsTemperature(model)) {
      anthropicRequest.temperature =
        request.temperature ?? this.config.config.defaultTemperature;
    }

    if (systemMessage) {
      anthropicRequest.system = systemMessage;
    }

    const timeout = request.timeout ?? this.getTimeout();

    try {
      return await this.executeChat(anthropicRequest, timeout);
    } catch (error: any) {
      if (error instanceof Error && error.name === "AbortError") {
        throw this.createError("Request timeout", "TIMEOUT", 408, true);
      }
      // Retry without temperature if the model doesn't support it, and
      // remember this model for future requests. This is the runtime
      // fallback for integrations that haven't been probed yet — the
      // probed result lives in LlmProviderConfig.settings.modelCapabilities
      // and would have caused us to skip the param above.
      if (this.isTemperatureDeprecatedError(error)) {
        AnthropicAdapter.modelsWithoutTemperature.add(model);
        delete anthropicRequest.temperature;
        return await this.executeChat(anthropicRequest, timeout);
      }
      throw error;
    }
  }

  async *chatStream(
    request: LlmRequest
  ): AsyncGenerator<LlmStreamResponse, void, unknown> {
    this.validateRequest(request);

    const { systemMessage, userMessages } = this.extractMessages(
      request.messages
    );

    const model = request.model || this.getDefaultModel();
    const anthropicRequest: AnthropicRequest = {
      model,
      messages: userMessages,
      max_tokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
      stream: true,
    };

    if (this.modelSupportsTemperature(model)) {
      anthropicRequest.temperature =
        request.temperature ?? this.config.config.defaultTemperature;
    }

    if (systemMessage) {
      anthropicRequest.system = systemMessage;
    }

    // Use request timeout if provided, otherwise fall back to config timeout.
    // timeout === 0 means no timeout (e.g. streaming where the full duration is unknown).
    // Use safeFetchLongRunning to bypass undici's 5-min body timeout.
    const timeout = request.timeout ?? this.getTimeout();
    let response: Response;

    try {
      response = await this.fetchAnthropicMessage(anthropicRequest, timeout);
    } catch (error: any) {
      // Retry without temperature if the model doesn't support it, and
      // remember this model for future requests
      if (this.isTemperatureDeprecatedError(error)) {
        AnthropicAdapter.modelsWithoutTemperature.add(model);
        delete anthropicRequest.temperature;
        response = await this.fetchAnthropicMessage(anthropicRequest, timeout);
      } else {
        throw error;
      }
    }

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
                event.delta?.text
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
    try {
      // Send a minimal chat request to the same endpoint used by actual calls.
      // This catches misconfigurations like a missing /v1 path segment.
      const response = await this.safeFetch(`${this.baseUrl}/messages`, {
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
      return response.status === 200 || response.status === 400;
    } catch {
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
      content: data.content[0].text,
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
   * Check if an error is specifically about temperature being deprecated.
   * Newer Anthropic models (e.g. Opus 4.7 with adaptive thinking) no longer
   * accept the temperature parameter. Rather than maintaining a hardcoded
   * model list, we detect the error and retry without temperature.
   */
  private isTemperatureDeprecatedError(error: any): boolean {
    const message = error?.message || error?.error?.message || "";
    return (
      typeof message === "string" &&
      message.includes("temperature") &&
      message.includes("deprecated")
    );
  }

  /**
   * Whether to include the `temperature` field on requests for this model.
   *
   * Source order:
   * 1. The persisted probe result in `config.settings.modelCapabilities[model]`
   *    (preferred — set during the admin "Test Connection" flow).
   * 2. The in-memory cache populated by the runtime fallback below.
   *
   * Either source returning "unsupported" causes us to skip the param.
   */
  private modelSupportsTemperature(model: string): boolean {
    if (this.getUnsupportedParams(model).includes("temperature")) {
      return false;
    }
    return !AnthropicAdapter.modelsWithoutTemperature.has(model);
  }

  /**
   * Probe the configured model for parameter support. Sends a minimal chat
   * request with `temperature: 1` and watches for the deprecation error;
   * any model that returns it gets `"temperature"` recorded in
   * `unsupportedParams`. Other params (`top_p`, `top_k`) are not probed
   * today — neither is sent by the adapter — but the structure leaves
   * room to extend.
   */
  async probeModelCapabilities(modelId?: string): Promise<ModelCapabilities> {
    const model = modelId || this.getDefaultModel();
    const unsupportedParams: string[] = [];

    const probeRequest: AnthropicRequest = {
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      temperature: 1,
      stream: false,
    };

    try {
      // Use fetchAnthropicMessage rather than executeChat: we only care
      // whether the request was accepted, not about the response content.
      // executeChat assumes data.content[0].text exists, which can blow up
      // on adaptive-thinking models (the response may have an empty content
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
    } catch (error: any) {
      if (this.isTemperatureDeprecatedError(error)) {
        unsupportedParams.push("temperature");
        // Cache locally too so any in-flight requests on this adapter
        // instance benefit immediately.
        AnthropicAdapter.modelsWithoutTemperature.add(model);
      } else {
        // Any other failure (auth, rate limit, network) means we can't
        // probe right now; surface it so the admin sees the real problem.
        throw error;
      }
    }

    return {
      unsupportedParams,
      probedAt: new Date().toISOString(),
    };
  }

  private extractMessages(messages: LlmRequest["messages"]): {
    systemMessage: string | null;
    userMessages: AnthropicMessage[];
  } {
    let systemMessage: string | null = null;
    const userMessages: AnthropicMessage[] = [];

    for (const message of messages) {
      if (message.role === "system") {
        systemMessage = systemMessage
          ? `${systemMessage}\n\n${message.content}`
          : message.content;
      } else if (message.role === "user" || message.role === "assistant") {
        userMessages.push({
          role: message.role,
          content: message.content,
        });
      }
    }

    return { systemMessage, userMessages };
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
