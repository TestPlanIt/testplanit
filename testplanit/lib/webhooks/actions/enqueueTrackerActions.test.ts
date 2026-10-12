import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWebhookActionsQueue: vi.fn(),
  getDbClientForJob: vi.fn(),
  runTrackerActions: vi.fn(),
  add: vi.fn(),
}));

vi.mock("~/lib/queues", () => ({
  getWebhookActionsQueue: mocks.getWebhookActionsQueue,
}));
vi.mock("~/lib/multiTenantDb", () => ({
  getDbClientForJob: mocks.getDbClientForJob,
}));
vi.mock("./runTrackerActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runTrackerActions")>();
  return { ...actual, runTrackerActions: mocks.runTrackerActions };
});

import { JOB_RUN_TRACKER_ACTIONS } from "~/lib/queueNames";
import { enqueueTrackerActions } from "./enqueueTrackerActions";
import {
  IssueSyncBusyError,
  type TrackerActionsJob,
} from "./runTrackerActions";

const job: TrackerActionsJob = {
  deliveryId: "del-1",
  webhookConfigId: "whc-1",
  projectId: 7,
  adapterType: "JIRA",
  externalKey: "DEMO-42",
  tenantId: "tenant-a",
};

describe("enqueueTrackerActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.add.mockResolvedValue({ id: "job" });
    mocks.getDbClientForJob.mockReturnValue({ tag: "db" });
    mocks.runTrackerActions.mockResolvedValue({ outcome: "done" });
  });

  it("queues the job once per delivery with retries", async () => {
    mocks.getWebhookActionsQueue.mockReturnValue({ add: mocks.add });

    await enqueueTrackerActions(job);

    expect(mocks.add).toHaveBeenCalledWith(JOB_RUN_TRACKER_ACTIONS, job, {
      jobId: "tracker-actions-del-1",
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
    });
    expect(mocks.runTrackerActions).not.toHaveBeenCalled();
  });

  it("lets a queue failure reach the caller", async () => {
    mocks.getWebhookActionsQueue.mockReturnValue({ add: mocks.add });
    mocks.add.mockRejectedValue(new Error("valkey down"));
    await expect(enqueueTrackerActions(job)).rejects.toThrow("valkey down");
  });

  it("runs the rules inline on the job's database without a queue", async () => {
    mocks.getWebhookActionsQueue.mockReturnValue(null);

    await enqueueTrackerActions(job);

    expect(mocks.getDbClientForJob).toHaveBeenCalledWith(job);
    expect(mocks.runTrackerActions).toHaveBeenCalledWith({ tag: "db" }, job);
  });

  it("swallows a busy issue inline, since there's no queue to retry on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getWebhookActionsQueue.mockReturnValue(null);
    mocks.runTrackerActions.mockRejectedValue(
      new IssueSyncBusyError("DEMO-42")
    );

    await expect(enqueueTrackerActions(job)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DEMO-42"));
    warn.mockRestore();
  });

  it("rethrows any other inline failure", async () => {
    mocks.getWebhookActionsQueue.mockReturnValue(null);
    mocks.runTrackerActions.mockRejectedValue(new Error("boom"));
    await expect(enqueueTrackerActions(job)).rejects.toThrow("boom");
  });
});
