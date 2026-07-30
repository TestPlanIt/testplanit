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

  function makeEntity(id: number, estimatedTokens: number): EntityContent {
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
    const entities = [
      makeEntity(1, 200),
      makeEntity(2, 200),
      makeEntity(3, 200),
    ];
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
    const entities = [
      makeEntity(1, 100),
      makeEntity(2, 5000),
      makeEntity(3, 100),
    ];
    const truncateItem = (
      item: EntityContent,
      maxChars: number
    ): EntityContent => ({
      ...item,
      textContent: item.textContent.slice(0, maxChars),
      estimatedTokens: Math.ceil(
        Math.min(item.textContent.length, maxChars) / 4
      ),
    });
    const batches = createBatches(entities, defaultConfig, truncateItem);
    // Entity 2 should be alone in a batch, truncated
    expect(batches.length).toBeGreaterThanOrEqual(2);

    // Find the batch with entity 2
    const oversizedBatch = batches.find((b) => b.some((e) => e.id === 2));
    expect(oversizedBatch).toBeDefined();
    expect(oversizedBatch).toHaveLength(1);
    // Its estimated tokens should be <= budget
    const truncatedEntity = oversizedBatch![0]!;
    const budget = Math.floor(
      defaultConfig.maxTokensPerRequest * defaultConfig.contentBudgetRatio! -
        defaultConfig.systemPromptTokens
    );
    expect(truncatedEntity.estimatedTokens).toBeLessThanOrEqual(budget);
  });

  it("handles empty entities array", () => {
    const batches = createBatches([], defaultConfig);
    expect(batches).toHaveLength(0);
  });

  it("keeps the content budget positive when the system prompt exceeds it", () => {
    // A global tag list large enough to outgrow the context window would drive
    // the raw budget negative, making `slice(0, maxChars)` trim from the end.
    const config: BatchConfig = {
      maxTokensPerRequest: 4096,
      contentBudgetRatio: 0.65,
      systemPromptTokens: 100_000,
    };
    const entity = makeEntity(1, 5000);
    const seenMaxChars: number[] = [];
    const batches = createBatches(
      [entity],
      config,
      (item: EntityContent, maxChars: number) => {
        seenMaxChars.push(maxChars);
        return {
          ...item,
          textContent: item.textContent.slice(0, maxChars),
          estimatedTokens: Math.ceil(
            Math.min(item.textContent.length, maxChars) / 4
          ),
        };
      }
    );

    expect(seenMaxChars.every((n) => n > 0)).toBe(true);
    const truncated = batches[0]![0]!;
    expect(truncated.textContent.length).toBeGreaterThan(0);
    expect(truncated.textContent.length).toBeLessThan(
      entity.textContent.length
    );
    expect(entity.textContent.startsWith(truncated.textContent)).toBe(true);
  });
});

// ─── TagAnalysisService unit tests ───────────────────────────────────────────

