import { describe, expect, it, vi } from "vitest";
import {
  IMPACT_ANALYSIS_QUEUE_NAME,
  JOB_CHECK_STALE_PINS,
  JOB_REFRESH_EXPIRED_CACHES,
  JOB_SCAN_REPO_ISSUES,
  REPO_CACHE_QUEUE_NAME,
} from "~/lib/queueNames";
import {
  cancelFlagsForJob,
  clearJobCancel,
  isJobCancelRequested,
  jobCancelKey,
  setCancelFlags,
} from "./jobCancel";

function store(values: Record<string, string> = {}) {
  return {
    get: vi.fn(async (key: string) => values[key] ?? null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe("cancelFlagsForJob", () => {
  it("gives every repo-cache job its per-job flag, and a ticket scan its connection flag too", () => {
    expect(
      cancelFlagsForJob(REPO_CACHE_QUEUE_NAME, {
        id: "scan-issues-9",
        name: JOB_SCAN_REPO_ISSUES,
        data: { configId: 9 },
      })
    ).toEqual([
      "job:cancel:repo-cache:scan-issues-9",
      "impact:issue-scan:cancel:9",
    ]);
    expect(
      cancelFlagsForJob(REPO_CACHE_QUEUE_NAME, {
        id: "stale-pins-9",
        name: JOB_CHECK_STALE_PINS,
        data: { configId: 9 },
      })
    ).toEqual(["job:cancel:repo-cache:stale-pins-9"]);
    expect(
      cancelFlagsForJob(REPO_CACHE_QUEUE_NAME, {
        id: "repeat:sweep:1",
        name: JOB_REFRESH_EXPIRED_CACHES,
        data: {},
      })
    ).toEqual(["job:cancel:repo-cache:repeat:sweep:1"]);
  });

  it("uses the analysis worker's own flag for impact analyses", () => {
    expect(
      cancelFlagsForJob(IMPACT_ANALYSIS_QUEUE_NAME, {
        id: "impact-4",
        name: "x",
      })
    ).toEqual(["impact:cancel:impact-4"]);
  });

  it("knows no flag for other queues or a job without an id", () => {
    expect(cancelFlagsForJob("emails", { id: "1", name: "send" })).toBeNull();
    expect(
      cancelFlagsForJob(REPO_CACHE_QUEUE_NAME, {
        id: null,
        name: JOB_SCAN_REPO_ISSUES,
      })
    ).toBeNull();
  });
});

describe("cancel flag store", () => {
  it("sets each flag with a positional expiry, as ioredis expects", async () => {
    const s = store();
    await setCancelFlags(s, ["a", "b"]);
    expect(s.set).toHaveBeenCalledWith("a", "1", "EX", 3600);
    expect(s.set).toHaveBeenCalledWith("b", "1", "EX", 3600);
  });

  it("reads and clears the per-job flag, and treats a missing store or a failure as no request", async () => {
    const key = jobCancelKey(REPO_CACHE_QUEUE_NAME, "scan-issues-9");
    const s = store({ [key]: "1" });
    expect(
      await isJobCancelRequested(s, REPO_CACHE_QUEUE_NAME, "scan-issues-9")
    ).toBe(true);
    expect(await isJobCancelRequested(s, REPO_CACHE_QUEUE_NAME, "other")).toBe(
      false
    );
    expect(
      await isJobCancelRequested(null, REPO_CACHE_QUEUE_NAME, "scan-issues-9")
    ).toBe(false);

    s.get.mockRejectedValueOnce(new Error("down"));
    expect(
      await isJobCancelRequested(s, REPO_CACHE_QUEUE_NAME, "scan-issues-9")
    ).toBe(false);

    await clearJobCancel(s, REPO_CACHE_QUEUE_NAME, "scan-issues-9");
    expect(s.del).toHaveBeenCalledWith(key);
    await expect(
      clearJobCancel(null, REPO_CACHE_QUEUE_NAME, "x")
    ).resolves.toBeUndefined();
  });
});
