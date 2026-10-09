/**
 * Threshold-trigger enqueue wiring (#651).
 *
 * The plugin is the only seam that sees a result land, so two properties
 * are checked here rather than in the enqueue helpers' own tests:
 *
 *   - a project without an enabled rule costs one count and no enqueue;
 *   - a bulk of N results for one run queues N result jobs and ONE run job.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queueAdd } = vi.hoisted(() => ({
  queueAdd: vi.fn((..._args: any[]) => Promise.resolve({ id: "bull-job-1" })),
}));

vi.mock("~/lib/queues", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/queues")>()),
  getAlertQueue: () => ({ add: queueAdd }) as any,
  getNotificationQueue: () =>
    ({ add: vi.fn(async () => ({ id: "n" })) }) as any,
}));

vi.mock("~/services/sessionSearch", () => ({
  syncSessionToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/services/testRunSearch", () => ({
  syncTestRunToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/webhooks/event-emitters/sessionEvents", () => ({
  emitSessionUpdateEvents: vi.fn(async () => undefined),
  emitSessionCreated: vi.fn(async () => undefined),
  emitSessionDuplicated: vi.fn(async () => undefined),
  emitSessionResultAdded: vi.fn(async () => undefined),
}));
vi.mock("~/lib/webhooks/event-emitters/testRunEvents", () => ({
  emitTestRunCreated: vi.fn(() => Promise.resolve()),
  emitTestRunDuplicated: vi.fn(() => Promise.resolve()),
  emitTestRunResultAdded: vi.fn(() => Promise.resolve()),
  emitJUnitResultAdded: vi.fn(() => Promise.resolve()),
  emitTestRunUpdateEvents: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/services/hybridRunProjection", () => ({
  projectJUnitResultOntoRunCase: vi.fn(() => Promise.resolve()),
  promoteRunToHybrid: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/services/reviewCancellation", () => ({
  cancelReviewsForDeletedEntities: vi.fn(() => Promise.resolve([])),
  announceDeletionCancelledReviews: vi.fn(() => Promise.resolve()),
}));

import { sideEffectsPlugin } from "./sideEffectsPlugin";
import {
  JOB_EVALUATE_ALERT_JUNIT_RESULT,
  JOB_EVALUATE_ALERT_RESULT,
  JOB_EVALUATE_ALERT_RUN,
  JOB_EVALUATE_ALERT_SESSION,
} from "~/lib/queueNames";

const afterEntityMutation = (sideEffectsPlugin as any).onEntityMutation
  .afterEntityMutation;

function jobsByName(name: string) {
  return queueAdd.mock.calls.filter((c) => c[0] === name);
}

/** Lets the hook's detached `void enqueue…()` promises settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function txWith(ruleCount: number) {
  return {
    alertRule: { count: vi.fn(async () => ruleCount) },
    testRuns: {
      findMany: vi.fn(async ({ where }: any) =>
        where.id.in.map((id: number) => ({ id, projectId: 7 }))
      ),
    },
    jUnitTestSuite: {
      findMany: vi.fn(async ({ where }: any) =>
        where.id.in.map((id: number) => ({
          id,
          testRun: { id: 42, projectId: 7 },
        }))
      ),
    },
    workflows: { findUnique: vi.fn(async () => null) },
    projects: { findUnique: vi.fn(async () => ({})) },
  };
}

describe("sideEffectsPlugin — threshold enqueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queues one result job per manual result and one run job per run", async () => {
    const tx = txWith(1);
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: 100 + i,
      testRunId: 42,
      testRunCaseId: i,
    }));
    await afterEntityMutation({
      model: "TestRunResults",
      action: "create",
      client: tx,
      loadAfterMutationEntities: async () => rows,
      beforeMutationEntities: undefined,
    });
    await flush();

    expect(tx.alertRule.count).toHaveBeenCalledTimes(1);
    expect(jobsByName(JOB_EVALUATE_ALERT_RESULT)).toHaveLength(5);
    expect(jobsByName(JOB_EVALUATE_ALERT_RESULT)[0][1]).toEqual({
      resultId: 100,
      projectId: 7,
      tenantId: undefined,
    });
    const runJobs = jobsByName(JOB_EVALUATE_ALERT_RUN);
    expect(runJobs).toHaveLength(1);
    expect(runJobs[0][1]).toEqual({
      runId: 42,
      projectId: 7,
      trigger: "result",
      tenantId: undefined,
    });
    expect(runJobs[0][2].deduplication.id).toBe("alert-run:default:42:result");
  });

  it("queues nothing for a project without an enabled rule", async () => {
    const tx = txWith(0);
    await afterEntityMutation({
      model: "TestRunResults",
      action: "create",
      client: tx,
      loadAfterMutationEntities: async () => [{ id: 1, testRunId: 42 }],
      beforeMutationEntities: undefined,
    });
    await flush();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("queues automated results through their suite's run", async () => {
    const tx = txWith(1);
    await afterEntityMutation({
      model: "JUnitTestResult",
      action: "create",
      client: tx,
      loadAfterMutationEntities: async () => [
        { id: 900, testSuiteId: 3, repositoryCaseId: 9, statusId: 1 },
        { id: 901, testSuiteId: 3, repositoryCaseId: 10, statusId: 1 },
      ],
      beforeMutationEntities: undefined,
    });
    await flush();
    expect(
      jobsByName(JOB_EVALUATE_ALERT_JUNIT_RESULT).map((c) => c[1])
    ).toEqual([
      { junitResultId: 900, projectId: 7, tenantId: undefined },
      { junitResultId: 901, projectId: 7, tenantId: undefined },
    ]);
    expect(jobsByName(JOB_EVALUATE_ALERT_RUN)).toHaveLength(1);
  });

  it("queues a completion evaluation when a run first completes, and only then", async () => {
    const tx = txWith(1);
    const base = {
      id: 42,
      projectId: 7,
      stateId: 1,
      compositionLockedAt: null,
      isDeleted: false,
    };
    await afterEntityMutation({
      model: "TestRuns",
      action: "update",
      client: tx,
      loadAfterMutationEntities: async () => [{ ...base, isCompleted: true }],
      beforeMutationEntities: [{ ...base, isCompleted: false }],
    });
    await flush();
    const runJobs = jobsByName(JOB_EVALUATE_ALERT_RUN);
    expect(runJobs).toHaveLength(1);
    expect(runJobs[0][1]).toEqual({
      runId: 42,
      projectId: 7,
      trigger: "completion",
      tenantId: undefined,
    });

    vi.clearAllMocks();
    await afterEntityMutation({
      model: "TestRuns",
      action: "update",
      client: tx,
      loadAfterMutationEntities: async () => [
        { ...base, isCompleted: true, name: "x" },
      ],
      beforeMutationEntities: [{ ...base, isCompleted: true }],
    });
    await flush();
    expect(jobsByName(JOB_EVALUATE_ALERT_RUN)).toHaveLength(0);
  });

  it("queues a session evaluation when a session first completes", async () => {
    const tx = txWith(1);
    const base = { id: 15, projectId: 7, stateId: 1, isDeleted: false };
    await afterEntityMutation({
      model: "Sessions",
      action: "update",
      client: tx,
      loadAfterMutationEntities: async () => [{ ...base, isCompleted: true }],
      beforeMutationEntities: [{ ...base, isCompleted: false }],
    });
    await flush();
    const jobs = jobsByName(JOB_EVALUATE_ALERT_SESSION);
    expect(jobs).toHaveLength(1);
    expect(jobs[0][1]).toEqual({
      sessionId: 15,
      projectId: 7,
      tenantId: undefined,
    });
  });
});
