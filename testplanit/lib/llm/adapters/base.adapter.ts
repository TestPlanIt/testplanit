/**
 * Base adapter interface for LLM providers
 */

import type {
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  LlmAdapterConfig,
  LlmModelInfo,
  LlmError,
  RateLimitInfo,
} from "../types";

export abstract class BaseLlmAdapter {
  protected config: LlmAdapterConfig;

  constructor(config: LlmAdapterConfig) {
    this.config = config;
  }

  /**
   * Send a chat completion request
   */
  abstract chat(request: LlmRequest): Promise<LlmResponse>;

  /**
   * Send a streaming chat completion request
   */
  abstract chatStream(
    request: LlmRequest
  ): AsyncGenerator<LlmStreamResponse, void, unknown>;

  /**
   * Get available models for this provider
   */
  abstract getAvailableModels(): Promise<LlmModelInfo[]>;

  /**
   * Validate if a model is available
   */
  abstract isModelAvailable(modelId: string): Promise<boolean>;

  /**
   * Get rate limit information
   */
  abstract getRateLimitInfo(): Promise<RateLimitInfo | null>;

  /**
   * Test the connection to the provider
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Get the provider name
   */
  abstract getProviderName(): string;

  /**
   * Get default model for this provider
   */
  getDefaultModel(): string {
    return this.config.config.defaultModel;
  }

  /**
   * Get timeout for requests
   */
  getTimeout(): number {
    return this.config.config.timeout;
  }

  /**
   * Create an LLM error
   */
  protected createError(
    message: string,
    code: string,
    statusCode?: number,
    retryable = false,
    details?: any
  ): LlmError {
    const error = new Error(message) as LlmError;
    error.code = code;
    error.statusCode = statusCode;
    error.provider = this.getProviderName() as any;
    error.retryable = retryable;
    error.details = details;
    return error;
  }

  /**
   * Calculate cost for a request
   */
  protected calculateCost(
    promptTokens: number,
    completionTokens: number
  ): {
    inputCost: number;
    outputCost: number;
    totalCost: number;
  } {
    const inputCost =
      (promptTokens / 1000) * Number(this.config.config.costPerInputToken);
    const outputCost =
      (completionTokens / 1000) * Number(this.config.config.costPerOutputToken);

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  /**
   * Validate request parameters
   */
  protected validateRequest(request: LlmRequest): void {
    if (!request.messages || request.messages.length === 0) {
      throw this.createError(
        "Messages array cannot be empty",
        "INVALID_REQUEST",
        400
      );
    }

    if (
      request.maxTokens &&
      request.maxTokens > this.config.config.maxTokensPerRequest
    ) {
      throw this.createError(
        `Max tokens ${request.maxTokens} exceeds limit ${this.config.config.maxTokensPerRequest}`,
        "MAX_TOKENS_EXCEEDED",
        400
      );
    }

    if (
      request.temperature !== undefined &&
      (request.temperature < 0 || request.temperature > 2)
    ) {
      throw this.createError(
        "Temperature must be between 0 and 2",
        "INVALID_TEMPERATURE",
        400
      );
    }
  }

  /**
   * Get headers for API requests
   */
  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.additionalHeaders) {
      Object.assign(headers, this.config.additionalHeaders);
    }

    return headers;
  }

  /**
   * Handle rate limiting
   */
  protected async handleRateLimit(retryAfter?: number): Promise<void> {
    const delay = retryAfter ? retryAfter * 1000 : 60000; // Default to 1 minute
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Extract error message from provider response
   */
  protected abstract extractErrorMessage(error: any): string;
}

/**
 * Factory function to create adapter instances
 */
export type AdapterFactory = (config: LlmAdapterConfig) => BaseLlmAdapter;
