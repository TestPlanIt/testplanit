import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evaluateResult,
  evaluateJUnitResult,
  evaluateRun,
  evaluateScheduled,
  evaluateExecution,
  evaluateSession,
} = vi.hoisted(() => ({
  evaluateResult: vi.fn(async () => []),
  evaluateJUnitResult: vi.fn(async () => []),
  evaluateRun: vi.fn(async () => []),
  evaluateScheduled: vi.fn(async () => []),
  evaluateExecution: vi.fn(async () => []),
  evaluateSession: vi.fn(async () => []),
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
    evaluateExecution = evaluateExecution;
    evaluateSession = evaluateSession;
  },
}));

import {
  JOB_EVALUATE_SCHEDULED_ALERTS,
  JOB_EVALUATE_HOURLY_ALERTS,
  JOB_EVALUATE_ALERT_EXECUTION,
  JOB_EVALUATE_ALERT_JUNIT_RESULT,
  JOB_EVALUATE_ALERT_RESULT,
  JOB_EVALUATE_ALERT_RUN,
  JOB_EVALUATE_ALERT_SESSION,
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
    expect(evaluateScheduled).toHaveBeenCalledWith("t", "daily");

    await processor(job(JOB_EVALUATE_HOURLY_ALERTS, { tenantId: "t" }));
    expect(evaluateScheduled).toHaveBeenCalledWith("t", "hourly");

    await processor(
      job(JOB_EVALUATE_ALERT_EXECUTION, {
        executionId: 9,
        projectId: 7,
        tenantId: "t",
      })
    );
    expect(evaluateExecution).toHaveBeenCalledWith(9, "t");

    await processor(
      job(JOB_EVALUATE_ALERT_SESSION, { sessionId: 5, projectId: 7 })
    );
    expect(evaluateSession).toHaveBeenCalledWith(5, undefined);
  });

  it("rejects an unknown job name", async () => {
    await expect(processor(job("nope", {}))).rejects.toThrow(
      "Unknown job type: nope"
    );
  });
});
