import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockRedisGet,
  mockRedisDel,
  mockFindSimilarCases,
  mockUpdateProgress,
  mockFindMany,
  mockUpdateMany,
  mockCreateMany,
  mockFindManyDuplicateScanResult,
} = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisDel: vi.fn(),
  mockFindSimilarCases: vi.fn(),
  mockUpdateProgress: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockCreateMany: vi.fn(),
  mockFindManyDuplicateScanResult: vi.fn(),
}));

const mockRedisClient = {
  get: (...args: any[]) => mockRedisGet(...args),
  del: (...args: any[]) => mockRedisDel(...args),
};

// ─── Mock bullmq Worker to provide a mock Redis client ───────────────────────

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

// Provide a truthy valkey connection so startDuplicateScanWorker() creates the Worker instance
vi.mock("../lib/valkey", () => ({
  default: { status: "ready" },
}));

// ─── Mock prisma ─────────────────────────────────────────────────────────────

const mockPrisma: any = {
  repositoryCases: {
    findMany: (...args: any[]) => mockFindMany(...args),
  },
  duplicateScanResult: {
    findMany: (...args: any[]) => mockFindManyDuplicateScanResult(...args),
    updateMany: (...args: any[]) => mockUpdateMany(...args),
    createMany: (...args: any[]) => mockCreateMany(...args),
  },
  $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
  $disconnect: vi.fn(),
};

vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// ─── Mock DuplicateScanService ────────────────────────────────────────────────

vi.mock("../lib/services/duplicateScanService", () => ({
  DuplicateScanService: class MockDuplicateScanService {
    findSimilarCases = (...args: any[]) => mockFindSimilarCases(...args);
    constructor() {}
  },
}));

// ─── Mock elasticsearchService ───────────────────────────────────────────────

vi.mock("../services/elasticsearchService", () => ({
  getElasticsearchClient: vi.fn(() => null),
}));

// ─── Mock queue name ─────────────────────────────────────────────────────────

