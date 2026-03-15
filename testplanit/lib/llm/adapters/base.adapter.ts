/**
 * Base adapter interface for LLM providers
 */

import type {
  LlmAdapterConfig, LlmError, LlmModelInfo, LlmRequest,
  LlmResponse,
  LlmStreamResponse, RateLimitInfo
} from "../types";

/**
 * SSRF prevention for LLM adapter URLs.
 *
 * Unlike the stricter `isSsrfSafe` in `utils/ssrf.ts` (which blocks all
 * private IPs), this check intentionally allows localhost and private
 * network addresses because adapters like Ollama legitimately use local
 * endpoints. It only blocks cloud metadata services and non-HTTP protocols.
 */
const SSRF_BLOCKED_HOSTS = [
  "169.254.169.254", // AWS/GCP/Azure instance metadata
  "metadata.google.internal", // GCP metadata
  "metadata.google",
  "100.100.100.200", // Alibaba Cloud metadata
];

/**
 * Validates a URL against the SSRF blocklist and returns a sanitized URL
 * string derived from the parsed URL object (breaks the taint chain for
 * static analysis tools like CodeQL).
 */
function sanitizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`URL must use http or https protocol: ${url}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (SSRF_BLOCKED_HOSTS.includes(hostname)) {
    throw new Error(`Requests to ${hostname} are not allowed`);
  }

  // Return the href from the parsed URL object rather than the original
  // string so that CodeQL considers the taint chain broken.
  return parsed.href;
}

export abstract class BaseLlmAdapter {
  protected config: LlmAdapterConfig;

  constructor(config: LlmAdapterConfig) {
    this.config = config;
    if (config.baseUrl) {
      sanitizeUrl(config.baseUrl);
    }
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
   * Fetch wrapper that validates the URL against SSRF blocklist before
   * making the request. Use this instead of bare `fetch()` in adapters.
   *
   * Hostname comparisons are inlined with explicit `===` checks so that
   * CodeQL's HostnameSanitizerGuard recognises them as barrier guards.
   */
  protected safeFetch(
    url: string,
    init?: RequestInit
  ): Promise<Response> {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`URL must use http or https protocol: ${url}`);
    }

    const h = parsed.hostname;
    if (
      h === "169.254.169.254" ||
      h === "metadata.google.internal" ||
      h === "metadata.google" ||
      h === "100.100.100.200"
    ) {
      throw new Error(`Requests to ${h} are not allowed`);
    }

    return fetch(parsed.href, init);
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
