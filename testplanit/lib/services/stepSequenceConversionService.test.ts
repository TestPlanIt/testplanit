import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- Mock prismaBase module -----
// Use vi.hoisted() so that mock objects are available before vi.mock() factories run
// (vi.mock is hoisted to the top of the file by Vitest).

const {
  mockTx,
  mockPrisma,
  mockCreateTestCaseVersionInTransaction,
  mockSyncRepositoryCaseToElasticsearch,
  mockSyncSharedStepToElasticsearch,
} = vi.hoisted(() => {
  const mockCreateTestCaseVersionInTransaction = vi.fn();
  const mockSyncRepositoryCaseToElasticsearch = vi.fn().mockResolvedValue(undefined);
  const mockSyncSharedStepToElasticsearch = vi.fn().mockResolvedValue(undefined);

  const mockTx = {
    stepSequenceMatch: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    repositoryCases: {
      update: vi.fn(),
    },
    sharedStepGroup: {
      create: vi.fn(),
    },
    sharedStepItem: {
      create: vi.fn(),
    },
    steps: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  };

  const mockPrisma = {
    $transaction: vi.fn((fn: any, _opts?: any) => {
      if (typeof fn === "function") return fn(mockTx);
      return Promise.all(fn);
    }),
  };

  return {
    mockTx,
    mockPrisma,
    mockCreateTestCaseVersionInTransaction,
    mockSyncRepositoryCaseToElasticsearch,
    mockSyncSharedStepToElasticsearch,
  };
});

vi.mock("~/lib/prismaBase", () => ({
  prisma: mockPrisma,
}));

vi.mock("~/lib/services/testCaseVersionService", () => ({
  createTestCaseVersionInTransaction: mockCreateTestCaseVersionInTransaction,
}));

vi.mock("~/services/repositoryCaseSync", () => ({
  syncRepositoryCaseToElasticsearch: mockSyncRepositoryCaseToElasticsearch,
}));
vi.mock("~/services/sharedStepSearch", () => ({
  syncSharedStepToElasticsearch: mockSyncSharedStepToElasticsearch,
}));

// Mock emptyEditorContent
vi.mock("~/app/constants/backend", () => ({
  emptyEditorContent: { type: "doc", content: [{ type: "paragraph" }] },
}));

// Import after mocks are in place
import { convertMatch } from "./stepSequenceConversionService";

// ---- Test data helpers ----

const EMPTY_EDITOR = { type: "doc", content: [{ type: "paragraph" }] };

function makeStep(id: number, order: number) {
  return {
    id,
    testCaseId: 1,
    order,
    isDeleted: false,
    sharedStepGroupId: null,
    step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Step ${id}` }] }] },
    expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Expected ${id}` }] }] },
  };
}

function makeMatch(overrides: Partial<{
  id: number;
  projectId: number;
  status: string;
  isDeleted: boolean;
  fingerprint: string;
  stepCount: number;
  members: Array<{ id: number; matchId: number; caseId: number; startStepId: number; endStepId: number; isDeleted: boolean }>;
}> = {}) {
  return {
    id: 1,
    projectId: 10,
    status: "PENDING",
    isDeleted: false,
    fingerprint: "step-text-hash",
    stepCount: 2,
    members: [
      { id: 1, matchId: 1, caseId: 1, startStepId: 11, endStepId: 12, isDeleted: false },
      { id: 2, matchId: 1, caseId: 2, startStepId: 21, endStepId: 22, isDeleted: false },
    ],
    ...overrides,
  };
}

// ---- Default mock setup ----

function setupDefaultMocks() {
  const match = makeMatch();
  mockTx.stepSequenceMatch.findUnique.mockResolvedValue(match);
  mockTx.repositoryCases.update.mockResolvedValue({ id: 1, currentVersion: 2 });
  mockCreateTestCaseVersionInTransaction.mockResolvedValue({ success: true });
  mockTx.sharedStepGroup.create.mockResolvedValue({ id: 100, name: "Login Steps", projectId: 10, createdById: "user-1" });
  mockTx.sharedStepItem.create.mockResolvedValue({ id: 200 });
  mockTx.steps.updateMany.mockResolvedValue({ count: 2 });
  mockTx.steps.create.mockResolvedValue({ id: 50 });
  mockTx.stepSequenceMatch.update.mockResolvedValue({ id: 1, status: "CONVERTED" });

  // First case: steps exist for startStepId and endStepId
  // findMany is called multiple times: first to validate step IDs, then to get matched range
  mockTx.steps.findMany.mockImplementation((args: any) => {
    if (args?.where?.testCaseId === 1) {
      if (args?.where?.id?.in) {
        // Validate call: return steps for both IDs
        return Promise.resolve([makeStep(11, 1), makeStep(12, 2)]);
      }
      // Range query: return matched steps
      return Promise.resolve([makeStep(11, 1), makeStep(12, 2)]);
    }
    if (args?.where?.testCaseId === 2) {
      if (args?.where?.id?.in) {
        return Promise.resolve([makeStep(21, 1), makeStep(22, 2)]);
      }
      return Promise.resolve([makeStep(21, 1), makeStep(22, 2)]);
    }
    return Promise.resolve([]);
  });
}

