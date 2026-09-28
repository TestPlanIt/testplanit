/**
 * Base adapter interface for LLM providers
 */

import type {
  LlmAdapterConfig,
  LlmError,
  LlmModelInfo,
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  ModelCapabilities,
  RateLimitInfo,
  SettingsWithCapabilities,
} from "../types";
import { isCloudMetadataHostname } from "~/lib/utils/ssrf";

/**
 * Validates an adapter base URL at construction time: http(s) only and no
 * cloud metadata endpoints — the same policy `safeFetch` re-applies to the
 * full URL of every request. Intentionally allows localhost and private
 * network addresses because adapters like Ollama legitimately use local
 * endpoints.
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
  if (isCloudMetadataHostname(hostname)) {
    throw new Error(`Requests to ${hostname} are not allowed`);
  }

  // Return the href from the parsed URL object rather than the original
  // string so that CodeQL considers the taint chain broken.
  return parsed.href;
}

export abstract class BaseLlmAdapter {
  protected config: LlmAdapterConfig;

  /**
   * Models discovered at runtime to reject the `temperature` parameter,
   * keyed by `${provider}:${model}`. Populated on the first rejected request
   * so the process never pays for the failed-and-retried round trip twice.
   * Shared across adapter instances because each request builds a fresh one.
   */
  private static modelsWithoutTemperature = new Set<string>();

  /**
   * Detail about why the most recent `testConnection()` attempt failed
   * (HTTP status + provider message, or a network/timeout description).
   * Adapters set this so callers can surface the real reason instead of a
   * generic "failed to connect". Undefined after a successful attempt or
   * when an adapter doesn't record detail.
   */
  protected lastTestConnectionError?: string;

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
   * Send a minimal request that carries a non-default `temperature` for the
   * given model. The value must be one the provider will actually reject:
   * Anthropic's adaptive-thinking models reject any temperature, while a
   * LiteLLM proxy in front of them accepts `1` and rejects everything else.
   *
   * Adapters that can express such a probe implement this; the base
   * `probeModelCapabilities` turns a temperature-rejection error into an
   * `unsupportedParams` entry and re-throws anything else.
   */
  protected sendTemperatureProbe?(model: string): Promise<void>;

  /** Temperature used by `sendTemperatureProbe` implementations. */
  protected static readonly PROBE_TEMPERATURE = 0.5;

  /**
   * Probe a model to determine which optional request parameters it accepts.
   *
   * Called from the admin "Test Connection" flow during integration setup.
   * Results are persisted in `LlmProviderConfig.settings.modelCapabilities`
   * so that subsequent chat requests skip unsupported params on the first
   * try. Adapters without a `sendTemperatureProbe` (Gemini, Ollama) report
   * no unsupported params; the runtime fallback still covers them if they
   * ever adopt one.
   */
  async probeModelCapabilities(modelId?: string): Promise<ModelCapabilities> {
    const model = modelId || this.getDefaultModel();
    const unsupportedParams: string[] = [];

    if (this.sendTemperatureProbe) {
      try {
        await this.sendTemperatureProbe(model);
      } catch (error) {
        if (this.isTemperatureRejectedError(error)) {
          unsupportedParams.push("temperature");
          // Cache locally too so any in-flight requests benefit immediately.
          this.rememberTemperatureUnsupported(model);
        } else {
          // Any other failure (auth, rate limit, network) means we can't
          // probe right now; surface it so the admin sees the real problem.
          throw error;
        }
      }
    }

    return {
      unsupportedParams,
      probedAt: new Date().toISOString(),
    };
  }

  /**
   * Whether an error says the model rejected the `temperature` parameter.
   * Matches Anthropic's own wording ("`temperature` is deprecated for this
   * model") and the LiteLLM proxy's ("does not support temperature=0.7.
   * Only temperature=1 is supported"). Anything mentioning temperature
   * together with a support/deprecation complaint counts; a range error
   * like "temperature must be between 0 and 2" does not.
   */
  protected isTemperatureRejectedError(error: any): boolean {
    const message = error?.message || error?.error?.message || "";
    if (typeof message !== "string" || !/temperature/i.test(message)) {
      return false;
    }
    return /deprecated|not supported|does not support|unsupported/i.test(
      message
    );
  }

  /**
   * Whether to include the `temperature` field on requests for this model.
   *
   * Source order:
   * 1. The persisted probe result in `config.settings.modelCapabilities`
   *    (preferred — set during the admin "Test Connection" flow).
   * 2. The in-process cache populated when a live request was rejected.
   */
  protected modelSupportsTemperature(model: string): boolean {
    if (this.getUnsupportedParams(model).includes("temperature")) {
      return false;
    }
    return !BaseLlmAdapter.modelsWithoutTemperature.has(
      this.temperatureCacheKey(model)
    );
  }

  protected rememberTemperatureUnsupported(model: string): void {
    BaseLlmAdapter.modelsWithoutTemperature.add(
      this.temperatureCacheKey(model)
    );
  }

  private temperatureCacheKey(model: string): string {
    return `${this.config.integration.provider}:${model}`;
  }

  /**
   * Run `attempt` and, if the provider rejects the `temperature` parameter,
   * remember that for the model and run it once more. `attempt` must build
   * its request body from `modelSupportsTemperature(model)` on every call so
   * the second run leaves the field out. A second rejection propagates.
   */
  protected async withTemperatureFallback<T>(
    model: string,
    attempt: () => Promise<T>
  ): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (this.isTemperatureRejectedError(error)) {
        this.rememberTemperatureUnsupported(model);
        return await attempt();
      }
      throw error;
    }
  }

  /**
   * Get the provider name
   */
  abstract getProviderName(): string;

  /**
   * Read the list of unsupported parameters for a given model from the
   * persisted capabilities in `LlmProviderConfig.settings.modelCapabilities`.
   * Adapters call this before adding optional params to a request so they
   * can skip ones the model has been probed to reject.
   */
  protected getUnsupportedParams(modelId: string): string[] {
    const settings = this.config.config
      .settings as SettingsWithCapabilities | null;
    return settings?.modelCapabilities?.[modelId]?.unsupportedParams ?? [];
  }

  /**
   * Get default model for this provider
   */
  getDefaultModel(): string {
    return this.config.config.defaultModel;
  }

  /**
   * Return the reason the most recent `testConnection()` call failed, if the
   * adapter recorded one. See {@link lastTestConnectionError}.
   */
  getLastTestConnectionError(): string | undefined {
    return this.lastTestConnectionError;
  }

  /**
   * Strip the query string and any embedded credentials from a URL so it's
   * safe to include in user-facing error messages / logs (e.g. Gemini passes
   * the API key as a `?key=` query param). Returns the input unchanged if it
   * can't be parsed.
   */
  protected redactUrlForDisplay(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url;
    }
  }

  /**
   * Build a concise one-line reason from a failed HTTP response. Handles the
   * common JSON error shapes — Anthropic/OpenAI `{ error: { message } }`,
   * FastAPI/LiteLLM `{ detail }`, and plain `{ message }` — and falls back to
   * a truncated raw body. Used by `testConnection()` implementations to record
   * why a connection attempt failed instead of dropping the reason.
   */
  protected summarizeHttpError(
    status: number,
    statusText: string,
    body: string
  ): string {
    let detail = "";
    try {
      const json = JSON.parse(body);
      const candidate =
        json?.error?.message ??
        (typeof json?.error === "string" ? json.error : undefined) ??
        json?.detail ??
        json?.message;
      if (typeof candidate === "string") {
        detail = candidate;
      }
    } catch {
      detail = body.trim().slice(0, 300);
    }
    const base = statusText ? `${status} ${statusText}` : `${status}`;
    return detail ? `${base}: ${detail}` : base;
  }

  /**
   * Turn an exception thrown while attempting a connection into a concise,
   * human-readable reason, distinguishing timeouts from other network errors.
   * The URL is redacted so it's safe to surface.
   */
  protected describeConnectionError(url: string, error: any): string {
    const safeUrl = this.redactUrlForDisplay(url);
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return `Request timed out (${safeUrl}).`;
    }
    return `Network error reaching ${safeUrl}: ${
      error?.message ?? "unknown error"
    }`;
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
   * Unlike the stricter `ssrfSafeFetch` in `utils/ssrf.ts` (which blocks all
   * private IPs), this check intentionally allows localhost and private
   * network addresses because adapters like Ollama legitimately use local
   * endpoints. It only blocks cloud metadata services and non-HTTP protocols.
   * The hostname check stays a guard condition in this function — with the
   * comparisons one call deep as explicit `===` checks — so CodeQL's
   * HostnameSanitizerGuard recognises it as a barrier guard.
   */
  protected safeFetch(url: string, init?: RequestInit): Promise<Response> {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`URL must use http or https protocol: ${url}`);
    }

    const h = parsed.hostname;
    if (isCloudMetadataHostname(h)) {
      throw new Error(`Requests to ${h} are not allowed`);
    }

    return fetch(parsed.href, init);
  }

  /**
   * Fetch wrapper that disables Node.js undici's default 5-minute body timeout.
   * Use this for LLM chat calls that may take longer than 5 minutes (e.g., large
   * prompts on slow local models). The AbortSignal timeout controls the actual
   * timeout instead of undici's internal bodyTimeout.
   */
  protected async safeFetchLongRunning(
    url: string,
    init?: RequestInit
  ): Promise<Response> {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`URL must use http or https protocol: ${url}`);
    }

    const h = parsed.hostname;
    if (isCloudMetadataHostname(h)) {
      throw new Error(`Requests to ${h} are not allowed`);
    }

    // Use the global fetch directly. Node.js 22+ bundles undici internally;
    // creating a per-request undici.Agent causes dispatcher version-mismatch
    // issues between the project's undici package and Node's built-in undici,
    // which can cause requests to hang. The AbortSignal passed by the caller
    // controls the actual timeout and takes precedence over undici's default
    // 300s body timeout, so no custom dispatcher is needed.
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

    // A parts-array content with zero parts is a caller bug (an all-images
    // message whose images were stripped upstream should flatten to text
    // markers, not to []). Catch it here once instead of per provider.
    if (
      request.messages.some(
        (m) => Array.isArray(m.content) && m.content.length === 0
      )
    ) {
      throw this.createError(
        "Message content parts cannot be empty",
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
