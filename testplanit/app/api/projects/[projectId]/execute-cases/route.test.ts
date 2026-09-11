import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The tx client handed to the mocked auditedTransaction shares these mocks with
// baseDb so assertions do not depend on which client performed the write.
const { aggregateMock, upsertMock, createRunMock } = vi.hoisted(() => ({
  aggregateMock: vi.fn(),
  upsertMock: vi.fn(),
  createRunMock: vi.fn(),
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (h: any) => h,
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: vi.fn(),
  hasBearerToken: vi.fn(() => false),
}));

vi.mock("~/lib/api-rate-limit", () => ({
  checkApiRateLimit: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    repositoryCases: { findMany: vi.fn() },
    testRuns: { findFirst: vi.fn(), create: createRunMock },
    testRunCases: { aggregate: aggregateMock, upsert: upsertMock },
    workflows: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: vi.fn((fn: (tx: any) => any) =>
    fn({
      testRunCases: { aggregate: aggregateMock, upsert: upsertMock },
      testRuns: { create: createRunMock },
    })
  ),
}));

vi.mock("~/lib/execution/requestExecution", () => ({
  requestExecution: vi.fn(),
}));

vi.mock("~/lib/services/projectPermissions", () => ({
  userCanAddEditArea: vi.fn(),
}));

import { authenticateRequest, hasBearerToken } from "~/lib/api-token-auth";
import { checkApiRateLimit } from "~/lib/api-rate-limit";
import { baseDb } from "~/lib/db";
import { requestExecution } from "~/lib/execution/requestExecution";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { getServerAuthSession } from "~/server/auth";
import { POST } from "./route";

const mockedSession = vi.mocked(getServerAuthSession);
const mockedAuth = vi.mocked(authenticateRequest);
const mockedHasBearer = vi.mocked(hasBearerToken);
const mockedRateLimit = vi.mocked(checkApiRateLimit);
const mockedCanEdit = vi.mocked(userCanAddEditArea);
const mockedRequestExecution = vi.mocked(requestExecution);
const mockedFindCases = vi.mocked(baseDb.repositoryCases.findMany) as any;
const mockedFindRun = vi.mocked(baseDb.testRuns.findFirst) as any;
const mockedFindState = vi.mocked(baseDb.workflows.findFirst) as any;

const PROJECT_ID = 7;
const USER_ID = "user-1";

