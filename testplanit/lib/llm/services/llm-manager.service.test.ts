import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { LlmManager } from "./llm-manager.service";
import type { LlmRequest, LlmResponse, LlmStreamResponse } from "../types";

// Mock adapters with proper class constructors
vi.mock("../adapters", () => ({
  BaseLlmAdapter: class BaseLlmAdapter {},
  OpenAIAdapter: class OpenAIAdapter {
    chat = vi.fn().mockResolvedValue({
      content: "OpenAI response",
      model: "gpt-4",
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      finishReason: "stop",
    });
    chatStream = vi.fn().mockImplementation(async function* () {
      yield { delta: "Hello", done: false };
      yield { delta: " world", done: true };
    });
    testConnection = vi.fn().mockResolvedValue(true);
    getAvailableModels = vi.fn().mockResolvedValue([
      { id: "gpt-4", name: "GPT-4" },
    ]);
    constructor(public config: any) {}
  },
  AnthropicAdapter: class AnthropicAdapter {
    chat = vi.fn().mockResolvedValue({
      content: "Anthropic response",
      model: "claude-3",
      promptTokens: 15,
      completionTokens: 25,
      totalTokens: 40,
      finishReason: "stop",
    });
    chatStream = vi.fn().mockImplementation(async function* () {
      yield { delta: "Hello", done: false };
      yield { delta: " world", done: true };
    });
    testConnection = vi.fn().mockResolvedValue(true);
    getAvailableModels = vi.fn().mockResolvedValue([
      { id: "claude-3-opus", name: "Claude 3 Opus" },
    ]);
    constructor(public config: any) {}
  },
  AzureOpenAIAdapter: class AzureOpenAIAdapter {
    chat = vi.fn().mockResolvedValue({
      content: "Azure response",
      model: "gpt-4",
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      finishReason: "stop",
    });
    chatStream = vi.fn().mockImplementation(async function* () {
      yield { delta: "Hello", done: false };
      yield { delta: " world", done: true };
    });
    testConnection = vi.fn().mockResolvedValue(true);
    getAvailableModels = vi.fn().mockResolvedValue([]);
    constructor(public config: any) {}
  },
  GeminiAdapter: class GeminiAdapter {
    chat = vi.fn().mockResolvedValue({
      content: "Gemini response",
      model: "gemini-pro",
      promptTokens: 12,
      completionTokens: 18,
      totalTokens: 30,
      finishReason: "stop",
    });
    chatStream = vi.fn().mockImplementation(async function* () {
      yield { delta: "Hello", done: false };
      yield { delta: " world", done: true };
    });
    testConnection = vi.fn().mockResolvedValue(true);
    getAvailableModels = vi.fn().mockResolvedValue([]);
    constructor(public config: any) {}
  },
  OllamaAdapter: class OllamaAdapter {
    chat = vi.fn().mockResolvedValue({
      content: "Ollama response",
      model: "llama2",
      promptTokens: 8,
      completionTokens: 22,
      totalTokens: 30,
      finishReason: "stop",
    });
    chatStream = vi.fn().mockImplementation(async function* () {
      yield { delta: "Hello", done: false };
      yield { delta: " world", done: true };
    });
    testConnection = vi.fn().mockResolvedValue(true);
    getAvailableModels = vi.fn().mockResolvedValue([]);
    constructor(public config: any) {}
  },
  CustomLlmAdapter: class CustomLlmAdapter {
    chat = vi.fn().mockResolvedValue({
      content: "Custom response",
      model: "custom-model",
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      finishReason: "stop",
    });
    chatStream = vi.fn().mockImplementation(async function* () {
      yield { delta: "Hello", done: false };
      yield { delta: " world", done: true };
    });
    testConnection = vi.fn().mockResolvedValue(true);
    getAvailableModels = vi.fn().mockResolvedValue([]);
    constructor(public config: any) {}
  },
}));

