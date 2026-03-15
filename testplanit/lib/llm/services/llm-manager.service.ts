import { PrismaClient } from "@prisma/client";
import {
  AnthropicAdapter,
  AzureOpenAIAdapter, BaseLlmAdapter, CustomLlmAdapter, GeminiAdapter,
  OllamaAdapter, OpenAIAdapter
} from "../adapters";

interface LlmCredentials {
  apiKey?: string;
  endpoint?: string;
  baseUrl?: string;
}

// Allowlist of known safe base URLs per provider to prevent SSRF attacks
const ALLOWED_BASE_URLS: Record<string, string[]> = {
  OPENAI: ["https://api.openai.com"],
  ANTHROPIC: ["https://api.anthropic.com"],
  GEMINI: ["https://generativelanguage.googleapis.com"],
  AZURE_OPENAI: [], // Azure uses organization-specific endpoints, validated separately
  OLLAMA: [], // Self-hosted, validated separately
  CUSTOM_LLM: [], // Custom endpoints, validated separately
};

// Providers that allow custom endpoints (must pass additional validation)
const CUSTOM_ENDPOINT_PROVIDERS = ["ANTHROPIC", "AZURE_OPENAI", "OLLAMA", "CUSTOM_LLM"];


/**
 * Checks if a hostname is a private/internal address that should be blocked
 */
