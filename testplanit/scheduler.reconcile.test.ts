import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for reconcileStaleSchedulers (scheduler.ts). The function is
// exercised directly with fake queues; scheduler.ts's import graph is mocked
// so the test never touches Valkey, Prisma, or the worker modules.

vi.mock("./lib/queues", () => ({
  FORECAST_QUEUE_NAME: "forecast-updates",
  NOTIFICATION_QUEUE_NAME: "notifications",
  REPO_CACHE_QUEUE_NAME: "repo-cache",
  WEBHOOK_DISPATCH_QUEUE_NAME: "webhook-dispatch",
  getForecastQueue: () => null,
  getNotificationQueue: () => null,
  getRepoCacheQueue: () => null,
  getWebhookDispatchQueue: () => null,
}));

vi.mock("./lib/multiTenantPrisma", () => ({
  getAllTenantIds: () => [],
  isMultiTenantMode: () => true,
}));

vi.mock("./workers/forecastWorker", () => ({
  JOB_UPDATE_ALL_CASES: "update-all-cases-forecast",
  JOB_AUTO_COMPLETE_MILESTONES: "auto-complete-milestones",
  JOB_MILESTONE_DUE_NOTIFICATIONS: "milestone-due-notifications",
  JOB_REVIEW_REMINDERS: "review-reminders",
}));

vi.mock("./workers/notificationWorker", () => ({
  JOB_SEND_DAILY_DIGEST: "send-daily-digest",
}));

vi.mock("./workers/repoCacheWorker", () => ({
  JOB_REFRESH_EXPIRED_CACHES: "refresh-expired-caches",
}));

import { reconcileStaleSchedulers } from "./scheduler";

const JOB = "update-all-cases-forecast";

function fakeQueue(
  schedulerKeys: string[],
  opts: { listError?: Error; removeError?: Error } = {}
) {
  const removed: string[] = [];
  return {
    name: "forecast-updates",
    removed,
    getJobSchedulers: vi.fn(async () => {
      if (opts.listError) throw opts.listError;
      return schedulerKeys.map((key) => ({ key, name: JOB }));
    }),
    removeJobScheduler: vi.fn(async (id: string) => {
      if (opts.removeError) throw opts.removeError;
      removed.push(id);
    }),
  };
}

