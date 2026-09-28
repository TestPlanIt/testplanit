import { describe, expect, it, vi } from "vitest";
import {
  JOB_CHECK_STALE_PINS,
  JOB_REFRESH_EXPIRED_CACHES,
  JOB_REFRESH_SINGLE_REPO_CACHE,
  JOB_SCAN_REPO_ISSUES,
} from "~/lib/queueNames";
import {
  annotateRepoJobStatus,
  applyRepoJobStatus,
  markInterruptedRepoJobs,
  REPO_JOB_UNRESPONSIVE_MS,
  readSweepProgress,
  RepoQueueView,
  resolveRepoJobStatus,
  savedRepoJobFlag,
  type RepoStatusRow,
} from "./repoJobStatus";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

interface FakeJob {
  id: string;
  name: string;
  data: Record<string, unknown>;
  progress?: unknown;
  processedOn?: number;
  getState: () => Promise<string>;
}

function fakeJob(
  id: string,
  name: string,
  state: string,
  extra: Partial<FakeJob> = {}
): FakeJob {
  return {
    id,
    name,
    data: {},
    processedOn: NOW - 1000,
    getState: async () => state,
    ...extra,
  };
}

/** A queue holding the given jobs by id; `getActive` lists the active ones. */
function fakeQueue(jobs: FakeJob[] = []) {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  return {
    getJob: vi.fn(async (id: string) => byId.get(id) ?? null),
    getActive: vi.fn(async () => {
      const active: FakeJob[] = [];
      for (const job of jobs) {
        if ((await job.getState()) === "active") active.push(job);
      }
      return active;
    }),
  };
}

function view(jobs: FakeJob[] = [], tenantId?: string) {
  return new RepoQueueView(fakeQueue(jobs) as any, tenantId);
}

describe("savedRepoJobFlag", () => {
  it("reads running and queued off the JSON reports, and pending off the cache column", () => {
    expect(
      savedRepoJobFlag("scan-issues", {
        id: 1,
        issueScanReport: { running: true },
      })
    ).toBe("running");
    expect(
      savedRepoJobFlag("scan-issues", {
        id: 1,
        issueScanReport: { queued: true },
      })
    ).toBe("queued");
    expect(
      savedRepoJobFlag("stale-pins", {
        id: 1,
        stalePinReport: { queued: true },
      })
    ).toBe("queued");
    expect(
      savedRepoJobFlag("refresh-cache", { id: 1, cacheStatus: "pending" })
    ).toBe("running");
  });

  it("claims nothing for a finished report or cache state", () => {
    expect(
      savedRepoJobFlag("scan-issues", {
        id: 1,
        issueScanReport: { scannedAt: "2026-09-28T00:00:00Z" },
      })
    ).toBeNull();
    expect(
      savedRepoJobFlag("scan-issues", {
        id: 1,
        issueScanReport: { interrupted: true },
      })
    ).toBeNull();
    expect(
      savedRepoJobFlag("refresh-cache", { id: 1, cacheStatus: "success" })
    ).toBeNull();
    expect(
      savedRepoJobFlag("refresh-cache", { id: 1, cacheStatus: "queued" })
    ).toBeNull();
    expect(
      savedRepoJobFlag("stale-pins", { id: 1, stalePinReport: "junk" })
    ).toBeNull();
  });
});

describe("readSweepProgress", () => {
  it("reads the connection and heartbeat the sweep recorded", () => {
    expect(readSweepProgress({ progress: { configId: 4, at: 123 } })).toEqual({
      configId: 4,
      at: 123,
    });
    expect(readSweepProgress({ progress: { configId: 4 } })).toEqual({
      configId: 4,
      at: 0,
    });
    expect(readSweepProgress({ progress: 42 })).toBeNull();
    expect(readSweepProgress({ progress: { at: 1 } })).toBeNull();
  });
});

