import { describe, expect, it, vi } from "vitest";
import {
  JOB_CHECK_STALE_PINS,
  JOB_REFRESH_SINGLE_REPO_CACHE,
  JOB_SCAN_REPO_ISSUES,
} from "~/lib/queueNames";
import {
  enqueueRepoJob,
  findRepoJob,
  isLiveJobState,
  repoJobId,
} from "./repoJobs";

function job(state: string, id = "scan-issues-9") {
  return {
    id,
    getState: vi.fn().mockResolvedValue(state),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function queue(existing: unknown = null) {
  return {
    getJob: vi.fn().mockResolvedValue(existing),
    add: vi.fn(
      async (_name: string, _data: unknown, opts: { jobId: string }) => ({
        id: opts.jobId,
      })
    ),
  };
}

describe("repoJobId", () => {
  it("is one id per kind, tenant and connection, without colons", () => {
    expect(repoJobId("scan-issues", 9)).toBe("scan-issues-9");
    expect(repoJobId("stale-pins", 9, null)).toBe("stale-pins-9");
    expect(repoJobId("refresh-cache", 9, "acme")).toBe("refresh-cache-acme-9");
    expect(repoJobId("scan-issues", 9, "acme:eu/1")).toBe(
      "scan-issues-acme_eu_1-9"
    );
  });
});

describe("isLiveJobState", () => {
  it("counts every state a job can still run from, and no finished one", () => {
    for (const state of [
      "active",
      "waiting",
      "delayed",
      "prioritized",
      "waiting-children",
    ]) {
      expect(isLiveJobState(state)).toBe(true);
    }
    for (const state of ["completed", "failed", "unknown", ""]) {
      expect(isLiveJobState(state)).toBe(false);
    }
  });
});

describe("findRepoJob", () => {
  it("looks the job up by its deterministic id and reports its state", async () => {
    const q = queue(job("delayed"));
    const found = await findRepoJob(q as any, "scan-issues", 9, "acme");
    expect(q.getJob).toHaveBeenCalledWith("scan-issues-acme-9");
    expect(found).toMatchObject({ state: "delayed" });
  });

  it("returns null when the queue holds no job under the id", async () => {
    expect(await findRepoJob(queue() as any, "stale-pins", 9)).toBeNull();
  });
});

describe("enqueueRepoJob", () => {
  it("adds the job under its id with the connection, tenant and extra data", async () => {
    const q = queue();
    const beforeAdd = vi.fn().mockResolvedValue(undefined);

    const result = await enqueueRepoJob(q as any, {
      kind: "scan-issues",
      configId: 9,
      tenantId: "acme",
      data: { full: true },
      beforeAdd,
    });

    expect(result).toEqual({ jobId: "scan-issues-acme-9", joined: false });
    expect(q.add).toHaveBeenCalledWith(
      JOB_SCAN_REPO_ISSUES,
      { configId: 9, tenantId: "acme", full: true },
      { jobId: "scan-issues-acme-9" }
    );
    expect(beforeAdd.mock.invocationCallOrder[0]).toBeLessThan(
      q.add.mock.invocationCallOrder[0]
    );
  });

  it("maps each kind to its worker job name", async () => {
    for (const [kind, name] of [
      ["stale-pins", JOB_CHECK_STALE_PINS],
      ["refresh-cache", JOB_REFRESH_SINGLE_REPO_CACHE],
    ] as const) {
      const q = queue();
      await enqueueRepoJob(q as any, { kind, configId: 3 });
      expect(q.add).toHaveBeenCalledWith(
        name,
        { configId: 3, tenantId: undefined },
        { jobId: `${kind}-3` }
      );
    }
  });

  it("joins a live job instead of adding another, and skips beforeAdd", async () => {
    for (const state of ["waiting", "active", "delayed", "prioritized"]) {
      const q = queue(job(state));
      const beforeAdd = vi.fn();
      const result = await enqueueRepoJob(q as any, {
        kind: "scan-issues",
        configId: 9,
        beforeAdd,
      });
      expect(result).toEqual({ jobId: "scan-issues-9", joined: true });
      expect(q.add).not.toHaveBeenCalled();
      expect(beforeAdd).not.toHaveBeenCalled();
    }
  });

  it("removes a finished job held by retention before adding, so the id is free", async () => {
    for (const state of ["completed", "failed"]) {
      const old = job(state);
      const q = queue(old);
      const result = await enqueueRepoJob(q as any, {
        kind: "scan-issues",
        configId: 9,
      });
      expect(old.remove).toHaveBeenCalled();
      expect(q.add).toHaveBeenCalled();
      expect(result.joined).toBe(false);
    }
  });

  it("does not add when the old job cannot be removed, since BullMQ would keep the old one", async () => {
    const old = job("completed");
    old.remove.mockRejectedValue(new Error("locked"));
    const q = queue(old);
    await expect(
      enqueueRepoJob(q as any, { kind: "scan-issues", configId: 9 })
    ).rejects.toThrow("locked");
    expect(q.add).not.toHaveBeenCalled();
  });
});
