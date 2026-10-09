import { beforeEach, describe, expect, it, vi } from "vitest";

const { queueAdd, getAlertQueue } = vi.hoisted(() => {
  const queueAdd = vi.fn((..._args: any[]) => Promise.resolve({ id: "j" }));
  return {
    queueAdd,
    getAlertQueue: vi.fn(() => ({ add: queueAdd }) as any),
  };
});

vi.mock("~/lib/queues", () => ({
  getAlertQueue: () => getAlertQueue(),
}));

import {
  JOB_EVALUATE_ALERT_JUNIT_RESULT,
  JOB_EVALUATE_ALERT_RESULT,
  JOB_EVALUATE_ALERT_RUN,
} from "~/lib/queueNames";
import {
  enqueueAlertJUnitResultEvaluation,
  enqueueAlertResultEvaluation,
  enqueueAlertRunEvaluation,
  projectHasActiveAlertRules,
  ALERT_EVALUATION_DELAY_MS,
  alertRunDedupId,
} from "./alertEnqueue";

describe("alertEnqueue enqueue helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAlertQueue.mockImplementation(() => ({ add: queueAdd }) as any);
  });

  it("queues a delayed result evaluation", async () => {
    await enqueueAlertResultEvaluation({
      resultId: 5,
      projectId: 2,
      tenantId: "t1",
    });
    expect(queueAdd).toHaveBeenCalledWith(
      JOB_EVALUATE_ALERT_RESULT,
      { resultId: 5, projectId: 2, tenantId: "t1" },
      { delay: ALERT_EVALUATION_DELAY_MS, removeOnComplete: true }
    );
  });

  it("queues a delayed automated-result evaluation", async () => {
    await enqueueAlertJUnitResultEvaluation({
      junitResultId: 9,
      projectId: 2,
    });
    expect(queueAdd).toHaveBeenCalledWith(
      JOB_EVALUATE_ALERT_JUNIT_RESULT,
      { junitResultId: 9, projectId: 2 },
      expect.objectContaining({ delay: ALERT_EVALUATION_DELAY_MS })
    );
  });

  it("deduplicates run evaluations per run, trigger and tenant", async () => {
    await enqueueAlertRunEvaluation({
      runId: 42,
      projectId: 2,
      trigger: "result",
    });
    const [name, data, opts] = queueAdd.mock.calls[0];
    expect(name).toBe(JOB_EVALUATE_ALERT_RUN);
    expect(data).toEqual({ runId: 42, projectId: 2, trigger: "result" });
    expect(opts.deduplication).toEqual({
      id: alertRunDedupId(42, "result", undefined),
      ttl: ALERT_EVALUATION_DELAY_MS,
    });
    expect(alertRunDedupId(42, "completion", "acme")).toBe(
      "alert-run:acme:42:completion"
    );
  });

  it("never throws into the caller when the queue is missing or failing", async () => {
    getAlertQueue.mockImplementation(() => null);
    await expect(
      enqueueAlertResultEvaluation({ resultId: 1, projectId: 1 })
    ).resolves.toBeUndefined();

    getAlertQueue.mockImplementation(
      () =>
        ({ add: vi.fn(() => Promise.reject(new Error("valkey down"))) }) as any
    );
    await expect(
      enqueueAlertRunEvaluation({
        runId: 1,
        projectId: 1,
        trigger: "result",
      })
    ).resolves.toBeUndefined();
  });

  it("gates on an enabled, live rule for the project and fails closed", async () => {
    const count = vi.fn(async () => 1);
    expect(await projectHasActiveAlertRules({ alertRule: { count } }, 7)).toBe(
      true
    );
    expect(count).toHaveBeenCalledWith({
      where: { projectId: 7, isEnabled: true, isDeleted: false },
    });
    expect(
      await projectHasActiveAlertRules(
        { alertRule: { count: vi.fn(async () => 0) } },
        7
      )
    ).toBe(false);
    expect(
      await projectHasActiveAlertRules(
        {
          alertRule: {
            count: vi.fn(async () => Promise.reject(new Error("x"))),
          },
        },
        7
      )
    ).toBe(false);
  });
});
