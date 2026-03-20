import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────
// These refs persist across vi.resetModules() calls

const { mockRedisGet, mockRedisDel, mockAnalyzeTags, mockUpdateProgress } =
  vi.hoisted(() => ({
    mockRedisGet: vi.fn(),
    mockRedisDel: vi.fn(),
    mockAnalyzeTags: vi.fn(),
    mockUpdateProgress: vi.fn(),
  }));

const mockRedisClient = {
  get: (...args: any[]) => mockRedisGet(...args),
  del: (...args: any[]) => mockRedisDel(...args),
};

// ─── Mock bullmq Worker to provide a mock Redis client ───────────────────────
// autoTagWorker.ts sets the module-level `worker` variable in startWorker().
// We mock the Worker class so the instance provides a `.client` promise
// pointing to our mock Redis client.

vi.mock("bullmq", async (importOriginal) => {
  const original = await importOriginal<typeof import("bullmq")>();
  return {
    ...original,
    Worker: class MockWorker {
      client = Promise.resolve(mockRedisClient);
      on = vi.fn();
      close = vi.fn();
      constructor() {}
    },
  };
});

// Provide a truthy valkey connection so startWorker() creates the Worker instance
vi.mock("../lib/valkey", () => ({
  default: { status: "ready" },
}));

// ─── Mock prisma ─────────────────────────────────────────────────────────────

const mockPrisma = {
  repositoryCases: {
    findMany: vi.fn(),
  },
  testRuns: {
    findMany: vi.fn(),
  },
  sessions: {
    findMany: vi.fn(),
  },
  $disconnect: vi.fn(),
};

vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// ─── Mock LLM services ───────────────────────────────────────────────────────

vi.mock("../lib/llm/services/auto-tag/tag-analysis.service", () => ({
  TagAnalysisService: class MockTagAnalysisService {
    analyzeTags = (...args: any[]) => mockAnalyzeTags(...args);
    constructor() {}
  },
}));

vi.mock("../lib/llm/services/llm-manager.service", () => ({
  LlmManager: {
    createForWorker: vi.fn(() => ({})),
  },
}));

vi.mock("../lib/llm/services/prompt-resolver.service", () => ({
  PromptResolver: class MockPromptResolver {
    constructor() {}
  },
}));

// ─── Mock queue name ─────────────────────────────────────────────────────────

