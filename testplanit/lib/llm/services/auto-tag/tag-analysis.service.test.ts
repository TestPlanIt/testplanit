import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BatchConfig } from "~/lib/llm/services/batch-processor";
import { createBatches } from "~/lib/llm/services/batch-processor";

import { TagAnalysisService } from "./tag-analysis.service";
import type { EntityContent } from "./types";

// ─── createBatches unit tests ────────────────────────────────────────────────

describe("createBatches", () => {
  const defaultConfig: BatchConfig = {
    maxTokensPerRequest: 4096,
    contentBudgetRatio: 0.65,
    systemPromptTokens: 200,
  };

  function makeEntity(
    id: number,
    estimatedTokens: number,
  ): EntityContent {
    return {
      id,
      entityType: "repositoryCase",
      name: `Entity ${id}`,
      textContent: "x".repeat(estimatedTokens * 4),
      existingTagNames: [],
      estimatedTokens,
    };
  }

  it("puts all entities in one batch when they fit", () => {
    const entities = [makeEntity(1, 200), makeEntity(2, 200), makeEntity(3, 200)];
    const batches = createBatches(entities, defaultConfig);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("splits entities across batches when they exceed budget", () => {
    // Budget = 4096 * 0.65 - 200 = 2462.4 => 2462 tokens
    const entities = [
      makeEntity(1, 500),
      makeEntity(2, 500),
      makeEntity(3, 500),
      makeEntity(4, 500),
      makeEntity(5, 500),
      makeEntity(6, 500),
    ];
    const batches = createBatches(entities, defaultConfig);
    // 4 x 500 = 2000 fits, 5th would be 2500 > 2462
    expect(batches.length).toBeGreaterThan(1);
    // All entities accounted for
    const totalEntities = batches.reduce((sum, b) => sum + b.length, 0);
    expect(totalEntities).toBe(6);
  });

  it("truncates oversized entity and puts it in its own batch", () => {
    // Budget ~2462 tokens, entity has 5000 tokens
    const entities = [makeEntity(1, 100), makeEntity(2, 5000), makeEntity(3, 100)];
    const truncateItem = (item: EntityContent, maxChars: number): EntityContent => ({
      ...item,
      textContent: item.textContent.slice(0, maxChars),
      estimatedTokens: Math.ceil(Math.min(item.textContent.length, maxChars) / 4),
    });
    const batches = createBatches(entities, defaultConfig, truncateItem);
    // Entity 2 should be alone in a batch, truncated
    expect(batches.length).toBeGreaterThanOrEqual(2);

    // Find the batch with entity 2
    const oversizedBatch = batches.find((b) =>
      b.some((e) => e.id === 2),
    );
    expect(oversizedBatch).toBeDefined();
    expect(oversizedBatch).toHaveLength(1);
    // Its estimated tokens should be <= budget
    const truncatedEntity = oversizedBatch![0]!;
    const budget = Math.floor(
      defaultConfig.maxTokensPerRequest * defaultConfig.contentBudgetRatio! -
        defaultConfig.systemPromptTokens,
    );
    expect(truncatedEntity.estimatedTokens).toBeLessThanOrEqual(budget);
  });

  it("handles empty entities array", () => {
    const batches = createBatches([], defaultConfig);
    expect(batches).toHaveLength(0);
  });
});

// ─── TagAnalysisService unit tests ───────────────────────────────────────────

describe("TagAnalysisService", () => {
  // Mock factories
  const mockPrisma = {
    llmProviderConfig: {
      findFirst: vi.fn(),
    },
    tags: {
      findMany: vi.fn(),
    },
    repositoryCases: {
      findMany: vi.fn(),
    },
    testRuns: {
      findMany: vi.fn(),
    },
    sessions: {
      findMany: vi.fn(),
    },
    repositoryFolders: {
      findUnique: vi.fn(),
    },
  } as any;

  const mockLlmManager = {
    getDefaultIntegration: vi.fn(),
    getProjectIntegration: vi.fn(),
    resolveIntegration: vi.fn(),
    chat: vi.fn(),
  } as any;

  const mockPromptResolver = {
    resolve: vi.fn(),
  } as any;

  let service: TagAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TagAnalysisService(
      mockPrisma,
      mockLlmManager,
      mockPromptResolver,
    );
  });

  function setupDefaults() {
    mockLlmManager.getDefaultIntegration.mockResolvedValue(1);
    mockLlmManager.getProjectIntegration.mockResolvedValue(1);
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 1 });
    mockPrisma.llmProviderConfig.findFirst.mockResolvedValue({
      maxTokensPerRequest: 4096,
    });
    mockPrisma.tags.findMany.mockResolvedValue([
      { id: 1, name: "login" },
      { id: 2, name: "regression" },
    ]);
    mockPromptResolver.resolve.mockResolvedValue({
      systemPrompt: "You are a tag suggestion assistant.",
      userPrompt: "",
      temperature: 0.3,
      maxOutputTokens: 1024,
      source: "fallback",
    });
  }

  it("returns tag suggestions from valid LLM response", async () => {
    setupDefaults();

    mockPrisma.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Login test case",
        steps: [{ step: "Navigate to login", expectedResult: "Page loads", isDeleted: false, order: 1 }],
        caseFieldValues: [],
        tags: [],
        folder: null,
      },
    ]);

    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [{ entityId: 1, tags: ["login", "authentication", "ui"] }],
      }),
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    const result = await service.analyzeTags({
      entityIds: [1],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.batchCount).toBeGreaterThanOrEqual(1);
    expect(result.entityCount).toBe(1);
    expect(result.totalTokensUsed).toBeGreaterThan(0);
  });

  it("resolves prompt via PromptResolver with correct feature and projectId", async () => {
    setupDefaults();

    mockPrisma.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Test",
        steps: [],
        caseFieldValues: [],
        tags: [],
        folder: null,
      },
    ]);

    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({ suggestions: [] }),
      model: "gpt-4",
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60,
    });

    await service.analyzeTags({
      entityIds: [1],
      entityType: "repositoryCase",
      projectId: 42,
      userId: "u1",
    });

    expect(mockPromptResolver.resolve).toHaveBeenCalledWith("auto_tag", 42);
  });

  it("handles invalid LLM JSON gracefully with empty suggestions", async () => {
    setupDefaults();

    mockPrisma.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Test",
        steps: [],
        caseFieldValues: [],
        tags: [],
        folder: null,
      },
    ]);

    mockLlmManager.chat.mockResolvedValue({
      content: "This is not valid JSON at all!",
      model: "gpt-4",
      promptTokens: 50,
      completionTokens: 20,
      totalTokens: 70,
    });

    const result = await service.analyzeTags({
      entityIds: [1],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    // Should not throw, just return empty suggestions for the bad batch
    expect(result.suggestions).toEqual([]);
    expect(result.batchCount).toBe(1);
  });

  it("throws descriptive error when no default LLM integration", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue(null);

    await expect(
      service.analyzeTags({
        entityIds: [1],
        entityType: "repositoryCase",
        projectId: 5,
        userId: "u1",
      }),
    ).rejects.toThrow(/no llm integration configured/i);
  });

  it("handles LLM call failure gracefully per batch", async () => {
    setupDefaults();

    mockPrisma.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Test",
        steps: [],
        caseFieldValues: [],
        tags: [],
        folder: null,
      },
    ]);

    mockLlmManager.chat.mockRejectedValue(new Error("LLM service unavailable"));

    const result = await service.analyzeTags({
      entityIds: [1],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    // Should not throw, just return empty suggestions
    expect(result.suggestions).toEqual([]);
    expect(result.batchCount).toBe(1);
  });

  it("calls onBatchComplete callback with correct progress values", async () => {
    setupDefaults();

    // Use long names so each entity's estimated tokens exceeds half the budget,
    // forcing 2 separate batches. Budget = floor(4096 * 0.65 - systemPromptTokens) ~2400.
    // Each entity with ~6000 char name → ~1500 tokens → 2 batches.
    const longName = "x".repeat(6000);
    mockPrisma.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: longName + " entity1",
        steps: [],
        caseFieldValues: [],
        tags: [],
        folder: null,
      },
      {
        id: 2,
        name: longName + " entity2",
        steps: [],
        caseFieldValues: [],
        tags: [],
        folder: null,
      },
    ]);

    let chatCallCount = 0;
    mockLlmManager.chat.mockImplementation(async () => {
      chatCallCount++;
      return {
        content: JSON.stringify({ suggestions: [] }),
        model: "gpt-4",
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
      };
    });

    const onBatchComplete = vi.fn().mockResolvedValue(undefined);

    await service.analyzeTags({
      entityIds: [1, 2],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
      onBatchComplete,
    });

    // Each entity is ~1500 tokens, budget ~2400, so they can't both fit in one batch
    expect(chatCallCount).toBe(2);
    expect(onBatchComplete).toHaveBeenCalledTimes(2);
    // First call: 1 processed out of 2
    expect(onBatchComplete).toHaveBeenNthCalledWith(1, 1, 2);
    // Second call: 2 processed out of 2
    expect(onBatchComplete).toHaveBeenNthCalledWith(2, 2, 2);
  });

  // Backward compatibility: existing tests implicitly verify that analyzeTags works
  // without onBatchComplete (it's optional). The tests above ("returns tag suggestions
  // from valid LLM response", etc.) all pass without providing onBatchComplete.

  it("calls onBatchComplete even when a batch fails", async () => {
    setupDefaults();

    mockPrisma.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Test",
        steps: [],
        caseFieldValues: [],
        tags: [],
        folder: null,
      },
    ]);

    mockLlmManager.chat.mockRejectedValue(new Error("LLM service unavailable"));

    const onBatchComplete = vi.fn().mockResolvedValue(undefined);

    const result = await service.analyzeTags({
      entityIds: [1],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
      onBatchComplete,
    });

    // Even though the batch failed, callback should still be called
    expect(onBatchComplete).toHaveBeenCalledTimes(1);
    expect(onBatchComplete).toHaveBeenCalledWith(1, 1);
    expect(result.suggestions).toEqual([]);
  });

  it("properly fuzzy-matches LLM suggestions against existing tags", async () => {
    setupDefaults();

    mockPrisma.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Login test",
        steps: [],
        caseFieldValues: [],
        tags: [{ name: "regression" }],
        folder: null,
      },
    ]);

    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          { entityId: 1, tags: ["Login", "regression", "new-feature"] },
        ],
      }),
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    const result = await service.analyzeTags({
      entityIds: [1],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    // "Login" matches existing "login"
    const loginSugg = result.suggestions.find(
      (s) => s.tagName.toLowerCase() === "login",
    );
    expect(loginSugg?.isExisting).toBe(true);
    expect(loginSugg?.matchedExistingTag).toBe("login");

    // "regression" is already on entity -> filtered out
    const regrSugg = result.suggestions.find(
      (s) => s.tagName.toLowerCase() === "regression",
    );
    expect(regrSugg).toBeUndefined();

    // "new-feature" is new
    const newSugg = result.suggestions.find(
      (s) => s.tagName === "new-feature",
    );
    expect(newSugg?.isExisting).toBe(false);
  });

  it("filters out new tags when allowNewTags is false", async () => {
    setupDefaults();

    mockPrisma.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Login test",
        steps: [],
        caseFieldValues: [],
        tags: [],
        folder: null,
      },
    ]);

    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({
        suggestions: [{ entityId: 1, tags: ["login", "new-feature"] }],
      }),
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    const result = await service.analyzeTags({
      entityIds: [1],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
      allowNewTags: false,
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.matchedExistingTag).toBe("login");
    expect(result.suggestions[0]?.isExisting).toBe(true);
  });
});
