import { BaseLlmAdapter } from "./base.adapter";
import type {
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  LlmModelInfo,
  RateLimitInfo,
  LlmAdapterConfig,
} from "../types";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      role?: string;
    };
    finish_reason: string | null;
  }>;
}

export class OpenAIAdapter extends BaseLlmAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: LlmAdapterConfig) {
    super(config);
    this.apiKey = config.apiKey || "";
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";

    if (!this.apiKey) {
      throw this.createError(
        "OpenAI API key is required",
        "MISSING_API_KEY",
        401
      );
    }
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.validateRequest(request);

    const openAIRequest: OpenAIChatRequest = {
      model: request.model || this.getDefaultModel(),
      messages: request.messages,
      temperature: request.temperature ?? this.config.config.defaultTemperature,
      max_tokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
      stream: false,
    };

    try {
      // Use request timeout if provided, otherwise fall back to config timeout
      const timeout = request.timeout ?? this.getTimeout();
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getOpenAIHeaders(),
        body: JSON.stringify(openAIRequest),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = (await response.json()) as OpenAIChatResponse;

      return {
        content: data.choices[0].message.content,
        model: data.model,
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
        finishReason: this.mapFinishReason(data.choices[0].finish_reason),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw this.createError("Request timeout", "TIMEOUT", 408, true);
      }
      throw error;
    }
  }

  async *chatStream(
    request: LlmRequest
  ): AsyncGenerator<LlmStreamResponse, void, unknown> {
    this.validateRequest(request);

    const openAIRequest: OpenAIChatRequest = {
      model: request.model || this.getDefaultModel(),
      messages: request.messages,
      temperature: request.temperature ?? this.config.config.defaultTemperature,
      max_tokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
      stream: true,
    };

    // Use request timeout if provided, otherwise fall back to config timeout
    const timeout = request.timeout ?? this.getTimeout();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.getOpenAIHeaders(),
      body: JSON.stringify(openAIRequest),
      signal: AbortSignal.timeout(timeout),
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
            if (data === "[DONE]") {
              return;
            }

            try {
              const chunk = JSON.parse(data) as OpenAIStreamChunk;
              const choice = chunk.choices[0];

              if (choice.delta.content) {
                yield {
                  delta: choice.delta.content,
                  model: chunk.model,
                  finishReason: choice.finish_reason
                    ? this.mapFinishReason(choice.finish_reason)
                    : undefined,
                };
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
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getOpenAIHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw this.createError(
          "Failed to fetch models",
          "FETCH_MODELS_ERROR",
          response.status
        );
      }

      const data = await response.json();

      return data.data
        .filter((model: any) => model.id.includes("gpt"))
        .map((model: any) => this.mapModelInfo(model.id));
    } catch (error) {
      console.error("Failed to fetch OpenAI models:", error);
      return this.getDefaultModels();
    }
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
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getOpenAIHeaders(),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("OpenAI test failed:", response.status, text);
      }

      return response.ok;
    } catch (error) {
      console.error("OpenAI test connection error:", error);
      return false;
    }
  }

  getProviderName(): string {
    return "OpenAI";
  }

  protected extractErrorMessage(error: any): string {
    if (error?.error?.message) {
      return error.error.message;
    }
    return "Unknown OpenAI error";
  }

  private getOpenAIHeaders(): Record<string, string> {
    const headers = this.getHeaders();
    headers["Authorization"] = `Bearer ${this.apiKey}`;

    return headers;
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

  private mapFinishReason(
    reason: string
  ): "stop" | "length" | "content_filter" | "error" {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      default:
        return "error";
    }
  }

  private mapModelInfo(modelId: string): LlmModelInfo {
    const modelConfigs: Record<string, Partial<LlmModelInfo>> = {
      "gpt-4-turbo-preview": {
        name: "GPT-4 Turbo",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.01,
        outputCostPer1k: 0.03,
        capabilities: ["text", "code", "vision"],
      },
      "gpt-4": {
        name: "GPT-4",
        contextWindow: 8192,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.03,
        outputCostPer1k: 0.06,
        capabilities: ["text", "code"],
      },
      "gpt-3.5-turbo": {
        name: "GPT-3.5 Turbo",
        contextWindow: 16384,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.0005,
        outputCostPer1k: 0.0015,
        capabilities: ["text", "code"],
      },
      "gpt-4o": {
        name: "GPT-4o",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.005,
        outputCostPer1k: 0.015,
        capabilities: ["text", "code", "vision"],
      },
      "gpt-4o-mini": {
        name: "GPT-4o Mini",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        inputCostPer1k: 0.00015,
        outputCostPer1k: 0.0006,
        capabilities: ["text", "code", "vision"],
      },
    };

    const config = modelConfigs[modelId] || {
      name: modelId,
      contextWindow: 4096,
      maxOutputTokens: 4096,
      capabilities: ["text"],
    };

    return {
      id: modelId,
      name: config.name || modelId,
      contextWindow: config.contextWindow || 4096,
      maxOutputTokens: config.maxOutputTokens || 4096,
      inputCostPer1k: config.inputCostPer1k,
      outputCostPer1k: config.outputCostPer1k,
      capabilities: config.capabilities,
    };
  }

  private getDefaultModels(): LlmModelInfo[] {
    return [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4-turbo-preview",
      "gpt-4",
      "gpt-3.5-turbo",
    ].map((id) => this.mapModelInfo(id));
  }
}
