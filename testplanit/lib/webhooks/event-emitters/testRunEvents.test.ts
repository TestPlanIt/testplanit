import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitTestRunCreated,
  emitTestRunDuplicated,
  emitTestRunResultAdded,
  emitTestRunUpdateEvents,
} from "./testRunEvents";

/**
 * Plan 02-05 Task 5.2 — testRunEvents emitter contract.
 *
 * D-09 lifecycle policy:
 *   - state UNCHANGED on update -> no emission at all
 *   - state CHANGED -> emit test_run.state_changed with the from/to envelope
 *   - state CHANGED INTO an isCompleted state (workflowType==="DONE") -> ALSO emit
 *     test_run.completed with the TestRunSummaryData payload (D-15)
 *
 * The webhookEvents.emit helper and getTestRunSummary are mocked so the test
 * focuses on the detection + payload-assembly logic. The Prisma transaction
 * client `tx` is a stubbed object whose findUnique calls return canned
 * responses; we additionally assert that the SAME `tx` object is forwarded
 * through to webhookEvents.emit (Blocker 3 wiring).
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
}));

import { webhookEvents } from "~/lib/webhooks/events";
import { getTestRunSummary } from "~/lib/services/testRunSummary";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;
const summaryMock = getTestRunSummary as unknown as ReturnType<typeof vi.fn>;

interface TxStub {
  workflows: { findUnique: ReturnType<typeof vi.fn> };
  testRuns: { findUnique: ReturnType<typeof vi.fn> };
  testRunCases: { findUnique: ReturnType<typeof vi.fn> };
  status: { findUnique: ReturnType<typeof vi.fn> };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  return {
    workflows: {
      findUnique: vi.fn(async () => ({ name: "default", workflowType: "IN_PROGRESS" })),
      ...(overrides.workflows ?? {}),
    },
    testRuns: {
      findUnique: vi.fn(async () => ({ id: 1, name: "Run 1", projectId: 7 })),
      ...(overrides.testRuns ?? {}),
    },
    testRunCases: {
      findUnique: vi.fn(async () => ({ repositoryCase: { id: 11, name: "Case 11" } })),
      ...(overrides.testRunCases ?? {}),
    },
    status: {
      findUnique: vi.fn(async () => ({ id: 5, name: "Passed", isCompleted: true })),
      ...(overrides.status ?? {}),
    },
  };
}

describe("emitTestRunCreated", () => {
  beforeEach(() => {
    emitMock.mockClear();
    summaryMock.mockClear();
  });

  it("emits test_run.created with the expected payload shape and forwards tx", async () => {
    const tx = makeTx({
      workflows: {
        findUnique: vi.fn(async () => ({ name: "Open", workflowType: "NOT_STARTED" })),
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
      runName: "Run 1",
      projectId: 7,
      stateId: 100,
      stateName: "Open",
      isCompleted: false,
    });
    expect(opts.tx).toBe(tx);
    expect(opts.projectId).toBe(7);
  });
});

describe("emitTestRunUpdateEvents — D-09 lifecycle policy", () => {
  beforeEach(() => {
    emitMock.mockClear();
    summaryMock.mockClear();
  });

  it("emits NOTHING when stateId did not change (D-09 lifecycle policy)", async () => {
    const tx = makeTx();
    const row = { id: 1, projectId: 7, name: "Run 1", stateId: 100, isCompleted: false };
    await emitTestRunUpdateEvents(row, row, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("emits ONLY test_run.state_changed when stateId changed but to-state is not isCompleted", async () => {
    const tx = makeTx({
      workflows: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ name: "Open", workflowType: "NOT_STARTED" })
          .mockResolvedValueOnce({ name: "In Progress", workflowType: "IN_PROGRESS" }),
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
          .mockResolvedValueOnce({ name: "In Progress", workflowType: "IN_PROGRESS" })
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
    // D-15 — payload comes from getTestRunSummary
    expect(summaryMock).toHaveBeenCalledWith(1, { client: tx });
    expect(emitMock.mock.calls[1][1]).toMatchObject({ workflowType: "DONE" });
  });

  it("does NOT emit test_run.completed when from-state was already isCompleted (DONE→DONE2)", async () => {
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
    expect(emitMock.mock.calls[0][1]).toMatchObject({
      isCompletedTransition: false,
    });
    expect(summaryMock).not.toHaveBeenCalled();
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
        findUnique: vi.fn(async () => ({ id: 5, name: "Passed", isCompleted: true })),
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
      runName: "Run 1",
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

describe("emitTestRunDuplicated", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it("emits test_run.duplicated with sourceRunId and newRunId", async () => {
    const tx = makeTx({
      testRuns: {
        findUnique: vi.fn(async () => ({ id: 2, name: "Copy of Run 1", projectId: 7 })),
      },
    });
    await emitTestRunDuplicated(2, 1, tx as never, { projectId: 7 });
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("test_run.duplicated");
    expect(payload).toMatchObject({
      newRunId: 2,
      sourceRunId: 1,
      runName: "Copy of Run 1",
      projectId: 7,
    });
    expect(opts.tx).toBe(tx);
  });
});
