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

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenAIContentPart[];
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_completion_tokens?: number;
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
      content: string | null;
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
        `${this.getProviderName()} API key is required`,
        "MISSING_API_KEY",
        401
      );
    }
  }

  /**
   * Translate the multimodal message union into chat.completions shape.
   * System messages flatten to text (parity with the Anthropic adapter);
   * user/assistant parts become text + `image_url` data-URI entries. A parts
   * array with no images collapses back to a plain string so requests to
   * text-only deployments keep their pre-multimodal wire shape.
   */
  protected toOpenAIMessages(
    messages: LlmRequest["messages"]
  ): OpenAIMessage[] {
    return messages.map((message) => {
      if (typeof message.content === "string") {
        return { role: message.role, content: message.content };
      }
      if (
        message.role === "system" ||
        contentImages(message.content).length === 0
      ) {
        return { role: message.role, content: flattenToText(message.content) };
      }
      return {
        role: message.role,
        content: message.content.map((part): OpenAIContentPart =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : {
                type: "image_url",
                image_url: {
                  url: `data:${part.mimeType};base64,${part.base64}`,
                },
              }
        ),
      };
    });
  }

  /**
   * Build the chat.completions request body. OpenAI-compatible providers with
   * a slightly different parameter surface (DeepSeek: `max_tokens`,
   * `thinking`) override this instead of `chat` / `chatStream`, so transport,
   * error mapping, and SSE parsing stay shared.
   */
  protected buildChatRequest(
    request: LlmRequest,
    stream: boolean
  ): OpenAIChatRequest {
    return {
      model: request.model || this.getDefaultModel(),
      messages: this.toOpenAIMessages(request.messages),
      temperature: request.temperature ?? this.config.config.defaultTemperature,
      max_completion_tokens:
        request.maxTokens ?? this.config.config.defaultMaxTokens,
      stream,
    };
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.validateRequest(request);

    const openAIRequest = this.buildChatRequest(request, false);

    try {
      // Use request timeout if provided, otherwise fall back to config timeout
      const timeout = request.timeout ?? this.getTimeout();
      const response = await this.safeFetchLongRunning(
        this.getChatCompletionsUrl(),
        {
          method: "POST",
          headers: this.getOpenAIHeaders(),
          body: JSON.stringify(openAIRequest),
          signal: AbortSignal.timeout(timeout),
        }
      );

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = (await response.json()) as OpenAIChatResponse;

      return {
        content: data.choices[0].message.content ?? "",
        model: data.model,
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
        finishReason: this.mapFinishReason(data.choices[0].finish_reason),
      };
    } catch (error) {
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

    const openAIRequest = this.buildChatRequest(request, true);

    // Use request timeout if provided, otherwise fall back to config timeout.
    // timeout === 0 means no timeout (e.g. streaming where the full duration is unknown).
    // Use safeFetchLongRunning to bypass undici's 5-min body timeout.
    const timeout = request.timeout ?? this.getTimeout();
    const response = await this.safeFetchLongRunning(
      this.getChatCompletionsUrl(),
      {
        method: "POST",
        headers: this.getOpenAIHeaders(),
        body: JSON.stringify(openAIRequest),
        signal: timeout > 0 ? AbortSignal.timeout(timeout) : undefined,
      }
    );

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
              const mappedFinishReason = choice.finish_reason
                ? this.mapFinishReason(choice.finish_reason)
                : undefined;

              if (choice.delta.content) {
                yield {
                  delta: choice.delta.content,
                  model: chunk.model,
                  finishReason: mappedFinishReason,
                };
              } else if (mappedFinishReason) {
                // Final chunk carries finish_reason but no content — yield it so
                // callers can detect truncation (finishReason === "length") etc.
                yield {
                  delta: "",
                  model: chunk.model,
                  finishReason: mappedFinishReason,
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
      const response = await this.safeFetch(`${this.baseUrl}/models`, {
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
    this.lastTestConnectionError = undefined;
    const url = `${this.baseUrl}/models`;
    try {
      const response = await this.safeFetch(url, {
        headers: this.getOpenAIHeaders(),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return true;
      }

      // Capture the real reason (status + provider message) so the admin UI
      // can show it instead of a generic "failed to connect".
      const text = await response.text().catch(() => "");
      this.lastTestConnectionError = this.summarizeHttpError(
        response.status,
        response.statusText,
        text
      );
      console.error("OpenAI test failed:", response.status, text);
      return false;
    } catch (error) {
      this.lastTestConnectionError = this.describeConnectionError(url, error);
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

  protected getOpenAIHeaders(): Record<string, string> {
    const headers = this.getHeaders();
    headers["Authorization"] = `Bearer ${this.apiKey}`;

    return headers;
  }

  protected getChatCompletionsUrl(): string {
    return `${this.baseUrl}/chat/completions`;
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
        deprecated: true,
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
    return ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo-preview", "gpt-4"].map((id) =>
      this.mapModelInfo(id)
    );
  }
}
