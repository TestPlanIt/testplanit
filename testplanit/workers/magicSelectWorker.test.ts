import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildUserPrompt,
  compressCaseForPrompt,
  type CompressedTestCase,
} from "./magicSelectWorker";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockUpdateProgress,
  mockFindManyRepositoryCases,
  mockFindFirstLlmProviderConfig,
  mockFindFirstProjectAccess,
  mockFindManyIssues,
  mockFindFirstProject,
  mockCountRepositoryCases,
  mockChat,
  mockResolveIntegration,
  mockResolve,
  mockCreateBatches,
  mockExecuteBatches,
} = vi.hoisted(() => ({
  mockUpdateProgress: vi.fn(),
  mockFindManyRepositoryCases: vi.fn(),
  mockFindFirstLlmProviderConfig: vi.fn(),
  mockFindFirstProjectAccess: vi.fn(),
  mockFindManyIssues: vi.fn(),
  mockFindFirstProject: vi.fn(),
  mockCountRepositoryCases: vi.fn(),
  mockChat: vi.fn(),
  mockResolveIntegration: vi.fn(),
  mockResolve: vi.fn(),
  mockCreateBatches: vi.fn(),
  mockExecuteBatches: vi.fn(),
}));

// ─── Mock bullmq Worker ───────────────────────────────────────────────────────

vi.mock("bullmq", async (importOriginal) => {
  const original = await importOriginal<typeof import("bullmq")>();
  return {
    ...original,
    Worker: class MockWorker {
      on = vi.fn();
      close = vi.fn();
      getBackend = () => ({ client: this.client });
      client = Promise.resolve({
        get: vi.fn().mockResolvedValue(null),
        del: vi.fn().mockResolvedValue(0),
      });
      constructor() {}
    },
  };
});

// Provide a truthy valkey connection so startMagicSelectWorker() creates the Worker instance
vi.mock("../lib/valkey", () => ({
  default: { status: "ready" },
}));

// ─── Mock queue names ─────────────────────────────────────────────────────────

vi.mock("../lib/queueNames", () => ({
  MAGIC_SELECT_QUEUE_NAME: "test-magic-select-queue",
}));

// ─── Mock db ─────────────────────────────────────────────────────────────

const mockDb: any = {
  repositoryCases: {
    findMany: (...args: any[]) => mockFindManyRepositoryCases(...args),
    count: (...args: any[]) => mockCountRepositoryCases(...args),
  },
  llmProviderConfig: {
    findFirst: (...args: any[]) => mockFindFirstLlmProviderConfig(...args),
  },
  projectAccess: {
    findFirst: (...args: any[]) => mockFindFirstProjectAccess(...args),
  },
  issue: {
    findMany: (...args: any[]) => mockFindManyIssues(...args),
  },
  projects: {
    findFirst: (...args: any[]) => mockFindFirstProject(...args),
    // Worker reads `excludeNotStartedFromRuns` to decide whether to add a
    // `state.workflowType != NOT_STARTED` filter. The unit tests assert
    // token/retry behavior, not the flag itself; returning the default (off)
    // preserves the pre-existing query shape these tests rely on.
    findUnique: vi.fn(async () => ({ excludeNotStartedFromRuns: false })),
  },
  $disconnect: vi.fn(),
};

vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: vi.fn(() => mockDb),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// ─── Mock LlmManager ─────────────────────────────────────────────────────────

const mockManager = {
  chat: (...args: any[]) => mockChat(...args),
  resolveIntegration: (...args: any[]) => mockResolveIntegration(...args),
};

vi.mock("../lib/llm/services/llm-manager.service", () => ({
  LlmManager: {
    createForWorker: vi.fn(() => mockManager),
  },
}));

// ─── Mock PromptResolver ──────────────────────────────────────────────────────

const _mockResolver = {
  resolve: (...args: any[]) => mockResolve(...args),
};

vi.mock("../lib/llm/services/prompt-resolver.service", () => ({
  PromptResolver: class MockPromptResolver {
    resolve = (...args: any[]) => mockResolve(...args);
    constructor() {}
  },
}));

// ─── Mock elasticsearchService ───────────────────────────────────────────────

vi.mock("../services/elasticsearchService", () => ({
  getElasticsearchClient: vi.fn(() => null),
  getRepositoryCaseIndexName: vi.fn(() => "test-repository-cases"),
}));

// ─── Mock batch-processor ────────────────────────────────────────────────────

