import { BaseLlmAdapter } from "./base.adapter";
import type {
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  LlmModelInfo,
  RateLimitInfo,
  LlmAdapterConfig,
  OllamaModel,
  OllamaPullProgress,
} from "../types";

interface OllamaSettings {
  keepAlive?: string;
}

interface OllamaGenerateRequest {
  model: string;
  prompt?: string;
  messages?: Array<{
    role: string;
    content: string;
  }>;
  stream?: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_k?: number;
    top_p?: number;
    seed?: number;
  };
  keep_alive?: string;
}

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
  };
  response?: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
  };
  response?: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaAdapter extends BaseLlmAdapter {
  private baseUrl: string;
  private keepAlive: string;

  constructor(config: LlmAdapterConfig) {
    super(config);
    this.baseUrl = config.baseUrl || "http://localhost:11434";
    const settings = config.integration.settings as OllamaSettings | null;
    this.keepAlive = settings?.keepAlive || "5m";
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.validateRequest(request);

    const ollamaRequest: OllamaGenerateRequest = {
      model: request.model || this.getDefaultModel(),
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: false,
      options: {
        temperature: request.temperature ?? this.config.config.defaultTemperature,
        num_predict: request.maxTokens ?? this.config.config.defaultMaxTokens,
      },
      keep_alive: this.keepAlive,
    };

    try {
      // Use request timeout if provided, otherwise fall back to config timeout
      const timeout = request.timeout ?? this.getTimeout();
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(ollamaRequest),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = (await response.json()) as OllamaGenerateResponse;

      const promptTokens = data.prompt_eval_count || 0;
      const completionTokens = data.eval_count || 0;

      return {
        content: data.message?.content || data.response || "",
        model: data.model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        finishReason: data.done ? "stop" : "error",
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

    const ollamaRequest: OllamaGenerateRequest = {
      model: request.model || this.getDefaultModel(),
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: true,
      options: {
        temperature: request.temperature ?? this.config.config.defaultTemperature,
        num_predict: request.maxTokens ?? this.config.config.defaultMaxTokens,
      },
      keep_alive: this.keepAlive,
    };

    // Use request timeout if provided, otherwise fall back to config timeout
    const timeout = request.timeout ?? this.getTimeout();
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(ollamaRequest),
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
          if (line.trim()) {
            try {
              const chunk = JSON.parse(line) as OllamaStreamChunk;
              
              if (chunk.message?.content || chunk.response) {
                yield {
                  delta: chunk.message?.content || chunk.response || "",
                  model: chunk.model,
                  finishReason: chunk.done ? "stop" : undefined,
                };
              }
              
              if (chunk.done) {
                return;
              }
            } catch (e) {
              console.error("Failed to parse Ollama stream chunk:", e);
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
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders(),
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
      
      return (data.models || []).map((model: OllamaModel) => 
        this.mapOllamaModelInfo(model)
      );
    } catch (error) {
      console.error("Failed to fetch Ollama models:", error);
      return [];
    }
  }

  async isModelAvailable(modelId: string): Promise<boolean> {
    const models = await this.getAvailableModels();
    return models.some((m) => m.id === modelId);
  }

  async *pullModel(modelName: string): AsyncGenerator<OllamaPullProgress, void, unknown> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ name: modelName }),
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
          if (line.trim()) {
            try {
              const progress = JSON.parse(line) as OllamaPullProgress;
              yield progress;
              
              if (progress.status === "success") {
                return;
              }
            } catch (e) {
              console.error("Failed to parse pull progress:", e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async deleteModel(modelName: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/delete`, {
      method: "DELETE",
      headers: this.getHeaders(),
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }
  }

  async getRateLimitInfo(): Promise<RateLimitInfo | null> {
    return null;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getProviderName(): string {
    return "Ollama";
  }

  protected extractErrorMessage(error: any): string {
    if (error?.error) {
      return error.error;
    }
    if (error?.message) {
      return error.message;
    }
    return "Unknown Ollama error";
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const contentType = response.headers.get("content-type");
    let errorData: any;

    if (contentType?.includes("application/json")) {
      errorData = await response.json();
    } else {
      errorData = { error: await response.text() };
    }

    const message = this.extractErrorMessage(errorData);

    switch (response.status) {
      case 400:
        throw this.createError(message, "BAD_REQUEST", 400);
      case 404:
        if (message.includes("model") && message.includes("not found")) {
          throw this.createError(
            message,
            "MODEL_NOT_FOUND",
            404,
            false,
            { suggestion: "Try pulling the model first" }
          );
        }
        throw this.createError(message, "NOT_FOUND", 404);
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

  private mapOllamaModelInfo(model: OllamaModel): LlmModelInfo {
    const knownModels: Record<string, Partial<LlmModelInfo>> = {
      "llama2": {
        contextWindow: 4096,
        maxOutputTokens: 4096,
        capabilities: ["text", "code"],
      },
      "llama3": {
        contextWindow: 8192,
        maxOutputTokens: 8192,
        capabilities: ["text", "code"],
      },
      "mistral": {
        contextWindow: 8192,
        maxOutputTokens: 8192,
        capabilities: ["text", "code"],
      },
      "mixtral": {
        contextWindow: 32768,
        maxOutputTokens: 32768,
        capabilities: ["text", "code"],
      },
      "phi": {
        contextWindow: 2048,
        maxOutputTokens: 2048,
        capabilities: ["text"],
      },
      "phi3": {
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: ["text", "code"],
      },
      "codellama": {
        contextWindow: 16384,
        maxOutputTokens: 16384,
        capabilities: ["code"],
      },
      "deepseek-coder": {
        contextWindow: 16384,
        maxOutputTokens: 16384,
        capabilities: ["code"],
      },
      "gemma": {
        contextWindow: 8192,
        maxOutputTokens: 8192,
        capabilities: ["text", "code"],
      },
      "qwen": {
        contextWindow: 32768,
        maxOutputTokens: 32768,
        capabilities: ["text", "code"],
      },
    };

    const baseModelName = model.name.split(":")[0].toLowerCase();
    const config = knownModels[baseModelName] || {
      contextWindow: 4096,
      maxOutputTokens: 4096,
      capabilities: ["text"],
    };

    return {
      id: model.name,
      name: `${model.name} (${this.formatSize(model.size)})`,
      contextWindow: config.contextWindow || 4096,
      maxOutputTokens: config.maxOutputTokens || 4096,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
      capabilities: config.capabilities,
    };
  }

  private formatSize(bytes: number): string {
    const sizes = ["B", "KB", "MB", "GB"];
    if (bytes === 0) return "0 B";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${Math.round(bytes / Math.pow(1024, i) * 10) / 10} ${sizes[i]}`;
  }
}