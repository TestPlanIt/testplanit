import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitTestRunCreated,
  emitTestRunDuplicated,
  emitTestRunResultAdded,
  emitTestRunUpdateEvents,
} from "./testRunEvents";

/**
 * testRunEvents emitter contract.
 *
 * lifecycle policy:
 * - state UNCHANGED on update -> no emission at all
 * - state CHANGED -> emit test_run.state_changed with the from/to envelope
 * - state CHANGED INTO an isCompleted state (workflowType==="DONE") -> ALSO emit
 * test_run.completed with the TestRunSummaryData payload
 *
 * The webhookEvents.emit helper and getTestRunSummary are mocked so the test
 * focuses on the detection + payload-assembly logic. The Prisma transaction
 * client `tx` is a stubbed object whose findUnique calls return canned
 * responses; we additionally assert that the SAME `tx` object is forwarded
 * through to webhookEvents.emit (wiring).
 */

vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({
      eventId: "evt_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
      outboxRowId: "row_1",
    })),
  },
}));

vi.mock("~/lib/services/testRunSummary", () => ({
  getTestRunSummary: vi.fn(async () => ({
    testRunType: "REGULAR",
    workflowType: "DONE",
    totalCases: 3,
    statusCounts: [],
    completionRate: 100,
    totalElapsed: 0,
    totalEstimate: 0,
    commentsCount: 0,
    issues: [],
  })),
  // INT-03 — default fixture: one non-parameterized case (total: 0) +
  // one parameterized case (3 iterations, mixed). Tests that need
  // different shapes override via `countsMock.mockResolvedValue(...)`.
  getPerCaseIterationCounts: vi.fn(async () => [
    {
      testRunCaseId: 50,
      iterationCount: 0,
      iterationsByStatus: { passed: 0, failed: 0, skipped: 0, notRun: 0 },
    },
    {
      testRunCaseId: 51,
      iterationCount: 3,
      iterationsByStatus: { passed: 2, failed: 1, skipped: 0, notRun: 0 },
    },
  ]),
}));

import { webhookEvents } from "~/lib/webhooks/events";
import {
  getPerCaseIterationCounts,
  getTestRunSummary,
} from "~/lib/services/testRunSummary";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;
const summaryMock = getTestRunSummary as unknown as ReturnType<typeof vi.fn>;
const countsMock = getPerCaseIterationCounts as unknown as ReturnType<
  typeof vi.fn
>;

interface TxStub {
  workflows: { findUnique: ReturnType<typeof vi.fn> };
  testRuns: { findUnique: ReturnType<typeof vi.fn> };
  testRunCases: { findUnique: ReturnType<typeof vi.fn> };
  status: { findUnique: ReturnType<typeof vi.fn> };
  testRunCaseDataSetSnapshot: { findMany: ReturnType<typeof vi.fn> };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  return {
    workflows: {
      findUnique: vi.fn(async () => ({
        name: "default",
        workflowType: "IN_PROGRESS",
      })),
      ...(overrides.workflows ?? {}),
    },
    testRuns: {
      findUnique: vi.fn(async () => ({ id: 1, name: "Run 1", projectId: 7 })),
      ...(overrides.testRuns ?? {}),
    },
    testRunCases: {
      findUnique: vi.fn(async () => ({
        repositoryCase: { id: 11, name: "Case 11" },
      })),
      ...(overrides.testRunCases ?? {}),
    },
    status: {
      findUnique: vi.fn(async () => ({
        id: 5,
        name: "Passed",
        isCompleted: true,
      })),
      ...(overrides.status ?? {}),
    },
    testRunCaseDataSetSnapshot: {
      // Default fixture: no parameterized cases (assemblePerCaseRedactedIterations
      // returns an empty array). Tests that exercise INT-03 redaction
      // override this via `makeTx({ testRunCaseDataSetSnapshot: { findMany: ... } })`.
      findMany: vi.fn(async () => []),
      ...(overrides.testRunCaseDataSetSnapshot ?? {}),
    },
  };
}