// Create mock Prisma client
const createMockPrisma = () => ({
  llmIntegration: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  llmProviderConfig: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  llmUsage: {
    create: vi.fn(),
  },
  llmRateLimit: {
    findFirst: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
});

describe("LlmManager", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let manager: LlmManager;

  const mockLlmIntegration = {
    id: 1,
    name: "Test OpenAI",
    provider: "OPENAI",
    status: "ACTIVE",
    credentials: { apiKey: "test-api-key" },
    settings: null,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    llmProviderConfig: {
      id: 1,
      llmIntegrationId: 1,
      defaultModel: "gpt-4",
      availableModels: ["gpt-4", "gpt-3.5-turbo"],
      maxTokensPerRequest: 4096,
      maxRequestsPerMinute: 60,
      maxRequestsPerDay: null,
      costPerInputToken: new Prisma.Decimal("0.00003"),
      costPerOutputToken: new Prisma.Decimal("0.00006"),
      monthlyBudget: null,
      defaultTemperature: 0.7,
      defaultMaxTokens: 1000,
      timeout: 30000,
      retryAttempts: 3,
      streamingEnabled: false,
      isDefault: true,
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    // Reset singleton for each test
    (LlmManager as any).instance = undefined;
    manager = LlmManager.getInstance(mockPrisma as unknown as PrismaClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = LlmManager.getInstance(
        mockPrisma as unknown as PrismaClient
      );
      const instance2 = LlmManager.getInstance(
        mockPrisma as unknown as PrismaClient
      );

      expect(instance1).toBe(instance2);
    });
  });

  describe("getAdapter", () => {
    it("should create and cache OpenAI adapter", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const adapter1 = await manager.getAdapter(1);
      const adapter2 = await manager.getAdapter(1);

      expect(adapter1).toBe(adapter2);
      expect(mockPrisma.llmIntegration.findUnique).toHaveBeenCalledTimes(1);
    });

    it("should throw error when integration not found", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(null);

      await expect(manager.getAdapter(999)).rejects.toThrow(
        "LLM Integration with id 999 not found"
      );
    });

    it("should throw error when provider config not found", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        llmProviderConfig: null,
      });

      await expect(manager.getAdapter(1)).rejects.toThrow(
        "LLM provider config not found for LLM integration 1"
      );
    });

    it("should create Anthropic adapter", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "ANTHROPIC",
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should create Azure OpenAI adapter", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "AZURE_OPENAI",
        credentials: {
          apiKey: "azure-key",
          endpoint: "https://test.openai.azure.com",
        },
        settings: {
          deploymentName: "gpt-4",
          apiVersion: "2024-02-01",
        },
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should create Gemini adapter", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "GEMINI",
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should create Ollama adapter with public URL", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "OLLAMA",
        credentials: { baseUrl: "https://ollama.example.com:11434" },
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should block Ollama adapter with localhost URL and use default", async () => {
      // Spy on console.warn to verify the warning is logged
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      mockPrisma.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "OLLAMA",
        credentials: { baseUrl: "http://localhost:11434" },
      });

      const adapter = await manager.getAdapter(1);

      // Adapter should still be created (with default/undefined URL)
      expect(adapter).toBeDefined();
      // Warning should be logged about blocked URL
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Blocked private/internal URL")
      );

      warnSpy.mockRestore();
    });

    it("should create Custom LLM adapter", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "CUSTOM_LLM",
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should throw error for unsupported provider", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "UNSUPPORTED",
      });

      await expect(manager.getAdapter(1)).rejects.toThrow(
        "Unsupported LLM provider: UNSUPPORTED"
      );
    });
  });

  describe("chat", () => {
    it("should make chat request and track usage", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);
      mockPrisma.llmProviderConfig.findUnique.mockResolvedValue(
        mockLlmIntegration.llmProviderConfig
      );
      mockPrisma.llmUsage.create.mockResolvedValue({});
      mockPrisma.llmRateLimit.upsert.mockResolvedValue({});

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        projectId: 1,
        feature: "test",
      };

      const response = await manager.chat(1, request);

      expect(response.content).toBe("OpenAI response");
      expect(response.model).toBe("gpt-4");
      expect(mockPrisma.llmUsage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          llmIntegrationId: 1,
          userId: "user-123",
          projectId: 1,
          feature: "test",
          success: true,
        }),
      });
    });

    it("should track error on failed chat request", async () => {
      const mockError = new Error("API error");
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);
      mockPrisma.llmUsage.create.mockResolvedValue({});

      // Get the adapter first
      const adapter = await manager.getAdapter(1);

      // Spy on the adapter's chat method and make it reject
      vi.spyOn(adapter, "chat").mockRejectedValueOnce(mockError);

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      await expect(manager.chat(1, request)).rejects.toThrow("API error");

      expect(mockPrisma.llmUsage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          success: false,
          error: "API error",
        }),
      });
    });
  });

  describe("chatStream", () => {
    it("should stream chat response and track usage", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);
      mockPrisma.llmProviderConfig.findUnique.mockResolvedValue(
        mockLlmIntegration.llmProviderConfig
      );
      mockPrisma.llmUsage.create.mockResolvedValue({});
      mockPrisma.llmRateLimit.upsert.mockResolvedValue({});

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const chunks: LlmStreamResponse[] = [];
      for await (const chunk of manager.chatStream(1, request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].delta).toBe("Hello");
      expect(chunks[1].delta).toBe(" world");

      // Should track stream usage with estimated tokens
      expect(mockPrisma.llmUsage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          llmIntegrationId: 1,
          success: true,
          completionTokens: expect.any(Number),
        }),
      });
    });
  });

  describe("getDefaultIntegration", () => {
    it("should return default integration ID", async () => {
      mockPrisma.llmProviderConfig.findFirst.mockResolvedValue({
        llmIntegrationId: 5,
      });

      const result = await manager.getDefaultIntegration();

      expect(result).toBe(5);
      expect(mockPrisma.llmProviderConfig.findFirst).toHaveBeenCalledWith({
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
    });

    it("should return null when no default integration exists", async () => {
      mockPrisma.llmProviderConfig.findFirst.mockResolvedValue(null);

      const result = await manager.getDefaultIntegration();

      expect(result).toBeNull();
    });
  });

  describe("listAvailableIntegrations", () => {
    it("should return list of active integrations", async () => {
      mockPrisma.llmIntegration.findMany.mockResolvedValue([
        { id: 1, name: "OpenAI", provider: "OPENAI" },
        { id: 2, name: "Anthropic", provider: "ANTHROPIC" },
      ]);

      const result = await manager.listAvailableIntegrations();

      expect(result).toEqual([
        { id: 1, name: "OpenAI", provider: "OPENAI" },
        { id: 2, name: "Anthropic", provider: "ANTHROPIC" },
      ]);
      expect(mockPrisma.llmIntegration.findMany).toHaveBeenCalledWith({
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
    });
  });

  describe("testConnection", () => {
    it("should return true when connection succeeds", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const result = await manager.testConnection(1);

      expect(result).toBe(true);
    });

    it("should return false when connection fails", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      // Get the adapter and spy on testConnection to make it fail
      const adapter = await manager.getAdapter(1);
      vi.spyOn(adapter, "testConnection").mockRejectedValueOnce(
        new Error("Connection failed")
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await manager.testConnection(1);

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe("getAvailableModels", () => {
    it("should return available models from adapter", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const result = await manager.getAvailableModels(1);

      expect(result).toEqual([{ id: "gpt-4", name: "GPT-4" }]);
    });
  });

  describe("checkRateLimit", () => {
    it("should return true when no rate limit exists", async () => {
      mockPrisma.llmRateLimit.findFirst.mockResolvedValue(null);

      const result = await manager.checkRateLimit(1, "user-123");

      expect(result).toBe(true);
    });

    it("should return true when rate limit window expired", async () => {
      const expiredWindow = new Date(Date.now() - 120000); // 2 minutes ago
      mockPrisma.llmRateLimit.findFirst.mockResolvedValue({
        id: 1,
        windowStart: expiredWindow,
        windowSize: 60,
        currentRequests: 100,
        maxRequests: 60,
        blockOnExceed: true,
      });
      mockPrisma.llmRateLimit.update.mockResolvedValue({});

      const result = await manager.checkRateLimit(1, "user-123");

      expect(result).toBe(true);
      expect(mockPrisma.llmRateLimit.update).toHaveBeenCalled();
    });

    it("should return false when rate limit exceeded and blocking", async () => {
      const recentWindow = new Date(Date.now() - 30000); // 30 seconds ago
      mockPrisma.llmRateLimit.findFirst.mockResolvedValue({
        id: 1,
        windowStart: recentWindow,
        windowSize: 60,
        currentRequests: 60,
        maxRequests: 60,
        blockOnExceed: true,
      });

      const result = await manager.checkRateLimit(1, "user-123");

      expect(result).toBe(false);
    });

    it("should return true when rate limit exceeded but not blocking", async () => {
      const recentWindow = new Date(Date.now() - 30000);
      mockPrisma.llmRateLimit.findFirst.mockResolvedValue({
        id: 1,
        windowStart: recentWindow,
        windowSize: 60,
        currentRequests: 60,
        maxRequests: 60,
        blockOnExceed: false,
      });

      const result = await manager.checkRateLimit(1, "user-123");

      expect(result).toBe(true);
    });

    it("should return true when under rate limit", async () => {
      const recentWindow = new Date(Date.now() - 30000);
      mockPrisma.llmRateLimit.findFirst.mockResolvedValue({
        id: 1,
        windowStart: recentWindow,
        windowSize: 60,
        currentRequests: 30,
        maxRequests: 60,
        blockOnExceed: true,
      });

      const result = await manager.checkRateLimit(1, "user-123");

      expect(result).toBe(true);
    });
  });

  describe("clearCache", () => {
    it("should clear specific adapter from cache", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const adapter1 = await manager.getAdapter(1);
      manager.clearCache(1);
      const adapter2 = await manager.getAdapter(1);

      expect(adapter1).not.toBe(adapter2);
    });

    it("should clear all adapters from cache", async () => {
      mockPrisma.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const adapter1 = await manager.getAdapter(1);
      manager.clearCache();
      const adapter2 = await manager.getAdapter(1);

      expect(adapter1).not.toBe(adapter2);
    });
  });
});