describe("reconcileStaleSchedulers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps schedulers for tenants still in the group config", async () => {
    const q = fakeQueue([`${JOB}-acme`]);
    await reconcileStaleSchedulers(
      [{ queue: q, jobNames: [JOB] }],
      new Set(["acme"])
    );
    expect(q.removed).toEqual([]);
  });

  it("removes schedulers for tenants absent from the group config", async () => {
    const q = fakeQueue([`${JOB}-acme`, `${JOB}-gone`]);
    await reconcileStaleSchedulers(
      [{ queue: q, jobNames: [JOB] }],
      new Set(["acme"])
    );
    expect(q.removed).toEqual([`${JOB}-gone`]);
  });

  it("parses hyphenated tenant slugs by stripping the known job-name prefix", async () => {
    // Tenant slug "old-co" contains a hyphen — naive splitting on "-" would
    // mis-parse it. The active set contains "old-co", so it must be kept;
    // "other-corp-2" is stale and must be removed intact.
    const q = fakeQueue([`${JOB}-old-co`, `${JOB}-other-corp-2`]);
    await reconcileStaleSchedulers(
      [{ queue: q, jobNames: [JOB] }],
      new Set(["old-co"])
    );
    expect(q.removed).toEqual([`${JOB}-other-corp-2`]);
  });

  it("never touches the suffix-less single-tenant scheduler form", async () => {
    const q = fakeQueue([JOB]);
    await reconcileStaleSchedulers(
      [{ queue: q, jobNames: [JOB] }],
      new Set<string>()
    );
    expect(q.removed).toEqual([]);
  });

  it("never touches schedulers with unknown job names", async () => {
    const q = fakeQueue(["some-foreign-scheduler-xyz"]);
    await reconcileStaleSchedulers(
      [{ queue: q, jobNames: [JOB] }],
      new Set<string>()
    );
    expect(q.removed).toEqual([]);
  });

  it("matches the longest job name first (overlapping names)", async () => {
    // "send-daily-digest-summary" is its own job; its tenant-suffixed
    // scheduler must not be parsed as job "send-daily-digest" with tenant
    // "summary-acme".
    const removed: string[] = [];
    const q = {
      name: "notifications",
      getJobSchedulers: vi.fn(async () => [
        { key: "send-daily-digest-summary-acme", name: "irrelevant" },
        { key: "send-daily-digest-acme", name: "irrelevant" },
      ]),
      removeJobScheduler: vi.fn(async (id: string) => {
        removed.push(id);
      }),
    };
    await reconcileStaleSchedulers(
      [
        {
          queue: q,
          jobNames: ["send-daily-digest", "send-daily-digest-summary"],
        },
      ],
      new Set<string>() // nothing active -> both tenants stale
    );
    // Both removed, but each under its own job name with tenant "acme" —
    // proven by both ids being removed exactly as stored.
    expect(removed.sort()).toEqual([
      "send-daily-digest-acme",
      "send-daily-digest-summary-acme",
    ]);
  });

  it("continues past a failing removeJobScheduler", async () => {
    const q = fakeQueue([`${JOB}-gone1`, `${JOB}-gone2`], {
      removeError: new Error("redis hiccup"),
    });
    await expect(
      reconcileStaleSchedulers(
        [{ queue: q, jobNames: [JOB] }],
        new Set<string>()
      )
    ).resolves.toBeUndefined();
    expect(q.removeJobScheduler).toHaveBeenCalledTimes(2);
  });

  it("continues past a failing getJobSchedulers and processes later queues", async () => {
    const broken = fakeQueue([], { listError: new Error("conn reset") });
    const healthy = fakeQueue([`${JOB}-gone`]);
    await reconcileStaleSchedulers(
      [
        { queue: broken, jobNames: [JOB] },
        { queue: healthy, jobNames: [JOB] },
      ],
      new Set<string>()
    );
    expect(healthy.removed).toEqual([`${JOB}-gone`]);
  });

  it("skips null queues", async () => {
    await expect(
      reconcileStaleSchedulers(
        [{ queue: null, jobNames: [JOB] }],
        new Set<string>()
      )
    ).resolves.toBeUndefined();
  });

  it("skips undefined/keyless entries from legacy repeat-zset members", async () => {
    // Pre-BullMQ-5 repeat members (MD5-style, no scheduler hash) make
    // getJobSchedulers() yield undefined or keyless entries. Prod incident
    // 2026-06-05: one undefined entry TypeError'd the whole reconciliation
    // pass. Stale entries AFTER the bad ones must still be processed.
    const removed: string[] = [];
    const q = {
      name: "forecast-updates",
      getJobSchedulers: vi.fn(async () => [
        undefined,
        null,
        { name: JOB }, // keyless
        { key: null, name: JOB },
        { key: `${JOB}-gone`, name: JOB }, // real stale entry after the junk
      ]),
      removeJobScheduler: vi.fn(async (id: string) => {
        removed.push(id);
      }),
    };
    await expect(
      reconcileStaleSchedulers(
        [{ queue: q as never, jobNames: [JOB] }],
        new Set<string>()
      )
    ).resolves.toBeUndefined();
    expect(removed).toEqual([`${JOB}-gone`]);
  });

  it("tolerates getJobSchedulers resolving to null", async () => {
    const q = {
      name: "forecast-updates",
      getJobSchedulers: vi.fn(async () => null),
      removeJobScheduler: vi.fn(),
    };
    await expect(
      reconcileStaleSchedulers(
        [{ queue: q as never, jobNames: [JOB] }],
        new Set<string>()
      )
    ).resolves.toBeUndefined();
    expect(q.removeJobScheduler).not.toHaveBeenCalled();
  });
});
