import { DelayedError, type Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runTrackerActions,
  runDraftCases,
  runUpdateCases,
  reportUpdateCasesFailure,
  getDbClientForJob,
  validateMultiTenantJobData,
  IssueSyncBusyError,
} = vi.hoisted(() => ({
  runUpdateCases: vi.fn(),
  reportUpdateCasesFailure: vi.fn(),
  IssueSyncBusyError: class IssueSyncBusyError extends Error {},
  runTrackerActions: vi.fn(),
  runDraftCases: vi.fn(),
  getDbClientForJob: vi.fn(() => ({ tag: "db" })),
  validateMultiTenantJobData: vi.fn(),
}));

vi.mock("../lib/valkey", () => ({ default: null }));
vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob,
  isMultiTenantMode: () => false,
  validateMultiTenantJobData,
  disconnectAllTenantClients: vi.fn(),
}));
vi.mock("../lib/tenantContext", () => ({
  withTenantContext: (fn: unknown) => fn,
}));
vi.mock("../lib/webhooks/actions/runTrackerActions", () => ({
  IssueSyncBusyError,
  runTrackerActions,
}));
vi.mock("../lib/webhooks/actions/draftCases", () => ({ runDraftCases }));
vi.mock("../lib/webhooks/actions/updateCases", () => ({
  runUpdateCases,
  reportUpdateCasesFailure,
}));

import {
  JOB_DRAFT_CASES,
  JOB_RUN_TRACKER_ACTIONS,
  JOB_UPDATE_CASES,
} from "../lib/queueNames";
import {
  BUSY_DELAY_MIN_MS,
  BUSY_DELAY_SPREAD_MS,
  BUSY_RESCHEDULE_LIMIT,
  processor,
} from "./webhookActionsWorker";

const data = {
  deliveryId: "del-1",
  webhookConfigId: "whc-1",
  projectId: 7,
  adapterType: "JIRA",
  externalKey: "DEMO-42",
  tenantId: "t",
};
const job = (jobData: object = data) =>
  ({
    id: "j1",
    name: JOB_RUN_TRACKER_ACTIONS,
    data: jobData,
    updateData: vi.fn(),
    moveToDelayed: vi.fn(),
  }) as unknown as Job;