function resetMocks() {
  vi.clearAllMocks();
}

describe("convertMatch", () => {
  beforeEach(() => {
    resetMocks();
    setupDefaultMocks();
  });

  it("creates SharedStepGroup with correct name, projectId, createdById", async () => {
    await convertMatch(1, "Login Steps", [1, 2], "user-1");

    expect(mockTx.sharedStepGroup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Login Steps",
        projectId: 10,
        createdById: "user-1",
      }),
    });
  });

  it("creates SharedStepItems from canonical case matched steps", async () => {
    await convertMatch(1, "Login Steps", [1, 2], "user-1");

    // SharedStepItems should be created with data from the first case's steps
    expect(mockTx.sharedStepItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sharedStepGroupId: 100,
          step: expect.objectContaining({ type: "doc" }),
          expectedResult: expect.objectContaining({ type: "doc" }),
        }),
      })
    );
  });

  it("soft-deletes matched steps with isDeleted: true — never calls deleteMany on steps", async () => {
    await convertMatch(1, "Login Steps", [1, 2], "user-1");

    // Verify updateMany called with isDeleted: true
    expect(mockTx.steps.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isDeleted: true },
      })
    );

    // Verify no deleteMany exists on steps (steps object should not have deleteMany)
    expect((mockTx.steps as any).deleteMany).toBeUndefined();
  });

  it("inserts placeholder step with sharedStepGroupId and emptyEditorContent", async () => {
    await convertMatch(1, "Login Steps", [1, 2], "user-1");

    expect(mockTx.steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sharedStepGroupId: 100,
          step: EMPTY_EDITOR,
          expectedResult: EMPTY_EDITOR,
          isDeleted: false,
        }),
      })
    );
  });

  it("re-numbers surviving steps by decrementing order", async () => {
    await convertMatch(1, "Login Steps", [1, 2], "user-1");

    // Should call updateMany with a decrement operation for surviving steps
    expect(mockTx.steps.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { order: { decrement: expect.any(Number) } },
      })
    );
  });

  it("creates version snapshots before modifying steps", async () => {
    const callOrder: string[] = [];

    mockCreateTestCaseVersionInTransaction.mockImplementation(() => {
      callOrder.push("createVersion");
      return Promise.resolve({ success: true });
    });

    mockTx.steps.updateMany.mockImplementation(() => {
      callOrder.push("updateMany");
      return Promise.resolve({ count: 2 });
    });

    await convertMatch(1, "Login Steps", [1, 2], "user-1");

    // All version snapshot calls should come before any step updateMany calls
    const firstUpdateManyIndex = callOrder.indexOf("updateMany");
    const lastCreateVersionIndex = callOrder.lastIndexOf("createVersion");

    expect(lastCreateVersionIndex).toBeGreaterThanOrEqual(0);
    expect(firstUpdateManyIndex).toBeGreaterThan(lastCreateVersionIndex);
  });

  it("skips cases where matched step IDs no longer exist", async () => {
    // Override: case 2's step IDs no longer exist
    mockTx.steps.findMany.mockImplementation((args: any) => {
      if (args?.where?.testCaseId === 1) {
        if (args?.where?.id?.in) {
          return Promise.resolve([makeStep(11, 1), makeStep(12, 2)]);
        }
        return Promise.resolve([makeStep(11, 1), makeStep(12, 2)]);
      }
      if (args?.where?.testCaseId === 2) {
        if (args?.where?.id?.in) {
          // Steps not found — stale
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const result = await convertMatch(1, "Login Steps", [1, 2], "user-1");

    expect(result.skippedCaseIds).toContain(2);
    expect(result.convertedCaseIds).not.toContain(2);
  });

  it("updates match status to CONVERTED", async () => {
    await convertMatch(1, "Login Steps", [1, 2], "user-1");

    expect(mockTx.stepSequenceMatch.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "CONVERTED" },
    });
  });

  it("returns ConversionResult with correct shape", async () => {
    const result = await convertMatch(1, "Login Steps", [1, 2], "user-1");

    expect(result).toHaveProperty("sharedStepGroupId", 100);
    expect(result).toHaveProperty("convertedCaseIds");
    expect(result).toHaveProperty("skippedCaseIds");
    expect(Array.isArray(result.convertedCaseIds)).toBe(true);
    expect(Array.isArray(result.skippedCaseIds)).toBe(true);
  });
});