describe("emitTestRunCreated", () => {
  beforeEach(() => {
    emitMock.mockClear();
    summaryMock.mockClear();
    countsMock.mockClear();
  });

  it("emits test_run.created with the expected payload shape and forwards tx", async () => {
    const tx = makeTx({
      workflows: {
        findUnique: vi.fn(async () => ({
          name: "Open",
          workflowType: "NOT_STARTED",
        })),
      },
    });
    await emitTestRunCreated(
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: false },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("test_run.created");
    expect(payload).toMatchObject({
      runId: 1,
      runTitle: "Run 1",
      projectId: 7,
      stateId: 100,
      stateName: "Open",
      isCompleted: false,
    });
    expect(opts.tx).toBe(tx);
    expect(opts.projectId).toBe(7);
  });
});

describe("emitTestRunUpdateEvents — lifecycle policy", () => {
  beforeEach(() => {
    emitMock.mockClear();
    summaryMock.mockClear();
    countsMock.mockClear();
  });

  it("emits NOTHING when neither stateId nor isCompleted changed", async () => {
    const tx = makeTx();
    const row = {
      id: 1,
      projectId: 7,
      name: "Run 1",
      stateId: 100,
      isCompleted: false,
    };
    await emitTestRunUpdateEvents(row, row, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("emits ONLY test_run.completed when isCompleted flips false→true without a stateId change (project admin marked the run complete in place)", async () => {
    const tx = makeTx();
    await emitTestRunUpdateEvents(
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: true },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toBe("test_run.completed");
    expect(summaryMock).toHaveBeenCalledWith(1, { client: tx });
  });

  it("emits ONLY test_run.state_changed when stateId changed but isCompleted stayed true (DONE→DONE2)", async () => {
    const tx = makeTx({
      workflows: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ name: "Done", workflowType: "DONE" })
          .mockResolvedValueOnce({ name: "Closed", workflowType: "DONE" }),
      },
    });
    await emitTestRunUpdateEvents(
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: true },
      { id: 1, projectId: 7, name: "Run 1", stateId: 200, isCompleted: true },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toBe("test_run.state_changed");
    expect(summaryMock).not.toHaveBeenCalled();
  });

  it("emits ONLY test_run.state_changed when stateId changed but to-state is not isCompleted", async () => {
    const tx = makeTx({
      workflows: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ name: "Open", workflowType: "NOT_STARTED" })
          .mockResolvedValueOnce({
            name: "In Progress",
            workflowType: "IN_PROGRESS",
          }),
      },
    });
    await emitTestRunUpdateEvents(
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Run 1", stateId: 200, isCompleted: false },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("test_run.state_changed");
    expect(payload).toMatchObject({
      runId: 1,
      from: { stateId: 100, stateName: "Open", isCompleted: false },
      to: { stateId: 200, stateName: "In Progress", isCompleted: false },
      isCompletedTransition: false,
    });
  });

  it("emits BOTH test_run.state_changed AND test_run.completed when transitioning into a DONE state", async () => {
    const tx = makeTx({
      workflows: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            name: "In Progress",
            workflowType: "IN_PROGRESS",
          })
          .mockResolvedValueOnce({ name: "Done", workflowType: "DONE" }),
      },
    });
    await emitTestRunUpdateEvents(
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Run 1", stateId: 200, isCompleted: true },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(2);
    expect(emitMock.mock.calls[0][0]).toBe("test_run.state_changed");
    expect(emitMock.mock.calls[0][1]).toMatchObject({
      isCompletedTransition: true,
    });
    expect(emitMock.mock.calls[1][0]).toBe("test_run.completed");
    // payload comes from getTestRunSummary
    expect(summaryMock).toHaveBeenCalledWith(1, { client: tx });
    expect(emitMock.mock.calls[1][1]).toMatchObject({ workflowType: "DONE" });
  });
});

