import { BaseLlmAdapter } from "./base.adapter";
import type {
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  LlmModelInfo,
  RateLimitInfo,
  LlmAdapterConfig,
} from "../types";

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

    const { systemMessage, userMessages } = this.extractMessages(request.messages);

    const anthropicRequest: AnthropicRequest = {
      model: request.model || this.getDefaultModel(),
      messages: userMessages,
      max_tokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
      temperature: request.temperature ?? this.config.config.defaultTemperature,
      stream: false,
    };

    if (systemMessage) {
      anthropicRequest.system = systemMessage;
    }

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: this.getAnthropicHeaders(),
        body: JSON.stringify(anthropicRequest),
        signal: AbortSignal.timeout(this.getTimeout()),
      });

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
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw this.createError(
          "Request timeout",
          "TIMEOUT",
          408,
          true
        );
      }
      throw error;
    }
  }

  async *chatStream(
    request: LlmRequest
  ): AsyncGenerator<LlmStreamResponse, void, unknown> {
    this.validateRequest(request);

    const { systemMessage, userMessages } = this.extractMessages(request.messages);

    const anthropicRequest: AnthropicRequest = {
      model: request.model || this.getDefaultModel(),
      messages: userMessages,
      max_tokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
      temperature: request.temperature ?? this.config.config.defaultTemperature,
      stream: true,
    };

    if (systemMessage) {
      anthropicRequest.system = systemMessage;
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.getAnthropicHeaders(),
      body: JSON.stringify(anthropicRequest),
      signal: AbortSignal.timeout(this.getTimeout()),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
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
              } else if (event.type === "content_block_delta" && event.delta?.text) {
                yield {
                  delta: event.delta.text,
                  model: currentModel,
                  finishReason: event.delta.stop_reason
                    ? this.mapStopReason(event.delta.stop_reason)
                    : undefined,
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
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: this.getAnthropicHeaders(),
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(5000),
      });
      
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

  private getAnthropicHeaders(): Record<string, string> {
    const headers = this.getHeaders();
    headers["x-api-key"] = this.apiKey;
    headers["anthropic-version"] = this.anthropicVersion;
    
    return headers;
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
        throw this.createError(
          message,
          "RATE_LIMIT_EXCEEDED",
          429,
          true,
          { retryAfter: retryAfter ? parseInt(retryAfter) : undefined }
        );
      case 500:
      case 502:
      case 503:
        throw this.createError(message, "SERVER_ERROR", response.status, true);
      default:
        throw this.createError(
          message,
          "UNKNOWN_ERROR",
          response.status
        );
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
    const modelConfigs: Record<string, Partial<LlmModelInfo>> = {
      "claude-3-opus-20240229": {
        name: "Claude 3 Opus",
        contextWindow: 200000,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.015,
        outputCostPer1k: 0.075,
        capabilities: ["text", "code", "vision"],
      },
      "claude-3-sonnet-20240229": {
        name: "Claude 3 Sonnet",
        contextWindow: 200000,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.015,
        capabilities: ["text", "code", "vision"],
      },
      "claude-3-haiku-20240307": {
        name: "Claude 3 Haiku",
        contextWindow: 200000,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.00025,
        outputCostPer1k: 0.00125,
        capabilities: ["text", "code", "vision"],
      },
      "claude-3-5-sonnet-20241022": {
        name: "Claude 3.5 Sonnet",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.015,
        capabilities: ["text", "code", "vision"],
      },
      "claude-3-5-haiku-20241022": {
        name: "Claude 3.5 Haiku",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCostPer1k: 0.0008,
        outputCostPer1k: 0.004,
        capabilities: ["text", "code", "vision"],
      },
    };

    const config = modelConfigs[modelId] || {
      name: modelId,
      contextWindow: 100000,
      maxOutputTokens: 4096,
      capabilities: ["text"],
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
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
    ].map((id) => this.mapModelInfo(id));
  }
}