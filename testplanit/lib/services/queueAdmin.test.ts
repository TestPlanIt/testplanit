import { beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_SCAN_REPO_ISSUES, REPO_CACHE_QUEUE_NAME } from "~/lib/queueNames";

vi.mock("~/lib/queues", () => ({ getAllQueues: vi.fn(() => ({})) }));

import {
  ActiveJobError,
  cancelJob,
  NotCancellableError,
  removeJob,
} from "./queueAdmin";

function job(state: string, extra: Record<string, unknown> = {}) {
  return {
    id: "scan-issues-9",
    name: JOB_SCAN_REPO_ISSUES,
    data: { configId: 9 },
    getState: vi.fn().mockResolvedValue(state),
    remove: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

function queue() {
  const client = { set: vi.fn().mockResolvedValue("OK") };
  return {
    client: Promise.resolve(client),
    _client: client,
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
  };
}

describe("removeJob", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("removes a job nobody is processing", async () => {
    const j = job("waiting");
    await removeJob(queue() as any, REPO_CACHE_QUEUE_NAME, j as any);
    expect(j.remove).toHaveBeenCalled();
  });

  it("refuses an active job and says whether Cancel is an option", async () => {
    const j = job("active");
    await expect(
      removeJob(queue() as any, REPO_CACHE_QUEUE_NAME, j as any)
    ).rejects.toMatchObject({ name: "ActiveJobError", cancellable: true });
    expect(j.remove).not.toHaveBeenCalled();

    const plain = job("active", { name: "send-email" });
    await expect(
      removeJob(queue() as any, "emails", plain as any)
    ).rejects.toMatchObject({ name: "ActiveJobError", cancellable: false });
  });

  it("never reports a forced removal the lock refused", async () => {
    const j = job("active");
    j.remove.mockRejectedValue(new Error("Job scan-issues-9 is locked"));
    await expect(
      removeJob(queue() as any, REPO_CACHE_QUEUE_NAME, j as any, true)
    ).rejects.toBeInstanceOf(ActiveJobError);
    expect(j.remove).toHaveBeenCalledTimes(3);
  });

  it("forces the removal through once the lock has gone", async () => {
    const j = job("active");
    j.remove
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValueOnce(undefined);
    await removeJob(queue() as any, REPO_CACHE_QUEUE_NAME, j as any, true);
    expect(j.remove).toHaveBeenCalledTimes(2);
  });

  it("removes a repeatable job's schedule first and says so when the instance stays locked", async () => {
    const q = queue();
    q.getRepeatableJobs.mockResolvedValue([{ key: "sweep" }]);
    const j = job("active", { id: "repeat:sweep:1700000000" });
    j.remove.mockRejectedValue(new Error("locked"));
    await expect(
      removeJob(q as any, REPO_CACHE_QUEUE_NAME, j as any, true)
    ).rejects.toMatchObject({ scheduleRemoved: true });
    expect(q.removeRepeatableByKey).toHaveBeenCalledWith("sweep");
  });

  it("rethrows a failure that is not the lock", async () => {
    const j = job("waiting");
    j.remove.mockRejectedValue(new Error("connection reset"));
    await expect(
      removeJob(queue() as any, REPO_CACHE_QUEUE_NAME, j as any)
    ).rejects.toThrow("connection reset");
  });
});

describe("cancelJob", () => {
  it("sets every flag an active job's processor polls and leaves the job in place", async () => {
    const q = queue();
    const j = job("active");
    expect(await cancelJob(q as any, REPO_CACHE_QUEUE_NAME, j as any)).toEqual({
      cancelling: true,
      removed: false,
    });
    expect(q._client.set).toHaveBeenCalledWith(
      "job:cancel:repo-cache:scan-issues-9",
      "1",
      "EX",
      3600
    );
    expect(q._client.set).toHaveBeenCalledWith(
      "impact:issue-scan:cancel:9",
      "1",
      "EX",
      3600
    );
    expect(j.remove).not.toHaveBeenCalled();
  });

  it("removes a job that has not started", async () => {
    for (const state of ["waiting", "delayed", "prioritized"]) {
      const j = job(state);
      expect(
        await cancelJob(queue() as any, REPO_CACHE_QUEUE_NAME, j as any)
      ).toEqual({
        cancelling: false,
        removed: true,
      });
      expect(j.remove).toHaveBeenCalled();
    }
  });

  it("refuses an active job whose processor checks no flag, and a finished job", async () => {
    await expect(
      cancelJob(
        queue() as any,
        "emails",
        job("active", { name: "send" }) as any
      )
    ).rejects.toBeInstanceOf(NotCancellableError);
    await expect(
      cancelJob(queue() as any, REPO_CACHE_QUEUE_NAME, job("completed") as any)
    ).rejects.toBeInstanceOf(NotCancellableError);
  });
});