describe("resolveRepoJobStatus", () => {
  const scanRow = (report: unknown): RepoStatusRow => ({
    id: 9,
    issueScanReport: report,
  });

  it("is running while the connection's own job is active, whatever the report says", async () => {
    const own = fakeJob("scan-issues-9", JOB_SCAN_REPO_ISSUES, "active");
    for (const report of [
      { running: true, progressAt: iso(1000) },
      { queued: true },
      { scannedAt: iso(0) },
      null,
    ]) {
      expect(
        await resolveRepoJobStatus(
          view([own]),
          "scan-issues",
          scanRow(report),
          NOW
        )
      ).toEqual({
        status: "running",
        jobId: "scan-issues-9",
        unresponsive: false,
      });
    }
  });

  it("is running but not responding when neither the report nor the job moved for the threshold", async () => {
    const own = fakeJob("scan-issues-9", JOB_SCAN_REPO_ISSUES, "active", {
      processedOn: NOW - 3 * REPO_JOB_UNRESPONSIVE_MS,
    });
    const stale = scanRow({
      running: true,
      startedAt: iso(3 * REPO_JOB_UNRESPONSIVE_MS),
      progressAt: iso(REPO_JOB_UNRESPONSIVE_MS + 1),
    });
    expect(
      await resolveRepoJobStatus(view([own]), "scan-issues", stale, NOW)
    ).toMatchObject({ status: "running", unresponsive: true });

    // A fresh heartbeat on either side keeps it responsive.
    const freshReport = scanRow({ running: true, progressAt: iso(1000) });
    expect(
      await resolveRepoJobStatus(view([own]), "scan-issues", freshReport, NOW)
    ).toMatchObject({ status: "running", unresponsive: false });
    const justStarted = fakeJob(
      "scan-issues-9",
      JOB_SCAN_REPO_ISSUES,
      "active",
      {
        processedOn: NOW - 5000,
      }
    );
    expect(
      await resolveRepoJobStatus(view([justStarted]), "scan-issues", stale, NOW)
    ).toMatchObject({ status: "running", unresponsive: false });
  });

  it("is queued while the own job waits, delayed or prioritized, naming what the worker is on", async () => {
    const busy = fakeJob(
      "repeat:sweep:1",
      JOB_REFRESH_EXPIRED_CACHES,
      "active",
      {
        progress: { configId: 4, at: NOW },
      }
    );
    for (const state of ["waiting", "delayed", "prioritized"]) {
      const own = fakeJob("stale-pins-9", JOB_CHECK_STALE_PINS, state);
      expect(
        await resolveRepoJobStatus(
          view([busy, own]),
          "stale-pins",
          { id: 9, stalePinReport: { queued: true } },
          NOW
        )
      ).toEqual({
        status: "queued",
        jobId: "stale-pins-9",
        behind: { kind: "sweep", configId: 4 },
      });
    }
  });

  it("names a manual refresh or another connection's scan the job waits behind", async () => {
    const own = fakeJob("scan-issues-9", JOB_SCAN_REPO_ISSUES, "waiting");
    const refresh = fakeJob(
      "refresh-cache-3",
      JOB_REFRESH_SINGLE_REPO_CACHE,
      "active",
      {
        data: { configId: 3 },
      }
    );
    expect(
      await resolveRepoJobStatus(
        view([refresh, own]),
        "scan-issues",
        scanRow({ queued: true }),
        NOW
      )
    ).toMatchObject({
      status: "queued",
      behind: { kind: "refresh-cache", configId: 3 },
    });

    const idle = fakeJob("scan-issues-9", JOB_SCAN_REPO_ISSUES, "waiting");
    expect(
      await resolveRepoJobStatus(
        view([idle]),
        "scan-issues",
        scanRow({ queued: true }),
        NOW
      )
    ).toMatchObject({ status: "queued", behind: null });
  });

  it("is interrupted when the report says running or queued and the queue holds no live job", async () => {
    for (const report of [
      { running: true, progressAt: iso(1000) },
      { running: true, progressAt: iso(5 * REPO_JOB_UNRESPONSIVE_MS) },
      { queued: true },
    ]) {
      expect(
        await resolveRepoJobStatus(view(), "scan-issues", scanRow(report), NOW)
      ).toEqual({ status: "interrupted" });
    }
    // A job that finished but is still held by retention is no job.
    const done = fakeJob("scan-issues-9", JOB_SCAN_REPO_ISSUES, "completed");
    expect(
      await resolveRepoJobStatus(
        view([done]),
        "scan-issues",
        scanRow({ running: true }),
        NOW
      )
    ).toEqual({ status: "interrupted" });
    const failed = fakeJob("scan-issues-9", JOB_SCAN_REPO_ISSUES, "failed");
    expect(
      await resolveRepoJobStatus(
        view([failed]),
        "scan-issues",
        scanRow({ queued: true }),
        NOW
      )
    ).toEqual({ status: "interrupted" });
  });

  it("attributes a running ticket scan to the connection's manual cache refresh", async () => {
    const refresh = fakeJob(
      "refresh-cache-9",
      JOB_REFRESH_SINGLE_REPO_CACHE,
      "active",
      {
        data: { configId: 9 },
      }
    );
    expect(
      await resolveRepoJobStatus(
        view([refresh]),
        "scan-issues",
        scanRow({ running: true, progressAt: iso(1000) }),
        NOW
      )
    ).toEqual({
      status: "running",
      jobId: "refresh-cache-9",
      unresponsive: false,
    });
    // Another connection's refresh does not own this scan.
    const other = fakeJob(
      "refresh-cache-3",
      JOB_REFRESH_SINGLE_REPO_CACHE,
      "active",
      {
        data: { configId: 3 },
      }
    );
    expect(
      await resolveRepoJobStatus(
        view([other]),
        "scan-issues",
        scanRow({ running: true }),
        NOW
      )
    ).toEqual({ status: "interrupted" });
  });

  it("attributes running flags to the nightly sweep only while it is on the connection", async () => {
    const onThis = fakeJob(
      "repeat:sweep:1",
      JOB_REFRESH_EXPIRED_CACHES,
      "active",
      {
        progress: { configId: 9, at: NOW - 1000 },
        processedOn: NOW - 5 * REPO_JOB_UNRESPONSIVE_MS,
      }
    );
    expect(
      await resolveRepoJobStatus(
        view([onThis]),
        "refresh-cache",
        { id: 9, cacheStatus: "pending" },
        NOW
      )
    ).toEqual({
      status: "running",
      jobId: "repeat:sweep:1",
      unresponsive: false,
    });
    expect(
      await resolveRepoJobStatus(
        view([onThis]),
        "scan-issues",
        scanRow({ running: true }),
        NOW
      )
    ).toMatchObject({ status: "running", jobId: "repeat:sweep:1" });

    const onOther = fakeJob(
      "repeat:sweep:1",
      JOB_REFRESH_EXPIRED_CACHES,
      "active",
      {
        progress: { configId: 4, at: NOW },
      }
    );
    expect(
      await resolveRepoJobStatus(
        view([onOther]),
        "refresh-cache",
        { id: 9, cacheStatus: "pending" },
        NOW
      )
    ).toEqual({ status: "interrupted" });

    // The sweep's own heartbeat ages too.
    const stuck = fakeJob(
      "repeat:sweep:1",
      JOB_REFRESH_EXPIRED_CACHES,
      "active",
      {
        progress: { configId: 9, at: NOW - 2 * REPO_JOB_UNRESPONSIVE_MS },
        processedOn: NOW - 3 * REPO_JOB_UNRESPONSIVE_MS,
      }
    );
    expect(
      await resolveRepoJobStatus(
        view([stuck]),
        "refresh-cache",
        { id: 9, cacheStatus: "pending" },
        NOW
      )
    ).toMatchObject({ status: "running", unresponsive: true });
  });

  it("never lets a stale pin check ride on a refresh or the sweep", async () => {
    const sweep = fakeJob(
      "repeat:sweep:1",
      JOB_REFRESH_EXPIRED_CACHES,
      "active",
      {
        progress: { configId: 9, at: NOW },
      }
    );
    expect(
      await resolveRepoJobStatus(
        view([sweep]),
        "stale-pins",
        { id: 9, stalePinReport: { running: true } },
        NOW
      )
    ).toEqual({ status: "interrupted" });
  });

  it("is idle when nothing is claimed and no job exists", async () => {
    expect(
      await resolveRepoJobStatus(
        view(),
        "scan-issues",
        scanRow({ scannedAt: iso(0) }),
        NOW
      )
    ).toEqual({ status: "idle" });
    expect(
      await resolveRepoJobStatus(
        view(),
        "refresh-cache",
        { id: 9, cacheStatus: "success" },
        NOW
      )
    ).toEqual({ status: "idle" });
  });

  it("only sees jobs of its own tenant", async () => {
    const own = fakeJob("scan-issues-acme-9", JOB_SCAN_REPO_ISSUES, "active", {
      data: { tenantId: "acme" },
    });
    const sweepElsewhere = fakeJob(
      "repeat:sweep:1",
      JOB_REFRESH_EXPIRED_CACHES,
      "active",
      {
        data: { tenantId: "other" },
        progress: { configId: 9, at: NOW },
      }
    );
    expect(
      await resolveRepoJobStatus(
        view([own, sweepElsewhere], "acme"),
        "scan-issues",
        scanRow(null),
        NOW
      )
    ).toMatchObject({ status: "running", jobId: "scan-issues-acme-9" });
    expect(
      await resolveRepoJobStatus(
        view([sweepElsewhere], "acme"),
        "refresh-cache",
        { id: 9, cacheStatus: "pending" },
        NOW
      )
    ).toEqual({ status: "interrupted" });
  });
});