vi.mock("../lib/llm/services/batch-processor", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../lib/llm/services/batch-processor")
    >();
  return {
    ...original,
    createBatches: (...args: any[]) => mockCreateBatches(...args),
    executeBatches: (...args: any[]) => mockExecuteBatches(...args),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseJobData = {
  projectId: 42,
  userId: "user-1",
  testRunMetadata: {
    name: "Login Feature Test Run",
    description: null,
    docs: null,
    linkedIssueIds: [],
    tags: [],
  },
};

function makeMockJob(
  overrides: Partial<{
    id: string;
    data: typeof baseJobData;
  }> = {}
): unknown {
  return {
    id: "job-1",
    name: "run-magic-select",
    data: baseJobData,
    updateProgress: mockUpdateProgress,
    ...overrides,
  };
}

const mockCompressedCase = {
  id: 1,
  name: "Login Test",
  folder: null,
  caseTags: [],
  caseFieldValues: [],
  linksFrom: [],
  linksTo: [],
};

const defaultResolvedPrompt = {
  systemPrompt: "You are a QA engineer.",
  userPrompt: "",
  temperature: 0.7,
  maxOutputTokens: 2000,
  source: "fallback" as const,
};

const defaultIntegration = {
  integrationId: 100,
  model: "gpt-4",
};

const defaultChatResponse = {
  content: '{"caseIds":[1],"reasoning":"Login test is relevant"}',
  model: "gpt-4",
  promptTokens: 500,
  completionTokens: 100,
  totalTokens: 600,
  finishReason: "stop" as const,
};

async function loadWorker() {
  const mod = await import("./magicSelectWorker");
  mod.startMagicSelectWorker();
  return mod;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MagicSelectWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockUpdateProgress.mockResolvedValue(undefined);
    mockFindManyRepositoryCases.mockResolvedValue([mockCompressedCase]);
    mockCountRepositoryCases.mockResolvedValue(1);
    mockFindFirstLlmProviderConfig.mockResolvedValue(null);
    mockFindManyIssues.mockResolvedValue([]);
    mockFindFirstProject.mockResolvedValue({ id: 42, name: "Test Project" });

    mockResolveIntegration.mockResolvedValue(defaultIntegration);
    mockResolve.mockResolvedValue(defaultResolvedPrompt);
    mockChat.mockResolvedValue(defaultChatResponse);

    // createBatches returns 1 batch with the case
    mockCreateBatches.mockReturnValue([
      [
        {
          id: 1,
          estimatedTokens: 100,
          name: "Login Test",
          folderPath: "/",
          tags: [],
          fields: {},
          linksTo: [],
          linksFrom: [],
        },
      ],
    ]);

    // executeBatches calls processBatch and returns results
    mockExecuteBatches.mockImplementation(async (options: any) => {
      const results = [];
      for (let i = 0; i < options.batches.length; i++) {
        try {
          const result = await options.processBatch(options.batches[i], i);
          results.push(result);
        } catch {
          // swallow
        }
        if (options.onBatchComplete) {
          await options.onBatchComplete(i + 1, options.batches.length);
        }
      }
      return {
        results,
        batchCount: options.batches.length,
        failedBatchCount: 0,
        errors: [],
        failedItemIds: [],
        cancelled: false,
      };
    });
  });

  describe("TOKEN-04: provider-configured token management", () => {
    it("Test 1: When llmProviderConfig returns maxTokensPerRequest=8192 and defaultMaxTokens=1500, worker uses those values (not hardcoded defaults)", async () => {
      mockFindFirstLlmProviderConfig.mockResolvedValue({
        maxTokensPerRequest: 8192,
        defaultMaxTokens: 1500,
        retryAttempts: 5,
      });

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-token-1" }) as Job);

      // createBatches should have been called with maxTokensPerRequest=8192
      expect(mockCreateBatches).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ maxTokensPerRequest: 8192 })
      );

      // LLM request should use maxTokens=1500
      expect(mockChat).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxTokens: 1500 }),
        expect.anything()
      );
    });

    it("Test 2: When llmProviderConfig is null, worker uses fallback maxTokensPerRequest=4096 and maxTokens=2000", async () => {
      mockFindFirstLlmProviderConfig.mockResolvedValue(null);

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-token-2" }) as Job);

      // createBatches should have been called with default maxTokensPerRequest=4096
      expect(mockCreateBatches).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ maxTokensPerRequest: 4096 })
      );

      // LLM request should use default maxTokens=2000
      // 3rd arg is undefined since retryOptions is not set when config is null
      expect(mockChat).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxTokens: 2000 }),
        undefined
      );
    });
  });

  describe("RETRY-05: truncation reporting", () => {
    it("Test 3: When manager.chat returns finishReason='length' for batch 1, truncatedBatches contains [1]", async () => {
      mockChat.mockResolvedValue({
        ...defaultChatResponse,
        finishReason: "length" as const,
      });

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ id: "job-truncation-1" }) as Job
      );

      expect(result.truncatedBatches).toContain(0); // batch index 0 (first batch)
    });

    it("Test 4: When all batches return finishReason='stop', truncatedBatches is empty array []", async () => {
      mockChat.mockResolvedValue({
        ...defaultChatResponse,
        finishReason: "stop" as const,
      });

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ id: "job-truncation-2" }) as Job
      );

      expect(result.truncatedBatches).toEqual([]);
    });
  });

  describe("WORKER-01: retry options and progress", () => {
    it("Test 5: retryOptions from llmProviderConfig.retryAttempts are passed as 3rd arg to manager.chat()", async () => {
      mockFindFirstLlmProviderConfig.mockResolvedValue({
        maxTokensPerRequest: 4096,
        defaultMaxTokens: 2000,
        retryAttempts: 7,
      });

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-retry-1" }) as Job);

      expect(mockChat).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ maxRetries: 7 })
      );
    });

    it("Test 6: Worker calls job.updateProgress with batch progress during execution", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-progress-1" }) as Job);

      // Should have called updateProgress at least once with phase: "ai"
      expect(mockUpdateProgress).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "ai" })
      );
    });
  });
});

