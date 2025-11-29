import { PrismaClient } from "@prisma/client";
import {
  BaseLlmAdapter,
  OpenAIAdapter,
  AnthropicAdapter,
  AzureOpenAIAdapter,
  GeminiAdapter,
  OllamaAdapter,
  CustomLlmAdapter,
} from "../adapters";

interface LlmCredentials {
  apiKey?: string;
  endpoint?: string;
  baseUrl?: string;
}
import type {
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  LlmAdapterConfig,
  Integration,
  LlmProviderConfig,
  LlmProvider,
} from "../types";

export class LlmManager {
  private static instance: LlmManager;
  private adapters: Map<number, BaseLlmAdapter> = new Map();
  private prisma: PrismaClient;

  private constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  static getInstance(prisma: PrismaClient): LlmManager {
    if (!LlmManager.instance) {
      LlmManager.instance = new LlmManager(prisma);
    }
    return LlmManager.instance;
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
    const config: LlmAdapterConfig = {
      integration: llmIntegration,
      config: llmIntegration.llmProviderConfig as LlmProviderConfig,
      apiKey: credentials?.apiKey,
      baseUrl: credentials?.endpoint || credentials?.baseUrl,
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

  async chat(
    llmIntegrationId: number,
    request: LlmRequest
  ): Promise<LlmResponse> {
    const adapter = await this.getAdapter(llmIntegrationId);

    try {
      const response = await adapter.chat(request);

      await this.trackUsage(llmIntegrationId, request, response);

      return response;
    } catch (error) {
      await this.trackError(llmIntegrationId, request, error);
      throw error;
    }
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
      (response.promptTokens / 1000) * Number(config.costPerInputToken);
    const outputCost =
      (response.completionTokens / 1000) * Number(config.costPerOutputToken);

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
      (estimatedTokens / 1000) * Number(config.costPerOutputToken);

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