vi.mock("../lib/queueNames", () => ({
  DUPLICATE_SCAN_QUEUE_NAME: "test-duplicate-scan-queue",
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseJobData = {
  projectId: 42,
  userId: "user-1",
};

const mockCases = [
  { id: 1, name: "Login Test", steps: [], tags: [] },
  { id: 2, name: "Signup Test", steps: [], tags: [] },
  { id: 3, name: "Logout Test", steps: [], tags: [] },
];

function makePair(caseAId: number, caseBId: number, score = 0.8) {
  return {
    caseAId,
    caseBId,
    score,
    confidence: "HIGH" as const,
    matchedFields: ["name"],
  };
}

// Helper to load a fresh module and call startDuplicateScanWorker to initialise
// the module-level `worker` variable so `worker!.client` works in the processor.
async function loadWorker() {
  const mod = await import("./duplicateScanWorker");
  mod.startDuplicateScanWorker();
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
    name: "run-duplicate-scan",
    data: baseJobData,
    updateProgress: mockUpdateProgress,
    ...overrides,
  };
}

describe("DuplicateScanWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: no cancellation keys
    mockRedisGet.mockResolvedValue(null);
    mockRedisDel.mockResolvedValue(1);
    mockUpdateProgress.mockResolvedValue(undefined);
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockCreateMany.mockResolvedValue({ count: 0 });
    // Default: no dismissed pairs
    mockFindManyDuplicateScanResult.mockResolvedValue([]);
    // Default: no similar cases
    mockFindSimilarCases.mockResolvedValue([]);
  });

  describe("basic scan processing", () => {
    it("Test 1: Processor fetches non-deleted cases for projectId, calls findSimilarCases for each, returns pairsFound count", async () => {
      mockFindMany.mockResolvedValue(mockCases);
      mockFindSimilarCases.mockResolvedValue([]);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ id: "job-1" }) as Job);

      // Should have fetched cases for the correct project
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 42,
            isDeleted: false,
          }),
        })
      );

      // findSimilarCases called once per case
      expect(mockFindSimilarCases).toHaveBeenCalledTimes(3);

      // Returns the correct structure
      expect(result).toMatchObject({
        pairsFound: 0,
        casesScanned: 3,
        scanJobId: "job-1",
      });
    });

    it("Test 2: Duplicate pairs (same caseAId:caseBId key) are deduplicated — only first occurrence kept", async () => {
      mockFindMany.mockResolvedValue([{ id: 1, name: "Case A", steps: [], tags: [] }, { id: 2, name: "Case B", steps: [], tags: [] }]);

      // Case 1 finds pair (1,2), Case 2 also finds pair (1,2) — should deduplicate
      mockFindSimilarCases
        .mockResolvedValueOnce([makePair(1, 2, 0.9)]) // call for case 1
        .mockResolvedValueOnce([makePair(1, 2, 0.8)]); // call for case 2 — duplicate

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ id: "job-2" }) as Job);

      // Only 1 unique pair despite 2 calls each returning the same pair
      expect(result.pairsFound).toBe(1);
    });

    it("Test 3: All unique pairs are stored (no artificial cap)", async () => {
      // 60 cases, each returning 5 pairs = 300 unique pairs
      const manyPairs = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `Case ${i + 1}`, steps: [], tags: [] }));
      mockFindMany.mockResolvedValue(manyPairs);

      // Each case returns 5 pairs with distinct caseBIds
      mockFindSimilarCases.mockImplementation(async ({ id }: { id: number }) => {
        return Array.from({ length: 5 }, (_, j) => ({
          caseAId: id,
          caseBId: id * 100 + j + 1000,
          score: 0.5 + (j * 0.05), // varying scores
          confidence: "MEDIUM" as const,
          matchedFields: ["name"],
        }));
      });

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ id: "job-3" }) as Job);

      // All 300 unique pairs should be stored
      expect(result.pairsFound).toBe(300);
    });

    it("Test 4: old PENDING results soft-deleted before createMany inserts new results", async () => {
      mockFindMany.mockResolvedValue(mockCases);
      mockFindSimilarCases.mockResolvedValue([makePair(1, 2)]);

      const callOrder: string[] = [];
      mockUpdateMany.mockImplementation(async () => { callOrder.push("updateMany"); return { count: 0 }; });
      mockCreateMany.mockImplementation(async () => { callOrder.push("createMany"); return { count: 1 }; });

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-4" }) as Job);

      // updateMany should soft-delete PENDING results for the correct project
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { projectId: 42, status: "PENDING", isDeleted: false },
        data: { isDeleted: true },
      });

      // soft-delete must come before createMany
      expect(callOrder.indexOf("updateMany")).toBeLessThan(callOrder.indexOf("createMany"));
    });

    it("Test 5: job.updateProgress called once per batch plus AI phase", async () => {
      mockFindMany.mockResolvedValue(mockCases);
      mockFindSimilarCases.mockResolvedValue([]);

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-5" }) as Job);

      // 3 cases with BATCH_SIZE=20 → 1 batch progress + 1 AI phase progress = 2 calls
      expect(mockUpdateProgress).toHaveBeenCalledTimes(2);
      expect(mockUpdateProgress).toHaveBeenNthCalledWith(1, { analyzed: 3, total: 3 });
      expect(mockUpdateProgress).toHaveBeenNthCalledWith(2, { analyzed: 3, total: 3, phase: "ai" });
    });
  });

  describe("cancellation", () => {
    it("Test 6: Pre-start cancellation check — if Redis key exists, throws 'Job cancelled by user'", async () => {
      mockRedisGet.mockResolvedValue("1"); // Cancel key exists before start

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-6" }) as Job)
      ).rejects.toThrow("Job cancelled by user");

      // findSimilarCases should NOT have been called
      expect(mockFindSimilarCases).not.toHaveBeenCalled();
    });

    it("Test 7: Mid-loop cancellation check — if Redis key set between batches, throws 'Job cancelled by user'", async () => {
      // Need enough cases to span 2 batches (BATCH_SIZE=20)
      const manyCases = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1, name: `Case ${i + 1}`, steps: [], tags: [],
      }));
      mockFindMany.mockResolvedValue(manyCases);

      // Not cancelled pre-start, not cancelled for first batch, cancelled for second batch
      mockRedisGet
        .mockResolvedValueOnce(null)     // Pre-start: not cancelled
        .mockResolvedValueOnce(null)     // First batch check: not cancelled
        .mockResolvedValueOnce("1");     // Second batch check: cancelled!

      mockFindSimilarCases.mockResolvedValue([]);

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-7" }) as Job)
      ).rejects.toThrow("Job cancelled by user");

      // First batch of 20 should have been processed, second batch cancelled before processing
      expect(mockFindSimilarCases).toHaveBeenCalledTimes(20);
    });
  });

  describe("result persistence", () => {
    it("Test 8: createMany uses skipDuplicates: true as safety net against @@unique constraint", async () => {
      mockFindMany.mockResolvedValue([{ id: 1, name: "Case A", steps: [], tags: [] }, { id: 2, name: "Case B", steps: [], tags: [] }]);
      mockFindSimilarCases.mockResolvedValue([makePair(1, 2, 0.9)]);

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-8" }) as Job);

      // createMany should be called with skipDuplicates: true
      expect(mockCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDuplicates: true,
        })
      );
    });
  });
});
