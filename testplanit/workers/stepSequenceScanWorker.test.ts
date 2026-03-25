import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockRedisGet,
  mockRedisDel,
  mockFindSharedSequences,
  mockResolveSharedSteps,
  mockUpdateProgress,
  mockFindMany,
  mockUpdateMany,
  mockMatchCreate,
  mockMatchCaseCreateMany,
} = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisDel: vi.fn(),
  mockFindSharedSequences: vi.fn(),
  mockResolveSharedSteps: vi.fn(),
  mockUpdateProgress: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockMatchCreate: vi.fn(),
  mockMatchCaseCreateMany: vi.fn(),
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

// Provide a truthy valkey connection so worker starts
vi.mock("../lib/valkey", () => ({
  default: { status: "ready" },
}));

// ─── Mock prisma ─────────────────────────────────────────────────────────────

const mockPrisma: any = {
  repositoryCases: {
    findMany: (...args: any[]) => mockFindMany(...args),
  },
  stepSequenceMatch: {
    updateMany: (...args: any[]) => mockUpdateMany(...args),
    create: (...args: any[]) => mockMatchCreate(...args),
  },
  stepSequenceMatchCase: {
    createMany: (...args: any[]) => mockMatchCaseCreateMany(...args),
  },
  $disconnect: vi.fn(),
};

vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// ─── Mock StepSequenceScanService ─────────────────────────────────────────────

vi.mock("../lib/services/stepSequenceScanService", () => ({
  StepSequenceScanService: class MockStepSequenceScanService {
    findSharedSequences = (...args: any[]) => mockFindSharedSequences(...args);
    constructor() {}
  },
}));

// ─── Mock resolveSharedSteps ──────────────────────────────────────────────────

vi.mock("../lib/utils/resolveSharedSteps", () => ({
  resolveSharedSteps: (...args: any[]) => mockResolveSharedSteps(...args),
}));

// ─── Mock queue name ─────────────────────────────────────────────────────────

