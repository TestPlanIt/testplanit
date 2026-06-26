import type { DbClient } from "~/lib/zenstack";
import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmRequest, LlmStreamResponse } from "../types";
import { LlmManager } from "./llm-manager.service";

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
    getAvailableModels = vi
      .fn()
      .mockResolvedValue([{ id: "gpt-4", name: "GPT-4" }]);
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
    getAvailableModels = vi
      .fn()
      .mockResolvedValue([{ id: "claude-3-opus", name: "Claude 3 Opus" }]);
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
const createMockDb = () => ({
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
  llmFeatureConfig: {
    findUnique: vi.fn(),
  },
  projectLlmIntegration: {
    findFirst: vi.fn(),
  },
});

describe("LlmManager", () => {
  let mockDb: ReturnType<typeof createMockDb>;
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
      costPerInputToken: new Decimal("0.00003"),
      costPerOutputToken: new Decimal("0.00006"),
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
    mockDb = createMockDb();
    // Reset singleton for each test
    (LlmManager as any).instance = undefined;
    manager = LlmManager.getInstance(mockDb as unknown as DbClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = LlmManager.getInstance(mockDb as unknown as DbClient);
      const instance2 = LlmManager.getInstance(mockDb as unknown as DbClient);

      expect(instance1).toBe(instance2);
    });
  });

  describe("getAdapter", () => {
    it("should create and cache OpenAI adapter", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const adapter1 = await manager.getAdapter(1);
      const adapter2 = await manager.getAdapter(1);

      expect(adapter1).toBe(adapter2);
      expect(mockDb.llmIntegration.findUnique).toHaveBeenCalledTimes(1);
    });

    it("should throw error when integration not found", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue(null);

      await expect(manager.getAdapter(999)).rejects.toThrow(
        "LLM Integration with id 999 not found"
      );
    });

    it("should throw error when provider config not found", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        llmProviderConfig: null,
      });

      await expect(manager.getAdapter(1)).rejects.toThrow(
        "LLM provider config not found for LLM integration 1"
      );
    });

    it("should create Anthropic adapter", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "ANTHROPIC",
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should create Azure OpenAI adapter", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue({
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
      mockDb.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "GEMINI",
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should create Ollama adapter with public URL", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "OLLAMA",
        credentials: { baseUrl: "https://ollama.example.com:11434" },
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should create OpenAI adapter with custom proxy URL (e.g., LiteLLM)", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "OPENAI",
        credentials: {
          apiKey: "test-api-key",
          baseUrl: "https://litellm.example.com/v1",
        },
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should create Gemini adapter with custom proxy URL", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "GEMINI",
        credentials: {
          apiKey: "test-api-key",
          baseUrl: "https://litellm.example.com/v1",
        },
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should throw for Ollama adapter with localhost URL when not in ALLOWED_PRIVATE_HOSTS", async () => {
      const original = process.env.ALLOWED_PRIVATE_HOSTS;
      process.env.ALLOWED_PRIVATE_HOSTS = "";

      mockDb.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "OLLAMA",
        credentials: { baseUrl: "http://localhost:11434" },
      });

      await expect(manager.getAdapter(1)).rejects.toThrow(
        "Blocked private/internal URL"
      );

      process.env.ALLOWED_PRIVATE_HOSTS = original;
    });

    it("should create Custom LLM adapter", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue({
        ...mockLlmIntegration,
        provider: "CUSTOM_LLM",
      });

      const adapter = await manager.getAdapter(1);

      expect(adapter).toBeDefined();
    });

    it("should throw error for unsupported provider", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue({
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
      mockDb.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        mockLlmIntegration.llmProviderConfig
      );
      mockDb.llmUsage.create.mockResolvedValue({});
      mockDb.llmRateLimit.upsert.mockResolvedValue({});

      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        projectId: 1,
        feature: "test",
      };

      const response = await manager.chat(1, request);

      expect(response.content).toBe("OpenAI response");
      expect(response.model).toBe("gpt-4");
      expect(mockDb.llmUsage.create).toHaveBeenCalledWith({
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
      mockDb.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);
      mockDb.llmUsage.create.mockResolvedValue({});

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

      expect(mockDb.llmUsage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          success: false,
          error: "API error",
        }),
      });
    });
  });

  describe("chatStream", () => {
    it("should stream chat response and track usage", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        mockLlmIntegration.llmProviderConfig
      );
      mockDb.llmUsage.create.mockResolvedValue({});
      mockDb.llmRateLimit.upsert.mockResolvedValue({});

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
      expect(mockDb.llmUsage.create).toHaveBeenCalledWith({
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
      mockDb.llmProviderConfig.findFirst.mockResolvedValue({
        llmIntegrationId: 5,
      });

      const result = await manager.getDefaultIntegration();

      expect(result).toBe(5);
      expect(mockDb.llmProviderConfig.findFirst).toHaveBeenCalledWith({
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
      mockDb.llmProviderConfig.findFirst.mockResolvedValue(null);

      const result = await manager.getDefaultIntegration();

      expect(result).toBeNull();
    });
  });

  describe("listAvailableIntegrations", () => {
    it("should return list of active integrations", async () => {
      mockDb.llmIntegration.findMany.mockResolvedValue([
        { id: 1, name: "OpenAI", provider: "OPENAI" },
        { id: 2, name: "Anthropic", provider: "ANTHROPIC" },
      ]);

      const result = await manager.listAvailableIntegrations();

      expect(result).toEqual([
        { id: 1, name: "OpenAI", provider: "OPENAI" },
        { id: 2, name: "Anthropic", provider: "ANTHROPIC" },
      ]);
      expect(mockDb.llmIntegration.findMany).toHaveBeenCalledWith({
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
      mockDb.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const result = await manager.testConnection(1);

      expect(result).toBe(true);
    });

    it("should return false when connection fails", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      // Get the adapter and spy on testConnection to make it fail
      const adapter = await manager.getAdapter(1);
      vi.spyOn(adapter, "testConnection").mockRejectedValueOnce(
        new Error("Connection failed")
      );

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await manager.testConnection(1);

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe("getAvailableModels", () => {
    it("should return available models from adapter", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const result = await manager.getAvailableModels(1);

      expect(result).toEqual([{ id: "gpt-4", name: "GPT-4" }]);
    });
  });

  describe("checkRateLimit", () => {
    it("should return true when no rate limit exists", async () => {
      mockDb.llmRateLimit.findFirst.mockResolvedValue(null);

      const result = await manager.checkRateLimit(1, "user-123");

      expect(result).toBe(true);
    });

    it("should return true when rate limit window expired", async () => {
      const expiredWindow = new Date(Date.now() - 120000); // 2 minutes ago
      mockDb.llmRateLimit.findFirst.mockResolvedValue({
        id: 1,
        windowStart: expiredWindow,
        windowSize: 60,
        currentRequests: 100,
        maxRequests: 60,
        blockOnExceed: true,
      });
      mockDb.llmRateLimit.update.mockResolvedValue({});

      const result = await manager.checkRateLimit(1, "user-123");

      expect(result).toBe(true);
      expect(mockDb.llmRateLimit.update).toHaveBeenCalled();
    });

    it("should return false when rate limit exceeded and blocking", async () => {
      const recentWindow = new Date(Date.now() - 30000); // 30 seconds ago
      mockDb.llmRateLimit.findFirst.mockResolvedValue({
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
      mockDb.llmRateLimit.findFirst.mockResolvedValue({
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
      mockDb.llmRateLimit.findFirst.mockResolvedValue({
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
      mockDb.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const adapter1 = await manager.getAdapter(1);
      manager.clearCache(1);
      const adapter2 = await manager.getAdapter(1);

      expect(adapter1).not.toBe(adapter2);
    });

    it("should clear all adapters from cache", async () => {
      mockDb.llmIntegration.findUnique.mockResolvedValue(mockLlmIntegration);

      const adapter1 = await manager.getAdapter(1);
      manager.clearCache();
      const adapter2 = await manager.getAdapter(1);

      expect(adapter1).not.toBe(adapter2);
    });
  });

  describe("resolveIntegration", () => {
    let resolveManager: LlmManager;
    let resolveDb: ReturnType<typeof createMockDb>;

    beforeEach(() => {
      resolveDb = createMockDb();
      // Use createForWorker to get a fresh (non-singleton) instance per test
      resolveManager = LlmManager.createForWorker(
        resolveDb as unknown as DbClient
      );
    });

    // Level 1 — LlmFeatureConfig override
    it("returns LlmFeatureConfig integration when active", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue({
        llmIntegrationId: 10,
        model: "gpt-4o",
        llmIntegration: { isDeleted: false, status: "ACTIVE" },
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toEqual({ integrationId: 10, model: "gpt-4o" });
    });

    it("Level 1 — includes model field when set on LlmFeatureConfig", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue({
        llmIntegrationId: 10,
        model: "claude-3-opus",
        llmIntegration: { isDeleted: false, status: "ACTIVE" },
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toEqual({ integrationId: 10, model: "claude-3-opus" });
    });

    it("Level 1 — model is undefined when LlmFeatureConfig model is null", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue({
        llmIntegrationId: 10,
        model: null,
        llmIntegration: { isDeleted: false, status: "ACTIVE" },
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toEqual({ integrationId: 10, model: undefined });
    });

    it("Level 1 — skips LlmFeatureConfig when integration is deleted", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue({
        llmIntegrationId: 10,
        model: null,
        llmIntegration: { isDeleted: true, status: "ACTIVE" },
      });
      // Should fall through to Level 3 (no resolvedPrompt provided)
      resolveDb.projectLlmIntegration.findFirst.mockResolvedValue({
        llmIntegrationId: 5,
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toEqual({ integrationId: 5 });
    });

    it("Level 1 — skips LlmFeatureConfig when integration status is not ACTIVE", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue({
        llmIntegrationId: 10,
        model: null,
        llmIntegration: { isDeleted: false, status: "INACTIVE" },
      });
      resolveDb.projectLlmIntegration.findFirst.mockResolvedValue({
        llmIntegrationId: 5,
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toEqual({ integrationId: 5 });
    });

    it("Level 1 — skips LlmFeatureConfig when llmIntegration relation is null", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue({
        llmIntegrationId: 10,
        model: null,
        llmIntegration: null,
      });
      resolveDb.projectLlmIntegration.findFirst.mockResolvedValue({
        llmIntegrationId: 5,
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toEqual({ integrationId: 5 });
    });

    // Level 1 — explicit "No LLM" override (enabled: false, no integration)
    it("Level 1 — returns null when feature config is explicitly disabled", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue({
        enabled: false,
        llmIntegrationId: null,
        model: null,
        llmIntegration: null,
      });
      // Level 3 would return an integration, but the disabled override should block it
      resolveDb.projectLlmIntegration.findFirst.mockResolvedValue({
        llmIntegrationId: 5,
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toBeNull();
    });

    it("Level 1 — disabled override blocks Level 2 per-prompt fallback", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue({
        enabled: false,
        llmIntegrationId: null,
        model: null,
        llmIntegration: null,
      });
      resolveDb.llmIntegration.findUnique.mockResolvedValue({
        isDeleted: false,
        status: "ACTIVE",
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1,
        { llmIntegrationId: 7, modelOverride: "claude-3-haiku" }
      );
      expect(result).toBeNull();
    });

    it("Level 1 — enabled override with integration still resolves normally", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue({
        enabled: true,
        llmIntegrationId: 10,
        model: "gpt-4o",
        llmIntegration: { isDeleted: false, status: "ACTIVE" },
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toEqual({ integrationId: 10, model: "gpt-4o" });
    });

    // Level 2 — per-prompt assignment
    it("Level 2 — returns per-prompt integration when Level 1 is empty", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue(null);
      resolveDb.llmIntegration.findUnique.mockResolvedValue({
        isDeleted: false,
        status: "ACTIVE",
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1,
        { llmIntegrationId: 7, modelOverride: "claude-3-haiku" }
      );
      expect(result).toEqual({ integrationId: 7, model: "claude-3-haiku" });
    });

    it("Level 2 — returns undefined model when no modelOverride provided", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue(null);
      resolveDb.llmIntegration.findUnique.mockResolvedValue({
        isDeleted: false,
        status: "ACTIVE",
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1,
        { llmIntegrationId: 7 }
      );
      expect(result).toEqual({ integrationId: 7, model: undefined });
    });

    it("Level 2 — skips per-prompt when integration is inactive, falls to Level 3", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue(null);
      resolveDb.llmIntegration.findUnique.mockResolvedValue({
        isDeleted: false,
        status: "INACTIVE",
      });
      resolveDb.projectLlmIntegration.findFirst.mockResolvedValue({
        llmIntegrationId: 3,
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1,
        { llmIntegrationId: 7, modelOverride: "claude-3-haiku" }
      );
      expect(result).toEqual({ integrationId: 3 });
    });

    // Level 3 — project default
    it("Level 3 — returns project default integration when Levels 1 and 2 are empty", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue(null);
      resolveDb.projectLlmIntegration.findFirst.mockResolvedValue({
        llmIntegrationId: 5,
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toEqual({ integrationId: 5 });
    });

    it("Level 3 — falls back to system default when no project integration exists", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue(null);
      resolveDb.projectLlmIntegration.findFirst.mockResolvedValue(null);
      resolveDb.llmProviderConfig.findFirst.mockResolvedValue({
        llmIntegrationId: 1,
      });
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toEqual({ integrationId: 1 });
    });

    it("returns null when no integration found at any level", async () => {
      resolveDb.llmFeatureConfig.findUnique.mockResolvedValue(null);
      resolveDb.projectLlmIntegration.findFirst.mockResolvedValue(null);
      resolveDb.llmProviderConfig.findFirst.mockResolvedValue(null);
      const result = await resolveManager.resolveIntegration(
        "test_case_generation",
        1
      );
      expect(result).toBeNull();
    });
  });
});