describe("applyRepoJobStatus", () => {
  const nowIso = new Date(NOW).toISOString();

  it("rewrites a queued report as running once the worker has the job, keeping what was saved", () => {
    const row: RepoStatusRow = {
      id: 9,
      issueScanReport: { queued: true, full: true, requestedAt: iso(60_000) },
    };
    const persist = applyRepoJobStatus(
      "scan-issues",
      row,
      { status: "running", jobId: "scan-issues-9", unresponsive: false },
      nowIso
    );
    expect(persist).toBeNull();
    expect(row.issueScanReport).toEqual({
      full: true,
      requestedAt: iso(60_000),
      running: true,
      unresponsive: false,
    });
  });

  it("marks a running report as not responding without touching its progress", () => {
    const row: RepoStatusRow = {
      id: 9,
      stalePinReport: { running: true, checkedFiles: 4, progressAt: iso(0) },
    };
    applyRepoJobStatus(
      "stale-pins",
      row,
      { status: "running", jobId: "stale-pins-9", unresponsive: true },
      nowIso
    );
    expect(row.stalePinReport).toEqual({
      running: true,
      checkedFiles: 4,
      progressAt: iso(0),
      unresponsive: true,
    });
  });

  it("rewrites a report as queued with what the worker is on, dropping a running flag", () => {
    const row: RepoStatusRow = {
      id: 9,
      issueScanReport: { running: true, full: false, startedAt: iso(0) },
    };
    applyRepoJobStatus(
      "scan-issues",
      row,
      {
        status: "queued",
        jobId: "scan-issues-9",
        behind: { kind: "sweep", configId: 4 },
      },
      nowIso
    );
    expect(row.issueScanReport).toEqual({
      full: false,
      startedAt: iso(0),
      queued: true,
      behind: { kind: "sweep", configId: 4 },
    });
  });

  it("writes an interrupted final report and asks for it to be persisted", () => {
    const scan: RepoStatusRow = {
      id: 9,
      issueScanReport: {
        running: true,
        full: true,
        startedAt: iso(3600_000),
        scannedCommits: 40,
      },
    };
    expect(
      applyRepoJobStatus("scan-issues", scan, { status: "interrupted" }, nowIso)
    ).toEqual({
      issueScanReport: {
        interrupted: true,
        full: true,
        startedAt: iso(3600_000),
        scannedAt: nowIso,
      },
    });
    expect(scan.issueScanReport).toEqual({
      interrupted: true,
      full: true,
      startedAt: iso(3600_000),
      scannedAt: nowIso,
    });

    const queued: RepoStatusRow = {
      id: 9,
      stalePinReport: { queued: true, requestedAt: iso(1000) },
    };
    expect(
      applyRepoJobStatus(
        "stale-pins",
        queued,
        { status: "interrupted" },
        nowIso
      )
    ).toEqual({
      stalePinReport: {
        interrupted: true,
        startedAt: iso(1000),
        checkedAt: nowIso,
      },
    });
  });

  it("maps the cache column to queued and interrupted, and leaves pending for running", () => {
    const row: RepoStatusRow = { id: 9, cacheStatus: "pending" };
    expect(
      applyRepoJobStatus("refresh-cache", row, {
        status: "running",
        jobId: "r",
        unresponsive: false,
      })
    ).toBeNull();
    expect(row.cacheStatus).toBe("pending");
    expect(
      applyRepoJobStatus("refresh-cache", row, {
        status: "queued",
        jobId: "r",
        behind: null,
      })
    ).toBeNull();
    expect(row.cacheStatus).toBe("queued");
    expect(
      applyRepoJobStatus("refresh-cache", row, { status: "interrupted" })
    ).toEqual({
      cacheStatus: "interrupted",
    });
    expect(row.cacheStatus).toBe("interrupted");
  });

  it("leaves an idle row alone", () => {
    const row: RepoStatusRow = {
      id: 9,
      issueScanReport: { scannedAt: iso(0) },
    };
    expect(
      applyRepoJobStatus("scan-issues", row, { status: "idle" })
    ).toBeNull();
    expect(row.issueScanReport).toEqual({ scannedAt: iso(0) });
  });
});

