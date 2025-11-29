import { BaseLlmAdapter } from "./base.adapter";
import type {
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  LlmModelInfo,
  RateLimitInfo,
  LlmAdapterConfig,
} from "../types";

interface CustomLlmSettings {
  endpoint?: string;
  apiKey?: string;
  requestTemplate?: Record<string, unknown>;
  responseMapping?: Record<string, unknown>;
  streamResponseMapping?: Record<string, unknown>;
  modelsEndpoint?: string;
  modelsResponsePath?: string;
  errorMessagePath?: string;
  authHeader?: string;
  authPrefix?: string;
  headers?: Record<string, string>;
  requestFieldMappings?: Record<string, string>;
  modelFieldMappings?: Record<string, string>;
  models?: Array<Record<string, unknown>>;
}

interface CustomApiRequest {
  model?: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: any;
}

interface CustomApiResponse {
  content?: string;
  text?: string;
  response?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
    text?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  model?: string;
  [key: string]: any;
}

export class CustomLlmAdapter extends BaseLlmAdapter {
  private endpoint: string;
  private apiKey?: string;
  private requestTemplate: any;
  private responseMapping: any;
  private streamResponseMapping: any;

  constructor(config: LlmAdapterConfig) {
    super(config);
    
    const settings = config.integration.settings as CustomLlmSettings | null;
    this.endpoint = config.baseUrl || settings?.endpoint || "";
    this.apiKey = config.apiKey || settings?.apiKey;
    this.requestTemplate = settings?.requestTemplate || {};
    this.responseMapping = settings?.responseMapping || {};
    this.streamResponseMapping = settings?.streamResponseMapping || {};

    if (!this.endpoint) {
      throw this.createError(
        "Custom API endpoint is required",
        "MISSING_ENDPOINT",
        400
      );
    }
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.validateRequest(request);

    const customRequest = this.buildCustomRequest(request, false);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: this.getCustomHeaders(),
        body: JSON.stringify(customRequest),
        signal: AbortSignal.timeout(this.getTimeout()),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = (await response.json()) as CustomApiResponse;
      return this.mapCustomResponse(data, request.model || this.getDefaultModel());
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

    const customRequest = this.buildCustomRequest(request, true);

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: this.getCustomHeaders(),
      body: JSON.stringify(customRequest),
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
    const isSSE = response.headers.get("content-type")?.includes("text/event-stream");

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        if (isSSE) {
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                return;
              }

              try {
                const chunk = JSON.parse(data);
                const mapped = this.mapStreamChunk(chunk, request.model || this.getDefaultModel());
                if (mapped.delta) {
                  yield mapped;
                }
              } catch (e) {
                console.error("Failed to parse stream chunk:", e);
              }
            }
          }
        } else {
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim()) {
              try {
                const chunk = JSON.parse(line);
                const mapped = this.mapStreamChunk(chunk, request.model || this.getDefaultModel());
                if (mapped.delta) {
                  yield mapped;
                }
              } catch (e) {
                console.error("Failed to parse stream chunk:", e);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async getAvailableModels(): Promise<LlmModelInfo[]> {
    const settings = this.config.integration.settings as CustomLlmSettings | null;
    const modelsEndpoint = settings?.modelsEndpoint;
    
    if (!modelsEndpoint) {
      return this.getConfiguredModels();
    }

    try {
      const response = await fetch(modelsEndpoint, {
        headers: this.getCustomHeaders(),
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
      const modelsPath = (this.config.integration.settings as CustomLlmSettings | null)?.modelsResponsePath || "models";
      const models = this.getNestedValue(data, modelsPath) || [];
      
      return models.map((model: any) => this.mapCustomModelInfo(model));
    } catch (error) {
      console.error("Failed to fetch custom models:", error);
      return this.getConfiguredModels();
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
      const testRequest = this.buildCustomRequest(
        {
          messages: [{ role: "user", content: "test" }],
          maxTokens: 1,
          userId: "test",
          feature: "test",
        },
        false
      );

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: this.getCustomHeaders(),
        body: JSON.stringify(testRequest),
        signal: AbortSignal.timeout(5000),
      });
      
      return response.status === 200 || response.status === 400;
    } catch {
      return false;
    }
  }

  getProviderName(): string {
    return this.config.integration.name || "Custom LLM";
  }

  protected extractErrorMessage(error: any): string {
    const errorPath = (this.config.integration.settings as CustomLlmSettings | null)?.errorMessagePath;
    
    if (errorPath) {
      const message = this.getNestedValue(error, errorPath);
      if (message) return String(message);
    }

    if (error?.error?.message) return error.error.message;
    if (error?.message) return error.message;
    if (error?.error) return String(error.error);
    
    return "Unknown custom API error";
  }

  private getCustomHeaders(): Record<string, string> {
    const headers = this.getHeaders();
    
    if (this.apiKey) {
      const settings = this.config.integration.settings as CustomLlmSettings | null;
      const authHeader = settings?.authHeader || "Authorization";
      const authPrefix = settings?.authPrefix || "Bearer";
      headers[authHeader] = `${authPrefix} ${this.apiKey}`;
    }

    const settings = this.config.integration.settings as CustomLlmSettings | null;
    const additionalHeaders = settings?.headers || {};
    Object.assign(headers, additionalHeaders);

    return headers;
  }

  private buildCustomRequest(request: LlmRequest, stream: boolean): CustomApiRequest {
    const template = { ...this.requestTemplate };
    
    const customRequest: CustomApiRequest = {
      model: request.model || this.getDefaultModel(),
      messages: request.messages,
      temperature: request.temperature ?? this.config.config.defaultTemperature,
      max_tokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
      stream,
      ...template,
    };

    const settings = this.config.integration.settings as CustomLlmSettings | null;
    const fieldMappings = settings?.requestFieldMappings || {};
    
    for (const [standardField, customField] of Object.entries(fieldMappings)) {
      if (customRequest[standardField] !== undefined) {
        customRequest[customField as string] = customRequest[standardField];
        if (customField !== standardField) {
          delete customRequest[standardField];
        }
      }
    }

    return customRequest;
  }

  private mapCustomResponse(data: CustomApiResponse, model: string): LlmResponse {
    let content = "";
    let promptTokens = 0;
    let completionTokens = 0;

    if (this.responseMapping.content) {
      content = this.getNestedValue(data, this.responseMapping.content) || "";
    } else {
      content = data.content || 
                data.text || 
                data.response ||
                data.choices?.[0]?.message?.content ||
                data.choices?.[0]?.text ||
                "";
    }

    if (this.responseMapping.promptTokens) {
      promptTokens = this.getNestedValue(data, this.responseMapping.promptTokens) || 0;
    } else {
      promptTokens = data.usage?.prompt_tokens || 
                     data.usage?.input_tokens || 
                     0;
    }

    if (this.responseMapping.completionTokens) {
      completionTokens = this.getNestedValue(data, this.responseMapping.completionTokens) || 0;
    } else {
      completionTokens = data.usage?.completion_tokens || 
                         data.usage?.output_tokens || 
                         0;
    }

    return {
      content,
      model: data.model || model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      finishReason: "stop",
    };
  }

  private mapStreamChunk(chunk: any, model: string): LlmStreamResponse {
    let delta = "";

    if (this.streamResponseMapping.delta) {
      delta = this.getNestedValue(chunk, this.streamResponseMapping.delta) || "";
    } else {
      delta = chunk.delta?.content ||
              chunk.delta?.text ||
              chunk.content ||
              chunk.text ||
              chunk.choices?.[0]?.delta?.content ||
              chunk.choices?.[0]?.text ||
              "";
    }

    return {
      delta,
      model: chunk.model || model,
      finishReason: chunk.finish_reason || chunk.done ? "stop" : undefined,
    };
  }

  private mapCustomModelInfo(model: any): LlmModelInfo {
    const settings = this.config.integration.settings as CustomLlmSettings | null;
    const modelMapping = settings?.modelFieldMappings || {};
    
    return {
      id: this.getNestedValue(model, modelMapping.id || "id") || model.id || model.name || "unknown",
      name: this.getNestedValue(model, modelMapping.name || "name") || model.name || model.id || "Unknown Model",
      contextWindow: this.getNestedValue(model, modelMapping.contextWindow || "context_window") || 
                     model.context_window || model.max_context || 4096,
      maxOutputTokens: this.getNestedValue(model, modelMapping.maxOutputTokens || "max_tokens") || 
                       model.max_tokens || model.max_output || 4096,
      inputCostPer1k: this.getNestedValue(model, modelMapping.inputCost || "input_cost") || 0,
      outputCostPer1k: this.getNestedValue(model, modelMapping.outputCost || "output_cost") || 0,
      capabilities: this.getNestedValue(model, modelMapping.capabilities || "capabilities") || ["text"],
    };
  }

  private getConfiguredModels(): LlmModelInfo[] {
    const settings = this.config.integration.settings as CustomLlmSettings | null;
    const configuredModels = settings?.models || [];
    
    return configuredModels.map((model: any) => ({
      id: model.id || model.name,
      name: model.name || model.id,
      contextWindow: model.contextWindow || 4096,
      maxOutputTokens: model.maxOutputTokens || 4096,
      inputCostPer1k: model.inputCostPer1k || 0,
      outputCostPer1k: model.outputCostPer1k || 0,
      capabilities: model.capabilities || ["text"],
    }));
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
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
}