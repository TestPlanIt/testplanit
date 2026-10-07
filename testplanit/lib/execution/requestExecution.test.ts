import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockQueueAdd,
  mockGetQueue,
  mockAuditedTransaction,
  mockCaptureAuditEvent,
  mockDispatchExecution,
  mockBuildAutomationPlan,
  mockResolveConfigurationParams,
  mockCheckDispatchRateLimit,
  mockFindActiveExecution,
  mockEmitExecutionEvent,
  mockPromoteRunToHybrid,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
  mockGetQueue: vi.fn(),
  mockAuditedTransaction: vi.fn(),
  mockCaptureAuditEvent: vi.fn(),
  mockDispatchExecution: vi.fn(),
  mockBuildAutomationPlan: vi.fn(),
  mockResolveConfigurationParams: vi.fn(),
  mockCheckDispatchRateLimit: vi.fn(),
  mockFindActiveExecution: vi.fn(),
  mockEmitExecutionEvent: vi.fn(),
  mockPromoteRunToHybrid: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ baseDb: {} }));
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: (...args: unknown[]) => mockAuditedTransaction(...args),
}));
vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: () => undefined,
}));
vi.mock("~/lib/queues", () => ({
  getExecutionDispatchQueue: () => mockGetQueue(),
}));
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: unknown[]) => mockCaptureAuditEvent(...args),
}));
vi.mock("~/lib/services/hybridRunProjection", () => ({
  promoteRunToHybrid: (...args: unknown[]) => mockPromoteRunToHybrid(...args),
}));
vi.mock("./configurationParams", () => ({
  resolveConfigurationParams: (...args: unknown[]) =>
    mockResolveConfigurationParams(...args),
}));
vi.mock("./dispatch", () => ({
  dispatchExecution: (...args: unknown[]) => mockDispatchExecution(...args),
}));
vi.mock("./plan", () => ({
  buildAutomationPlan: (...args: unknown[]) => mockBuildAutomationPlan(...args),
}));
vi.mock("./rateLimit", () => ({
  checkDispatchRateLimit: (...args: unknown[]) =>
    mockCheckDispatchRateLimit(...args),
}));
vi.mock("./service", () => ({
  EXECUTION_REQUESTED_EVENT: "execution.requested",
  emitExecutionEvent: (...args: unknown[]) => mockEmitExecutionEvent(...args),
  findActiveExecution: (...args: unknown[]) => mockFindActiveExecution(...args),
  publishExecutionChanged: vi.fn(),
}));

import { requestExecution } from "./requestExecution";

/**
 * The worker path: `env` carries the job's tenant client, so the request
 * must never touch `baseDb` or the request-scoped audit helpers, and the
 * dispatch job must be enqueued even though no request audit frame exists.
 */
function makeEnvDb() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    testRuns: {
      findFirst: vi.fn().mockResolvedValue({
        id: 300,
        isCompleted: false,
        testRunType: "REGULAR",
        docs: null,
      }),
      update: vi.fn(),
    },
    testRunExecution: {
      create: vi.fn().mockResolvedValue({
        id: 55,
        status: "PENDING",
        selectionCount: 2,
        projectId: 3,
        testRunId: 300,
      }),
    },
  };
  const db = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx)
    ),
    executionTarget: {
      findFirst: vi.fn().mockResolvedValue({
        id: 4,
        provider: "GITHUB_ACTIONS",
        isEnabled: true,
        defaultRef: "main",
        paramSchema: [],
      }),
    },
  };
  return { db, tx };
}

const guc = {
  userId: "owner-1",
  userName: null,
  userEmail: null,
  requestId: null,
  source: "worker",
  tenantId: "t-1",
  operationId: null,
  entityName: null,
  projectId: null,
};

describe("requestExecution with a worker env", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveConfigurationParams.mockResolvedValue({ ok: true, inputs: {} });
    mockCheckDispatchRateLimit.mockResolvedValue({ allowed: true });
    mockFindActiveExecution.mockResolvedValue(null);
    mockBuildAutomationPlan.mockResolvedValue({
      totals: { cases: 2 },
      cases: [{ id: 1 }, { id: 2 }],
    });
  });

  it("enqueues the dispatch as the system actor without a request audit frame", async () => {
    mockGetQueue.mockReturnValue({ add: mockQueueAdd });
    mockQueueAdd.mockResolvedValue({ id: "job-1" });
    const { db, tx } = makeEnvDb();

    const result = await requestExecution({
      runId: 300,
      projectId: 3,
      requestedById: "owner-1",
      targetId: 4,
      env: {
        db: db as never,
        tenantId: "t-1",
        guc,
        systemReason: "webhook:auto-execute",
      },
    });

    expect(result).toEqual({
      ok: true,
      execution: { id: 55, status: "PENDING", selectionCount: 2 },
      queued: true,
    });
    expect(mockAuditedTransaction).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // The audit GUC is the transaction's first statement, from the env's actor.
    expect(tx.$executeRaw.mock.calls[0].flat().join(" ")).toContain(
      "app.audit_context"
    );
    expect(tx.$executeRaw.mock.calls[0][1]).toContain('"userId":"owner-1"');
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "dispatch-execution",
      expect.objectContaining({
        executionId: 55,
        tenantId: "t-1",
        actorContext: {
          userId: "__system__",
          systemReason: "webhook:auto-execute",
        },
        systemReason: "webhook:auto-execute",
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^dispatch-t-1-55-/),
      })
    );
    expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EXECUTION_REQUESTED",
        entityId: "55",
        tenantId: "t-1",
      })
    );
  });

  it("dispatches inline on the env's client when there is no queue", async () => {
    mockGetQueue.mockReturnValue(null);
    mockDispatchExecution.mockResolvedValue({ status: "DISPATCHED" });
    const { db } = makeEnvDb();

    const result = await requestExecution({
      runId: 300,
      projectId: 3,
      requestedById: "owner-1",
      targetId: 4,
      env: {
        db: db as never,
        tenantId: "t-1",
        guc,
        systemReason: "webhook:auto-execute",
      },
    });

    expect(result).toMatchObject({ ok: true, queued: false });
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockDispatchExecution).toHaveBeenCalledWith(db, 55, {
      tenantId: "t-1",
    });
  });
});