vi.mock("../lib/queueNames", () => ({
  AUTO_TAG_QUEUE_NAME: "test-auto-tag-queue",
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseJobData = {
  entityIds: [1, 2, 3],
  entityType: "repositoryCase" as const,
  projectId: 10,
  userId: "user-1",
};

const baseAnalysisResult = {
  suggestions: [
    {
      entityId: 1,
      entityType: "repositoryCase" as const,
      tagName: "frontend",
      isExisting: true,
    },
    {
      entityId: 1,
      entityType: "repositoryCase" as const,
      tagName: "ui",
      isExisting: false,
    },
    {
      entityId: 2,
      entityType: "repositoryCase" as const,
      tagName: "backend",
      isExisting: true,
    },
  ],
  totalTokensUsed: 800,
  batchCount: 2,
  entityCount: 3,
  failedBatchCount: 0,
  errors: [],
  failedEntityIds: [],
  truncatedEntityIds: [],
  cancelled: false,
};

const mockRepositoryCases = [
  {
    id: 1,
    name: "Login Test",
    automated: false,
    source: "manual",
    tags: [{ name: "frontend" }],
  },
  {
    id: 2,
    name: "API Test",
    automated: true,
    source: "cypress",
    tags: [{ name: "backend" }],
  },
  { id: 3, name: "UI Test", automated: false, source: null, tags: [] },
];

// Helper to load a fresh module and call startWorker to initialise the
// module-level `worker` variable so `worker!.client` works in the processor.
async function loadWorker() {
  const mod = await import("./autoTagWorker");
  // Call startWorker to create the Worker instance (sets module-level `worker`)
  await mod.startWorker();
  return mod;
}

function makeMockJob(
  overrides: Partial<{
    id: string;
    data: typeof baseJobData;
  }> = {}
): unknown {
  return {
    id: "job-1",
    name: "run-auto-tag",
    data: baseJobData,
    updateProgress: mockUpdateProgress,
    ...overrides,
  };
}

describe("AutoTagWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: no cancellation keys
    mockRedisGet.mockResolvedValue(null);
    mockRedisDel.mockResolvedValue(1);
    mockUpdateProgress.mockResolvedValue(undefined);
  });

  describe("successful tag analysis", () => {
    it("should process repositoryCase entities and return grouped suggestions", async () => {
      mockAnalyzeTags.mockResolvedValue(baseAnalysisResult);
      mockPrisma.repositoryCases.findMany.mockResolvedValue(mockRepositoryCases);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob() as Job);

      expect(result.suggestions).toBeDefined();
      const entity1 = result.suggestions.find((s) => s.entityId === 1);
      const entity2 = result.suggestions.find((s) => s.entityId === 2);
      expect(entity1?.entityName).toBe("Login Test");
      expect(entity1?.tags).toHaveLength(2); // frontend + ui
      expect(entity1?.automated).toBe(false);
      expect(entity1?.source).toBe("manual");
      expect(entity2?.entityName).toBe("API Test");
      expect(entity2?.tags).toHaveLength(1); // backend
      expect(entity2?.automated).toBe(true);
    });

    it("should include entity with no suggestions (analyzed but LLM returned no tags)", async () => {
      mockAnalyzeTags.mockResolvedValue(baseAnalysisResult);
      mockPrisma.repositoryCases.findMany.mockResolvedValue(mockRepositoryCases);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ id: "job-2" }) as Job);

      // Entity 3 had no suggestions returned by the analysis
      const entity3 = result.suggestions.find((s) => s.entityId === 3);
      expect(entity3).toBeDefined();
      expect(entity3?.tags).toEqual([]);
      expect(entity3?.entityName).toBe("UI Test");
    });

    it("should calculate stats correctly", async () => {
      mockAnalyzeTags.mockResolvedValue(baseAnalysisResult);
      mockPrisma.repositoryCases.findMany.mockResolvedValue(mockRepositoryCases);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ id: "job-3" }) as Job);

      expect(result.stats).toMatchObject({
        entityCount: 3,
        totalSuggestions: 3,
        existingTagCount: 2, // frontend + backend are isExisting: true
        newTagCount: 1, // ui is isExisting: false
        totalTokensUsed: 800,
        batchCount: 2,
        failedBatchCount: 0,
      });
    });

    it("should report progress via job.updateProgress", async () => {
      mockAnalyzeTags.mockImplementation(async (params: any) => {
        // Simulate batch completion callbacks
        await params.onBatchComplete(2, 3);
        await params.onBatchComplete(3, 3);
        return baseAnalysisResult;
      });
      mockPrisma.repositoryCases.findMany.mockResolvedValue(mockRepositoryCases);

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-4" }) as Job);

      expect(mockUpdateProgress).toHaveBeenCalledWith({ analyzed: 2, total: 3 });
      expect(mockUpdateProgress).toHaveBeenCalledWith({ analyzed: 3, total: 3 });
      // Final "finalizing" progress update
      expect(mockUpdateProgress).toHaveBeenCalledWith({
        analyzed: 3,
        total: 3,
        finalizing: true,
      });
    });
  });

  describe("cancellation", () => {
    it("should throw 'Job cancelled by user' when pre-start cancellation key exists", async () => {
      mockRedisGet.mockResolvedValue("1"); // Cancel key exists

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-5" }) as Job)
      ).rejects.toThrow("Job cancelled by user");

      // analyzeTags should not have been called
      expect(mockAnalyzeTags).not.toHaveBeenCalled();
    });

    it("should delete cancellation key after detecting pre-start cancellation", async () => {
      mockRedisGet.mockResolvedValue("1");

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-5b" }) as Job)
      ).rejects.toThrow("Job cancelled by user");

      expect(mockRedisDel).toHaveBeenCalledWith("auto-tag:cancel:job-5b");
    });

    it("should throw 'Job cancelled by user' when isCancelled returns true during analysis", async () => {
      // No pre-start cancellation, but cancellation during analysis
      mockRedisGet
        .mockResolvedValueOnce(null) // Pre-start check: not cancelled
        .mockResolvedValueOnce("1"); // Mid-analysis check: cancelled

      mockAnalyzeTags.mockImplementation(async (params: any) => {
        const cancelled = await params.isCancelled();
        if (cancelled) {
          return { ...baseAnalysisResult, cancelled: true };
        }
        return baseAnalysisResult;
      });

      mockPrisma.repositoryCases.findMany.mockResolvedValue(mockRepositoryCases);

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-6" }) as Job)
      ).rejects.toThrow("Job cancelled by user");
    });
  });

  describe("failed entities", () => {
    it("should include failed entities in suggestions with failed flag and error message", async () => {
      const analysisWithFailures = {
        ...baseAnalysisResult,
        suggestions: [
          {
            entityId: 1,
            entityType: "repositoryCase" as const,
            tagName: "frontend",
            isExisting: true,
          },
        ],
        failedEntityIds: [2],
        errors: ["LLM API timeout"],
      };
      mockAnalyzeTags.mockResolvedValue(analysisWithFailures);
      mockPrisma.repositoryCases.findMany.mockResolvedValue(mockRepositoryCases);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({
          id: "job-7",
          data: { ...baseJobData, entityIds: [1, 2, 3] },
        }) as Job
      );

      const failedEntity = result.suggestions.find((s) => s.entityId === 2);
      expect(failedEntity).toBeDefined();
      expect(failedEntity?.failed).toBe(true);
      expect(failedEntity?.tags).toEqual([]);
      expect(failedEntity?.errorMessage).toBe("LLM API timeout");
      expect(failedEntity?.entityName).toBe("API Test");
    });
  });

  describe("truncated entities", () => {
    it("should include truncated entities in suggestions with truncated flag", async () => {
      const analysisWithTruncation = {
        ...baseAnalysisResult,
        suggestions: [
          {
            entityId: 1,
            entityType: "repositoryCase" as const,
            tagName: "frontend",
            isExisting: true,
          },
        ],
        truncatedEntityIds: [2],
      };
      mockAnalyzeTags.mockResolvedValue(analysisWithTruncation);
      mockPrisma.repositoryCases.findMany.mockResolvedValue(mockRepositoryCases);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({
          id: "job-8",
          data: { ...baseJobData, entityIds: [1, 2, 3] },
        }) as Job
      );

      const truncatedEntity = result.suggestions.find((s) => s.entityId === 2);
      expect(truncatedEntity).toBeDefined();
      expect(truncatedEntity?.truncated).toBe(true);
      expect(truncatedEntity?.tags).toEqual([]);
      expect(truncatedEntity?.errorMessage).toContain(
        "LLM response was truncated"
      );
    });
  });

  describe("entity types", () => {
    it("should fetch testRun entities with testRunType field", async () => {
      const testRunJobData = {
        entityIds: [101],
        entityType: "testRun",
        projectId: 10,
        userId: "user-1",
      } as any;
      mockAnalyzeTags.mockResolvedValue({
        ...baseAnalysisResult,
        suggestions: [
          {
            entityId: 101,
            entityType: "testRun" as const,
            tagName: "smoke",
            isExisting: true,
          },
        ],
      });
      mockPrisma.testRuns.findMany.mockResolvedValue([
        {
          id: 101,
          name: "Smoke Test Run",
          testRunType: "AUTOMATED",
          tags: [{ name: "smoke" }],
        },
      ]);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ id: "job-9", data: testRunJobData }) as Job
      );

      expect(mockPrisma.testRuns.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [101] } },
          select: expect.objectContaining({ testRunType: true }),
        })
      );
      const entity = result.suggestions.find((s) => s.entityId === 101);
      expect(entity?.testRunType).toBe("AUTOMATED");
    });

    it("should fetch session entities", async () => {
      const sessionJobData = {
        entityIds: [201],
        entityType: "session",
        projectId: 10,
        userId: "user-1",
      } as any;
      mockAnalyzeTags.mockResolvedValue({
        ...baseAnalysisResult,
        suggestions: [
          {
            entityId: 201,
            entityType: "session" as const,
            tagName: "regression",
            isExisting: false,
          },
        ],
      });
      mockPrisma.sessions.findMany.mockResolvedValue([
        { id: 201, name: "Regression Session", tags: [] },
      ]);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ id: "job-10", data: sessionJobData }) as Job
      );

      expect(mockPrisma.sessions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [201] } },
        })
      );
      const entity = result.suggestions.find((s) => s.entityId === 201);
      expect(entity?.entityName).toBe("Regression Session");
    });

    it("should fetch repositoryCase entities with automated and source fields", async () => {
      mockAnalyzeTags.mockResolvedValue({
        ...baseAnalysisResult,
        suggestions: [
          {
            entityId: 1,
            entityType: "repositoryCase" as const,
            tagName: "unit",
            isExisting: false,
          },
        ],
      });
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        { id: 1, name: "Unit Test", automated: true, source: "jest", tags: [] },
      ]);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({
          id: "job-11",
          data: { ...baseJobData, entityIds: [1] },
        }) as Job
      );

      expect(mockPrisma.repositoryCases.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            automated: true,
            source: true,
          }),
        })
      );
      const entity = result.suggestions.find((s) => s.entityId === 1);
      expect(entity?.automated).toBe(true);
      expect(entity?.source).toBe("jest");
    });
  });

  describe("errors list", () => {
    it("should include errors from analysis result in job result", async () => {
      const analysisWithErrors = {
        ...baseAnalysisResult,
        errors: ["Batch 1 failed: timeout", "Batch 2 failed: rate limit"],
      };
      mockAnalyzeTags.mockResolvedValue(analysisWithErrors);
      mockPrisma.repositoryCases.findMany.mockResolvedValue(mockRepositoryCases);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ id: "job-12" }) as Job);

      expect(result.errors).toEqual([
        "Batch 1 failed: timeout",
        "Batch 2 failed: rate limit",
      ]);
    });
  });
});