vi.mock("../lib/queueNames", () => ({
  STEP_SCAN_QUEUE_NAME: "test-step-scan-queue",
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseJobData = {
  projectId: 10,
  minSteps: 3,
  userId: "user-1",
};

const mockCases = [
  {
    id: 1,
    steps: [
      { id: 101, step: "Open browser", expectedResult: "Browser opens", order: 0 },
      { id: 102, step: "Navigate to login", expectedResult: "Login page loads", order: 1 },
    ],
  },
  {
    id: 2,
    steps: [
      { id: 201, step: "Open browser", expectedResult: "Browser opens", order: 0 },
      { id: 202, step: "Navigate to login", expectedResult: "Login page loads", order: 1 },
    ],
  },
];

const mockGroup = {
  fingerprint: "Open browser\nBrowser opens\n---\nNavigate to login\nLogin page loads",
  stepCount: 2,
  members: [
    { caseId: 1, startStepId: 101, endStepId: 102 },
    { caseId: 2, startStepId: 201, endStepId: 202 },
  ],
};

async function loadWorker() {
  const mod = await import("./stepSequenceScanWorker");
  mod.startStepSequenceScanWorker();
  return mod;
}

function makeMockJob(
  overrides: Partial<{
    id: string;
    data: typeof baseJobData & { folderId?: number };
  }> = {}
): unknown {
  return {
    id: "job-1",
    data: baseJobData,
    updateProgress: mockUpdateProgress,
    ...overrides,
  };
}

describe("StepSequenceScanWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: no cancellation
    mockRedisGet.mockResolvedValue(null);
    mockRedisDel.mockResolvedValue(1);
    mockUpdateProgress.mockResolvedValue(undefined);
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockMatchCreate.mockResolvedValue({ id: 999 });
    mockMatchCaseCreateMany.mockResolvedValue({ count: 2 });
    // Default: resolveSharedSteps returns cases unchanged
    mockResolveSharedSteps.mockImplementation(async (cases: any[]) => cases);
    // Default: no groups found
    mockFindSharedSequences.mockReturnValue([]);
    // Default: return cases
    mockFindMany.mockResolvedValue(mockCases);
  });

  describe("core processing", () => {
    it("calls resolveSharedSteps before findSharedSequences", async () => {
      const callOrder: string[] = [];
      mockResolveSharedSteps.mockImplementation(async (cases: any[]) => {
        callOrder.push("resolveSharedSteps");
        return cases;
      });
      mockFindSharedSequences.mockImplementation(() => {
        callOrder.push("findSharedSequences");
        return [];
      });

      const { processStepScan } = await loadWorker();
      await processStepScan(makeMockJob() as Job, mockPrisma, mockRedisClient);

      expect(callOrder.indexOf("resolveSharedSteps")).toBeLessThan(
        callOrder.indexOf("findSharedSequences")
      );
    });

    it("persists StepSequenceMatch and MatchCase rows for each group", async () => {
      mockFindSharedSequences.mockReturnValue([mockGroup]);
      mockMatchCreate.mockResolvedValue({ id: 42 });

      const { processStepScan } = await loadWorker();
      await processStepScan(makeMockJob() as Job, mockPrisma, mockRedisClient);

      // Should create one StepSequenceMatch row for the group
      expect(mockMatchCreate).toHaveBeenCalledTimes(1);
      expect(mockMatchCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: baseJobData.projectId,
            fingerprint: mockGroup.fingerprint,
            stepCount: mockGroup.stepCount,
            isDeleted: false,
          }),
        })
      );

      // Should create MatchCase rows for each member
      expect(mockMatchCaseCreateMany).toHaveBeenCalledTimes(1);
      expect(mockMatchCaseCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ matchId: 42, caseId: 1, startStepId: 101, endStepId: 102 }),
            expect.objectContaining({ matchId: 42, caseId: 2, startStepId: 201, endStepId: 202 }),
          ]),
        })
      );
    });

    it("soft-deletes old matches before creating new ones", async () => {
      mockFindSharedSequences.mockReturnValue([mockGroup]);
      const callOrder: string[] = [];
      mockUpdateMany.mockImplementation(async () => { callOrder.push("updateMany"); return { count: 0 }; });
      mockMatchCreate.mockImplementation(async () => { callOrder.push("matchCreate"); return { id: 42 }; });

      const { processStepScan } = await loadWorker();
      await processStepScan(makeMockJob({ id: "job-2" }) as Job, mockPrisma, mockRedisClient);

      // updateMany should have been called with isDeleted: true
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: baseJobData.projectId,
            status: "PENDING",
            isDeleted: false,
          }),
          data: { isDeleted: true },
        })
      );

      // updateMany must come before create
      expect(callOrder.indexOf("updateMany")).toBeLessThan(
        callOrder.indexOf("matchCreate")
      );
    });

    it("stops early when cancel key is set", async () => {
      mockRedisGet.mockResolvedValue("1"); // Cancel key set before start

      const { processStepScan } = await loadWorker();

      await expect(
        processStepScan(makeMockJob({ id: "job-cancel" }) as Job, mockPrisma, mockRedisClient)
      ).rejects.toThrow("Job cancelled by user");

      // findSharedSequences should NOT be called
      expect(mockFindSharedSequences).not.toHaveBeenCalled();
    });

    it("reports progress with analyzed/total/matchesFound", async () => {
      mockFindSharedSequences.mockReturnValue([mockGroup]);

      const { processStepScan } = await loadWorker();
      await processStepScan(makeMockJob() as Job, mockPrisma, mockRedisClient);

      // Should report progress at least once with the expected shape
      expect(mockUpdateProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          analyzed: mockCases.length,
          total: mockCases.length,
          matchesFound: 1,
        })
      );
    });

    it("filters by folderId when provided in job data", async () => {
      const { processStepScan } = await loadWorker();
      await processStepScan(
        makeMockJob({ data: { ...baseJobData, folderId: 55 } }) as Job,
        mockPrisma,
        mockRedisClient
      );

      // findMany should include folderId in the where clause
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            folderId: 55,
          }),
        })
      );
    });
  });
});
