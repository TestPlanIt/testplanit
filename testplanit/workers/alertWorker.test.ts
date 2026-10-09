import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateResult, evaluateJUnitResult, evaluateRun, evaluateScheduled } =
  vi.hoisted(() => ({
    evaluateResult: vi.fn(async () => []),
    evaluateJUnitResult: vi.fn(async () => []),
    evaluateRun: vi.fn(async () => []),
    evaluateScheduled: vi.fn(async () => []),
  }));

vi.mock("../lib/valkey", () => ({ default: null }));
vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: vi.fn(() => ({ tag: "db" })),
  isMultiTenantMode: () => false,
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));
vi.mock("../lib/tenantContext", () => ({
  withTenantContext: (fn: unknown) => fn,
}));
vi.mock("../lib/services/alertEvaluation", () => ({
  AlertEvaluationService: class {
    evaluateResult = evaluateResult;
    evaluateJUnitResult = evaluateJUnitResult;
    evaluateRun = evaluateRun;
    evaluateScheduled = evaluateScheduled;
  },
}));

import {
  JOB_EVALUATE_SCHEDULED_ALERTS,
  JOB_EVALUATE_ALERT_JUNIT_RESULT,
  JOB_EVALUATE_ALERT_RESULT,
  JOB_EVALUATE_ALERT_RUN,
} from "../lib/queueNames";
import { processor } from "./alertWorker";

const job = (name: string, data: Record<string, unknown>) =>
  ({ id: "j1", name, data }) as unknown as Job;

describe("alertWorker processor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes each job name to the matching evaluation with the tenant", async () => {
    await processor(
      job(JOB_EVALUATE_ALERT_RESULT, {
        resultId: 5,
        projectId: 1,
        tenantId: "t",
      })
    );
    expect(evaluateResult).toHaveBeenCalledWith(5, "t");

    await processor(
      job(JOB_EVALUATE_ALERT_JUNIT_RESULT, {
        junitResultId: 9,
        projectId: 1,
      })
    );
    expect(evaluateJUnitResult).toHaveBeenCalledWith(9, undefined);

    await processor(
      job(JOB_EVALUATE_ALERT_RUN, {
        runId: 42,
        projectId: 1,
        trigger: "completion",
      })
    );
    expect(evaluateRun).toHaveBeenCalledWith(42, "completion", undefined);

    await processor(job(JOB_EVALUATE_SCHEDULED_ALERTS, { tenantId: "t" }));
    expect(evaluateScheduled).toHaveBeenCalledWith("t");
  });

  it("rejects an unknown job name", async () => {
    await expect(processor(job("nope", {}))).rejects.toThrow(
      "Unknown job type: nope"
    );
  });
});