describe("webhookActionsWorker processor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the delivery's tracker rules on the job's tenant database", async () => {
    const result = { outcome: "done", issueId: 100, runIds: [5] };
    runTrackerActions.mockResolvedValue(result);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(processor(job())).resolves.toBe(result);

    expect(validateMultiTenantJobData).toHaveBeenCalledWith(data);
    expect(getDbClientForJob).toHaveBeenCalledWith(data);
    expect(runTrackerActions).toHaveBeenCalledWith({ tag: "db" }, data);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("1 run(s)"));
    log.mockRestore();
  });

  it("returns a skipped outcome without logging runs", async () => {
    runTrackerActions.mockResolvedValue({ outcome: "not_imported" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(processor(job())).resolves.toEqual({
      outcome: "not_imported",
    });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("drafts cases for a draft-cases job on the job's tenant database", async () => {
    const data = {
      deliveryId: "del-1",
      webhookConfigId: "whc-1",
      webhookActionId: "draft-1",
      projectId: 7,
      issueId: 100,
      tenantId: "t",
    };
    const drafted = { outcome: "cases_drafted", caseCount: 2, folderId: 5 };
    runDraftCases.mockResolvedValue(drafted);
    await expect(
      processor({ id: "j2", name: JOB_DRAFT_CASES, data } as unknown as Job)
    ).resolves.toBe(drafted);
    expect(validateMultiTenantJobData).toHaveBeenCalledWith(data);
    expect(runDraftCases).toHaveBeenCalledWith({ tag: "db" }, data);
    expect(runTrackerActions).not.toHaveBeenCalled();
  });

  it("updates cases for an update-cases job on the job's tenant database", async () => {
    const data = {
      deliveryId: "del-1",
      webhookConfigId: "whc-1",
      webhookActionId: "update-1",
      projectId: 7,
      issueId: 100,
      tenantId: "t",
    };
    for (const updated of [
      {
        outcome: "cases_updated",
        checked: 3,
        rewritten: 1,
        added: 0,
        deleted: 0,
        suggested: 2,
      },
      { outcome: "no_cases" },
    ]) {
      runUpdateCases.mockResolvedValue(updated);
      await expect(
        processor({ id: "j3", name: JOB_UPDATE_CASES, data } as unknown as Job)
      ).resolves.toBe(updated);
    }
    expect(validateMultiTenantJobData).toHaveBeenCalledWith(data);
    expect(runUpdateCases).toHaveBeenCalledWith({ tag: "db" }, data);
    expect(runTrackerActions).not.toHaveBeenCalled();
    expect(runDraftCases).not.toHaveBeenCalled();
  });

  it("lets an update-cases failure throw so BullMQ retries, reporting only the last attempt", async () => {
    runUpdateCases.mockRejectedValue(new Error("database is down"));
    reportUpdateCasesFailure.mockResolvedValue(undefined);
    const data = { webhookActionId: "update-1" };
    const attempt = (attemptsMade: number, attempts?: number) =>
      processor({
        id: "j4",
        name: JOB_UPDATE_CASES,
        data,
        attemptsMade,
        opts: attempts === undefined ? {} : { attempts },
      } as unknown as Job);

    await expect(attempt(0, 3)).rejects.toThrow("database is down");
    await expect(attempt(1, 3)).rejects.toThrow("database is down");
    expect(reportUpdateCasesFailure).not.toHaveBeenCalled();

    await expect(attempt(2, 3)).rejects.toThrow("database is down");
    expect(reportUpdateCasesFailure).toHaveBeenCalledTimes(1);
    expect(reportUpdateCasesFailure).toHaveBeenCalledWith(
      { tag: "db" },
      data,
      "database is down"
    );

    // A job with no retries configured reports its only attempt.
    await expect(attempt(0)).rejects.toThrow("database is down");
    expect(reportUpdateCasesFailure).toHaveBeenCalledTimes(2);
  });

  it("still throws the job's own error when reporting it fails, or the error is not an Error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runUpdateCases.mockRejectedValue("boom");
    reportUpdateCasesFailure.mockRejectedValue(new Error("queue is down"));
    await expect(
      processor({
        id: "j5",
        name: JOB_UPDATE_CASES,
        data: {},
        attemptsMade: 0,
        opts: { attempts: 1 },
      } as unknown as Job)
    ).rejects.toBe("boom");
    expect(reportUpdateCasesFailure.mock.calls.at(-1)![2]).toBe("failed");
  });

  it("lets a failure throw so BullMQ retries", async () => {
    runTrackerActions.mockRejectedValue(new Error("Jira is down"));
    const j = job();
    await expect(processor(j, "tok")).rejects.toThrow("Jira is down");
    expect(j.moveToDelayed).not.toHaveBeenCalled();
  });

  it("reschedules a busy issue a random 2–10s out without spending a retry", async () => {
    runTrackerActions.mockRejectedValue(new IssueSyncBusyError("busy"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const j = job();

    await expect(processor(j, "tok")).rejects.toBeInstanceOf(DelayedError);

    expect(j.updateData).toHaveBeenCalledWith({ ...data, busyCount: 1 });
    expect(j.moveToDelayed).toHaveBeenCalledWith(
      1_000_000 + BUSY_DELAY_MIN_MS + 0.5 * BUSY_DELAY_SPREAD_MS,
      "tok"
    );
    vi.restoreAllMocks();
  });

  it("counts on from an earlier reschedule", async () => {
    runTrackerActions.mockRejectedValue(new IssueSyncBusyError("busy"));
    const j = job({ ...data, busyCount: 3 });
    await expect(processor(j, "tok")).rejects.toBeInstanceOf(DelayedError);
    expect(j.updateData).toHaveBeenCalledWith({ ...data, busyCount: 4 });
  });

  it("spends retries once a busy issue has been rescheduled to the limit", async () => {
    const busy = new IssueSyncBusyError("busy");
    runTrackerActions.mockRejectedValue(busy);
    const j = job({ ...data, busyCount: BUSY_RESCHEDULE_LIMIT });
    await expect(processor(j, "tok")).rejects.toBe(busy);
    expect(j.moveToDelayed).not.toHaveBeenCalled();
  });

  it("falls back to an ordinary retry without a lock token", async () => {
    const busy = new IssueSyncBusyError("busy");
    runTrackerActions.mockRejectedValue(busy);
    const j = job();
    await expect(processor(j)).rejects.toBe(busy);
    expect(j.moveToDelayed).not.toHaveBeenCalled();
  });

  it("rejects job data the tenant check refuses", async () => {
    validateMultiTenantJobData.mockImplementationOnce(() => {
      throw new Error("tenantId required");
    });
    await expect(processor(job())).rejects.toThrow("tenantId required");
    expect(runTrackerActions).not.toHaveBeenCalled();
  });
});
