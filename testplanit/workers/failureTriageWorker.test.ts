import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTriageRun,
  mockTriageProject,
  mockClassify,
  mockEnqueueClassify,
  mockCreateForWorker,
} = vi.hoisted(() => ({
  mockTriageRun: vi.fn(),
  mockTriageProject: vi.fn(),
  mockClassify: vi.fn(),
  mockEnqueueClassify: vi.fn(),
  mockCreateForWorker: vi.fn(() => ({ llm: true })),
}));

vi.mock("bullmq", async (importOriginal) => {
  const original = await importOriginal<typeof import("bullmq")>();
  return {
    ...original,
    Worker: class MockWorker {
      on = vi.fn();
      close = vi.fn();
    },
  };
});
vi.mock("../lib/valkey", () => ({ default: { status: "ready" } }));

const mockDb = {
  projects: { findUnique: vi.fn() },
  testRuns: { findUnique: vi.fn() },
  failureSignature: { findMany: vi.fn() },
};

vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: vi.fn(() => mockDb),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));
vi.mock("../lib/llm/services/llm-manager.service", () => ({
  LlmManager: { createForWorker: mockCreateForWorker },
}));
vi.mock("../lib/services/triage/signatures", () => ({
  triageRunFailures: mockTriageRun,
  triageProjectFailures: mockTriageProject,
}));
vi.mock("../lib/services/triage/classify", () => ({
  classifySignatures: mockClassify,
}));
vi.mock("../lib/services/triage/enqueue", () => ({
  enqueueSignatureClassification: mockEnqueueClassify,
}));

import { processor } from "./failureTriageWorker";

const job = (name: string, data: Record<string, unknown>) =>
  ({ id: "j1", name, data, updateProgress: vi.fn() }) as unknown as Job;

describe("failureTriageWorker processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.projects.findUnique.mockResolvedValue({
      failureTriageEnabled: true,
      failureTriageAutoClassify: true,
      isDeleted: false,
    });
    mockDb.testRuns.findUnique.mockResolvedValue({ createdById: "user-1" });
    mockTriageRun.mockResolvedValue({
      processed: 3,
      signatureIds: [1, 2],
      newSignatureIds: [2],
      reopenedSignatureIds: [],
    });
    mockClassify.mockResolvedValue({
      classified: 1,
      failed: 0,
      skipped: false,
    });
  });

  it("does nothing for a project with triage turned off", async () => {
    mockDb.projects.findUnique.mockResolvedValue({
      failureTriageEnabled: false,
      failureTriageAutoClassify: true,
      isDeleted: false,
    });
    await processor(job("triage-run", { testRunId: 5, projectId: 7 }));
    expect(mockTriageRun).not.toHaveBeenCalled();
  });

  it("groups a run's failures and classifies the still-unclassified signatures", async () => {
    mockDb.failureSignature.findMany.mockResolvedValue([{ id: 2 }]);
    await processor(job("triage-run", { testRunId: 5, projectId: 7 }));
    expect(mockTriageRun).toHaveBeenCalledWith(mockDb, {
      testRunId: 5,
      projectId: 7,
    });
    expect(mockDb.failureSignature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [1, 2] },
          aiClassifiedAt: null,
          classifiedById: null,
        }),
      })
    );
    expect(mockClassify).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        projectId: 7,
        signatureIds: [2],
        userId: "user-1",
      })
    );
  });

  it("skips classification when the project only clusters", async () => {
    mockDb.projects.findUnique.mockResolvedValue({
      failureTriageEnabled: true,
      failureTriageAutoClassify: false,
      isDeleted: false,
    });
    await processor(job("triage-run", { testRunId: 5, projectId: 7 }));
    expect(mockTriageRun).toHaveBeenCalled();
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it("backfills a project and fans classification out in batches", async () => {
    mockTriageProject.mockResolvedValue({
      processed: 900,
      signatureIds: [1],
      newSignatureIds: [1],
      reopenedSignatureIds: [],
    });
    mockDb.failureSignature.findMany.mockResolvedValue(
      Array.from({ length: 23 }, (_, i) => ({ id: i + 1 }))
    );
    await processor(job("triage-backfill", { projectId: 7, userId: "admin" }));
    expect(mockTriageProject).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ projectId: 7 })
    );
    expect(mockEnqueueClassify).toHaveBeenCalledTimes(3);
    expect(mockEnqueueClassify.mock.calls[2][0].signatureIds).toEqual([
      21, 22, 23,
    ]);
  });

  it("classifies an explicit signature list", async () => {
    await processor(
      job("classify-signatures", {
        projectId: 7,
        userId: "admin",
        signatureIds: [4, 5],
      })
    );
    expect(mockClassify).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ signatureIds: [4, 5], userId: "admin" })
    );
  });
});