describe("annotateRepoJobStatus", () => {
  it("asks the queue nothing for rows that claim nothing", async () => {
    const queue = fakeQueue();
    const rows: RepoStatusRow[] = [
      { id: 1, issueScanReport: { scannedAt: iso(0) }, cacheStatus: "success" },
      { id: 2 },
    ];
    expect(
      await annotateRepoJobStatus(rows, { queue: queue as any, now: () => NOW })
    ).toBe(0);
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.getActive).not.toHaveBeenCalled();
  });

  it("rewrites every claimed kind on a row, reading the active list once", async () => {
    const queue = fakeQueue([
      fakeJob("scan-issues-1", JOB_SCAN_REPO_ISSUES, "waiting"),
      fakeJob("repeat:sweep:1", JOB_REFRESH_EXPIRED_CACHES, "active", {
        progress: { configId: 2, at: NOW },
      }),
    ]);
    const rows: RepoStatusRow[] = [
      {
        id: 1,
        issueScanReport: { queued: true },
        stalePinReport: { running: true },
        cacheStatus: "success",
      },
      { id: 2, cacheStatus: "pending" },
    ];
    const persist = vi.fn().mockResolvedValue(undefined);

    const interrupted = await annotateRepoJobStatus(rows, {
      queue: queue as any,
      persist,
      now: () => NOW,
    });

    expect(interrupted).toBe(1);
    expect(rows[0].issueScanReport).toMatchObject({
      queued: true,
      behind: { kind: "sweep", configId: 2 },
    });
    expect(rows[0].stalePinReport).toMatchObject({ interrupted: true });
    expect(rows[1].cacheStatus).toBe("pending");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(1, {
      stalePinReport: expect.objectContaining({ interrupted: true }),
    });
    expect(queue.getActive).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a queue, so the saved flags stand", async () => {
    const rows: RepoStatusRow[] = [
      { id: 1, issueScanReport: { running: true } },
    ];
    expect(await annotateRepoJobStatus(rows, { queue: null })).toBe(0);
    expect(rows[0].issueScanReport).toEqual({ running: true });
  });

  it("skips rows read without an id", async () => {
    const queue = fakeQueue();
    const rows = [
      { issueScanReport: { running: true } },
    ] as unknown as RepoStatusRow[];
    expect(await annotateRepoJobStatus(rows, { queue: queue as any })).toBe(0);
    expect(queue.getJob).not.toHaveBeenCalled();
  });
});

describe("markInterruptedRepoJobs", () => {
  it("persists interrupted for orphaned flags and leaves backed jobs alone", async () => {
    const queue = fakeQueue([
      fakeJob("scan-issues-2", JOB_SCAN_REPO_ISSUES, "active"),
      fakeJob("stale-pins-3", JOB_CHECK_STALE_PINS, "waiting"),
    ]);
    const db = {
      projectCodeRepositoryConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1,
            issueScanReport: { running: true, full: true },
            cacheStatus: "pending",
          },
          { id: 2, issueScanReport: { running: true } },
          { id: 3, stalePinReport: { queued: true } },
          { id: 4, issueScanReport: { scannedAt: iso(0) } },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const count = await markInterruptedRepoJobs(db, queue as any);

    expect(count).toBe(2);
    expect(db.projectCodeRepositoryConfig.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        issueScanReport: true,
        stalePinReport: true,
        cacheStatus: true,
      },
    });
    expect(db.projectCodeRepositoryConfig.update).toHaveBeenCalledTimes(1);
    expect(db.projectCodeRepositoryConfig.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        issueScanReport: expect.objectContaining({
          interrupted: true,
          full: true,
        }),
        cacheStatus: "interrupted",
      },
    });
  });
});