describe("emitTestRunResultAdded", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it("emits test_run.result_added with the enriched payload (status name, case name, run name)", async () => {
    const executedAt = new Date("2026-01-01T00:00:00Z");
    const tx = makeTx({
      testRuns: {
        findUnique: vi.fn(async () => ({ id: 1, name: "Run 1", projectId: 7 })),
      },
      status: {
        findUnique: vi.fn(async () => ({
          id: 5,
          name: "Passed",
          isCompleted: true,
        })),
      },
      testRunCases: {
        findUnique: vi.fn(async () => ({
          repositoryCase: { id: 11, name: "Case 11" },
        })),
      },
    });
    await emitTestRunResultAdded(
      {
        id: 99,
        testRunId: 1,
        testRunCaseId: 50,
        statusId: 5,
        attempt: 2,
        executedById: "user-1",
        executedAt,
      },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("test_run.result_added");
    expect(payload).toMatchObject({
      runId: 1,
      runTitle: "Run 1",
      caseId: 11,
      caseName: "Case 11",
      resultId: 99,
      statusId: 5,
      statusName: "Passed",
      isCompleted: true,
      executedById: "user-1",
      executedAt: executedAt.toISOString(),
      attempt: 2,
    });
    expect(opts.tx).toBe(tx);
    expect(opts.projectId).toBe(7);
  });

  it("returns silently when the parent testRun was deleted between insert and emit", async () => {
    const tx = makeTx({
      testRuns: { findUnique: vi.fn(async () => null) },
    });
    await emitTestRunResultAdded(
      { id: 99, testRunId: 1, testRunCaseId: 50, statusId: 5 },
      tx as never
    );
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("INT-03 — test_run.completed perCaseIterationCounts + redaction", () => {
  beforeEach(() => {
    emitMock.mockClear();
    summaryMock.mockClear();
    countsMock.mockClear();
  });

  it("test_run.completed payload includes perCaseIterationCounts read inside the same tx", async () => {
    countsMock.mockResolvedValueOnce([
      {
        testRunCaseId: 100,
        iterationCount: 0,
        iterationsByStatus: { passed: 0, failed: 0, skipped: 0, notRun: 0 },
      },
      {
        testRunCaseId: 101,
        iterationCount: 5,
        iterationsByStatus: { passed: 3, failed: 1, skipped: 1, notRun: 0 },
      },
    ]);
    const tx = makeTx({
      workflows: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            name: "In Progress",
            workflowType: "IN_PROGRESS",
          })
          .mockResolvedValueOnce({ name: "Done", workflowType: "DONE" }),
      },
    });
    await emitTestRunUpdateEvents(
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Run 1", stateId: 200, isCompleted: true },
      tx as never
    );
    expect(countsMock).toHaveBeenCalledWith(1, tx);
    const completedCall = emitMock.mock.calls.find(
      ([eventName]) => eventName === "test_run.completed"
    );
    expect(completedCall).toBeDefined();
    const payload = completedCall![1];
    expect(payload).toMatchObject({
      perCaseIterationCounts: [
        {
          testRunCaseId: 100,
          iterationCount: 0,
          iterationsByStatus: { passed: 0, failed: 0, skipped: 0, notRun: 0 },
        },
        {
          testRunCaseId: 101,
          iterationCount: 5,
          iterationsByStatus: { passed: 3, failed: 1, skipped: 1, notRun: 0 },
        },
      ],
    });
  });

  it("non-parameterized cases (no snapshot) are absent from perCaseRedactedIterations but still present in perCaseIterationCounts", async () => {
    countsMock.mockResolvedValueOnce([
      {
        testRunCaseId: 100,
        iterationCount: 0,
        iterationsByStatus: { passed: 0, failed: 0, skipped: 0, notRun: 0 },
      },
    ]);
    const tx = makeTx({
      workflows: {
        findUnique: vi.fn(async () => ({ name: "Done", workflowType: "DONE" })),
      },
      // No snapshots — assemblePerCaseRedactedIterations returns [].
      testRunCaseDataSetSnapshot: { findMany: vi.fn(async () => []) },
    });
    await emitTestRunUpdateEvents(
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: true },
      tx as never
    );
    const completedCall = emitMock.mock.calls.find(
      ([eventName]) => eventName === "test_run.completed"
    );
    expect(completedCall).toBeDefined();
    const payload = completedCall![1];
    expect(payload.perCaseRedactedIterations).toEqual([]);
    // perCaseIterationCounts still lists the case (with zero iterations).
    expect(payload.perCaseIterationCounts).toHaveLength(1);
  });

  it("sensitive parameter values are [REDACTED] in the test_run.completed perCaseRedactedIterations payload", async () => {
    countsMock.mockResolvedValueOnce([
      {
        testRunCaseId: 200,
        iterationCount: 1,
        iterationsByStatus: { passed: 1, failed: 0, skipped: 0, notRun: 0 },
      },
    ]);
    const tx = makeTx({
      workflows: {
        findUnique: vi.fn(async () => ({ name: "Done", workflowType: "DONE" })),
      },
      testRunCaseDataSetSnapshot: {
        findMany: vi.fn(async () => [
          {
            testRunCaseId: 200,
            parametersJson: [
              { name: "username", sensitive: false },
              { name: "password", sensitive: true },
            ],
            iterations: [
              {
                id: 9001,
                rowIndex: 0,
                valuesJson: { username: "alice", password: "p@ssw0rd!" },
              },
            ],
          },
        ]),
      },
    });
    await emitTestRunUpdateEvents(
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: true },
      tx as never
    );
    const completedCall = emitMock.mock.calls.find(
      ([eventName]) => eventName === "test_run.completed"
    );
    expect(completedCall).toBeDefined();
    const payload = completedCall![1];
    expect(payload.perCaseRedactedIterations).toEqual([
      {
        testRunCaseId: 200,
        iterations: [
          {
            iterationId: 9001,
            rowIndex: 0,
            redactedValues: {
              username: "alice",
              password: "[REDACTED]",
            },
          },
        ],
      },
    ]);
  });

  it("valuesJson value larger than 4 KB is truncated with the marker string in the webhook payload", async () => {
    countsMock.mockResolvedValueOnce([
      {
        testRunCaseId: 300,
        iterationCount: 1,
        iterationsByStatus: { passed: 1, failed: 0, skipped: 0, notRun: 0 },
      },
    ]);
    const bigValue = "x".repeat(5 * 1024); // 5 KB → over the 4 KB cap.
    const tx = makeTx({
      workflows: {
        findUnique: vi.fn(async () => ({ name: "Done", workflowType: "DONE" })),
      },
      testRunCaseDataSetSnapshot: {
        findMany: vi.fn(async () => [
          {
            testRunCaseId: 300,
            parametersJson: [{ name: "payload", sensitive: false }],
            iterations: [
              {
                id: 9100,
                rowIndex: 0,
                valuesJson: { payload: bigValue },
              },
            ],
          },
        ]),
      },
    });
    await emitTestRunUpdateEvents(
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: true },
      tx as never
    );
    const completedCall = emitMock.mock.calls.find(
      ([eventName]) => eventName === "test_run.completed"
    );
    expect(completedCall).toBeDefined();
    const payload = completedCall![1];
    const iter =
      payload.perCaseRedactedIterations[0].iterations[0].redactedValues;
    expect(iter.payload).toMatch(/^<value truncated: \d+ bytes>$/);
    expect(iter.payload).toContain(`${5 * 1024}`);
  });
});

describe("emitTestRunDuplicated", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it("emits test_run.duplicated with sourceRunId and newRunId", async () => {
    const tx = makeTx({
      testRuns: {
        findUnique: vi.fn(async () => ({
          id: 2,
          name: "Copy of Run 1",
          projectId: 7,
        })),
      },
    });
    await emitTestRunDuplicated(2, 1, tx as never, { projectId: 7 });
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("test_run.duplicated");
    expect(payload).toMatchObject({
      newRunId: 2,
      sourceRunId: 1,
      runTitle: "Copy of Run 1",
      projectId: 7,
    });
    expect(opts.tx).toBe(tx);
  });
});