describe("buildUserPrompt — risk as context", () => {
  const run = {
    name: "Checkout regression",
    description: null,
    docs: null,
    linkedIssueIds: [],
  };
  const testCase = (id: number, risk?: number): CompressedTestCase => ({
    id,
    name: `case ${id}`,
    folderPath: "/",
    tags: [],
    fields: {},
    linksTo: [],
    linksFrom: [],
    ...(risk == null ? {} : { risk }),
  });

  it("sends each score and says how to weigh it", () => {
    const prompt = buildUserPrompt(run, [], [testCase(1, 73), testCase(2, 8)]);

    expect(prompt).toContain("linkedFrom[]?, risk?]");
    expect(prompt).toContain('[[1,"case 1",null,null,null,null,null,73]');
    expect(prompt).toContain("prefer the higher risk");
    // The score must not become a reason to select, or Magic Select starts
    // picking fragile cases that have nothing to do with the run.
    expect(prompt).toContain("Never select a case for its risk alone");
  });

  it("says nothing about risk when the project keeps no scores", () => {
    const prompt = buildUserPrompt(run, [], [testCase(1), testCase(2)]);

    expect(prompt).toContain("linkedFrom[]?]");
    expect(prompt).not.toContain("risk");
    // Trailing nulls are trimmed, so the position costs nothing.
    expect(prompt).toContain('[[1,"case 1"],[2,"case 2"]]');
  });

  it("can be asked for the guidance with no cases, to size a batch", () => {
    // The budget is measured from an empty message; if the guidance were
    // left out there, every batch would be sized ~86 tokens too generously.
    const overhead = buildUserPrompt(run, [], [], undefined, true);

    expect(overhead).toContain("prefer the higher risk");
    expect(buildUserPrompt(run, [], [], undefined, false)).not.toContain(
      "prefer the higher risk"
    );
  });

  it("keeps the positions aligned when only some cases are scored", () => {
    const prompt = buildUserPrompt(run, [], [testCase(1, 50), testCase(2)]);

    expect(prompt).toContain('[1,"case 1",null,null,null,null,null,50]');
    expect(prompt).toContain('[2,"case 2"]');
  });
});

describe("compressCaseForPrompt", () => {
  const base: CompressedTestCase = {
    id: 4,
    name: "case",
    folderPath: "/",
    tags: [],
    fields: {},
    linksTo: [],
    linksFrom: [],
  };

  it("drops every empty position, so a bare case costs two values", () => {
    expect(compressCaseForPrompt(base)).toEqual([4, "case"]);
  });

  it("holds the earlier positions open when a later one is filled", () => {
    expect(compressCaseForPrompt({ ...base, risk: 61 })).toEqual([
      4,
      "case",
      null,
      null,
      null,
      null,
      null,
      61,
    ]);
  });
});
