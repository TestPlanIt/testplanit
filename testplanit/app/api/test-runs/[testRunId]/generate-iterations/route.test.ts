import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  userCanAddEditArea: vi.fn(),
  runFindFirst: vi.fn(),
  runCasesFindMany: vi.fn(),
  materializeIterations: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: unknown) => handler,
}));
vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock("~/lib/services/projectPermissions", () => ({
  userCanAddEditArea: mocks.userCanAddEditArea,
}));
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    testRuns: { findFirst: mocks.runFindFirst },
    testRunCases: { findMany: mocks.runCasesFindMany },
  })),
}));
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock("~/lib/services/iterationFanOut", () => ({
  materializeIterations: mocks.materializeIterations,
}));
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(async () => undefined),
}));
vi.mock("~/lib/queues", () => ({ getIterationGenerationQueue: vi.fn() }));
vi.mock("@/lib/multiTenantDb", () => ({ getCurrentTenantId: vi.fn() }));

import { POST } from "./route";

const call = () =>
  (POST as any)(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ testRunId: "42" }),
  });

describe("POST /api/test-runs/[testRunId]/generate-iterations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "token-user", access: "USER" },
    });
    mocks.userCanAddEditArea.mockResolvedValue(true);
    mocks.runFindFirst.mockResolvedValue({
      id: 42,
      projectId: 7,
      configId: null,
    });
    mocks.runCasesFindMany.mockResolvedValue([
      {
        repositoryCaseId: 1,
        repositoryCase: {
          id: 1,
          name: "Login",
          hasParameters: true,
          ownedDataSets: [{ _count: { rows: 3 } }],
        },
      },
    ]);
    mocks.materializeIterations.mockResolvedValue({
      iterationCount: 3,
      parameterizedRunCaseCount: 1,
      perRunCase: [],
    });
  });

  it("accepts an API token and generates the iterations", async () => {
    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ async: false, iterationCount: 3 });
    expect(mocks.materializeIterations).toHaveBeenCalledWith(42, {});
  });

  it("counts only the run cases that have no iterations yet", async () => {
    await call();
    expect(mocks.runCasesFindMany.mock.calls[0][0].where).toEqual({
      testRunId: 42,
      isDeleted: false,
      dataSetSnapshot: { is: null },
    });
  });

  it("requires add/edit on test runs", async () => {
    mocks.userCanAddEditArea.mockResolvedValue(false);
    const res = await call();

    expect(res.status).toBe(403);
    expect(mocks.userCanAddEditArea).toHaveBeenCalledWith(
      "token-user",
      7,
      "TestRuns",
      "USER"
    );
    expect(mocks.materializeIterations).not.toHaveBeenCalled();
  });

  it("passes an authentication failure through", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: false,
      error: "Token is read-only",
      errorCode: "READ_ONLY_TOKEN",
      status: 403,
    });
    const res = await call();

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("READ_ONLY_TOKEN");
  });
});