function makeReq(body: unknown) {
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/execute-cases`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

const params = Promise.resolve({ projectId: String(PROJECT_ID) });

/** The project's automated cases, the happy-path default. */
const AUTOMATED_CASES = [
  { id: 10, name: "login smoke", automated: true },
  { id: 11, name: "checkout smoke", automated: true },
  { id: 12, name: "search smoke", automated: true },
];

/** Default lookup: every requested id that exists in the project comes back. */
function findCasesInProject(args: any) {
  const ids: number[] = args.where.id.in;
  return Promise.resolve(AUTOMATED_CASES.filter((c) => ids.includes(c.id)));
}

async function post(body: unknown, overrideParams = params) {
  const res = await POST(makeReq(body), { params: overrideParams } as any);
  return { res, json: await res.json() };
}

describe("POST /api/projects/[projectId]/execute-cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({ user: { id: USER_ID } } as any);
    mockedAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: USER_ID, access: "USER" },
    } as any);
    mockedHasBearer.mockReturnValue(false);
    mockedRateLimit.mockResolvedValue({ allowed: true } as any);
    mockedCanEdit.mockResolvedValue(true);
    mockedFindCases.mockImplementation(findCasesInProject);
    mockedRequestExecution.mockResolvedValue({
      ok: true,
      execution: { id: 900, status: "QUEUED", selectionCount: 2 },
      queued: true,
    } as any);
    aggregateMock.mockResolvedValue({ _max: { order: 2 } });
    upsertMock.mockResolvedValue({ id: 1 });
    createRunMock.mockResolvedValue({ id: 55 });
    mockedFindState.mockResolvedValue({ id: 3 });
  });

  it("401 when neither a session nor a valid token authenticates the request", async () => {
    mockedAuth.mockResolvedValue({
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    } as any);

    const { res, json } = await post({ caseIds: [10], targetId: 1 });

    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
    expect(mockedFindCases).not.toHaveBeenCalled();
    expect(mockedRequestExecution).not.toHaveBeenCalled();
  });

  it("400 on a non-numeric project id before touching auth", async () => {
    const { res } = await post(
      { caseIds: [10], targetId: 1 },
      Promise.resolve({ projectId: "abc" })
    );

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("400 on an invalid body (empty caseIds)", async () => {
    const { res, json } = await post({ caseIds: [], targetId: 1 });

    expect(res.status).toBe(400);
    expect(json.error).toBe("Invalid input");
    expect(mockedCanEdit).not.toHaveBeenCalled();
  });

  it("403 when the caller cannot add/edit test runs in the project", async () => {
    mockedCanEdit.mockResolvedValue(false);

    const { res, json } = await post({ caseIds: [10], targetId: 1 });

    expect(res.status).toBe(403);
    expect(json.error).toBe("Forbidden");
    expect(mockedCanEdit).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      expect.anything(),
      "USER"
    );
    expect(mockedFindCases).not.toHaveBeenCalled();
    expect(mockedRequestExecution).not.toHaveBeenCalled();
  });

  it("429 when a bearer-token caller is over the API rate limit", async () => {
    mockedHasBearer.mockReturnValue(true);
    mockedRateLimit.mockResolvedValue({ allowed: false } as any);

    const { res } = await post({ caseIds: [10], targetId: 1 });

    expect(res.status).toBe(429);
    expect(mockedRequestExecution).not.toHaveBeenCalled();
  });

  it("404 CASES_NOT_FOUND when a requested case belongs to another project", async () => {
    // The case lookup is scoped to the project, so a foreign case simply
    // does not come back and the counts disagree.
    mockedFindCases.mockResolvedValue([AUTOMATED_CASES[0]]);

    const { res, json } = await post({ caseIds: [10, 99], targetId: 1 });

    expect(res.status).toBe(404);
    expect(json.code).toBe("CASES_NOT_FOUND");
    expect(mockedFindCases).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [10, 99] },
          projectId: PROJECT_ID,
          isDeleted: false,
        }),
      })
    );
    expect(mockedRequestExecution).not.toHaveBeenCalled();
  });

  it("400 CASES_NOT_AUTOMATED and names the manual cases", async () => {
    mockedFindCases.mockResolvedValue([
      AUTOMATED_CASES[0],
      { id: 11, name: "manual regression", automated: false },
    ]);

    const { res, json } = await post({ caseIds: [10, 11], targetId: 1 });

    expect(res.status).toBe(400);
    expect(json.code).toBe("CASES_NOT_AUTOMATED");
    expect(json.caseIds).toEqual([11]);
    expect(mockedRequestExecution).not.toHaveBeenCalled();
  });

  describe("existing run", () => {
    it("409 RUN_LOCKED when composition is locked and a case is not already in the run", async () => {
      mockedFindRun.mockResolvedValue({
        id: 42,
        isCompleted: false,
        compositionLockedAt: new Date("2026-09-01T00:00:00Z"),
        testCases: [{ repositoryCaseId: 11 }],
      });

      const { res, json } = await post({
        caseIds: [10, 11],
        targetId: 1,
        runId: 42,
      });

      expect(res.status).toBe(409);
      expect(json.code).toBe("RUN_LOCKED");
      expect(json.caseIds).toEqual([10]);
      expect(upsertMock).not.toHaveBeenCalled();
      expect(mockedRequestExecution).not.toHaveBeenCalled();
    });

    it("409 RUN_COMPLETED when the run is already closed", async () => {
      mockedFindRun.mockResolvedValue({
        id: 42,
        isCompleted: true,
        compositionLockedAt: null,
        testCases: [],
      });

      const { res, json } = await post({
        caseIds: [10],
        targetId: 1,
        runId: 42,
      });

      expect(res.status).toBe(409);
      expect(json.code).toBe("RUN_COMPLETED");
      expect(mockedRequestExecution).not.toHaveBeenCalled();
    });

    it("404 when the run is not in this project", async () => {
      mockedFindRun.mockResolvedValue(null);

      const { res } = await post({ caseIds: [10], targetId: 1, runId: 42 });

      expect(res.status).toBe(404);
      expect(mockedRequestExecution).not.toHaveBeenCalled();
    });

    it("adds only the missing cases to an unlocked run, appending after the last order", async () => {
      mockedFindRun.mockResolvedValue({
        id: 42,
        isCompleted: false,
        compositionLockedAt: null,
        testCases: [{ repositoryCaseId: 11 }],
      });
      aggregateMock.mockResolvedValue({ _max: { order: 2 } });

      const { res, json } = await post({
        caseIds: [10, 11, 12],
        targetId: 1,
        runId: 42,
      });

      expect(res.status).toBe(202);
      expect(json).toMatchObject({ runId: 42, createdRun: false });
      expect(aggregateMock).toHaveBeenCalledWith({
        _max: { order: true },
        where: { testRunId: 42 },
      });
      expect(upsertMock).toHaveBeenCalledTimes(2);
      expect(upsertMock).toHaveBeenNthCalledWith(1, {
        where: {
          testRunId_repositoryCaseId: { testRunId: 42, repositoryCaseId: 10 },
        },
        update: { isDeleted: false },
        create: { testRunId: 42, repositoryCaseId: 10, order: 3 },
      });
      expect(upsertMock).toHaveBeenNthCalledWith(2, {
        where: {
          testRunId_repositoryCaseId: { testRunId: 42, repositoryCaseId: 12 },
        },
        update: { isDeleted: false },
        create: { testRunId: 42, repositoryCaseId: 12, order: 4 },
      });
      expect(createRunMock).not.toHaveBeenCalled();
    });

    it("starts ordering at 0 when the run holds no cases yet", async () => {
      mockedFindRun.mockResolvedValue({
        id: 42,
        isCompleted: false,
        compositionLockedAt: null,
        testCases: [],
      });
      aggregateMock.mockResolvedValue({ _max: { order: null } });

      const { res } = await post({ caseIds: [10], targetId: 1, runId: 42 });

      expect(res.status).toBe(202);
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { testRunId: 42, repositoryCaseId: 10, order: 0 },
        })
      );
    });

    it("does not touch composition when every case is already in the run", async () => {
      mockedFindRun.mockResolvedValue({
        id: 42,
        isCompleted: false,
        compositionLockedAt: new Date("2026-09-01T00:00:00Z"),
        testCases: [{ repositoryCaseId: 10 }, { repositoryCaseId: 11 }],
      });

      const { res } = await post({
        caseIds: [10, 11],
        targetId: 1,
        runId: 42,
      });

      expect(res.status).toBe(202);
      expect(aggregateMock).not.toHaveBeenCalled();
      expect(upsertMock).not.toHaveBeenCalled();
    });
  });

  describe("new run", () => {
    it("409 NO_RUN_STATE when the project has no enabled run workflow state", async () => {
      mockedFindState.mockResolvedValue(null);

      const { res, json } = await post({ caseIds: [10], targetId: 1 });

      expect(res.status).toBe(409);
      expect(json.code).toBe("NO_RUN_STATE");
      expect(createRunMock).not.toHaveBeenCalled();
      expect(mockedRequestExecution).not.toHaveBeenCalled();
    });

    it("looks the run state up by flags, not by name", async () => {
      await post({ caseIds: [10], targetId: 1 });

      expect(mockedFindState).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isEnabled: true,
            isDeleted: false,
            scope: "RUNS",
            projects: { some: { projectId: PROJECT_ID } },
          }),
        })
      );
    });

    it("creates a run holding the cases and dispatches an ad-hoc execution (202)", async () => {
      const { res, json } = await post({
        caseIds: [10, 11],
        targetId: 4,
        ref: "main",
        inputs: { suite: "smoke" },
      });

      expect(res.status).toBe(202);
      expect(createRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: PROJECT_ID,
            stateId: 3,
            createdById: USER_ID,
            testRunType: "REGULAR",
            testCases: {
              create: [
                { repositoryCaseId: 10, order: 0 },
                { repositoryCaseId: 11, order: 1 },
              ],
            },
          }),
        })
      );
      expect(mockedRequestExecution).toHaveBeenCalledWith({
        runId: 55,
        projectId: PROJECT_ID,
        requestedById: USER_ID,
        targetId: 4,
        ref: "main",
        caseIds: [10, 11],
        inputs: { suite: "smoke" },
        adHoc: true,
      });
      expect(json).toEqual({
        runId: 55,
        createdRun: true,
        executionId: 900,
        status: "QUEUED",
        selectionCount: 2,
      });
    });

    it("derives the run name from the first case and the extra count", async () => {
      await post({ caseIds: [10, 11], targetId: 1 });

      expect(createRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Automated: login smoke (+1)",
          }),
        })
      );
    });

    it("honors an explicit runName", async () => {
      await post({ caseIds: [10], targetId: 1, runName: "Nightly rerun" });

      expect(createRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Nightly rerun" }),
        })
      );
    });

    it("passes the dispatch failure through with the run it created", async () => {
      mockedRequestExecution.mockResolvedValue({
        ok: false,
        status: 409,
        code: "EXECUTION_IN_PROGRESS",
        error: "An execution is already running",
      } as any);

      const { res, json } = await post({ caseIds: [10, 11], targetId: 1 });

      expect(res.status).toBe(409);
      expect(json).toEqual({
        error: "An execution is already running",
        code: "EXECUTION_IN_PROGRESS",
        runId: 55,
        createdRun: true,
      });
    });
  });

  it("de-duplicates repeated case ids before the lookup and the dispatch", async () => {
    const { res } = await post({ caseIds: [10, 10, 11], targetId: 1 });

    expect(res.status).toBe(202);
    expect(mockedFindCases).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [10, 11] } }),
      })
    );
    expect(mockedRequestExecution).toHaveBeenCalledWith(
      expect.objectContaining({ caseIds: [10, 11] })
    );
  });
});