describe("TagAnalysisService", () => {
  // Mock factories
  const mockDb = {
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
      mockDb,
      mockLlmManager,
      mockPromptResolver
    );
  });

  function setupDefaults() {
    mockLlmManager.getDefaultIntegration.mockResolvedValue(1);
    mockLlmManager.getProjectIntegration.mockResolvedValue(1);
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 1 });
    mockDb.llmProviderConfig.findFirst.mockResolvedValue({
      maxTokensPerRequest: 4096,
    });
    mockDb.tags.findMany.mockResolvedValue([
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

    mockDb.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Login test case",
        steps: [
          {
            step: "Navigate to login",
            expectedResult: "Page loads",
            isDeleted: false,
            order: 1,
          },
        ],
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

    mockDb.repositoryCases.findMany.mockResolvedValue([
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

    mockDb.repositoryCases.findMany.mockResolvedValue([
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
      })
    ).rejects.toThrow(/no llm integration configured/i);
  });

  it("handles LLM call failure gracefully per batch", async () => {
    setupDefaults();

    mockDb.repositoryCases.findMany.mockResolvedValue([
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
    mockDb.repositoryCases.findMany.mockResolvedValue([
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

    mockDb.repositoryCases.findMany.mockResolvedValue([
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

    mockDb.repositoryCases.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Login test",
        steps: [],
        caseFieldValues: [],
        caseTags: [{ tag: { name: "regression" } }],
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
      (s) => s.tagName.toLowerCase() === "login"
    );
    expect(loginSugg?.isExisting).toBe(true);
    expect(loginSugg?.matchedExistingTag).toBe("login");

    // "regression" is already on entity -> filtered out
    const regrSugg = result.suggestions.find(
      (s) => s.tagName.toLowerCase() === "regression"
    );
    expect(regrSugg).toBeUndefined();

    // "new-feature" is new
    const newSugg = result.suggestions.find((s) => s.tagName === "new-feature");
    expect(newSugg?.isExisting).toBe(false);
  });

  // ── Large-selection guards ─────────────────────────────────────────────

  /** Minimal repositoryCase rows, small enough that only the entity cap bites. */
  function makeCases(count: number, folder: any = null) {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `Case ${i + 1}`,
      steps: [],
      caseFieldValues: [],
      caseTags: [],
      folder,
    }));
  }

  it("caps entities per LLM request even when the token budget allows more", async () => {
    setupDefaults();
    // Budgets generous enough that nothing but the hard cap limits batch size:
    // 128k context, and 16384 output tokens is room for ~190 entities.
    mockDb.llmProviderConfig.findFirst.mockResolvedValue({
      maxTokensPerRequest: 128_000,
    });
    mockPromptResolver.resolve.mockResolvedValue({
      systemPrompt: "You are a tag suggestion assistant.",
      userPrompt: "",
      temperature: 0.3,
      maxOutputTokens: 16384,
      source: "fallback",
    });

    mockDb.repositoryCases.findMany.mockResolvedValue(makeCases(60));

    const batchSizes: number[] = [];
    mockLlmManager.chat.mockImplementation(async (_id: number, req: any) => {
      batchSizes.push(
        (req.messages[1].content.match(/--- Entity /g) ?? []).length
      );
      return {
        content: JSON.stringify({ suggestions: [] }),
        model: "gpt-4",
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
      };
    });

    await service.analyzeTags({
      entityIds: Array.from({ length: 60 }, (_, i) => i + 1),
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    expect(batchSizes.length).toBeGreaterThan(1);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(50);
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(60);
  });

  it("clamps an over-large prompt-config maxOutputTokens to the provider ceiling", async () => {
    setupDefaults();
    // Admin set 200k output tokens on a provider that only serves 8192.
    mockDb.llmProviderConfig.findFirst.mockResolvedValue({
      maxTokensPerRequest: 8192,
    });
    mockPromptResolver.resolve.mockResolvedValue({
      systemPrompt: "You are a tag suggestion assistant.",
      userPrompt: "",
      temperature: 0.3,
      maxOutputTokens: 200_000,
      source: "fallback",
    });

    mockDb.repositoryCases.findMany.mockResolvedValue(makeCases(1));
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
      projectId: 5,
      userId: "u1",
    });

    // Sent verbatim, the provider would reject the request outright
    expect(mockLlmManager.chat.mock.calls[0][1].maxTokens).toBe(8192);
  });

  it("lets the output-token budget bind before the entity cap", async () => {
    setupDefaults();
    // Default 4096 output tokens leaves room for fewer than the 50 cap, so the
    // token math — not the ceiling — decides the batch size.
    mockDb.llmProviderConfig.findFirst.mockResolvedValue({
      maxTokensPerRequest: 128_000,
    });
    mockPromptResolver.resolve.mockResolvedValue({
      systemPrompt: "You are a tag suggestion assistant.",
      userPrompt: "",
      temperature: 0.3,
      maxOutputTokens: 4096,
      source: "fallback",
    });

    mockDb.repositoryCases.findMany.mockResolvedValue(makeCases(100));

    const batchSizes: number[] = [];
    mockLlmManager.chat.mockImplementation(async (_id: number, req: any) => {
      batchSizes.push(
        (req.messages[1].content.match(/--- Entity /g) ?? []).length
      );
      return {
        content: JSON.stringify({ suggestions: [] }),
        model: "gpt-4",
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
      };
    });

    await service.analyzeTags({
      entityIds: Array.from({ length: 100 }, (_, i) => i + 1),
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    // floor(4096 * 0.7 / 60) = 47
    expect(Math.max(...batchSizes)).toBe(47);
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("caps the existing-tag list sent in the prompt but still matches against all tags", async () => {
    setupDefaults();
    // 600 tags, one of which the model will echo back from beyond the cap.
    const tagNames = Array.from({ length: 600 }, (_, i) => `tag-${i}`);
    mockDb.tags.findMany.mockResolvedValue(
      tagNames.map((name, i) => ({ id: i + 1, name }))
    );
    mockDb.repositoryCases.findMany.mockResolvedValue(makeCases(1));

    let promptedTagCount = 0;
    mockLlmManager.chat.mockImplementation(async (_id: number, req: any) => {
      const listed = req.messages[1].content
        .split("EXISTING PROJECT TAGS:")[1]
        .split("\n")[1];
      promptedTagCount = listed.split(", ").length;
      return {
        content: JSON.stringify({
          suggestions: [{ entityId: 1, tags: ["tag-599"] }],
        }),
        model: "gpt-4",
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
      };
    });

    const result = await service.analyzeTags({
      entityIds: [1],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    expect(promptedTagCount).toBe(500);
    // "tag-599" was never listed in the prompt, but matching uses the full set
    expect(result.suggestions[0]?.isExisting).toBe(true);
    expect(result.suggestions[0]?.matchedExistingTag).toBe("tag-599");
  });

  it("stops instead of looping when a single entity's response stays truncated", async () => {
    setupDefaults();
    mockDb.repositoryCases.findMany.mockResolvedValue(makeCases(1));

    // Unterminated JSON that salvages to a response about a different entity,
    // so entity 1 is always missing from the parsed suggestions.
    mockLlmManager.chat.mockResolvedValue({
      content: '{"suggestions":[{"entityId":999,"tags":["a"]}',
      model: "gpt-4",
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60,
    });

    const result = await service.analyzeTags({
      entityIds: [1],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    expect(mockLlmManager.chat).toHaveBeenCalledTimes(1);
    expect(result.truncatedEntityIds).toEqual([1]);
    expect(result.suggestions).toEqual([]);
  });

  it("resolves each folder path once instead of per case", async () => {
    setupDefaults();
    const folder = { id: 10, name: "Checkout", parentId: 5 };
    mockDb.repositoryCases.findMany.mockResolvedValue(makeCases(5, folder));
    mockDb.repositoryFolders.findUnique.mockResolvedValue({
      id: 5,
      name: "Web",
      parentId: null,
    });

    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({ suggestions: [] }),
      model: "gpt-4",
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60,
    });

    await service.analyzeTags({
      entityIds: [1, 2, 3, 4, 5],
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    // Without memoization this walks the tree once per case
    expect(mockDb.repositoryFolders.findUnique).toHaveBeenCalledTimes(1);
  });

  it("fetches entities in id-chunks rather than one giant IN list", async () => {
    setupDefaults();
    const entityIds = Array.from({ length: 1200 }, (_, i) => i + 1);
    mockDb.repositoryCases.findMany.mockImplementation(async ({ where }: any) =>
      makeCases(where.id.in.length)
    );

    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({ suggestions: [] }),
      model: "gpt-4",
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60,
    });

    await service.analyzeTags({
      entityIds,
      entityType: "repositoryCase",
      projectId: 5,
      userId: "u1",
    });

    const idCounts = mockDb.repositoryCases.findMany.mock.calls.map(
      ([args]: any[]) => args.where.id.in.length
    );
    expect(idCounts).toEqual([500, 500, 200]);
  });

  it("filters out new tags when allowNewTags is false", async () => {
    setupDefaults();

    mockDb.repositoryCases.findMany.mockResolvedValue([
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