function isPrivateOrInternalHost(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase();

  // Block localhost variants
  if (
    lowerHost === "localhost" ||
    lowerHost === "127.0.0.1" ||
    lowerHost === "0.0.0.0" ||
    lowerHost === "::1" ||
    lowerHost === "[::1]"
  ) {
    return true;
  }

  // Block cloud metadata endpoints
  if (
    lowerHost === "169.254.169.254" ||
    lowerHost === "metadata.google.internal" ||
    lowerHost.endsWith(".internal")
  ) {
    return true;
  }

  // Block private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
  const privateIpPatterns = [
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
    /^192\.168\.\d{1,3}\.\d{1,3}$/,
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^169\.254\.\d{1,3}\.\d{1,3}$/,
  ];

  for (const pattern of privateIpPatterns) {
    if (pattern.test(lowerHost)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates a base URL against the allowlist for a given provider.
 * Returns the validated URL if it matches the allowlist, otherwise returns undefined
 * to fall back to the provider's default URL.
 */
function getValidatedBaseUrl(
  provider: string,
  userProvidedUrl: string | undefined
): string | undefined {
  if (!userProvidedUrl) {
    return undefined; // Will use provider's default
  }

  // Parse and validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(userProvidedUrl);
  } catch {
    console.warn(`Invalid URL format: "${userProvidedUrl}". Using default.`);
    return undefined;
  }

  // Only allow http/https
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    console.warn(
      `Invalid protocol in URL: "${userProvidedUrl}". Using default.`
    );
    return undefined;
  }

  // Check against the provider's allowlist first (fast path for known-good URLs)
  const allowedUrls = ALLOWED_BASE_URLS[provider];
  if (allowedUrls && allowedUrls.length > 0) {
    const normalizedUserUrl = userProvidedUrl.toLowerCase().replace(/\/$/, "");
    for (const allowedUrl of allowedUrls) {
      const normalizedAllowedUrl = allowedUrl.toLowerCase().replace(/\/$/, "");
      if (
        normalizedUserUrl === normalizedAllowedUrl ||
        normalizedUserUrl.startsWith(normalizedAllowedUrl + "/")
      ) {
        return userProvidedUrl;
      }
    }
    // URL not in allowlist — fall through to custom endpoint check below
  }

  // For providers that allow custom endpoints, permit any non-private URL
  // (e.g. LiteLLM proxies, Azure AI endpoints for Anthropic models)
  if (CUSTOM_ENDPOINT_PROVIDERS.includes(provider)) {
    if (isPrivateOrInternalHost(parsedUrl.hostname)) {
      console.warn(
        `Blocked private/internal URL "${userProvidedUrl}" for provider ${provider}. Using default.`
      );
      return undefined;
    }
    return userProvidedUrl;
  }

  // Unknown provider - use default
  return undefined;
}

import type {
  LlmAdapterConfig, LlmError, LlmProviderConfig, LlmRequest,
  LlmResponse,
  LlmStreamResponse
} from "../types";

export class LlmManager {
  private static instance: LlmManager;
  private adapters: Map<number, BaseLlmAdapter> = new Map();
  private prisma: PrismaClient;
  private tenantId?: string;

  private constructor(prisma: PrismaClient, tenantId?: string) {
    this.prisma = prisma;
    this.tenantId = tenantId;
  }

  static getInstance(prisma: PrismaClient): LlmManager {
    if (!LlmManager.instance) {
      LlmManager.instance = new LlmManager(prisma);
    }
    return LlmManager.instance;
  }

  /**
   * Create a fresh LlmManager instance for worker context.
   * Bypasses the singleton cache so each tenant gets its own instance.
   * Accepts tenantId so budget checks can be enqueued with the correct tenant.
   */
  static createForWorker(prisma: PrismaClient, tenantId?: string): LlmManager {
    return new LlmManager(prisma, tenantId);
  }

  async getAdapter(llmIntegrationId: number): Promise<BaseLlmAdapter> {
    if (this.adapters.has(llmIntegrationId)) {
      return this.adapters.get(llmIntegrationId)!;
    }

    const adapter = await this.createAdapter(llmIntegrationId);
    this.adapters.set(llmIntegrationId, adapter);
    return adapter;
  }

  private async createAdapter(
    llmIntegrationId: number
  ): Promise<BaseLlmAdapter> {
    const llmIntegration = await this.prisma.llmIntegration.findUnique({
      where: { id: llmIntegrationId },
      include: {
        llmProviderConfig: true,
      },
    });

    if (!llmIntegration) {
      throw new Error(`LLM Integration with id ${llmIntegrationId} not found`);
    }

    if (!llmIntegration.llmProviderConfig) {
      throw new Error(
        `LLM provider config not found for LLM integration ${llmIntegrationId}`
      );
    }

    const credentials = llmIntegration.credentials as LlmCredentials | null;
    const userProvidedBaseUrl = credentials?.endpoint || credentials?.baseUrl;
    const validatedBaseUrl = getValidatedBaseUrl(
      llmIntegration.provider,
      userProvidedBaseUrl
    );

    const config: LlmAdapterConfig = {
      integration: llmIntegration,
      config: llmIntegration.llmProviderConfig as LlmProviderConfig,
      apiKey: credentials?.apiKey,
      baseUrl: validatedBaseUrl,
    };

    switch (llmIntegration.provider) {
      case "OPENAI":
        return new OpenAIAdapter(config);
      case "ANTHROPIC":
        return new AnthropicAdapter(config);
      case "AZURE_OPENAI":
        return new AzureOpenAIAdapter(config);
      case "GEMINI":
        return new GeminiAdapter(config);
      case "OLLAMA":
        return new OllamaAdapter(config);
      case "CUSTOM_LLM":
        return new CustomLlmAdapter(config);
      default:
        throw new Error(`Unsupported LLM provider: ${llmIntegration.provider}`);
    }
  }

  /**
   * Send a chat request to the LLM with automatic retry and exponential backoff.
   *
   * Retries are only attempted for errors marked as `retryable` by the adapter
   * (e.g. 429 rate limits, 5xx server errors). Non-retryable errors (auth,
   * bad request, content filter) are thrown immediately.
   *
   * @param retryOptions.maxRetries  Max retry attempts (default 3, set 0 to disable)
   * @param retryOptions.baseDelayMs Base delay before first retry in ms (default 1000)
   */
  async chat(
    llmIntegrationId: number,
    request: LlmRequest,
    retryOptions?: { maxRetries?: number; baseDelayMs?: number },
  ): Promise<LlmResponse> {
    const maxRetries = retryOptions?.maxRetries ?? 3;
    const baseDelay = retryOptions?.baseDelayMs ?? 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const adapter = await this.getAdapter(llmIntegrationId);
        const response = await adapter.chat(request);

        await this.trackUsage(llmIntegrationId, request, response);

        return response;
      } catch (error) {
        const isRetryable = (error as Partial<LlmError>).retryable === true;
        const isLastAttempt = attempt >= maxRetries;

        if (!isRetryable || isLastAttempt) {
          await this.trackError(llmIntegrationId, request, error);
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s (with defaults)
        let delay = baseDelay * Math.pow(2, attempt);

        // Respect retry-after header from 429 responses
        const retryAfter = (error as Partial<LlmError>).details?.retryAfter;
        if (typeof retryAfter === "number" && retryAfter > 0) {
          delay = Math.max(delay, retryAfter * 1000);
        }

        // Add jitter (±20%) to avoid thundering herd
        delay *= 0.8 + Math.random() * 0.4;

        const errorCode = (error as Partial<LlmError>).code || (error as Error).message;
        console.warn(
          `[LlmManager] Retryable error (attempt ${attempt + 1}/${maxRetries}): ${errorCode}. Retrying in ${Math.round(delay)}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Unreachable — the loop always returns or throws
    throw new Error("Unexpected: retry loop exited without result");
  }

  async *chatStream(
    llmIntegrationId: number,
    request: LlmRequest
  ): AsyncGenerator<LlmStreamResponse, void, unknown> {
    const adapter = await this.getAdapter(llmIntegrationId);

    const totalTokens = 0;
    const chunks: string[] = [];

    try {
      for await (const chunk of adapter.chatStream(request)) {
        chunks.push(chunk.delta);
        yield chunk;
      }

      const fullContent = chunks.join("");
      const estimatedTokens = Math.ceil(fullContent.length / 4);

      await this.trackStreamUsage(llmIntegrationId, request, estimatedTokens);
    } catch (error) {
      await this.trackError(llmIntegrationId, request, error);
      throw error;
    }
  }

  async getDefaultIntegration(): Promise<number | null> {
    const config = await this.prisma.llmProviderConfig.findFirst({
      where: {
        llmIntegration: {
          isDeleted: false,
          status: "ACTIVE",
        },
        isDefault: true,
      },
      select: {
        llmIntegrationId: true,
      },
    });

    return config?.llmIntegrationId || null;
  }

  /**
   * Get the LLM integration configured for a specific project.
   * Falls back to the system default if no project-level integration is set.
   */
  async getProjectIntegration(projectId: number): Promise<number | null> {
    const projectIntegration = await (this.prisma as any).projectLlmIntegration.findFirst({
      where: {
        projectId,
        isActive: true,
        llmIntegration: {
          isDeleted: false,
          status: "ACTIVE",
        },
      },
      select: {
        llmIntegrationId: true,
      },
    });

    if (projectIntegration?.llmIntegrationId) {
      return projectIntegration.llmIntegrationId;
    }

    // Fall back to system default
    return this.getDefaultIntegration();
  }

  async listAvailableIntegrations(): Promise<
    Array<{ id: number; name: string; provider: string }>
  > {
    const llmIntegrations = await this.prisma.llmIntegration.findMany({
      where: {
        isDeleted: false,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        provider: true,
      },
    });

    return llmIntegrations;
  }

  async testConnection(llmIntegrationId: number): Promise<boolean> {
    try {
      const adapter = await this.getAdapter(llmIntegrationId);
      return await adapter.testConnection();
    } catch (error) {
      console.error(
        `Failed to test connection for LLM integration ${llmIntegrationId}:`,
        error
      );
      return false;
    }
  }

  async getAvailableModels(llmIntegrationId: number) {
    const adapter = await this.getAdapter(llmIntegrationId);
    return await adapter.getAvailableModels();
  }

  async checkRateLimit(
    llmIntegrationId: number,
    userId: string
  ): Promise<boolean> {
    const rateLimit = await this.prisma.llmRateLimit.findFirst({
      where: {
        llmIntegrationId,
        scope: "user",
        scopeId: userId,
        isActive: true,
      },
    });

    if (!rateLimit) {
      return true;
    }

    // Check if the current window is still valid
    const now = new Date();
    const windowEnd = new Date(
      rateLimit.windowStart.getTime() + rateLimit.windowSize * 1000
    );

    if (now > windowEnd) {
      // Window expired, reset counters
      await this.prisma.llmRateLimit.update({
        where: { id: rateLimit.id },
        data: {
          currentRequests: 0,
          currentTokens: 0,
          windowStart: now,
        },
      });
      return true;
    }

    if (rateLimit.currentRequests >= rateLimit.maxRequests) {
      if (rateLimit.blockOnExceed) {
        return false;
      }
    }

    return true;
  }

  private async trackUsage(
    llmIntegrationId: number,
    request: LlmRequest,
    response: LlmResponse
  ): Promise<void> {
    const config = await this.prisma.llmProviderConfig.findUnique({
      where: { llmIntegrationId },
    });

    if (!config) return;

    const inputCost =
      (response.promptTokens / 1_000_000) * Number(config.costPerInputToken);
    const outputCost =
      (response.completionTokens / 1_000_000) *
      Number(config.costPerOutputToken);

    await this.prisma.llmUsage.create({
      data: {
        llmIntegrationId,
        userId: request.userId,
        projectId: request.projectId,
        feature: request.feature,
        model: response.model,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        totalTokens: response.totalTokens,
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost,
        latency: 0, // TODO: Track actual latency
        success: true,
      },
    });

    await this.updateRateLimit(llmIntegrationId, request.userId);

    // Fire-and-forget budget check — never blocks LLM response (CHCK-01, CHCK-03)
    if (config.monthlyBudget && Number(config.monthlyBudget) > 0) {
      try {
        const { getBudgetAlertQueue } = await import("~/lib/queues");
        const { BUDGET_ALERT_JOB_CHECK } = await import(
          "~/workers/budgetAlertWorker"
        );
        const { getCurrentTenantId } = await import(
          "~/lib/multiTenantPrisma"
        );
        getBudgetAlertQueue()
          ?.add(BUDGET_ALERT_JOB_CHECK, {
            llmIntegrationId,
            tenantId: this.tenantId ?? getCurrentTenantId(),
          })
          .catch((err: unknown) => {
            console.error(
              "[BudgetAlert] Failed to enqueue budget check:",
              err
            );
          });
      } catch (err) {
        console.error("[BudgetAlert] Failed to enqueue budget check:", err);
      }
    }
  }

  private async trackStreamUsage(
    llmIntegrationId: number,
    request: LlmRequest,
    estimatedTokens: number
  ): Promise<void> {
    const config = await this.prisma.llmProviderConfig.findUnique({
      where: { llmIntegrationId },
    });

    if (!config) return;

    const estimatedCost =
      (estimatedTokens / 1_000_000) * Number(config.costPerOutputToken);

    await this.prisma.llmUsage.create({
      data: {
        llmIntegrationId,
        userId: request.userId,
        projectId: request.projectId,
        feature: request.feature,
        model: request.model || config.defaultModel,
        promptTokens: 0,
        completionTokens: estimatedTokens,
        totalTokens: estimatedTokens,
        inputCost: 0,
        outputCost: estimatedCost,
        totalCost: estimatedCost,
        latency: 0, // TODO: Track actual latency for streaming
        success: true,
      },
    });

    await this.updateRateLimit(llmIntegrationId, request.userId);

    // Fire-and-forget budget check — never blocks LLM response (CHCK-01, CHCK-03)
    if (config.monthlyBudget && Number(config.monthlyBudget) > 0) {
      try {
        const { getBudgetAlertQueue } = await import("~/lib/queues");
        const { BUDGET_ALERT_JOB_CHECK } = await import(
          "~/workers/budgetAlertWorker"
        );
        const { getCurrentTenantId } = await import(
          "~/lib/multiTenantPrisma"
        );
        getBudgetAlertQueue()
          ?.add(BUDGET_ALERT_JOB_CHECK, {
            llmIntegrationId,
            tenantId: this.tenantId ?? getCurrentTenantId(),
          })
          .catch((err: unknown) => {
            console.error(
              "[BudgetAlert] Failed to enqueue budget check:",
              err
            );
          });
      } catch (err) {
        console.error("[BudgetAlert] Failed to enqueue budget check:", err);
      }
    }
  }

  private async trackError(
    llmIntegrationId: number,
    request: LlmRequest,
    error: any
  ): Promise<void> {
    await this.prisma.llmUsage.create({
      data: {
        llmIntegrationId,
        userId: request.userId,
        projectId: request.projectId,
        feature: request.feature,
        model: request.model || "unknown",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        latency: 0,
        success: false,
        error: error.message || "Unknown error",
      },
    });
  }

  private async updateRateLimit(
    llmIntegrationId: number,
    userId: string
  ): Promise<void> {
    const now = new Date();

    await this.prisma.llmRateLimit.upsert({
      where: {
        scope_scopeId_feature: {
          scope: "user",
          scopeId: userId,
          feature: `llm_integration_${llmIntegrationId}`,
        },
      },
      update: {
        currentRequests: {
          increment: 1,
        },
      },
      create: {
        scope: "user",
        scopeId: userId,
        feature: `llm_integration_${llmIntegrationId}`,
        windowType: "sliding",
        windowSize: 60,
        maxRequests: 60,
        currentRequests: 1,
        windowStart: now,
      },
    });
  }

  clearCache(llmIntegrationId?: number): void {
    if (llmIntegrationId) {
      this.adapters.delete(llmIntegrationId);
    } else {
      this.adapters.clear();
    }
  }
}
